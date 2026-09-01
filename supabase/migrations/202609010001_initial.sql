create extension if not exists pgcrypto;

create type public.profile_role as enum ('customer', 'operator', 'admin');
create type public.intake_status as enum ('draft', 'ready_for_payment', 'paid', 'in_review', 'approved', 'cancelled');
create type public.order_status as enum ('pending_payment', 'paid', 'in_fulfillment', 'delivered', 'payment_expired', 'cancelled', 'refunded');
create type public.product_kind as enum ('job_search', 'apply_pack');
create type public.reservation_status as enum ('reserved', 'confirmed', 'released', 'expired');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role public.profile_role not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.intakes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  direction text not null,
  priorities jsonb not null default '[]'::jsonb,
  dealbreakers text not null,
  location_preference text not null,
  schedule_preference text not null,
  minimum_salary text,
  cover_letter_path text,
  experience_summary text not null,
  notes text,
  resume_path text not null,
  status public.intake_status not null default 'draft',
  criteria_version integer not null default 1,
  criteria_approved_at timestamptz,
  source_retention_due_at timestamptz,
  source_deleted_at timestamptz,
  source_scan_status text not null default 'pending' check (source_scan_status in ('pending','clean','blocked')),
  source_scan_provider_ref text,
  source_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.intake_answers (
  intake_id uuid primary key references public.intakes(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  answers jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create table public.criteria_versions (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.intakes(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  unique(intake_id, version)
);

create table public.capacity_limits (
  kind public.product_kind primary key,
  units_per_24h integer not null check (units_per_24h > 0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.capacity_limits(kind, units_per_24h) values ('job_search', 1), ('apply_pack', 2);

create table public.capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  kind public.product_kind not null,
  customer_id uuid not null references public.profiles(id),
  units integer not null check (units > 0),
  request_key text not null unique,
  status public.reservation_status not null default 'reserved',
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz
);
create index capacity_window_idx on public.capacity_reservations(kind, reserved_at desc) where status in ('reserved', 'confirmed');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  intake_id uuid references public.intakes(id),
  parent_order_id uuid references public.orders(id),
  source_cart_id uuid,
  product_kind public.product_kind not null,
  amount_cents integer not null check (amount_cents >= 0),
  status public.order_status not null default 'pending_payment',
  capacity_reservation_id uuid references public.capacity_reservations(id),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  paid_at timestamptz,
  delivery_deadline timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_customer_idx on public.orders(customer_id, created_at desc);

create table public.apply_pack_carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  search_order_id uuid not null references public.orders(id),
  status text not null default 'checkout_pending' check (status in ('open','checkout_pending','paid','expired','cancelled')),
  unit_price_cents integer not null default 800 check (unit_price_cents = 800),
  item_count integer not null check (item_count between 1 and 2),
  total_cents integer not null check (total_cents = item_count * unit_price_cents),
  capacity_reservation_id uuid references public.capacity_reservations(id),
  stripe_checkout_session_id text unique,
  customer_update_notes text,
  selection_confirmed boolean not null,
  submission_boundary_acknowledged boolean not null,
  outcomes_acknowledged boolean not null,
  paid_at timestamptz,
  delivery_deadline timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders add constraint orders_source_cart_fk foreign key (source_cart_id) references public.apply_pack_carts(id);
create index apply_pack_carts_customer_idx on public.apply_pack_carts(customer_id, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  apply_pack_cart_id uuid references public.apply_pack_carts(id),
  provider text not null,
  provider_checkout_id text not null unique,
  provider_payment_id text not null unique,
  amount_cents integer not null,
  status text not null,
  created_at timestamptz not null default now(),
  check ((order_id is not null)::integer + (apply_pack_cart_id is not null)::integer = 1)
);
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  order_id uuid not null references public.orders(id),
  provider_refund_id text unique,
  amount_cents integer not null check (amount_cents > 0),
  reason_code text not null,
  customer_visible_reason text not null,
  status text not null,
  initiated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(order_id)
);


create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  title text not null,
  source_url text not null,
  location_text text,
  salary_text text,
  checked_at timestamptz not null,
  listing_status text not null default 'open',
  created_at timestamptz not null default now()
);

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  search_order_id uuid not null references public.orders(id) on delete cascade,
  job_id uuid not null references public.jobs(id),
  position integer not null check (position between 1 and 10),
  fit_summary text not null,
  requirements jsonb not null default '[]'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  customer_decision text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique(search_order_id, position),
  unique(search_order_id, job_id)
);

create table public.apply_pack_cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.apply_pack_carts(id) on delete cascade,
  job_match_id uuid not null references public.job_matches(id),
  emphasis_notes text,
  do_not_mention_notes text,
  unit_price_cents integer not null default 800 check (unit_price_cents = 800),
  created_at timestamptz not null default now(),
  unique(cart_id, job_match_id)
);

create table public.apply_pack_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  job_match_id uuid not null references public.job_matches(id),
  status text not null default 'queued',
  emphasis_notes text,
  do_not_mention_notes text,
  customer_update_notes text,
  resume_path text,
  cover_letter_path text,
  delivered_at timestamptz,
  unique(job_match_id)
);

create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  apply_pack_item_id uuid not null references public.apply_pack_items(id),
  customer_id uuid not null references public.profiles(id),
  correction_text text not null,
  admin_notes text,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index one_correction_per_item on public.correction_requests(apply_pack_item_id);

create table public.conflict_reviews (
  id uuid primary key default gen_random_uuid(),
  job_match_id uuid not null references public.job_matches(id),
  customer_id uuid not null references public.profiles(id),
  explanation text not null,
  criteria_version integer not null,
  status text not null default 'submitted',
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(job_match_id, customer_id)
);

create table public.api_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  primary key(scope, key_hash)
);

create or replace function public.complete_paid_checkout(
  p_order_id uuid,
  p_checkout_id text,
  p_payment_id text,
  p_amount_cents integer,
  p_paid_at timestamptz,
  p_deadline timestamptz,
  p_reservation_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  target public.orders%rowtype;
  reservation_state public.reservation_status;
begin
  select * into target from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if target.stripe_checkout_session_id is distinct from p_checkout_id then raise exception 'checkout mismatch'; end if;
  if target.capacity_reservation_id is distinct from p_reservation_id then raise exception 'reservation mismatch'; end if;
  if target.amount_cents <> p_amount_cents then raise exception 'amount mismatch'; end if;
  select status into reservation_state from public.capacity_reservations
    where id = p_reservation_id and customer_id = target.customer_id and kind = target.product_kind
    for update;
  if reservation_state is null or reservation_state not in ('reserved', 'confirmed') then
    raise exception 'reservation is not payable';
  end if;
  if target.status = 'pending_payment' then
    update public.orders set
      status = 'paid',
      paid_at = p_paid_at,
      delivery_deadline = p_deadline,
      stripe_payment_intent_id = p_payment_id,
      updated_at = now()
    where id = p_order_id;
    insert into public.payments(
      order_id, provider, provider_checkout_id, provider_payment_id, amount_cents, status
    ) values (
      p_order_id, 'stripe', p_checkout_id, p_payment_id, p_amount_cents, 'paid'
    ) on conflict (provider_payment_id) do update set status = 'paid';
    update public.capacity_reservations set
      status = 'confirmed',
      confirmed_at = p_paid_at
    where id = p_reservation_id and status in ('reserved', 'confirmed');
    if target.intake_id is not null then
      update public.intakes set status = 'paid', updated_at = now() where id = target.intake_id;
    end if;
  elsif target.status not in ('paid', 'in_fulfillment', 'delivered') then
    raise exception 'order is not payable';
  end if;
  return jsonb_build_object(
    'id', target.id,
    'customer_id', target.customer_id,
    'intake_id', target.intake_id,
    'amount_cents', target.amount_cents,
    'product_kind', target.product_kind
  );
end;
$$;

revoke all on function public.complete_paid_checkout(uuid, text, text, integer, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.complete_paid_checkout(uuid, text, text, integer, timestamptz, timestamptz, uuid) to service_role;

create or replace function public.complete_apply_pack_cart(
  p_cart_id uuid,
  p_checkout_id text,
  p_payment_id text,
  p_amount_cents integer,
  p_paid_at timestamptz,
  p_deadline timestamptz,
  p_reservation_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  target public.apply_pack_carts%rowtype;
  reservation_state public.reservation_status;
  reservation_units integer;
  cart_item record;
  created_order_id uuid;
  actual_count integer;
begin
  select * into target from public.apply_pack_carts where id = p_cart_id for update;
  if not found then raise exception 'cart not found'; end if;
  if target.status = 'paid' then
    return jsonb_build_object('customer_id', target.customer_id, 'item_count', target.item_count, 'already_processed', true);
  end if;
  if target.status <> 'checkout_pending' then raise exception 'cart not payable'; end if;
  if target.stripe_checkout_session_id is distinct from p_checkout_id then raise exception 'checkout mismatch'; end if;
  if target.capacity_reservation_id is distinct from p_reservation_id then raise exception 'reservation mismatch'; end if;
  if target.total_cents <> p_amount_cents then raise exception 'amount mismatch'; end if;
  if not (target.selection_confirmed and target.submission_boundary_acknowledged and target.outcomes_acknowledged) then
    raise exception 'acknowledgements missing';
  end if;
  select status, units into reservation_state, reservation_units
    from public.capacity_reservations
    where id = p_reservation_id and customer_id = target.customer_id and kind = 'apply_pack'
    for update;
  if reservation_state <> 'reserved' or reservation_units <> target.item_count then
    raise exception 'capacity reservation not active';
  end if;
  select count(*) into actual_count from public.apply_pack_cart_items where cart_id = p_cart_id;
  if actual_count <> target.item_count then raise exception 'cart item count mismatch'; end if;

  update public.apply_pack_carts
    set status = 'paid', paid_at = p_paid_at, delivery_deadline = p_deadline, updated_at = now()
    where id = p_cart_id;
  update public.capacity_reservations
    set status = 'confirmed', confirmed_at = p_paid_at
    where id = p_reservation_id and status = 'reserved';
  insert into public.payments(apply_pack_cart_id, provider, provider_checkout_id, provider_payment_id, amount_cents, status, created_at)
    values (p_cart_id, 'stripe', p_checkout_id, p_payment_id, p_amount_cents, 'paid', p_paid_at);

  for cart_item in
    select * from public.apply_pack_cart_items where cart_id = p_cart_id order by created_at, id
  loop
    insert into public.orders(
      customer_id, parent_order_id, source_cart_id, product_kind, amount_cents, status,
      capacity_reservation_id, stripe_payment_intent_id, paid_at, delivery_deadline
    ) values (
      target.customer_id, target.search_order_id, p_cart_id, 'apply_pack', cart_item.unit_price_cents, 'paid',
      target.capacity_reservation_id, null, p_paid_at, p_deadline
    ) returning id into created_order_id;
    insert into public.apply_pack_items(
      order_id, job_match_id, emphasis_notes, do_not_mention_notes, customer_update_notes
    ) values (
      created_order_id, cart_item.job_match_id, cart_item.emphasis_notes,
      cart_item.do_not_mention_notes, target.customer_update_notes
    );
  end loop;

  insert into public.audit_logs(action, entity_type, entity_id, details)
    values ('apply_pack_cart_paid', 'apply_pack_cart', p_cart_id, jsonb_build_object('item_count', target.item_count));
  return jsonb_build_object('customer_id', target.customer_id, 'item_count', target.item_count, 'already_processed', false);
end;
$$;

revoke all on function public.complete_apply_pack_cart(uuid, text, text, integer, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.complete_apply_pack_cart(uuid, text, text, integer, timestamptz, timestamptz, uuid) to service_role;

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null unique,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_message text
);

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id),
  apply_pack_cart_id uuid references public.apply_pack_carts(id),
  recipient text not null,
  template text not null,
  status text not null,
  provider_message_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check ((order_id is not null)::integer + (apply_pack_cart_id is not null)::integer = 1)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id, email) values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('operator','admin')); $$;

create or replace function public.reserve_capacity(p_customer_id uuid, p_kind public.product_kind, p_units integer, p_request_key text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  limit_units integer;
  used_units integer;
  existing_id uuid;
  reservation_id uuid;
begin
  if p_customer_id is null or not exists(select 1 from public.profiles where id = p_customer_id) then raise exception 'customer required'; end if;
  if p_units < 1 then raise exception 'invalid units'; end if;
  select id into existing_id from public.capacity_reservations where request_key = p_request_key and customer_id = p_customer_id and status = 'reserved';
  if existing_id is not null then return existing_id; end if;
  perform pg_advisory_xact_lock(hashtext(p_kind::text));
  select units_per_24h into limit_units from public.capacity_limits where kind = p_kind and enabled = true;
  if limit_units is null then raise exception 'capacity disabled'; end if;
  select coalesce(sum(units),0) into used_units from public.capacity_reservations
    where kind = p_kind and ((status = 'reserved') or (status = 'confirmed' and confirmed_at > now() - interval '24 hours'));
  if used_units + p_units > limit_units then raise exception 'capacity unavailable'; end if;
  insert into public.capacity_reservations(kind, customer_id, units, request_key, expires_at)
    values (p_kind, p_customer_id, p_units, p_request_key, now() + interval '30 minutes')
    returning id into reservation_id;
  return reservation_id;
end;
$$;

revoke all on function public.reserve_capacity(uuid, public.product_kind, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_capacity(uuid, public.product_kind, integer, text) to service_role;
alter table public.profiles enable row level security;
alter table public.intakes enable row level security;
alter table public.criteria_versions enable row level security;
create or replace function public.consume_rate_limit(p_scope text, p_key_hash text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  current_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 then raise exception 'invalid rate limit'; end if;
  insert into public.api_rate_limits(scope, key_hash, window_started_at, request_count)
    values (p_scope, p_key_hash, now(), 1)
  on conflict (scope, key_hash) do update set
    request_count = case
      when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else public.api_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.api_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else public.api_rate_limits.window_started_at
    end
  returning request_count into current_count;
  return current_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;

alter table public.capacity_limits enable row level security;
alter table public.capacity_reservations enable row level security;
alter table public.orders enable row level security;
alter table public.payments enable row level security;
alter table public.apply_pack_carts enable row level security;
alter table public.apply_pack_cart_items enable row level security;
alter table public.intake_answers enable row level security;
alter table public.jobs enable row level security;
alter table public.job_matches enable row level security;
alter table public.apply_pack_items enable row level security;
alter table public.correction_requests enable row level security;
alter table public.conflict_reviews enable row level security;
create policy intake_answers_owner_select on public.intake_answers for select using (customer_id = auth.uid() or public.is_admin());
alter table public.refunds enable row level security;
alter table public.webhook_events enable row level security;
alter table public.email_events enable row level security;
alter table public.audit_logs enable row level security;

create policy profile_self_select on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy intake_owner_select on public.intakes for select using (customer_id = auth.uid() or public.is_admin());
create policy criteria_owner_select on public.criteria_versions for select using (exists(select 1 from public.intakes i where i.id = intake_id and (i.customer_id = auth.uid() or public.is_admin())));
create policy order_owner_select on public.orders for select using (customer_id = auth.uid() or public.is_admin());
create policy job_admin_all on public.jobs for all using (public.is_admin()) with check (public.is_admin());
create policy cart_owner_select on public.apply_pack_carts for select using (customer_id = auth.uid() or public.is_admin());
create policy cart_item_owner_select on public.apply_pack_cart_items for select using (exists(select 1 from public.apply_pack_carts c where c.id = cart_id and (c.customer_id = auth.uid() or public.is_admin())));
create policy job_owner_select on public.jobs for select using (exists(select 1 from public.job_matches m join public.orders o on o.id = m.search_order_id where m.job_id = jobs.id and o.status = 'delivered' and (o.customer_id = auth.uid() or public.is_admin())));
create policy match_owner_select on public.job_matches for select using (exists(select 1 from public.orders o where o.id = search_order_id and o.status = 'delivered' and (o.customer_id = auth.uid() or public.is_admin())));
create policy apply_item_owner_select on public.apply_pack_items for select using (exists(select 1 from public.orders o where o.id = order_id and o.status = 'delivered' and (o.customer_id = auth.uid() or public.is_admin())));
create policy correction_owner_select on public.correction_requests for select using (customer_id = auth.uid() or public.is_admin());
create policy conflict_owner_select on public.conflict_reviews for select using (customer_id = auth.uid() or public.is_admin());


insert into storage.buckets(id, name, public) values
  ('customer-source-documents', 'customer-source-documents', false),
  ('customer-deliveries', 'customer-deliveries', false)
on conflict (id) do nothing;

alter table public.api_rate_limits enable row level security;

revoke all on public.webhook_events, public.email_events, public.audit_logs from anon, authenticated;
revoke all on public.capacity_limits, public.capacity_reservations from anon;
revoke update, delete on public.intakes, public.orders from authenticated;

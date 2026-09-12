-- Paid filtered job board. Access is provider-event-derived and never granted by a return URL.

create table public.ap_board_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  plan_id text not null check (plan_id in ('weekly','monthly','three_months')),
  state text not null default 'PENDING' check (state in ('PENDING','ACTIVE','CANCEL_AT_PERIOD_END','PAST_DUE','EXPIRED','CANCELED','REFUNDED','DISPUTED')),
  provider_customer_id text not null,
  provider_subscription_id text not null unique,
  provider_checkout_session_id text unique,
  current_period_starts_at timestamptz,
  access_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  last_provider_event_created bigint not null default 0,
  last_provider_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ap_board_one_live_subscription_per_customer
  on public.ap_board_subscriptions(customer_id)
  where state in ('PENDING','ACTIVE','CANCEL_AT_PERIOD_END','PAST_DUE');

create table public.ap_board_admissions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  profile_snapshot_id uuid not null references public.ap_intake_snapshots(id),
  job_id uuid not null references public.jobs(id),
  decision text not null check (decision in ('ADMITTED','EXCLUDED')),
  capability_connection_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(capability_connection_codes) = 'array'),
  exclusion_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(exclusion_codes) = 'array'),
  warning_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(warning_codes) = 'array'),
  admission_version text not null default 'board-admission-v1',
  evaluated_at timestamptz not null default now(),
  unique(customer_id, profile_snapshot_id, job_id, admission_version)
);
create index ap_board_admissions_browse_idx on public.ap_board_admissions(customer_id, profile_snapshot_id, decision, evaluated_at desc);

create table public.ap_board_material_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  profile_snapshot_id uuid not null references public.ap_intake_snapshots(id),
  job_id uuid not null references public.jobs(id),
  state text not null default 'CHECKOUT_PENDING' check (state in ('CHECKOUT_PENDING','PAID','HUMAN_REVIEW','DELIVERED','REFUNDED','DISPUTED','CANCELED')),
  amount_cents integer not null default 800 check (amount_cents = 800),
  currency text not null default 'USD' check (currency = 'USD'),
  provider_checkout_session_id text unique,
  provider_payment_intent_id text unique,
  delivery_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, job_id)
);

create or replace function public.ap_board_has_access(p_customer_id uuid, p_now timestamptz default now())
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.ap_board_subscriptions subscription
    where subscription.customer_id = p_customer_id
      and subscription.state in ('ACTIVE','CANCEL_AT_PERIOD_END')
      and subscription.access_ends_at > p_now
  );
$$;
revoke all on function public.ap_board_has_access(uuid,timestamptz) from public;
grant execute on function public.ap_board_has_access(uuid,timestamptz) to authenticated, service_role;

alter table public.ap_board_subscriptions enable row level security;
alter table public.ap_board_admissions enable row level security;
alter table public.ap_board_material_orders enable row level security;

create policy ap_board_subscription_owner_select on public.ap_board_subscriptions
  for select to authenticated using (customer_id = auth.uid() or public.is_admin());
create policy ap_board_admission_owner_select on public.ap_board_admissions
  for select to authenticated using ((customer_id = auth.uid() and public.ap_board_has_access(auth.uid())) or public.is_admin());
create policy ap_board_material_order_owner_select on public.ap_board_material_orders
  for select to authenticated using (customer_id = auth.uid() or public.is_admin());

-- Mutations remain service-role-only. One-time orders deliberately survive subscription expiry.
grant select on public.ap_board_subscriptions, public.ap_board_admissions, public.ap_board_material_orders to authenticated;
grant all on public.ap_board_subscriptions, public.ap_board_admissions, public.ap_board_material_orders to service_role;

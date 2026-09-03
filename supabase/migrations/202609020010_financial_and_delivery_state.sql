alter table public.orders
  add column processing_previous_status public.order_status,
  add column processing_started_at timestamptz;

alter table public.refunds
  add column previous_order_status public.order_status,
  add column updated_at timestamptz not null default now(),
  add column last_error_code text;

create or replace function public.begin_order_refund(
  p_order_id uuid,
  p_actor_id uuid,
  p_reason_code text,
  p_customer_visible_reason text
)
returns table(refund_id uuid, payment_id uuid, provider_payment_id text, amount_cents integer)
language plpgsql security definer set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  payment_row public.payments%rowtype;
  refund_row public.refunds%rowtype;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id and role in ('operator','admin')) then
    raise exception 'authorized operator required';
  end if;
  if p_reason_code not in ('duplicate_or_incorrect_charge','unfinished_item_policy','missed_deadline') then
    raise exception 'unsupported refund reason';
  end if;
  if length(trim(coalesce(p_customer_visible_reason, ''))) < 10 then
    raise exception 'customer-visible reason required';
  end if;

  select * into order_row from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  select * into refund_row from public.refunds where order_id = p_order_id for update;
  if found then
    if refund_row.status in ('pending','requires_action') then
      select * into payment_row from public.payments where id = refund_row.payment_id;
      return query select refund_row.id, payment_row.id, payment_row.provider_payment_id, refund_row.amount_cents;
      return;
    end if;
    raise exception 'refund already resolved';
  end if;

  if order_row.status not in ('paid','in_fulfillment','delivered') then
    raise exception 'order is not refundable';
  end if;
  if order_row.status = 'delivered' and p_reason_code <> 'duplicate_or_incorrect_charge' then
    raise exception 'completed work is not refundable for this reason';
  end if;

  if order_row.source_cart_id is null then
    select * into payment_row from public.payments
      where order_id = p_order_id and status in ('paid','partially_refunded')
      order by created_at desc limit 1 for update;
  else
    select * into payment_row from public.payments
      where apply_pack_cart_id = order_row.source_cart_id and status in ('paid','partially_refunded')
      order by created_at desc limit 1 for update;
  end if;
  if not found then raise exception 'refundable payment not found'; end if;

  insert into public.refunds(
    payment_id, order_id, amount_cents, reason_code, customer_visible_reason,
    status, initiated_by, previous_order_status
  ) values (
    payment_row.id, order_row.id, order_row.amount_cents, p_reason_code,
    trim(p_customer_visible_reason), 'pending', p_actor_id, order_row.status
  ) returning * into refund_row;

  update public.orders
    set status = 'refund_pending', processing_previous_status = order_row.status,
        processing_started_at = now(), updated_at = now()
    where id = order_row.id;

  return query select refund_row.id, payment_row.id, payment_row.provider_payment_id, refund_row.amount_cents;
end;
$$;

create or replace function public.finalize_order_refund(
  p_refund_id uuid,
  p_provider_refund_id text,
  p_provider_status text,
  p_error_code text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  refund_row public.refunds%rowtype;
  successful_total bigint;
  payment_total integer;
  normalized_status text := lower(trim(coalesce(p_provider_status, '')));
begin
  if normalized_status not in ('pending','requires_action','succeeded','failed','canceled') then
    raise exception 'unsupported provider refund status';
  end if;
  select * into refund_row from public.refunds where id = p_refund_id for update;
  if not found then raise exception 'refund not found'; end if;
  if refund_row.provider_refund_id is not null
     and p_provider_refund_id is distinct from refund_row.provider_refund_id then
    raise exception 'provider refund mismatch';
  end if;

  update public.refunds set
    provider_refund_id = coalesce(provider_refund_id, p_provider_refund_id),
    status = normalized_status,
    completed_at = case when normalized_status in ('succeeded','failed','canceled') then now() else null end,
    last_error_code = nullif(p_error_code, ''),
    updated_at = now()
  where id = refund_row.id;

  if normalized_status = 'succeeded' then
    update public.orders set
      status = case when refund_row.previous_order_status = 'delivered' then 'delivered_refunded'::public.order_status else 'refunded'::public.order_status end,
      processing_previous_status = null, processing_started_at = null, updated_at = now()
    where id = refund_row.order_id and status = 'refund_pending';

    select coalesce(sum(amount_cents), 0) into successful_total
      from public.refunds where payment_id = refund_row.payment_id and status = 'succeeded';
    select amount_cents into payment_total from public.payments where id = refund_row.payment_id for update;
    update public.payments set status = case
      when successful_total >= payment_total then 'refunded'
      else 'partially_refunded'
    end where id = refund_row.payment_id;
  elsif normalized_status in ('failed','canceled') then
    update public.orders set
      status = coalesce(refund_row.previous_order_status, processing_previous_status, 'paid'::public.order_status),
      processing_previous_status = null, processing_started_at = null, updated_at = now()
    where id = refund_row.order_id and status = 'refund_pending';
  end if;
  return normalized_status;
end;
$$;

create or replace function public.finalize_order_refund_by_provider(
  p_provider_refund_id text,
  p_provider_status text,
  p_error_code text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  local_refund_id uuid;
begin
  select id into local_refund_id from public.refunds
    where provider_refund_id = p_provider_refund_id for update;
  if not found then raise exception 'provider refund not found'; end if;
  return public.finalize_order_refund(local_refund_id, p_provider_refund_id, p_provider_status, p_error_code);
end;
$$;

create or replace function public.claim_order_delivery(p_order_id uuid, p_kind public.product_kind)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  prior public.order_status;
begin
  select status into prior from public.orders
    where id = p_order_id and product_kind = p_kind for update;
  if not found or prior not in ('paid','in_fulfillment') then return false; end if;
  update public.orders set status = 'delivery_processing', processing_previous_status = prior,
    processing_started_at = now(), updated_at = now() where id = p_order_id;
  return true;
end;
$$;

create or replace function public.release_order_delivery(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update public.orders set status = coalesce(processing_previous_status, 'in_fulfillment'::public.order_status),
    processing_previous_status = null, processing_started_at = null, updated_at = now()
    where id = p_order_id and status = 'delivery_processing';
  return found;
end;
$$;

create or replace function public.complete_order_delivery(p_order_id uuid, p_delivered_at timestamptz)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update public.orders set status = 'delivered', delivered_at = p_delivered_at,
    processing_previous_status = null, processing_started_at = null, updated_at = now()
    where id = p_order_id and status = 'delivery_processing';
  return found;
end;
$$;

revoke all on function public.begin_order_refund(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finalize_order_refund(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.finalize_order_refund_by_provider(text, text, text) from public, anon, authenticated;
revoke all on function public.claim_order_delivery(uuid, public.product_kind) from public, anon, authenticated;
revoke all on function public.release_order_delivery(uuid) from public, anon, authenticated;
revoke all on function public.complete_order_delivery(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.begin_order_refund(uuid, uuid, text, text) to service_role;
grant execute on function public.finalize_order_refund(uuid, text, text, text) to service_role;
grant execute on function public.finalize_order_refund_by_provider(text, text, text) to service_role;
grant execute on function public.claim_order_delivery(uuid, public.product_kind) to service_role;
grant execute on function public.release_order_delivery(uuid) to service_role;
grant execute on function public.complete_order_delivery(uuid, timestamptz) to service_role;

create index if not exists orders_processing_idx on public.orders(status, processing_started_at)
  where status in ('delivery_processing','refund_pending');

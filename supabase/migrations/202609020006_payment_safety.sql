alter table public.webhook_events
  add column processing_status text not null default 'received' check (processing_status in ('received','processing','processed','failed')),
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column claimed_at timestamptz,
  add column last_error_code text;

update public.webhook_events
set processing_status = case when processed_at is null then 'failed' else 'processed' end;

create or replace function public.claim_stripe_webhook(p_provider_event_id text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  claimed_count integer;
begin
  update public.webhook_events
    set processing_status = 'processing',
        claimed_at = now(),
        attempt_count = attempt_count + 1,
        last_error_code = null
    where provider = 'stripe'
      and provider_event_id = p_provider_event_id
      and processed_at is null
      and (
        processing_status in ('received','failed')
        or (processing_status = 'processing' and claimed_at < now() - interval '10 minutes')
      );
  get diagnostics claimed_count = row_count;
  return claimed_count = 1;
end;
$$;

revoke all on function public.claim_stripe_webhook(text) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook(text) to service_role;

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
  perform pg_advisory_xact_lock(hashtext(p_kind::text));
  update public.capacity_reservations set status = 'expired'
    where kind = p_kind and status = 'reserved' and expires_at <= now();
  select id into existing_id from public.capacity_reservations
    where request_key = p_request_key and customer_id = p_customer_id and status = 'reserved' and expires_at > now();
  if existing_id is not null then return existing_id; end if;
  select units_per_24h into limit_units from public.capacity_limits where kind = p_kind and enabled = true;
  if limit_units is null then raise exception 'capacity disabled'; end if;
  select coalesce(sum(units),0) into used_units from public.capacity_reservations
    where kind = p_kind and (
      (status = 'reserved' and expires_at > now())
      or (status = 'confirmed' and confirmed_at > now() - interval '24 hours')
    );
  if used_units + p_units > limit_units then raise exception 'capacity unavailable'; end if;
  insert into public.capacity_reservations(kind, customer_id, units, request_key, expires_at)
    values (p_kind, p_customer_id, p_units, p_request_key, now() + interval '30 minutes')
    returning id into reservation_id;
  return reservation_id;
end;
$$;

revoke all on function public.reserve_capacity(uuid, public.product_kind, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_capacity(uuid, public.product_kind, integer, text) to service_role;

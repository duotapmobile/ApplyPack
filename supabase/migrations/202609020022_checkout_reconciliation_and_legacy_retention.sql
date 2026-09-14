-- Never release capacity for a checkout that Stripe may already have paid.
-- Linked checkout state is released only by a verified provider event; this
-- maintenance function expires local drafts that never obtained a session.
create or replace function public.expire_abandoned_checkout_state(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_cart_count integer := 0;
  expired_reservation_count integer := 0;
begin
  update public.apply_pack_carts
    set status = 'expired', updated_at = p_now
    where status = 'checkout_pending'
      and stripe_checkout_session_id is null
      and expires_at < p_now - interval '2 hours';
  get diagnostics expired_cart_count = row_count;

  update public.capacity_reservations reservation
    set status = 'expired'
    where reservation.status = 'reserved'
      and reservation.expires_at < p_now
      and not exists(
        select 1 from public.orders order_row
        where order_row.capacity_reservation_id = reservation.id
          and order_row.status = 'pending_payment'
          and order_row.stripe_checkout_session_id is not null
      )
      and not exists(
        select 1 from public.apply_pack_carts cart
        where cart.capacity_reservation_id = reservation.id
          and cart.status = 'checkout_pending'
          and cart.stripe_checkout_session_id is not null
      );
  get diagnostics expired_reservation_count = row_count;

  return jsonb_build_object(
    'expiredCarts', expired_cart_count,
    'expiredReservations', expired_reservation_count
  );
end;
$$;

revoke all on function public.expire_abandoned_checkout_state(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_abandoned_checkout_state(timestamptz) to service_role;

-- Validate that every legacy intake path and every source-document row was
-- included in a successful storage deletion before marking retention complete.
create or replace function public.finalize_intake_source_retention(
  p_intake_id uuid,
  p_document_count integer,
  p_deleted_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_document_count integer;
begin
  select count(distinct path) into expected_document_count
  from (
    select intake.resume_path as path from public.intakes intake where intake.id = p_intake_id
    union all
    select intake.cover_letter_path as path from public.intakes intake where intake.id = p_intake_id
    union all
    select document.storage_path as path from public.source_documents document
      where document.intake_id = p_intake_id and document.deleted_at is null
  ) paths
  where path is not null and length(trim(path)) > 0;

  if not exists(select 1 from public.intakes where id = p_intake_id and source_deleted_at is null) then
    return false;
  end if;
  if p_document_count is distinct from expected_document_count then
    raise exception 'source retention document count mismatch';
  end if;

  update public.source_documents
    set deleted_at = p_deleted_at, updated_at = p_deleted_at
    where intake_id = p_intake_id and deleted_at is null;
  update public.intakes
    set source_deleted_at = p_deleted_at, updated_at = p_deleted_at
    where id = p_intake_id and source_deleted_at is null;
  if not found then return false; end if;
  insert into public.audit_logs(action, entity_type, entity_id, details)
    values ('source_documents_deleted', 'intake', p_intake_id::text,
      jsonb_build_object('document_count', expected_document_count));
  return true;
end;
$$;

revoke all on function public.finalize_intake_source_retention(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_intake_source_retention(uuid, integer, timestamptz) to service_role;

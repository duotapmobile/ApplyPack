-- A provider-linked checkout remains authoritative until a verified Stripe
-- completion or expiration event reconciles it. Customer retries must never
-- expire or replace state that a late paid webhook may still complete.
create or replace function public.prepare_search_checkout(p_customer_id uuid, p_intake_id uuid)
returns table(order_id uuid, reservation_id uuid, created boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  existing_order public.orders%rowtype;
  new_reservation uuid;
begin
  perform pg_advisory_xact_lock(hashtext('search:' || p_intake_id::text));
  if not exists(
    select 1 from public.intakes
    where id = p_intake_id and customer_id = p_customer_id
      and status = 'ready_for_payment' and source_scan_status = 'clean'
  ) then raise exception 'intake not ready'; end if;

  select * into existing_order from public.orders
    where intake_id = p_intake_id and product_kind = 'job_search'
      and status not in ('payment_expired','cancelled','refunded')
    order by created_at desc limit 1 for update;
  if found then
    if existing_order.status = 'pending_payment' and existing_order.checkout_expires_at > now() then
      return query select existing_order.id, existing_order.capacity_reservation_id, false;
      return;
    end if;
    if existing_order.status = 'pending_payment'
      and existing_order.stripe_checkout_session_id is not null
    then
      raise exception 'checkout reconciliation pending';
    end if;
    if existing_order.status = 'pending_payment' and existing_order.checkout_expires_at > now() - interval '2 hours' then
      raise exception 'checkout reconciliation pending';
    end if;
    if existing_order.status = 'pending_payment' then
      update public.orders set status = 'payment_expired', updated_at = now() where id = existing_order.id;
      update public.capacity_reservations set status = 'expired'
        where id = existing_order.capacity_reservation_id and status = 'reserved';
    else
      raise exception 'search already purchased';
    end if;
  end if;

  new_reservation := public.reserve_capacity(p_customer_id, 'job_search', 1, 'search:' || p_intake_id::text);
  insert into public.orders(
    customer_id, intake_id, product_kind, amount_cents, status,
    capacity_reservation_id, checkout_expires_at
  ) values (
    p_customer_id, p_intake_id, 'job_search', 2000, 'pending_payment',
    new_reservation, now() + interval '30 minutes'
  ) returning id into order_id;
  reservation_id := new_reservation;
  created := true;
  return next;
end;
$$;

create or replace function public.prepare_apply_pack_checkout(
  p_customer_id uuid,
  p_search_order_id uuid,
  p_job_match_ids uuid[],
  p_customer_update_notes text,
  p_item_notes jsonb
)
returns table(cart_id uuid, reservation_id uuid, created boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  match_id uuid;
  match_count integer;
  existing_cart public.apply_pack_carts%rowtype;
  new_reservation uuid;
  item_note jsonb;
begin
  match_count := coalesce(cardinality(p_job_match_ids), 0);
  if match_count < 1 or match_count > 10 then raise exception 'invalid item count'; end if;
  if (select count(distinct value) from unnest(p_job_match_ids) as value) <> match_count then raise exception 'duplicate jobs'; end if;
  if not exists(
    select 1 from public.orders where id = p_search_order_id and customer_id = p_customer_id
      and product_kind = 'job_search'
      and (
        status in ('delivered','delivered_refunded')
        or (status = 'refund_pending' and processing_previous_status = 'delivered')
      )
  ) then raise exception 'search not delivered'; end if;
  if (select count(*) from public.job_matches where id = any(p_job_match_ids) and search_order_id = p_search_order_id) <> match_count then
    raise exception 'job mismatch';
  end if;
  if exists(
    select 1
    from public.job_matches match
    join public.jobs job on job.id = match.job_id
    where match.id = any(p_job_match_ids)
      and (
        job.is_active is not true
        or job.listing_status <> 'open'
        or job.review_status <> 'approved'
        or job.rejection_reason is not null
        or job.checked_at < now() - interval '24 hours'
        or regexp_replace(lower(concat_ws(' ', job.company, job.employer_display_name, job.source_name, job.source_url, job.source_job_url, job.official_application_url)), '[^a-z0-9]+', '', 'g') like '%liveops%'
      )
  ) then raise exception 'job is not eligible for purchase'; end if;

  for match_id in select value from unnest(p_job_match_ids) as value order by value loop
    perform pg_advisory_xact_lock(hashtext('apply-pack:' || match_id::text));
  end loop;

  update public.apply_pack_carts
    set status = 'expired', updated_at = now()
    where status = 'checkout_pending'
      and stripe_checkout_session_id is null
      and expires_at <= now() - interval '2 hours';

  update public.capacity_reservations reservation
    set status = 'expired'
    where reservation.status = 'reserved'
      and reservation.expires_at <= now()
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

  update public.job_matches match
    set apply_pack_cart_id = null, apply_pack_claim_expires_at = null
    where match.id = any(p_job_match_ids)
      and match.apply_pack_claim_expires_at <= now()
      and (
        match.apply_pack_cart_id is null
        or not exists(
          select 1 from public.apply_pack_carts cart
          where cart.id = match.apply_pack_cart_id
            and cart.status = 'checkout_pending'
            and cart.stripe_checkout_session_id is not null
        )
      );

  if exists(select 1 from public.apply_pack_items where job_match_id = any(p_job_match_ids)) then
    raise exception 'apply pack already purchased';
  end if;

  select cart.* into existing_cart
  from public.apply_pack_carts cart
  where cart.id = (
      select apply_pack_cart_id from public.job_matches
      where id = any(p_job_match_ids) and apply_pack_cart_id is not null
      limit 1
    )
    and cart.customer_id = p_customer_id
    and cart.status = 'checkout_pending'
    and (cart.expires_at > now() or cart.stripe_checkout_session_id is not null)
  for update;

  if found then
    if exists(
      (select value from unnest(p_job_match_ids) as value
       except select job_match_id from public.apply_pack_cart_items where apply_pack_cart_items.cart_id = existing_cart.id)
      union all
      (select job_match_id from public.apply_pack_cart_items where apply_pack_cart_items.cart_id = existing_cart.id
       except select value from unnest(p_job_match_ids) as value)
    ) then
      raise exception 'job checkout already active';
    end if;
    if existing_cart.stripe_checkout_session_id is not null and existing_cart.expires_at <= now() then
      raise exception 'checkout reconciliation pending';
    end if;
    return query select existing_cart.id, existing_cart.capacity_reservation_id, false;
    return;
  end if;

  if exists(
    select 1 from public.job_matches
    where id = any(p_job_match_ids) and apply_pack_cart_id is not null
  ) then
    raise exception 'job checkout already active';
  end if;

  new_reservation := public.reserve_capacity(
    p_customer_id, 'apply_pack', match_count,
    'apply-pack:' || md5(p_customer_id::text || ':' || array_to_string(p_job_match_ids, ','))
  );
  insert into public.apply_pack_carts(
    customer_id, search_order_id, status, item_count, total_cents,
    capacity_reservation_id, customer_update_notes, selection_confirmed,
    submission_boundary_acknowledged, outcomes_acknowledged, expires_at
  ) values (
    p_customer_id, p_search_order_id, 'checkout_pending', match_count, match_count * 800,
    new_reservation, nullif(p_customer_update_notes, ''), true, true, true, now() + interval '30 minutes'
  ) returning id into cart_id;
  reservation_id := new_reservation;
  created := true;

  for item_note in select value from jsonb_array_elements(coalesce(p_item_notes, '[]'::jsonb)) loop
    match_id := (item_note ->> 'jobMatchId')::uuid;
    if not (match_id = any(p_job_match_ids)) then raise exception 'unexpected item note'; end if;
    insert into public.apply_pack_cart_items(cart_id, job_match_id, emphasis_notes, do_not_mention_notes)
      values (cart_id, match_id, nullif(item_note ->> 'emphasisNotes', ''), nullif(item_note ->> 'doNotMentionNotes', ''));
  end loop;
  if (select count(*) from public.apply_pack_cart_items where apply_pack_cart_items.cart_id = prepare_apply_pack_checkout.cart_id) <> match_count then
    raise exception 'item notes incomplete';
  end if;
  update public.job_matches set apply_pack_cart_id = cart_id, apply_pack_claim_expires_at = now() + interval '2 hours 30 minutes'
    where id = any(p_job_match_ids);
  return next;
end;
$$;

revoke all on function public.prepare_search_checkout(uuid, uuid) from public, anon, authenticated;
revoke all on function public.prepare_apply_pack_checkout(uuid, uuid, uuid[], text, jsonb) from public, anon, authenticated;
grant execute on function public.prepare_search_checkout(uuid, uuid) to service_role;
grant execute on function public.prepare_apply_pack_checkout(uuid, uuid, uuid[], text, jsonb) to service_role;

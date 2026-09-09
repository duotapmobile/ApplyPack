-- Keep the API's supported one-to-ten Apply Pack selection aligned with the
-- database, and preserve customer access after the narrow duplicate-charge
-- refund exception, including while that refund is pending.
alter table public.apply_pack_carts
  drop constraint if exists apply_pack_carts_item_count_check;

alter table public.apply_pack_carts
  add constraint apply_pack_carts_item_count_check
  check (item_count between 1 and 10) not valid;

alter table public.apply_pack_carts
  validate constraint apply_pack_carts_item_count_check;

create or replace function public.customer_can_view_delivered_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.jobs job
    join public.job_matches match on match.job_id = job.id
    join public.orders order_row on order_row.id = match.search_order_id
    where job.id = p_job_id
      and job.rejection_reason is distinct from 'hard_exclusion'
      and regexp_replace(lower(concat_ws(' ', job.company, job.employer_display_name, job.source_name, job.source_url, job.source_job_url, job.official_application_url)), '[^a-z0-9]+', '', 'g') not like '%liveops%'
      and (
        order_row.status in ('delivered','delivered_refunded')
        or (order_row.status = 'refund_pending' and order_row.processing_previous_status = 'delivered')
      )
      and order_row.customer_id = auth.uid()
  );
$$;

revoke all on function public.customer_can_view_delivered_job(uuid) from public, anon;
grant execute on function public.customer_can_view_delivered_job(uuid) to authenticated, service_role;

drop policy if exists job_owner_select on public.jobs;
create policy job_owner_select on public.jobs for select to authenticated using (
  public.is_admin()
  or public.customer_can_view_delivered_job(id)
);

drop policy if exists match_owner_select on public.job_matches;
create policy match_owner_select on public.job_matches for select to authenticated using (
  public.is_admin()
  or (
    exists(
      select 1 from public.orders order_row
      where order_row.id = search_order_id
        and (
          order_row.status in ('delivered','delivered_refunded')
          or (order_row.status = 'refund_pending' and order_row.processing_previous_status = 'delivered')
        )
        and order_row.customer_id = auth.uid()
    )
    and public.customer_can_view_delivered_job(job_id)
  )
);

drop policy if exists source_references_owner_select on public.job_source_references;
create policy source_references_owner_select on public.job_source_references for select to authenticated using (
  public.is_admin()
  or public.customer_can_view_delivered_job(job_id)
);

drop policy if exists apply_item_owner_select on public.apply_pack_items;
create policy apply_item_owner_select on public.apply_pack_items for select to authenticated using (
  exists(
    select 1 from public.orders order_row
    where order_row.id = order_id
      and (
        order_row.status in ('delivered','delivered_refunded')
        or (order_row.status = 'refund_pending' and order_row.processing_previous_status = 'delivered')
      )
      and (order_row.customer_id = auth.uid() or public.is_admin())
  )
);

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
  update public.apply_pack_carts set status = 'expired', updated_at = now()
    where status = 'checkout_pending' and expires_at <= now() - interval '2 hours';
  update public.capacity_reservations reservation set status = 'expired'
    where reservation.status = 'reserved' and reservation.expires_at <= now();
  update public.job_matches set apply_pack_cart_id = null, apply_pack_claim_expires_at = null
    where id = any(p_job_match_ids) and apply_pack_claim_expires_at <= now();

  if exists(select 1 from public.apply_pack_items where job_match_id = any(p_job_match_ids)) then
    raise exception 'apply pack already purchased';
  end if;
  if exists(
    select 1 from public.job_matches where id = any(p_job_match_ids)
      and apply_pack_cart_id is not null and apply_pack_claim_expires_at > now()
  ) then
    select cart.* into existing_cart from public.apply_pack_carts cart
      where cart.id = (select apply_pack_cart_id from public.job_matches
        where id = any(p_job_match_ids) and apply_pack_cart_id is not null limit 1)
        and cart.customer_id = p_customer_id and cart.status = 'checkout_pending' and cart.expires_at > now();
    if found and not exists(
      (select value from unnest(p_job_match_ids) as value
       except select job_match_id from public.apply_pack_cart_items where apply_pack_cart_items.cart_id = existing_cart.id)
      union all
      (select job_match_id from public.apply_pack_cart_items where apply_pack_cart_items.cart_id = existing_cart.id
       except select value from unnest(p_job_match_ids) as value)
    ) then
      return query select existing_cart.id, existing_cart.capacity_reservation_id, false;
      return;
    end if;
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

revoke all on function public.prepare_apply_pack_checkout(uuid, uuid, uuid[], text, jsonb) from public, anon, authenticated;
grant execute on function public.prepare_apply_pack_checkout(uuid, uuid, uuid[], text, jsonb) to service_role;

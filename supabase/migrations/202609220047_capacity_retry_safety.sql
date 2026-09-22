-- Serialize first-use request-key replay with capacity allocation.
-- Preserve capacity policy, ownership and exact member identity on every replay.
begin;
create or replace function public.ap_reserve_capacity(
  p_customer_id uuid, p_resource public.ap_capacity_resource, p_units integer, p_request_key text,
  p_expires_at timestamptz, p_members jsonb default '[]'::jsonb, p_draft_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare pool_row public.ap_capacity_pools; bucket_row public.ap_capacity_buckets; existing public.ap_capacity_allocations;
  new_allocation_id uuid; member jsonb;
begin
  if p_units is null or p_units < 1 or p_expires_at is null or p_expires_at <= clock_timestamp()
    or jsonb_typeof(p_members) is distinct from 'array' or (p_customer_id is null and p_draft_id is null)
    or nullif(btrim(p_request_key),'') is null then raise exception 'invalid_capacity_request'; end if;
  select * into existing from public.ap_capacity_allocations where request_key=p_request_key;
  if found then
    if existing.customer_id is distinct from p_customer_id or existing.draft_id is distinct from p_draft_id
      or existing.units<>p_units
      or not exists(select 1 from public.ap_capacity_buckets bucket join public.ap_capacity_pools pool
        on pool.id=bucket.pool_id where bucket.id=existing.bucket_id and pool.resource=p_resource)
      or exists(
        (select material_line_id,revision_id,units from public.ap_capacity_allocation_members where allocation_id=existing.id
         except all select nullif(value->>'materialLineId','')::uuid,nullif(value->>'revisionId','')::uuid,
          coalesce((value->>'units')::integer,1) from jsonb_array_elements(p_members))
        union all
        (select nullif(value->>'materialLineId','')::uuid,nullif(value->>'revisionId','')::uuid,
          coalesce((value->>'units')::integer,1) from jsonb_array_elements(p_members)
         except all select material_line_id,revision_id,units from public.ap_capacity_allocation_members where allocation_id=existing.id)
      ) then raise exception 'capacity_idempotency_conflict'; end if;
    return existing.id;
  end if;
  select * into pool_row from public.ap_capacity_pools where resource=p_resource and enabled for update;
  if not found then raise exception 'capacity_unconfigured'; end if;
  -- A concurrent first request may have committed while this transaction waited.
  select * into existing from public.ap_capacity_allocations where request_key=p_request_key;
  if found then
    if existing.customer_id is distinct from p_customer_id or existing.draft_id is distinct from p_draft_id
      or existing.units<>p_units
      or not exists(select 1 from public.ap_capacity_buckets bucket join public.ap_capacity_pools pool
        on pool.id=bucket.pool_id where bucket.id=existing.bucket_id and pool.resource=p_resource)
      or exists(
        (select material_line_id,revision_id,units from public.ap_capacity_allocation_members where allocation_id=existing.id
         except all select nullif(value->>'materialLineId','')::uuid,nullif(value->>'revisionId','')::uuid,
          coalesce((value->>'units')::integer,1) from jsonb_array_elements(p_members))
        union all
        (select nullif(value->>'materialLineId','')::uuid,nullif(value->>'revisionId','')::uuid,
          coalesce((value->>'units')::integer,1) from jsonb_array_elements(p_members)
         except all select material_line_id,revision_id,units from public.ap_capacity_allocation_members where allocation_id=existing.id)
      ) then raise exception 'capacity_idempotency_conflict'; end if;
    return existing.id;
  end if;

  select b.* into bucket_row from public.ap_capacity_buckets b
  where b.pool_id=pool_row.id and b.starts_at<=clock_timestamp() and b.ends_at>=p_expires_at
    and b.total_units - coalesce((select sum(a.units) from public.ap_capacity_allocations a
      where a.bucket_id=b.id and a.debit_disposition in ('HELD','SPENT')),0) >= p_units
  order by b.ends_at,b.id for update limit 1;
  if not found then raise exception 'capacity_unavailable'; end if;
  insert into public.ap_capacity_allocations(bucket_id,customer_id,draft_id,units,lifecycle,debit_disposition,
    request_key,staffing_version,reserved_at,expires_at,audit_version)
  values(bucket_row.id,p_customer_id,p_draft_id,p_units,'RESERVED','HELD',p_request_key,bucket_row.staffing_version,
    clock_timestamp(),p_expires_at,'chunk4-v1') returning id into new_allocation_id;
  for member in select value from jsonb_array_elements(p_members) loop
    insert into public.ap_capacity_allocation_members(allocation_id,material_line_id,revision_id,units)
    values(new_allocation_id,nullif(member->>'materialLineId','')::uuid,nullif(member->>'revisionId','')::uuid,
      coalesce((member->>'units')::integer,1));
  end loop;
  if (select coalesce(sum(units),0) from public.ap_capacity_allocation_members where allocation_id=new_allocation_id) not in (0,p_units)
    then raise exception 'capacity_member_units_mismatch'; end if;
  if p_resource='MATERIALS' and (jsonb_array_length(p_members)=0
    or exists(select 1 from public.ap_capacity_allocation_members where allocation_id=new_allocation_id and material_line_id is null)
    or (select coalesce(sum(units),0) from public.ap_capacity_allocation_members where allocation_id=new_allocation_id)<>p_units)
    then raise exception 'materials_capacity_requires_complete_line_members'; end if;
  insert into public.ap_capacity_audit(allocation_id,to_lifecycle,to_debit,reason_code)
    values(new_allocation_id,'RESERVED','HELD','RESERVED');
  return new_allocation_id;
end;
$$;
commit;

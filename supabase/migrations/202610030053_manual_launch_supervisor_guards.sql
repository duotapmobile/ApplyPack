-- Supervisor hardening for the October 2 manual launch.
-- Forward-only: published migrations and historical commerce records remain immutable.

begin;

create table public.ap_manual_launch_activations (
  id uuid primary key default gen_random_uuid(),
  release_sha text not null check (release_sha ~ '^[0-9a-f]{40}$'),
  health_evidence_reference text not null check (length(btrim(health_evidence_reference)) between 12 and 500),
  database_evidence_reference text not null check (length(btrim(database_evidence_reference)) between 12 and 500),
  payment_evidence_reference text not null check (length(btrim(payment_evidence_reference)) between 12 and 500),
  email_evidence_reference text not null check (length(btrim(email_evidence_reference)) between 12 and 500),
  kms_evidence_reference text not null check (length(btrim(kms_evidence_reference)) between 12 and 500),
  worker_evidence_reference text not null check (length(btrim(worker_evidence_reference)) between 12 and 500),
  maintenance_evidence_reference text not null check (length(btrim(maintenance_evidence_reference)) between 12 and 500),
  backup_restore_evidence_reference text not null check (length(btrim(backup_restore_evidence_reference)) between 12 and 500),
  inventory_evidence_reference text not null check (length(btrim(inventory_evidence_reference)) between 12 and 500),
  accessibility_evidence_reference text not null check (length(btrim(accessibility_evidence_reference)) between 12 and 500),
  product_supervisor_reference text not null check (length(btrim(product_supervisor_reference)) between 12 and 500),
  security_supervisor_reference text not null check (length(btrim(security_supervisor_reference)) between 12 and 500),
  operations_supervisor_reference text not null check (length(btrim(operations_supervisor_reference)) between 12 and 500),
  tenth_man_supervisor_reference text not null check (length(btrim(tenth_man_supervisor_reference)) between 12 and 500),
  accepted_p2_disposition_reference text not null check (length(btrim(accepted_p2_disposition_reference)) between 12 and 500),
  unresolved_p0_count integer not null check (unresolved_p0_count = 0),
  unresolved_p1_count integer not null check (unresolved_p1_count = 0),
  canary_reconciliation_reference text not null check (length(btrim(canary_reconciliation_reference)) between 12 and 500),
  canary_reconciled_amount_cents integer not null check (canary_reconciled_amount_cents = 2698),
  tax_approval_reference text not null check (length(btrim(tax_approval_reference)) between 12 and 500),
  worker_network_attestation_sha256 text not null check (worker_network_attestation_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_bundle_sha256 text not null check (evidence_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(release_sha,evidence_bundle_sha256)
);
alter table public.ap_manual_launch_activations enable row level security;
revoke all on public.ap_manual_launch_activations from public,anon,authenticated,service_role;
grant select,insert on public.ap_manual_launch_activations to service_role;

create or replace function public.ap_manual_launch_activation_is_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'manual_launch_activation_is_immutable';
end;
$$;
create trigger ap_manual_launch_activation_immutable
before update or delete on public.ap_manual_launch_activations
for each row execute function public.ap_manual_launch_activation_is_immutable();

alter table public.ap_commerce_configuration drop column checkout_enabled;
alter table public.ap_commerce_configuration
  add column launch_activation_id uuid references public.ap_manual_launch_activations(id),
  add column launch_release_sha text check (launch_release_sha is null or launch_release_sha ~ '^[0-9a-f]{40}$'),
  add column document_worker_network_attestation_sha256 text
    check (document_worker_network_attestation_sha256 is null or document_worker_network_attestation_sha256 ~ '^[0-9a-f]{64}$'),
  add column checkout_enabled boolean generated always as (
    tax_configuration_approved
    and tax_approval_reference is not null
    and sales_activation_approved
    and sales_activation_reference is not null
    and launch_product_scope = 'MANUAL_ONLY'
    and launch_activation_id is not null
    and launch_release_sha is not null
    and document_worker_network_attestation_sha256 is not null
    and sales_activation_reference = 'manual-launch-activation:' || launch_activation_id::text
  ) stored;

update public.ap_commerce_configuration set
  sales_activation_approved=false,
  sales_activation_reference=null,
  launch_activation_id=null,
  launch_release_sha=null,
  document_worker_network_attestation_sha256=null
where singleton;

create or replace function public.ap_manual_launch_capacity_readiness()
returns jsonb language sql stable security definer set search_path='' as $$
  with required(resource,maximum) as (values
    ('SEARCH'::public.ap_capacity_resource,1),
    ('MATERIALS'::public.ap_capacity_resource,2)
  ), status as (
    select required.resource,required.maximum,pool.id as pool_id,pool.enabled,
      count(bucket.id) filter(where bucket.starts_at<=clock_timestamp() and bucket.ends_at>clock_timestamp()) as current_buckets,
      coalesce((select sum(allocation.units) from public.ap_capacity_allocations allocation
        join public.ap_capacity_buckets used_bucket on used_bucket.id=allocation.bucket_id
        where used_bucket.pool_id=pool.id and allocation.debit_disposition in ('HELD','SPENT')
          and ((required.resource='SEARCH' and (allocation.request_key like 'search-invitation:%'
            or allocation.request_key like 'search-checkout:%' or allocation.request_key like 'search-reacquire:%'))
            or (required.resource='MATERIALS' and allocation.request_key like 'materials-checkout:%'))
          and coalesce(allocation.consumed_at,allocation.reserved_at,allocation.created_at)>clock_timestamp()-interval '24 hours'),0) as rolling_units
    from required left join public.ap_capacity_pools pool on pool.resource=required.resource
      left join public.ap_capacity_buckets bucket on bucket.pool_id=pool.id
    group by required.resource,required.maximum,pool.id,pool.enabled
  ) select jsonb_build_object(
    'ready',coalesce(bool_and(pool_id is not null and enabled and current_buckets=1 and rolling_units<=maximum),false),
    'resources',jsonb_agg(jsonb_build_object('resource',resource,'maximum',maximum,'enabled',coalesce(enabled,false),
      'currentBuckets',current_buckets,'rollingUnits',rolling_units) order by resource)
  ) from status;
$$;
revoke all on function public.ap_manual_launch_capacity_readiness() from public,anon,authenticated;
grant execute on function public.ap_manual_launch_capacity_readiness() to service_role;

create or replace function public.ap_reserve_capacity(
  p_customer_id uuid, p_resource public.ap_capacity_resource, p_units integer, p_request_key text,
  p_expires_at timestamptz, p_members jsonb default '[]'::jsonb, p_draft_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare pool_row public.ap_capacity_pools; bucket_row public.ap_capacity_buckets; existing public.ap_capacity_allocations;
  new_allocation_id uuid; member jsonb; maximum integer; rolling_units integer; sale_admission boolean;
begin
  if p_units is null or p_units < 1 or p_expires_at is null or p_expires_at <= clock_timestamp()
    or jsonb_typeof(p_members) is distinct from 'array' or (p_customer_id is null and p_draft_id is null)
    or nullif(btrim(p_request_key),'') is null then raise exception 'invalid_capacity_request'; end if;
  sale_admission:=(p_resource='SEARCH' and (p_request_key like 'search-invitation:%'
      or p_request_key like 'search-checkout:%' or p_request_key like 'search-reacquire:%'))
    or (p_resource='MATERIALS' and p_request_key like 'materials-checkout:%');
  maximum:=case when sale_admission and p_resource='SEARCH' then 1
    when sale_admission and p_resource='MATERIALS' then 2 else null end;
  if maximum is not null and p_units>maximum then raise exception 'manual_launch_capacity_request_exceeds_limit'; end if;
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
  if maximum is not null then
    select coalesce(sum(allocation.units),0) into rolling_units
    from public.ap_capacity_allocations allocation
      join public.ap_capacity_buckets used_bucket on used_bucket.id=allocation.bucket_id
    where used_bucket.pool_id=pool_row.id and allocation.debit_disposition in ('HELD','SPENT')
      and ((p_resource='SEARCH' and (allocation.request_key like 'search-invitation:%'
        or allocation.request_key like 'search-checkout:%' or allocation.request_key like 'search-reacquire:%'))
        or (p_resource='MATERIALS' and allocation.request_key like 'materials-checkout:%'))
      and coalesce(allocation.consumed_at,allocation.reserved_at,allocation.created_at)>clock_timestamp()-interval '24 hours';
    if rolling_units+p_units>maximum then raise exception 'manual_launch_rolling_capacity_unavailable'; end if;
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
    clock_timestamp(),p_expires_at,'manual-launch-v2') returning id into new_allocation_id;
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
revoke all on function public.ap_reserve_capacity(uuid,public.ap_capacity_resource,integer,text,timestamptz,jsonb,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.ap_record_search_refund_result_verified(
  p_refund_id uuid,p_provider_refund_id text,p_provider_status text,
  p_provider_payment_id text,p_amount_cents integer,p_currency text,p_metadata_refund_id uuid,
  p_provider_event_id text default null,p_error_code text default null,p_payload_sha256 text default null,
  p_signature_verified_at timestamptz default null,p_event_type text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare refund_row public.ap_refund_operations; payment_row public.ap_payment_attempts;
begin
  select * into refund_row from public.ap_refund_operations where id=p_refund_id for update;
  if not found then raise exception 'refund_operation_not_found'; end if;
  select * into payment_row from public.ap_payment_attempts where id=refund_row.payment_attempt_id for update;
  if not found or nullif(btrim(payment_row.provider_payment_id),'') is null then
    raise exception 'refund_original_payment_missing';
  end if;
  if p_metadata_refund_id is distinct from refund_row.id
    or p_provider_payment_id is distinct from payment_row.provider_payment_id
    or p_amount_cents is distinct from refund_row.amount_cents
    or upper(coalesce(p_currency,'')) is distinct from refund_row.currency then
    raise exception 'refund_provider_semantics_mismatch';
  end if;
  return public.ap_record_search_refund_result(
    p_refund_id,p_provider_refund_id,p_provider_status,p_provider_event_id,p_error_code,
    p_payload_sha256,p_signature_verified_at,p_event_type
  );
end;
$$;
revoke all on function public.ap_record_search_refund_result(uuid,text,text,text,text,text,timestamptz,text)
  from public,anon,authenticated,service_role;
revoke all on function public.ap_record_search_refund_result_verified(uuid,text,text,text,integer,text,uuid,text,text,text,timestamptz,text)
  from public,anon,authenticated;
grant execute on function public.ap_record_search_refund_result_verified(uuid,text,text,text,integer,text,uuid,text,text,text,timestamptz,text)
  to service_role;

create or replace function public.ap_retire_board_subscription_state()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.state in ('PENDING','ACTIVE','CANCEL_AT_PERIOD_END','PAST_DUE') then
    new.state:='CANCELED';
    new.access_ends_at:=null;
  end if;
  return new;
end;
$$;
create trigger ap_retire_board_subscription_state
before insert or update of state,access_ends_at on public.ap_board_subscriptions
for each row execute function public.ap_retire_board_subscription_state();
update public.ap_board_subscriptions set state='CANCELED',access_ends_at=null,updated_at=clock_timestamp()
where state in ('PENDING','ACTIVE','CANCEL_AT_PERIOD_END','PAST_DUE');

commit;

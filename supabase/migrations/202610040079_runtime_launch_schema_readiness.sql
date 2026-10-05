begin;

-- Wait for every pre-cutover inventory writer to finish. The lock conflicts
-- with inserts into ap_inventory_members and remains held through commit, so
-- the subsequent scan cannot miss a writer that began under an older policy.
lock table public.ap_inventory_members in share row exclusive mode;

do $$
declare
  parsed_definition text;
  verified_definition text;
  release_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb)'::regprocedure
  ) into parsed_definition;
  select pg_catalog.pg_get_functiondef(
    'public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text)'::regprocedure
  ) into verified_definition;
  select pg_catalog.pg_get_functiondef(
    'public.ap_commit_exact_ten_release(uuid,uuid,uuid,jsonb,jsonb,text,uuid,uuid)'::regprocedure
  ) into release_definition;

  if position(
    'array_remove(array[existing.canonical_employer_listing_url,existing.canonical_application_url],null)'
    in parsed_definition
  )=0 or position('pg_advisory_xact_lock' in parsed_definition)=0 then
    raise exception 'parsed_inventory_identity_contract_missing';
  end if;
  if position(
    'array_remove(array[other.canonical_employer_listing_url,other.canonical_application_url],null)'
    in verified_definition
  )=0 or position('pg_advisory_xact_lock' in verified_definition)=0 then
    raise exception 'verified_inventory_identity_contract_missing';
  end if;
  if position(
    'array_remove(array[left_job.canonical_employer_listing_url,left_job.canonical_application_url],null)'
    in release_definition
  )=0 then
    raise exception 'exact_ten_identity_contract_missing';
  end if;

  if exists(
    select 1
    from public.ap_inventory_members left_member
    join public.ap_inventory_members right_member
      on right_member.inventory_version_id=left_member.inventory_version_id
      and right_member.id>left_member.id
      and right_member.selected_by_deduplication
    join public.ap_job_snapshots left_job on left_job.id=left_member.job_snapshot_id
    join public.ap_job_snapshots right_job on right_job.id=right_member.job_snapshot_id
    where left_member.selected_by_deduplication and (
      (
        left_job.external_job_id is not null and right_job.external_job_id is not null
        and left_job.external_job_id=right_job.external_job_id
        and left_job.canonical_employer_domain is not distinct from right_job.canonical_employer_domain
      )
      or (
        array_remove(array[left_job.canonical_employer_listing_url,left_job.canonical_application_url],null)
        && array_remove(array[right_job.canonical_employer_listing_url,right_job.canonical_application_url],null)
      )
      or (
        (
          (left_job.external_job_id is null and left_job.canonical_employer_listing_url is null and left_job.canonical_application_url is null)
          or
          (right_job.external_job_id is null and right_job.canonical_employer_listing_url is null and right_job.canonical_application_url is null)
        )
        and left_job.normalized_fingerprint=right_job.normalized_fingerprint
      )
    )
  ) then
    raise exception 'selected_inventory_identity_conflict_requires_successor_inventory';
  end if;
end;
$$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610040079','RUNTIME_LAUNCH_SCHEMA_READINESS',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

create or replace function public.ap_manual_launch_schema_readiness()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with contracts as (
    select
      position(
        'array_remove(array[existing.canonical_employer_listing_url,existing.canonical_application_url],null)'
        in pg_catalog.pg_get_functiondef(
          'public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb)'::regprocedure
        )
      )>0 as parsed_inventory,
      position(
        'array_remove(array[other.canonical_employer_listing_url,other.canonical_application_url],null)'
        in pg_catalog.pg_get_functiondef(
          'public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text)'::regprocedure
        )
      )>0 as verified_inventory,
      position(
        'array_remove(array[left_job.canonical_employer_listing_url,left_job.canonical_application_url],null)'
        in pg_catalog.pg_get_functiondef(
          'public.ap_commit_exact_ten_release(uuid,uuid,uuid,jsonb,jsonb,text,uuid,uuid)'::regprocedure
        )
      )>0 as exact_ten_release
  ), checkpoints as (
    select count(*)=3 as installed
    from public.ap_migration_checkpoints
    where (migration_id,checkpoint) in (
      ('202610040077','ATOMIC_INVENTORY_IDENTITY_ENFORCEMENT'),
      ('202610040078','REQUEUE_IDENTITY_POLICY_FEASIBILITY'),
      ('202610040079','RUNTIME_LAUNCH_SCHEMA_READINESS')
    )
  )
  select jsonb_build_object(
    'ready', checkpoints.installed and contracts.parsed_inventory
      and contracts.verified_inventory and contracts.exact_ten_release,
    'requiredSchemaVersion', '202610040079',
    'requiredMigrations', jsonb_build_array('202610040077','202610040078','202610040079')
  )
  from contracts cross join checkpoints;
$$;

revoke all on function public.ap_manual_launch_schema_readiness()
  from public,anon,authenticated;
grant execute on function public.ap_manual_launch_schema_readiness()
  to service_role;

commit;

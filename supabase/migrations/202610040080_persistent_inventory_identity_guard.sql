begin;

-- ACCESS EXCLUSIVE conflicts with the ACCESS SHARE lock taken by an older
-- writer's duplicate SELECT. This drains writers that already passed their
-- precheck before the persistent trigger is installed.
lock table public.ap_inventory_members in access exclusive mode;

create or replace function public.ap_guard_inventory_member_identity()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  incoming_job public.ap_job_snapshots%rowtype;
begin
  if not new.selected_by_deduplication then
    return new;
  end if;

  select * into incoming_job
  from public.ap_job_snapshots
  where id=new.job_snapshot_id;
  if not found then
    raise exception 'inventory_job_snapshot_missing';
  end if;

  -- Serialize every insert path, including an older application build or a
  -- direct service-role insert, on the same per-inventory key as the RPCs.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.inventory_version_id::text,0)
  );

  if exists(
    select 1
    from public.ap_inventory_members member
    join public.ap_job_snapshots existing on existing.id=member.job_snapshot_id
    where member.inventory_version_id=new.inventory_version_id
      and member.id is distinct from new.id
      and member.selected_by_deduplication
      and (
        member.stable_normalized_job_id=new.stable_normalized_job_id
        or (
          existing.external_job_id is not null and incoming_job.external_job_id is not null
          and existing.external_job_id=incoming_job.external_job_id
          and existing.canonical_employer_domain is not distinct from incoming_job.canonical_employer_domain
        )
        or (
          array_remove(array[existing.canonical_employer_listing_url,existing.canonical_application_url],null)
          && array_remove(array[incoming_job.canonical_employer_listing_url,incoming_job.canonical_application_url],null)
        )
        or (
          (
            (existing.external_job_id is null and existing.canonical_employer_listing_url is null and existing.canonical_application_url is null)
            or
            (incoming_job.external_job_id is null and incoming_job.canonical_employer_listing_url is null and incoming_job.canonical_application_url is null)
          )
          and existing.normalized_fingerprint is not null
          and existing.normalized_fingerprint=incoming_job.normalized_fingerprint
        )
      )
  ) then
    raise exception 'duplicate_inventory_job';
  end if;

  return new;
end;
$$;

revoke all on function public.ap_guard_inventory_member_identity()
  from public,anon,authenticated;

drop trigger if exists ap_guard_inventory_member_identity on public.ap_inventory_members;
create trigger ap_guard_inventory_member_identity
before insert or update of inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication
on public.ap_inventory_members
for each row execute function public.ap_guard_inventory_member_identity();

-- Inventory is immutable, so a historical conflict requires a clean successor
-- rather than an in-place repair. The ACCESS EXCLUSIVE lock remains held while
-- this final cutover scan and readiness publication complete.
do $$
begin
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
      left_member.stable_normalized_job_id=right_member.stable_normalized_job_id
      or (
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
values('202610040080','PERSISTENT_INVENTORY_IDENTITY_GUARD',0,clock_timestamp())
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
    select count(*)=4 as installed
    from public.ap_migration_checkpoints
    where (migration_id,checkpoint) in (
      ('202610040077','ATOMIC_INVENTORY_IDENTITY_ENFORCEMENT'),
      ('202610040078','REQUEUE_IDENTITY_POLICY_FEASIBILITY'),
      ('202610040079','RUNTIME_LAUNCH_SCHEMA_READINESS'),
      ('202610040080','PERSISTENT_INVENTORY_IDENTITY_GUARD')
    )
  ), guard as (
    select count(*)=1
      and bool_and(trigger.tgenabled='O')
      and bool_and(position('pg_advisory_xact_lock' in pg_catalog.pg_get_functiondef(procedure.oid))>0)
      and bool_and(position(
        'array_remove(array[existing.canonical_employer_listing_url,existing.canonical_application_url],null)'
        in pg_catalog.pg_get_functiondef(procedure.oid)
      )>0) as installed
    from pg_catalog.pg_trigger trigger
    join pg_catalog.pg_proc procedure on procedure.oid=trigger.tgfoid
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where trigger.tgrelid='public.ap_inventory_members'::regclass
      and trigger.tgname='ap_guard_inventory_member_identity'
      and not trigger.tgisinternal
      and namespace.nspname='public'
      and procedure.proname='ap_guard_inventory_member_identity'
  ), live_inventory as (
    select not exists(
      select 1
      from public.ap_inventory_members left_member
      join public.ap_inventory_members right_member
        on right_member.inventory_version_id=left_member.inventory_version_id
        and right_member.id>left_member.id
        and right_member.selected_by_deduplication
      join public.ap_job_snapshots left_job on left_job.id=left_member.job_snapshot_id
      join public.ap_job_snapshots right_job on right_job.id=right_member.job_snapshot_id
      where left_member.selected_by_deduplication and (
        left_member.stable_normalized_job_id=right_member.stable_normalized_job_id
        or (
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
    ) as clean
  )
  select jsonb_build_object(
    'ready', checkpoints.installed and guard.installed and live_inventory.clean
      and contracts.parsed_inventory and contracts.verified_inventory and contracts.exact_ten_release,
    'requiredSchemaVersion', '202610040080',
    'requiredMigrations', jsonb_build_array(
      '202610040077','202610040078','202610040079','202610040080'
    )
  )
  from contracts cross join checkpoints cross join guard cross join live_inventory;
$$;

revoke all on function public.ap_manual_launch_schema_readiness()
  from public,anon,authenticated;
grant execute on function public.ap_manual_launch_schema_readiness()
  to service_role;

commit;

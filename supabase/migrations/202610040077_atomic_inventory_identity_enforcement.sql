begin;

-- The HTTP preflight is advisory. The inventory advisory lock is the atomic
-- authority, so both active admission paths must enforce the same opportunity
-- identity policy while holding that lock.
do $migration$
declare definition text; old_predicate text; new_predicate text;
begin
  select pg_get_functiondef('public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb)'::regprocedure)
    into definition;
  definition:=replace(definition,chr(13),'');
  old_predicate:=$old$member.stable_normalized_job_id=p_stable_normalized_job_id
      or existing.canonical_application_url=p_job_snapshot->>'canonical_application_url'
      or (existing.canonical_employer_listing_url is not null and existing.canonical_employer_listing_url=p_job_snapshot->>'canonical_employer_listing_url')
      or (existing.external_job_id is not null and existing.external_job_id=p_job_snapshot->>'external_job_id' and existing.canonical_employer_domain=p_job_snapshot->>'canonical_employer_domain')$old$;
  new_predicate:=$new$member.stable_normalized_job_id=p_stable_normalized_job_id
      or (
        existing.external_job_id is not null
        and nullif(p_job_snapshot->>'external_job_id','') is not null
        and existing.external_job_id=p_job_snapshot->>'external_job_id'
        and existing.canonical_employer_domain is not distinct from nullif(p_job_snapshot->>'canonical_employer_domain','')
      )
      or (
        array_remove(array[existing.canonical_employer_listing_url,existing.canonical_application_url],null)
        && array_remove(array[nullif(p_job_snapshot->>'canonical_employer_listing_url',''),nullif(p_job_snapshot->>'canonical_application_url','')],null)
      )
      or (
        (
          (existing.external_job_id is null and existing.canonical_employer_listing_url is null and existing.canonical_application_url is null)
          or
          (nullif(p_job_snapshot->>'external_job_id','') is null
            and nullif(p_job_snapshot->>'canonical_employer_listing_url','') is null
            and nullif(p_job_snapshot->>'canonical_application_url','') is null)
        )
        and existing.normalized_fingerprint is not null
        and existing.normalized_fingerprint=p_job_snapshot->>'normalized_fingerprint'
      )$new$;
  if definition is null or position(old_predicate in definition)=0
    then raise exception 'parsed_inventory_identity_anchor_missing'; end if;
  definition:=replace(definition,old_predicate,new_predicate);
  if position(new_predicate in definition)=0 or position('pg_advisory_xact_lock' in definition)=0
    then raise exception 'parsed_inventory_identity_rewrite_failed'; end if;
  execute definition;
end;
$migration$;

do $migration$
declare definition text; old_predicate text; new_predicate text;
begin
  select pg_get_functiondef('public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text)'::regprocedure)
    into definition;
  definition:=replace(definition,chr(13),'');
  old_predicate:=$old$select m.id into member from public.ap_inventory_members m join public.ap_job_snapshots other on other.id=m.job_snapshot_id where m.inventory_version_id=p_inventory_version_id and (m.stable_normalized_job_id=verified_identity or other.canonical_application_url=j.canonical_application_url);$old$;
  new_predicate:=$new$select m.id into member
 from public.ap_inventory_members m
 join public.ap_job_snapshots other on other.id=m.job_snapshot_id
 where m.inventory_version_id=p_inventory_version_id and (
   m.stable_normalized_job_id=verified_identity
   or (
     other.external_job_id is not null and j.external_job_id is not null
     and other.external_job_id=j.external_job_id
     and other.canonical_employer_domain is not distinct from j.canonical_employer_domain
   )
   or (
     array_remove(array[other.canonical_employer_listing_url,other.canonical_application_url],null)
     && array_remove(array[j.canonical_employer_listing_url,j.canonical_application_url],null)
   )
   or (
     (
       (other.external_job_id is null and other.canonical_employer_listing_url is null and other.canonical_application_url is null)
       or
       (j.external_job_id is null and j.canonical_employer_listing_url is null and j.canonical_application_url is null)
     )
     and other.normalized_fingerprint is not null
     and other.normalized_fingerprint=j.normalized_fingerprint
   )
 );$new$;
  if definition is null or position(old_predicate in definition)=0
    then raise exception 'verified_inventory_identity_anchor_missing'; end if;
  definition:=replace(definition,old_predicate,new_predicate);
  if position(new_predicate in definition)=0 or position('pg_advisory_xact_lock' in definition)=0
    then raise exception 'verified_inventory_identity_rewrite_failed'; end if;
  execute definition;
end;
$migration$;

revoke all on function public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb)
  to service_role;
revoke all on function public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text)
  to service_role;

-- Immutable inventory rows are not silently rewritten. Refuse the migration if
-- any currently selected inventory already violates the new pairwise policy;
-- the operator must create a clean successor inventory and rerun the migration.
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
  ) then raise exception 'selected_inventory_identity_conflict_requires_successor_inventory'; end if;
end;
$$;

-- Previously derived feasibility and quotes predate the atomic policy. They
-- must be regenerated even when the historical inventory is already clean.
update public.ap_feasibility_assessments
set invalidated_at=clock_timestamp()
where invalidated_at is null;
update public.ap_quotes
set invalidated_at=clock_timestamp()
where invalidated_at is null;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610040077','ATOMIC_INVENTORY_IDENTITY_ENFORCEMENT',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;

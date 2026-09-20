begin;

create or replace function public.ap_assert_current_artifact_facts(p_artifact_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare artifact public.ap_generated_artifacts; fact_id text; fact public.ap_candidate_facts;
  job_snapshot public.ap_job_snapshots; legacy_job public.jobs;
begin
  select * into artifact from public.ap_generated_artifacts where id=p_artifact_id;
  if artifact.id is null then raise exception 'material_download_unavailable'; end if;
  -- Only an explicit successor supersedes this job. Another independently
  -- captured job (even for the same employer) does not stale purchased files.
  select * into job_snapshot from public.ap_job_snapshots where id=artifact.job_snapshot_id for share;
  if not found or exists(select 1 from public.ap_job_snapshots successor
    where successor.supersedes_job_snapshot_id=artifact.job_snapshot_id)
    then raise exception 'material_download_unavailable'; end if;
  if job_snapshot.legacy_job_id is not null then
    select * into legacy_job from public.jobs where id=job_snapshot.legacy_job_id for share;
    if not found or legacy_job.is_active is distinct from true
      or legacy_job.listing_status is distinct from 'open'
      or legacy_job.closing_at<=clock_timestamp()
      then raise exception 'material_download_unavailable'; end if;
  end if;
  if artifact.artifact_type in ('RESUME','COVER_LETTER') and
    (jsonb_typeof(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}') is distinct from 'array'
      or jsonb_array_length(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}')=0)
    then raise exception 'material_download_unavailable'; end if;
  for fact_id in select jsonb_array_elements_text(coalesce(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}','[]'::jsonb)) loop
    select * into fact from public.ap_candidate_facts where id=fact_id::uuid for share;
    if fact.id is null or fact.customer_id is distinct from artifact.customer_id
      or fact.snapshot_id is distinct from artifact.source_snapshot_id
      or fact.superseded_at is not null or fact.verification not in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')
      then raise exception 'material_download_unavailable'; end if;
  end loop;
end;
$$;
revoke all on function public.ap_assert_current_artifact_facts(uuid) from public,anon,authenticated;

-- Serialize an explicit replacement against dependency checks, then preserve
-- historical releases while revoking their obsolete approvals and downloads.
create or replace function public.ap_invalidate_materials_for_job_successor()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.supersedes_job_snapshot_id is null then return new; end if;
  perform 1 from public.ap_job_snapshots where id=new.supersedes_job_snapshot_id for update;
  update public.ap_generated_file_versions file
    set downloads_revoked_at=coalesce(file.downloads_revoked_at,clock_timestamp())
    from public.ap_generated_artifacts artifact
    where artifact.id=file.artifact_id and artifact.job_snapshot_id=new.supersedes_job_snapshot_id;
  update public.ap_artifact_quality_reviews review
    set invalidated_at=coalesce(review.invalidated_at,clock_timestamp())
    from public.ap_generated_file_versions file,public.ap_generated_artifacts artifact
    where review.file_version_id=file.id and file.artifact_id=artifact.id
      and artifact.job_snapshot_id=new.supersedes_job_snapshot_id;
  return new;
end;
$$;
create trigger ap_material_job_dependency_changed before insert on public.ap_job_snapshots
for each row execute function public.ap_invalidate_materials_for_job_successor();
revoke all on function public.ap_invalidate_materials_for_job_successor() from public,anon,authenticated;

-- A confirmed closure/inactivation invalidates linked files. Routine check-time
-- refreshes and future closing dates do not revoke an otherwise current file.
create or replace function public.ap_invalidate_materials_for_job_closure()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.is_active is not distinct from old.is_active
    and new.listing_status is not distinct from old.listing_status
    and new.closing_at is not distinct from old.closing_at then return new; end if;
  if new.is_active is true and new.listing_status='open'
    and (new.closing_at is null or new.closing_at>clock_timestamp()) then return new; end if;
  update public.ap_generated_file_versions file
    set downloads_revoked_at=coalesce(file.downloads_revoked_at,clock_timestamp())
    from public.ap_generated_artifacts artifact,public.ap_job_snapshots snapshot
    where artifact.id=file.artifact_id and snapshot.id=artifact.job_snapshot_id
      and snapshot.legacy_job_id=new.id;
  update public.ap_artifact_quality_reviews review
    set invalidated_at=coalesce(review.invalidated_at,clock_timestamp())
    from public.ap_generated_file_versions file,public.ap_generated_artifacts artifact,public.ap_job_snapshots snapshot
    where review.file_version_id=file.id and file.artifact_id=artifact.id
      and snapshot.id=artifact.job_snapshot_id and snapshot.legacy_job_id=new.id;
  return new;
end;
$$;
create trigger ap_material_job_closure_changed after update of is_active,listing_status,closing_at on public.jobs
for each row execute function public.ap_invalidate_materials_for_job_closure();
revoke all on function public.ap_invalidate_materials_for_job_closure() from public,anon,authenticated;

-- Revoke previously stale files as well as future changes handled by migration038.
update public.ap_generated_file_versions file set downloads_revoked_at=coalesce(file.downloads_revoked_at,clock_timestamp())
from public.ap_generated_artifacts artifact where artifact.id=file.artifact_id
and exists(select 1 from jsonb_array_elements_text(coalesce(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}','[]'::jsonb)) id
  where not exists(select 1 from public.ap_candidate_facts fact where fact.id=id::uuid
    and fact.customer_id=artifact.customer_id and fact.snapshot_id=artifact.source_snapshot_id
    and fact.superseded_at is null and fact.verification in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')));
update public.ap_artifact_quality_reviews review set invalidated_at=coalesce(review.invalidated_at,clock_timestamp())
from public.ap_generated_file_versions file where file.id=review.file_version_id and file.downloads_revoked_at is not null;

update public.ap_generated_file_versions file set downloads_revoked_at=coalesce(file.downloads_revoked_at,clock_timestamp())
from public.ap_generated_artifacts artifact where artifact.id=file.artifact_id
and exists(select 1 from public.ap_job_snapshots successor where successor.supersedes_job_snapshot_id=artifact.job_snapshot_id);
update public.ap_generated_file_versions file set downloads_revoked_at=coalesce(file.downloads_revoked_at,clock_timestamp())
from public.ap_generated_artifacts artifact,public.ap_job_snapshots snapshot,public.jobs job
where artifact.id=file.artifact_id and snapshot.id=artifact.job_snapshot_id and job.id=snapshot.legacy_job_id
  and (job.is_active is distinct from true or job.listing_status is distinct from 'open' or job.closing_at<=clock_timestamp());
update public.ap_artifact_quality_reviews review set invalidated_at=coalesce(review.invalidated_at,clock_timestamp())
from public.ap_generated_file_versions file where file.id=review.file_version_id and file.downloads_revoked_at is not null;

-- Preserve the existing audited transactional RPCs; patch only these exact guards.
do $migration$
declare definition text; anchor text; addition text;
begin
  definition:=pg_get_functiondef('public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz)'::regprocedure);
  anchor:='  expires_value:=now_at+interval ''15 minutes'';';
  if position(anchor in definition)=0 then raise exception 'material_download_migration_anchor_missing'; end if;
  definition:=replace(definition,anchor,'  perform public.ap_assert_current_artifact_facts(artifact.id);'||chr(10)||anchor);
  execute definition;

  definition:=pg_get_functiondef('public.ap_record_material_human_approval(uuid,uuid,text,text)'::regprocedure);
  anchor:='  if p_approval_kind=''CONTENT'' then';
  if position(anchor in definition)=0 then raise exception 'material_approval_dependency_anchor_missing'; end if;
  definition:=replace(definition,anchor,'  perform public.ap_assert_current_artifact_facts(artifact.id);'||chr(10)||anchor);
  execute definition;

  definition:=pg_get_functiondef('public.ap_commit_material_release_v2(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure);
  anchor:='    if artifact.artifact_type=''REFERENCE_SHEET'' and (';
  if position(anchor in definition)=0 then raise exception 'material_release_dependency_anchor_missing'; end if;
  definition:=replace(definition,anchor,'    perform public.ap_assert_current_artifact_facts(artifact.id);'||chr(10)||anchor);
  execute definition;

  definition:=pg_get_functiondef('public.ap_commit_reference_regeneration(uuid,uuid,uuid,uuid)'::regprocedure);
  anchor:='  foreach permission_id in array regeneration.permission_ids loop';
  if position(anchor in definition)=0 then raise exception 'reference_release_dependency_anchor_missing'; end if;
  definition:=replace(definition,anchor,'  perform public.ap_assert_current_artifact_facts(artifact.id);'||chr(10)||anchor);
  execute definition;

  select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_begin_board_material_checkout';
  if position('board-admission-v2' in definition)=0 then raise exception 'board_admission_migration_anchor_missing'; end if;
  definition:=replace(definition,'board-admission-v2','board-admission-v3');
  anchor:='  select * into job_row from public.ap_job_snapshots where legacy_job_id=admission.job_id';
  addition:=$contact$
  insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,
    source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,
    confirmed_or_corrected_at,catalog_version,schema_version)
  select p_contact_payload_id,p_customer_id,p_source_snapshot_id,'document_contact.confirmed','PROTECTED_COMPOSITE',
    jsonb_build_object('protectedPayloadId',p_contact_payload_id,'contentSha256',payload.content_sha256),
    'CUSTOMER_ASSERTION',p_source_snapshot_id,'chunk5_document_contact_confirmation','materials_checkout',
    'CUSTOMER_CONFIRMED',now_at,'chunk5-document-contact-v1','chunk5-document-contact-v1'
  from public.ap_sensitive_payloads payload where payload.id=p_contact_payload_id and payload.customer_id=p_customer_id
  on conflict(id) do nothing;
  if not exists(select 1 from public.ap_candidate_facts fact join public.ap_sensitive_payloads payload on payload.id=fact.id
    where fact.id=p_contact_payload_id and fact.customer_id=p_customer_id and payload.customer_id=p_customer_id
      and fact.snapshot_id=p_source_snapshot_id and fact.semantic_key='document_contact.confirmed'
      and fact.value_kind='PROTECTED_COMPOSITE' and fact.verification='CUSTOMER_CONFIRMED' and fact.superseded_at is null
      and fact.typed_value=jsonb_build_object('protectedPayloadId',payload.id,'contentSha256',payload.content_sha256))
    then raise exception 'material_contact_fact_binding_conflict'; end if;
$contact$;
  if position(anchor in definition)=0 then raise exception 'board_contact_migration_anchor_missing'; end if;
  definition:=replace(definition,anchor,addition||chr(10)||anchor);
  execute definition;
end;
$migration$;
commit;

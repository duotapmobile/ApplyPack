begin;

-- A forward-only schema must remain usable by the immediately preceding
-- application during an emergency code rollback. Approval is still revoked by
-- migration 066 and must be explicitly re-established for the selected
-- renderer; this bridge does not activate generation or checkout.
alter table public.ap_commerce_configuration
  drop constraint if exists ap_commerce_configuration_document_font_family_check;
alter table public.ap_commerce_configuration
  add constraint ap_commerce_configuration_document_font_family_check
  check (document_font_family is null or document_font_family in ('Arial','Liberation Sans'));

create or replace function public.ap_stamp_document_safety_policy() returns trigger
language plpgsql set search_path='' as $$
declare approved_family text;
begin
  if new.document_safety_policy<>'NOT_SCANNED:generated-structural-v1' then
    raise exception 'explicit_document_safety_policy_required';
  end if;
  select document_font_family into approved_family
  from public.ap_commerce_configuration where singleton;
  if approved_family not in ('Arial','Liberation Sans') then
    raise exception 'approved_document_font_required';
  end if;
  new.document_safety_policy:='generated-structural-v1';
  new.document_font_family:=approved_family;
  new.malware_verdict:='NOT_SCANNED';
  return new;
end $$;
revoke all on function public.ap_stamp_document_safety_policy() from public,anon,authenticated;

-- Keep the stable registration signature while allowing the prior renderer
-- only when the configuration has been deliberately switched back to its
-- matching font approval.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef(
    'public.ap_register_material_artifact_version(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean)'::regprocedure
  );
  definition:=replace(
    definition,
    'config.document_font_family=''Arial''',
    'config.document_font_family in (''Arial'',''Liberation Sans'')'
  );
  if position('config.document_font_family in (''Arial'',''Liberation Sans'')' in definition)=0 then
    raise exception 'document_registration_rollback_anchor_missing';
  end if;
  execute definition;
end $$;

-- Delivered files remain accessible across a code rollback when their own
-- immutable quality evidence matches either the immediately preceding or the
-- locked October 3 document contract. New generation still requires the
-- currently approved configuration through the registration function above.
create or replace function public.ap_assert_current_artifact_facts(p_artifact_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare artifact public.ap_generated_artifacts; fact_id text; fact public.ap_candidate_facts;
  job_snapshot public.ap_job_snapshots; legacy_job public.jobs;
begin
  select * into artifact from public.ap_generated_artifacts where id=p_artifact_id;
  if artifact.id is null then raise exception 'material_download_unavailable'; end if;
  if artifact.generator_version not in (
    'applypack-documents|content=applypack-content-2026-09-22.1|template=applypack-template-2026-09-22.1|exporter=libreoffice-tagged-pdf-2026-09-22.1',
    'applypack-documents|instructions=applypack-universal-document-standard-2026-10-03.1|standardSha256=1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf|content=applypack-content-2026-10-03.1|template=applypack-template-2026-10-03.1|exporter=libreoffice-tagged-pdf-2026-10-03.1'
  ) then
    raise exception 'document_policy_regeneration_required';
  end if;
  if not exists(select 1 from public.ap_generated_file_versions file
    join public.ap_artifact_quality_reviews quality on quality.file_version_id=file.id
    where file.artifact_id=artifact.id and file.version=artifact.current_file_version
      and quality.document_font_resolved
      and quality.document_font_sha256~'^[0-9a-f]{64}$'
      and quality.document_safety_policy='generated-structural-v1'
      and nullif(btrim(quality.renderer_identity),'') is not null
      and ((artifact.generator_version='applypack-documents|content=applypack-content-2026-09-22.1|template=applypack-template-2026-09-22.1|exporter=libreoffice-tagged-pdf-2026-09-22.1'
          and quality.document_font_family='Liberation Sans')
        or (artifact.generator_version='applypack-documents|instructions=applypack-universal-document-standard-2026-10-03.1|standardSha256=1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf|content=applypack-content-2026-10-03.1|template=applypack-template-2026-10-03.1|exporter=libreoffice-tagged-pdf-2026-10-03.1'
          and quality.document_font_family='Arial'))) then
    raise exception 'document_render_policy_stale';
  end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(artifact.claim_provenance->'matchingReviewIds','[]'::jsonb)) review_id
    where not exists(select 1 from public.ap_human_review_records review where review.id=review_id::uuid
      and (review.customer_id is null or review.customer_id=artifact.customer_id) and review.snapshot_id=artifact.source_snapshot_id
      and review.job_snapshot_id=artifact.job_snapshot_id and review.review_kind='MATCH_EVIDENCE' and review.invalidated_at is null)) then
    raise exception 'document_matching_review_stale';
  end if;
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
  if exists(select 1 from public.ap_job_snapshot_invalidations where job_snapshot_id=artifact.job_snapshot_id) then
    raise exception 'material_download_unavailable';
  end if;
  if artifact.job_snapshot_id is not null and not exists(select 1 from public.ap_current_source_verifications(artifact.job_snapshot_id)) then
    raise exception 'material_download_unavailable';
  end if;
  if artifact.artifact_type in ('RESUME','COVER_LETTER') and
    (jsonb_typeof(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}') is distinct from 'array'
      or jsonb_array_length(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}')=0)
    then raise exception 'material_download_unavailable'; end if;
  for fact_id in select jsonb_array_elements_text(coalesce(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}','[]'::jsonb)) loop
    select * into fact from public.ap_candidate_facts where id=fact_id::uuid for share;
    if fact.id is null or (fact.customer_id is not null and fact.customer_id is distinct from artifact.customer_id)
      or not public.ap_customer_owns_snapshot(artifact.customer_id,artifact.source_snapshot_id)
      or fact.snapshot_id is distinct from artifact.source_snapshot_id
      or fact.superseded_at is not null or fact.verification not in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')
      then raise exception 'material_download_unavailable'; end if;
  end loop;
end;
$$;
revoke all on function public.ap_assert_current_artifact_facts(uuid) from public,anon,authenticated;

-- The locked contract keeps the exact reviewed editable DOCX in private
-- operator storage even when the customer delivery is PDF.
create function public.ap_guard_locked_editable_document_source() returns trigger
language plpgsql set search_path='' as $$
declare source jsonb;
begin
  if new.generator_version='applypack-documents|instructions=applypack-universal-document-standard-2026-10-03.1|standardSha256=1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf|content=applypack-content-2026-10-03.1|template=applypack-template-2026-10-03.1|exporter=libreoffice-tagged-pdf-2026-10-03.1' then
    source:=new.claim_provenance->'editableSource';
    if jsonb_typeof(source)<>'object'
      or source->>'storageBucket'<>'operator-drafts'
      or source->>'storagePath' not like new.customer_id::text||'/materials/'||new.material_line_id::text||'/%/editable-source/%'
      or source->>'safeFilename'!~'^[^/\\]{1,180}\.docx$'
      or source->>'checksumSha256'!~'^[0-9a-f]{64}$'
      or coalesce((source->>'sizeBytes')::bigint,0)<=0
      or source->>'mimeType'<>'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      then raise exception 'locked_editable_document_source_required'; end if;
  end if;
  return new;
end $$;
create trigger ap_guard_locked_editable_document_source
before insert or update of claim_provenance,generator_version on public.ap_generated_artifacts
for each row execute function public.ap_guard_locked_editable_document_source();
revoke all on function public.ap_guard_locked_editable_document_source() from public,anon,authenticated;

-- The database independently enforces an explicit employer page cap. NULL is
-- no employer-stated cap; the locked house standard still caps resumes at two.
create function public.ap_guard_employer_resume_page_limit() returns trigger
language plpgsql set search_path='' as $$
declare artifact_type public.ap_artifact_type; page_limit integer;
begin
  select artifact.artifact_type,rule.resume_page_limit into artifact_type,page_limit
  from public.ap_generated_file_versions file
  join public.ap_generated_artifacts artifact on artifact.id=file.artifact_id
  join public.ap_material_line_revisions revision on revision.id=artifact.source_line_revision_id
  join public.ap_employer_submission_rules rule on rule.id=revision.employer_rule_snapshot_id
  where file.id=new.file_version_id;
  if artifact_type='RESUME' and page_limit is not null and new.rendered_page_count>page_limit then
    raise exception 'resume_content_exceeds_employer_page_limit';
  end if;
  return new;
end $$;
create trigger ap_guard_employer_resume_page_limit
before insert or update of file_version_id,rendered_page_count on public.ap_artifact_quality_reviews
for each row execute function public.ap_guard_employer_resume_page_limit();
revoke all on function public.ap_guard_employer_resume_page_limit() from public,anon,authenticated;

-- Capacity administration and maintenance use the same lock order: advisory
-- resource lock first, then the pool row, then bucket rows.
create or replace function public.ap_ensure_manual_launch_capacity_rollover()
returns integer language plpgsql security definer set search_path='' as $$
declare
  resource_value public.ap_capacity_resource;
  pool public.ap_capacity_pools;
  current_bucket public.ap_capacity_buckets;
  successor public.ap_capacity_buckets;
  bucket_units integer;
  now_at timestamptz:=clock_timestamp();
  created_count integer:=0;
begin
  for resource_value in
    select resource from public.ap_capacity_pools
    where enabled and resource in ('SEARCH','MATERIALS') order by resource
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('manual-launch-capacity:'||resource_value::text,0)
    );
    select * into pool from public.ap_capacity_pools
      where resource=resource_value and enabled for update;
    if not found then continue; end if;
    select * into current_bucket from public.ap_capacity_buckets bucket
      where bucket.pool_id=pool.id and bucket.starts_at<=now_at and bucket.ends_at>now_at
      order by bucket.starts_at desc limit 1 for update;
    if not found then raise exception 'manual_launch_capacity_current_bucket_required'; end if;
    if current_bucket.ends_at>now_at+interval '7 days' then continue; end if;
    bucket_units:=case when pool.resource='SEARCH' then 32 else 64 end;
    select * into successor from public.ap_capacity_buckets bucket
      where bucket.pool_id=pool.id and bucket.starts_at>=current_bucket.ends_at
      order by bucket.starts_at limit 1 for update;
    if found then
      if successor.starts_at is distinct from current_bucket.ends_at
        or successor.ends_at is distinct from current_bucket.ends_at+interval '31 days'
        or successor.total_units<>bucket_units
        or successor.staffing_version<>'manual-launch-rolling-24h-v1' then
        raise exception 'manual_launch_capacity_successor_bucket_conflict';
      end if;
      continue;
    end if;
    insert into public.ap_capacity_buckets(
      pool_id,starts_at,ends_at,total_units,staffing_version
    ) values(
      pool.id,current_bucket.ends_at,current_bucket.ends_at+interval '31 days',
      bucket_units,'manual-launch-rolling-24h-v1'
    ) returning * into successor;
    insert into public.ap_audit_events(
      action,entity_type,entity_id,non_sensitive_details,audit_version
    ) values(
      'MANUAL_LAUNCH_CAPACITY_ROLLOVER_PROVISIONED','CAPACITY_BUCKET',successor.id,
      jsonb_build_object('resource',pool.resource,'priorBucketId',current_bucket.id,
        'startsAt',successor.starts_at,'endsAt',successor.ends_at,
        'bucketUnits',bucket_units),'manual-launch-capacity-v2'
    );
    created_count:=created_count+1;
  end loop;
  return created_count;
end;
$$;
revoke all on function public.ap_ensure_manual_launch_capacity_rollover()
  from public,anon,authenticated;
grant execute on function public.ap_ensure_manual_launch_capacity_rollover()
  to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610030067','DOCUMENT_SOURCE_AND_ROLLBACK_COMPATIBILITY',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;

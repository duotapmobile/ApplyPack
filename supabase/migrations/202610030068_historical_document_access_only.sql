begin;

-- Forward-fix the first 067 trigger body. Some environments may already have
-- recorded that migration, so its published bytes stay untouched.
create or replace function public.ap_guard_locked_editable_document_source() returns trigger
language plpgsql set search_path='' as $$
declare source jsonb;
begin
  if new.generator_version='applypack-documents|instructions=applypack-universal-document-standard-2026-10-03.1|standardSha256=1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf|content=applypack-content-2026-10-03.1|template=applypack-template-2026-10-03.1|exporter=libreoffice-tagged-pdf-2026-10-03.1' then
    source:=new.claim_provenance->'editableSource';
    if jsonb_typeof(source) is distinct from 'object'
      or source->>'storageBucket' is distinct from 'operator-drafts'
      or coalesce(source->>'storagePath','') not like new.customer_id::text||'/materials/'||new.material_line_id::text||'/%/editable-source/%'
      or coalesce(source->>'safeFilename','')!~'^[^/\\]{1,180}\.docx$'
      or coalesce(source->>'checksumSha256','')!~'^[0-9a-f]{64}$'
      or coalesce(source->>'sizeBytes','')!~'^[1-9][0-9]{0,12}$'
      or source->>'mimeType' is distinct from 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      then raise exception 'locked_editable_document_source_required'; end if;
  end if;
  return new;
end $$;
revoke all on function public.ap_guard_locked_editable_document_source() from public,anon,authenticated,service_role;

-- Historical document contracts are access-compatible only. Approval and
-- release continue to require the locked current contract at the database
-- boundary, even when a caller bypasses the HTTP administration route.
create function public.ap_assert_supported_artifact_facts(p_artifact_id uuid)
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
revoke all on function public.ap_assert_supported_artifact_facts(uuid) from public,anon,authenticated,service_role;

create or replace function public.ap_assert_current_artifact_facts(p_artifact_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare generator_version text;
begin
  select artifact.generator_version into generator_version
  from public.ap_generated_artifacts artifact where artifact.id=p_artifact_id;
  if generator_version is distinct from 'applypack-documents|instructions=applypack-universal-document-standard-2026-10-03.1|standardSha256=1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf|content=applypack-content-2026-10-03.1|template=applypack-template-2026-10-03.1|exporter=libreoffice-tagged-pdf-2026-10-03.1' then
    raise exception 'document_policy_regeneration_required';
  end if;
  perform public.ap_assert_supported_artifact_facts(p_artifact_id);
end;
$$;
revoke all on function public.ap_assert_current_artifact_facts(uuid) from public,anon,authenticated,service_role;

do $$
declare definition text; current_guard text; supported_guard text;
begin
  definition:=pg_get_functiondef('public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz)'::regprocedure);
  current_guard:='perform public.ap_assert_current_artifact_facts(artifact.id);';
  supported_guard:='perform public.ap_assert_supported_artifact_facts(artifact.id);';
  if position(current_guard in definition)=0 then raise exception 'material_download_current_guard_anchor_missing'; end if;
  definition:=replace(definition,current_guard,supported_guard);
  execute definition;
  definition:=pg_get_functiondef('public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz)'::regprocedure);
  if position(supported_guard in definition)=0 or position(current_guard in definition)>0 then
    raise exception 'material_download_supported_guard_not_installed';
  end if;
end $$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610030068','HISTORICAL_DOCUMENT_ACCESS_ONLY',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;

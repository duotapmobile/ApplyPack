begin;

-- Register a delayed cleanup intent before private editable-source upload.
-- Successful artifact registration clears it in the same database transaction;
-- a process crash leaves a bounded object for maintenance to remove.
alter table public.storage_cleanup_queue
  add column not_before timestamptz not null default '-infinity'::timestamptz;
create index storage_cleanup_not_before_idx
  on public.storage_cleanup_queue(not_before,attempts,created_at);

create function public.ap_clear_registered_editable_source_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare source jsonb;
begin
  source:=new.claim_provenance->'editableSource';
  if jsonb_typeof(source)='object' then
    delete from public.storage_cleanup_queue
    where bucket=source->>'storageBucket' and storage_path=source->>'storagePath';
  end if;
  return new;
end;
$$;
create trigger ap_registered_editable_source_cleanup
after insert or update of claim_provenance on public.ap_generated_artifacts
for each row execute function public.ap_clear_registered_editable_source_cleanup();
revoke all on function public.ap_clear_registered_editable_source_cleanup() from public,anon,authenticated,service_role;

-- A paid, released file remains downloadable until its immutable file version
-- is explicitly superseded or revoked. Source freshness is a release-time
-- control and must not become an undocumented download expiration clock.
create or replace function public.ap_assert_supported_artifact_facts(p_artifact_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare artifact public.ap_generated_artifacts; fact_id text; fact public.ap_candidate_facts;
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
      and review.job_snapshot_id=artifact.job_snapshot_id and review.review_kind='MATCH_EVIDENCE')) then
    raise exception 'document_matching_review_stale';
  end if;
  if artifact.job_snapshot_id is not null and not exists(
    select 1 from public.ap_job_snapshots where id=artifact.job_snapshot_id
  ) then raise exception 'material_download_unavailable'; end if;
  if artifact.artifact_type in ('RESUME','COVER_LETTER') and
    (jsonb_typeof(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}') is distinct from 'array'
      or jsonb_array_length(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}')=0)
    then raise exception 'material_download_unavailable'; end if;
  for fact_id in select jsonb_array_elements_text(coalesce(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}','[]'::jsonb)) loop
    select * into fact from public.ap_candidate_facts where id=fact_id::uuid for share;
    if fact.id is null or (fact.customer_id is not null and fact.customer_id is distinct from artifact.customer_id)
      or not public.ap_customer_owns_snapshot(artifact.customer_id,artifact.source_snapshot_id)
      or fact.snapshot_id is distinct from artifact.source_snapshot_id
      or fact.verification not in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')
      then raise exception 'material_download_unavailable'; end if;
  end loop;
end;
$$;
revoke all on function public.ap_assert_supported_artifact_facts(uuid) from public,anon,authenticated,service_role;

-- Approval and release keep the 24-hour current-source requirement.
create or replace function public.ap_assert_current_artifact_facts(p_artifact_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare artifact public.ap_generated_artifacts; fact_id text; fact public.ap_candidate_facts;
  job_snapshot public.ap_job_snapshots; legacy_job public.jobs;
begin
  perform public.ap_assert_supported_artifact_facts(p_artifact_id);
  select * into artifact from public.ap_generated_artifacts where id=p_artifact_id;
  if artifact.generator_version is distinct from 'applypack-documents|instructions=applypack-universal-document-standard-2026-10-03.1|standardSha256=1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf|content=applypack-content-2026-10-03.1|template=applypack-template-2026-10-03.1|exporter=libreoffice-tagged-pdf-2026-10-03.1' then
    raise exception 'document_policy_regeneration_required';
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
  if artifact.job_snapshot_id is not null and not exists(
    select 1 from public.ap_current_source_verifications(artifact.job_snapshot_id)
  ) then
    raise exception 'material_download_unavailable';
  end if;
  for fact_id in select jsonb_array_elements_text(coalesce(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}','[]'::jsonb)) loop
    select * into fact from public.ap_candidate_facts where id=fact_id::uuid for share;
    if fact.id is null or fact.superseded_at is not null
      or fact.verification not in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')
      then raise exception 'material_download_unavailable'; end if;
  end loop;
end;
$$;
revoke all on function public.ap_assert_current_artifact_facts(uuid) from public,anon,authenticated,service_role;

-- Closing or inactivating a listing prevents any new approval or release, but
-- does not claw back a file that was already delivered. Unreleased artifacts
-- are revoked and all linked quality approval is invalidated.
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
      and snapshot.legacy_job_id=new.id
      and not exists(select 1 from public.ap_release_members member
        where member.member_type='GENERATED_ARTIFACT' and member.member_id=artifact.id);
  update public.ap_artifact_quality_reviews review
    set invalidated_at=coalesce(review.invalidated_at,clock_timestamp())
    from public.ap_generated_file_versions file,public.ap_generated_artifacts artifact,public.ap_job_snapshots snapshot
    where review.file_version_id=file.id and file.artifact_id=artifact.id
      and snapshot.id=artifact.job_snapshot_id and snapshot.legacy_job_id=new.id;
  return new;
end;
$$;
revoke all on function public.ap_invalidate_materials_for_job_closure() from public,anon,authenticated,service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610030069','DURABLE_DELIVERED_DOCUMENT_ACCESS',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;

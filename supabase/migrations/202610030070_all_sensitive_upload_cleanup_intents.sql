begin;

-- Render previews contain the complete customer document and must participate
-- in the same durable cleanup lifecycle as editable and delivered files.
alter table public.storage_cleanup_queue
  drop constraint storage_cleanup_queue_bucket_check;
alter table public.storage_cleanup_queue
  add constraint storage_cleanup_queue_bucket_check
  check (bucket in (
    'customer-source-documents',
    'customer-deliveries',
    'operator-drafts',
    'operator-render-previews'
  ));

-- Generation records cleanup intents for all sensitive uploads in
-- claim_provenance.uploadCleanup. Artifact registration clears those intents
-- in the same transaction; a rollback or process crash leaves them queued.
create or replace function public.ap_clear_registered_editable_source_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare source jsonb; cleanup jsonb; upload jsonb; file_version_id text; base_path text;
begin
  source:=new.claim_provenance->'editableSource';
  if jsonb_typeof(source)='object' then
    delete from public.storage_cleanup_queue
    where bucket=source->>'storageBucket' and storage_path=source->>'storagePath';
  end if;
  cleanup:=new.claim_provenance->'uploadCleanup';
  if cleanup is not null then
    if jsonb_typeof(cleanup)<>'array' or jsonb_array_length(cleanup)<>3
      or (select count(distinct value->>'storageBucket') from jsonb_array_elements(cleanup))<>3
      then raise exception 'material_upload_cleanup_shape_invalid'; end if;
    select split_part(value->>'storagePath','/',4) into file_version_id
    from jsonb_array_elements(cleanup)
    where value->>'storageBucket'='operator-drafts';
    if file_version_id is null
      or file_version_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise exception 'material_upload_cleanup_path_invalid'; end if;
    base_path:=new.customer_id::text||'/materials/'||new.material_line_id::text||'/'||file_version_id;
    if exists(select 1 from jsonb_array_elements(cleanup) entry(value)
      where jsonb_typeof(value)<>'object' or
        case value->>'storageBucket'
          when 'operator-drafts' then value->>'storagePath' is distinct from source->>'storagePath'
            or value->>'storagePath' not like base_path||'/editable-source/%'
            or split_part(value->>'storagePath','/',7)<>''
          when 'operator-render-previews' then value->>'storagePath' is distinct from base_path||'/render-preview.pdf'
          when 'customer-deliveries' then value->>'storagePath' not like base_path||'/%'
            or split_part(value->>'storagePath','/',6)<>''
            or value->>'storagePath'=base_path||'/render-preview.pdf'
          else true
        end
    ) then raise exception 'material_upload_cleanup_path_invalid'; end if;
    for upload in select value from jsonb_array_elements(cleanup) loop
      delete from public.storage_cleanup_queue
      where bucket=upload->>'storageBucket' and storage_path=upload->>'storagePath';
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.ap_clear_registered_editable_source_cleanup() from public,anon,authenticated,service_role;

-- An employer edit creates a new immutable source snapshot and blocks every
-- new approval or release against the prior snapshot. It does not claw back a
-- paid file that was already released; only unreleased files are auto-revoked.
create or replace function public.ap_invalidate_materials_for_job_content_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.content_hash is not distinct from old.content_hash then return new; end if;
  insert into public.ap_job_snapshot_invalidations(job_snapshot_id,legacy_job_id,previous_content_sha256,replacement_content_sha256,reason)
  select snapshot.id,new.id,old.content_hash,new.content_hash,'CANONICAL_SOURCE_CONTENT_CHANGED'
  from public.ap_job_snapshots snapshot where snapshot.legacy_job_id=new.id
  on conflict(job_snapshot_id) do nothing;
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
revoke all on function public.ap_invalidate_materials_for_job_content_change() from public,anon,authenticated,service_role;

-- The immutable successor blocks future approval and release through
-- ap_assert_current_artifact_facts. Preserve a prior file only when it already
-- belongs to a committed release; unreleased work is revoked automatically.
create or replace function public.ap_invalidate_materials_for_job_successor()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.supersedes_job_snapshot_id is null then return new; end if;
  perform 1 from public.ap_job_snapshots where id=new.supersedes_job_snapshot_id for update;
  update public.ap_generated_file_versions file
    set downloads_revoked_at=coalesce(file.downloads_revoked_at,clock_timestamp())
    from public.ap_generated_artifacts artifact
    where artifact.id=file.artifact_id
      and artifact.job_snapshot_id=new.supersedes_job_snapshot_id
      and not exists(select 1 from public.ap_release_members member
        where member.member_type='GENERATED_ARTIFACT' and member.member_id=artifact.id);
  update public.ap_artifact_quality_reviews review
    set invalidated_at=coalesce(review.invalidated_at,clock_timestamp())
    from public.ap_generated_file_versions file,public.ap_generated_artifacts artifact
    where review.file_version_id=file.id and file.artifact_id=artifact.id
      and artifact.job_snapshot_id=new.supersedes_job_snapshot_id;
  return new;
end;
$$;
revoke all on function public.ap_invalidate_materials_for_job_successor() from public,anon,authenticated,service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610030070','ALL_SENSITIVE_UPLOAD_CLEANUP_INTENTS',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;

begin;

alter table public.storage_cleanup_queue
  drop constraint storage_cleanup_queue_bucket_check;
alter table public.storage_cleanup_queue
  add constraint storage_cleanup_queue_bucket_check
  check (bucket in ('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews'));

create table public.ap_artifact_source_docx (
  file_version_id uuid primary key references public.ap_generated_file_versions(id),
  storage_bucket text not null check (storage_bucket='operator-drafts'),
  storage_path text not null,
  safe_filename text not null check (
    safe_filename ~ '^[^/\\]{1,180}\.docx$'
    and safe_filename !~ '[\[\]]'
    and safe_filename !~* '(^|_)(final|updated|new|v2)(_|\.)'
  ),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check (size_bytes>0),
  created_at timestamptz not null default now()
);
alter table public.ap_artifact_source_docx enable row level security;
revoke all on public.ap_artifact_source_docx from public,anon,authenticated,service_role;
grant select on public.ap_artifact_source_docx to service_role;

create function public.ap_queue_revoked_material_source_docx()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.superseded_at is not null or new.downloads_revoked_at is not null)
    and (old.superseded_at is null and old.downloads_revoked_at is null) then
    insert into public.storage_cleanup_queue(bucket,storage_path,reason)
    select source.storage_bucket,source.storage_path,'material_source_revoked'
      from public.ap_artifact_source_docx source where source.file_version_id=new.id
    on conflict(bucket,storage_path) do update set reason=excluded.reason;
  end if;
  return new;
end $$;
create trigger ap_generated_file_source_docx_cleanup
after update of superseded_at,downloads_revoked_at on public.ap_generated_file_versions
for each row execute function public.ap_queue_revoked_material_source_docx();

create function public.ap_record_material_source_docx(
  p_file_version_id uuid,p_reviewer_id uuid,p_storage_bucket text,p_storage_path text,
  p_safe_filename text,p_checksum_sha256 text,p_size_bytes integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare file_row public.ap_generated_file_versions; artifact public.ap_generated_artifacts;
  line_row public.ap_material_lines; purchase public.ap_material_purchases;
  existing public.ap_artifact_source_docx;
begin
  perform public.ap_require_material_reviewer(p_reviewer_id);
  select * into file_row from public.ap_generated_file_versions where id=p_file_version_id for update;
  select * into artifact from public.ap_generated_artifacts where id=file_row.artifact_id;
  select * into line_row from public.ap_material_lines where id=artifact.material_line_id;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  if file_row.id is null or artifact.id is null or line_row.id is null or purchase.customer_id is null
    or artifact.customer_id<>purchase.customer_id or artifact.order_id<>line_row.delivered_order_id
    or line_row.purchase_id<>purchase.id
    or artifact.current_file_version<>file_row.version or file_row.superseded_at is not null
    or p_storage_bucket<>'operator-drafts'
    or p_storage_path not like purchase.customer_id::text||'/materials/'||line_row.id::text||'/'||file_row.id::text||'/source/%'
    or p_safe_filename!~'^[^/\\]{1,180}\.docx$'
    or p_safe_filename~'[\[\]]' or p_safe_filename~* '(^|_)(final|updated|new|v2)(_|\.)'
    or p_checksum_sha256!~'^[0-9a-f]{64}$' or p_size_bytes<=0
    then raise exception 'material_source_docx_identity_invalid'; end if;
  insert into public.ap_artifact_source_docx(
    file_version_id,storage_bucket,storage_path,safe_filename,checksum_sha256,size_bytes
  ) values(
    file_row.id,p_storage_bucket,p_storage_path,p_safe_filename,p_checksum_sha256,p_size_bytes
  ) on conflict(file_version_id) do nothing;
  select * into existing from public.ap_artifact_source_docx where file_version_id=file_row.id;
  if existing.storage_bucket is distinct from p_storage_bucket
    or existing.storage_path is distinct from p_storage_path
    or existing.safe_filename is distinct from p_safe_filename
    or existing.checksum_sha256 is distinct from p_checksum_sha256
    or existing.size_bytes is distinct from p_size_bytes
    then raise exception 'material_source_docx_identity_conflict'; end if;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(artifact.customer_id,p_reviewer_id,'MATERIAL_SOURCE_DOCX_RECORDED','GENERATED_FILE_VERSION',
    file_row.id,jsonb_build_object('artifactId',artifact.id,'version',file_row.version),'document-source-v1');
  return jsonb_build_object('fileVersionId',file_row.id,'filename',p_safe_filename);
end $$;

create function public.ap_register_material_artifact_version_with_source_docx(
  p_artifact_id uuid,p_file_version_id uuid,p_material_line_id uuid,p_reviewer_id uuid,
  p_artifact_type public.ap_artifact_type,p_source_snapshot_id uuid,p_source_line_revision_id uuid,
  p_job_snapshot_id uuid,p_reference_regeneration_id uuid,p_reference_permission_ids uuid[],
  p_claim_provenance jsonb,p_generator_version text,p_storage_bucket text,p_storage_path text,
  p_safe_filename text,p_checksum_sha256 text,p_mime_type text,p_size_bytes integer,
  p_binding_sha256 text,p_package_qa_sha256 text,p_structural_checks jsonb,p_provenance_checks jsonb,
  p_extracted_text_sha256 text,p_rendered_page_count integer,p_renderer_identity text,
  p_arial_font_sha256 text,p_malware_scanner_identity text,
  p_render_preview_bucket text,p_render_preview_path text,p_render_preview_sha256 text,
  p_rendered_page_sha256 text[],p_arial_resolved boolean,
  p_source_docx_storage_bucket text,p_source_docx_storage_path text,p_source_docx_safe_filename text,
  p_source_docx_checksum_sha256 text,p_source_docx_size_bytes integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare registration jsonb;
begin
  registration:=public.ap_register_material_artifact_version(
    p_artifact_id,p_file_version_id,p_material_line_id,p_reviewer_id,p_artifact_type,
    p_source_snapshot_id,p_source_line_revision_id,p_job_snapshot_id,p_reference_regeneration_id,
    p_reference_permission_ids,p_claim_provenance,p_generator_version,p_storage_bucket,p_storage_path,
    p_safe_filename,p_checksum_sha256,p_mime_type,p_size_bytes,p_binding_sha256,p_package_qa_sha256,
    p_structural_checks,p_provenance_checks,p_extracted_text_sha256,p_rendered_page_count,
    p_renderer_identity,p_arial_font_sha256,p_malware_scanner_identity,p_render_preview_bucket,
    p_render_preview_path,p_render_preview_sha256,p_rendered_page_sha256,p_arial_resolved
  );
  perform public.ap_record_material_source_docx(
    p_file_version_id,p_reviewer_id,p_source_docx_storage_bucket,p_source_docx_storage_path,
    p_source_docx_safe_filename,p_source_docx_checksum_sha256,p_source_docx_size_bytes
  );
  return registration;
end $$;

do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.ap_record_material_human_approval(uuid,uuid,text,text)'::regprocedure);
  anchor:='or quality.binding_sha256<>file_row.binding_sha256';
  if position(anchor in definition)=0 then raise exception 'material_source_approval_guard_anchor_missing'; end if;
  definition:=replace(definition,anchor,anchor||$guard$
    or not exists(select 1 from public.ap_artifact_source_docx source
      where source.file_version_id=file_row.id and source.storage_bucket='operator-drafts'
        and source.checksum_sha256~'^[0-9a-f]{64}$' and source.size_bytes>0)$guard$);
  execute definition;
end $$;

revoke all on function public.ap_record_material_source_docx(uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.ap_record_material_source_docx(uuid,uuid,text,text,text,text,integer) to service_role;
revoke all on function public.ap_queue_revoked_material_source_docx() from public,anon,authenticated,service_role;
revoke execute on function public.ap_register_material_artifact_version(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean) from service_role;
revoke all on function public.ap_register_material_artifact_version_with_source_docx(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.ap_register_material_artifact_version_with_source_docx(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean,text,text,text,text,integer) to service_role;

commit;

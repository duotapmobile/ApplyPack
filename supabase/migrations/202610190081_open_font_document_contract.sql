begin;

-- October 19 replaces the paid Arial generation dependency with the complete,
-- byte-pinned Liberation Sans 2.1.5 family. Historical artifacts keep their
-- immutable access evidence; no prior migration or artifact row is rewritten.
alter table public.ap_commerce_configuration
  add column document_font_manifest_sha256 text
  check (document_font_manifest_sha256 is null or document_font_manifest_sha256~'^[0-9a-f]{64}$');

update public.ap_commerce_configuration
set materials_generation_approved=false,
    materials_generation_approval_reference=null,
    document_font_family=null,
    document_font_sha256=null,
    document_font_manifest_sha256=null,
    document_renderer_identity=null,
    document_worker_network_attestation_sha256=null
where singleton;

alter table public.ap_commerce_configuration
  drop constraint if exists ap_commerce_configuration_document_font_family_check;
alter table public.ap_commerce_configuration
  add constraint ap_commerce_configuration_document_font_family_check
  check (document_font_family is null or document_font_family='Liberation Sans');

create or replace function public.ap_stamp_document_safety_policy() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.document_safety_policy<>'NOT_SCANNED:generated-structural-v1' then
    raise exception 'explicit_document_safety_policy_required';
  end if;
  new.document_safety_policy:='generated-structural-v1';
  new.document_font_family:='Liberation Sans';
  new.malware_verdict:='NOT_SCANNED';
  return new;
end $$;
revoke all on function public.ap_stamp_document_safety_policy() from public,anon,authenticated,service_role;

create table public.ap_applicant_document_format_requests(
  id uuid primary key,
  material_line_id uuid not null unique references public.ap_material_lines(id),
  customer_id uuid not null references auth.users(id),
  recorded_by uuid not null references auth.users(id),
  delivery_format text not null check (delivery_format='DOCX'),
  request_reference_sha256 text not null check (request_reference_sha256~'^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.ap_applicant_document_format_requests enable row level security;
create trigger ap_applicant_document_format_requests_immutable
before update or delete on public.ap_applicant_document_format_requests
for each row execute function public.ap_prevent_immutable_mutation();

create function public.ap_record_applicant_document_format_request(
  p_request_id uuid,p_material_line_id uuid,p_actor_id uuid,
  p_delivery_format text,p_request_reference_sha256 text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare line_row public.ap_material_lines; purchase public.ap_material_purchases;
  existing public.ap_applicant_document_format_requests;
begin
  perform public.ap_require_material_reviewer(p_actor_id);
  if p_delivery_format<>'DOCX' or p_request_reference_sha256!~'^[0-9a-f]{64}$' then
    raise exception 'applicant_document_format_request_invalid';
  end if;
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  if not found then raise exception 'material_line_not_found'; end if;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  if purchase.customer_id is null then raise exception 'material_customer_required'; end if;
  select * into existing from public.ap_applicant_document_format_requests
    where material_line_id=p_material_line_id;
  if found then
    if existing.delivery_format is distinct from p_delivery_format
      or existing.request_reference_sha256 is distinct from p_request_reference_sha256 then
      raise exception 'applicant_document_format_request_conflict';
    end if;
    return jsonb_build_object('id',existing.id,'deliveryFormat',existing.delivery_format,
      'requestReferenceSha256',existing.request_reference_sha256,'recordedAt',existing.recorded_at);
  end if;
  insert into public.ap_applicant_document_format_requests(
    id,material_line_id,customer_id,recorded_by,delivery_format,request_reference_sha256
  ) values(
    p_request_id,p_material_line_id,purchase.customer_id,p_actor_id,p_delivery_format,p_request_reference_sha256
  ) returning * into existing;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(purchase.customer_id,p_actor_id,'APPLICANT_DOCUMENT_FORMAT_REQUEST_RECORDED','MATERIAL_LINE',p_material_line_id,
    jsonb_build_object('requestId',existing.id,'deliveryFormat',existing.delivery_format,
      'requestReferenceSha256',existing.request_reference_sha256),'open-font-document-contract-v1');
  return jsonb_build_object('id',existing.id,'deliveryFormat',existing.delivery_format,
    'requestReferenceSha256',existing.request_reference_sha256,'recordedAt',existing.recorded_at);
end $$;
revoke all on function public.ap_record_applicant_document_format_request(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.ap_record_applicant_document_format_request(uuid,uuid,uuid,text,text)
  to service_role;

-- New artifacts must carry the reason for their customer-facing format. An
-- applicant request is hash-bound to its immutable operator receipt. Explicit
-- employer instructions remain higher authority than a customer preference.
create function public.ap_guard_document_delivery_format_decision() returns trigger
language plpgsql security definer set search_path='' as $$
declare decision jsonb; font_attestation jsonb; revision public.ap_material_line_revisions;
  rule_row public.ap_employer_submission_rules; request_row public.ap_applicant_document_format_requests;
  current_generator constant text:='applypack-documents|instructions=applypack-universal-document-standard-2026-10-19.1|standardSha256=2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778|content=applypack-content-2026-10-19.1|template=applypack-template-2026-10-19.1|exporter=libreoffice-tagged-pdf-2026-10-19.1';
begin
  if new.generator_version is distinct from current_generator then return new; end if;
  decision:=new.claim_provenance->'deliveryFormatDecision';
  font_attestation:=new.claim_provenance->'documentFontAttestation';
  select * into revision from public.ap_material_line_revisions where id=new.source_line_revision_id;
  select * into rule_row from public.ap_employer_submission_rules where id=revision.employer_rule_snapshot_id;
  select * into request_row from public.ap_applicant_document_format_requests
    where material_line_id=new.material_line_id;
  if font_attestation is distinct from jsonb_build_object(
      'family','Liberation Sans',
      'version','2.1.5',
      'manifestSha256','d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb',
      'styleSha256',jsonb_build_object(
        'regular','76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
        'bold','788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173',
        'italic','e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0',
        'boldItalic','698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee')) then
    raise exception 'document_font_attestation_invalid';
  end if;
  if jsonb_typeof(decision) is distinct from 'object'
    or decision->>'format' not in ('PDF','DOCX')
    or decision->>'reason' not in ('DEFAULT_PDF','EMPLOYER_REQUIREMENT','APPLICANT_REQUEST')
    or decision->>'employerRuleId' is distinct from rule_row.id::text
    or not ((decision->>'format')=any(rule_row.allowed_formats)) then
    raise exception 'document_delivery_format_decision_invalid';
  end if;
  if decision->>'reason'='DEFAULT_PDF' then
    if decision->>'format'<>'PDF' or request_row.id is not null
      or decision->>'applicantRequestId' is not null or decision->>'requestReferenceSha256' is not null then
      raise exception 'document_delivery_format_decision_invalid'; end if;
  elsif decision->>'reason'='EMPLOYER_REQUIREMENT' then
    if decision->>'format'<>'DOCX' or 'PDF'=any(rule_row.allowed_formats) or request_row.id is not null
      or decision->>'applicantRequestId' is not null or decision->>'requestReferenceSha256' is not null then
      raise exception 'document_delivery_format_decision_invalid'; end if;
  else
    if decision->>'format'<>'DOCX' or request_row.id is null
      or decision->>'applicantRequestId' is distinct from request_row.id::text
      or decision->>'requestReferenceSha256' is distinct from request_row.request_reference_sha256 then
      raise exception 'document_delivery_format_decision_invalid'; end if;
  end if;
  return new;
end $$;
revoke all on function public.ap_guard_document_delivery_format_decision() from public,anon,authenticated,service_role;
create trigger ap_guard_document_delivery_format_decision
before insert or update of generator_version,claim_provenance,source_line_revision_id
on public.ap_generated_artifacts for each row
execute function public.ap_guard_document_delivery_format_decision();

create function public.ap_guard_document_delivery_file_format() returns trigger
language plpgsql security definer set search_path='' as $$
declare artifact public.ap_generated_artifacts; expected_format text;
begin
  select * into artifact from public.ap_generated_artifacts where id=new.artifact_id;
  if artifact.generator_version is distinct from
    'applypack-documents|instructions=applypack-universal-document-standard-2026-10-19.1|standardSha256=2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778|content=applypack-content-2026-10-19.1|template=applypack-template-2026-10-19.1|exporter=libreoffice-tagged-pdf-2026-10-19.1'
    then return new; end if;
  expected_format:=artifact.claim_provenance#>>'{deliveryFormatDecision,format}';
  if (expected_format='PDF' and (new.mime_type<>'application/pdf' or new.safe_filename!~*'\.pdf$'))
    or (expected_format='DOCX' and (new.mime_type<>'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      or new.safe_filename!~*'\.docx$')) then
    raise exception 'document_delivery_file_format_mismatch';
  end if;
  return new;
end $$;
revoke all on function public.ap_guard_document_delivery_file_format() from public,anon,authenticated,service_role;
create trigger ap_guard_document_delivery_file_format
before insert or update of artifact_id,mime_type,safe_filename
on public.ap_generated_file_versions for each row
execute function public.ap_guard_document_delivery_file_format();

-- Preserve October 3 and September 22 downloads while making October 19 the
-- only contract accepted by new approval/release paths.
do $$
declare definition text;
  old_current constant text:='applypack-documents|instructions=applypack-universal-document-standard-2026-10-03.1|standardSha256=1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf|content=applypack-content-2026-10-03.1|template=applypack-template-2026-10-03.1|exporter=libreoffice-tagged-pdf-2026-10-03.1';
  new_current constant text:='applypack-documents|instructions=applypack-universal-document-standard-2026-10-19.1|standardSha256=2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778|content=applypack-content-2026-10-19.1|template=applypack-template-2026-10-19.1|exporter=libreoffice-tagged-pdf-2026-10-19.1';
begin
  definition:=pg_get_functiondef('public.ap_guard_locked_editable_document_source()'::regprocedure);
  definition:=replace(definition,
    'if new.generator_version='||quote_literal(old_current)||' then',
    'if new.generator_version in ('||quote_literal(old_current)||','||quote_literal(new_current)||') then');
  if position(quote_literal(new_current) in definition)=0 then raise exception 'editable_source_open_font_anchor_missing'; end if;
  execute definition;

  definition:=pg_get_functiondef('public.ap_assert_supported_artifact_facts(uuid)'::regprocedure);
  definition:=replace(definition,
    quote_literal(old_current)||E'\n  )',
    quote_literal(old_current)||','||E'\n    '||quote_literal(new_current)||E'\n  )');
  definition:=replace(definition,
    'and quality.document_font_family=''Arial'')))',
    'and quality.document_font_family=''Arial'')'||E'\n        or (artifact.generator_version='||quote_literal(new_current)||E'\n          and quality.document_font_family=''Liberation Sans'')))');
  if position(quote_literal(new_current) in definition)=0
    or position('quality.document_font_family=''Liberation Sans''' in definition)=0 then
    raise exception 'supported_open_font_contract_anchor_missing'; end if;
  execute definition;

  definition:=pg_get_functiondef('public.ap_assert_current_artifact_facts(uuid)'::regprocedure);
  definition:=replace(definition,quote_literal(old_current),quote_literal(new_current));
  if position(quote_literal(new_current) in definition)=0 or position(quote_literal(old_current) in definition)>0 then
    raise exception 'current_open_font_contract_anchor_missing'; end if;
  execute definition;

  definition:=pg_get_functiondef(
    'public.ap_register_material_artifact_version(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean)'::regprocedure
  );
  definition:=replace(definition,
    'or p_size_bytes<=0 or nullif(btrim(p_generator_version),'''') is null',
    'or p_size_bytes<=0 or p_generator_version is distinct from '||quote_literal(new_current));
  if position('p_generator_version is distinct from '||quote_literal(new_current) in definition)=0 then
    raise exception 'registration_open_font_contract_anchor_missing'; end if;
  execute definition;
end $$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610190081','OPEN_FONT_DOCUMENT_CONTRACT',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
  definition:=replace(definition,'select count(*)=4 as installed','select count(*)=5 as installed');
  definition:=replace(definition,
    '(''202610040080'',''PERSISTENT_INVENTORY_IDENTITY_GUARD'')',
    '(''202610040080'',''PERSISTENT_INVENTORY_IDENTITY_GUARD''),'||E'\n      '||
      '(''202610190081'',''OPEN_FONT_DOCUMENT_CONTRACT'')');
  definition:=replace(definition,'''requiredSchemaVersion'', ''202610040080''',
    '''requiredSchemaVersion'', ''202610190081''');
  definition:=replace(definition,
    '''202610040077'',''202610040078'',''202610040079'',''202610040080''',
    '''202610040077'',''202610040078'',''202610040079'',''202610040080'',''202610190081''');
  if position('202610190081' in definition)=0 or position('count(*)=5' in definition)=0 then
    raise exception 'launch_schema_open_font_anchor_missing'; end if;
  execute definition;
end $$;

commit;

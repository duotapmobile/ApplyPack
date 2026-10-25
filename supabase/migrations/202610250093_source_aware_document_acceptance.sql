begin;

-- This profile accepts the reviewed source-aware renderer without changing
-- historical generators, enabling drafting, or claiming that SQL inspected
-- private file bytes. These are strict server-generated verification receipts.
create function public.ap_source_aware_document_generator() returns text
language sql immutable set search_path='' as $$
 select 'applypack-documents|instructions=applypack-universal-document-standard-2026-10-19.1|standardSha256=2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778|content=applypack-content-2026-10-25.1|template=applypack-template-2026-10-25.1|exporter=libreoffice-tagged-pdf-2026-10-19.1'::text;
$$;

create function public.ap_assert_source_aware_document_qa(
 p_artifact_type public.ap_artifact_type,p_provenance jsonb,p_generator text,
 p_checksum_sha256 text,p_mime_type text,p_package_qa_sha256 text,
 p_extracted_text_sha256 text,p_preview_sha256 text,p_structural_checks jsonb
) returns void language plpgsql set search_path='' as $$
declare qa jsonb:=p_provenance->'sourceAwareQa'; pdf jsonb:=qa->'pdf'; package_checks jsonb:=qa->'packageChecks';
 source jsonb:=p_provenance->'draftSource'; pair jsonb:=p_provenance->'draftPair'; key text;
begin
 if p_generator is distinct from public.ap_source_aware_document_generator() then raise exception 'source_aware_document_generator_invalid'; end if;
 if p_artifact_type is null or p_artifact_type not in('RESUME','COVER_LETTER')
  or jsonb_typeof(qa) is distinct from 'object' or jsonb_typeof(pdf) is distinct from 'object'
  or jsonb_typeof(package_checks) is distinct from 'object' or jsonb_typeof(source) is distinct from 'object'
  or jsonb_typeof(pair) is distinct from 'object' then raise exception 'source_aware_document_qa_invalid'; end if;
 if (select array_agg(k order by k) from jsonb_object_keys(qa) k) is distinct from
   array['extractedTextSha256','generatorVersion','metadataSha256','packageChecks','packageQaSha256','pdf','schemaVersion']::text[]
  or qa->>'schemaVersion' is distinct from 'applypack-source-aware-document-qa-v1'
  or qa->>'generatorVersion' is distinct from p_generator
  or (select array_agg(k order by k) from jsonb_object_keys(package_checks) k) is distinct from
   array['exactContactLinks','exactHeadingCount','exactMetadata','exactParagraphCount','exactParagraphStructure','exactParagraphText','exactReviewedText','nativeBullets']::text[]
  or exists(select 1 from jsonb_each(package_checks) e where e.value is distinct from 'true'::jsonb)
  or (select array_agg(k order by k) from jsonb_object_keys(pdf) k) is distinct from
   array['artifact','docxSha256','expectationSha256','generatorVersion','linkCount','linkXmlSha256','listItemCount','paragraphCount','renderSourceSha256','schemaVersion','searchablePdfSha256','structureTextSha256']::text[]
  or pdf->>'schemaVersion' is distinct from 'applypack-reviewed-draft-pdf-v1'
  or pdf->>'generatorVersion' is distinct from p_generator or pdf->>'artifact' is distinct from p_artifact_type::text
  or (select array_agg(k order by k) from jsonb_object_keys(source) k) is distinct from array['packetSha256','proposalSourceSha256','renderSourceSha256']::text[]
  or (select array_agg(k order by k) from jsonb_object_keys(pair) k) is distinct from array['claimReviewSha256','packetSha256','sourceSha256','versionId']::text[]
  then raise exception 'source_aware_document_qa_invalid'; end if;
 foreach key in array array['extractedTextSha256','packageQaSha256','metadataSha256'] loop
  if jsonb_typeof(qa->key) is distinct from 'string' or qa->>key !~ '^[0-9a-f]{64}$' then raise exception 'source_aware_document_qa_invalid'; end if;
 end loop;
 foreach key in array array['docxSha256','expectationSha256','linkXmlSha256','renderSourceSha256','searchablePdfSha256','structureTextSha256'] loop
  if jsonb_typeof(pdf->key) is distinct from 'string' or pdf->>key !~ '^[0-9a-f]{64}$' then raise exception 'source_aware_document_qa_invalid'; end if;
 end loop;
 foreach key in array array['packetSha256','proposalSourceSha256','renderSourceSha256'] loop
  if jsonb_typeof(source->key) is distinct from 'string' or source->>key !~ '^[0-9a-f]{64}$' then raise exception 'source_aware_document_qa_invalid'; end if;
 end loop;
 foreach key in array array['claimReviewSha256','packetSha256','sourceSha256'] loop
  if jsonb_typeof(pair->key) is distinct from 'string' or pair->>key !~ '^[0-9a-f]{64}$' then raise exception 'source_aware_document_qa_invalid'; end if;
 end loop;
 if jsonb_typeof(pair->'versionId') is distinct from 'string' or pair->>'versionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then raise exception 'source_aware_document_qa_invalid'; end if;
 foreach key in array array['paragraphCount','listItemCount','linkCount'] loop
  if jsonb_typeof(pdf->key) is distinct from 'number' or pdf->>key !~ '^(0|[1-9][0-9]{0,2})$' then raise exception 'source_aware_document_qa_invalid'; end if;
 end loop;
 if (pdf->>'paragraphCount')::integer not between 2 and 250 or (pdf->>'listItemCount')::integer not between 0 and (pdf->>'paragraphCount')::integer
  or (pdf->>'linkCount')::integer not between 1 and 5 or (p_artifact_type='COVER_LETTER' and (pdf->>'listItemCount')::integer<>0)
  or pdf->>'renderSourceSha256' is distinct from source->>'renderSourceSha256'
  or source->>'renderSourceSha256' is distinct from pair->>'sourceSha256' or source->>'packetSha256' is distinct from pair->>'packetSha256'
  or pdf->>'docxSha256' is distinct from p_provenance#>>'{editableSource,checksumSha256}'
  or qa->>'packageQaSha256' is distinct from p_package_qa_sha256 or qa->>'extractedTextSha256' is distinct from p_extracted_text_sha256
  or pdf->>'searchablePdfSha256' is distinct from p_preview_sha256
  or p_mime_type is null or p_mime_type not in('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  or p_checksum_sha256 is distinct from (case when p_mime_type='application/pdf' then pdf->>'searchablePdfSha256' else pdf->>'docxSha256' end)
  or jsonb_typeof(p_structural_checks) is distinct from 'object'
  or not p_structural_checks @> '{"nativeBullets":true,"metadataValid":true,"taggedPdf":true,"pdfStructureValid":true}'::jsonb
  then raise exception 'source_aware_document_qa_invalid'; end if;
end $$;

-- The source-aware profile is available only through the existing atomic
-- pair permit. A source/QA replacement cannot preserve a prior approval.
create function public.ap_guard_source_aware_document_provenance() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.ap_material_draft_versions; j public.ap_material_draft_jobs;
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),to_jsonb(new)) then return new; end if;
 if tg_op='UPDATE' and old.generator_version=public.ap_source_aware_document_generator()
  and (new.generator_version is distinct from old.generator_version or new.claim_provenance is distinct from old.claim_provenance)
  and not public.ap_material_draft_has_permit(old.material_line_id,'REGISTER') then raise exception 'source_aware_document_provenance_immutable'; end if;
 if new.generator_version is distinct from public.ap_source_aware_document_generator() then return new; end if;
 if tg_op='UPDATE' and new.claim_provenance is not distinct from old.claim_provenance and new.generator_version is not distinct from old.generator_version then return new; end if;
 if not public.ap_material_draft_has_permit(new.material_line_id,'REGISTER') then raise exception 'material_draft_pair_workflow_required'; end if;
 select * into v from public.ap_material_draft_versions where id=(new.claim_provenance#>>'{draftPair,versionId}')::uuid for share;
 select * into j from public.ap_material_draft_jobs where id=v.job_id;
 if v.id is null or v.id is distinct from j.active_version_id or v.customer_id is distinct from new.customer_id
  or v.material_line_id is distinct from new.material_line_id or j.line_revision_id is distinct from new.source_line_revision_id
  or j.source_snapshot_id is distinct from new.source_snapshot_id or v.invalidated_at is not null
  or v.packet_sha256 is distinct from new.claim_provenance#>>'{draftPair,packetSha256}'
  or v.source_sha256 is distinct from new.claim_provenance#>>'{draftPair,sourceSha256}'
  or v.claim_review_sha256 is null or v.claim_review_sha256 is distinct from new.claim_provenance#>>'{draftPair,claimReviewSha256}'
  then raise exception 'source_aware_document_pair_invalid'; end if;
 return new;
end $$;
create trigger ap_source_aware_document_provenance before insert or update on public.ap_generated_artifacts
 for each row execute function public.ap_guard_source_aware_document_provenance();

create function public.ap_assert_source_aware_artifact_qa(p_artifact_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.ap_generated_artifacts; f public.ap_generated_file_versions; q public.ap_artifact_quality_reviews;
begin
 select * into a from public.ap_generated_artifacts where id=p_artifact_id;
 if a.id is null then raise exception 'material_download_unavailable'; end if;
 if a.generator_version is distinct from public.ap_source_aware_document_generator() then return; end if;
 select * into f from public.ap_generated_file_versions where artifact_id=a.id and version=a.current_file_version;
 select * into q from public.ap_artifact_quality_reviews where file_version_id=f.id;
 if q.id is not null and (q.document_font_family is distinct from 'Liberation Sans'
  or q.document_font_resolved is distinct from true
  or q.document_font_sha256 is distinct from '76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8')
  then raise exception 'source_aware_document_font_invalid'; end if;
 if f.id is null or q.id is null or not exists(select 1 from public.ap_material_draft_members m
  join public.ap_material_draft_versions v on v.id=m.draft_version_id where m.artifact_id=a.id and m.file_version_id=f.id
   and v.id::text=a.claim_provenance#>>'{draftPair,versionId}' and v.packet_sha256=a.claim_provenance#>>'{draftPair,packetSha256}'
   and v.source_sha256=a.claim_provenance#>>'{draftPair,sourceSha256}' and v.claim_review_sha256=a.claim_provenance#>>'{draftPair,claimReviewSha256}'
   and m.file_sha256=f.checksum_sha256 and m.preview_sha256=q.render_preview_sha256
   and m.editable_source_sha256=a.claim_provenance#>>'{editableSource,checksumSha256}') then raise exception 'source_aware_document_pair_invalid'; end if;
 perform public.ap_assert_source_aware_document_qa(a.artifact_type,a.claim_provenance,a.generator_version,
  f.checksum_sha256,f.mime_type,f.package_qa_sha256,q.extracted_text_sha256,q.render_preview_sha256,q.structural_checks);
end $$;

-- Extend finite identity checks. Patch both original guards and their active
-- retention-aware clones; keep every exact-row redaction branch intact.
do $$ declare definition text; anchor text; replacement text; target oid; guard record;
 old_generator constant text:='applypack-documents|instructions=applypack-universal-document-standard-2026-10-19.1|standardSha256=2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778|content=applypack-content-2026-10-19.1|template=applypack-template-2026-10-19.1|exporter=libreoffice-tagged-pdf-2026-10-19.1';
 new_generator text:=public.ap_source_aware_document_generator();
begin
 for guard in select * from (values
  ('ap_guard_document_delivery_format_decision','ap_generated_artifacts'),
  ('ap_guard_document_delivery_file_format','ap_generated_file_versions'),
  ('ap_guard_locked_editable_document_source','ap_generated_artifacts')) x(name,relation) loop
  for target in select to_regprocedure('public.'||guard.name||'()')::oid union
   select tgfoid from pg_trigger where tgrelid=to_regclass('public.'||guard.relation) and tgname=guard.name and not tgisinternal loop
   definition:=pg_get_functiondef(target);
   if guard.name='ap_guard_document_delivery_format_decision' then
    anchor:='new.generator_version is distinct from current_generator'; replacement:='new.generator_version not in(current_generator,'||quote_literal(new_generator)||')';
   elsif guard.name='ap_guard_document_delivery_file_format' then
    anchor:='artifact.generator_version is distinct from'||chr(10)||'    '||quote_literal(old_generator);
    replacement:='artifact.generator_version not in('||quote_literal(old_generator)||','||quote_literal(new_generator)||')';
   else
    anchor:=quote_literal(old_generator)||') then'; replacement:=quote_literal(old_generator)||','||quote_literal(new_generator)||') then';
   end if;
   if position(anchor in definition)=0 then raise exception 'source_aware_guard_anchor_missing: %',guard.name; end if;
   execute replace(definition,anchor,replacement);
  end loop;
 end loop;
 definition:=pg_get_functiondef('public.ap_assert_supported_artifact_facts(uuid)'::regprocedure);
 anchor:=quote_literal(old_generator)||chr(10)||'  )';
 if position(anchor in definition)=0 then raise exception 'source_aware_supported_generator_anchor_missing'; end if;
 definition:=replace(definition,anchor,quote_literal(old_generator)||','||chr(10)||'    '||quote_literal(new_generator)||chr(10)||'  )');
 anchor:='artifact.generator_version='||quote_literal(old_generator);
 if position(anchor in definition)=0 then raise exception 'source_aware_supported_font_anchor_missing'; end if;
 definition:=replace(definition,anchor,'artifact.generator_version in('||quote_literal(old_generator)||','||quote_literal(new_generator)||')');
 anchor:='if artifact.id is null then raise exception ''material_download_unavailable''; end if;';
 if position(anchor in definition)=0 then raise exception 'source_aware_supported_qa_anchor_missing'; end if;
 definition:=replace(definition,anchor,anchor||chr(10)||'  perform public.ap_assert_source_aware_artifact_qa(p_artifact_id);');
 execute definition;
 definition:=pg_get_functiondef('public.ap_assert_current_artifact_facts(uuid)'::regprocedure);
 anchor:='artifact.generator_version is distinct from '||quote_literal(old_generator);
 if position(anchor in definition)=0 then raise exception 'source_aware_current_generator_anchor_missing'; end if;
 execute replace(definition,anchor,'artifact.generator_version not in('||quote_literal(old_generator)||','||quote_literal(new_generator)||')');
 definition:=pg_get_functiondef('public.ap_register_material_artifact_version(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean)'::regprocedure);
 anchor:='p_generator_version is distinct from '||quote_literal(old_generator);
 if position(anchor in definition)=0 then raise exception 'source_aware_registration_generator_anchor_missing'; end if;
 definition:=replace(definition,anchor,'(p_generator_version is null or p_generator_version not in('||quote_literal(old_generator)||','||quote_literal(new_generator)||'))');
 anchor:='extension:=lower(substring(p_safe_filename';
 if position(anchor in definition)=0 then raise exception 'source_aware_registration_qa_anchor_missing'; end if;
 definition:=replace(definition,anchor,'if p_generator_version=public.ap_source_aware_document_generator() then'||chr(10)||
  '    if not public.ap_material_draft_has_permit(p_material_line_id,''REGISTER'') then raise exception ''material_draft_pair_workflow_required''; end if;'||chr(10)||
  '    if p_arial_resolved is distinct from true or p_arial_font_sha256 is distinct from ''76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8'' then raise exception ''source_aware_document_font_invalid''; end if;'||chr(10)||
  '    perform public.ap_assert_source_aware_document_qa(p_artifact_type,p_claim_provenance,p_generator_version,p_checksum_sha256,p_mime_type,p_package_qa_sha256,p_extracted_text_sha256,p_render_preview_sha256,p_structural_checks);'||chr(10)||
  '  end if;'||chr(10)||'  '||anchor);
 execute definition;
end $$;

revoke all on function public.ap_source_aware_document_generator() from public,anon,authenticated,service_role;
revoke all on function public.ap_assert_source_aware_document_qa(public.ap_artifact_type,jsonb,text,text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.ap_guard_source_aware_document_provenance() from public,anon,authenticated,service_role;
revoke all on function public.ap_assert_source_aware_artifact_qa(uuid) from public,anon,authenticated,service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610250093','SOURCE_AWARE_DOCUMENT_ACCEPTANCE',0,clock_timestamp());
create function public.ap_source_aware_document_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
 and to_regprocedure('public.ap_assert_source_aware_document_qa(public.ap_artifact_type,jsonb,text,text,text,text,text,text,jsonb)') is not null
 and to_regprocedure('public.ap_assert_source_aware_artifact_qa(uuid)') is not null
 and position('ap_assert_source_aware_artifact_qa' in pg_get_functiondef('public.ap_assert_supported_artifact_facts(uuid)'::regprocedure))>0
 and not exists(select 1 from (values
  ('ap_generated_artifacts','ap_source_aware_document_provenance'),('ap_generated_artifacts','ap_guard_document_delivery_format_decision'),
  ('ap_generated_artifacts','ap_guard_locked_editable_document_source'),('ap_generated_file_versions','ap_guard_document_delivery_file_format')) required(relation,name)
  where not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.'||required.relation) and t.tgname=required.name and not t.tgisinternal and t.tgenabled='O'
   and (required.name='ap_source_aware_document_provenance' or position(public.ap_source_aware_document_generator() in pg_get_functiondef(t.tgfoid))>0)
   and position('ap_retention_redaction_permitted' in pg_get_functiondef(t.tgfoid))>0));
$$;
revoke all on function public.ap_source_aware_document_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_source_aware_document_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=16 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250092''' in definition)=0
  or position('(''202610250092'',''MATERIAL_RULE_REVALIDATION'')' in definition)=0 or position('''202610250091'',''202610250092''' in definition)=0
  then raise exception 'source_aware_document_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=16 as installed','select count(*)=17 as installed');
 definition:=replace(definition,'(''202610250092'',''MATERIAL_RULE_REVALIDATION'')','(''202610250092'',''MATERIAL_RULE_REVALIDATION''),(''202610250093'',''SOURCE_AWARE_DOCUMENT_ACCEPTANCE'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250092''','''requiredSchemaVersion'', ''202610250093''');
 definition:=replace(definition,'''202610250091'',''202610250092''','''202610250091'',''202610250092'',''202610250093''');
 definition:=replace(definition,'public.ap_material_rule_revalidation_schema_installed()','public.ap_material_rule_revalidation_schema_installed() and public.ap_source_aware_document_schema_installed()');
 execute definition;
end $$;
commit;

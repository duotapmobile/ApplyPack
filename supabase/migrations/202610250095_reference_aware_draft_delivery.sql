begin;

-- Selected reference metadata stays inside the existing paid scope. Private
-- values remain in encrypted payloads; this fence never decrypts or invents them.
-- It is also usable after delivery: consent checks do not renew a paid deadline.
create function public.ap_material_draft_reference_evidence(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; r public.ap_material_line_revisions; l public.ap_material_lines;
 item public.ap_material_checkout_items; intent public.ap_material_checkout_intents; rule public.ap_employer_submission_rules;
 permission public.ap_reference_permissions; version public.ap_reference_record_versions; record public.ap_reference_records;
 payload public.ap_sensitive_payloads; ids uuid[]; permission_id uuid; job_hash text; bindings jsonb:='[]'; authority jsonb:='[]';
begin
 select * into j from public.ap_material_draft_jobs where id=p_job_id;
 select * into l from public.ap_material_lines where id=j.material_line_id;
 select * into r from public.ap_material_line_revisions where id=j.line_revision_id;
 select * into rule from public.ap_employer_submission_rules where id=r.employer_rule_snapshot_id;
 if j.id is null or l.id is null or r.line_id is distinct from l.id or rule.id is null then raise exception 'material_draft_reference_scope_invalid'; end if;
 if not l.selected_reference_sheet then
  if rule.reference_timing='REQUIRED_NOW' then raise exception 'required_reference_clarification'; end if;
  return null;
 end if;
 lock table public.ap_reference_permissions,public.ap_reference_record_versions,public.ap_reference_records,
  public.ap_sensitive_payloads,public.ap_material_checkout_references in share mode;
 select i.* into intent from public.ap_material_checkout_intents i join public.ap_material_purchases p on p.checkout_intent_id=i.id where p.id=l.purchase_id;
 select * into item from public.ap_material_checkout_items where material_line_id=l.id and checkout_intent_id=intent.id;
 select content_sha256 into job_hash from public.ap_job_snapshots where id=r.job_snapshot_id;
 if item.id is null or intent.customer_id is distinct from j.customer_id or intent.delivered_release_id is null or job_hash is null
  then raise exception 'material_draft_reference_scope_invalid'; end if;
 if r.reference_scope is not null then
  if jsonb_typeof(r.reference_scope) is distinct from 'object'
   or (select array_agg(key order by key) from jsonb_object_keys(r.reference_scope) key) is distinct from array['permissionIds','selected']::text[]
   or r.reference_scope->'selected' is distinct from 'true'::jsonb or jsonb_typeof(r.reference_scope->'permissionIds') is distinct from 'array'
   or jsonb_array_length(r.reference_scope->'permissionIds') not between 1 and 3
   or exists(select 1 from jsonb_array_elements(r.reference_scope->'permissionIds') value
    where jsonb_typeof(value) is distinct from 'string' or value#>>'{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
   then raise exception 'material_draft_reference_scope_invalid'; end if;
  select array_agg(value::uuid order by value) into ids from jsonb_array_elements_text(r.reference_scope->'permissionIds') value;
 else
  if not item.selected_reference_sheet then raise exception 'material_draft_reference_scope_invalid'; end if;
  select array_agg(reference_permission_id order by reference_permission_id) into ids from public.ap_material_checkout_references where checkout_item_id=item.id;
 end if;
 if coalesce(cardinality(ids),0) not between 1 and 3 or cardinality(ids)<>(select count(distinct value) from unnest(ids) value)
  or rule.reference_timing='PROHIBITED' or cardinality(ids)>least(3,coalesce(rule.reference_count,3))
  then raise exception 'material_draft_reference_scope_invalid'; end if;
 if rule.reference_timing='REQUIRED_NOW' and coalesce(rule.reference_count,1)>cardinality(ids) then raise exception 'required_reference_clarification'; end if;
 foreach permission_id in array ids loop
  select * into permission from public.ap_reference_permissions where id=permission_id;
  select * into version from public.ap_reference_record_versions where id=permission.reference_record_version_id;
  select * into record from public.ap_reference_records where id=version.reference_record_id;
  select * into payload from public.ap_sensitive_payloads where id=version.encrypted_payload_id;
  if permission.id is null or permission.customer_id is distinct from j.customer_id or permission.delivered_release_id is distinct from intent.delivered_release_id
   or permission.job_snapshot_id is distinct from r.job_snapshot_id or permission.job_snapshot_hash is distinct from job_hash
   or permission.revoked_at is not null or permission.contact_version_changed_at is not null or permission.attested_at>clock_timestamp()
   or version.id is null or version.version is distinct from record.current_version or version.superseded_at is not null
   or version.permission_status is distinct from 'CONFIRMED' or version.permission_last_confirmed_at is null or version.permission_last_confirmed_at>clock_timestamp()
   or version.payload_schema_version is distinct from 'chunk5-reference-record-v1'
   or record.customer_id is distinct from j.customer_id or record.removed_at is not null or record.retention_state is distinct from 'ACTIVE'
   or payload.id is null or payload.customer_id is distinct from j.customer_id or payload.retention_state is distinct from 'ACTIVE'
   or payload.content_sha256 is distinct from version.payload_sha256 or coalesce(payload.encryption_context_hash,'') !~ '^[0-9a-f]{64}$'
   then raise exception 'material_draft_reference_unavailable'; end if;
  bindings:=bindings||jsonb_build_array(jsonb_build_object('permissionId',permission.id,'recordId',record.id,'recordVersionId',version.id,
   'recordVersion',version.version,'payloadId',payload.id,'contentSha256',payload.content_sha256,'permissionConfirmedAt',version.permission_last_confirmed_at,
   'deliveredReleaseId',permission.delivered_release_id,'jobSnapshotId',permission.job_snapshot_id,'jobSha256',permission.job_snapshot_hash));
  authority:=authority||jsonb_build_array(jsonb_build_object('permissionId',permission.id,'attestedAt',permission.attested_at,
   'permissionTextVersion',permission.permission_text_version,'payloadContextSha256',payload.encryption_context_hash,
   'recordRetention',record.retention_state,'payloadRetention',payload.retention_state));
 end loop;
 if (select count(distinct value->>'recordId') from jsonb_array_elements(bindings) value)<>cardinality(ids)
  or (select count(distinct value->>'payloadId') from jsonb_array_elements(bindings) value)<>cardinality(ids)
  then raise exception 'material_draft_reference_scope_invalid'; end if;
 return jsonb_build_object('bindings',bindings,'authority',authority,'filenameInstruction',rule.reference_filename_instruction,
  'referenceTiming',rule.reference_timing,'referenceCount',rule.reference_count);
end $$;

create function public.ap_assert_material_draft_reference_claim(p_job_id uuid,p_claim jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare binding jsonb:=p_claim->'referenceBinding'; evidence jsonb;
begin
 if p_claim->>'kind' is distinct from 'REFERENCE_PERMISSION' then
  if p_claim ? 'referenceBinding' then raise exception 'material_draft_reference_claim_invalid'; end if;
  return;
 end if;
 if jsonb_typeof(binding) is distinct from 'object'
  or (select array_agg(key order by key) from jsonb_object_keys(binding) key) is distinct from array['contentSha256','field','payloadId','permissionId','recordVersionId']::text[]
  or coalesce(binding->>'field','') not in('name','title','organization','relationship','email','phone','approvedContextLine')
  or p_claim->'referencePermissionIds' is distinct from jsonb_build_array(binding->>'permissionId')
  or coalesce(p_claim->'factRefs',p_claim->'candidateFactIds') is distinct from '[]'::jsonb
  or p_claim->'jobEvidenceIds' is distinct from '[]'::jsonb
  then raise exception 'material_draft_reference_claim_invalid'; end if;
 evidence:=public.ap_material_draft_reference_evidence(p_job_id);
 if evidence is null or not exists(select 1 from jsonb_array_elements(evidence->'bindings') value
  where value->>'permissionId'=binding->>'permissionId' and value->>'recordVersionId'=binding->>'recordVersionId'
   and value->>'payloadId'=binding->>'payloadId' and value->>'contentSha256'=binding->>'contentSha256')
  then raise exception 'material_draft_reference_claim_invalid'; end if;
end $$;

create function public.ap_assert_material_draft_reference_provenance(p_job_id uuid,p_artifact_type public.ap_artifact_type,p_provenance jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare evidence jsonb; actual jsonb:=p_provenance->'referenceBindings'; expected jsonb; binding jsonb; normalized jsonb:='[]'; claim jsonb; field text;
begin
 if p_artifact_type is distinct from 'REFERENCE_SHEET' then
  if p_provenance ? 'referenceBindings' or exists(select 1 from jsonb_array_elements(p_provenance->'claims') c where c ? 'referenceBinding' or c->>'kind'='REFERENCE_PERMISSION')
   then raise exception 'reference_permission_on_nonreference_artifact'; end if;
  return;
 end if;
 evidence:=public.ap_material_draft_reference_evidence(p_job_id); expected:=evidence->'bindings';
 if evidence is null or jsonb_typeof(actual) is distinct from 'array' or jsonb_array_length(actual)<>jsonb_array_length(expected)
  then raise exception 'material_draft_reference_provenance_invalid'; end if;
 for binding in select value from jsonb_array_elements(actual) order by value->>'permissionId' loop
  if jsonb_typeof(binding) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(binding) key) is distinct from
   array['contentSha256','deliveredReleaseId','jobSha256','jobSnapshotId','payloadId','permissionConfirmedAt','permissionId','recordId','recordVersion','recordVersionId']::text[]
   or jsonb_typeof(binding->'permissionConfirmedAt') is distinct from 'string'
   or binding->>'permissionConfirmedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
   then raise exception 'material_draft_reference_provenance_invalid'; end if;
  normalized:=normalized||jsonb_build_array(jsonb_set(binding,'{permissionConfirmedAt}',to_jsonb((binding->>'permissionConfirmedAt')::timestamptz)));
 end loop;
 if normalized is distinct from expected then raise exception 'material_draft_reference_provenance_invalid'; end if;
 if (select jsonb_agg(value->>'permissionId' order by value->>'permissionId') from jsonb_array_elements(expected) value)
  is distinct from (select jsonb_agg(value order by value) from jsonb_array_elements_text(p_provenance#>'{sourceBinding,referencePermissionIds}') value)
  then raise exception 'material_draft_reference_provenance_invalid'; end if;
 for claim in select value from jsonb_array_elements(p_provenance->'claims') loop
  perform public.ap_assert_material_draft_reference_claim(p_job_id,claim);
 end loop;
 for binding in select value from jsonb_array_elements(expected) loop
  foreach field in array array['name','title','organization','relationship','email','phone'] loop
   if (select count(*) from jsonb_array_elements(p_provenance->'claims') entry where entry->>'kind'='REFERENCE_PERMISSION'
    and entry#>>'{referenceBinding,permissionId}'=binding->>'permissionId' and entry#>>'{referenceBinding,field}'=field)<>1
    then raise exception 'material_draft_reference_provenance_invalid'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_provenance->'claims') entry where entry->>'kind'='REFERENCE_PERMISSION'
   and entry#>>'{referenceBinding,permissionId}'=binding->>'permissionId' and entry#>>'{referenceBinding,field}'='approvedContextLine')>1
   then raise exception 'material_draft_reference_provenance_invalid'; end if;
 end loop;
end $$;

-- Preserve every existing non-reference context digest. Selected reference
-- versions, consent and payload identities now change the managed packet fence.
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_material_draft_context_sha256(uuid)'::regprocedure);
 anchor:='return encode(extensions.digest(body::text,''sha256''),''hex'');';
 if position(anchor in definition)=0 then raise exception 'reference_context_anchor_missing'; end if;
 execute replace(definition,anchor,'if (select selected_reference_sheet from public.ap_material_lines where id=j.material_line_id) or rule.reference_timing=''REQUIRED_NOW'' then'||chr(10)||
  '  body:=body||jsonb_build_object(''selectedReferenceEvidence'',public.ap_material_draft_reference_evidence(j.id));'||chr(10)||' end if;'||chr(10)||' '||anchor);

 definition:=pg_get_functiondef('public.ap_record_material_draft_claim_review(uuid,text,text,uuid,text,jsonb,uuid)'::regprocedure);
 anchor:=$a$array['claimId','decision','factRefs','jobEvidenceIds','kind','qualification','referencePermissionIds','wordingSha256']::text[]$a$;
 if position(anchor in definition)=0 then raise exception 'reference_review_shape_anchor_missing'; end if;
 definition:=replace(definition,anchor,$a$(case when claim->>'kind'='REFERENCE_PERMISSION' then array['claimId','decision','factRefs','jobEvidenceIds','kind','qualification','referenceBinding','referencePermissionIds','wordingSha256']::text[] else $a$||anchor||' end)');
 anchor:='for ref in select value from jsonb_array_elements(claim->''factRefs'') loop';
 if position(anchor in definition)=0 then raise exception 'reference_review_claim_anchor_missing'; end if;
 execute replace(definition,anchor,'perform public.ap_assert_material_draft_reference_claim(j.id,claim);'||chr(10)||
  '  if claim->>''kind''=''REFERENCE_PERMISSION'' and claim->>''qualification''<>''EXACT'' then raise exception ''material_draft_reference_claim_invalid''; end if;'||chr(10)||'  '||anchor);

 definition:=pg_get_functiondef('public.ap_commit_material_draft_pair(uuid,uuid,uuid,text,text,jsonb)'::regprocedure);
 anchor:='for claim in select value from jsonb_array_elements(entry#>''{p_claim_provenance,claims}'') loop';
 if position(anchor in definition)=0 then raise exception 'reference_commit_provenance_anchor_missing'; end if;
 definition:=replace(definition,anchor,'perform public.ap_assert_material_draft_reference_provenance(j.id,(entry->>''p_artifact_type'')::public.ap_artifact_type,entry->''p_claim_provenance'');'||chr(10)||
  '  if entry->>''p_artifact_type''=''REFERENCE_SHEET'' and entry->''p_rendered_page_count'' is distinct from ''1''::jsonb then raise exception ''source_aware_document_qa_invalid''; end if;'||chr(10)||'  '||anchor);
 anchor:='where reviewed->>''wordingSha256''=claim->>''visibleTextSha256'' and reviewed->>''kind''=claim->>''kind''';
 if position(anchor in definition)=0 then raise exception 'reference_commit_review_anchor_missing'; end if;
 execute replace(definition,anchor,anchor||chr(10)||'     and reviewed->''referenceBinding'' is not distinct from claim->''referenceBinding''');

 definition:=pg_get_functiondef('public.ap_assert_source_aware_document_qa(public.ap_artifact_type,jsonb,text,text,text,text,text,text,jsonb)'::regprocedure);
 anchor:='p_artifact_type not in(''RESUME'',''COVER_LETTER'')';
 if position(anchor in definition)=0 then raise exception 'reference_qa_artifact_anchor_missing'; end if;
 definition:=replace(definition,anchor,'p_artifact_type not in(''RESUME'',''COVER_LETTER'',''REFERENCE_SHEET'')');
 anchor:='p_artifact_type=''COVER_LETTER'' and (pdf->>''listItemCount'')::integer<>0';
 if position(anchor in definition)=0 then raise exception 'reference_qa_list_anchor_missing'; end if;
 execute replace(definition,anchor,'p_artifact_type in(''COVER_LETTER'',''REFERENCE_SHEET'') and (pdf->>''listItemCount'')::integer<>0');

 definition:=pg_get_functiondef('public.ap_assert_source_aware_artifact_qa(uuid)'::regprocedure);
 anchor:='perform public.ap_assert_source_aware_document_qa(a.artifact_type';
 if position(anchor in definition)=0 then raise exception 'reference_download_anchor_missing'; end if;
 execute replace(definition,anchor,'perform public.ap_assert_material_draft_reference_provenance((select job_id from public.ap_material_draft_versions where id=(a.claim_provenance#>>''{draftPair,versionId}'')::uuid),a.artifact_type,a.claim_provenance);'||chr(10)||
  ' if a.artifact_type=''REFERENCE_SHEET'' and q.rendered_page_count<>1 then raise exception ''source_aware_document_qa_invalid''; end if;'||chr(10)||' '||anchor);

 definition:=pg_get_functiondef('public.ap_claim_material_draft_stage(uuid,text,integer)'::regprocedure);
 anchor:='and not line.selected_reference_sheet';
 if position(anchor in definition)=0 then raise exception 'reference_stage_filter_anchor_missing'; end if;
 definition:=replace(definition,anchor,'');
 anchor:='if exists(select 1 from public.ap_material_lines where id=j.material_line_id and selected_reference_sheet)'||chr(10)||'     or v.encrypted_payload_id is null';
 if position(anchor in definition)=0 then raise exception 'reference_stage_guard_anchor_missing'; end if;
 definition:=replace(definition,anchor,'if v.encrypted_payload_id is null');
 anchor:='''material_draft_evidence_bound_exceeded'',''material_rule_current_source_required''';
 if position(anchor in definition)=0 then raise exception 'reference_stage_hold_anchor_missing'; end if;
 execute replace(definition,anchor,anchor||',''material_draft_reference_scope_invalid'',''material_draft_reference_unavailable'',''required_reference_clarification''');
end $$;

revoke all on function public.ap_material_draft_reference_evidence(uuid) from public,anon,authenticated,service_role;
revoke all on function public.ap_assert_material_draft_reference_claim(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.ap_assert_material_draft_reference_provenance(uuid,public.ap_artifact_type,jsonb) from public,anon,authenticated,service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610250095','REFERENCE_AWARE_DRAFT_DELIVERY',0,clock_timestamp());
create function public.ap_reference_aware_draft_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
 and to_regprocedure('public.ap_material_draft_reference_evidence(uuid)') is not null
 and to_regprocedure('public.ap_assert_material_draft_reference_provenance(uuid,public.ap_artifact_type,jsonb)') is not null
 and position('selectedReferenceEvidence' in pg_get_functiondef('public.ap_material_draft_context_sha256(uuid)'::regprocedure))>0
 and position('ap_assert_material_draft_reference_provenance' in pg_get_functiondef('public.ap_commit_material_draft_pair(uuid,uuid,uuid,text,text,jsonb)'::regprocedure))>0
 and position('ap_assert_material_draft_reference_provenance' in pg_get_functiondef('public.ap_assert_source_aware_artifact_qa(uuid)'::regprocedure))>0
 and not has_function_privilege('service_role','public.ap_material_draft_reference_evidence(uuid)','EXECUTE');
$$;
revoke all on function public.ap_reference_aware_draft_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_reference_aware_draft_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=18 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250094''' in definition)=0
  or position('(''202610250094'',''MATERIAL_DRAFT_STAGE_CLAIMING'')' in definition)=0 or position('''202610250093'',''202610250094''' in definition)=0
  then raise exception 'reference_draft_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=18 as installed','select count(*)=19 as installed');
 definition:=replace(definition,'(''202610250094'',''MATERIAL_DRAFT_STAGE_CLAIMING'')','(''202610250094'',''MATERIAL_DRAFT_STAGE_CLAIMING''),(''202610250095'',''REFERENCE_AWARE_DRAFT_DELIVERY'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250094''','''requiredSchemaVersion'', ''202610250095''');
 definition:=replace(definition,'''202610250093'',''202610250094''','''202610250093'',''202610250094'',''202610250095''');
 definition:=replace(definition,'public.ap_material_draft_stage_claiming_schema_installed()','public.ap_material_draft_stage_claiming_schema_installed() and public.ap_reference_aware_draft_schema_installed()');
 execute definition;
end $$;
commit;

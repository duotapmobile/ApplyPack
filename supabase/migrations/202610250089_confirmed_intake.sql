-- Forward adaptive intake and exact customer-reviewed source binding. Historical snapshots stay unchanged.
begin;
alter table public.ap_anonymous_drafts add column confirmation_receipt jsonb;
alter table public.ap_intake_snapshots add column confirmed_review jsonb;
alter table public.intakes alter column resume_path drop not null;
alter table public.ap_intake_snapshots add constraint ap_confirmed_review_schema check
  ((schema_version='applypack-intake-v4')=(confirmed_review is not null));
alter table public.ap_anonymous_drafts add constraint ap_confirmation_metadata_only check (confirmation_receipt is null or
  (jsonb_typeof(confirmation_receipt)='object' and confirmation_receipt-array['id','contractVersion','draftVersion','sourceSha256','reviewSha256','answersSha256','preparedAt','entryMode']='{}'::jsonb));
alter table public.ap_intake_snapshots add constraint ap_confirmed_review_metadata_only check (confirmed_review is null or
  (jsonb_typeof(confirmed_review)='object' and confirmed_review-array['id','contractVersion','draftVersion','sourceSha256','reviewSha256','answersSha256','preparedAt','entryMode']='{}'::jsonb));

create function public.ap_serialize_intake_source_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.ap_anonymous_drafts where id=case when tg_op='DELETE' then old.draft_id else new.draft_id end for update;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger ap_serialize_document_confirmation before insert or update or delete on public.ap_document_versions
  for each row execute function public.ap_serialize_intake_source_change();
create trigger ap_serialize_fact_confirmation before insert or update or delete on public.ap_candidate_facts
  for each row execute function public.ap_serialize_intake_source_change();
revoke all on function public.ap_serialize_intake_source_change() from public,anon,authenticated;

create function public.ap_intake_confirmation_source(p_draft_id uuid,p_secret_hash text,p_expected_version bigint)
returns text language plpgsql security definer set search_path='' as $$
declare d public.ap_anonymous_drafts; payload jsonb;
begin
  select * into d from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash
    and expires_at>now() and state='IN_PROGRESS' and flow_version='FOUR_STEP_RESPONSIBILITY_V1';
  if not found then raise exception 'draft_capability_invalid'; end if;
  if d.version<>p_expected_version then raise exception 'draft_version_conflict'; end if;
  payload:=jsonb_build_object('answers',d.answers,'documents',coalesce((select jsonb_agg(to_jsonb(v) order by v.id)
    from public.ap_document_versions v where v.draft_id=d.id and v.is_current),'[]'::jsonb),
    'facts',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.ap_candidate_facts f
      where f.draft_id=d.id and f.superseded_at is null),'[]'::jsonb));
  return encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex');
end $$;

create function public.ap_prepare_intake_confirmation(p_draft_id uuid,p_secret_hash text,p_expected_version bigint,
  p_source_sha256 text,p_review_sha256 text,p_answers_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.ap_anonymous_drafts; receipt jsonb;
begin
  select * into d from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash
    and expires_at>now() and state='IN_PROGRESS' for update;
  if not found then raise exception 'draft_capability_invalid'; end if;
  if d.version<>p_expected_version then raise exception 'draft_version_conflict'; end if;
  if p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$' or p_review_sha256 is null or p_review_sha256 !~ '^[a-f0-9]{64}$'
    or p_answers_sha256 is null or p_answers_sha256 !~ '^[a-f0-9]{64}$'
    or p_source_sha256<>public.ap_intake_confirmation_source(p_draft_id,p_secret_hash,p_expected_version)
    or coalesce(d.answers->>'entryMode','') not in ('CURRENT_RESUME','OUTDATED_RESUME','GUIDED')
    then raise exception 'intake_review_stale'; end if;
  if d.confirmation_receipt->>'sourceSha256'=p_source_sha256 and d.confirmation_receipt->>'reviewSha256'=p_review_sha256
    and d.confirmation_receipt->>'answersSha256'=p_answers_sha256 then return d.confirmation_receipt; end if;
  receipt:=jsonb_build_object('id',gen_random_uuid(),'contractVersion','applypack-confirmed-intake-v1',
    'draftVersion',d.version,'sourceSha256',p_source_sha256,'reviewSha256',p_review_sha256,'answersSha256',p_answers_sha256,
    'preparedAt',now(),'entryMode',d.answers->>'entryMode');
  update public.ap_anonymous_drafts set confirmation_receipt=receipt where id=d.id;
  return receipt;
end $$;

create function public.ap_read_intake_confirmation(p_draft_id uuid,p_secret_hash text)
returns jsonb language sql security definer set search_path='' stable as $$
  select confirmation_receipt from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash
    and expires_at>now() and state in ('IN_PROGRESS','COMPLETE') and flow_version='FOUR_STEP_RESPONSIBILITY_V1';
$$;

create function public.ap_assert_confirmed_intake(p_draft_id uuid,p_secret_hash text,p_expected_version bigint,p_snapshot jsonb,p_reviews jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare d public.ap_anonymous_drafts; experience jsonb; fact public.ap_candidate_facts; correction jsonb;
begin
  select * into d from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash for update;
  if not found or d.version<>p_expected_version or d.state<>'IN_PROGRESS' then raise exception 'draft_version_conflict'; end if;
  if d.confirmation_receipt is null or p_snapshot->'confirmedReview' is distinct from d.confirmation_receipt
    or d.confirmation_receipt->>'sourceSha256' is distinct from public.ap_intake_confirmation_source(p_draft_id,p_secret_hash,p_expected_version)
    or p_snapshot->>'entryMode' is distinct from d.answers->>'entryMode'
    or p_snapshot->'experienceAdditions' is distinct from d.answers->'experienceAdditions'
    or coalesce(d.answers->>'backgroundReviewed','false')<>'true'
    then raise exception 'intake_review_stale'; end if;
  if p_snapshot->>'entryMode'='GUIDED' then
    if exists(select 1 from public.ap_document_versions where draft_id=d.id and kind='RESUME' and is_current)
      then raise exception 'guided_resume_conflict'; end if;
    if jsonb_typeof(p_snapshot->'experienceAdditions') is distinct from 'array' or
      (jsonb_array_length(p_snapshot->'experienceAdditions')=0 and coalesce(d.answers->>'noPriorEmployment','false')<>'true')
      then raise exception 'guided_background_required'; end if;
  elsif not exists(select 1 from public.ap_document_versions where draft_id=d.id and kind='RESUME' and is_current
    and (processing_state='READY' or (structural_review_ready_at is not null and structural_policy='isolated-structural-v1'
      and malware_deferred and parse_status='SUCCEEDED' and failure_code is null))) then raise exception 'resume_required'; end if;
  for experience in select value from jsonb_array_elements(p_snapshot->'experienceAdditions') loop
    if experience->>'kind' not in ('CAREGIVING','OTHER_RELEVANT_LIFE_CONTEXT','EDUCATION_CERTIFICATION') and
      (coalesce(btrim(experience->>'organizationOrProject'),'')='' or coalesce(btrim(experience->>'roleOrRelationship'),'')=''
       or jsonb_typeof(experience->'responsibilities') is distinct from 'array' or jsonb_array_length(experience->'responsibilities')=0)
      then raise exception 'guided_background_incomplete'; end if;
  end loop;
  for fact in select f.* from public.ap_candidate_facts f join public.ap_document_versions v on v.id=f.document_version_id
    where f.draft_id=d.id and f.snapshot_id is null and v.is_current loop
    if coalesce(p_reviews->fact.id::text->>'decision',case when fact.verification='CUSTOMER_CONFIRMED' then 'CONFIRM' else '' end) not in ('CONFIRM','REJECT','CORRECT','SKIP')
      or (fact.fact_tier='SEARCH_CRITICAL' and p_reviews->fact.id::text->>'decision'='SKIP')
      or not exists(select 1 from public.ap_fact_presentations where draft_id=d.id and fact_id=fact.id)
      then raise exception 'fact_review_required'; end if;
    if p_reviews->fact.id::text->>'decision'='CORRECT' then
      correction:=p_reviews->fact.id::text->'correction';
      if jsonb_typeof(correction) is distinct from 'object' or coalesce(correction->>'category','') not in
        ('FIELD_EDITS','EMPLOYER_OR_ORGANIZATION','ROLE_OR_RELATIONSHIP','DATE_RANGE','RESPONSIBILITY','TOOL_CAPABILITY','EDUCATION','CERTIFICATION_OR_CREDENTIAL','OTHER_STRUCTURED_FACT')
        or (case correction->>'category'
          when 'FIELD_EDITS' then not public.ap_confirmed_field_edits_valid(fact.typed_value,correction->'fields')
          when 'EMPLOYER_OR_ORGANIZATION' then coalesce(btrim(correction->>'employerOrOrganization'),'')=''
          when 'ROLE_OR_RELATIONSHIP' then coalesce(btrim(correction->>'roleOrRelationship'),'')=''
          when 'DATE_RANGE' then (coalesce(correction->>'startsOn','')='' and coalesce(correction->>'endsOn','')='') or coalesce(correction->>'datePrecision','') not in ('EXACT_DAY','MONTH','YEAR','UNKNOWN')
          when 'RESPONSIBILITY' then coalesce(btrim(correction->>'responsibility'),'')=''
          when 'TOOL_CAPABILITY' then coalesce(btrim(correction->>'taskOrTool'),'')='' or coalesce(correction->>'capabilityStatus','') not in ('CAN_DO_NOW','DONE_BEFORE_NEEDS_REFRESHER','BASIC_EXPOSURE','NOT_DONE','UNSURE')
          when 'EDUCATION' then btrim(concat_ws('',correction->>'educationLevel',correction->>'educationField',correction->>'completionStatus'))=''
          when 'CERTIFICATION_OR_CREDENTIAL' then coalesce(btrim(correction->>'credentialName'),'')=''
          when 'OTHER_STRUCTURED_FACT' then coalesce(btrim(correction->>'factLabel'),'')='' or coalesce(btrim(correction->>'factValue'),'')=''
          else true end) then raise exception 'invalid_structured_fact_correction'; end if;
    end if;
  end loop;
end $$;

create function public.ap_confirmed_field_edits_valid(p_original jsonb,p_fields jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare field record; merged jsonb; value text;
begin
  if jsonb_typeof(p_fields) is distinct from 'object' or p_fields='{}'::jsonb then return false; end if;
  for field in select entry.key,entry.value from jsonb_each(p_fields) entry loop
    if field.key not in ('name','fullName','displayName','email','phone','cityState','location','employer','employerOrOrganization','organizationOrProject','historicalTitle','roleOrRelationship','dates','startsOn','endsOn','datePrecision','current','bullets','responsibilities','activity','responsibility','tools','skills','taskOrTool','capabilityStatus','educationLevel','educationField','completionStatus','credentialName','issuingOrganization','summary','text','verbatim','coverLetterEvidence')
      or not (p_original ? field.key) or jsonb_typeof(field.value) is distinct from jsonb_typeof(p_original->field.key)
      or jsonb_typeof(field.value) not in ('string','array','boolean') then return false; end if;
    if jsonb_typeof(field.value)='string' and length(field.value#>>'{}')>4000 then return false; end if;
    if jsonb_typeof(field.value)='array' then
      if jsonb_array_length(field.value)>40 or exists(select 1 from jsonb_array_elements(field.value) item where jsonb_typeof(item)<>'string' or length(item#>>'{}')>2000) then return false; end if;
    end if;
  end loop;
  merged:=p_original||p_fields;
  if merged->'current'='true'::jsonb and coalesce(merged->>'endsOn','')<>'' then return false; end if;
  if merged ? 'datePrecision' and merged->>'datePrecision' not in ('EXACT_DAY','MONTH','YEAR','UNKNOWN') then return false; end if;
  if merged ? 'capabilityStatus' and merged->>'capabilityStatus' not in ('CAN_DO_NOW','DONE_BEFORE_NEEDS_REFRESHER','BASIC_EXPOSURE','NOT_DONE','UNSURE') then return false; end if;
  foreach value in array array[merged->>'startsOn',merged->>'endsOn'] loop
    if coalesce(value,'')<>'' then
      if value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
      perform value::date;
    end if;
  end loop;
  if coalesce(merged->>'startsOn','')<>'' and coalesce(merged->>'endsOn','')<>'' and merged->>'startsOn'>merged->>'endsOn' then return false; end if;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;

create function public.ap_confirmed_fact_value(p_value jsonb,p_correction jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select p_value || case p_correction->>'category'
    when 'FIELD_EDITS' then p_correction->'fields'
    when 'EMPLOYER_OR_ORGANIZATION' then jsonb_build_object(case when p_value ? 'employer' then 'employer' else 'employerOrOrganization' end,p_correction->>'employerOrOrganization')
    when 'ROLE_OR_RELATIONSHIP' then jsonb_build_object(case when p_value ? 'historicalTitle' then 'historicalTitle' else 'roleOrRelationship' end,p_correction->>'roleOrRelationship')
    when 'DATE_RANGE' then p_correction-'category'
    when 'RESPONSIBILITY' then jsonb_build_object(case when p_value ? 'activity' then 'activity' else 'responsibility' end,p_correction->>'responsibility')
    else p_correction-'category' end;
$$;

create function public.ap_bind_confirmed_review_facts(p_snapshot_id uuid,p_reviews jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare s public.ap_intake_snapshots; f public.ap_candidate_facts; ids jsonb:='{}'; target_id uuid; decision text; value jsonb;
  projected_start date; projected_end date; projected_duration integer; projected_intensity numeric; projected_capability text; date_changed boolean;
begin
  select * into strict s from public.ap_intake_snapshots where id=p_snapshot_id and schema_version='applypack-intake-v4';
  for f in select fact.* from public.ap_candidate_facts fact join public.ap_document_versions doc on doc.id=fact.document_version_id
    where fact.draft_id=s.draft_id and fact.snapshot_id is null and fact.source_kind='DOCUMENT' and doc.is_current and doc.retention_state='ACTIVE' loop
    decision:=coalesce(p_reviews->f.id::text->>'decision',case when f.verification='CUSTOMER_CONFIRMED' then 'CONFIRM' end);
    if decision not in ('CONFIRM','CORRECT') or decision is null then continue; end if;
    ids:=ids||jsonb_build_object(f.id::text,gen_random_uuid());
  end loop;
  for f in select * from public.ap_candidate_facts where ids ? id::text loop
    target_id:=(ids->>f.id::text)::uuid;
    decision:=coalesce(p_reviews->f.id::text->>'decision','CONFIRM');
    value:=case when decision='CORRECT' then public.ap_confirmed_fact_value(f.typed_value,p_reviews->f.id::text->'correction') else f.typed_value end;
    value:=value||jsonb_build_object('sourceDocumentFactId',f.id);
    if value ? 'employmentFactId' then
      if not (ids ? (value->>'employmentFactId')) then raise exception 'confirmed_employment_record_required'; end if;
      value:=jsonb_set(value,'{employmentFactId}',ids->(value->>'employmentFactId'));
    end if;
    projected_start:=f.starts_on; projected_end:=f.ends_on; projected_duration:=f.calendar_duration_days;
    projected_intensity:=f.intensity_percent; projected_capability:=f.capability_status;
    date_changed:=decision='CORRECT' and exists(select 1 from unnest(array['startsOn','endsOn','datePrecision','dates','current']) field where value->field is distinct from f.typed_value->field);
    if value->>'datePrecision' in ('YEAR','MONTH','UNKNOWN') then
      projected_start:=null; projected_end:=null; projected_duration:=null;
    elsif date_changed then
      projected_start:=null; projected_end:=null; projected_duration:=null;
      if value->>'datePrecision'='EXACT_DAY' then
        projected_start:=nullif(value->>'startsOn','')::date;
        projected_end:=case when value->'current'='true'::jsonb then null else nullif(value->>'endsOn','')::date end;
        if projected_start is not null and projected_end is not null then projected_duration:=projected_end-projected_start; end if;
      end if;
    end if;
    if value ? 'capabilityStatus' then projected_capability:=nullif(value->>'capabilityStatus',''); end if;
    if value ? 'intensityPercent' then projected_intensity:=nullif(value->>'intensityPercent','')::numeric; end if;
    insert into public.ap_candidate_facts(id,draft_id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,
      document_version_id,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,confirmed_or_corrected_at,
      catalog_version,schema_version,fact_tier,supersedes_fact_id,customer_display_label,customer_display_value,
      starts_on,ends_on,calendar_duration_days,intensity_percent,capability_status)
    values(target_id,s.draft_id,s.customer_id,s.id,f.semantic_key,f.value_kind,value,
      case when decision='CORRECT' then 'CUSTOMER_ASSERTION'::public.ap_candidate_fact_source else 'DOCUMENT'::public.ap_candidate_fact_source end,
      case when decision='CORRECT' then null else f.document_version_id end,
      case when decision='CORRECT' then s.id else null end,case when decision='CORRECT' then 'fact-correction-'||f.id::text else null end,
      case when decision='CORRECT' then 'Customer correction in confirmed review' else f.source_locator end,
      'CUSTOMER_CONFIRMED',now(),f.catalog_version,s.schema_version,f.fact_tier,
      case when decision='CORRECT' then f.id else null end,f.customer_display_label,
      case when decision='CORRECT' then jsonb_build_object('summary',(value-array['sourceDocumentFactId','employmentFactId','sourceFactIds'])::text) else f.customer_display_value end,
      projected_start,projected_end,projected_duration,projected_intensity,projected_capability);
  end loop;
  for f in select fact.* from public.ap_candidate_facts fact join public.ap_document_versions doc on doc.id=fact.document_version_id
    where fact.draft_id=s.draft_id and fact.snapshot_id is null and fact.source_kind='DOCUMENT' and doc.is_current loop
    decision:=coalesce(p_reviews->f.id::text->>'decision',case when f.verification='CUSTOMER_CONFIRMED' then 'CONFIRM' end);
    insert into public.ap_fact_review_history(draft_id,snapshot_id,fact_id,decision,correction_fact_id)
      values(s.draft_id,s.id,f.id,decision::public.ap_fact_review_decision,case when decision='CORRECT' then (ids->>f.id::text)::uuid else null end);
  end loop;
end $$;

-- Keep the existing legal transaction, immutable snapshot creation, replay and fulfillment logic.
-- The additional contract is required only by the new schema, never retroactively.
do $$ declare definition text; anchor text; begin
  select pg_get_functiondef('public.ap_finalize_four_step_intake(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb)'::regprocedure) into definition;
  anchor:='  if not exists(select 1 from public.ap_document_versions where draft_id=p_draft_id and kind=''RESUME'' and is_current and (processing_state=''READY'' or (structural_review_ready_at is not null and structural_policy=''isolated-structural-v1'' and malware_deferred and parse_status=''SUCCEEDED'' and failure_code is null))) then raise exception ''resume_required''; end if;';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_finalize_anchor_missing'; end if;
  definition:=replace(definition,anchor,'  if p_snapshot->>''schemaVersion''=''applypack-intake-v4'' then'||chr(10)||
    '    perform public.ap_assert_confirmed_intake(p_draft_id,p_secret_hash,p_expected_version,p_snapshot,p_fact_reviews);'||chr(10)||
    '  else'||chr(10)||anchor||chr(10)||'  end if;');
  anchor:='targeted_authorization_answers,sensitive_payload_id,content_sha256,canonicalization_version,schema_version,finalized_at)';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_columns_anchor_missing'; end if;
  definition:=replace(definition,anchor,'targeted_authorization_answers,sensitive_payload_id,content_sha256,canonicalization_version,schema_version,finalized_at,confirmed_review)');
  anchor:='p_sensitive_payload_id,p_content_sha256,p_snapshot->>''canonicalizationVersion'',p_snapshot->>''schemaVersion'',now());';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_values_anchor_missing'; end if;
  definition:=replace(definition,anchor,'p_sensitive_payload_id,p_content_sha256,p_snapshot->>''canonicalizationVersion'',p_snapshot->>''schemaVersion'',now(),case when p_snapshot->>''schemaVersion''=''applypack-intake-v4'' then p_snapshot->''confirmedReview'' else null end);');
  anchor:='perform public.ap_bind_confirmed_document_facts(p_snapshot_id);';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_binding_anchor_missing'; end if;
  definition:=replace(definition,anchor,'if p_snapshot->>''schemaVersion''=''applypack-intake-v4'' then perform public.ap_bind_confirmed_review_facts(p_snapshot_id,p_fact_reviews); else '||anchor||' end if;');
  anchor:='fact.semantic_key,correction->>''category'',correction-''category'',';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_correction_anchor_missing'; end if;
  definition:=replace(definition,anchor,'fact.semantic_key,case when p_snapshot->>''schemaVersion''=''applypack-intake-v4'' then fact.value_kind else correction->>''category'' end,case when p_snapshot->>''schemaVersion''=''applypack-intake-v4'' then public.ap_confirmed_fact_value(fact.typed_value,correction)||jsonb_build_object(''sourceDocumentFactId'',fact.id) else correction-''category'' end,');
  -- New snapshots bind fresh copies of all reviewed current-source facts in one pass.
  -- Historical source states and older snapshot references remain untouched.
  anchor:='where draft_id=p_draft_id and superseded_at is null and verification=''EXTRACTED_UNCONFIRMED'' loop';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_legacy_fact_loop_missing'; end if;
  definition:=replace(definition,anchor,'where draft_id=p_draft_id and superseded_at is null and verification=''EXTRACTED_UNCONFIRMED'' and p_snapshot->>''schemaVersion''<>''applypack-intake-v4'' loop');
  anchor:='nullif(experience->>''startsOn'','''')::date,nullif(experience->>''endsOn'','''')::date';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_date_precision_anchor_missing'; end if;
  definition:=replace(definition,anchor,'case when p_snapshot->>''schemaVersion''<>''applypack-intake-v4'' or experience->>''datePrecision''=''EXACT_DAY'' then nullif(experience->>''startsOn'','''')::date else null end,case when p_snapshot->>''schemaVersion''<>''applypack-intake-v4'' or experience->>''datePrecision''=''EXACT_DAY'' then nullif(experience->>''endsOn'','''')::date else null end');
  execute definition;
  select pg_get_functiondef('public.ap_save_four_step_draft(uuid,text,bigint,integer,jsonb)'::regprocedure) into definition;
  anchor:='set current_step=p_current_step,answers=p_answers,';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_save_anchor_missing'; end if;
  execute replace(definition,anchor,anchor||'confirmation_receipt=null,');
  select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_apply_verified_search_payment';
  anchor:='if resume_path is null then raise exception ''activation_resume_missing''; end if;';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_activation_anchor_missing'; end if;
  definition:=replace(definition,anchor,'if resume_path is null and not (snapshot_row.schema_version=''applypack-intake-v4'' and snapshot_row.confirmed_review->>''entryMode''=''GUIDED'' and snapshot_row.confirmed_review->>''contractVersion''=''applypack-confirmed-intake-v1'') then raise exception ''activation_resume_missing''; end if;');
  -- The existing isolated-document policy already records pending/null for absent scan evidence.
  anchor:='snapshot_row.finalized_at,case when exists(select 1 from public.ap_document_versions doc where doc.draft_id=checkout_row.draft_id and doc.storage_path=resume_path and doc.malware_status=''CLEAN'') then ''clean'' else ''pending'' end,null';
  if position(anchor in definition)=0 then raise exception 'confirmed_intake_scan_anchor_missing'; end if;
  execute definition;
end $$;

revoke all on function public.ap_intake_confirmation_source(uuid,text,bigint),
  public.ap_prepare_intake_confirmation(uuid,text,bigint,text,text,text), public.ap_read_intake_confirmation(uuid,text),
  public.ap_assert_confirmed_intake(uuid,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ap_intake_confirmation_source(uuid,text,bigint),
  public.ap_prepare_intake_confirmation(uuid,text,bigint,text,text,text), public.ap_read_intake_confirmation(uuid,text)
  to service_role;
revoke all on function public.ap_confirmed_fact_value(jsonb,jsonb),public.ap_confirmed_field_edits_valid(jsonb,jsonb),public.ap_bind_confirmed_review_facts(uuid,jsonb) from public,anon,authenticated;
create function public.ap_confirmed_intake_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
  select to_regprocedure('public.ap_prepare_intake_confirmation(uuid,text,bigint,text,text,text)') is not null
    and to_regprocedure('public.ap_assert_confirmed_intake(uuid,text,bigint,jsonb,jsonb)') is not null
    and to_regprocedure('public.ap_bind_confirmed_review_facts(uuid,jsonb)') is not null
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ap_intake_snapshots' and column_name='confirmed_review')
    and exists(select 1 from information_schema.columns where table_schema='public' and table_name='ap_anonymous_drafts' and column_name='confirmation_receipt')
    and exists(select 1 from pg_constraint where conrelid='public.ap_intake_snapshots'::regclass and conname='ap_confirmed_review_schema' and convalidated)
    and exists(select 1 from pg_trigger where tgrelid='public.ap_document_versions'::regclass and tgname='ap_serialize_document_confirmation' and tgenabled='O' and not tgisinternal)
    and exists(select 1 from pg_trigger where tgrelid='public.ap_candidate_facts'::regclass and tgname='ap_serialize_fact_confirmation' and tgenabled='O' and not tgisinternal)
    and position('ap_assert_confirmed_intake' in pg_get_functiondef('public.ap_finalize_four_step_intake(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb)'::regprocedure))>0;
$$;
revoke all on function public.ap_confirmed_intake_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_confirmed_intake_schema_installed() to service_role;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
  if position('''requiredSchemaVersion'', ''202610250088''' in definition)=0
    or position('select count(*)=12 as installed' in definition)=0
    or position('(''202610250088'',''SERVICE_RETENTION_CLEANUP'')' in definition)=0
    or position('''202610240087'',''202610250088''' in definition)=0
    or position('public.ap_one_off_retention_schema_installed()' in definition)=0
    then raise exception 'confirmed_intake_readiness_anchor_missing'; end if;
  definition:=replace(definition,'''requiredSchemaVersion'', ''202610250088''','''requiredSchemaVersion'', ''202610250089''');
  definition:=replace(definition,'select count(*)=12 as installed','select count(*)=13 as installed');
  definition:=replace(definition,'(''202610250088'',''SERVICE_RETENTION_CLEANUP'')','(''202610250088'',''SERVICE_RETENTION_CLEANUP''),(''202610250089'',''CONFIRMED_INTAKE'')');
  definition:=replace(definition,'''202610240087'',''202610250088''','''202610240087'',''202610250088'',''202610250089''');
  definition:=replace(definition,'public.ap_one_off_retention_schema_installed()','(public.ap_one_off_retention_schema_installed() and public.ap_confirmed_intake_schema_installed())');
  execute definition;
end $$;
insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610250089','CONFIRMED_INTAKE',0,now()) on conflict(migration_id,checkpoint) do nothing;
commit;

-- Corrected-contract Chunk 2 remediation: lossless preferences and typed corrections.
-- Additive only. Existing snapshots and legacy paid orders remain readable.

alter table public.ap_intake_snapshots
  add column preferred_work_mode text,
  add column preferred_employment_type text,
  add column work_condition_preferences jsonb not null default '{}'::jsonb;

alter table public.ap_intake_snapshots
  add constraint ap_intake_snapshots_preferred_work_mode_check
    check (preferred_work_mode is null or preferred_work_mode in ('REMOTE','HYBRID','ONSITE')),
  add constraint ap_intake_snapshots_preferred_employment_type_check
    check (preferred_employment_type is null or preferred_employment_type in ('FULL_TIME','PART_TIME','CONTRACT','TEMPORARY')),
  add constraint ap_intake_snapshots_work_condition_preferences_check
    check (jsonb_typeof(work_condition_preferences) = 'object');

create or replace function public.ap_finalize_four_step_intake(
  p_draft_id uuid,p_secret_hash text,p_expected_version bigint,p_snapshot_id uuid,
  p_snapshot jsonb,p_content_sha256 text,p_sensitive_payload_id uuid,p_fact_reviews jsonb
)
returns table(snapshot_id uuid,feasibility_request_id uuid,draft_version bigint)
language plpgsql security definer set search_path = '' as $$
declare d public.ap_anonymous_drafts; prior_snapshot uuid; next_version integer; fact public.ap_candidate_facts;
  decision text; correction jsonb; correction_id uuid; request_id uuid; experience jsonb; capability record; source_fact_id uuid; mapped_kind public.ap_experience_kind;
begin
  if jsonb_typeof(p_snapshot)<>'object' or jsonb_typeof(p_fact_reviews)<>'object' or p_content_sha256!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p_snapshot->'workConditionPreferences')<>'object'
    or jsonb_typeof(p_snapshot->'employerUnknownPolicies')<>'object'
    or (p_snapshot->>'preferredWorkMode' is not null and not (p_snapshot->'workModes' ? (p_snapshot->>'preferredWorkMode')))
    or (p_snapshot->>'preferredEmploymentType' is not null and not (p_snapshot->'employmentTypes' ? (p_snapshot->>'preferredEmploymentType')))
    then raise exception 'invalid_intake_snapshot'; end if;
  select ad.* into d from public.ap_anonymous_drafts ad where ad.id=p_draft_id and ad.capability_secret_hash=p_secret_hash
    and ad.expires_at>now() and ad.flow_version='FOUR_STEP_RESPONSIBILITY_V1' for update;
  if not found or d.state not in ('IN_PROGRESS','COMPLETE') then raise exception 'draft_capability_invalid'; end if;
  if d.version<>p_expected_version then raise exception using message='draft_version_conflict',detail=d.version::text,errcode='40001'; end if;
  if not exists(select 1 from public.ap_document_versions where draft_id=p_draft_id and kind='RESUME' and is_current and processing_state<>'FAILED') then raise exception 'resume_required'; end if;
  if not exists(select 1 from public.ap_sensitive_payloads where id=p_sensitive_payload_id and draft_id=p_draft_id and content_sha256=p_snapshot->>'sensitivePayloadSha256') then raise exception 'sensitive_payload_required'; end if;
  if p_snapshot->>'priorCoverLetterUse'='NEITHER' then
    update public.ap_document_versions set is_current=false,processing_state='SUPERSEDED',updated_at=now()
      where draft_id=p_draft_id and kind='PRIOR_COVER_LETTER' and is_current;
  end if;
  for fact in select * from public.ap_candidate_facts where draft_id=p_draft_id and superseded_at is null and verification='EXTRACTED_UNCONFIRMED' loop
    decision:=p_fact_reviews->fact.id::text->>'decision';
    if fact.fact_tier='SEARCH_CRITICAL' and (decision is null or decision='SKIP' or not exists(select 1 from public.ap_fact_presentations x where x.draft_id=p_draft_id and x.fact_id=fact.id)) then raise exception 'search_critical_fact_review_required'; end if;
    if decision in ('CONFIRM','REJECT','CORRECT') and not exists(select 1 from public.ap_fact_presentations x where x.draft_id=p_draft_id and x.fact_id=fact.id) then raise exception 'unseen_fact_cannot_be_reviewed'; end if;
  end loop;
  prior_snapshot:=d.finalized_snapshot_id;
  select coalesce(max(s.version),0)+1 into next_version from public.ap_intake_snapshots s where s.draft_id=p_draft_id;
  insert into public.ap_intake_snapshots(id,draft_id,parent_snapshot_id,version,snapshot_kind,access_email_normalized,
    document_contact_email,desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,
    optional_industries,blocked_industries,search_breadth,guidance_requested,work_modes,preferred_work_mode,us_state_or_dc,
    employment_types,preferred_employment_type,schedules,travel,benefits,work_condition_preferences,dealbreakers,currency,salary_target_cents,salary_hard_minimum_cents,
    salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,
    salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,
    targeted_authorization_answers,sensitive_payload_id,content_sha256,canonicalization_version,schema_version,finalized_at)
  values(p_snapshot_id,p_draft_id,prior_snapshot,next_version,case when prior_snapshot is null then 'INITIAL' else 'PRE_ACTIVATION_EDIT' end,
    p_snapshot->>'accessEmailNormalized',p_snapshot->>'documentContactEmail',p_snapshot->'desiredActivities',p_snapshot->'avoidedActivities',
    p_snapshot->'optionalTitles',case when p_snapshot->'confirmedTitleRestriction'='null'::jsonb then null else p_snapshot->'confirmedTitleRestriction' end,p_snapshot->'optionalIndustries',p_snapshot->'blockedIndustries',
    p_snapshot->>'searchBreadth',(p_snapshot->>'guidanceRequested')::boolean,p_snapshot->'workModes',nullif(p_snapshot->>'preferredWorkMode',''),p_snapshot->>'stateOrDc',
    p_snapshot->'employmentTypes',nullif(p_snapshot->>'preferredEmploymentType',''),p_snapshot->'schedules',p_snapshot->'travel',p_snapshot->'benefits',p_snapshot->'workConditionPreferences',p_snapshot->'dealbreakers','USD',
    nullif(p_snapshot->>'salaryTargetCents','')::integer,nullif(p_snapshot->>'salaryHardMinimumCents','')::integer,
    (p_snapshot->>'salaryMinimumFlexible')::boolean,nullif(p_snapshot->>'salaryPeriod',''),nullif(p_snapshot->>'salaryBasis',''),
    p_snapshot->>'salaryOverlapPolicy',p_snapshot->>'salaryUnpublishedPolicy',p_snapshot->>'salaryNoncomparablePolicy',
    p_snapshot->>'salaryVariablePayPolicy',p_snapshot->'employerUnknownPolicies',p_snapshot->>'priorCoverLetterUse','{}',
    p_sensitive_payload_id,p_content_sha256,p_snapshot->>'canonicalizationVersion',p_snapshot->>'schemaVersion',now());

  for fact in select * from public.ap_candidate_facts where draft_id=p_draft_id and superseded_at is null and verification='EXTRACTED_UNCONFIRMED' loop
    decision:=p_fact_reviews->fact.id::text->>'decision'; correction:=p_fact_reviews->fact.id::text->'correction'; correction_id:=null;
    if decision='CONFIRM' then update public.ap_candidate_facts set verification='CUSTOMER_CONFIRMED',confirmed_or_corrected_at=now() where id=fact.id;
    elsif decision='REJECT' then update public.ap_candidate_facts set verification='CUSTOMER_REJECTED',confirmed_or_corrected_at=now() where id=fact.id;
    elsif decision='CORRECT' then
      if jsonb_typeof(correction)<>'object'
        or correction->>'category' not in ('EMPLOYER_OR_ORGANIZATION','ROLE_OR_RELATIONSHIP','DATE_RANGE','RESPONSIBILITY','TOOL_CAPABILITY','EDUCATION','CERTIFICATION_OR_CREDENTIAL','OTHER_STRUCTURED_FACT')
        or (case correction->>'category'
          when 'EMPLOYER_OR_ORGANIZATION' then nullif(btrim(correction->>'employerOrOrganization'),'') is null
          when 'ROLE_OR_RELATIONSHIP' then nullif(btrim(correction->>'roleOrRelationship'),'') is null
          when 'DATE_RANGE' then (nullif(correction->>'startsOn','') is null and nullif(correction->>'endsOn','') is null) or correction->>'datePrecision' not in ('EXACT_DAY','MONTH','YEAR','UNKNOWN')
          when 'RESPONSIBILITY' then nullif(btrim(correction->>'responsibility'),'') is null
          when 'TOOL_CAPABILITY' then nullif(btrim(correction->>'taskOrTool'),'') is null or correction->>'capabilityStatus' not in ('CAN_DO_NOW','DONE_BEFORE_NEEDS_REFRESHER','BASIC_EXPOSURE','NOT_DONE','UNSURE')
          when 'EDUCATION' then nullif(btrim(concat_ws('',correction->>'educationLevel',correction->>'educationField',correction->>'completionStatus')),'') is null
          when 'CERTIFICATION_OR_CREDENTIAL' then nullif(btrim(correction->>'credentialName'),'') is null
          when 'OTHER_STRUCTURED_FACT' then nullif(btrim(correction->>'factLabel'),'') is null or nullif(btrim(correction->>'factValue'),'') is null
          else true
        end)
        then raise exception 'invalid_structured_fact_correction'; end if;
      update public.ap_candidate_facts set verification='CUSTOMER_REJECTED',confirmed_or_corrected_at=now(),superseded_at=now() where id=fact.id;
      insert into public.ap_candidate_facts(draft_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,
        assertion_control_id,source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,fact_tier,supersedes_fact_id)
      values(p_draft_id,p_snapshot_id,fact.semantic_key,correction->>'category',correction-'category',
        'CUSTOMER_ASSERTION',p_snapshot_id,'fact-correction-'||fact.id::text,'Customer correction in four-step review','CUSTOMER_CONFIRMED',now(),
        fact.catalog_version,p_snapshot->>'schemaVersion',fact.fact_tier,fact.id) returning id into correction_id;
    end if;
    if decision is not null then insert into public.ap_fact_review_history(draft_id,snapshot_id,fact_id,decision,correction_fact_id)
      values(p_draft_id,p_snapshot_id,fact.id,decision::public.ap_fact_review_decision,correction_id); end if;
  end loop;

  for experience in select value from jsonb_array_elements(coalesce(p_snapshot->'experienceAdditions','[]'::jsonb)) loop
    mapped_kind:=case experience->>'kind' when 'EDUCATION_CERTIFICATION' then 'EDUCATION'::public.ap_experience_kind else (experience->>'kind')::public.ap_experience_kind end;
    insert into public.ap_candidate_facts(draft_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,starts_on,ends_on,intensity_percent,fact_tier)
    values(p_draft_id,p_snapshot_id,'experience:'||(experience->>'clientId'),mapped_kind::text,experience,'CUSTOMER_ASSERTION',p_snapshot_id,'experience-'||(experience->>'clientId'),'Customer supplied structured experience','CUSTOMER_CONFIRMED',now(),'applypack-experience-v1',p_snapshot->>'schemaVersion',nullif(experience->>'startsOn','')::date,nullif(experience->>'endsOn','')::date,nullif(experience->>'intensityPercent','')::numeric,'MATCH_ENHANCING') returning id into source_fact_id;
    insert into public.ap_experience_identities(draft_id,kind,label,starts_on,ends_on,intensity_percent,occupational_credit_eligible,source_fact_id)
    values(p_draft_id,mapped_kind,coalesce(nullif(experience->>'roleOrRelationship',''),nullif(experience->>'organizationOrProject',''),mapped_kind::text),nullif(experience->>'startsOn','')::date,nullif(experience->>'endsOn','')::date,nullif(experience->>'intensityPercent','')::numeric,mapped_kind not in ('CAREGIVING','CAREER_BREAK','OTHER_RELEVANT_LIFE_CONTEXT'),source_fact_id);
  end loop;
  for capability in select key,value from jsonb_each_text(coalesce(p_snapshot->'capabilities','{}'::jsonb)) loop
    insert into public.ap_candidate_facts(draft_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,capability_status,fact_tier)
    values(p_draft_id,p_snapshot_id,'capability:'||capability.key,'CAPABILITY_STATUS',jsonb_build_object('task',capability.key,'status',capability.value),'CUSTOMER_ASSERTION',p_snapshot_id,'capability-'||capability.key,'Customer supplied task capability','CUSTOMER_CONFIRMED',now(),'applypack-capabilities-2026-09-04',p_snapshot->>'schemaVersion',capability.value,'MATCH_ENHANCING');
  end loop;
  if prior_snapshot is not null then
    update public.ap_feasibility_requests set state='STALE',stale_reason='SUPERSEDED_PRE_ACTIVATION_SNAPSHOT',updated_at=now() where ap_feasibility_requests.snapshot_id=prior_snapshot and state in ('PENDING','CLAIMED');
    update public.ap_feasibility_assessments set invalidated_at=now() where ap_feasibility_assessments.snapshot_id=prior_snapshot and invalidated_at is null;
    update public.ap_quotes set invalidated_at=now() where ap_quotes.snapshot_id=prior_snapshot and invalidated_at is null;
    update public.ap_match_evaluations set invalidated_at=now() where ap_match_evaluations.snapshot_id=prior_snapshot and invalidated_at is null;
    update public.ap_human_review_records set invalidated_at=now() where ap_human_review_records.snapshot_id=prior_snapshot and invalidated_at is null;
    perform public.ap_release_unconsumed_capacity(id,'PRE_ACTIVATION_SNAPSHOT_SUPERSEDED') from public.ap_capacity_allocations where draft_id=p_draft_id and criteria_revision_id=prior_snapshot and lifecycle='RESERVED';
  end if;
  request_id:=gen_random_uuid();
  insert into public.ap_feasibility_requests(id,draft_id,snapshot_id,request_version,idempotency_key)
    values(request_id,p_draft_id,p_snapshot_id,'chunk2-v2','feasibility:'||p_snapshot_id::text);
  update public.ap_anonymous_drafts set state='COMPLETE',current_step=3,version=version+1,finalized_snapshot_id=p_snapshot_id,
    access_email_normalized=p_snapshot->>'accessEmailNormalized',updated_at=now() where id=p_draft_id returning version into d.version;
  insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
    values('ANONYMOUS_INTAKE_FINALIZED','INTAKE_SNAPSHOT',p_snapshot_id,jsonb_build_object('draftId',p_draft_id,'version',next_version,'feasibilityRequestId',request_id),'chunk2-v2');
  return query select p_snapshot_id,request_id,d.version;
end;
$$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202609040024','CHUNK2_REMEDIATION_EXPAND',0,now()) on conflict(migration_id,checkpoint) do nothing;

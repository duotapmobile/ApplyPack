-- Corrected-contract Chunk 2: four-step prepayment intake and immutable review handoff.
-- Additive only. Existing drafts, paid orders, and Chunk 1 compatibility records remain intact.

alter type public.ap_experience_kind add value if not exists 'OTHER_RELEVANT_LIFE_CONTEXT';

create type public.ap_fact_tier as enum ('SEARCH_CRITICAL','MATCH_ENHANCING','DOCUMENT_ONLY');
create type public.ap_fact_review_decision as enum ('CONFIRM','REJECT','SKIP','CORRECT');
create type public.ap_feasibility_request_state as enum ('PENDING','CLAIMED','COMPLETED','STALE','ERROR');

alter table public.ap_anonymous_drafts
  add column flow_version text,
  add column finalized_snapshot_id uuid references public.ap_intake_snapshots(id);
alter table public.ap_anonymous_drafts
  add constraint ap_four_step_current_step check (flow_version is distinct from 'FOUR_STEP_RESPONSIBILITY_V1' or current_step between 0 and 3);

alter table public.ap_candidate_facts
  add column fact_tier public.ap_fact_tier not null default 'MATCH_ENHANCING',
  add column customer_display_label text,
  add column customer_display_value jsonb;

create table public.ap_fact_presentations (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.ap_anonymous_drafts(id),
  fact_id uuid not null references public.ap_candidate_facts(id),
  draft_version bigint not null check (draft_version > 0),
  control_id text not null check (length(trim(control_id)) between 1 and 200),
  presented_at timestamptz not null default now(),
  unique(draft_id, fact_id, draft_version, control_id)
);

create table public.ap_fact_review_history (
  id bigint generated always as identity primary key,
  draft_id uuid not null references public.ap_anonymous_drafts(id),
  snapshot_id uuid not null references public.ap_intake_snapshots(id),
  fact_id uuid not null references public.ap_candidate_facts(id),
  decision public.ap_fact_review_decision not null,
  correction_fact_id uuid references public.ap_candidate_facts(id),
  reviewed_at timestamptz not null default now(),
  check ((decision = 'CORRECT') = (correction_fact_id is not null)),
  unique(snapshot_id, fact_id)
);

create table public.ap_targeted_intake_questions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.ap_anonymous_drafts(id),
  job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  stable_criterion_id uuid not null,
  question_kind text not null check (question_kind in ('AUTHORIZATION','SPONSORSHIP','LICENSE','CLEARANCE','TRAVEL','OTHER_ELIGIBILITY')),
  prompt_version text not null,
  state text not null default 'OPEN' check (state in ('OPEN','ANSWERED','EXPIRED','SUPERSEDED')),
  answer_sensitive_payload_id uuid references public.ap_sensitive_payloads(id),
  answer_sha256 text check (answer_sha256 is null or answer_sha256 ~ '^[0-9a-f]{64}$'),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  check ((state = 'ANSWERED') = (answer_sensitive_payload_id is not null and answer_sha256 is not null and answered_at is not null)),
  unique(draft_id, job_snapshot_id, stable_criterion_id, prompt_version)
);

create table public.ap_feasibility_requests (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.ap_anonymous_drafts(id),
  snapshot_id uuid not null references public.ap_intake_snapshots(id),
  state public.ap_feasibility_request_state not null default 'PENDING',
  request_version text not null,
  idempotency_key text not null unique,
  claimed_by text,
  claimed_at timestamptz,
  completed_assessment_id uuid references public.ap_feasibility_assessments(id),
  stale_reason text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'CLAIMED') = (claimed_by is not null and claimed_at is not null)),
  check ((state = 'COMPLETED') = (completed_assessment_id is not null)),
  unique(snapshot_id)
);

-- Coarse aggregate telemetry only: deliberately no draft, customer, session,
-- IP, user-agent, free-text, or arbitrary JSON columns.
create table public.ap_intake_event_counts (
  event_day date not null,
  event_name text not null check (event_name in ('STEP_VIEWED','DRAFT_SAVED','DRAFT_RESTORED','SAVE_CONFLICT','UPLOAD_STARTED','UPLOAD_REPLACED','UPLOAD_REMOVED','EXTRACTION_RETRY','FACT_PRESENTED','INTAKE_FINALIZED','INTAKE_UNAVAILABLE')),
  step smallint not null check (step between 1 and 4),
  count bigint not null default 1 check (count > 0),
  primary key(event_day, event_name, step)
);

create or replace function public.ap_create_anonymous_draft(p_draft_id uuid, p_secret_hash text, p_expires_at timestamptz)
returns table(id uuid, version bigint, state public.ap_draft_state, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_draft_id is null or p_secret_hash !~ '^[0-9a-f]{64}$' or p_expires_at <= now() then raise exception 'invalid_draft_configuration'; end if;
  return query insert into public.ap_anonymous_drafts(id, capability_secret_hash, expires_at, flow_version, answers)
    values (p_draft_id, p_secret_hash, p_expires_at, 'FOUR_STEP_RESPONSIBILITY_V1', jsonb_build_object('flowVersion','FOUR_STEP_RESPONSIBILITY_V1'))
    returning ap_anonymous_drafts.id, ap_anonymous_drafts.version, ap_anonymous_drafts.state, ap_anonymous_drafts.expires_at;
end;
$$;

create or replace function public.ap_read_four_step_draft(p_draft_id uuid, p_secret_hash text)
returns table(id uuid, version bigint, state public.ap_draft_state, current_step integer, answers jsonb, expires_at timestamptz, finalized_snapshot_id uuid)
language sql security definer set search_path = '' stable as $$
  select d.id, d.version, d.state, d.current_step, d.answers, d.expires_at, d.finalized_snapshot_id
  from public.ap_anonymous_drafts d
  where d.id=p_draft_id and d.capability_secret_hash=p_secret_hash and d.expires_at>now()
    and d.flow_version='FOUR_STEP_RESPONSIBILITY_V1' and d.state not in ('CONVERTED','EXPIRED');
$$;

create or replace function public.ap_save_four_step_draft(
  p_draft_id uuid, p_secret_hash text, p_expected_version bigint, p_current_step integer, p_answers jsonb
)
returns table(id uuid, version bigint, state public.ap_draft_state, current_step integer, answers jsonb, expires_at timestamptz, finalized_snapshot_id uuid)
language plpgsql security definer set search_path = '' as $$
declare d public.ap_anonymous_drafts;
begin
  if jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>65536 or p_current_step not between 0 and 3
    or p_answers->>'flowVersion'<>'FOUR_STEP_RESPONSIBILITY_V1' then raise exception 'invalid_four_step_payload'; end if;
  select ad.* into d from public.ap_anonymous_drafts ad where ad.id=p_draft_id and ad.capability_secret_hash=p_secret_hash
    and ad.expires_at>now() and ad.flow_version='FOUR_STEP_RESPONSIBILITY_V1' for update;
  if not found or d.state not in ('IN_PROGRESS','COMPLETE') then raise exception 'draft_capability_invalid'; end if;
  if d.version<>p_expected_version then raise exception using message='draft_version_conflict',detail=d.version::text,errcode='40001'; end if;
  return query update public.ap_anonymous_drafts set current_step=p_current_step,answers=p_answers,
    state=case when ap_anonymous_drafts.state='COMPLETE' then 'IN_PROGRESS'::public.ap_draft_state else ap_anonymous_drafts.state end,
    version=ap_anonymous_drafts.version+1,updated_at=now()
    where ap_anonymous_drafts.id=p_draft_id
    returning ap_anonymous_drafts.id,ap_anonymous_drafts.version,ap_anonymous_drafts.state,
      ap_anonymous_drafts.current_step,ap_anonymous_drafts.answers,ap_anonymous_drafts.expires_at,
      ap_anonymous_drafts.finalized_snapshot_id;
end;
$$;

create or replace function public.ap_record_fact_presentation(
  p_draft_id uuid,p_secret_hash text,p_expected_version bigint,p_fact_id uuid,p_control_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.ap_anonymous_drafts d where d.id=p_draft_id and d.capability_secret_hash=p_secret_hash
    and d.version=p_expected_version and d.expires_at>now() and d.state='IN_PROGRESS' and d.flow_version='FOUR_STEP_RESPONSIBILITY_V1')
    or not exists(select 1 from public.ap_candidate_facts f where f.id=p_fact_id and f.draft_id=p_draft_id and f.superseded_at is null)
    then raise exception 'draft_capability_invalid'; end if;
  insert into public.ap_fact_presentations(draft_id,fact_id,draft_version,control_id)
    values(p_draft_id,p_fact_id,p_expected_version,p_control_id) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.ap_increment_intake_event(p_event text,p_step integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_event not in ('STEP_VIEWED','DRAFT_SAVED','DRAFT_RESTORED','SAVE_CONFLICT','UPLOAD_STARTED','UPLOAD_REPLACED','UPLOAD_REMOVED','EXTRACTION_RETRY','FACT_PRESENTED','INTAKE_FINALIZED','INTAKE_UNAVAILABLE')
    or p_step not between 1 and 4 then raise exception 'invalid_intake_event'; end if;
  insert into public.ap_intake_event_counts(event_day,event_name,step) values((now() at time zone 'UTC')::date,p_event,p_step)
    on conflict(event_day,event_name,step) do update set count=public.ap_intake_event_counts.count+1;
  return true;
end;
$$;

create or replace function public.ap_retry_anonymous_document(
  p_draft_id uuid,p_secret_hash text,p_expected_draft_version bigint,p_kind public.ap_document_kind
)
returns table(document_id uuid,draft_version bigint) language plpgsql security definer set search_path = '' as $$
declare d public.ap_anonymous_drafts; document uuid;
begin
  select * into d from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash and expires_at>now() for update;
  if not found or d.version<>p_expected_draft_version then
    if found then raise exception using message='draft_version_conflict',detail=d.version::text,errcode='40001'; end if;
    raise exception 'draft_capability_invalid';
  end if;
  select id into document from public.ap_document_versions where draft_id=p_draft_id and kind=p_kind and is_current and processing_state='FAILED' for update;
  if not found then raise exception 'document_not_retryable'; end if;
  update public.ap_document_versions set processing_state='QUARANTINED',malware_status='PENDING',parse_status='PENDING',reference_isolation_status='PENDING',leak_scan_status='PENDING',failure_code=null,updated_at=now() where id=document;
  update public.ap_anonymous_drafts set version=version+1,updated_at=now() where id=p_draft_id returning version into d.version;
  return query select document,d.version;
end;
$$;
create or replace function public.ap_finalize_four_step_intake(
  p_draft_id uuid,p_secret_hash text,p_expected_version bigint,p_snapshot_id uuid,
  p_snapshot jsonb,p_content_sha256 text,p_sensitive_payload_id uuid,p_fact_reviews jsonb
)
returns table(snapshot_id uuid,feasibility_request_id uuid,draft_version bigint)
language plpgsql security definer set search_path = '' as $$
declare d public.ap_anonymous_drafts; prior_snapshot uuid; next_version integer; fact public.ap_candidate_facts;
  decision text; correction jsonb; correction_id uuid; request_id uuid; experience jsonb; capability record; source_fact_id uuid; mapped_kind public.ap_experience_kind;
begin
  if jsonb_typeof(p_snapshot)<>'object' or jsonb_typeof(p_fact_reviews)<>'object' or p_content_sha256!~'^[0-9a-f]{64}$' then raise exception 'invalid_intake_snapshot'; end if;
  select ad.* into d from public.ap_anonymous_drafts ad where ad.id=p_draft_id and ad.capability_secret_hash=p_secret_hash
    and ad.expires_at>now() and ad.flow_version='FOUR_STEP_RESPONSIBILITY_V1' for update;
  if not found or d.state not in ('IN_PROGRESS','COMPLETE') then raise exception 'draft_capability_invalid'; end if;
  if d.version<>p_expected_version then raise exception using message='draft_version_conflict',detail=d.version::text,errcode='40001'; end if;
  if not exists(select 1 from public.ap_document_versions where draft_id=p_draft_id and kind='RESUME' and is_current and processing_state<>'FAILED') then raise exception 'resume_required'; end if;
  if not exists(select 1 from public.ap_sensitive_payloads where id=p_sensitive_payload_id and draft_id=p_draft_id and content_sha256=p_snapshot->>'sensitivePayloadSha256') then raise exception 'sensitive_payload_required'; end if;
  for fact in select * from public.ap_candidate_facts where draft_id=p_draft_id and superseded_at is null and verification='EXTRACTED_UNCONFIRMED' loop
    decision:=p_fact_reviews->fact.id::text->>'decision';
    if fact.fact_tier='SEARCH_CRITICAL' and (decision is null or decision='SKIP' or not exists(select 1 from public.ap_fact_presentations x where x.draft_id=p_draft_id and x.fact_id=fact.id)) then raise exception 'search_critical_fact_review_required'; end if;
    if decision in ('CONFIRM','REJECT','CORRECT') and not exists(select 1 from public.ap_fact_presentations x where x.draft_id=p_draft_id and x.fact_id=fact.id) then raise exception 'unseen_fact_cannot_be_reviewed'; end if;
  end loop;
  prior_snapshot:=d.finalized_snapshot_id;
  select coalesce(max(s.version),0)+1 into next_version from public.ap_intake_snapshots s where s.draft_id=p_draft_id;
  insert into public.ap_intake_snapshots(id,draft_id,parent_snapshot_id,version,snapshot_kind,access_email_normalized,
    document_contact_email,desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,
    optional_industries,blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,
    employment_types,schedules,travel,benefits,dealbreakers,currency,salary_target_cents,salary_hard_minimum_cents,
    salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,
    salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,
    targeted_authorization_answers,sensitive_payload_id,content_sha256,canonicalization_version,schema_version,finalized_at)
  values(p_snapshot_id,p_draft_id,prior_snapshot,next_version,case when prior_snapshot is null then 'INITIAL' else 'PRE_ACTIVATION_EDIT' end,
    p_snapshot->>'accessEmailNormalized',p_snapshot->>'documentContactEmail',p_snapshot->'desiredActivities',p_snapshot->'avoidedActivities',
    p_snapshot->'optionalTitles',case when p_snapshot->'confirmedTitleRestriction'='null'::jsonb then null else p_snapshot->'confirmedTitleRestriction' end,p_snapshot->'optionalIndustries',p_snapshot->'blockedIndustries',
    p_snapshot->>'searchBreadth',(p_snapshot->>'guidanceRequested')::boolean,p_snapshot->'workModes',p_snapshot->>'stateOrDc',
    p_snapshot->'employmentTypes',p_snapshot->'schedules',p_snapshot->'travel',p_snapshot->'benefits',p_snapshot->'dealbreakers','USD',
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
      update public.ap_candidate_facts set verification='CUSTOMER_REJECTED',confirmed_or_corrected_at=now(),superseded_at=now() where id=fact.id;
      insert into public.ap_candidate_facts(draft_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,
        assertion_control_id,source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,fact_tier,supersedes_fact_id)
      values(p_draft_id,p_snapshot_id,fact.semantic_key,coalesce(correction->>'category','OTHER'),jsonb_build_object('value',correction->>'value'),
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
    values(request_id,p_draft_id,p_snapshot_id,'chunk2-v1','feasibility:'||p_snapshot_id::text);
  update public.ap_anonymous_drafts set state='COMPLETE',current_step=3,version=version+1,finalized_snapshot_id=p_snapshot_id,
    access_email_normalized=p_snapshot->>'accessEmailNormalized',updated_at=now() where id=p_draft_id returning version into d.version;
  insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
    values('ANONYMOUS_INTAKE_FINALIZED','INTAKE_SNAPSHOT',p_snapshot_id,jsonb_build_object('draftId',p_draft_id,'version',next_version,'feasibilityRequestId',request_id),'chunk2-v1');
  return query select p_snapshot_id,request_id,d.version;
end;
$$;

create trigger ap_fact_presentations_immutable before update or delete on public.ap_fact_presentations for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_fact_review_history_immutable before update or delete on public.ap_fact_review_history for each row execute function public.ap_prevent_immutable_mutation();

do $$ declare table_name text; begin
  foreach table_name in array array['ap_fact_presentations','ap_fact_review_history','ap_targeted_intake_questions','ap_feasibility_requests','ap_intake_event_counts'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public,anon,authenticated',table_name);
    execute format('grant all privileges on public.%I to service_role',table_name);
  end loop;
end $$;

revoke all on function public.ap_read_four_step_draft(uuid,text),public.ap_save_four_step_draft(uuid,text,bigint,integer,jsonb),
  public.ap_record_fact_presentation(uuid,text,bigint,uuid,text),public.ap_retry_anonymous_document(uuid,text,bigint,public.ap_document_kind),public.ap_increment_intake_event(text,integer),
  public.ap_finalize_four_step_intake(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ap_read_four_step_draft(uuid,text),public.ap_save_four_step_draft(uuid,text,bigint,integer,jsonb),
  public.ap_record_fact_presentation(uuid,text,bigint,uuid,text),public.ap_retry_anonymous_document(uuid,text,bigint,public.ap_document_kind),public.ap_increment_intake_event(text,integer),
  public.ap_finalize_four_step_intake(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202609040023','FOUR_STEP_INTAKE_EXPAND',0,now()) on conflict(migration_id,checkpoint) do nothing;

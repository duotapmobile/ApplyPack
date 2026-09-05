-- Chunk 3 second audit remediation: evidence-derived decisions and immutable ranking stages.
-- Expand-only. Existing evaluations remain readable and legacy production data is untouched.

alter table public.ap_match_evaluations
  add column if not exists explanation_evidence jsonb not null default '{}'::jsonb;
alter table public.ap_match_evaluations
  add constraint ap_match_evaluations_explanation_evidence_object
  check (jsonb_typeof(explanation_evidence)='object');

create table public.ap_match_selection_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.ap_intake_snapshots(id),
  purpose text not null check (purpose in ('ADMIN_PREVIEW','SEARCH_WORKFLOW','RELEASE','CONFLICT_REPLACEMENT')),
  scope_key text not null,
  requested_count integer not null check (requested_count > 0),
  selector_version text not null,
  evaluation_set_sha256 text not null check (evaluation_set_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text not null unique check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table public.ap_match_selection_members (
  selection_run_id uuid not null references public.ap_match_selection_runs(id),
  evaluation_id uuid not null references public.ap_match_evaluations(id),
  base_rank integer not null check (base_rank > 0),
  selected_rank integer check (selected_rank > 0),
  rank_explanation jsonb not null check (jsonb_typeof(rank_explanation)='object'),
  selector_explanation jsonb not null check (jsonb_typeof(selector_explanation)='object'),
  primary key(selection_run_id,evaluation_id),
  unique(selection_run_id,base_rank)
);
create unique index ap_match_selection_members_selected_rank_unique
  on public.ap_match_selection_members(selection_run_id,selected_rank)
  where selected_rank is not null;

create trigger ap_match_selection_runs_immutable before update or delete on public.ap_match_selection_runs
  for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_match_selection_members_immutable before update or delete on public.ap_match_selection_members
  for each row execute function public.ap_prevent_immutable_mutation();

create or replace function public.ap_guard_chunk3_human_review()
returns trigger language plpgsql set search_path='' as $$
declare
  snapshot public.ap_intake_snapshots;
  adjacent public.ap_human_review_records;
begin
  select * into snapshot from public.ap_intake_snapshots where id=new.snapshot_id;
  if not found or snapshot.customer_id is distinct from new.customer_id or snapshot.draft_id is distinct from new.draft_id then raise exception 'review_snapshot_subject_mismatch'; end if;
  if new.catalog_version in ('matching-rules-v1','matching-rules-v2') and (
    new.job_snapshot_id is null
    or new.review_kind not in ('PARSER_CORRECTION','FEASIBILITY_EVIDENCE','ADJACENT_EQUIVALENCE','TOOL_EQUIVALENCE','MATCH_EVIDENCE','CATEGORICAL_USEFULNESS','COMPENSATION_COMPARABILITY')
    or coalesce(new.decision->>'disposition','') not in ('RESOLVED_PASS','RESOLVED_FAIL','REQUIRES_MORE_EVIDENCE')
    or jsonb_typeof(new.decision->'evidenceChanges') is distinct from 'array'
    or jsonb_array_length(new.decision->'evidenceChanges')=0
    or jsonb_typeof(new.decision->'sourceEvidenceNodeIds') is distinct from 'array'
    or jsonb_array_length(new.decision->'sourceEvidenceNodeIds')=0
    or nullif(new.decision->>'rulesVersion','') is null
  ) then raise exception 'chunk3_review_evidence_incomplete'; end if;
  if new.review_kind='ADJACENT_EQUIVALENCE' and (
    jsonb_typeof(new.compared_tasks) is distinct from 'array' or jsonb_array_length(new.compared_tasks)=0
    or new.task_similarity<>'STRONG'
    or nullif(new.complexity,'') is null or nullif(new.autonomy,'') is null or nullif(new.scope,'') is null or nullif(new.domain_context,'') is null
    or jsonb_typeof(new.duration_and_intensity) is distinct from 'object'
    or jsonb_typeof(new.essential_tools) is distinct from 'array' or jsonb_array_length(new.essential_tools)=0
    or nullif(new.decision->>'stableCriterionId','') is null
    or new.decision->>'equivalentForCriterion' is distinct from 'true'
    or jsonb_typeof(new.decision->'candidateFactVersionIds') is distinct from 'array'
    or jsonb_array_length(new.decision->'candidateFactVersionIds')=0
    or exists(
      (select jsonb_array_elements_text(new.decision->'candidateFactIds') except select jsonb_array_elements_text(new.decision->'candidateFactVersionIds'))
      union all
      (select jsonb_array_elements_text(new.decision->'candidateFactVersionIds') except select jsonb_array_elements_text(new.decision->'candidateFactIds'))
    )
    or not exists(select 1 from public.ap_requirement_nodes node where node.job_snapshot_id=new.job_snapshot_id and node.stable_criterion_id=(new.decision->>'stableCriterionId')::uuid)
  ) then raise exception 'adjacent_equivalence_exact_review_required'; end if;
  if new.review_kind='MATCH_EVIDENCE' and (
    nullif(new.decision->>'stableCriterionId','') is null
    or coalesce(new.decision->>'evidenceRelation','') not in ('DIRECT','ADJACENT','TRANSFERABLE','UNSUPPORTED')
    or jsonb_typeof(new.decision->'candidateFactVersionIds') is distinct from 'array'
    or jsonb_array_length(new.decision->'candidateFactVersionIds')=0
    or exists(
      (select jsonb_array_elements_text(new.decision->'candidateFactIds') except select jsonb_array_elements_text(new.decision->'candidateFactVersionIds'))
      union all
      (select jsonb_array_elements_text(new.decision->'candidateFactVersionIds') except select jsonb_array_elements_text(new.decision->'candidateFactIds'))
    )
    or exists(select 1 from jsonb_array_elements_text(new.decision->'sourceEvidenceNodeIds') evidence_id where not exists(
      select 1 from public.ap_requirement_nodes node where node.id=evidence_id::uuid and node.job_snapshot_id=new.job_snapshot_id and node.stable_criterion_id=(new.decision->>'stableCriterionId')::uuid
    ))
    or exists(select 1 from jsonb_array_elements_text(new.decision->'candidateFactVersionIds') fact_id where not exists(
      select 1 from public.ap_candidate_facts fact where fact.id=fact_id::uuid and fact.snapshot_id=new.snapshot_id and fact.superseded_at is null
        and (fact.verification='CUSTOMER_CONFIRMED' or (fact.verification='HUMAN_VERIFIED' and fact.source_kind='HUMAN_VERIFICATION' and fact.supplied_source_id is not null))
    ))
    or (new.decision->>'disposition'='RESOLVED_PASS' and (
      new.decision->>'evidenceRelation' in ('UNSUPPORTED','TRANSFERABLE')
      or not exists(select 1 from public.ap_requirement_nodes node where node.job_snapshot_id=new.job_snapshot_id and node.stable_criterion_id=(new.decision->>'stableCriterionId')::uuid)
    ))
  ) then raise exception 'match_evidence_binding_invalid'; end if;
  if new.review_kind='MATCH_EVIDENCE' and new.decision->>'evidenceRelation'='ADJACENT' then
    select * into adjacent from public.ap_human_review_records where id=(new.decision->>'adjacentEquivalenceReviewId')::uuid;
    if not found or adjacent.invalidated_at is not null or adjacent.review_kind<>'ADJACENT_EQUIVALENCE' or adjacent.snapshot_id<>new.snapshot_id or adjacent.job_snapshot_id<>new.job_snapshot_id
      or adjacent.decision->>'stableCriterionId'<>new.decision->>'stableCriterionId' or adjacent.decision->>'equivalentForCriterion'<>'true'
      or exists(
        (select jsonb_array_elements_text(adjacent.decision->'candidateFactVersionIds') except select jsonb_array_elements_text(new.decision->'candidateFactVersionIds'))
        union all
        (select jsonb_array_elements_text(new.decision->'candidateFactVersionIds') except select jsonb_array_elements_text(adjacent.decision->'candidateFactVersionIds'))
      ) then raise exception 'adjacent_match_evidence_review_invalid'; end if;
  end if;
  if new.review_kind='CATEGORICAL_USEFULNESS' and (
    new.decision->>'certifiedNotQuotaFiller' is distinct from 'true'
    or nullif(new.decision->>'reviewerWorthwhileReason','') is null
    or coalesce(new.decision->>'applicationReadiness','') not in ('READY','NEEDS_CUSTOMER_ACTION','BLOCKED')
    or coalesce(new.decision->>'presentationRisk','') not in ('LOW','MEDIUM','HIGH','NOT_ASSESSED')
    or jsonb_typeof(new.decision->'presentationRiskReasons') is distinct from 'array'
    or jsonb_typeof(new.decision->'explanationEvidence') is distinct from 'object'
    or exists(select 1 from unnest(array['whatJobInvolves','whyMadeList','howExperienceConnects','whatMayBeNew','whatToKnow']) section where
      jsonb_typeof(new.decision->'explanationEvidence'->section) is distinct from 'object'
      or jsonb_typeof(new.decision->'explanationEvidence'->section->'sourceEvidenceNodeIds') is distinct from 'array'
      or jsonb_array_length(new.decision->'explanationEvidence'->section->'sourceEvidenceNodeIds')=0)
  ) then raise exception 'categorical_usefulness_evidence_invalid'; end if;
  if new.review_kind='COMPENSATION_COMPARABILITY' and (
    jsonb_typeof(new.decision->'correctLocationRange') is distinct from 'boolean'
    or jsonb_typeof(new.decision->'workerBasisComparable') is distinct from 'boolean'
  ) then raise exception 'compensation_comparability_review_invalid'; end if;
  return new;
end; $$;

create or replace function public.ap_guard_chunk3_match_evaluation()
returns trigger language plpgsql set search_path='' as $$
declare
  member public.ap_inventory_members;
  job public.ap_job_snapshots;
  linked_authorization public.ap_source_authorizations;
  current_authorization public.ap_source_authorizations;
begin
  if new.legacy_compatibility then return new; end if;
  if new.inventory_member_id is null or new.inventory_version_id is null then raise exception 'persisted_inventory_provenance_required'; end if;
  select * into member from public.ap_inventory_members where id=new.inventory_member_id;
  if not found or member.inventory_version_id<>new.inventory_version_id or member.job_snapshot_id<>new.job_snapshot_id or not member.selected_by_deduplication then raise exception 'evaluation_inventory_provenance_mismatch'; end if;
  select * into job from public.ap_job_snapshots where id=new.job_snapshot_id;
  if not found or job.requirement_completeness<>100 then raise exception 'complete_requirement_parse_required'; end if;
  select * into linked_authorization from public.ap_source_authorizations where id=job.source_authorization_id;
  select * into current_authorization from public.ap_source_authorizations where source_id=linked_authorization.source_id order by created_at desc,authorization_version desc limit 1;
  if not found or current_authorization.id<>linked_authorization.id or current_authorization.state not in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY') then raise exception 'current_source_authorization_required'; end if;
  if new.calculation_version='matching-rules-v2' and (
    jsonb_typeof(new.explanation_evidence)<>'object'
    or new.rank_explanation->>'state' is distinct from 'AWAITING_SELECTION_RUN'
    or new.selector_explanation->>'state' is distinct from 'AWAITING_SELECTION_RUN'
    or new.fit_score='NaN'::numeric or new.evidence_confidence='NaN'::numeric
  ) then raise exception 'server_derived_evaluation_metadata_invalid'; end if;
  if cardinality(new.active_root_keys)<>(select count(distinct value) from unnest(new.active_root_keys) value) then raise exception 'duplicate_active_root_key'; end if;
  if jsonb_array_length(new.root_results)<>cardinality(new.active_root_keys) then raise exception 'root_set_mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(new.root_results) item where jsonb_typeof(item)<>'object' or nullif(item->>'rootKey','') is null) then raise exception 'root_result_key_required'; end if;
  if exists(
    select 1 from (
      (select value as root_key from unnest(new.active_root_keys) value except select item->>'rootKey' from jsonb_array_elements(new.root_results) item)
      union all
      (select item->>'rootKey' from jsonb_array_elements(new.root_results) item except select value from unnest(new.active_root_keys) value)
    ) difference
  ) then raise exception 'root_set_mismatch'; end if;
  if new.fit_score is not null and (new.eligibility not in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') or new.usefulness_result<>'PASS') then raise exception 'fit_without_eligibility_and_usefulness'; end if;
  if new.eligibility in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') and new.usefulness_result='PASS' and new.fit_score is null then raise exception 'eligible_useful_fit_required'; end if;
  if new.confidence_label<>(case when new.evidence_confidence>=80 then 'HIGH' when new.evidence_confidence>=60 then 'MEDIUM' else 'LOW' end) then raise exception 'confidence_label_mismatch'; end if;
  if new.evidence_confidence<60 and new.human_review_id is null then raise exception 'low_confidence_requires_review'; end if;
  if exists(select 1 from jsonb_array_elements_text(new.presentation_risk_reasons) reason where reason not in ('CONTACT_DETAIL_CONFIRMATION','FORMAT_REPAIR','CLAIM_WORDING_REVIEW','APPLICATION_QUESTION_REVIEW')) then raise exception 'presentation_risk_reason_not_allowed'; end if;
  if new.calculation_version='matching-rules-v2' and new.usefulness_result='PASS' and exists(select 1 from unnest(array['whatJobInvolves','whyMadeList','howExperienceConnects','whatMayBeNew','whatToKnow']) section where
    jsonb_typeof(new.explanation_evidence->section) is distinct from 'object'
    or jsonb_typeof(new.explanation_evidence->section->'sourceEvidenceNodeIds') is distinct from 'array'
    or jsonb_array_length(new.explanation_evidence->section->'sourceEvidenceNodeIds')=0)
  then raise exception 'five_section_explanation_evidence_required'; end if;
  if exists(select 1 from unnest(new.candidate_fact_ids) fact_id where not exists(
    select 1 from public.ap_candidate_facts fact where fact.id=fact_id and fact.snapshot_id=new.snapshot_id and fact.superseded_at is null
      and (fact.verification='CUSTOMER_CONFIRMED' or (fact.verification='HUMAN_VERIFIED' and fact.source_kind='HUMAN_VERIFICATION' and fact.supplied_source_id is not null))
  )) then raise exception 'evaluation_candidate_fact_invalid'; end if;
  if exists(
    select 1 from jsonb_array_elements(new.leaf_results) leaf
    join public.ap_requirement_nodes node on node.id::text=leaf->>'requirementNodeId'
    where leaf->>'result'='PASS' and node.criterion_type in ('EXPERIENCE','EDUCATION','CERTIFICATION_LICENSE','RESPONSIBILITY','TOOL_CAPABILITY','AUTHORIZATION_SPONSORSHIP')
      and (jsonb_typeof(leaf->'candidateFactIds') is distinct from 'array' or jsonb_array_length(leaf->'candidateFactIds')=0)
  ) then raise exception 'passing_candidate_requirement_missing_fact'; end if;
  return new;
end; $$;

create or replace function public.ap_persist_match_selection(
  p_snapshot_id uuid,
  p_purpose text,
  p_scope_key text,
  p_requested_count integer,
  p_selector_version text,
  p_evaluation_set_sha256 text,
  p_content_sha256 text,
  p_members jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  run_id uuid;
begin
  if p_purpose not in ('ADMIN_PREVIEW','SEARCH_WORKFLOW','RELEASE','CONFLICT_REPLACEMENT') or nullif(btrim(p_scope_key),'') is null or p_requested_count<=0
    or p_evaluation_set_sha256 !~ '^[0-9a-f]{64}$' or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members)=0 then raise exception 'selection_payload_invalid'; end if;
  if exists(select 1 from jsonb_array_elements(p_members) member where
    jsonb_typeof(member)<>'object' or (member->>'baseRank')::integer<=0
    or jsonb_typeof(member->'rankExplanation')<>'object' or jsonb_typeof(member->'selectorExplanation')<>'object'
    or not exists(select 1 from public.ap_match_evaluations evaluation where evaluation.id=(member->>'evaluationId')::uuid and evaluation.snapshot_id=p_snapshot_id and evaluation.invalidated_at is null and not evaluation.legacy_compatibility)
  ) then raise exception 'selection_member_invalid'; end if;
  if (select count(distinct (member->>'evaluationId')::uuid) from jsonb_array_elements(p_members) member)<>jsonb_array_length(p_members)
    or (select count(distinct (member->>'baseRank')::integer) from jsonb_array_elements(p_members) member)<>jsonb_array_length(p_members)
    or (select max((member->>'baseRank')::integer) from jsonb_array_elements(p_members) member)<>jsonb_array_length(p_members)
  then raise exception 'selection_base_rank_set_invalid'; end if;
  if exists(select 1 from jsonb_array_elements(p_members) member where member ? 'selectedRank' and member->>'selectedRank' is not null and (member->>'selectedRank')::integer>p_requested_count)
    or (select count(*) from jsonb_array_elements(p_members) member where member ? 'selectedRank' and member->>'selectedRank' is not null)
      <>(select count(distinct (member->>'selectedRank')::integer) from jsonb_array_elements(p_members) member where member ? 'selectedRank' and member->>'selectedRank' is not null)
    or (select count(*) from jsonb_array_elements(p_members) member where member ? 'selectedRank' and member->>'selectedRank' is not null)<>least(p_requested_count,jsonb_array_length(p_members))
    or coalesce((select min((member->>'selectedRank')::integer) from jsonb_array_elements(p_members) member where member ? 'selectedRank' and member->>'selectedRank' is not null),0)<>1
    or coalesce((select max((member->>'selectedRank')::integer) from jsonb_array_elements(p_members) member where member ? 'selectedRank' and member->>'selectedRank' is not null),0)<>least(p_requested_count,jsonb_array_length(p_members))
  then raise exception 'selection_selected_rank_set_invalid'; end if;
  insert into public.ap_match_selection_runs(snapshot_id,purpose,scope_key,requested_count,selector_version,evaluation_set_sha256,content_sha256)
  values(p_snapshot_id,p_purpose,p_scope_key,p_requested_count,p_selector_version,p_evaluation_set_sha256,p_content_sha256)
  on conflict(content_sha256) do nothing returning id into run_id;
  if run_id is null then select id into run_id from public.ap_match_selection_runs where content_sha256=p_content_sha256; end if;
  insert into public.ap_match_selection_members(selection_run_id,evaluation_id,base_rank,selected_rank,rank_explanation,selector_explanation)
  select run_id,(member->>'evaluationId')::uuid,(member->>'baseRank')::integer,nullif(member->>'selectedRank','')::integer,member->'rankExplanation',member->'selectorExplanation'
  from jsonb_array_elements(p_members) member on conflict(selection_run_id,evaluation_id) do nothing;
  return run_id;
end; $$;

alter table public.ap_match_selection_runs enable row level security;
alter table public.ap_match_selection_members enable row level security;
revoke all on public.ap_match_selection_runs,public.ap_match_selection_members from public,anon,authenticated;
grant all privileges on public.ap_match_selection_runs,public.ap_match_selection_members to service_role;
revoke all on function public.ap_persist_match_selection(uuid,text,text,integer,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ap_persist_match_selection(uuid,text,text,integer,text,text,text,jsonb) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202609050027','CHUNK3_PERSISTED_EVIDENCE_EXPAND',0,now())
on conflict(migration_id,checkpoint) do nothing;

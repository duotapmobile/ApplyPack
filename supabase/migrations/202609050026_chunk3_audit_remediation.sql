-- Chunk 3 audit remediation: persisted matching provenance and exact invariants.
-- Expand-only. No legacy data is dropped or rewritten.

alter table public.ap_match_evaluations
  add column if not exists inventory_member_id uuid references public.ap_inventory_members(id),
  add column if not exists inventory_version_id uuid references public.ap_inventory_versions(id);

alter table public.search_candidates
  add column if not exists evaluation_id uuid references public.ap_match_evaluations(id);

create unique index if not exists ap_current_evaluation_per_inventory_member
  on public.ap_match_evaluations(inventory_member_id)
  where inventory_member_id is not null and invalidated_at is null;
create unique index if not exists search_candidates_order_evaluation_unique
  on public.search_candidates(search_order_id,evaluation_id)
  where evaluation_id is not null;

create or replace function public.ap_guard_chunk3_match_evaluation()
returns trigger language plpgsql set search_path='' as $$
declare
  member public.ap_inventory_members;
begin
  if new.legacy_compatibility then return new; end if;
  if new.inventory_member_id is null or new.inventory_version_id is null then raise exception 'persisted_inventory_provenance_required'; end if;
  select * into member from public.ap_inventory_members where id=new.inventory_member_id;
  if not found or member.inventory_version_id<>new.inventory_version_id or member.job_snapshot_id<>new.job_snapshot_id or not member.selected_by_deduplication then
    raise exception 'evaluation_inventory_provenance_mismatch';
  end if;
  if cardinality(new.active_root_keys)<>(select count(distinct value) from unnest(new.active_root_keys) value) then raise exception 'duplicate_active_root_key'; end if;
  if jsonb_array_length(new.root_results)<>cardinality(new.active_root_keys) then raise exception 'root_set_mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(new.root_results) item where jsonb_typeof(item)<>'object' or nullif(item->>'rootKey','') is null) then raise exception 'root_result_key_required'; end if;
  if exists(
    select 1 from (
      (select value as root_key from unnest(new.active_root_keys) value
       except select item->>'rootKey' from jsonb_array_elements(new.root_results) item)
      union all
      (select item->>'rootKey' from jsonb_array_elements(new.root_results) item
       except select value from unnest(new.active_root_keys) value)
    ) difference
  ) then raise exception 'root_set_mismatch'; end if;
  if new.fit_score is not null and (new.eligibility not in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') or new.usefulness_result<>'PASS') then raise exception 'fit_without_eligibility_and_usefulness'; end if;
  if new.eligibility in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') and new.usefulness_result='PASS' and new.fit_score is null then raise exception 'eligible_useful_fit_required'; end if;
  if new.confidence_label<>(case when new.evidence_confidence>=80 then 'HIGH' when new.evidence_confidence>=60 then 'MEDIUM' else 'LOW' end) then raise exception 'confidence_label_mismatch'; end if;
  if new.evidence_confidence<60 and new.human_review_id is null then raise exception 'low_confidence_requires_review'; end if;
  if exists(select 1 from jsonb_array_elements_text(new.presentation_risk_reasons) reason where reason not in ('CONTACT_DETAIL_CONFIRMATION','FORMAT_REPAIR','CLAIM_WORDING_REVIEW','APPLICATION_QUESTION_REVIEW')) then raise exception 'presentation_risk_reason_not_allowed'; end if;
  return new;
end; $$;

create or replace function public.ap_guard_chunk3_human_review()
returns trigger language plpgsql set search_path='' as $$
declare snapshot public.ap_intake_snapshots;
begin
  select * into snapshot from public.ap_intake_snapshots where id=new.snapshot_id;
  if not found or snapshot.customer_id is distinct from new.customer_id or snapshot.draft_id is distinct from new.draft_id then raise exception 'review_snapshot_subject_mismatch'; end if;
  if new.catalog_version in ('matching-rules-v1','matching-rules-v2') and (
    new.job_snapshot_id is null
    or new.review_kind not in ('PARSER_CORRECTION','FEASIBILITY_EVIDENCE','ADJACENT_EQUIVALENCE','TOOL_EQUIVALENCE','CATEGORICAL_USEFULNESS')
    or new.decision->>'disposition' not in ('RESOLVED_PASS','RESOLVED_FAIL','REQUIRES_MORE_EVIDENCE')
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
    or new.decision->>'equivalentForCriterion'<>'true'
    or jsonb_typeof(new.decision->'candidateFactVersionIds') is distinct from 'array'
    or jsonb_array_length(new.decision->'candidateFactVersionIds')=0
    or exists(
      (select jsonb_array_elements_text(new.decision->'candidateFactIds') except select jsonb_array_elements_text(new.decision->'candidateFactVersionIds'))
      union all
      (select jsonb_array_elements_text(new.decision->'candidateFactVersionIds') except select jsonb_array_elements_text(new.decision->'candidateFactIds'))
    )
    or not exists(select 1 from public.ap_requirement_nodes node where node.job_snapshot_id=new.job_snapshot_id and node.stable_criterion_id=(new.decision->>'stableCriterionId')::uuid)
  ) then raise exception 'adjacent_equivalence_exact_review_required'; end if;
  return new;
end; $$;

create or replace function public.ap_persist_derived_feasibility_assessment(p_request_id uuid,p_worker_id text,p_rules_version text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  request_row public.ap_feasibility_requests;
  plan public.ap_feasibility_coverage_plans;
  selected_count integer;
  evaluation_count integer;
  deliverable_count integer;
  reviewable_count integer;
  excluded_count integer;
  candidate_blocker boolean;
  human_blocker boolean;
  qualification_gap boolean;
  evidence_gap boolean;
  compensation_below boolean;
  compensation_unconfirmed boolean;
  reasons public.ap_feasibility_reason[] := '{}'::public.ap_feasibility_reason[];
  primary_reason public.ap_feasibility_reason;
  outcome public.ap_feasibility_outcome;
  resolution_blocker public.ap_resolution_blocker;
  assessment_id uuid;
begin
  if nullif(btrim(p_worker_id),'') is null or nullif(btrim(p_rules_version),'') is null then raise exception 'worker_and_rules_version_required'; end if;
  select * into request_row from public.ap_feasibility_requests where id=p_request_id and state='CLAIMED' and claimed_by=p_worker_id for update;
  if not found then raise exception 'feasibility_request_claim_mismatch'; end if;
  select * into plan from public.ap_feasibility_coverage_plans where snapshot_id=request_row.snapshot_id order by created_at desc limit 1;
  if not found then raise exception 'persisted_feasibility_plan_required'; end if;
  select count(*) into selected_count from public.ap_inventory_members member where member.inventory_version_id=plan.inventory_version_id and member.selected_by_deduplication;
  select count(*) into evaluation_count
    from public.ap_inventory_members member
    join public.ap_match_evaluations evaluation on evaluation.inventory_member_id=member.id and evaluation.inventory_version_id=member.inventory_version_id and evaluation.job_snapshot_id=member.job_snapshot_id
    where member.inventory_version_id=plan.inventory_version_id and member.selected_by_deduplication and evaluation.snapshot_id=request_row.snapshot_id and not evaluation.legacy_compatibility and evaluation.invalidated_at is null;
  if selected_count<>evaluation_count then raise exception 'persisted_evaluation_coverage_incomplete'; end if;

  with classified as (
    select evaluation.*,
      case when authz.state in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY')
        and job.legitimacy_result='PASS' and job.listing_activity_result='PASS' and job.application_path_result='PASS'
        and evaluation.eligibility in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') and evaluation.categorical_evidence_sufficient and evaluation.usefulness_result='PASS'
        and evaluation.salary_disposition<>'FAIL' and evaluation.application_readiness<>'BLOCKED'
        then 'PRELIMINARILY_DELIVERABLE'
        when evaluation.eligibility in ('INELIGIBLE','INVALID') or not evaluation.categorical_evidence_sufficient or evaluation.usefulness_result='FAIL'
          or evaluation.salary_disposition='FAIL' or job.legitimacy_result='FAIL' or job.listing_activity_result='FAIL' or job.application_path_result='FAIL'
          then 'EXCLUDED' else 'REVIEWABLE' end as classification
    from public.ap_inventory_members member
    join public.ap_match_evaluations evaluation on evaluation.inventory_member_id=member.id and evaluation.invalidated_at is null
    join public.ap_job_snapshots job on job.id=member.job_snapshot_id
    left join public.ap_source_authorizations authz on authz.id=job.source_authorization_id
    where member.inventory_version_id=plan.inventory_version_id and member.selected_by_deduplication and evaluation.snapshot_id=request_row.snapshot_id and not evaluation.legacy_compatibility
  )
  select
    count(*) filter(where classification='PRELIMINARILY_DELIVERABLE'),
    count(*) filter(where classification='REVIEWABLE'),
    count(*) filter(where classification='EXCLUDED'),
    coalesce(bool_or(eligibility='NEEDS_CANDIDATE_INPUT'),false),
    coalesce(bool_or(classification='REVIEWABLE'),false),
    coalesce(bool_or(eligibility in ('INELIGIBLE','INVALID')),false),
    coalesce(bool_or(not categorical_evidence_sufficient or usefulness_result='FAIL'),false),
    coalesce(bool_or(salary_status='PUBLISHED_BELOW_MINIMUM'),false),
    coalesce(bool_or(salary_status in ('UNPUBLISHED','ESTIMATE_ONLY','PUBLISHED_NONCOMPARABLE') and salary_disposition='FAIL'),false)
  into deliverable_count,reviewable_count,excluded_count,candidate_blocker,human_blocker,qualification_gap,evidence_gap,compensation_below,compensation_unconfirmed
  from classified;

  if plan.coverage_disposition='NOT_REQUIRED_CONSTRAINT_COLLISION' then reasons:=array_append(reasons,'CONSTRAINT_COLLISION'::public.ap_feasibility_reason); end if;
  if qualification_gap then reasons:=array_append(reasons,'QUALIFICATION_GAP'::public.ap_feasibility_reason); end if;
  if evidence_gap then reasons:=array_append(reasons,'EVIDENCE_GAP'::public.ap_feasibility_reason); end if;
  if compensation_below then reasons:=array_append(reasons,'COMPENSATION_BELOW_MINIMUM'::public.ap_feasibility_reason); end if;
  if compensation_unconfirmed then reasons:=array_append(reasons,'COMPENSATION_UNCONFIRMED'::public.ap_feasibility_reason); end if;
  if selected_count=0 or deliverable_count+reviewable_count=0 then reasons:=array_append(reasons,'INVENTORY_SHORTAGE'::public.ap_feasibility_reason); end if;
  primary_reason:=case
    when 'CONSTRAINT_COLLISION'=any(reasons) then 'CONSTRAINT_COLLISION'::public.ap_feasibility_reason
    when 'QUALIFICATION_GAP'=any(reasons) then 'QUALIFICATION_GAP'::public.ap_feasibility_reason
    when 'EVIDENCE_GAP'=any(reasons) then 'EVIDENCE_GAP'::public.ap_feasibility_reason
    when 'COMPENSATION_BELOW_MINIMUM'=any(reasons) then 'COMPENSATION_BELOW_MINIMUM'::public.ap_feasibility_reason
    when 'COMPENSATION_UNCONFIRMED'=any(reasons) then 'COMPENSATION_UNCONFIRMED'::public.ap_feasibility_reason
    when 'INVENTORY_SHORTAGE'=any(reasons) then 'INVENTORY_SHORTAGE'::public.ap_feasibility_reason else null end;
  outcome:=case when deliverable_count>=10 then 'LIKELY'::public.ap_feasibility_outcome when deliverable_count+reviewable_count>=1 then 'LIMITED'::public.ap_feasibility_outcome else 'INFEASIBLE'::public.ap_feasibility_outcome end;
  resolution_blocker:=case when candidate_blocker then 'NEEDS_CANDIDATE_INPUT'::public.ap_resolution_blocker when human_blocker then 'NEEDS_HUMAN_REVIEW'::public.ap_resolution_blocker else 'NONE'::public.ap_resolution_blocker end;
  insert into public.ap_feasibility_assessments(snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,reviewable_count,excluded_count,reasons,primary_reason,rules_version,expires_at)
    values(request_row.snapshot_id,plan.id,'COMPLETE',outcome,resolution_blocker,deliverable_count,reviewable_count,excluded_count,reasons,primary_reason,p_rules_version,now()+interval '60 minutes') returning id into assessment_id;
  insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
    values('FEASIBILITY_DERIVED','FEASIBILITY_ASSESSMENT',assessment_id,jsonb_build_object('requestId',p_request_id,'inventoryVersionId',plan.inventory_version_id,'selectedMembers',selected_count,'evaluations',evaluation_count,'rulesVersion',p_rules_version),'chunk3-remediation-v1');
  return assessment_id;
end; $$;

create or replace function public.ap_persist_parsed_inventory_job(p_criteria_snapshot_id uuid,p_inventory_version_id uuid,p_stable_normalized_job_id text,p_job_snapshot jsonb,p_requirement_nodes jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  job_snapshot_id uuid := (p_job_snapshot->>'id')::uuid;
  member_id uuid;
begin
  if nullif(btrim(p_stable_normalized_job_id),'') is null or jsonb_typeof(p_job_snapshot)<>'object' or jsonb_typeof(p_requirement_nodes)<>'array' or jsonb_array_length(p_requirement_nodes)=0 then raise exception 'parsed_inventory_payload_invalid'; end if;
  if not exists(select 1 from public.ap_feasibility_coverage_plans plan where plan.snapshot_id=p_criteria_snapshot_id and plan.inventory_version_id=p_inventory_version_id) then raise exception 'coverage_inventory_snapshot_mismatch'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_inventory_version_id::text,0));
  if exists(
    select 1 from public.ap_inventory_members member
    join public.ap_job_snapshots existing on existing.id=member.job_snapshot_id
    where member.inventory_version_id=p_inventory_version_id and (
      member.stable_normalized_job_id=p_stable_normalized_job_id
      or existing.canonical_application_url=p_job_snapshot->>'canonical_application_url'
      or (existing.canonical_employer_listing_url is not null and existing.canonical_employer_listing_url=p_job_snapshot->>'canonical_employer_listing_url')
      or (existing.external_job_id is not null and existing.external_job_id=p_job_snapshot->>'external_job_id' and existing.canonical_employer_domain=p_job_snapshot->>'canonical_employer_domain')
    )
  ) then raise exception 'duplicate_inventory_job'; end if;
  insert into public.ap_job_snapshots(id,legacy_job_id,origin,discovery_source,external_job_id,canonical_application_url,application_host_type,canonical_employer_listing_url,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,live_verified_at,compensation_text,compensation_source,location_and_work_mode,parser_version,content_sha256,source_authorization_id,first_seen_at,canonical_employer_domain,employer_identity_result,application_path_result,listing_activity_result,legitimacy_result,requirement_completeness,compensation_completeness,canonicalization_version,legacy_compatibility)
  values(job_snapshot_id,(p_job_snapshot->>'legacy_job_id')::uuid,(p_job_snapshot->>'origin')::public.ap_job_origin,p_job_snapshot->>'discovery_source',nullif(p_job_snapshot->>'external_job_id',''),p_job_snapshot->>'canonical_application_url',p_job_snapshot->>'application_host_type',nullif(p_job_snapshot->>'canonical_employer_listing_url',''),p_job_snapshot->>'source_url',p_job_snapshot->>'company',p_job_snapshot->>'exact_title',p_job_snapshot->>'normalized_fingerprint',p_job_snapshot->'captured_listing',(p_job_snapshot->>'retrieved_at')::timestamptz,nullif(p_job_snapshot->>'posted_on','')::date,(p_job_snapshot->>'posted_date_unknown')::boolean,(p_job_snapshot->>'live_verified_at')::timestamptz,nullif(p_job_snapshot->>'compensation_text',''),nullif(p_job_snapshot->>'compensation_source',''),p_job_snapshot->'location_and_work_mode',p_job_snapshot->>'parser_version',p_job_snapshot->>'content_sha256',(p_job_snapshot->>'source_authorization_id')::uuid,(p_job_snapshot->>'first_seen_at')::timestamptz,p_job_snapshot->>'canonical_employer_domain',p_job_snapshot->>'employer_identity_result',p_job_snapshot->>'application_path_result',p_job_snapshot->>'listing_activity_result',p_job_snapshot->>'legitimacy_result',(p_job_snapshot->>'requirement_completeness')::integer,(p_job_snapshot->>'compensation_completeness')::integer,p_job_snapshot->>'canonicalization_version',false);
  insert into public.ap_requirement_nodes(id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
  select node.id,job_snapshot_id,node.parent_id,node.position,node.node_kind,node.criterion_type,node.stable_criterion_id,node.semantic_key,node.requirement_strength,node.source_locator,node.parser_certainty,node.criterion_version,node.typed_value,node.source_excerpt,node.classification_method,coalesce(node.human_correction_history,'[]'::jsonb)
  from jsonb_to_recordset(p_requirement_nodes) as node(id uuid,parent_id uuid,position integer,node_kind public.ap_requirement_node_kind,criterion_type public.ap_criterion_type,stable_criterion_id uuid,semantic_key text,requirement_strength text,source_locator text,parser_certainty numeric,criterion_version text,typed_value jsonb,source_excerpt text,classification_method text,human_correction_history jsonb);
  insert into public.ap_inventory_members(inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication)
  values(p_inventory_version_id,job_snapshot_id,p_stable_normalized_job_id,true) returning id into member_id;
  return member_id;
end; $$;

revoke insert,update,delete on public.ap_feasibility_assessments from service_role;
grant select on public.ap_feasibility_assessments to service_role;
revoke all on function public.ap_persist_derived_feasibility_assessment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.ap_persist_derived_feasibility_assessment(uuid,text,text) to service_role;
revoke all on function public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202609050026','CHUNK3_AUDIT_REMEDIATION_EXPAND',0,now()) on conflict(migration_id,checkpoint) do nothing;

-- Chunk 3 contract-completion remediation.
-- Expand-only: preserve prior immutable evidence while adding current-review
-- supersession, corrected snapshot lineage, and material-source quality.

alter table public.ap_job_snapshots
  add column if not exists material_source_qualities numeric[] not null default array[0.8]::numeric[],
  add column if not exists supersedes_job_snapshot_id uuid references public.ap_job_snapshots(id),
  add column if not exists correction_review_id uuid references public.ap_human_review_records(id);

alter table public.ap_job_snapshots
  add constraint ap_job_snapshots_material_source_qualities_check
    check (cardinality(material_source_qualities)>0 and material_source_qualities <@ array[0.8,1.0]::numeric[]),
  add constraint ap_job_snapshots_correction_lineage_check
    check ((supersedes_job_snapshot_id is null)=(correction_review_id is null));

create unique index ap_job_snapshots_correction_review_unique
  on public.ap_job_snapshots(correction_review_id)
  where correction_review_id is not null;

create unique index ap_job_snapshots_one_correction_successor
  on public.ap_job_snapshots(supersedes_job_snapshot_id)
  where supersedes_job_snapshot_id is not null;

alter table public.ap_human_review_records
  add column if not exists review_subject_key text,
  add column if not exists supersedes_review_id uuid references public.ap_human_review_records(id);

update public.ap_human_review_records
set review_subject_key=case
  when review_kind in ('MATCH_EVIDENCE','ADJACENT_EQUIVALENCE') and decision->>'stableCriterionId' is not null then 'criterion:'||(decision->>'stableCriterionId')
  when review_kind='CATEGORICAL_USEFULNESS' then 'categorical-usefulness'
  when review_kind='COMPENSATION_COMPARABILITY' then 'compensation-comparability'
  when review_kind='PARSER_CORRECTION' then 'parser-correction'
  else lower(replace(review_kind,'_','-'))
end
where review_subject_key is null;

with ranked as (
  select id,row_number() over(
    partition by snapshot_id,job_snapshot_id,review_kind,review_subject_key
    order by created_at desc,id desc
  ) as position
  from public.ap_human_review_records
  where invalidated_at is null
)
update public.ap_human_review_records review
set invalidated_at=now()
from ranked
where review.id=ranked.id and ranked.position>1;

alter table public.ap_human_review_records
  alter column review_subject_key set not null;

create unique index ap_human_review_records_one_current_subject
  on public.ap_human_review_records(snapshot_id,job_snapshot_id,review_kind,review_subject_key)
  where invalidated_at is null;

create or replace function public.ap_guard_chunk3_v3_human_review()
returns trigger language plpgsql set search_path='' as $$
declare
  expected_key text;
begin
  expected_key:=case
    when new.review_kind in ('MATCH_EVIDENCE','ADJACENT_EQUIVALENCE') then 'criterion:'||(new.decision->>'stableCriterionId')
    when new.review_kind='CUSTOMER_CRITERION' then new.decision->>'customerCriterionKey'
    when new.review_kind='CATEGORICAL_USEFULNESS' then 'categorical-usefulness'
    when new.review_kind='COMPENSATION_COMPARABILITY' then 'compensation-comparability'
    when new.review_kind='PARSER_CORRECTION' then 'parser-correction'
    else lower(replace(new.review_kind,'_','-'))
  end;
  new.review_subject_key:=coalesce(new.review_subject_key,expected_key);
  if new.review_subject_key is distinct from expected_key or nullif(btrim(new.review_subject_key),'') is null then
    raise exception 'review_subject_key_invalid';
  end if;
  if new.catalog_version<>'matching-rules-v3' then return new; end if;
  if new.job_snapshot_id is null
    or new.review_kind not in ('PARSER_CORRECTION','FEASIBILITY_EVIDENCE','ADJACENT_EQUIVALENCE','TOOL_EQUIVALENCE','MATCH_EVIDENCE','CUSTOMER_CRITERION','CATEGORICAL_USEFULNESS','COMPENSATION_COMPARABILITY')
    or coalesce(new.decision->>'disposition','') not in ('RESOLVED_PASS','RESOLVED_FAIL','REQUIRES_MORE_EVIDENCE')
    or jsonb_typeof(new.decision->'evidenceChanges') is distinct from 'array'
    or jsonb_array_length(new.decision->'evidenceChanges')=0
    or jsonb_typeof(new.decision->'sourceEvidenceNodeIds') is distinct from 'array'
    or jsonb_array_length(new.decision->'sourceEvidenceNodeIds')=0
    or new.decision->>'rulesVersion'<>'matching-rules-v3'
  then raise exception 'chunk3_v3_review_evidence_incomplete'; end if;
  if exists(select 1 from jsonb_array_elements_text(new.decision->'sourceEvidenceNodeIds') evidence_id where not exists(
    select 1 from public.ap_requirement_nodes node
    where node.id=evidence_id::uuid and node.job_snapshot_id=new.job_snapshot_id
      and node.node_kind='CRITERION' and node.source_locator is not null and node.source_excerpt is not null
  )) then raise exception 'review_source_evidence_invalid'; end if;
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
  ) then raise exception 'match_evidence_binding_invalid'; end if;
  if new.review_kind='CUSTOMER_CRITERION' and (
    new.decision->>'customerCriterionKey' is distinct from new.review_subject_key
    or coalesce(new.decision->>'result','') not in ('PASS','FAIL','UNKNOWN')
    or coalesce(new.decision->>'resolutionIssue','') not in ('NONE','EMPLOYER_OMITTED','PARSER_UNCERTAIN','EVIDENCE_CONFLICT')
    or coalesce(new.decision->>'unknownTreatment','') not in ('BLOCK','ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING')
    or (new.decision->>'result' in ('PASS','FAIL') and new.decision->>'resolutionIssue'<>'NONE')
    or (new.decision->>'result'='UNKNOWN' and new.decision->>'resolutionIssue'='NONE')
    or (new.decision->>'unknownTreatment'='ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING' and (
      new.decision->>'resolutionIssue'<>'EMPLOYER_OMITTED'
      or nullif(new.decision->>'consentVersion','') is null
      or nullif(new.decision->>'warning','') is null
    ))
  ) then raise exception 'customer_criterion_review_invalid'; end if;
  if new.review_kind='COMPENSATION_COMPARABILITY' and (
    jsonb_typeof(new.decision->'correctLocationRange') is distinct from 'boolean'
    or jsonb_typeof(new.decision->'workerBasisComparable') is distinct from 'boolean'
    or nullif(new.decision->>'selectedCompensationCriterionId','') is null
    or not exists(
      select 1 from public.ap_requirement_nodes node
      where node.job_snapshot_id=new.job_snapshot_id
        and node.criterion_type='COMPENSATION'
        and node.stable_criterion_id=(new.decision->>'selectedCompensationCriterionId')::uuid
        and node.id::text in (select jsonb_array_elements_text(new.decision->'sourceEvidenceNodeIds'))
    )
  ) then raise exception 'compensation_comparability_review_invalid'; end if;
  if new.review_kind='PARSER_CORRECTION' and new.decision->>'disposition'='RESOLVED_PASS' and (
    new.decision->>'correctionMethod'<>'NEW_IMMUTABLE_JOB_SNAPSHOT'
    or nullif(new.decision->>'correctedJobSnapshotId','') is null
    or nullif(new.decision->>'correctedInventoryVersionId','') is null
    or nullif(new.decision->>'correctedInventoryMemberId','') is null
  ) then raise exception 'parser_correction_lineage_invalid'; end if;
  return new;
end; $$;

create trigger ap_chunk3_v3_human_review_guard
  before insert on public.ap_human_review_records
  for each row execute function public.ap_guard_chunk3_v3_human_review();

create or replace function public.ap_record_matching_review(p_review jsonb,p_correction jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  prior_review public.ap_human_review_records;
  inserted_review public.ap_human_review_records;
  original_member public.ap_inventory_members;
  original_job public.ap_job_snapshots;
  original_inventory public.ap_inventory_versions;
  original_plan public.ap_feasibility_coverage_plans;
  new_job_id uuid;
  new_inventory_id uuid;
  new_member_id uuid;
  new_plan_id uuid;
begin
  if jsonb_typeof(p_review)<>'object'
    or p_review->>'catalog_version'<>'matching-rules-v3'
    or nullif(p_review->>'review_subject_key','') is null
    or nullif(p_review->>'snapshot_id','') is null
    or nullif(p_review->>'job_snapshot_id','') is null
  then raise exception 'matching_review_payload_invalid'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws('|','chunk3-job',p_review->>'snapshot_id',p_review->>'job_snapshot_id'),0
  ));
  if exists(
    select 1 from public.ap_job_snapshots
    where supersedes_job_snapshot_id=(p_review->>'job_snapshot_id')::uuid
  ) then raise exception 'superseded_job_snapshot_review_rejected'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws('|',p_review->>'snapshot_id',p_review->>'job_snapshot_id',p_review->>'review_kind',p_review->>'review_subject_key'),0
  ));
  select * into prior_review
  from public.ap_human_review_records
  where snapshot_id=(p_review->>'snapshot_id')::uuid
    and job_snapshot_id=(p_review->>'job_snapshot_id')::uuid
    and review_kind=p_review->>'review_kind'
    and review_subject_key=p_review->>'review_subject_key'
    and invalidated_at is null
  for update;
  if found then
    update public.ap_human_review_records set invalidated_at=now() where id=prior_review.id;
  end if;
  insert into public.ap_human_review_records(
    customer_id,draft_id,reviewer_id,snapshot_id,job_snapshot_id,review_kind,review_subject_key,supersedes_review_id,
    compared_tasks,task_similarity,complexity,autonomy,scope,domain_context,duration_and_intensity,essential_tools,
    rationale,catalog_version,decision
  ) values(
    nullif(p_review->>'customer_id','')::uuid,nullif(p_review->>'draft_id','')::uuid,(p_review->>'reviewer_id')::uuid,
    (p_review->>'snapshot_id')::uuid,(p_review->>'job_snapshot_id')::uuid,p_review->>'review_kind',p_review->>'review_subject_key',prior_review.id,
    p_review->'compared_tasks',nullif(p_review->>'task_similarity',''),nullif(p_review->>'complexity',''),nullif(p_review->>'autonomy',''),
    nullif(p_review->>'scope',''),nullif(p_review->>'domain_context',''),p_review->'duration_and_intensity',p_review->'essential_tools',
    p_review->>'rationale',p_review->>'catalog_version',p_review->'decision'
  ) returning * into inserted_review;

  if p_review->>'review_kind'='PARSER_CORRECTION' and p_review->'decision'->>'disposition'='RESOLVED_PASS' then
    if jsonb_typeof(p_correction)<>'object' or jsonb_typeof(p_correction->'requirementNodes')<>'array' or jsonb_array_length(p_correction->'requirementNodes')=0 then
      raise exception 'parser_correction_payload_invalid';
    end if;
    new_job_id:=(p_correction->>'correctedJobSnapshotId')::uuid;
    new_inventory_id:=(p_correction->>'correctedInventoryVersionId')::uuid;
    new_member_id:=(p_correction->>'correctedInventoryMemberId')::uuid;
    new_plan_id:=(p_correction->>'correctedCoveragePlanId')::uuid;
    if new_job_id::text<>p_review->'decision'->>'correctedJobSnapshotId'
      or new_inventory_id::text<>p_review->'decision'->>'correctedInventoryVersionId'
      or new_member_id::text<>p_review->'decision'->>'correctedInventoryMemberId'
    then raise exception 'parser_correction_id_mismatch'; end if;
    select * into original_member from public.ap_inventory_members where id=(p_correction->>'originalInventoryMemberId')::uuid for share;
    if not found or original_member.job_snapshot_id<>inserted_review.job_snapshot_id or not original_member.selected_by_deduplication then
      raise exception 'parser_correction_inventory_member_invalid';
    end if;
    select * into original_job from public.ap_job_snapshots where id=original_member.job_snapshot_id;
    select * into original_inventory from public.ap_inventory_versions where id=original_member.inventory_version_id;
    select * into original_plan from public.ap_feasibility_coverage_plans
      where snapshot_id=inserted_review.snapshot_id and inventory_version_id=original_member.inventory_version_id
      order by created_at desc,id desc limit 1;
    if original_plan.id is null then raise exception 'parser_correction_coverage_plan_missing'; end if;

    insert into public.ap_job_snapshots
    select (pg_catalog.jsonb_populate_record(
      null::public.ap_job_snapshots,
      to_jsonb(original_job) || jsonb_build_object(
        'id',new_job_id,
        'captured_listing',p_correction->'capturedListing',
        'parser_version',p_correction->>'parserVersion',
        'content_sha256',p_correction->>'contentSha256',
        'compensation_text',p_correction->'compensationText',
        'compensation_source',case when (p_correction->>'compensationCompleteness')::integer=100 then 'EMPLOYER_LISTING' else null end,
        'location_and_work_mode',p_correction->'locationAndWorkMode',
        'requirement_completeness',100,
        'compensation_completeness',(p_correction->>'compensationCompleteness')::integer,
        'supersedes_job_snapshot_id',original_job.id,
        'correction_review_id',inserted_review.id,
        'legacy_compatibility',false,
        'created_at',now()
      )
    )).*;

    insert into public.ap_requirement_nodes(
      id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,
      source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,importance,human_correction_history
    )
    select node.id,new_job_id,node.parent_id,node.position,node.node_kind,node.criterion_type,node.stable_criterion_id,node.semantic_key,node.requirement_strength,
      node.source_locator,node.parser_certainty,node.criterion_version,node.typed_value,node.source_excerpt,node.classification_method,node.importance,
      jsonb_build_array(jsonb_build_object(
        'reviewId',inserted_review.id,'supersedesJobSnapshotId',original_job.id,'reviewerId',inserted_review.reviewer_id,
        'resolvedAt',inserted_review.created_at,'evidenceChanges',inserted_review.decision->'evidenceChanges'
      ))
    from jsonb_to_recordset(p_correction->'requirementNodes') as node(
      id uuid,parent_id uuid,position integer,node_kind public.ap_requirement_node_kind,criterion_type public.ap_criterion_type,
      stable_criterion_id uuid,semantic_key text,requirement_strength text,source_locator text,parser_certainty numeric,
      criterion_version text,typed_value jsonb,source_excerpt text,classification_method text,importance smallint
    );

    insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
    values(new_inventory_id,original_inventory.cutoff_at,original_inventory.source_registry_version,original_inventory.query_version,p_correction->>'parserVersion',p_correction->>'inventoryContentSha256');
    insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,constraint_proof,content_sha256)
    values(new_plan_id,original_plan.snapshot_id,new_inventory_id,original_plan.plan_version,original_plan.typed_inputs,original_plan.coverage_disposition,original_plan.constraint_proof,p_correction->>'coveragePlanContentSha256');
    insert into public.ap_feasibility_coverage_cells(
      plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,
      terminal_outcome,cursor_or_stop_reason,result_count,parser_result,started_at,completed_at,query_family_id,
      source_authorization_id,configuration_id,configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete,result_changing_error_code
    )
    select new_plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,
      terminal_outcome,cursor_or_stop_reason,result_count,parser_result,started_at,completed_at,query_family_id,
      source_authorization_id,configuration_id,configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete,result_changing_error_code
    from public.ap_feasibility_coverage_cells where plan_id=original_plan.id;
    insert into public.ap_inventory_members(inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication,exclusion_reason)
    select new_inventory_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication,exclusion_reason
    from public.ap_inventory_members where inventory_version_id=original_member.inventory_version_id and id<>original_member.id;
    insert into public.ap_inventory_members(id,inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication)
    values(new_member_id,new_inventory_id,new_job_id,original_member.stable_normalized_job_id,true);
    update public.ap_match_evaluations set invalidated_at=now()
      where snapshot_id=inserted_review.snapshot_id and job_snapshot_id=original_job.id and invalidated_at is null;
    insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
    values('PARSER_CORRECTION_PERSISTED','JOB_SNAPSHOT',new_job_id,jsonb_build_object(
      'reviewId',inserted_review.id,'supersedesJobSnapshotId',original_job.id,'inventoryVersionId',new_inventory_id
    ),'chunk3-contract-completion-v1');
  elsif p_correction is not null then
    raise exception 'unexpected_parser_correction_payload';
  end if;
  return jsonb_build_object(
    'reviewId',inserted_review.id,
    'recordedAt',inserted_review.created_at,
    'correctedJobSnapshotId',new_job_id,
    'correctedInventoryVersionId',new_inventory_id,
    'correctedInventoryMemberId',new_member_id
  );
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
  insert into public.ap_job_snapshots(
    id,legacy_job_id,origin,discovery_source,external_job_id,canonical_application_url,application_host_type,
    canonical_employer_listing_url,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,
    posted_on,posted_date_unknown,live_verified_at,compensation_text,compensation_source,location_and_work_mode,
    parser_version,content_sha256,source_authorization_id,first_seen_at,canonical_employer_domain,employer_identity_result,
    application_path_result,listing_activity_result,legitimacy_result,requirement_completeness,compensation_completeness,
    canonicalization_version,legacy_compatibility,material_source_qualities
  )
  values(
    job_snapshot_id,(p_job_snapshot->>'legacy_job_id')::uuid,(p_job_snapshot->>'origin')::public.ap_job_origin,p_job_snapshot->>'discovery_source',
    nullif(p_job_snapshot->>'external_job_id',''),p_job_snapshot->>'canonical_application_url',p_job_snapshot->>'application_host_type',
    nullif(p_job_snapshot->>'canonical_employer_listing_url',''),p_job_snapshot->>'source_url',p_job_snapshot->>'company',
    p_job_snapshot->>'exact_title',p_job_snapshot->>'normalized_fingerprint',p_job_snapshot->'captured_listing',
    (p_job_snapshot->>'retrieved_at')::timestamptz,nullif(p_job_snapshot->>'posted_on','')::date,(p_job_snapshot->>'posted_date_unknown')::boolean,
    (p_job_snapshot->>'live_verified_at')::timestamptz,nullif(p_job_snapshot->>'compensation_text',''),nullif(p_job_snapshot->>'compensation_source',''),
    p_job_snapshot->'location_and_work_mode',p_job_snapshot->>'parser_version',p_job_snapshot->>'content_sha256',
    (p_job_snapshot->>'source_authorization_id')::uuid,(p_job_snapshot->>'first_seen_at')::timestamptz,p_job_snapshot->>'canonical_employer_domain',
    p_job_snapshot->>'employer_identity_result',p_job_snapshot->>'application_path_result',p_job_snapshot->>'listing_activity_result',
    p_job_snapshot->>'legitimacy_result',(p_job_snapshot->>'requirement_completeness')::integer,(p_job_snapshot->>'compensation_completeness')::integer,
    p_job_snapshot->>'canonicalization_version',false,
    case
      when jsonb_typeof(p_job_snapshot->'material_source_qualities')='array'
        and jsonb_array_length(p_job_snapshot->'material_source_qualities')>0
      then array(select (quality)::numeric from jsonb_array_elements_text(p_job_snapshot->'material_source_qualities') quality)
      else array[0.8]::numeric[]
    end
  );
  insert into public.ap_requirement_nodes(id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,importance,human_correction_history)
  select node.id,job_snapshot_id,node.parent_id,node.position,node.node_kind,node.criterion_type,node.stable_criterion_id,node.semantic_key,node.requirement_strength,node.source_locator,node.parser_certainty,node.criterion_version,node.typed_value,node.source_excerpt,node.classification_method,node.importance,coalesce(node.human_correction_history,'[]'::jsonb)
  from jsonb_to_recordset(p_requirement_nodes) as node(id uuid,parent_id uuid,position integer,node_kind public.ap_requirement_node_kind,criterion_type public.ap_criterion_type,stable_criterion_id uuid,semantic_key text,requirement_strength text,source_locator text,parser_certainty numeric,criterion_version text,typed_value jsonb,source_excerpt text,classification_method text,importance smallint,human_correction_history jsonb);
  insert into public.ap_inventory_members(inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication)
  values(p_inventory_version_id,job_snapshot_id,p_stable_normalized_job_id,true) returning id into member_id;
  return member_id;
end; $$;

create or replace function public.ap_guard_chunk3_v3_match_evaluation()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.legacy_compatibility then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat_ws('|','chunk3-job',new.snapshot_id::text,new.job_snapshot_id::text),0
  ));
  if exists(
    select 1 from public.ap_job_snapshots successor
    where successor.supersedes_job_snapshot_id=new.job_snapshot_id
  ) then raise exception 'superseded_job_snapshot_cannot_be_evaluated'; end if;
  if new.calculation_version='matching-rules-v3' and (
    jsonb_typeof(new.explanation_evidence)<>'object'
    or new.rank_explanation->>'state' is distinct from 'AWAITING_SELECTION_RUN'
    or new.selector_explanation->>'state' is distinct from 'AWAITING_SELECTION_RUN'
    or new.fit_score='NaN'::numeric
    or new.evidence_confidence='NaN'::numeric
  ) then raise exception 'server_derived_evaluation_metadata_invalid'; end if;
  if new.calculation_version='matching-rules-v3' and new.usefulness_result='PASS' and exists(
    select 1 from unnest(array['whatJobInvolves','whyMadeList','howExperienceConnects','whatMayBeNew','whatToKnow']) section
    where jsonb_typeof(new.explanation_evidence->section) is distinct from 'object'
      or jsonb_typeof(new.explanation_evidence->section->'sourceEvidenceNodeIds') is distinct from 'array'
      or jsonb_array_length(new.explanation_evidence->section->'sourceEvidenceNodeIds')=0
  ) then raise exception 'five_section_explanation_evidence_required'; end if;
  return new;
end; $$;

create trigger ap_chunk3_v3_match_evaluation_guard
  before insert on public.ap_match_evaluations
  for each row execute function public.ap_guard_chunk3_v3_match_evaluation();

revoke all on function public.ap_record_matching_review(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ap_record_matching_review(jsonb,jsonb) to service_role;
revoke all on function public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202609050028','CHUNK3_CONTRACT_COMPLETION_EXPAND',0,now())
on conflict(migration_id,checkpoint) do nothing;

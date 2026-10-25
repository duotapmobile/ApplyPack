-- Forward-only reviewed commute evidence. No historical reviews or payments are rewritten.
-- Existing release rules for allowed employer unknowns are deliberately unchanged.
begin;

-- Destination evidence is a cited worksite, not an employer's maximum commute threshold.
do $$ declare definition text; begin
  select pg_get_functiondef('public.ap_chunk3_customer_criterion_node_matches(text,text,jsonb)'::regprocedure) into definition;
  if position('then p_type=''COMMUTE''' in definition)=0 then raise exception 'commute_node_guard_definition_changed'; end if;
  execute replace(definition,'then p_type=''COMMUTE''','then p_type in (''COMMUTE'',''WORK_MODE'',''GEOGRAPHY'')');
end $$;

create function public.ap_reviewed_commute_result(p_snapshot_id uuid,p_job_id uuid,p_decision jsonb,p_reviewer_id uuid,p_now timestamptz)
returns text language plpgsql stable set search_path='' as $$
declare s public.ap_intake_snapshots; j public.ap_job_snapshots; n public.ap_requirement_nodes;
  e jsonb:=p_decision->'commuteEvidence'; maximum numeric; distance numeric; minutes numeric;
  checked timestamptz; reviewed timestamptz; expected_key text;
begin
  select * into s from public.ap_intake_snapshots where id=p_snapshot_id;
  select * into j from public.ap_job_snapshots where id=p_job_id;
  if s.id is null or j.id is null or jsonb_typeof(e) is distinct from 'object' then return 'UNKNOWN'; end if;
  maximum:=(s.travel->>'commuteDistanceMiles')::numeric;
  expected_key:='customer:commute:'||trim(trailing '.' from trim(trailing '0' from to_char(maximum,'FM999999990.999999')))||'-miles';
  distance:=(e->>'oneWayMiles')::numeric; minutes:=(e->>'oneWayMinutes')::numeric;
  checked:=(e->>'checkedAt')::timestamptz; reviewed:=(e->>'reviewedAt')::timestamptz;
  if s.travel->>'zipCode' is null or s.travel->>'zipCode' !~ '^[0-9]{5}$' or maximum is null or not(maximum>0 and maximum<=1000)
    or e->>'version' is distinct from 'reviewed-commute-v1'
    or e->>'snapshotId' is distinct from s.id::text or e->>'snapshotHash' is distinct from s.content_sha256
    or e->>'jobSnapshotId' is distinct from j.id::text or e->>'jobHash' is distinct from j.content_sha256
    or e->>'originZip' is distinct from s.travel->>'zipCode' or (e->>'maximumMiles')::numeric is distinct from maximum
    or e->>'reviewerId' is distinct from p_reviewer_id::text or p_decision->>'reviewerId' is distinct from p_reviewer_id::text
    or p_decision->>'customerCriterionKey' is distinct from expected_key
    or p_decision->>'unknownTreatment' is distinct from 'BLOCK' or p_decision->>'resolutionIssue' is distinct from 'NONE'
    or e->>'method' not in ('DRIVE','TRANSIT','WALK','BICYCLE')
    or e->>'destinationPrecision' not in ('STREET_ADDRESS','NAMED_WORKSITE')
    or e->'reviewedOriginArea' is distinct from 'true'::jsonb or e->'reviewedExactWorksite' is distinct from 'true'::jsonb
    or length(btrim(e->>'destination')) not between 6 and 500
    or length(btrim(e->>'routeNotes')) not between 10 and 1000
    or length(e->>'routeSourceUrl')>2000 or e->>'routeSourceUrl' !~ '^https://[^/@[:space:]:?#]+(:[0-9]+)?([/?#]|$)'
    or distance is null or not(distance>0 and distance<=1000) or minutes is null or not(minutes>0 and minutes<=1440)
    or checked is null or reviewed is null or checked>reviewed or reviewed>p_now or checked<p_now-interval '24 hours'
    then return 'UNKNOWN'; end if;
  -- Missing required textual fields must not pass SQL's three-valued comparisons.
  if exists(select 1 from unnest(array['method','destinationPrecision','destination','routeNotes','routeSourceUrl','destinationNodeId','destinationSourceLocator','destinationSourceExcerpt']) k
    where nullif(e->>k,'') is null) then return 'UNKNOWN'; end if;
  select * into n from public.ap_requirement_nodes where id=(e->>'destinationNodeId')::uuid and job_snapshot_id=j.id;
  if n.id is null or n.node_kind<>'CRITERION' or n.criterion_type not in ('WORK_MODE','GEOGRAPHY','COMMUTE')
    or nullif(n.source_locator,'') is null or nullif(n.source_excerpt,'') is null
    or e->>'destinationSourceLocator' is distinct from n.source_locator or e->>'destinationSourceExcerpt' is distinct from n.source_excerpt
    or position(e->>'destination' in n.source_excerpt)=0
    or not coalesce(p_decision->'sourceEvidenceNodeIds' @> jsonb_build_array(n.id::text),false)
    or exists(select 1 from public.ap_job_snapshots where supersedes_job_snapshot_id=j.id)
    then return 'UNKNOWN'; end if;
  return case when distance<=maximum then 'PASS' else 'FAIL' end;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then return 'UNKNOWN';
end $$;

create function public.ap_guard_reviewed_commute() returns trigger language plpgsql set search_path='' as $$
declare derived text;
begin
  if new.review_kind<>'CUSTOMER_CRITERION' or new.review_subject_key not like 'customer:commute%' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws('|','chunk3-job',new.snapshot_id::text,new.job_snapshot_id::text),0));
  if new.decision->>'unknownTreatment' is distinct from 'BLOCK' then raise exception 'commute_cannot_be_waived'; end if;
  if new.decision->>'result' in ('PASS','FAIL') then
    derived:=public.ap_reviewed_commute_result(new.snapshot_id,new.job_snapshot_id,new.decision,new.reviewer_id,clock_timestamp());
    if derived='UNKNOWN' or derived is distinct from new.decision->>'result'
      or new.decision->>'disposition' is distinct from (case derived when 'PASS' then 'RESOLVED_PASS' else 'RESOLVED_FAIL' end)
      then raise exception 'checked_bound_commute_route_required'; end if;
  elsif new.decision ? 'commuteEvidence' then raise exception 'unresolved_commute_must_not_claim_checked_result'; end if;
  return new;
end $$;
create trigger ap_reviewed_commute_guard before insert on public.ap_human_review_records for each row execute function public.ap_guard_reviewed_commute();

create function public.ap_commute_evaluation_current(p_evaluation public.ap_match_evaluations)
returns boolean language plpgsql stable set search_path='' as $$
declare r public.ap_human_review_records; key text;
begin
  if not exists(select 1 from public.ap_requirement_nodes n where n.job_snapshot_id=p_evaluation.job_snapshot_id
    and n.criterion_type='WORK_MODE' and (n.typed_value->'modes' ?| array['ONSITE','HYBRID'])) then return true; end if;
  if p_evaluation.invalidated_at is not null or p_evaluation.legacy_compatibility
    or p_evaluation.version_bundle->>'commute' is distinct from 'reviewed-commute-v1' then return false; end if;
  select * into r from public.ap_human_review_records where id=(p_evaluation.version_bundle->>'commuteReviewId')::uuid
    and snapshot_id=p_evaluation.snapshot_id and job_snapshot_id=p_evaluation.job_snapshot_id
    and review_kind='CUSTOMER_CRITERION' and invalidated_at is null;
  if r.id is null or r.decision->>'result' is distinct from 'PASS' or r.decision->>'disposition' is distinct from 'RESOLVED_PASS'
    or public.ap_reviewed_commute_result(r.snapshot_id,r.job_snapshot_id,r.decision,r.reviewer_id,statement_timestamp())<>'PASS'
    then return false; end if;
  key:=r.decision->>'customerCriterionKey';
  return coalesce(key=any(p_evaluation.active_root_keys),false)
    and exists(select 1 from jsonb_array_elements(p_evaluation.root_results) g where g->>'rootKey'=key and g->>'result'='PASS');
exception when invalid_text_representation then return false;
end $$;

create function public.ap_current_commute_evaluation_ids(p_ids uuid[]) returns table(id uuid)
language sql stable security definer set search_path='' as $$
  select e.id from public.ap_match_evaluations e where e.id=any(p_ids)
    and cardinality(p_ids)<=5000 and public.ap_commute_evaluation_current(e)
$$;

-- Preparatory predicate: exact existing unpublished-pay choice only. Callers are unchanged until separately reviewed.
create function public.ap_release_salary_root_policy_current(e public.ap_match_evaluations)
returns boolean language plpgsql stable set search_path='' as $$
declare s public.ap_intake_snapshots; g jsonb; unknown_count integer:=0;
begin
  if jsonb_typeof(e.root_results) is distinct from 'array' then return false; end if;
  if jsonb_array_length(e.root_results)=0 or cardinality(e.active_root_keys) is distinct from jsonb_array_length(e.root_results)
    or (select count(distinct k) from unnest(e.active_root_keys) k)<>cardinality(e.active_root_keys)
    or exists(select 1 from unnest(e.active_root_keys) k where (select count(*) from jsonb_array_elements(e.root_results) item where item->>'rootKey'=k)<>1)
    or exists(select 1 from jsonb_array_elements(e.root_results) item where item->>'result' is null or item->>'result' not in ('PASS','UNKNOWN'))
    then return false; end if;
  if e.root_result='PASS' then return e.eligibility='ELIGIBLE' and cardinality(e.unknown_treatments)=0
    and not exists(select 1 from jsonb_array_elements(e.root_results) item where item->>'result'<>'PASS'); end if;
  if e.root_result is distinct from 'UNKNOWN' or e.eligibility is distinct from 'ELIGIBLE_WITH_ALLOWED_UNKNOWNS'
    or e.unknown_treatments is distinct from array['ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING']::public.ap_unknown_treatment[]
    or e.salary_status is distinct from 'UNPUBLISHED' or e.salary_disposition is distinct from 'ALLOWED_WITH_WARNING'
    then return false; end if;
  select * into s from public.ap_intake_snapshots where id=e.snapshot_id;
  if s.id is null or s.salary_unpublished_policy is distinct from 'ALLOW_WITH_WARNING' then return false; end if;
  if jsonb_typeof(e.warnings) is distinct from 'array' then return false; end if;
  for g in select value from jsonb_array_elements(e.root_results) where value->>'result'='UNKNOWN' loop
    unknown_count:=unknown_count+1;
    if g->>'rootKey' is distinct from 'universal:salary' or g->>'resolutionIssue' is distinct from 'EMPLOYER_OMITTED'
      or g->>'unknownTreatment' is distinct from 'ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING'
      or g->>'consentVersion' is distinct from s.schema_version||':'||s.content_sha256
      or nullif(btrim(g->>'warning'),'') is null or coalesce(g->'unwaivable','false'::jsonb)<>'false'::jsonb
      or not exists(select 1 from jsonb_array_elements(e.warnings) warning where warning->>'messageKey'=g->>'warning') then return false; end if;
  end loop;
  return unknown_count=1;
end $$;
revoke all on function public.ap_release_salary_root_policy_current(public.ap_match_evaluations) from public,anon,authenticated;
grant execute on function public.ap_release_salary_root_policy_current(public.ap_match_evaluations) to service_role;

create function public.ap_guard_commute_evaluation() returns trigger language plpgsql set search_path='' as $$
begin
  if new.legacy_compatibility then return new; end if;
  if new.root_result='PASS' and cardinality(new.unknown_treatments)>0 then raise exception 'resolved_roots_cannot_have_active_unknown_treatments'; end if;
  if new.eligibility in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') and not public.ap_commute_evaluation_current(new)
    then raise exception 'commute_evaluation_requires_current_checked_route'; end if;
  return new;
end $$;
create trigger ap_commute_evaluation_guard before insert on public.ap_match_evaluations for each row execute function public.ap_guard_commute_evaluation();

create function public.ap_guard_commute_downstream() returns trigger language plpgsql set search_path='' as $$
declare evaluation_id uuid; e public.ap_match_evaluations;
begin
  if tg_table_name='ap_match_selection_members' then
    if new.selected_rank is null then return new; end if; evaluation_id:=new.evaluation_id;
  elsif tg_table_name='ap_job_release_reviews' then
    if new.decision<>'APPROVED' then return new; end if; evaluation_id:=new.evaluation_id;
  else evaluation_id:=new.release_evaluation_id; end if;
  if evaluation_id is null then return new; end if;
  select * into e from public.ap_match_evaluations where id=evaluation_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws('|','chunk3-job',e.snapshot_id::text,e.job_snapshot_id::text),0));
  select * into e from public.ap_match_evaluations where id=evaluation_id;
  if e.id is null or not public.ap_commute_evaluation_current(e) then raise exception 'selected_commute_evidence_stale_or_missing'; end if;
  return new;
end $$;
create trigger ap_commute_selection_guard before insert on public.ap_match_selection_members for each row execute function public.ap_guard_commute_downstream();
create trigger ap_commute_release_review_guard before insert on public.ap_job_release_reviews for each row execute function public.ap_guard_commute_downstream();
create trigger ap_commute_delivery_guard before insert or update of release_evaluation_id on public.job_matches for each row execute function public.ap_guard_commute_downstream();

-- An old LIKELY assessment cannot authorize a fresh invitation or quote after its routes expire.
create function public.ap_guard_commute_checkout() returns trigger language plpgsql set search_path='' as $$
declare assessment_id uuid; subject record;
begin
  if tg_table_name='ap_search_checkout_invitations' then assessment_id:=new.assessment_id;
  elsif tg_table_name='ap_checkout_attempts' then
    select q.feasibility_assessment_id into assessment_id from public.ap_quotes q where q.id=new.quote_id;
  else assessment_id:=new.feasibility_assessment_id; end if;
  for subject in select distinct e.snapshot_id,e.job_snapshot_id from public.ap_feasibility_assessments a
    join public.ap_feasibility_coverage_plans p on p.id=a.coverage_plan_id
    join public.ap_match_evaluations e on e.snapshot_id=a.snapshot_id and e.inventory_version_id=p.inventory_version_id
    where a.id=assessment_id order by e.snapshot_id,e.job_snapshot_id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(concat_ws('|','chunk3-job',subject.snapshot_id::text,subject.job_snapshot_id::text),0));
  end loop;
  if exists(select 1 from public.ap_feasibility_assessments where id=assessment_id and invalidated_at is not null)
    then raise exception 'feasibility_commute_evidence_requires_refresh'; end if;
  if exists(select 1 from public.ap_feasibility_assessments a
    join public.ap_feasibility_coverage_plans p on p.id=a.coverage_plan_id
    join public.ap_match_evaluations e on e.snapshot_id=a.snapshot_id and e.inventory_version_id=p.inventory_version_id
    where a.id=assessment_id and e.invalidated_at is null and e.eligibility in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS')
      and not public.ap_commute_evaluation_current(e)) then raise exception 'feasibility_commute_evidence_requires_refresh'; end if;
  return new;
end $$;
create trigger ap_commute_invitation_guard before insert on public.ap_search_checkout_invitations for each row execute function public.ap_guard_commute_checkout();
create trigger ap_commute_quote_guard before insert on public.ap_quotes for each row execute function public.ap_guard_commute_checkout();
create trigger ap_commute_checkout_start_guard before insert on public.ap_checkout_attempts for each row execute function public.ap_guard_commute_checkout();

-- Renewing a route requires a new evaluation; stale evaluations must not duplicate current coverage.
create function public.ap_invalidate_replaced_commute_evaluations() returns trigger language plpgsql set search_path='' as $$
begin
  if new.review_kind='CUSTOMER_CRITERION' and new.review_subject_key like 'customer:commute%' then
    update public.ap_match_evaluations set invalidated_at=coalesce(invalidated_at,clock_timestamp())
      where snapshot_id=new.snapshot_id and job_snapshot_id=new.job_snapshot_id and invalidated_at is null
        and version_bundle->>'commuteReviewId' is distinct from new.id::text;
    update public.ap_feasibility_assessments set invalidated_at=coalesce(invalidated_at,clock_timestamp())
      where snapshot_id=new.snapshot_id and invalidated_at is null;
  end if;
  return new;
end $$;
create trigger ap_commute_review_replacement_invalidates after insert on public.ap_human_review_records for each row execute function public.ap_invalidate_replaced_commute_evaluations();

-- The authoritative assessment and the runtime preview both hold expired routes for review.
do $$ declare definition text; needle text:='and evaluation.salary_disposition<>''FAIL'' and evaluation.application_readiness<>''BLOCKED'''; begin
  select pg_get_functiondef('public.ap_persist_derived_feasibility_assessment(uuid,text,text)'::regprocedure) into definition;
  if position(needle in definition)=0 then raise exception 'feasibility_classification_definition_changed'; end if;
  execute replace(definition,needle,needle||' and public.ap_commute_evaluation_current(evaluation)');
end $$;

revoke all on function public.ap_reviewed_commute_result(uuid,uuid,jsonb,uuid,timestamptz),public.ap_commute_evaluation_current(public.ap_match_evaluations),public.ap_current_commute_evaluation_ids(uuid[]) from public,anon,authenticated;
grant execute on function public.ap_reviewed_commute_result(uuid,uuid,jsonb,uuid,timestamptz),public.ap_commute_evaluation_current(public.ap_match_evaluations),public.ap_current_commute_evaluation_ids(uuid[]) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610250090','MATCHING_EVIDENCE_COMPLETION',0,clock_timestamp());
create function public.ap_matching_evidence_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
  select to_regprocedure('public.ap_reviewed_commute_result(uuid,uuid,jsonb,uuid,timestamptz)') is not null
    and to_regprocedure('public.ap_commute_evaluation_current(public.ap_match_evaluations)') is not null
    and to_regprocedure('public.ap_current_commute_evaluation_ids(uuid[])') is not null
    and exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    and not exists(select 1 from (values
      ('public.ap_human_review_records'::regclass,'ap_reviewed_commute_guard'),
      ('public.ap_human_review_records'::regclass,'ap_commute_review_replacement_invalidates'),
      ('public.ap_match_evaluations'::regclass,'ap_commute_evaluation_guard'),
      ('public.ap_match_selection_members'::regclass,'ap_commute_selection_guard'),
      ('public.ap_job_release_reviews'::regclass,'ap_commute_release_review_guard'),
      ('public.job_matches'::regclass,'ap_commute_delivery_guard'),
      ('public.ap_search_checkout_invitations'::regclass,'ap_commute_invitation_guard'),
      ('public.ap_quotes'::regclass,'ap_commute_quote_guard'),
      ('public.ap_checkout_attempts'::regclass,'ap_commute_checkout_start_guard')
    ) required(table_id,trigger_name) where not exists(select 1 from pg_trigger t
      where t.tgrelid=required.table_id and t.tgname=required.trigger_name and not t.tgisinternal and t.tgenabled='O'));
$$;
revoke all on function public.ap_matching_evidence_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_matching_evidence_schema_installed() to service_role;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
  if position('select count(*)=13 as installed' in definition)=0
    or position('''requiredSchemaVersion'', ''202610250089''' in definition)=0
    or position('(''202610250089'',''CONFIRMED_INTAKE'')' in definition)=0
    or position('''202610250088'',''202610250089''' in definition)=0
    then raise exception 'matching_evidence_readiness_anchor_missing'; end if;
  definition:=replace(definition,'select count(*)=13 as installed','select count(*)=14 as installed');
  definition:=replace(definition,'(''202610250089'',''CONFIRMED_INTAKE'')','(''202610250089'',''CONFIRMED_INTAKE''),(''202610250090'',''MATCHING_EVIDENCE_COMPLETION'')');
  definition:=replace(definition,'''requiredSchemaVersion'', ''202610250089''','''requiredSchemaVersion'', ''202610250090''');
  definition:=replace(definition,'''202610250088'',''202610250089''','''202610250088'',''202610250089'',''202610250090''');
  definition:=replace(definition,'public.ap_sandbox_activation_schema_installed()','public.ap_sandbox_activation_schema_installed() and public.ap_matching_evidence_schema_installed()');
  execute definition;
end $$;
commit;

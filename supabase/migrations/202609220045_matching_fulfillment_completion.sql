begin;
-- Ownership is a verified relational claim; immutable pre-payment evidence keeps
-- its original draft subject rather than being reassigned after a webhook.
create function public.ap_customer_owns_snapshot(p_customer_id uuid,p_snapshot_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_intake_snapshots s where s.id=p_snapshot_id and s.finalized_at is not null
   and (s.customer_id is null or s.customer_id=p_customer_id)
   and (s.customer_id=p_customer_id
     or exists(select 1 from public.ap_board_profile_claims c where c.profile_snapshot_id=s.id and c.customer_id=p_customer_id and c.draft_id=s.draft_id)
     or exists(select 1 from public.ap_search_services service where service.customer_id=p_customer_id
       and (service.original_snapshot_id=s.id or service.active_snapshot_id=s.id))));
$$;
revoke all on function public.ap_customer_owns_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ap_customer_owns_snapshot(uuid,uuid) to service_role;
create function public.ap_current_verified_job_snapshots(p_job_ids uuid[])
returns table(id uuid,legacy_job_id uuid,requirement_completeness integer,live_verified_at timestamptz)
language sql stable security definer set search_path='' as $$
 select s.id,s.legacy_job_id,s.requirement_completeness::integer,s.live_verified_at
 from public.ap_job_snapshots s join public.ap_source_verifications v on v.job_snapshot_id=s.id
 join public.job_source_references r on r.id=v.source_reference_id and r.is_active
 join public.jobs j on j.id=r.job_id and j.id=s.legacy_job_id and j.content_hash=v.observed_content_sha256
 join public.ap_source_authorization_heads h on h.current_authorization_id=v.source_authorization_id and h.revision=v.authorization_head_revision
 join public.ap_source_authorizations a on a.id=h.current_authorization_id and a.state in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY')
 where cardinality(p_job_ids)<=5000 and j.id=any(p_job_ids) and j.is_active and j.rejection_reason is null
   and s.source_authorization_id=a.id and s.requirement_completeness=100 and not s.legacy_compatibility
   and s.live_verified_at between now()-interval '24 hours' and now()
   and s.employer_identity_result='PASS' and s.listing_activity_result='PASS' and s.application_path_result='PASS' and s.legitimacy_result='PASS'
   and not exists(select 1 from public.ap_job_snapshots newer where newer.supersedes_job_snapshot_id=s.id)
 order by s.live_verified_at desc;
$$;
revoke all on function public.ap_current_verified_job_snapshots(uuid[]) from public,anon,authenticated;
grant execute on function public.ap_current_verified_job_snapshots(uuid[]) to service_role;
-- Browser reads use the caller's own identity, never a supplied customer ID.
create function public.ap_can_read_claimed_snapshot(p_snapshot_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public.ap_customer_owns_snapshot(auth.uid(),p_snapshot_id);
$$;
revoke all on function public.ap_can_read_claimed_snapshot(uuid) from public,anon;
grant execute on function public.ap_can_read_claimed_snapshot(uuid) to authenticated,service_role;
create policy ap_claimed_evaluation_read on public.ap_match_evaluations for select to authenticated
 using (customer_id is null and public.ap_can_read_claimed_snapshot(snapshot_id));
create policy ap_claimed_fact_read on public.ap_candidate_facts for select to authenticated
 using (customer_id is null and public.ap_can_read_claimed_snapshot(snapshot_id));
create policy ap_claimed_snapshot_read on public.ap_intake_snapshots for select to authenticated
 using (customer_id is null and public.ap_can_read_claimed_snapshot(id));
do $$ declare name text; definition text; old text;
begin
 foreach name in array array['ap_record_job_release_review','ap_commit_exact_ten_release'] loop
   select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name;
   old:=case name when 'ap_record_job_release_review' then 'evaluation_row.customer_id<>service_row.customer_id' else 'evaluation.customer_id<>service_row.customer_id' end;
   if position(old in definition)=0 then raise exception 'evaluation_ownership_guard_anchor_missing'; end if;
   definition:=replace(definition,old,case name when 'ap_record_job_release_review' then
     '(evaluation_row.customer_id is not null and evaluation_row.customer_id<>service_row.customer_id) or not public.ap_customer_owns_snapshot(service_row.customer_id,evaluation_row.snapshot_id)'
     else '(evaluation.customer_id is not null and evaluation.customer_id<>service_row.customer_id) or not public.ap_customer_owns_snapshot(service_row.customer_id,evaluation.snapshot_id)' end);
   execute definition;
 end loop;
end $$;
-- Draft feasibility precedes checkout. Ownership remains on the immutable criteria.
alter table public.ap_match_evaluations alter column customer_id drop not null;
alter table public.ap_match_evaluations add column draft_id uuid references public.ap_anonymous_drafts(id);
create function public.ap_guard_evaluation_subject() returns trigger language plpgsql set search_path='' as $$
declare s public.ap_intake_snapshots;
begin
 select * into s from public.ap_intake_snapshots where id=new.snapshot_id;
 if new.draft_id is null and new.customer_id=s.customer_id then new.draft_id:=s.draft_id; end if;
 if s.id is null or s.finalized_at is null or (s.customer_id is null and s.draft_id is null)
 or new.customer_id is distinct from s.customer_id or new.draft_id is distinct from s.draft_id
 then raise exception 'evaluation_subject_mismatch'; end if;
 if not exists(select 1 from public.ap_feasibility_coverage_plans where snapshot_id=s.id and inventory_version_id=new.inventory_version_id) then raise exception 'evaluation_coverage_subject_mismatch'; end if;
 return new;
end $$;
-- Existing customer evaluations predate draft provenance; only new records use this guard.
create trigger ap_evaluation_subject before insert on public.ap_match_evaluations for each row execute function public.ap_guard_evaluation_subject();

create table public.ap_research_rounds (
 id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.ap_intake_snapshots(id),
 plan_id uuid not null references public.ap_feasibility_coverage_plans(id), round integer not null check(round between 1 and 3),
 request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), unique(snapshot_id,round), unique(snapshot_id,request_sha256)
);
alter table public.ap_research_rounds enable row level security;
revoke all on public.ap_research_rounds from public,anon,authenticated,service_role;
grant select on public.ap_research_rounds to service_role;
create trigger ap_research_rounds_immutable before update or delete on public.ap_research_rounds for each row execute function public.ap_prevent_immutable_mutation();

create function public.ap_begin_research_round(p_snapshot_id uuid,p_actor_id uuid,p_request_sha256 text,p_families jsonb,p_configuration_ids uuid[],p_round integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.ap_intake_snapshots; prior public.ap_research_rounds; inventory uuid; plan uuid; f jsonb; config public.ap_feasibility_source_configurations; auth public.ap_source_authorizations;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','operator')) then raise exception 'research_operator_required'; end if;
 select * into s from public.ap_intake_snapshots where id=p_snapshot_id for share;
 if s.id is null or s.finalized_at is null or exists(select 1 from public.ap_intake_snapshots n where (n.draft_id=s.draft_id or n.intake_id=s.intake_id) and n.version>s.version and n.finalized_at is not null) then raise exception 'research_snapshot_stale'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(s.id::text,45));
 select * into prior from public.ap_research_rounds where snapshot_id=s.id and request_sha256=p_request_sha256;
 if found then return prior.plan_id; end if;
 if p_round not between 1 and 3 or p_round<>(select count(*)+1 from public.ap_research_rounds where snapshot_id=s.id)
 or jsonb_typeof(p_families) is distinct from 'array' or jsonb_array_length(p_families) not between 1 and 100
 or coalesce(cardinality(p_configuration_ids),0) not between 1 and 20 then raise exception 'research_bounds_invalid'; end if;
 if p_round>1 and (not exists(select 1 from public.ap_feasibility_assessments a join public.ap_research_rounds r on r.plan_id=a.coverage_plan_id where r.snapshot_id=s.id and r.round=p_round-1 and a.state='COMPLETE')
 or exists(select 1 from public.ap_match_evaluations e join public.ap_inventory_members m on m.id=e.inventory_member_id
   join public.ap_job_snapshots j on j.id=e.job_snapshot_id
   where e.snapshot_id=s.id and e.invalidated_at is null and e.eligibility in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') and e.usefulness_result='PASS'
   and exists(select 1 from public.ap_current_verified_job_snapshots(array[j.legacy_job_id]) current_job where current_job.id=j.id)
   group by e.snapshot_id having count(distinct m.stable_normalized_job_id)>=10)) then raise exception 'research_prior_round_unresolved_or_sufficient'; end if;
 insert into public.ap_inventory_versions(cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
 values(clock_timestamp(),'current-source-heads','responsibility-retrieval-v1','requirement-engine-v1',p_request_sha256) returning id into inventory;
 insert into public.ap_feasibility_coverage_plans(snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
 values(s.id,inventory,'research-orchestration-v1',jsonb_build_object('breadth',s.search_breadth,'requiredFamilyIds',(select jsonb_agg(x->>'id') from jsonb_array_elements(p_families)x),'queryFamilies',p_families,'round',p_round),'REQUIRED',p_request_sha256) returning id into plan;
 foreach inventory in array p_configuration_ids loop
 select * into config from public.ap_feasibility_source_configurations where id=inventory;
 select * into auth from public.ap_source_authorizations where id=config.source_authorization_id;
 if config.id is null or auth.state not in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY') or not exists(select 1 from public.ap_source_authorization_heads h where h.source_id=auth.source_id and h.current_authorization_id=auth.id) then raise exception 'research_current_source_configuration_required'; end if;
 for f in select value from jsonb_array_elements(p_families) loop
 insert into public.ap_feasibility_coverage_cells(plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,terminal_outcome,parser_result,query_family_id,source_authorization_id,configuration_id,configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete)
 values(plan,auth.source_id,auth.state,f->>'fingerprint',config.pagination_bound,config.lookback_bound,config.result_bound,case when auth.state='AUTHORIZED_AUTOMATED' then 'AUTOMATED' else 'MANUAL' end,'PENDING','{}',f->>'id',auth.id,config.id,false,false,false);
 end loop; end loop;
 insert into public.ap_research_rounds(snapshot_id,plan_id,round,request_sha256,created_by) values(s.id,plan,p_round,p_request_sha256,p_actor_id);
 update public.ap_feasibility_requests set state='PENDING',completed_assessment_id=null,error_code=null,updated_at=clock_timestamp()
   where snapshot_id=s.id and state in ('ERROR','COMPLETED');
 update public.ap_feasibility_assessments set invalidated_at=clock_timestamp() where snapshot_id=s.id and invalidated_at is null;
 update public.ap_quotes set invalidated_at=clock_timestamp() where snapshot_id=s.id and invalidated_at is null;
 return plan;
end $$;
revoke all on function public.ap_begin_research_round(uuid,uuid,text,jsonb,uuid[],integer) from public,anon,authenticated;
grant execute on function public.ap_begin_research_round(uuid,uuid,text,jsonb,uuid[],integer) to service_role;

create function public.ap_admit_verified_inventory_snapshot(p_snapshot_id uuid,p_inventory_version_id uuid,p_job_snapshot_id uuid,p_stable_job_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.ap_job_snapshots; member uuid; verified_identity text;
begin
 if not exists(select 1 from public.ap_feasibility_coverage_plans p join public.ap_intake_snapshots s on s.id=p.snapshot_id where p.snapshot_id=p_snapshot_id and p.inventory_version_id=p_inventory_version_id and s.finalized_at is not null
 and not exists(select 1 from public.ap_intake_snapshots n where (n.draft_id=s.draft_id or n.intake_id=s.intake_id) and n.version>s.version and n.finalized_at is not null)) then raise exception 'inventory_current_criteria_required'; end if;
 select * into j from public.ap_job_snapshots where id=p_job_snapshot_id for share;
 if j.id is null or j.legacy_compatibility or j.requirement_completeness<>100 or j.live_verified_at>clock_timestamp() or j.live_verified_at<clock_timestamp()-interval '24 hours'
 or j.employer_identity_result is distinct from 'PASS' or j.listing_activity_result is distinct from 'PASS' or j.application_path_result is distinct from 'PASS' or j.legitimacy_result is distinct from 'PASS'
 or exists(select 1 from public.ap_job_snapshots newer where newer.supersedes_job_snapshot_id=j.id)
 or not exists(select 1 from public.ap_source_authorization_heads h join public.ap_source_authorizations a on a.id=h.current_authorization_id where a.id=j.source_authorization_id and a.state in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY')) then raise exception 'inventory_verified_source_required'; end if;
 select v.stable_normalized_job_id into verified_identity from public.ap_source_verifications v
 join public.ap_source_authorization_heads h on h.current_authorization_id=v.source_authorization_id and h.revision=v.authorization_head_revision
 join public.job_source_references r on r.id=v.source_reference_id and r.is_active
 join public.jobs job on job.id=r.job_id and job.is_active and job.rejection_reason is null and job.content_hash=v.observed_content_sha256
 where v.job_snapshot_id=j.id;
 if verified_identity is null then raise exception 'inventory_source_verification_lineage_required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_inventory_version_id::text,0));
 select m.id into member from public.ap_inventory_members m join public.ap_job_snapshots other on other.id=m.job_snapshot_id where m.inventory_version_id=p_inventory_version_id and (m.stable_normalized_job_id=verified_identity or other.canonical_application_url=j.canonical_application_url);
 if found then
   if not exists(select 1 from public.ap_inventory_members where id=member and job_snapshot_id=j.id and stable_normalized_job_id=verified_identity) then raise exception 'inventory_identity_snapshot_conflict'; end if;
   return member;
 end if;
 insert into public.ap_inventory_members(inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication) values(p_inventory_version_id,j.id,verified_identity,true) returning id into member;
 return member;
end $$;
revoke all on function public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text) to service_role;

create table public.ap_candidate_questions (
 id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references public.ap_intake_snapshots(id),
 job_snapshot_id uuid not null references public.ap_job_snapshots(id), requirement_node_id uuid not null references public.ap_requirement_nodes(id),
 prompt text not null check(length(prompt) between 10 and 1000), issued_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), unique(snapshot_id,job_snapshot_id,requirement_node_id)
);
create table public.ap_candidate_answers (
 question_id uuid primary key references public.ap_candidate_questions(id), fact_id uuid not null references public.ap_candidate_facts(id),
 answer text not null check(length(answer) between 1 and 5000), answered_at timestamptz not null default now()
);
alter table public.ap_candidate_questions enable row level security;
alter table public.ap_candidate_answers enable row level security;
revoke all on public.ap_candidate_questions,public.ap_candidate_answers from public,anon,authenticated,service_role;
grant select on public.ap_candidate_questions,public.ap_candidate_answers to service_role;
create trigger ap_candidate_questions_immutable before update or delete on public.ap_candidate_questions for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_candidate_answers_immutable before update or delete on public.ap_candidate_answers for each row execute function public.ap_prevent_immutable_mutation();
create function public.ap_issue_candidate_question(p_snapshot_id uuid,p_job_snapshot_id uuid,p_node_id uuid,p_actor_id uuid,p_prompt text) returns uuid
language plpgsql security definer set search_path='' as $$
declare q uuid;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','operator'))
 or not exists(select 1 from public.ap_requirement_nodes where id=p_node_id and job_snapshot_id=p_job_snapshot_id and node_kind='CRITERION')
 or not exists(select 1 from public.ap_feasibility_coverage_plans p join public.ap_inventory_members m on m.inventory_version_id=p.inventory_version_id where p.snapshot_id=p_snapshot_id and m.job_snapshot_id=p_job_snapshot_id) then raise exception 'question_bound_evidence_required'; end if;
 insert into public.ap_candidate_questions(snapshot_id,job_snapshot_id,requirement_node_id,prompt,issued_by) values(p_snapshot_id,p_job_snapshot_id,p_node_id,p_prompt,p_actor_id)
 on conflict(snapshot_id,job_snapshot_id,requirement_node_id) do nothing returning id into q;
 if q is null then select id into q from public.ap_candidate_questions where snapshot_id=p_snapshot_id and job_snapshot_id=p_job_snapshot_id and requirement_node_id=p_node_id; end if;
 return q;
end $$;
create function public.ap_answer_candidate_question(p_question_id uuid,p_draft_id uuid,p_secret_hash text,p_answer text) returns uuid
language plpgsql security definer set search_path='' as $$
declare q public.ap_candidate_questions; s public.ap_intake_snapshots; node public.ap_requirement_nodes; prior public.ap_candidate_answers; fact uuid;
begin
 select * into q from public.ap_candidate_questions where id=p_question_id for update;
 select * into s from public.ap_intake_snapshots where id=q.snapshot_id;
 if q.id is null or not exists(select 1 from public.ap_anonymous_drafts d where d.id=p_draft_id and d.id=s.draft_id and d.capability_secret_hash=p_secret_hash and d.expires_at>now() and d.finalized_snapshot_id=s.id) then raise exception 'question_owner_or_version_invalid'; end if;
 select * into prior from public.ap_candidate_answers where question_id=q.id;
 if found then if prior.answer<>p_answer then raise exception 'answer_immutable_correction_required'; end if; return prior.fact_id; end if;
 select * into node from public.ap_requirement_nodes where id=q.requirement_node_id;
 insert into public.ap_candidate_facts(draft_id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,customer_display_label,customer_display_value)
 values(s.draft_id,s.customer_id,s.id,node.semantic_key,'CLARIFICATION',jsonb_build_object('statement',p_answer),'CUSTOMER_ASSERTION',s.id,'clarification:'||q.id,'question:'||q.id,'CUSTOMER_CONFIRMED',clock_timestamp(),'clarification-v1',s.schema_version,q.prompt,to_jsonb(p_answer)) returning id into fact;
 insert into public.ap_candidate_answers(question_id,fact_id,answer) values(q.id,fact,p_answer);
 -- The answer is evidence, not a gate pass. Operator re-evaluation remains required.
 update public.ap_match_evaluations set invalidated_at=clock_timestamp() where snapshot_id=s.id and job_snapshot_id=q.job_snapshot_id and invalidated_at is null;
 update public.ap_feasibility_assessments set invalidated_at=clock_timestamp() where snapshot_id=s.id and invalidated_at is null;
 update public.ap_quotes set invalidated_at=clock_timestamp() where snapshot_id=s.id and invalidated_at is null;
 update public.ap_feasibility_requests set state='PENDING',completed_assessment_id=null,error_code=null,updated_at=clock_timestamp()
   where snapshot_id=s.id and state in ('ERROR','COMPLETED');
 return fact;
end $$;
revoke all on function public.ap_issue_candidate_question(uuid,uuid,uuid,uuid,text),public.ap_answer_candidate_question(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ap_issue_candidate_question(uuid,uuid,uuid,uuid,text),public.ap_answer_candidate_question(uuid,uuid,text,text) to service_role;
create function public.ap_current_customer_question(p_customer_id uuid,p_question_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_candidate_questions q join public.ap_intake_snapshots s on s.id=q.snapshot_id
 where q.id=p_question_id and public.ap_customer_owns_snapshot(p_customer_id,s.id)
 and not exists(select 1 from public.ap_intake_snapshots newer where (newer.draft_id=s.draft_id or newer.intake_id=s.intake_id) and newer.version>s.version)
 and not exists(select 1 from public.ap_search_services service where service.customer_id=p_customer_id and service.original_snapshot_id=s.id and service.active_snapshot_id<>s.id)
 and not exists(select 1 from public.ap_job_snapshots newer where newer.supersedes_job_snapshot_id=q.job_snapshot_id));
$$;
create function public.ap_customer_candidate_questions(p_customer_id uuid) returns table(id uuid,prompt text,answered boolean)
language sql stable security definer set search_path='' as $$
 select q.id,q.prompt,exists(select 1 from public.ap_candidate_answers a where a.question_id=q.id)
 from public.ap_candidate_questions q where public.ap_current_customer_question(p_customer_id,q.id)
 order by q.created_at limit 101;
$$;
create function public.ap_answer_customer_question(p_customer_id uuid,p_question_id uuid,p_answer text) returns uuid
language plpgsql security definer set search_path='' as $$
declare q public.ap_candidate_questions; s public.ap_intake_snapshots; node public.ap_requirement_nodes; prior public.ap_candidate_answers; fact uuid;
begin
 select * into q from public.ap_candidate_questions where id=p_question_id for update;
 if q.id is null or not public.ap_current_customer_question(p_customer_id,q.id) or p_answer is null or length(btrim(p_answer)) not between 1 and 5000 then raise exception 'question_owner_or_version_invalid'; end if;
 select * into s from public.ap_intake_snapshots where id=q.snapshot_id;
 select * into prior from public.ap_candidate_answers where question_id=q.id;
 if found then if prior.answer<>p_answer then raise exception 'answer_immutable_correction_required'; end if; return prior.fact_id; end if;
 select * into node from public.ap_requirement_nodes where id=q.requirement_node_id;
 insert into public.ap_candidate_facts(draft_id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,customer_display_label,customer_display_value)
 values(s.draft_id,p_customer_id,s.id,node.semantic_key,'CLARIFICATION',jsonb_build_object('statement',p_answer),'CUSTOMER_ASSERTION',s.id,'clarification:'||q.id,'question:'||q.id,'CUSTOMER_CONFIRMED',clock_timestamp(),'clarification-v1',s.schema_version,q.prompt,jsonb_build_object('summary',p_answer)) returning id into fact;
 insert into public.ap_candidate_answers(question_id,fact_id,answer) values(q.id,fact,p_answer);
 update public.ap_match_evaluations set invalidated_at=clock_timestamp() where snapshot_id=s.id and job_snapshot_id=q.job_snapshot_id and invalidated_at is null;
 update public.ap_feasibility_assessments set invalidated_at=clock_timestamp() where snapshot_id=s.id and invalidated_at is null;
 update public.ap_quotes set invalidated_at=clock_timestamp() where snapshot_id=s.id and invalidated_at is null;
 update public.ap_feasibility_requests set state='PENDING',completed_assessment_id=null,error_code=null,updated_at=clock_timestamp()
   where snapshot_id=s.id and state in ('ERROR','COMPLETED');
 return fact;
end $$;
revoke all on function public.ap_current_customer_question(uuid,uuid),public.ap_customer_candidate_questions(uuid),public.ap_answer_customer_question(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ap_current_customer_question(uuid,uuid),public.ap_customer_candidate_questions(uuid),public.ap_answer_customer_question(uuid,uuid,text) to service_role;

create table public.ap_research_cell_reviews (
 cell_id uuid primary key references public.ap_feasibility_coverage_cells(id),
 source_run_id uuid references public.job_source_runs(id),reviewer_id uuid not null references public.profiles(id),
 evidence_notes text not null check(length(evidence_notes)>=20), reviewed_at timestamptz not null default now()
);
alter table public.ap_research_cell_reviews enable row level security;
revoke all on public.ap_research_cell_reviews from public,anon,authenticated,service_role;
grant select on public.ap_research_cell_reviews to service_role;
create trigger ap_research_cell_reviews_immutable before update or delete on public.ap_research_cell_reviews for each row execute function public.ap_prevent_immutable_mutation();
create function public.ap_complete_research_cell(p_cell_id uuid,p_run_id uuid,p_actor_id uuid,p_notes text) returns void
language plpgsql security definer set search_path='' as $$
declare cell public.ap_feasibility_coverage_cells; plan public.ap_feasibility_coverage_plans; run public.job_source_runs; total integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','operator')) or length(btrim(p_notes))<20 then raise exception 'research_review_required'; end if;
 select * into cell from public.ap_feasibility_coverage_cells where id=p_cell_id for update;
 select * into plan from public.ap_feasibility_coverage_plans where id=cell.plan_id;
 select * into run from public.job_source_runs where id=p_run_id;
 if cell.id is null or cell.execution_path<>'AUTOMATED' or run.id is null or run.source_id<>cell.source_id or run.source_authorization_id<>cell.source_authorization_id
 or run.status<>'succeeded' or run.enumeration_status<>'complete' or run.checkpoint_start is not null
 or run.completed_at is null or run.completed_at>clock_timestamp() or run.completed_at<clock_timestamp()-interval '24 hours'
 or run.fetched_count>cell.result_bound
 or not exists(select 1 from public.ap_intake_snapshots s where s.id=plan.snapshot_id and s.finalized_at is not null
   and not exists(select 1 from public.ap_intake_snapshots n where (n.draft_id=s.draft_id or n.intake_id=s.intake_id) and n.version>s.version and n.finalized_at is not null))
 or not exists(select 1 from public.ap_source_authorization_heads h where h.source_id=run.source_id and h.current_authorization_id=run.source_authorization_id and h.revision=run.authorization_head_revision)
 then raise exception 'research_complete_current_run_required'; end if;
 if exists(select 1 from public.ap_research_cell_reviews where cell_id=cell.id) then
 if not exists(select 1 from public.ap_research_cell_reviews where cell_id=cell.id and source_run_id=run.id) then raise exception 'research_completion_replay_conflict'; end if; return; end if;
 select count(distinct p.listing_key) into total from public.job_source_listing_projections p join public.ap_source_verifications v on v.projection_id=p.id
 join public.ap_inventory_members m on m.job_snapshot_id=v.job_snapshot_id and m.inventory_version_id=plan.inventory_version_id
 join public.ap_match_evaluations e on e.inventory_member_id=m.id and e.snapshot_id=plan.snapshot_id and e.invalidated_at is null where p.run_id=run.id;
 if total<>run.fetched_count then raise exception 'research_verified_evaluation_coverage_incomplete'; end if;
 insert into public.ap_research_cell_reviews(cell_id,source_run_id,reviewer_id,evidence_notes) values(cell.id,run.id,p_actor_id,p_notes);
 update public.ap_feasibility_coverage_cells set terminal_outcome=case when total=0 then 'SUCCEEDED_EMPTY' else 'SUCCEEDED_WITH_RESULTS' end,
 result_count=total,configured_bound_satisfied=true,normalized_and_deduplicated=true,parser_result='{"status":"COMPLETE"}',
 cursor_or_stop_reason='COMPLETE_VERIFIED_RUN:'||run.id,started_at=run.started_at,completed_at=clock_timestamp() where id=cell.id;
 update public.ap_feasibility_requests set state='PENDING',completed_assessment_id=null,error_code=null,updated_at=clock_timestamp()
   where snapshot_id=plan.snapshot_id and state in ('ERROR','COMPLETED');
end $$;
revoke all on function public.ap_complete_research_cell(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ap_complete_research_cell(uuid,uuid,uuid,text) to service_role;
-- A human structures existing source lines; confirmation remains a separate,
-- presented customer action at finalization. Original excerpts are preserved.
create function public.ap_annotate_document_facts(p_draft_id uuid,p_secret_hash text,p_source_fact_ids uuid[],p_annotation jsonb,p_display text)
returns uuid language plpgsql security definer set search_path='' as $$
declare document_id uuid; fact_id uuid; kind text:=p_annotation->>'kind'; total integer;
begin
 perform 1 from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash
   and state='IN_PROGRESS' and expires_at>clock_timestamp() for update;
 if not found then raise exception 'draft_capability_invalid'; end if;
 if cardinality(p_source_fact_ids) not between 1 and 20 or jsonb_typeof(p_annotation)<>'object'
   or length(p_annotation::text)>30000 or length(btrim(p_display)) not between 1 and 30000
   or kind not in ('EMPLOYMENT','RESPONSIBILITY','EDUCATION','TOOL_CAPABILITY') then raise exception 'annotation_invalid'; end if;
 select count(distinct f.id),min(f.document_version_id::text)::uuid into total,document_id
 from public.ap_candidate_facts f join public.ap_document_versions d on d.id=f.document_version_id
 where f.id=any(p_source_fact_ids) and f.draft_id=p_draft_id and f.source_kind='DOCUMENT'
   and f.value_kind='VERBATIM_DOCUMENT_EXCERPT' and f.superseded_at is null
   and d.draft_id=p_draft_id and d.is_current and d.retention_state='ACTIVE' and d.parse_status='SUCCEEDED';
 if total<>cardinality(p_source_fact_ids) or exists(select 1 from public.ap_candidate_facts
   where id=any(p_source_fact_ids) and document_version_id<>document_id) then raise exception 'annotation_source_binding_invalid'; end if;
 if (case kind when 'EMPLOYMENT' then nullif(btrim(p_annotation->>'historicalTitle'),'') is null
      or nullif(btrim(p_annotation->>'employer'),'') is null or nullif(btrim(p_annotation->>'dates'),'') is null
      or jsonb_typeof(p_annotation->'bullets') is distinct from 'array' or jsonb_array_length(p_annotation->'bullets') not between 1 and 12
    when 'RESPONSIBILITY' then nullif(btrim(p_annotation->>'activity'),'') is null
    when 'EDUCATION' then nullif(btrim(p_annotation->>'educationLevel'),'') is null or nullif(btrim(p_annotation->>'completionStatus'),'') is null
    when 'TOOL_CAPABILITY' then nullif(btrim(p_annotation->>'taskOrTool'),'') is null
      or coalesce(p_annotation->>'capabilityStatus','') not in ('CAN_DO_NOW','DONE_BEFORE_NEEDS_REFRESHER','BASIC_EXPOSURE','NOT_DONE','UNSURE')
    else true end) then raise exception 'annotation_fields_required'; end if;
 if p_annotation ? 'employmentFactId' and not exists(select 1 from public.ap_candidate_facts
   where id=(p_annotation->>'employmentFactId')::uuid and draft_id=p_draft_id and document_version_id=document_id
     and value_kind='EMPLOYMENT' and superseded_at is null and verification<>'CUSTOMER_REJECTED') then raise exception 'annotation_employment_binding_invalid'; end if;
 select id into fact_id from public.ap_candidate_facts where draft_id=p_draft_id and superseded_at is null
   and typed_value=(p_annotation-'kind')||jsonb_build_object('sourceFactIds',to_jsonb(p_source_fact_ids)) and value_kind=kind limit 1;
 if fact_id is not null then return fact_id; end if;
 insert into public.ap_candidate_facts(draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,
   verification,catalog_version,schema_version,fact_tier,customer_display_label,customer_display_value,capability_status)
 values(p_draft_id,'annotated:'||kind||':'||pg_catalog.gen_random_uuid()::text,kind,
   (p_annotation-'kind')||jsonb_build_object('sourceFactIds',to_jsonb(p_source_fact_ids)),'DOCUMENT',document_id,
   'Human structured from extracted fact IDs: '||array_to_string(p_source_fact_ids,','),'EXTRACTED_UNCONFIRMED',
   'source-annotation-v1','source-annotation-v1','SEARCH_CRITICAL','Confirm your structured '||lower(kind),
   jsonb_build_object('summary',p_display),case when kind='TOOL_CAPABILITY' then p_annotation->>'capabilityStatus' else null end)
 returning id into fact_id;
 return fact_id;
end $$;
revoke all on function public.ap_annotate_document_facts(uuid,text,uuid[],jsonb,text) from public,anon,authenticated;
grant execute on function public.ap_annotate_document_facts(uuid,text,uuid[],jsonb,text) to service_role;
create function public.ap_bind_confirmed_document_facts(p_snapshot_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.ap_intake_snapshots; f public.ap_candidate_facts; ids jsonb; value jsonb;
begin
 select * into s from public.ap_intake_snapshots where id=p_snapshot_id;
 if s.id is null or s.finalized_at is null then raise exception 'finalized_criteria_required'; end if;
 select coalesce(jsonb_object_agg(fact.id::text,pg_catalog.gen_random_uuid()::text),'{}') into ids
 from public.ap_candidate_facts fact join public.ap_document_versions doc on doc.id=fact.document_version_id
 where fact.draft_id=s.draft_id and fact.snapshot_id is null and fact.source_kind='DOCUMENT'
   and fact.verification='CUSTOMER_CONFIRMED' and fact.superseded_at is null and doc.is_current and doc.retention_state='ACTIVE'
   and not exists(select 1 from public.ap_candidate_facts bound where bound.snapshot_id=s.id and bound.typed_value->>'sourceDocumentFactId'=fact.id::text);
 for f in select * from public.ap_candidate_facts where ids ? id::text loop
   value:=f.typed_value||jsonb_build_object('sourceDocumentFactId',f.id::text);
   if value ? 'employmentFactId' then
     if not (ids ? (value->>'employmentFactId')) then raise exception 'confirmed_employment_record_required'; end if;
     value:=jsonb_set(value,'{employmentFactId}',ids->(value->>'employmentFactId'));
   end if;
   insert into public.ap_candidate_facts(id,draft_id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,
     source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,starts_on,ends_on,calendar_duration_days,intensity_percent,
     capability_status,fact_tier,customer_display_label,customer_display_value)
   values((ids->>f.id::text)::uuid,f.draft_id,s.customer_id,s.id,f.semantic_key,f.value_kind,value,'DOCUMENT',f.document_version_id,
     f.source_locator,'CUSTOMER_CONFIRMED',f.confirmed_or_corrected_at,f.catalog_version,f.schema_version,f.starts_on,f.ends_on,f.calendar_duration_days,
     f.intensity_percent,f.capability_status,f.fact_tier,f.customer_display_label,f.customer_display_value);
 end loop;
end $$;
revoke all on function public.ap_bind_confirmed_document_facts(uuid) from public,anon,authenticated;
grant execute on function public.ap_bind_confirmed_document_facts(uuid) to service_role;
do $$ declare definition text; anchor text:='  request_id:=gen_random_uuid();';
begin
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ap_finalize_four_step_intake';
 if position(anchor in definition)=0 then raise exception 'document_binding_anchor_missing'; end if;
 definition:=replace(definition,anchor,'  perform public.ap_bind_confirmed_document_facts(p_snapshot_id);'||chr(10)||anchor);
 execute definition;
end $$;
create function public.ap_invalidate_document_fact_copies() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.verification='DISPUTED' or new.superseded_at is not null then
   update public.ap_candidate_facts set verification='DISPUTED' where typed_value->>'sourceDocumentFactId'=new.id::text
     and verification='CUSTOMER_CONFIRMED';
 end if;
 return new;
end $$;
create trigger ap_invalidate_document_fact_copies after update of verification,superseded_at on public.ap_candidate_facts
 for each row execute function public.ap_invalidate_document_fact_copies();
revoke all on function public.ap_invalidate_document_fact_copies() from public,anon,authenticated;
commit;

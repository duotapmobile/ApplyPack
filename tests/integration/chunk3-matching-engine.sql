begin;

do $$ begin
  if (select state from public.ap_source_authorizations where source_id='liveops' and authorization_version='source-auth-v1') <> 'BLOCKED' then raise exception 'liveops_not_blocked'; end if;
  if exists(select 1 from public.ap_source_authorizations where state='AUTHORIZED_AUTOMATED') then raise exception 'unexpected_automated_source'; end if;
  if (select state from public.ap_source_authorizations where source_id='manual-reviewed' and authorization_version='source-auth-v1') <> 'AUTHORIZED_MANUAL_ONLY' then raise exception 'manual_source_not_authorized'; end if;
  if exists(select 1 from public.job_sources where automation_status='automated' and schedule_enabled) then raise exception 'unauthorized_automation_schedule_enabled'; end if;
end $$;

do $$ begin
  begin
    insert into public.ap_source_authorizations(source_id,source_display_name,state,access_method,authorization_version,content_sha256)
    values('invalid-enabled','Invalid','AUTHORIZED_AUTOMATED','AUTOMATED','bad-v1',repeat('a',64));
    raise exception 'missing_evidence_was_accepted';
  exception when check_violation then null; end;
end $$;

do $$ declare auth_id uuid; begin
  select a.id into auth_id from public.ap_source_authorizations a where a.source_id='manual-reviewed' and a.authorization_version='source-auth-v1';
  begin
    insert into public.ap_feasibility_source_configurations(source_authorization_id,config_version,pagination_bound,lookback_bound,result_bound,release_verification_ttl,parser_version,cutoff_version,content_sha256,approved_by_role,approved_at)
    values(auth_id,'invalid-zero',0,interval '1 day',10,interval '1 hour','p1','c1',repeat('b',64),'test',now());
    raise exception 'zero_bound_was_accepted';
  exception when check_violation then null; end;
end $$;

do $$ begin
  begin
    update public.ap_source_authorizations set source_display_name='Changed' where source_id='manual-reviewed';
    raise exception 'immutable_authorization_was_changed';
  exception when raise_exception then
    if sqlerrm='immutable_authorization_was_changed' then raise; end if;
  end;
end $$;

do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ap_match_evaluations' and column_name='active_root_keys') then raise exception 'active_root_keys_missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ap_job_snapshots' and column_name='source_authorization_id') then raise exception 'source_authorization_link_missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ap_feasibility_coverage_cells' and column_name='query_family_id') then raise exception 'query_family_id_missing'; end if;
  if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='ap_inventory_members') then raise exception 'inventory_members_missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ap_job_snapshots' and column_name='material_source_qualities') then raise exception 'material_source_qualities_missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ap_human_review_records' and column_name='review_subject_key') then raise exception 'review_subject_key_missing'; end if;
  if to_regprocedure('public.ap_record_matching_review(jsonb,jsonb)') is null then raise exception 'atomic_matching_review_function_missing'; end if;
  if has_table_privilege('anon','public.ap_inventory_members','select') then raise exception 'inventory_members_exposed'; end if;
  if not exists(select 1 from public.ap_migration_checkpoints where migration_id='202609040025' and checkpoint='CHUNK3_MATCHING_ENGINE_EXPAND') then raise exception 'chunk3_checkpoint_missing'; end if;
end $$;

create function pg_temp.assert_true(value boolean, failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%', failure_message; end if; end $$;

select * from public.ap_create_anonymous_draft('33000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day');
insert into public.ap_intake_snapshots(id,draft_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at)
values('53000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001',1,'INITIAL','worker@example.invalid',null,'worker@example.invalid','[]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',null,null,false,null,null,'EXCLUDE','EXCLUDE','EXCLUDE','EXCLUDE','{}','NEITHER','{}',repeat('5',64),'applypack-c14n-v1','applypack-intake-v3',now());
update public.ap_anonymous_drafts set finalized_snapshot_id='53000000-0000-4000-8000-000000000001',state='COMPLETE' where id='33000000-0000-4000-8000-000000000001';
insert into public.ap_feasibility_requests(id,draft_id,snapshot_id,request_version,idempotency_key)
values('63000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','chunk3-v1','feasibility:chunk3-worker');

select * from public.ap_claim_feasibility_request('63000000-0000-4000-8000-000000000001','worker-a');
select pg_temp.assert_true((select state='CLAIMED' and claimed_by='worker-a' from public.ap_feasibility_requests where id='63000000-0000-4000-8000-000000000001'),'feasibility request claim failed');
select public.ap_defer_feasibility_request('63000000-0000-4000-8000-000000000001','worker-a','COVERAGE_PENDING');
select pg_temp.assert_true((select state='PENDING' and claimed_by is null from public.ap_feasibility_requests where id='63000000-0000-4000-8000-000000000001'),'feasibility request defer failed');

insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
values('72000000-0000-4000-8000-000000000003',now(),'source-auth-v1','responsibility-retrieval-v1','requirement-engine-v1',repeat('7',64));
insert into public.ap_feasibility_source_configurations(id,source_authorization_id,config_version,pagination_bound,lookback_bound,result_bound,release_verification_ttl,parser_version,cutoff_version,content_sha256,approved_by_role,approved_at)
select '62000000-0000-4000-8000-000000000001',id,'fixture-config-v1',1,interval '1 day',10,interval '1 hour','requirement-engine-v1','cutoff-v1',repeat('6',64),'test',now() from public.ap_source_authorizations where source_id='manual-reviewed' and authorization_version='source-auth-v1';
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
values('73000000-0000-4000-8000-000000000013','53000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','feasibility-v1','{"requiredFamilyIds":["family-1"]}','REQUIRED',repeat('8',64));
insert into public.ap_feasibility_coverage_cells(plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,terminal_outcome,cursor_or_stop_reason,result_count,parser_result,started_at,completed_at,query_family_id,source_authorization_id,configuration_id,configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete)
select '73000000-0000-4000-8000-000000000013','manual-reviewed','AUTHORIZED_MANUAL_ONLY',repeat('9',64),1,interval '1 day',10,'MANUAL','SUCCEEDED_WITH_RESULTS','fixture-bound',10,'{"state":"COMPLETE"}',now(),now(),'family-1',a.id,'62000000-0000-4000-8000-000000000001',true,true,true from public.ap_source_authorizations a where a.source_id='manual-reviewed' and a.authorization_version='source-auth-v1';
insert into public.ap_feasibility_assessments(id,snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,reviewable_count,excluded_count,reasons,primary_reason,rules_version,expires_at)
values('74000000-0000-4000-8000-000000000013','53000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000013','COMPLETE','LIKELY','NONE',10,0,0,'{}',null,'matching-rules-v1',now()+interval '1 hour');
select * from public.ap_claim_feasibility_request('63000000-0000-4000-8000-000000000001','worker-a');
select public.ap_complete_feasibility_request('63000000-0000-4000-8000-000000000001','worker-a','74000000-0000-4000-8000-000000000013');
select pg_temp.assert_true((select state='COMPLETED' and completed_assessment_id='74000000-0000-4000-8000-000000000013' and claimed_by is null from public.ap_feasibility_requests where id='63000000-0000-4000-8000-000000000001'),'feasibility request completion failed');
select pg_temp.assert_true((select count(*)=1 from public.ap_audit_events where action='FEASIBILITY_COMPLETED' and entity_id='63000000-0000-4000-8000-000000000001'),'feasibility completion audit missing');

insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
values('73000000-0000-4000-8000-000000000014','53000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','feasibility-v1','{"requiredFamilyIds":["missing-family"]}','REQUIRED',repeat('a',64));
insert into public.ap_feasibility_coverage_cells(plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,terminal_outcome,cursor_or_stop_reason,result_count,parser_result,started_at,completed_at,query_family_id,source_authorization_id,configuration_id,configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete)
select '73000000-0000-4000-8000-000000000014','manual-reviewed','AUTHORIZED_MANUAL_ONLY',repeat('b',64),1,interval '1 day',10,'MANUAL','SUCCEEDED_EMPTY','fixture-bound',0,'{"state":"COMPLETE"}',now(),now(),'other-family',a.id,'62000000-0000-4000-8000-000000000001',true,true,true from public.ap_source_authorizations a where a.source_id='manual-reviewed' and a.authorization_version='source-auth-v1';
do $$ begin
  begin
    insert into public.ap_feasibility_assessments(snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,reviewable_count,excluded_count,reasons,primary_reason,rules_version)
    values('53000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000014','COMPLETE','INFEASIBLE','NONE',0,0,0,'{INVENTORY_SHORTAGE}','INVENTORY_SHORTAGE','matching-rules-v1');
    raise exception 'missing_query_family_was_accepted';
  exception when raise_exception then if sqlerrm='missing_query_family_was_accepted' then raise; end if; if sqlerrm<>'feasibility_coverage_incomplete' then raise; end if; end;
end $$;

do $$ begin
  begin
    insert into public.ap_job_snapshots(origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,legacy_compatibility)
    values('APPLYPACK_FOUND','manual-reviewed','https://liveops.invalid/apply','EMPLOYER_HOSTED','https://liveops.invalid/job','Liveops','Agent',repeat('c',64),'{}',now(),null,true,now(),'{}','legacy-v1',repeat('d',64),true);
    raise exception 'liveops_ingestion_was_accepted';
  exception when raise_exception then if sqlerrm='liveops_ingestion_was_accepted' then raise; end if; if sqlerrm<>'blocked_source_liveops' then raise; end if; end;
end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('13000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chunk3-remediation@example.invalid','',now(),'{}','{}',now(),now());
insert into public.intakes(id,customer_id,email,direction,dealbreakers,location_preference,schedule_preference,experience_summary,resume_path,status,source_scan_status)
values('23000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000003','chunk3-remediation@example.invalid','Operations','None','Remote','Weekdays','Confirmed','fixture/resume.pdf','ready_for_payment','clean');
select * from public.ap_create_anonymous_draft('33000000-0000-4000-8000-000000000003',repeat('3',64),now()+interval '1 day');
insert into public.ap_intake_snapshots(id,intake_id,draft_id,customer_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at)
values('53000000-0000-4000-8000-000000000003','23000000-0000-4000-8000-000000000003','33000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000003',1,'INITIAL','chunk3-remediation@example.invalid',null,'chunk3-remediation@example.invalid','[]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',6000000,5000000,false,'YEAR','BASE','PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('3',64),'applypack-c14n-v1','applypack-foundation-v1',now());
update public.ap_anonymous_drafts set finalized_snapshot_id='53000000-0000-4000-8000-000000000003',state='COMPLETE' where id='33000000-0000-4000-8000-000000000003';
insert into public.ap_feasibility_requests(id,draft_id,snapshot_id,request_version,idempotency_key)
values('63000000-0000-4000-8000-000000000003','33000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000003','chunk3-remediation-v1','feasibility:chunk3-remediation');
insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
values('72000000-0000-4000-8000-000000000004',now(),'source-auth-v1','responsibility-retrieval-v1','listing-requirements-v2',repeat('4',64));
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
values('73000000-0000-4000-8000-000000000015','53000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000004','feasibility-v1','{"requiredFamilyIds":["family-remediation"],"breadth":"ADJACENT_OPPORTUNITIES"}','REQUIRED',repeat('5',64));
insert into public.ap_feasibility_coverage_cells(plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,terminal_outcome,cursor_or_stop_reason,result_count,parser_result,started_at,completed_at,query_family_id,source_authorization_id,configuration_id,configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete)
select '73000000-0000-4000-8000-000000000015','manual-reviewed','AUTHORIZED_MANUAL_ONLY',repeat('6',64),1,interval '1 day',10,'MANUAL','SUCCEEDED_WITH_RESULTS','fixture-bound',1,'{"status":"COMPLETE"}',now(),now(),'family-remediation',a.id,'62000000-0000-4000-8000-000000000001',true,true,true from public.ap_source_authorizations a where a.source_id='manual-reviewed' and a.authorization_version='source-auth-v1';
insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,canonical_employer_listing_url,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,source_authorization_id,first_seen_at,canonical_employer_domain,employer_identity_result,application_path_result,listing_activity_result,legitimacy_result,requirement_completeness,compensation_completeness,canonicalization_version,legacy_compatibility)
select '83000000-0000-4000-8000-000000000001','APPLYPACK_FOUND','manual-reviewed','https://employer.invalid/apply/1','EMPLOYER_HOSTED','https://employer.invalid/jobs/1','https://employer.invalid/jobs/1','Employer','Operations Specialist',repeat('7',64),'{"text":"Remote role"}',now(),current_date,false,now(),'{}','listing-requirements-v2',repeat('8',64),a.id,now(),'employer.invalid','PASS','PASS','PASS','PASS',100,100,'applypack-c14n-v1',false from public.ap_source_authorizations a where a.source_id='manual-reviewed' and a.authorization_version='source-auth-v1';
insert into public.ap_inventory_members(id,inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication)
values('82000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000004','83000000-0000-4000-8000-000000000001','application-url|https://employer.invalid/apply/1',true);
insert into public.ap_requirement_nodes(id,job_snapshot_id,parent_id,position,node_kind,classification_method,human_correction_history)
values('85000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',null,0,'ALL_OF','listing-requirements-v2','[]');
insert into public.ap_requirement_nodes(id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
values('85000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',0,'CRITERION','EXPERIENCE','85000000-0000-4000-8000-000000000003','experience.customer-operations','REQUIRED','line:1',1,'listing-requirements-v2','{"kind":"EXPERIENCE"}','Three years of customer operations experience required.','listing-requirements-v2','[]');
insert into public.ap_requirement_nodes(id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
values('85000000-0000-4000-8000-000000000004','83000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',1,'CRITERION','EMPLOYMENT_TYPE','85000000-0000-4000-8000-000000000005','employment.full-time','INFORMATIONAL','line:2',1,'listing-requirements-v5','{"kind":"EMPLOYMENT_TYPE","employmentTypes":["FULL_TIME"]}','Full-time employment.','listing-requirements-v5','[]');

insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
values('72000000-0000-4000-8000-000000000005',now(),'source-auth-v1','responsibility-retrieval-v1','listing-requirements-v2',repeat('c',64));
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256,created_at)
values('73000000-0000-4000-8000-000000000016','53000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000005','atomic-ingestion-fixture-v1','{}','REQUIRED',repeat('d',64),now()-interval '1 day');

do $$ declare auth_id uuid; member_id uuid; begin
  select id into auth_id from public.ap_source_authorizations where source_id='manual-reviewed' and authorization_version='source-auth-v1';
  member_id:=public.ap_persist_parsed_inventory_job(
    '53000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000005',
    'application-url|https://employer.invalid/apply/2',
    jsonb_build_object(
      'id','83000000-0000-4000-8000-000000000002','legacy_job_id',null,'origin','APPLYPACK_FOUND','discovery_source','manual-reviewed',
      'external_job_id','REQ-2','canonical_application_url','https://employer.invalid/apply/2','application_host_type','EMPLOYER_HOSTED',
      'canonical_employer_listing_url','https://employer.invalid/jobs/2','source_url','https://employer.invalid/jobs/2','company','Employer',
      'exact_title','Support Specialist','normalized_fingerprint',repeat('a',64),'captured_listing','{"text":"Required: remote"}'::jsonb,
      'retrieved_at',now(),'posted_on',current_date,'posted_date_unknown',false,'live_verified_at',now(),'compensation_text',null,
      'compensation_source',null,'location_and_work_mode','{"mode":"REMOTE"}'::jsonb,'parser_version','listing-requirements-v2',
      'content_sha256',repeat('b',64),'source_authorization_id',auth_id,'first_seen_at',now(),'canonical_employer_domain','employer.invalid',
      'employer_identity_result','PASS','application_path_result','PASS','listing_activity_result','PASS','legitimacy_result','PASS',
      'requirement_completeness',100,'compensation_completeness',0,'canonicalization_version','applypack-c14n-v1'
    ),
    jsonb_build_array(
      jsonb_build_object('id','85000000-0000-4000-8000-000000000010','parent_id',null,'position',0,'node_kind','ALL_OF','classification_method','listing-requirements-v2','human_correction_history','[]'::jsonb),
      jsonb_build_object('id','85000000-0000-4000-8000-000000000011','parent_id','85000000-0000-4000-8000-000000000010','position',0,'node_kind','CRITERION','criterion_type','WORK_MODE','stable_criterion_id','85000000-0000-4000-8000-000000000012','semantic_key','required remote','requirement_strength','REQUIRED','source_locator','line:1','parser_certainty',1,'criterion_version','listing-requirements-v2','typed_value','{"kind":"WORK_MODE","modes":["REMOTE"]}'::jsonb,'source_excerpt','Required: remote','classification_method','listing-requirements-v2','human_correction_history','[]'::jsonb)
    )
  );
  if not exists(select 1 from public.ap_inventory_members where id=member_id and job_snapshot_id='83000000-0000-4000-8000-000000000002') then raise exception 'atomic_parsed_inventory_write_failed'; end if;
  if (select material_source_qualities from public.ap_job_snapshots where id='83000000-0000-4000-8000-000000000002')<>array[0.8]::numeric[] then raise exception 'material_source_quality_default_invalid'; end if;
  begin
    perform public.ap_persist_parsed_inventory_job(
      '53000000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000005','different-stable-id',
      jsonb_build_object('id','83000000-0000-4000-8000-000000000003','canonical_application_url','https://employer.invalid/apply/2','canonical_employer_listing_url','https://other.invalid/jobs/3','external_job_id','OTHER-3','canonical_employer_domain','other.invalid'),
      jsonb_build_array(jsonb_build_object('id','85000000-0000-4000-8000-000000000013','position',0,'node_kind','ALL_OF','classification_method','listing-requirements-v2','human_correction_history','[]'::jsonb))
    );
    raise exception 'atomic_url_duplicate_was_accepted';
  exception when raise_exception then if sqlerrm='atomic_url_duplicate_was_accepted' then raise; end if; if sqlerrm<>'duplicate_inventory_job' then raise; end if; end;
end $$;
do $$ begin
  begin
    insert into public.ap_human_review_records(customer_id,draft_id,reviewer_id,snapshot_id,job_snapshot_id,review_kind,compared_tasks,task_similarity,rationale,catalog_version,decision)
    values('13000000-0000-4000-8000-000000000003','33000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001','ADJACENT_EQUIVALENCE','["coordinate support"]','STRONG','Sparse adjacent assertion must fail.','matching-rules-v1','{"disposition":"RESOLVED_PASS","evidenceChanges":["reviewed"],"sourceEvidenceNodeIds":["85000000-0000-4000-8000-000000000002"],"candidateFactIds":["86000000-0000-4000-8000-000000000001"],"candidateFactVersionIds":["86000000-0000-4000-8000-000000000001"],"rulesVersion":"matching-rules-v1","stableCriterionId":"85000000-0000-4000-8000-000000000003","equivalentForCriterion":true}');
    raise exception 'sparse_adjacent_review_was_accepted';
  exception when raise_exception then if sqlerrm='sparse_adjacent_review_was_accepted' then raise; end if; if sqlerrm<>'adjacent_equivalence_exact_review_required' then raise; end if; end;
end $$;

do $$
declare
  first_result jsonb;
  second_result jsonb;
  first_id uuid;
  second_id uuid;
begin
  first_result:=public.ap_record_matching_review(
    jsonb_build_object(
      'customer_id','13000000-0000-4000-8000-000000000003','draft_id','33000000-0000-4000-8000-000000000003',
      'reviewer_id','13000000-0000-4000-8000-000000000003','snapshot_id','53000000-0000-4000-8000-000000000003',
      'job_snapshot_id','83000000-0000-4000-8000-000000000001','review_kind','CUSTOMER_CRITERION',
      'review_subject_key','customer:employment-type','rationale','The employer evidence initially appeared to satisfy the employment-type criterion.',
      'catalog_version','matching-rules-v3','decision',jsonb_build_object(
        'disposition','RESOLVED_PASS','result','PASS','resolutionIssue','NONE','unknownTreatment','BLOCK',
        'customerCriterionKey','customer:employment-type','evidenceChanges',jsonb_build_array('Reviewed the exact employment-type evidence.'),
        'sourceEvidenceNodeIds',jsonb_build_array('85000000-0000-4000-8000-000000000004'),'candidateFactIds','[]'::jsonb,
        'rulesVersion','matching-rules-v3'
      )
    ),null
  );
  first_id:=(first_result->>'reviewId')::uuid;
  second_result:=public.ap_record_matching_review(
    jsonb_build_object(
      'customer_id','13000000-0000-4000-8000-000000000003','draft_id','33000000-0000-4000-8000-000000000003',
      'reviewer_id','13000000-0000-4000-8000-000000000003','snapshot_id','53000000-0000-4000-8000-000000000003',
      'job_snapshot_id','83000000-0000-4000-8000-000000000001','review_kind','CUSTOMER_CRITERION',
      'review_subject_key','customer:employment-type','rationale','The later exact review found that the listing conflicts with the required employment type.',
      'catalog_version','matching-rules-v3','decision',jsonb_build_object(
        'disposition','RESOLVED_FAIL','result','FAIL','resolutionIssue','NONE','unknownTreatment','BLOCK',
        'customerCriterionKey','customer:employment-type','evidenceChanges',jsonb_build_array('Recorded the newer conflicting employment-type evidence.'),
        'sourceEvidenceNodeIds',jsonb_build_array('85000000-0000-4000-8000-000000000004'),'candidateFactIds','[]'::jsonb,
        'rulesVersion','matching-rules-v3'
      )
    ),null
  );
  second_id:=(second_result->>'reviewId')::uuid;
  if not exists(select 1 from public.ap_human_review_records where id=first_id and invalidated_at is not null) then raise exception 'older_review_not_invalidated'; end if;
  if not exists(select 1 from public.ap_human_review_records where id=second_id and invalidated_at is null and supersedes_review_id=first_id and decision->>'result'='FAIL') then raise exception 'newer_review_not_current'; end if;
  if (select count(*) from public.ap_human_review_records where snapshot_id='53000000-0000-4000-8000-000000000003' and job_snapshot_id='83000000-0000-4000-8000-000000000001' and review_kind='CUSTOMER_CRITERION' and review_subject_key='customer:employment-type' and invalidated_at is null)<>1 then raise exception 'current_review_uniqueness_failed'; end if;
end $$;

do $$ begin
  begin
    perform public.ap_record_matching_review(
      jsonb_build_object(
        'customer_id','13000000-0000-4000-8000-000000000003','draft_id','33000000-0000-4000-8000-000000000003',
        'reviewer_id','13000000-0000-4000-8000-000000000003','snapshot_id','53000000-0000-4000-8000-000000000003',
        'job_snapshot_id','83000000-0000-4000-8000-000000000001','review_kind','CUSTOMER_CRITERION',
        'review_subject_key','customer:employment-type','rationale','An unrelated experience node must not resolve employment type.',
        'catalog_version','matching-rules-v3','decision',jsonb_build_object(
          'disposition','RESOLVED_PASS','result','PASS','resolutionIssue','NONE','unknownTreatment','BLOCK',
          'customerCriterionKey','customer:employment-type','evidenceChanges',jsonb_build_array('Attempted unrelated evidence.'),
          'sourceEvidenceNodeIds',jsonb_build_array('85000000-0000-4000-8000-000000000002'),'candidateFactIds','[]'::jsonb,
          'rulesVersion','matching-rules-v3'
        )
      ),null
    );
    raise exception 'unrelated_customer_gate_evidence_was_accepted';
  exception when raise_exception then
    if sqlerrm='unrelated_customer_gate_evidence_was_accepted' then raise; end if;
    if sqlerrm<>'customer_criterion_not_exact_typed_evidence' then raise; end if;
  end;
end $$;

select pg_temp.assert_true(exists(select 1 from public.ap_migration_checkpoints where migration_id='202609060029' and checkpoint='CHUNK3_FINAL_ACCEPTANCE_EXPAND'),'chunk3_final_acceptance_checkpoint_missing');

do $$ begin
  begin
    insert into public.ap_match_evaluations(id,customer_id,snapshot_id,job_snapshot_id,inventory_member_id,inventory_version_id,eligibility,root_result,leaf_results,resolution_issues,unknown_treatments,satisfaction_paths,categorical_evidence_sufficient,fit_score,fit_components,evidence_confidence,confidence_components,salary_status,salary_disposition,soft_preferences,application_readiness,presentation_risk,presentation_risk_reasons,warnings,candidate_fact_ids,job_evidence,version_bundle,human_review_id,active_root_keys,root_results,calculation_input_sha256,calculation_version,usefulness_result,preference_alignment,confidence_label,rank_explanation,selector_explanation,legacy_compatibility)
    values('84000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000004','ELIGIBLE','PASS','[]','{}','{}','[]',true,90,'[]',85,'{}','PUBLISHED_MEETS_MINIMUM','PASS','{}','READY','LOW','[]','[]','{}','[]','{"matching":"matching-rules-v1"}',null,'{root-a}','[{"rootKey":"root-b","result":"PASS"}]',repeat('9',64),'matching-rules-v1','PASS',0.8,'HIGH','{}','{}',false);
    raise exception 'wrong_root_set_was_accepted';
  exception when raise_exception then if sqlerrm='wrong_root_set_was_accepted' then raise; end if; if sqlerrm<>'root_set_mismatch' then raise; end if; end;
end $$;

insert into public.ap_match_evaluations(id,customer_id,snapshot_id,job_snapshot_id,inventory_member_id,inventory_version_id,eligibility,root_result,leaf_results,resolution_issues,unknown_treatments,satisfaction_paths,categorical_evidence_sufficient,fit_score,fit_components,evidence_confidence,confidence_components,salary_status,salary_disposition,soft_preferences,application_readiness,presentation_risk,presentation_risk_reasons,warnings,candidate_fact_ids,job_evidence,version_bundle,human_review_id,active_root_keys,root_results,calculation_input_sha256,calculation_version,usefulness_result,preference_alignment,confidence_label,rank_explanation,selector_explanation,legacy_compatibility)
values('84000000-0000-4000-8000-000000000001','13000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000004','ELIGIBLE','PASS','[]','{}','{}','[]',true,90,'[]',85,'{}','PUBLISHED_MEETS_MINIMUM','PASS','{}','READY','LOW','[]','[]','{}','[]','{"matching":"matching-rules-v1"}',null,'{root-a}','[{"rootKey":"root-a","result":"PASS"}]',repeat('9',64),'matching-rules-v1','PASS',0.8,'HIGH','{}','{}',false);
select * from public.ap_claim_feasibility_request('63000000-0000-4000-8000-000000000003','worker-remediation');
do $$ declare derived_id uuid; begin
  derived_id:=public.ap_persist_derived_feasibility_assessment('63000000-0000-4000-8000-000000000003','worker-remediation','feasibility-worker-v1');
  if not exists(select 1 from public.ap_feasibility_assessments where id=derived_id and outcome='LIMITED' and preliminarily_deliverable_count=1 and reviewable_count=0 and excluded_count=0 and expires_at between now()+interval '59 minutes' and now()+interval '61 minutes') then raise exception 'derived_feasibility_counts_invalid'; end if;
end $$;
select pg_temp.assert_true(not has_table_privilege('service_role','public.ap_feasibility_assessments','insert'),'service_role_can_manufacture_feasibility');
select pg_temp.assert_true(exists(select 1 from public.ap_migration_checkpoints where migration_id='202609050026' and checkpoint='CHUNK3_AUDIT_REMEDIATION_EXPAND'),'chunk3_remediation_checkpoint_missing');

do $$ begin
  begin
    insert into public.ap_human_review_records(customer_id,draft_id,reviewer_id,snapshot_id,job_snapshot_id,review_kind,rationale,catalog_version,decision)
    values('13000000-0000-4000-8000-000000000003','33000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001','MATCH_EVIDENCE','A hard pass without candidate evidence must fail.','matching-rules-v2','{"disposition":"RESOLVED_PASS","evidenceChanges":["reviewed exact criterion"],"sourceEvidenceNodeIds":["85000000-0000-4000-8000-000000000002"],"candidateFactIds":[],"candidateFactVersionIds":[],"rulesVersion":"matching-rules-v2","stableCriterionId":"85000000-0000-4000-8000-000000000003","evidenceRelation":"DIRECT"}');
    raise exception 'zero_fact_hard_pass_was_accepted';
  exception when raise_exception then if sqlerrm='zero_fact_hard_pass_was_accepted' then raise; end if; if sqlerrm<>'match_evidence_binding_invalid' then raise; end if; end;
end $$;

select public.ap_persist_match_selection(
  '53000000-0000-4000-8000-000000000003','SEARCH_WORKFLOW','order-fixture',10,'bounded-diversity-v2',repeat('e',64),repeat('f',64),
  '[{"evaluationId":"84000000-0000-4000-8000-000000000001","baseRank":1,"selectedRank":1,"rankExplanation":{"fit":90,"version":"matching-rules-v2"},"selectorExplanation":{"state":"BASE_RANK_RETAINED","selectorVersion":"bounded-diversity-v2"}}]'
);
select public.ap_persist_match_selection(
  '53000000-0000-4000-8000-000000000003','SEARCH_WORKFLOW','order-fixture',10,'bounded-diversity-v2',repeat('e',64),repeat('f',64),
  '[{"evaluationId":"84000000-0000-4000-8000-000000000001","baseRank":1,"selectedRank":1,"rankExplanation":{"fit":90,"version":"matching-rules-v2"},"selectorExplanation":{"state":"BASE_RANK_RETAINED","selectorVersion":"bounded-diversity-v2"}}]'
);
select pg_temp.assert_true((select count(*)=1 from public.ap_match_selection_runs where content_sha256=repeat('f',64)),'selection_run_not_idempotent');
select pg_temp.assert_true((select count(*)=1 from public.ap_match_selection_members member join public.ap_match_selection_runs run on run.id=member.selection_run_id where run.content_sha256=repeat('f',64) and member.base_rank=1 and member.selected_rank=1 and member.rank_explanation->>'version'='matching-rules-v2'),'ranking_stages_not_persisted');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ap_match_selection_runs','select'),'selection_runs_exposed_to_clients');

do $$
declare
  correction_result jsonb;
  expected_review_id uuid;
begin
  correction_result:=public.ap_record_matching_review(
    jsonb_build_object(
      'customer_id','13000000-0000-4000-8000-000000000003','draft_id','33000000-0000-4000-8000-000000000003',
      'reviewer_id','13000000-0000-4000-8000-000000000003','snapshot_id','53000000-0000-4000-8000-000000000003',
      'job_snapshot_id','83000000-0000-4000-8000-000000000001','review_kind','PARSER_CORRECTION',
      'review_subject_key','parser-correction','rationale','The corrected text resolves the prior parser uncertainty with cited employer evidence.',
      'catalog_version','matching-rules-v3','decision',jsonb_build_object(
        'disposition','RESOLVED_PASS','evidenceChanges',jsonb_build_array('Corrected the listing into a complete immutable requirement tree.'),
        'sourceEvidenceNodeIds',jsonb_build_array('85000000-0000-4000-8000-000000000002'),'candidateFactIds','[]'::jsonb,
        'rulesVersion','matching-rules-v3','correctionMethod','NEW_IMMUTABLE_JOB_SNAPSHOT',
        'correctedJobSnapshotId','83100000-0000-4000-8000-000000000001',
        'correctedInventoryVersionId','72100000-0000-4000-8000-000000000001',
        'correctedInventoryMemberId','82100000-0000-4000-8000-000000000001'
      )
    ),
    jsonb_build_object(
      'originalInventoryMemberId','82000000-0000-4000-8000-000000000001',
      'correctedJobSnapshotId','83100000-0000-4000-8000-000000000001',
      'correctedInventoryVersionId','72100000-0000-4000-8000-000000000001',
      'correctedInventoryMemberId','82100000-0000-4000-8000-000000000001',
      'correctedCoveragePlanId','73100000-0000-4000-8000-000000000001',
      'capturedListing','{"text":"Remote full-time role in Virginia. Required: three years of customer operations experience.","parserIssues":[],"correctionOf":"83000000-0000-4000-8000-000000000001"}'::jsonb,
      'parserVersion','listing-requirements-v4','contentSha256',repeat('a',64),'compensationText',null,'compensationCompleteness',0,
      'locationAndWorkMode','{"modes":["REMOTE"],"statesOrDc":["VA"]}'::jsonb,
      'requirementNodes',jsonb_build_array(
        jsonb_build_object(
          'id','85100000-0000-4000-8000-000000000001','parent_id',null,'position',0,'node_kind','ALL_OF',
          'semantic_key','hard-root:corrected','classification_method','listing-requirements-v4'
        ),
        jsonb_build_object(
          'id','85100000-0000-4000-8000-000000000002','parent_id','85100000-0000-4000-8000-000000000001','position',0,
          'node_kind','CRITERION','criterion_type','EXPERIENCE','stable_criterion_id','85100000-0000-4000-8000-000000000003',
          'semantic_key','three years customer operations experience','requirement_strength','REQUIRED','source_locator','line:1',
          'parser_certainty',1,'criterion_version','listing-requirements-v4',
          'typed_value','{"kind":"EXPERIENCE","stableCriterionId":"85100000-0000-4000-8000-000000000003","semanticKey":"three years customer operations experience","strength":"REQUIRED","sourceLocator":"line:1","parserCertainty":1,"version":"listing-requirements-v4","responsibilityOrDomain":"customer operations experience","minimumMonths":36,"fteExplicit":false,"permittedEquivalents":[],"seniorityOrScope":null}'::jsonb,
          'source_excerpt','Required: three years of customer operations experience.','classification_method','listing-requirements-v4','importance',3
        )
      ),
      'inventoryContentSha256',repeat('b',64),'coveragePlanContentSha256',repeat('c',64)
    )
  );
  expected_review_id:=(correction_result->>'reviewId')::uuid;
  if correction_result->>'correctedJobSnapshotId'<>'83100000-0000-4000-8000-000000000001' then raise exception 'parser_correction_result_lineage_missing'; end if;
  if not exists(select 1 from public.ap_job_snapshots job where job.id='83100000-0000-4000-8000-000000000001' and job.supersedes_job_snapshot_id='83000000-0000-4000-8000-000000000001' and job.correction_review_id=expected_review_id and job.requirement_completeness=100 and job.parser_version='listing-requirements-v4') then raise exception 'corrected_job_snapshot_missing'; end if;
  if not exists(select 1 from public.ap_requirement_nodes node where node.id='85100000-0000-4000-8000-000000000002' and node.job_snapshot_id='83100000-0000-4000-8000-000000000001' and node.human_correction_history->0->>'reviewId'=expected_review_id::text) then raise exception 'parser_correction_history_missing'; end if;
  if not exists(select 1 from public.ap_inventory_members where id='82100000-0000-4000-8000-000000000001' and inventory_version_id='72100000-0000-4000-8000-000000000001' and job_snapshot_id='83100000-0000-4000-8000-000000000001' and selected_by_deduplication) then raise exception 'corrected_inventory_member_missing'; end if;
  if not exists(select 1 from public.ap_feasibility_coverage_plans where id='73100000-0000-4000-8000-000000000001' and inventory_version_id='72100000-0000-4000-8000-000000000001') then raise exception 'corrected_coverage_plan_missing'; end if;
  if not exists(select 1 from public.ap_match_evaluations where id='84000000-0000-4000-8000-000000000001' and invalidated_at is not null) then raise exception 'superseded_evaluation_not_invalidated'; end if;

  begin
    insert into public.ap_match_evaluations(id,customer_id,snapshot_id,job_snapshot_id,inventory_member_id,inventory_version_id,eligibility,root_result,leaf_results,resolution_issues,unknown_treatments,satisfaction_paths,categorical_evidence_sufficient,fit_score,fit_components,evidence_confidence,confidence_components,salary_status,salary_disposition,soft_preferences,application_readiness,presentation_risk,presentation_risk_reasons,warnings,candidate_fact_ids,job_evidence,explanation_evidence,version_bundle,human_review_id,active_root_keys,root_results,calculation_input_sha256,calculation_version,usefulness_result,preference_alignment,confidence_label,rank_explanation,selector_explanation,legacy_compatibility)
    values('84000000-0000-4000-8000-000000000003','13000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000004','INELIGIBLE','FAIL','[]','{}','{}','[]',false,null,'[]',85,'{}','UNPUBLISHED','NOT_APPLICABLE','{}','READY','LOW','[]','[]','{}','[]','{}','{"matching":"matching-rules-v3"}',null,'{root-a}','[{"rootKey":"root-a","result":"FAIL"}]',repeat('d',64),'matching-rules-v3','FAIL',null,'HIGH','{"state":"AWAITING_SELECTION_RUN"}','{"state":"AWAITING_SELECTION_RUN"}',false);
    raise exception 'superseded_job_evaluation_was_accepted';
  exception when raise_exception then if sqlerrm='superseded_job_evaluation_was_accepted' then raise; end if; if sqlerrm<>'superseded_job_snapshot_cannot_be_evaluated' then raise; end if; end;

  begin
    perform public.ap_record_matching_review(
      jsonb_build_object(
        'customer_id','13000000-0000-4000-8000-000000000003','draft_id','33000000-0000-4000-8000-000000000003',
        'reviewer_id','13000000-0000-4000-8000-000000000003','snapshot_id','53000000-0000-4000-8000-000000000003',
        'job_snapshot_id','83000000-0000-4000-8000-000000000001','review_kind','CUSTOMER_CRITERION',
        'review_subject_key','customer:geography-state','rationale','Superseded evidence cannot receive another review.',
        'catalog_version','matching-rules-v3','decision',jsonb_build_object(
          'disposition','RESOLVED_FAIL','result','FAIL','resolutionIssue','NONE','unknownTreatment','BLOCK',
          'customerCriterionKey','customer:geography-state','evidenceChanges',jsonb_build_array('Attempted superseded review.'),
          'sourceEvidenceNodeIds',jsonb_build_array('85000000-0000-4000-8000-000000000002'),'candidateFactIds','[]'::jsonb,
          'rulesVersion','matching-rules-v3'
        )
      ),null
    );
    raise exception 'superseded_job_review_was_accepted';
  exception when raise_exception then if sqlerrm='superseded_job_review_was_accepted' then raise; end if; if sqlerrm<>'superseded_job_snapshot_review_rejected' then raise; end if; end;
end $$;

insert into public.ap_source_authorizations(source_id,source_display_name,state,access_method,authorization_version,content_sha256)
values('manual-reviewed','Manual reviewed source revoked','BLOCKED','NONE','source-auth-v2',repeat('1',64));
do $$ begin
  begin
    insert into public.ap_match_evaluations(id,customer_id,snapshot_id,job_snapshot_id,inventory_member_id,inventory_version_id,eligibility,root_result,leaf_results,resolution_issues,unknown_treatments,satisfaction_paths,categorical_evidence_sufficient,fit_score,fit_components,evidence_confidence,confidence_components,salary_status,salary_disposition,soft_preferences,application_readiness,presentation_risk,presentation_risk_reasons,warnings,candidate_fact_ids,job_evidence,version_bundle,human_review_id,active_root_keys,root_results,calculation_input_sha256,calculation_version,usefulness_result,preference_alignment,confidence_label,rank_explanation,selector_explanation,legacy_compatibility)
    values('84000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000004','INELIGIBLE','FAIL','[]','{}','{}','[]',false,null,'[]',85,'{}','UNPUBLISHED','NOT_APPLICABLE','{}','READY','LOW','[]','[]','{}','[]','{"matching":"matching-rules-v2"}',null,'{root-a}','[{"rootKey":"root-a","result":"FAIL"}]',repeat('2',64),'matching-rules-v2','FAIL',null,'HIGH','{"state":"AWAITING_SELECTION_RUN"}','{"state":"AWAITING_SELECTION_RUN"}',false);
    raise exception 'evaluation_after_source_revocation_was_accepted';
  exception when raise_exception then if sqlerrm='evaluation_after_source_revocation_was_accepted' then raise; end if; if sqlerrm<>'current_source_authorization_required' then raise; end if; end;
end $$;
select pg_temp.assert_true(exists(select 1 from public.ap_migration_checkpoints where migration_id='202609050027' and checkpoint='CHUNK3_PERSISTED_EVIDENCE_EXPAND'),'chunk3_persisted_evidence_checkpoint_missing');
select pg_temp.assert_true(exists(select 1 from public.ap_migration_checkpoints where migration_id='202609050028' and checkpoint='CHUNK3_CONTRACT_COMPLETION_EXPAND'),'chunk3_contract_completion_checkpoint_missing');

rollback;
select 'chunk3_matching_engine_ok' as result;

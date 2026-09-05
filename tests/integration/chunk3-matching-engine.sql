begin;

do $$ begin
  if (select state from public.ap_source_authorizations where source_id='liveops' and authorization_version='source-auth-v1') <> 'BLOCKED' then raise exception 'liveops_not_blocked'; end if;
  if exists(select 1 from public.ap_source_authorizations where state='AUTHORIZED_AUTOMATED') then raise exception 'unexpected_automated_source'; end if;
  if (select state from public.ap_source_authorizations where source_id='manual-reviewed' and authorization_version='source-auth-v1') <> 'AUTHORIZED_MANUAL_ONLY' then raise exception 'manual_source_not_authorized'; end if;
  if exists(select 1 from public.job_sources where automation_status='automated') then raise exception 'legacy_automation_still_enabled'; end if;
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

rollback;
select 'chunk3_matching_engine_ok' as result;

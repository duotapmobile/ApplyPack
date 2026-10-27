-- Fictional native-engine proof. No real provider permission or HTTP request.
begin;
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;
select pg_temp.assert_true(not (select enabled from public.ap_research_preparation_configuration where singleton),'automatic research started enabled');
select pg_temp.assert_true(not has_table_privilege('service_role','public.ap_research_preparations','INSERT,UPDATE,DELETE'), 'unfenced queue writes');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ap_prepare_automatic_research(uuid,uuid,jsonb)','EXECUTE'),'customer planning bypass');
select pg_temp.assert_true(public.ap_archive_fence_coverage_current(),'new research tables missing archive fence');
select pg_temp.assert_true(public.ap_automatic_research_schema_installed(),'research schema predicate missing');
select pg_temp.assert_true(public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' in('202610250100','202610250101','202610260102','202610260103','202610270104','202610270105'),'research schema floor missing');
savepoint readiness_guards;
alter table public.ap_research_preparations disable trigger ap_service_retention_write;
select pg_temp.assert_true(not public.ap_automatic_research_schema_installed(),'disabled research retention guard passed readiness');
rollback to savepoint readiness_guards;
alter table public.ap_anonymous_drafts disable trigger ap_enqueue_finalized_research;
select pg_temp.assert_true(not public.ap_automatic_research_schema_installed(),'missing finalization queue trigger passed readiness');
rollback to savepoint readiness_guards;
grant execute on function public.ap_lock_research_preparation(uuid,boolean) to service_role;
select pg_temp.assert_true(not public.ap_automatic_research_schema_installed(),'internal research locking bypass passed readiness');
rollback to savepoint readiness_guards;

select * from public.ap_create_anonymous_draft('a1000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day');
select * from public.ap_save_four_step_draft('a1000000-0000-4000-8000-000000000001',repeat('a',64),1,3,
 '{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","entryMode":"GUIDED","backgroundReviewed":true,"noPriorEmployment":true,"experienceAdditions":[]}');
do $$ declare receipt jsonb; payload jsonb; cfg public.ap_commerce_configuration;
begin
 receipt:=public.ap_prepare_intake_confirmation('a1000000-0000-4000-8000-000000000001',repeat('a',64),2,
  public.ap_intake_confirmation_source('a1000000-0000-4000-8000-000000000001',repeat('a',64),2),repeat('c',64),repeat('d',64));
 payload:='{"accessEmailNormalized":"research@example.invalid","documentContactEmail":"research@example.invalid","desiredActivities":["SUPPORTING_CUSTOMERS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v4","entryMode":"GUIDED"}'::jsonb
  ||jsonb_build_object('confirmedReview',receipt);
 select * into cfg from public.ap_commerce_configuration where singleton;
 perform public.ap_finalize_four_step_intake_with_legal_acceptance_v3('a1000000-0000-4000-8000-000000000001',repeat('a',64),2,
  'a1000000-0000-4000-8000-000000000002',payload,repeat('7',64),'a1000000-0000-4000-8000-000000000003',
  decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),
  repeat('5',64),'fixture-kms','1',repeat('6',64),'{}',cfg.terms_version,cfg.terms_content_sha256,cfg.privacy_version,cfg.privacy_content_sha256,
  cfg.legal_acceptance_copy_version,cfg.legal_acceptance_copy_sha256,cfg.legal_content_canonicalization_version,cfg.legal_receipt_schema_version,repeat('8',64));
end $$;
select pg_temp.assert_true((select count(*)=1 from public.ap_research_preparations where snapshot_id='a1000000-0000-4000-8000-000000000002'),'finalization did not durably enqueue');
select public.ap_enqueue_research_preparation(id) from public.ap_feasibility_requests where snapshot_id='a1000000-0000-4000-8000-000000000002';
select pg_temp.assert_true((select count(*)=1 from public.ap_research_preparations where snapshot_id='a1000000-0000-4000-8000-000000000002'),'replay duplicated preparation');
select pg_temp.assert_true(not exists(select 1 from public.ap_claim_research_preparation()),'disabled queue claimed work');
select pg_temp.assert_true(not public.ap_research_preparation_ready((select id from public.ap_feasibility_requests where snapshot_id='a1000000-0000-4000-8000-000000000002')),'no-plan request reached feasibility');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('a1000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000000','authenticated','authenticated','research-operator@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='operator' where id='a1000000-0000-4000-8000-000000000004';
-- Local fictional permission fixture only. Enumeration authority does not imply
-- the separate paid-display permission required by current source admission.
update public.job_sources set paid_display_permission_status='documented_paid_display_authorized' where id='vipdesk-connect';
insert into public.ap_source_authorizations(id,source_id,source_display_name,state,access_method,evidence_reference,evidence_sha256,
 allowed_hosts,allowed_actions,rate_and_result_bounds,verified_by_role,verified_at,authorization_version,content_sha256)
values('a1000000-0000-4000-8000-000000000005','vipdesk-connect','Fictional authorization only','AUTHORIZED_AUTOMATED','AUTOMATED',
 'fixture://research100',repeat('1',64),array['api.lever.co','jobs.lever.co'],array['ENUMERATE_JOBS'],
 '{"resultBound":10,"pageBound":2,"requestBound":2,"responseByteBound":100000,"durationMsBound":10000,"hostConcurrencyBound":1,"quotaUnitBound":0}',
 'fixture',now(),'research100-fixture',repeat('2',64));
select public.ap_set_source_authorization_head('vipdesk-connect','a1000000-0000-4000-8000-000000000005',0,'a1000000-0000-4000-8000-000000000004');
insert into public.job_source_schedules(id,source_id,source_authorization_id,authorization_head_revision,scope_sha256,schedule_tier,cadence_seconds,
 result_bound,page_bound,request_bound,response_byte_bound,duration_ms_bound,enabled,next_run_at)
values('a1000000-0000-4000-8000-000000000006','vipdesk-connect','a1000000-0000-4000-8000-000000000005',1,repeat('3',64),'A',14400,10,2,2,100000,10000,false,now());
select public.ap_set_job_source_schedule_state('a1000000-0000-4000-8000-000000000006',true,1,'RESUME_AFTER_REVIEW','a1000000-0000-4000-8000-000000000004');
insert into public.ap_feasibility_source_configurations(id,source_authorization_id,config_version,pagination_bound,lookback_bound,result_bound,
 release_verification_ttl,parser_version,cutoff_version,content_sha256,approved_by_role,approved_at)
values('a1000000-0000-4000-8000-000000000007','a1000000-0000-4000-8000-000000000005','research100-fixture',2,interval '1 day',10,
 interval '1 hour','listing-requirements-v6','fixture',repeat('4',64),'operator',now());
select public.ap_configure_research_preparation('a1000000-0000-4000-8000-000000000004',1,true,array['a1000000-0000-4000-8000-000000000007']::uuid[]);
savepoint retention_queue_order;
-- Fictional old metadata shells exercise the real retention guards. They are
-- deliberately older than the live request and exceed the bounded scan of50.
do $$ declare i integer; draft uuid; snapshot uuid; owner uuid; pending_claim uuid:=gen_random_uuid();
 completed_claim uuid:=gen_random_uuid(); source public.ap_intake_snapshots; copied public.ap_intake_snapshots; claimed public.ap_research_preparations;
begin
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000000','authenticated','authenticated',
   'retention-research-'||n||'@example.invalid','',now(),'{}','{}',now(),now() from generate_series(90,91)n;
 select * into source from public.ap_intake_snapshots where id='a1000000-0000-4000-8000-000000000002';
 for i in 1..51 loop
  draft:=gen_random_uuid(); snapshot:=gen_random_uuid();
  owner:=case when i<=26 then 'a1000000-0000-4000-8000-000000000090'::uuid else 'a1000000-0000-4000-8000-000000000091'::uuid end;
  perform public.ap_create_anonymous_draft(draft,md5('retention-queue:'||i)||md5('retention-queue-secret:'||i),now()+interval '1 day');
  copied:=jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(source)||jsonb_build_object(
   'id',snapshot,'draft_id',draft,'customer_id',owner,'sensitive_payload_id',null));
  insert into public.ap_intake_snapshots select copied.*;
  insert into public.ap_feasibility_requests(draft_id,snapshot_id,request_version,idempotency_key)
   values(draft,snapshot,'fictional-retention-queue',draft::text);
  update public.ap_anonymous_drafts set finalized_snapshot_id=snapshot where id=draft;
  update public.ap_research_preparations set next_check_at=clock_timestamp()-interval '1 day' where snapshot_id=snapshot;
 end loop;
 insert into public.ap_service_retention_claims(id,customer_id,order_ids,state,completed_at)
 values(completed_claim,'a1000000-0000-4000-8000-000000000090',array[gen_random_uuid()],'COMPLETE',clock_timestamp()),
   (pending_claim,'a1000000-0000-4000-8000-000000000091',array[gen_random_uuid()],'PENDING',null);
 insert into public.ap_retention_row_receipts(table_name,row_id,claim_id,before_sha256,after_sha256)
 select 'ap_research_preparations',id::text,completed_claim,repeat('b',64),repeat('b',64)
 from public.ap_research_preparations where customer_id='a1000000-0000-4000-8000-000000000090';
 select * into claimed from public.ap_claim_research_preparation();
 perform pg_temp.assert_true(claimed.snapshot_id='a1000000-0000-4000-8000-000000000002','retention shells starved later valid preparation');
 perform pg_temp.assert_true(not exists(select 1 from public.ap_research_preparations where customer_id in(
   'a1000000-0000-4000-8000-000000000090','a1000000-0000-4000-8000-000000000091')
   and (state<>'QUEUED' or lease_token is not null or preparation_attempts<>0)),'retention-blocked metadata was mutated');
 perform pg_temp.assert_true(public.ap_lock_research_preparation((select id from public.ap_research_preparations where customer_id='a1000000-0000-4000-8000-000000000090' limit 1),true) is null,'purged row remained claimable after selection');
 perform pg_temp.assert_true(public.ap_lock_research_preparation((select id from public.ap_research_preparations where customer_id='a1000000-0000-4000-8000-000000000091' limit 1),true) is null,'pending purge remained claimable after selection');
end $$;
rollback to savepoint retention_queue_order;
create temp table claim as select * from public.ap_claim_research_preparation();
select pg_temp.assert_true((select count(*)=1 from claim),'enabled confirmed request not claimable');
select pg_temp.assert_true(not exists(select 1 from public.ap_claim_research_preparation()),'second claim reused live lease');
create temp table automatic_research_prior_invitations as
 select id,to_jsonb(i) as value from public.ap_search_checkout_invitations i;
do $$ declare c public.ap_research_preparations; family jsonb; plan uuid;
 prior_reviews jsonb; prior_verifications jsonb; begin
 select * into c from claim;
 -- Planning must preserve all existing human evidence, including retained paid history.
 select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) into prior_reviews from public.ap_research_cell_reviews r;
 select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]'::jsonb) into prior_verifications from public.ap_source_verifications v;
 family:=jsonb_build_array(jsonb_build_object('id','customer-support','fingerprint',repeat('a',64),'neutral',true,'responsibilities',jsonb_build_array('Helping customers')));
 begin perform public.ap_prepare_automatic_research(c.id,gen_random_uuid(),family); raise exception 'wrong lease accepted';
 exception when others then if sqlerrm<>'research_preparation_claim_changed' then raise; end if; end;
 plan:=public.ap_prepare_automatic_research(c.id,c.lease_token,family);
 perform pg_temp.assert_true(plan is not null,'plan not created');
 perform pg_temp.assert_true((select count(*)=1 from public.ap_research_rounds where snapshot_id=c.snapshot_id),'plan duplicated');
 perform pg_temp.assert_true((select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.ap_research_cell_reviews r)=prior_reviews,'automation fabricated or changed coverage review');
 perform pg_temp.assert_true((select coalesce(jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text),'[]'::jsonb) from public.ap_source_verifications v)=prior_verifications,'automation fabricated or changed source verification');
end $$;
truncate claim;
insert into claim select * from public.ap_claim_research_preparation();
select public.ap_enqueue_due_job_source_syncs(1);
create temp table source_claim as select * from public.ap_claim_job_source_syncs('research100-fixture',1);
insert into public.job_source_runs(id,source_id,status,completed_at,schedule_id,source_authorization_id,authorization_head_revision,scope_sha256,
 trigger_kind,adapter_version,enumeration_status,response_classification,projection_status,fetched_count,pages_completed,
 scheduled_job_id,schedule_generation,attempt_number,closure_minimum_complete_misses,closure_visibility_window_seconds)
select 'a1000000-0000-4000-8000-000000000008','vipdesk-connect','succeeded',clock_timestamp(),'a1000000-0000-4000-8000-000000000006',
 'a1000000-0000-4000-8000-000000000005',1,repeat('3',64),'scheduled','lever-v2','complete','success','observation_only',0,1,
 id,source_generation,attempts,2,86400 from source_claim;
do $$ declare c public.ap_research_preparations; binding uuid; begin
 select * into c from claim;
 select id into binding from public.ap_research_preparation_sources where preparation_id=c.id;
 begin perform public.ap_bind_prepared_research_run(c.id,c.lease_token,binding,gen_random_uuid()); raise exception 'missing run accepted';
 exception when others then if sqlerrm<>'research_preparation_run_unavailable' then raise; end if; end;
 perform public.ap_bind_prepared_research_run(c.id,c.lease_token,binding,'a1000000-0000-4000-8000-000000000008');
 perform pg_temp.assert_true(public.ap_finish_research_preparation_check(c.id,c.lease_token)='OWNER_REVIEW','empty complete run skipped owner');
 perform pg_temp.assert_true(not public.ap_research_preparation_ready(c.request_id),'unreviewed empty coverage ready');
 begin perform public.ap_complete_prepared_research_review(c.id,gen_random_uuid(),'Fictional complete source scope review.'); raise exception 'nonreviewer accepted';
 exception when others then if sqlerrm<>'research_preparation_coverage_not_reviewable' then raise; end if; end;
 perform pg_temp.assert_true(public.ap_complete_prepared_research_review(c.id,'a1000000-0000-4000-8000-000000000004','Reviewed the complete fictional empty source run; no matching jobs were observed.'),'coverage not recorded');
 perform pg_temp.assert_true(public.ap_research_preparation_ready(c.request_id),'reviewed empty coverage never ready for honest shortage');
 perform pg_temp.assert_true(not exists(select 1 from public.ap_search_checkout_invitations where snapshot_id=c.snapshot_id),'research created checkout invitation');
 perform pg_temp.assert_true(
  (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) from public.ap_search_checkout_invitations i)
  =(select coalesce(jsonb_agg(value order by id),'[]'::jsonb) from automatic_research_prior_invitations),
  'research created or changed checkout invitation');
end $$;
savepoint existing_collision_path;
insert into public.ap_feasibility_coverage_plans(snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,constraint_proof,content_sha256,created_at)
select snapshot_id,inventory_version_id,'fictional-existing-collision',typed_inputs,'NOT_REQUIRED_CONSTRAINT_COLLISION',
 jsonb_build_object('kind','TYPED_CONTRADICTION','inputHash',repeat('c',64),'version','existing-contract'),repeat('b',64),clock_timestamp()
from public.ap_feasibility_coverage_plans where snapshot_id='a1000000-0000-4000-8000-000000000002' order by created_at desc limit 1;
select pg_temp.assert_true(public.ap_research_preparation_ready((select id from public.ap_feasibility_requests where snapshot_id='a1000000-0000-4000-8000-000000000002')),'existing typed collision path incorrectly required source cells');
insert into public.ap_feasibility_coverage_plans(snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,constraint_proof,content_sha256,created_at)
select snapshot_id,inventory_version_id,'fictional-malformed-collision',typed_inputs,'NOT_REQUIRED_CONSTRAINT_COLLISION',
 jsonb_build_object('kind','TYPED_CONTRADICTION','inputHash','unverified','version','existing-contract'),repeat('d',64),clock_timestamp()
from public.ap_feasibility_coverage_plans where snapshot_id='a1000000-0000-4000-8000-000000000002' order by created_at desc limit 1;
select pg_temp.assert_true(not public.ap_research_preparation_ready((select id from public.ap_feasibility_requests where snapshot_id='a1000000-0000-4000-8000-000000000002')),'malformed collision proof reached feasibility');
rollback to savepoint existing_collision_path;
select pg_temp.assert_true(public.ap_archive_snapshot_schema_supported('202610250100'),'registered100 archive schema rejected');
select pg_temp.assert_true(public.ap_archive_snapshot_schema_supported('202610250098'),'registered historical archive schema rejected');
select pg_temp.assert_true(not public.ap_archive_snapshot_schema_supported('202610250199'),'unreviewed future archive schema accepted');
select pg_temp.assert_true(not public.ap_archive_snapshot_schema_supported(null),'null archive schema accepted');
select pg_temp.assert_true(not has_function_privilege('service_role','public.ap_archive_snapshot_schema_supported(text)','execute'),'internal archive helper executable');
savepoint stale_confirmed_draft;
update public.ap_anonymous_drafts set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' where id='a1000000-0000-4000-8000-000000000001';
do $$ begin
 begin perform public.ap_begin_research_round('a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000004',repeat('a',64),'[]','{}',1);
  raise exception 'stale draft created another plan'; exception when others then if sqlerrm<>'research_snapshot_stale' then raise; end if; end;
 begin perform public.ap_issue_search_checkout_invitation(gen_random_uuid(),'a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002',gen_random_uuid(),repeat('a',64),clock_timestamp()+interval '10 minutes','a1000000-0000-4000-8000-000000000004','Fictional stale invitation must not proceed.');
  raise exception 'stale draft reached invitation authorizer'; exception when others then if sqlerrm<>'research_snapshot_stale' then raise; end if; end;
end $$;
rollback to savepoint stale_confirmed_draft;
select pg_temp.assert_true(not has_function_privilege('service_role','public.ap_assert_research_snapshot_current(uuid)','execute'),'internal currentness helper executable');
rollback;
select 'AUTOMATIC_RESEARCH_PREPARATION_OK';

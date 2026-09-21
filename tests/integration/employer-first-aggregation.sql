begin;

create function pg_temp.assert_true(value boolean, failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%', failure_message; end if; end $$;

select pg_temp.assert_true(
  not exists(select 1 from public.job_source_schedules),
  'aggregation migration activated a source schedule'
);
select pg_temp.assert_true(
  not has_function_privilege('authenticated','public.ap_enqueue_job_source_sync(uuid,text)','execute')
  and not has_function_privilege('authenticated','public.ap_set_job_source_schedule_state(uuid,boolean,bigint,text,uuid)','execute'),
  'source operations leaked to authenticated users'
);
select pg_temp.assert_true(
  not has_table_privilege('service_role','public.ap_source_authorization_heads','INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role','public.job_source_schedules','INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role','public.job_source_discovery_snapshots','INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege('service_role','public.job_source_candidates','INSERT,UPDATE,DELETE,TRUNCATE')
  and has_table_privilege('service_role','public.job_source_run_listings','INSERT')
  and not has_table_privilege('service_role','public.job_source_run_listings','UPDATE,DELETE,TRUNCATE'),
  'source authority and immutable evidence permit unfenced service writes'
);

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('17000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','source-operator@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='operator' where id='17000000-0000-4000-8000-000000000001';

insert into public.ap_source_authorizations(
  id,source_id,source_display_name,state,access_method,evidence_reference,evidence_sha256,
  allowed_hosts,allowed_actions,rate_and_result_bounds,verified_by_role,verified_at,
  authorization_version,content_sha256
) values (
  '27000000-0000-4000-8000-000000000001','vipdesk-connect','VIPdesk Connect','AUTHORIZED_AUTOMATED','AUTOMATED',
  'fixture://employer-permission',repeat('1',64),array['api.lever.co'],array['ENUMERATE_JOBS'],
  '{"resultBound":100,"pageBound":2,"requestBound":2,"responseByteBound":100000,"durationMsBound":10000,"hostConcurrencyBound":1,"quotaUnitBound":0}',
  'integration-test',now(),'employer-source-test-v1',repeat('2',64)
);
select pg_temp.assert_true(
  public.ap_set_source_authorization_head('vipdesk-connect','27000000-0000-4000-8000-000000000001',0,'17000000-0000-4000-8000-000000000001')=1,
  'authorization head was not created'
);

insert into public.job_source_schedules(
  id,source_id,source_authorization_id,authorization_head_revision,scope_sha256,schedule_tier,
  cadence_seconds,jitter_seconds,result_bound,page_bound,request_bound,response_byte_bound,
  duration_ms_bound,host_concurrency_bound,minimum_complete_misses,visibility_window_seconds,
  enabled,next_run_at
) values (
  '37000000-0000-4000-8000-000000000001','vipdesk-connect','27000000-0000-4000-8000-000000000001',1,
  repeat('3',64),'A',14400,300,100,2,2,100000,10000,1,2,86400,false,now()
);

select pg_temp.assert_true(
  public.ap_set_job_source_schedule_state(
    '37000000-0000-4000-8000-000000000001',true,1,'RESUME_AFTER_REVIEW','17000000-0000-4000-8000-000000000001'
  )=2,
  'authorized schedule did not resume'
);

create temp table queued_source_job(job_id uuid) on commit drop;
insert into queued_source_job select public.ap_enqueue_job_source_sync('37000000-0000-4000-8000-000000000001','fixture-run-1');
select pg_temp.assert_true(
  (select job_id from queued_source_job)=public.ap_enqueue_job_source_sync('37000000-0000-4000-8000-000000000001','fixture-run-1'),
  'admin enqueue was not idempotent'
);

create temp table claimed_source_job on commit drop as
  select * from public.ap_claim_job_source_syncs('source-worker-a',1);
select pg_temp.assert_true(
  (select count(*)=1 and bool_and(worker_pool='JOB_SOURCE' and state='LEASED' and lease_epoch=1) from claimed_source_job),
  'source job was not isolated and fenced'
);

do $$ declare fixture_job record; begin
  select * into fixture_job from claimed_source_job;
  begin
    perform public.ap_renew_job_source_sync_lease(fixture_job.id,'stale-worker',fixture_job.lease_epoch);
    raise exception 'stale_worker_renewed_lease';
  exception when raise_exception then
    if sqlerrm='stale_worker_renewed_lease' then raise; end if;
  end;
end $$;

insert into public.job_source_runs(
  id,source_id,status,completed_at,schedule_id,scheduled_job_id,source_authorization_id,
  authorization_head_revision,schedule_generation,scope_sha256,attempt_number,trigger_kind,
  adapter_version,enumeration_status,response_classification,projection_status,
  closure_minimum_complete_misses,closure_visibility_window_seconds
) select
  '47000000-0000-4000-8000-000000000001','vipdesk-connect','succeeded',now(),
  '37000000-0000-4000-8000-000000000001',id,'27000000-0000-4000-8000-000000000001',
  1,source_generation,repeat('3',64),attempts,'scheduled','lever-v2','complete','success','observation_only',2,86400
from claimed_source_job;

select pg_temp.assert_true(
  (public.ap_finalize_job_source_run(
    '47000000-0000-4000-8000-000000000001','source-worker-a',(select lease_epoch from claimed_source_job)
  )->>'reason')='OBSERVATION_ONLY_NOT_PROJECTED',
  'observation-only run did not stop before canonical closure'
);
select pg_temp.assert_true(
  (select closure_reconciled_at is not null from public.job_source_runs where id='47000000-0000-4000-8000-000000000001'),
  'observation-only generation was not reconciled'
);

do $$ declare fixture_job record; begin
  select * into fixture_job from claimed_source_job;
  begin
    perform public.ap_finalize_job_source_run('47000000-0000-4000-8000-000000000001','source-worker-a',fixture_job.lease_epoch);
    raise exception 'closure_replay_was_accepted';
  exception when raise_exception then
    if sqlerrm='closure_replay_was_accepted' then raise; end if;
  end;
  perform public.ap_complete_job_source_sync(fixture_job.id,'source-worker-a',fixture_job.lease_epoch);
end $$;

select pg_temp.assert_true(
  public.ap_set_job_source_schedule_state(
    '37000000-0000-4000-8000-000000000001',false,2,'MANUAL_PAUSE','17000000-0000-4000-8000-000000000001'
  )=3,
  'schedule pause did not advance state revision'
);
do $$ begin
  begin
    perform public.ap_set_job_source_schedule_state(
      '37000000-0000-4000-8000-000000000001',true,2,'RESUME_AFTER_REVIEW','17000000-0000-4000-8000-000000000001'
    );
    raise exception 'stale_schedule_revision_was_accepted';
  exception when raise_exception then
    if sqlerrm='stale_schedule_revision_was_accepted' then raise; end if;
  end;
end $$;

-- Projection uses a separate open run: observation evidence cannot be added to
-- the terminal run above. It remains observation-only after hidden promotion.
insert into public.job_source_runs(
  id,source_id,status,schedule_id,scheduled_job_id,source_authorization_id,
  authorization_head_revision,schedule_generation,scope_sha256,attempt_number,trigger_kind,
  projection_status,closure_minimum_complete_misses,closure_visibility_window_seconds
) select '47000000-0000-4000-8000-000000000002',source_id,'started',schedule_id,
  scheduled_job_id,source_authorization_id,authorization_head_revision,schedule_generation,
  scope_sha256,attempt_number+1,'canary','observation_only',2,86400
from public.job_source_runs where id='47000000-0000-4000-8000-000000000001';

insert into public.job_source_run_listings(run_id,listing_key,captured_listing,content_sha256,observed_at)
values ('47000000-0000-4000-8000-000000000002','projection-a',
  '{"title":"Projection fixture","externalJobId":"projection-a","sourceJobUrl":"https://api.lever.co/postings/vipdesk?job=a&utm_source=fixture"}',repeat('a',64),now()),
 ('47000000-0000-4000-8000-000000000002','projection-conflict',
  '{"title":"Projection fixture","externalJobId":"projection-a","sourceJobUrl":"https://api.lever.co/postings/vipdesk?job=b"}',repeat('a',64),now());
update public.job_source_runs set status='succeeded',enumeration_status='complete',
  completed_at=now(),fetched_count=2,parsed_count=2
where id='47000000-0000-4000-8000-000000000002';

do $$
declare payload jsonb; first_job uuid; replay_job uuid; conflicting_job uuid;
  fixture_run_id constant uuid:='47000000-0000-4000-8000-000000000002';
begin
  payload:=jsonb_build_object(
    'source_id','vipdesk-connect','canonical_employer_id',(select canonical_employer_id from public.job_sources where id='vipdesk-connect'),
    'company','VIPdesk Connect','employer_display_name','VIPdesk Connect','employer_aliases','[]'::jsonb,
    'title','Projection fixture','raw_title','Projection fixture','normalized_title','projection fixture',
    'source_name','VIPdesk Connect','source_category','core_direct_employer',
    'source_url','https://api.lever.co/postings/vipdesk?job=a',
    'source_job_url','https://api.lever.co/postings/vipdesk?job=a',
    'normalized_source_url','https://api.lever.co/postings/vipdesk?job=a',
    'official_application_url','https://api.lever.co/postings/vipdesk?job=a',
    'external_job_id','projection-a','content_hash',repeat('a',64),'deduplication_key',repeat('b',64),
    'is_official_source',true,'is_direct_employer_source',true,
    'employment_type','w2_full_time','w2_or_contractor','w2','work_mode','remote_us_state_limited',
    'eligible_states',jsonb_build_array('FL'),'eligible_countries',jsonb_build_array('US'),
    'timezone_requirement','America/New_York','pay_model','commission','phone_intensity','high',
    'sales_flag',true,'commission_flag',true,'marketing_flag',false,'high_volume_contact_center_flag',true,
    'experience_level','unknown','equipment_cost_responsibility','unknown','benefits_status','unknown',
    'closing_at','2026-10-01T00:00:00Z');

  -- Functional query identifiers must not be discarded like tracking parameters.
  begin
    perform public.ap_project_source_observation(fixture_run_id,'projection-a',repeat('a',64),'pending-source-projection-v1',
      payload||'{"source_job_url":"https://api.lever.co/postings/vipdesk?job=other","normalized_source_url":"https://api.lever.co/postings/vipdesk?job=other"}');
    raise exception 'projection_query_mismatch_accepted';
  exception when raise_exception then
    if sqlerrm<>'source_projection_identity_invalid' then raise; end if;
  end;
  begin
    perform public.ap_project_source_observation(fixture_run_id,'projection-a',repeat('a',64),'pending-source-projection-v1',
      payload||'{"external_job_id":"wrong-id"}');
    raise exception 'projection_external_id_mismatch_accepted';
  exception when raise_exception then
    if sqlerrm<>'source_projection_identity_invalid' then raise; end if;
  end;
  begin
    perform public.ap_project_source_observation(fixture_run_id,'projection-a',repeat('a',64),'pending-source-projection-v1',
      payload||'{"normalized_source_url":"https://api.lever.co/postings/vipdesk?job=other"}');
    raise exception 'projection_normalized_identity_mismatch_accepted';
  exception when raise_exception then
    if sqlerrm<>'source_projection_identity_invalid' then raise; end if;
  end;
  perform pg_temp.assert_true(not exists(select 1 from public.job_source_listing_projections where job_source_listing_projections.run_id=fixture_run_id),
    'rejected projection wrote evidence');

  first_job:=public.ap_project_source_observation(fixture_run_id,'projection-a',repeat('a',64),'pending-source-projection-v1',payload);
  replay_job:=public.ap_project_source_observation(fixture_run_id,'projection-a',repeat('a',64),'pending-source-projection-v1',payload);
  perform pg_temp.assert_true(first_job=replay_job,'projection replay changed canonical identity');
  perform pg_temp.assert_true((select count(*)=1 from public.job_source_listing_projections p where p.run_id=fixture_run_id),
    'projection replay duplicated ledger');
  perform pg_temp.assert_true((select not is_active and listing_status='inactive' and source_freshness_status='unknown'
    and application_path_status='unverified' and last_verified_at is null and last_successfully_verified_at is null
    from public.jobs where id=first_job),'pending job became verified or visible');
  perform pg_temp.assert_true((select eligible_states=array['FL'] and eligible_countries=array['US']
    and timezone_requirement='America/New_York' and closing_at='2026-10-01T00:00:00Z'::timestamptz
    and sales_flag and commission_flag and phone_intensity='high' and high_volume_contact_center_flag
    from public.jobs where id=first_job),'projection discarded geographic, closing, commission or phone facts');
  perform pg_temp.assert_true(not exists(select 1 from public.ap_job_snapshots where legacy_job_id=first_job),
    'pending projection fabricated verified snapshot');

  insert into public.jobs(company,title,source_url,checked_at,listing_status,canonical_employer_id,
    external_job_id,normalized_source_url,is_active)
  values('VIPdesk Connect','Conflicting fixture','https://api.lever.co/postings/vipdesk?job=b',now(),'inactive',
    payload->>'canonical_employer_id','projection-b','https://api.lever.co/postings/vipdesk?job=b',false)
  returning id into conflicting_job;
  begin
    perform public.ap_project_source_observation(fixture_run_id,'projection-conflict',repeat('a',64),'pending-source-projection-v1',
      payload||'{"source_job_url":"https://api.lever.co/postings/vipdesk?job=b","normalized_source_url":"https://api.lever.co/postings/vipdesk?job=b"}');
    raise exception 'projection_split_identity_accepted';
  exception when raise_exception then
    if sqlerrm<>'source_projection_identity_conflict_review_required' then raise; end if;
  end;
  perform pg_temp.assert_true((select count(*)=1 from public.job_source_listing_projections p where p.run_id=fixture_run_id),
    'conflicting identity wrote a projection');
end $$;

select pg_temp.assert_true(
  not has_table_privilege('authenticated','public.job_source_listing_projections','INSERT')
  and not has_table_privilege('anon','public.job_source_listing_projections','INSERT')
  and not has_table_privilege('service_role','public.job_source_listing_projections','INSERT,UPDATE,DELETE,TRUNCATE')
  and not has_function_privilege('authenticated','public.ap_project_source_observation(uuid,text,text,text,jsonb)','EXECUTE'),
  'projection ledger permits direct writes or customer RPC execution'
);


-- Readiness follows current authority, complete runs and fresh verification.
select pg_temp.assert_true(
  not has_function_privilege('authenticated','public.ap_current_source_readiness()','EXECUTE')
  and not has_function_privilege('anon','public.ap_current_source_readiness()','EXECUTE'),
  'source readiness RPC exposed to customers'
);
select pg_temp.assert_true(public.ap_current_source_readiness()='{"jobSourcesRegistered":false,"authorizedSourceInventory":false}'::jsonb,
  'paused source became ready');
update public.job_sources set paid_display_permission_status='documented_paid_display_authorized',schedule_enabled=false
where id='vipdesk-connect';
select public.ap_set_job_source_schedule_state('37000000-0000-4000-8000-000000000001',true,3,'RESUME_AFTER_REVIEW','17000000-0000-4000-8000-000000000001');
select pg_temp.assert_true(public.ap_current_source_readiness()='{"jobSourcesRegistered":true,"authorizedSourceInventory":false}'::jsonb,
  'current complete collection did not register or hidden projection became ready');
update public.jobs set is_active=true,listing_status='open',source_freshness_status='fresh',
  application_path_status='verified_actionable',last_successfully_verified_at=now(),closing_at=now()+interval '1 day'
where id=(select job_id from public.job_source_listing_projections where listing_key='projection-a');
select pg_temp.assert_true((public.ap_current_source_readiness()->>'authorizedSourceInventory')::boolean,
  'current authorized verified inventory was not ready');
update public.jobs set last_successfully_verified_at=now()+interval '1 hour'
where id=(select job_id from public.job_source_listing_projections where listing_key='projection-a');
select pg_temp.assert_true(not (public.ap_current_source_readiness()->>'authorizedSourceInventory')::boolean,
  'future verification manufactured readiness');
update public.job_source_schedules set authorization_head_revision=99 where source_id='vipdesk-connect';
select pg_temp.assert_true(public.ap_current_source_readiness()='{"jobSourcesRegistered":false,"authorizedSourceInventory":false}'::jsonb,
  'superseded schedule authority stayed ready');
-- Restore fixture authority for later transaction-scoped service scenarios.
update public.job_source_schedules set authorization_head_revision=1 where source_id='vipdesk-connect';
update public.jobs set is_active=false,listing_status='inactive',last_successfully_verified_at=null,
  application_path_status='unverified',source_freshness_status='unknown'
where id=(select job_id from public.job_source_listing_projections where listing_key='projection-a');

-- Transaction-only direct-review bridge: no provider or production proof.
select * from public.ap_create_anonymous_draft('33000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day');
insert into public.ap_intake_snapshots(id,draft_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at)
values('53000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001',1,'INITIAL','worker@example.invalid',null,'worker@example.invalid','[]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',null,null,false,null,null,'EXCLUDE','EXCLUDE','EXCLUDE','EXCLUDE','{}','NEITHER','{}',repeat('5',64),'applypack-c14n-v1','applypack-intake-v3',now());
update public.ap_anonymous_drafts set finalized_snapshot_id='53000000-0000-4000-8000-000000000001',state='COMPLETE' where id='33000000-0000-4000-8000-000000000001';
insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
values('72000000-0000-4000-8000-000000000003',now(),'source-auth-v1','responsibility-retrieval-v1','requirement-engine-v1',repeat('7',64));
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
values('73000000-0000-4000-8000-000000000013','53000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000003','feasibility-v1','{"requiredFamilyIds":["family-1"]}','REQUIRED',repeat('8',64));
insert into public.job_source_runs(id,source_id,status,schedule_id,scheduled_job_id,source_authorization_id,authorization_head_revision,schedule_generation,scope_sha256,attempt_number,trigger_kind,projection_status,closure_minimum_complete_misses,closure_visibility_window_seconds)
select '47000000-0000-4000-8000-000000000003',source_id,'started',schedule_id,scheduled_job_id,source_authorization_id,authorization_head_revision,schedule_generation,scope_sha256,attempt_number+2,'canary','observation_only',2,86400
from public.job_source_runs where id='47000000-0000-4000-8000-000000000001';
insert into public.job_source_run_listings(run_id,listing_key,captured_listing,content_sha256,observed_at)
values('47000000-0000-4000-8000-000000000003','bridge',
'{"title":"Projection fixture","externalJobId":"bridge","sourceJobUrl":"https://api.lever.co/postings/vipdesk?job=bridge","description":"Responsibilities: coordinate service recovery."}',repeat('c',64),now());
update public.job_source_runs set status='succeeded',enumeration_status='complete',completed_at=now(),fetched_count=1,parsed_count=1 where id='47000000-0000-4000-8000-000000000003';
do $$
#variable_conflict use_variable
declare payload jsonb; job_id uuid; projection_id uuid; member_id uuid; replay_id uuid; review jsonb; snap jsonb; nodes jsonb;
actor constant uuid:='17000000-0000-4000-8000-000000000001'; criteria constant uuid:='53000000-0000-4000-8000-000000000001'; inventory constant uuid:='72000000-0000-4000-8000-000000000003';
body constant text:='Responsibilities: coordinate service recovery.';
begin
select to_jsonb(j)||jsonb_build_object('external_job_id','bridge','content_hash',repeat('c',64),'deduplication_key',repeat('d',64),'description',body,
'source_job_url','https://api.lever.co/postings/vipdesk?job=bridge','source_url','https://api.lever.co/postings/vipdesk?job=bridge','normalized_source_url','https://api.lever.co/postings/vipdesk?job=bridge','official_application_url','https://api.lever.co/postings/vipdesk?job=bridge') into payload
from public.jobs j where j.id=(select p.job_id from public.job_source_listing_projections p where listing_key='projection-a');
job_id:=public.ap_project_source_observation('47000000-0000-4000-8000-000000000003','bridge',repeat('c',64),'pending-source-projection-v1',payload);
select p.id into projection_id from public.job_source_listing_projections p where p.job_id=job_id;
review:=jsonb_build_object('method','HUMAN_DIRECT_OFFICIAL_REVIEW','checkedAt',clock_timestamp(),'officialListingUrl',payload->>'source_job_url','officialApplicationUrl',payload->>'official_application_url','capturedText',body,'captureSha256',encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),'evidenceNotes','Synthetic fixture direct official review evidence only.','employerIdentityConfirmed',true,'applicationPathConfirmed',true,'listingActiveConfirmed',true,'legitimacyConfirmed',true);
snap:=jsonb_build_object('id','84000000-0000-4000-8000-000000000001','legacy_job_id',job_id,'origin','APPLYPACK_FOUND','discovery_source','vipdesk-connect','external_job_id','bridge','canonical_application_url',payload->>'official_application_url','application_host_type','EMPLOYER_HOSTED','source_url',payload->>'source_job_url','canonical_employer_listing_url',payload->>'source_job_url','company',payload->>'company','exact_title',payload->>'raw_title','normalized_fingerprint',repeat('c',64),'captured_listing',jsonb_build_object('text',body),'posted_date_unknown',true,'location_and_work_mode','{}'::jsonb,'parser_version','fixture-v1','content_sha256',repeat('e',64),'canonical_employer_domain','api.lever.co','requirement_completeness',100,'compensation_completeness',0,'canonicalization_version','fixture-v1','legacy_compatibility',false);
nodes:=jsonb_build_array(jsonb_build_object('id','85000000-0000-4000-8000-000000000001','position',0,'node_kind','CRITERION','criterion_type','RESPONSIBILITY','stable_criterion_id','86000000-0000-4000-8000-000000000001','semantic_key','coordinate service recovery','requirement_strength','REQUIRED','source_locator','line:1','parser_certainty',1,'criterion_version','fixture-v1','typed_value','{}'::jsonb,'source_excerpt',body,'classification_method','deterministic','human_correction_history','[]'::jsonb));
begin
perform public.ap_promote_verified_source_inventory(projection_id,actor,'53000000-0000-4000-8000-000000000099',inventory,review,'bridge-stable',snap,nodes);
raise exception 'wrong_customer_snapshot_accepted';
exception when raise_exception then if sqlerrm<>'source_promotion_coverage_snapshot_mismatch' then raise; end if; end;
begin
perform public.ap_promote_verified_source_inventory(projection_id,actor,criteria,inventory,review||jsonb_build_object('checkedAt',now()-interval '1 hour'),'bridge-stable',snap,nodes);
raise exception 'stale_review_accepted';
exception when raise_exception then if sqlerrm<>'source_promotion_direct_evidence_required' then raise; end if; end;
begin
update public.jobs set content_hash=repeat('f',64) where id=job_id;
perform public.ap_promote_verified_source_inventory(projection_id,actor,criteria,inventory,review,'bridge-stable',snap,nodes);
raise exception 'changed_source_accepted';
exception when raise_exception then if sqlerrm<>'source_promotion_authority_or_content_changed' then raise; end if; end;
begin
update public.ap_source_authorization_heads set revision=revision+1 where source_id='vipdesk-connect';
perform public.ap_promote_verified_source_inventory(projection_id,actor,criteria,inventory,review,'bridge-stable',snap,nodes);
raise exception 'changed_authority_accepted';
exception when raise_exception then if sqlerrm<>'source_promotion_authority_or_content_changed' then raise; end if; end;
begin
insert into public.job_source_references(job_id,source_id,source_name,source_job_url,normalized_source_url,official_application_url,external_job_id,is_official,is_direct_employer,last_verified_at,is_active)
values(job_id,'vipdesk-connect','VIPdesk Connect',payload->>'source_job_url',payload->>'normalized_source_url',payload->>'official_application_url','bridge',true,true,now(),false);
perform public.ap_promote_verified_source_inventory(projection_id,actor,criteria,inventory,review,'bridge-stable',snap,nodes);
raise exception 'manually_inactive_reference_reopened';
exception when raise_exception then if sqlerrm<>'source_promotion_authority_or_content_changed' then raise; end if; end;
begin
insert into public.ap_intake_snapshots select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(t)||jsonb_build_object('id','53000000-0000-4000-8000-000000000002','version',2))).* from public.ap_intake_snapshots t where t.id=criteria;
perform public.ap_promote_verified_source_inventory(projection_id,actor,criteria,inventory,review,'bridge-stable',snap,nodes);
raise exception 'superseded_criteria_accepted';
exception when raise_exception then if sqlerrm<>'source_promotion_coverage_snapshot_mismatch' then raise; end if; end;
member_id:=public.ap_promote_verified_source_inventory(projection_id,actor,criteria,inventory,review,'bridge-stable',snap,nodes);
replay_id:=public.ap_promote_verified_source_inventory(projection_id,actor,criteria,inventory,review,'bridge-stable',snap,nodes);
perform pg_temp.assert_true(member_id=replay_id,'verified projection replay duplicated member');
perform pg_temp.assert_true((select count(*)=1 from public.ap_source_inventory_verifications v where v.projection_id=projection_id),'verification ledger missing or duplicated');
perform pg_temp.assert_true(exists(select 1 from public.ap_inventory_members m join public.ap_job_snapshots s on s.id=m.job_snapshot_id where m.id=member_id and s.legacy_job_id=job_id and s.employer_identity_result='PASS'),'verified snapshot not connected to inventory');
perform pg_temp.assert_true((select is_active and application_path_status='verified_actionable' and last_successfully_verified_at is not null from public.jobs where id=job_id),'verified job not persisted');
end $$;
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ap_source_inventory_verifications','INSERT') and not has_table_privilege('service_role','public.ap_source_inventory_verifications','INSERT,UPDATE,DELETE,TRUNCATE') and not has_function_privilege('authenticated','public.ap_promote_verified_source_inventory(uuid,uuid,uuid,uuid,jsonb,text,jsonb,jsonb)','EXECUTE'),'verification bridge bypasses privileged evidence path');

rollback;

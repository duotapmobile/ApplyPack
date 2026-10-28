-- Fictional SQL source evidence only; no provider, customer, or email operation.
-- Default execution is rollback-only. The explicit104 seed harness alone may
-- replace the unique final rollback footer with commit, with source/hash proof.
begin;
create or replace function pg_temp.ap105_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;

create or replace function pg_temp.ap105_paid_state() returns jsonb language plpgsql as $$
declare name text; rows jsonb; result jsonb:='{}'; contexts jsonb;
begin
 foreach name in array array['orders','payments','ap_payment_attempts','ap_refund_operations','ap_search_services',
  'ap_material_purchases','ap_material_lines','ap_material_line_revisions','ap_material_draft_jobs','ap_releases','ap_release_members',
  'ap_employer_submission_rules','ap_employer_rule_review_receipts','ap_outbox_messages','ap_capacity_allocations',
  'ap_intake_snapshots','ap_candidate_facts','ap_intake_account_claims','ap_scheduled_jobs','job_matches',
  'ap_capacity_allocation_members','ap_material_draft_versions','ap_generated_artifacts','ap_generated_file_versions',
  'ap_artifact_quality_reviews','ap_artifact_reference_permissions','ap_material_download_audits','ap_service_repair_files'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',name)
   ||case when name='ap_scheduled_jobs' then ' where worker_pool<>''JOB_SOURCE''' else '' end into rows;
  result:=result||jsonb_build_object(name,rows);
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'context',public.ap_material_draft_context_sha256(id)) order by id),'[]')
 into contexts from public.ap_material_draft_jobs;
 return result||jsonb_build_object('paidContexts',contexts);
end $$;

create or replace function pg_temp.ap105_source_graph(p_snapshot uuid) returns jsonb language sql as $$
 select jsonb_build_object('snapshot',to_jsonb(s),'verification',to_jsonb(v),'projection',to_jsonb(p),'run',to_jsonb(r),
  'nodes',(select jsonb_agg(to_jsonb(n) order by n.id) from public.ap_requirement_nodes n where n.job_snapshot_id=s.id),
  'reference',to_jsonb(reference),'job',to_jsonb(j),'scheduledJob',to_jsonb(scheduled),'schedule',to_jsonb(schedule))
 from public.ap_job_snapshots s join public.ap_source_verifications v on v.job_snapshot_id=s.id
 join public.job_source_listing_projections p on p.id=v.projection_id join public.job_source_runs r on r.id=p.run_id
 join public.job_source_references reference on reference.id=v.source_reference_id join public.jobs j on j.id=p.job_id
 join public.ap_scheduled_jobs scheduled on scheduled.id=r.scheduled_job_id join public.job_source_schedules schedule on schedule.id=r.schedule_id
 where s.id=p_snapshot;
$$;

create or replace function pg_temp.ap105_replay(bundle jsonb) returns uuid language sql as $$
 select public.ap_verify_source_observation((bundle->>'projectionId')::uuid,(bundle->>'actorId')::uuid,
  bundle->'review',bundle->>'stableJobId',bundle->'snapshot',bundle->'nodes',bundle->'normalized');
$$;

-- Every source row, permission and HTTP observation here is fictional. The
-- actual schedule claim, projection and044 verification functions stay active.
create or replace function pg_temp.ap105_create_observation(suffix text,p_snapshot_id uuid) returns jsonb language plpgsql as $$
#variable_conflict use_variable
declare actor uuid:='d1050000-0000-4000-8000-000000000001'; authority uuid:=gen_random_uuid(); schedule uuid:=gen_random_uuid();
 run_id uuid:=gen_random_uuid(); queued uuid; lease public.ap_scheduled_jobs; job_id uuid; projection_id uuid; verified uuid;
 source_id text:='fixture-source-run-105-'||suffix; employer_id text:='fixture-source-run-105-employer-'||suffix;
 employer_name text:='105 fictional source employer '||suffix; source_name text:='105 fictional source '||suffix;
 url text:='https://source-run105.example/jobs/'||suffix; worker text:='source-run-105-worker-'||suffix;
 body text:='Responsibilities: coordinate service recovery.'; observed_hash text; payload jsonb; review jsonb; snap jsonb; nodes jsonb;
begin
 insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','source-run-105-operator@example.invalid','',now(),'{}','{}',now(),now())
 on conflict(id) do nothing;
 update public.profiles set role='operator' where id=actor;
 insert into public.employers(id,display_name,source_category) values(employer_id,employer_name,'core_direct_employer');
 insert into public.job_sources(id,canonical_employer_id,source_name,source_category,official_url,adapter_kind,adapter_key,
  automation_status,is_official,is_direct_employer,is_active,paid_display_permission_status)
 values(source_id,employer_id,source_name,'core_direct_employer','https://source-run105.example','lever','fixture',
  'automated',true,true,true,'documented_paid_display_authorized');
 insert into public.ap_source_authorizations(id,source_id,source_display_name,state,access_method,evidence_reference,evidence_sha256,
  allowed_hosts,allowed_actions,rate_and_result_bounds,verified_by_role,verified_at,authorization_version,content_sha256)
 values(authority,source_id,source_name,'AUTHORIZED_AUTOMATED','AUTOMATED','fixture://verified-source-run105',repeat('1',64),
  array['source-run105.example'],array['ENUMERATE_JOBS'],
  '{"resultBound":10,"pageBound":2,"requestBound":2,"responseByteBound":100000,"durationMsBound":10000,"hostConcurrencyBound":1,"quotaUnitBound":0}',
  'integration-test',now(),'source-run105-fixture-v1',repeat('2',64));
 perform pg_temp.ap105_assert(public.ap_set_source_authorization_head(source_id,authority,0,actor)=1,'105 head creation failed');
 insert into public.job_source_schedules(id,source_id,source_authorization_id,authorization_head_revision,scope_sha256,schedule_tier,
  cadence_seconds,jitter_seconds,result_bound,page_bound,request_bound,response_byte_bound,duration_ms_bound,host_concurrency_bound,
  minimum_complete_misses,visibility_window_seconds,enabled,next_run_at)
 values(schedule,source_id,authority,1,repeat('3',64),'A',14400,300,10,2,2,100000,10000,1,2,86400,false,now());
 perform public.ap_set_job_source_schedule_state(schedule,true,1,'RESUME_AFTER_REVIEW',actor);
 queued:=public.ap_enqueue_job_source_sync(schedule,'fixture-source-run105-'||suffix);
 select * into lease from public.ap_claim_job_source_syncs(worker,1);
 perform pg_temp.ap105_assert(lease.id=queued,'105 fixture must claim only its own source job');
 insert into public.job_source_runs(id,source_id,status,schedule_id,scheduled_job_id,source_authorization_id,authorization_head_revision,
  schedule_generation,scope_sha256,attempt_number,trigger_kind,adapter_version,projection_status,closure_minimum_complete_misses,closure_visibility_window_seconds)
 values(run_id,source_id,'started',schedule,queued,authority,1,lease.source_generation,repeat('3',64),lease.attempts,'scheduled',
  'source-run105-fixture-v1','observation_only',2,86400);
 observed_hash:=encode(extensions.digest(body||suffix,'sha256'),'hex');
 insert into public.job_source_run_listings(run_id,listing_key,captured_listing,content_sha256,observed_at)
 values(run_id,'id:'||suffix,jsonb_build_object('title','105 fictional operations role','externalJobId',suffix,'sourceJobUrl',url,'description',body),observed_hash,clock_timestamp());
 update public.job_source_runs set status='succeeded',enumeration_status='complete',completed_at=clock_timestamp(),fetched_count=1,parsed_count=1
 where id=run_id;
 payload:=jsonb_build_object('source_id',source_id,'canonical_employer_id',employer_id,'company',employer_name,
  'employer_display_name',employer_name,'employer_aliases','[]'::jsonb,'title','105 fictional operations role',
  'raw_title','105 fictional operations role','normalized_title','105 fictional operations role','source_name',source_name,
  'source_category','core_direct_employer','source_url',url,'source_job_url',url,'normalized_source_url',url,'official_application_url',url,
  'external_job_id',suffix,'description',body,'content_hash',observed_hash,'deduplication_key',encode(extensions.digest(url,'sha256'),'hex'),
  'is_official_source',true,'is_direct_employer_source',true,'employment_type','w2_full_time','w2_or_contractor','w2',
  'work_mode','remote_us_state_limited','eligible_states','["VA"]'::jsonb,'eligible_countries','["US"]'::jsonb,
  'pay_model','unknown','phone_intensity','none_or_unknown','sales_flag',false,'commission_flag',false,
  'marketing_flag',false,'high_volume_contact_center_flag',false,
  'experience_level','unknown','equipment_cost_responsibility','unknown','benefits_status','unknown','closing_at',clock_timestamp()+interval '1 day');
 job_id:=public.ap_project_source_observation(run_id,'id:'||suffix,observed_hash,'pending-source-projection-v1',payload);
 select p.id into projection_id from public.job_source_listing_projections p where p.run_id=run_id and p.listing_key='id:'||suffix;
 review:=jsonb_build_object('method','HUMAN_DIRECT_OFFICIAL_REVIEW','checkedAt',clock_timestamp(),'officialListingUrl',url,
  'officialApplicationUrl',url,'capturedText',body,'captureSha256',encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),
  'evidenceNotes','Fictional SQL direct review; no real employer permission or provider capture claimed.',
  'employerIdentityConfirmed',true,'applicationPathConfirmed',true,'listingActiveConfirmed',true,'legitimacyConfirmed',true);
 snap:=jsonb_build_object('id',p_snapshot_id,'legacy_job_id',job_id,'origin','APPLYPACK_FOUND','discovery_source',source_id,
  'external_job_id',suffix,'canonical_application_url',url,'application_host_type','EMPLOYER_HOSTED','source_url',url,
  'canonical_employer_listing_url',url,'company',employer_name,'exact_title','105 fictional operations role',
  'normalized_fingerprint',observed_hash,'captured_listing',jsonb_build_object('text',body),'posted_date_unknown',true,
  'location_and_work_mode','{}'::jsonb,'parser_version','source-run105-fixture-v1','content_sha256',encode(extensions.digest(jsonb_build_object('text',body)::text,'sha256'),'hex'),
  'canonical_employer_domain','source-run105.example','requirement_completeness',100,'compensation_completeness',0,
  'canonicalization_version','source-run105-fixture-v1','legacy_compatibility',false,
  'source_run_id','d105ffff-0000-4000-8000-000000000001','source_authorization_id','d105ffff-0000-4000-8000-000000000002');
 nodes:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'position',0,'node_kind','CRITERION',
  'criterion_type','RESPONSIBILITY','stable_criterion_id',gen_random_uuid(),'semantic_key','coordinate service recovery',
  'requirement_strength','REQUIRED','source_locator','line:1','parser_certainty',1,'criterion_version','source-run105-fixture-v1',
  'typed_value','{}'::jsonb,'source_excerpt',body,'classification_method','fixture-only','human_correction_history','[]'::jsonb));
 verified:=public.ap_verify_source_observation(projection_id,actor,review,'source-run105-'||suffix,snap,nodes,payload);
 perform pg_temp.ap105_assert(verified=p_snapshot_id,'105 verification returned a different snapshot');
 perform pg_temp.ap105_assert(exists(select 1 from public.ap_current_source_verifications(verified)),'105 source has no current immutable verification');
 perform public.ap_finalize_job_source_run(run_id,worker,lease.lease_epoch);
 perform public.ap_complete_job_source_sync(queued,worker,lease.lease_epoch);
 perform public.ap_set_job_source_schedule_state(schedule,false,2,'MANUAL_PAUSE',actor);
 return jsonb_build_object('snapshotId',verified,'projectionId',projection_id,'actorId',actor,'runId',run_id,'authorizationId',authority,
  'sourceId',source_id,'review',review,'snapshot',snap,'nodes',nodes,'normalized',payload,'stableJobId','source-run105-'||suffix);
end $$;

do $$
declare seed boolean:=coalesce(current_setting('applypack.fixture_source_run_binding_seed',true)='true',false);
 legacy jsonb; prospective jsonb; before_state jsonb; graph jsonb; replayed uuid; revoked uuid:=gen_random_uuid(); current_revision bigint;
begin
 if seed then
  if (select max(version) from supabase_migrations.schema_migrations)<>'202610270104'
   or to_regprocedure('public.ap_verified_source_run_schema_installed()') is not null then
   raise exception 'verified_source_run_upgrade_exact104_required';
  end if;
  perform pg_temp.ap105_assert(to_regclass('public.verified_source_run_105_preservation_fixture') is null,'105 preservation seed already exists');
  legacy:=pg_temp.ap105_create_observation('historical','d1050004-0000-4000-8000-000000000001');
  perform pg_temp.ap105_assert((select source_run_id is null from public.ap_job_snapshots where id=(legacy->>'snapshotId')::uuid),
   'actual044 seed unexpectedly pinned a source run');
  perform pg_temp.ap105_assert((select source_authorization_id=(legacy->>'authorizationId')::uuid from public.ap_job_snapshots where id=(legacy->>'snapshotId')::uuid),
   'actual044 seed did not preserve trusted authorization');
  create table public.verified_source_run_105_preservation_fixture(kind text primary key,payload jsonb not null);
  insert into public.verified_source_run_105_preservation_fixture values('legacyRequest',legacy),
   ('legacyGraph',pg_temp.ap105_source_graph((legacy->>'snapshotId')::uuid)),('paidState',pg_temp.ap105_paid_state());
  raise notice 'VERIFIED_SOURCE_RUN_BINDING_104_SEEDED';
 else
  perform pg_temp.ap105_assert(public.ap_verified_source_run_schema_installed(),'105 schema marker or archive writer coverage is incomplete');
  perform pg_temp.ap105_assert(not has_function_privilege('authenticated','public.ap_verified_source_run_schema_installed()','EXECUTE')
   and not has_function_privilege('anon','public.ap_verified_source_run_schema_installed()','EXECUTE'),'105 marker exposed to customers');
  if to_regclass('public.verified_source_run_105_preservation_fixture') is not null then
   select payload into legacy from public.verified_source_run_105_preservation_fixture where kind='legacyRequest';
   perform pg_temp.ap105_assert(pg_temp.ap105_source_graph((legacy->>'snapshotId')::uuid)=
    (select payload from public.verified_source_run_105_preservation_fixture where kind='legacyGraph'),'105 changed old source history');
   perform pg_temp.ap105_assert(pg_temp.ap105_paid_state()=(select payload from public.verified_source_run_105_preservation_fixture where kind='paidState'),
    '105 changed paid rows, contexts, deadlines, ownership or receipts');
   replayed:=pg_temp.ap105_replay(legacy);
   perform pg_temp.ap105_assert(replayed=(legacy->>'snapshotId')::uuid and
    pg_temp.ap105_source_graph(replayed)=(select payload from public.verified_source_run_105_preservation_fixture where kind='legacyGraph'),
    '105 historical projection replay rewrote or duplicated immutable history');
   perform pg_temp.ap105_assert((select source_run_id is null from public.ap_job_snapshots where id=replayed),'105 historical replay backfilled a run');
   if jsonb_array_length((select payload->'paidContexts' from public.verified_source_run_105_preservation_fixture where kind='paidState'))>0 then
    raise notice 'VERIFIED_SOURCE_RUN_BINDING_PAID_CONTEXT_PRESERVED';
   end if;
   raise notice 'VERIFIED_SOURCE_RUN_BINDING_105_UPGRADE_PRESERVED';
  end if;
  before_state:=pg_temp.ap105_paid_state();
  prospective:=pg_temp.ap105_create_observation('prospective','d1050004-0000-4000-8000-000000000002');
  perform pg_temp.ap105_assert((select source_run_id=(prospective->>'runId')::uuid and source_authorization_id=(prospective->>'authorizationId')::uuid
   from public.ap_job_snapshots where id=(prospective->>'snapshotId')::uuid),'105 trusted source run/auth was not pinned over forged supplied IDs');
  graph:=pg_temp.ap105_source_graph((prospective->>'snapshotId')::uuid);
  replayed:=pg_temp.ap105_replay(prospective||jsonb_build_object('snapshot',(prospective->'snapshot')||
   jsonb_build_object('source_run_id',gen_random_uuid(),'source_authorization_id',gen_random_uuid())));
  perform pg_temp.ap105_assert(replayed=(prospective->>'snapshotId')::uuid and pg_temp.ap105_source_graph(replayed)=graph,
   '105 same-projection retry changed the original row or run');
  begin
   select revision into current_revision from public.ap_source_authorization_heads where source_id=prospective->>'sourceId';
   perform public.ap_set_source_authorization_head(prospective->>'sourceId',(prospective->>'authorizationId')::uuid,current_revision,(prospective->>'actorId')::uuid);
   perform pg_temp.ap105_replay(prospective);
   raise exception '105 stale head was accepted';
  exception when raise_exception then if sqlerrm<>'source_promotion_authority_or_content_changed' then raise; end if; end;
  begin
   insert into public.ap_source_authorizations(id,source_id,source_display_name,state,access_method,authorization_version,content_sha256)
   values(revoked,prospective->>'sourceId','105 fictional revoked permission','BLOCKED','NONE','source-run105-revoked',repeat('4',64));
   select revision into current_revision from public.ap_source_authorization_heads where source_id=prospective->>'sourceId';
   perform public.ap_set_source_authorization_head(prospective->>'sourceId',revoked,current_revision,(prospective->>'actorId')::uuid);
   perform pg_temp.ap105_replay(prospective);
   raise exception '105 revoked head was accepted';
  exception when raise_exception then if sqlerrm<>'source_promotion_authority_or_content_changed' then raise; end if; end;
  perform pg_temp.ap105_assert(pg_temp.ap105_source_graph((prospective->>'snapshotId')::uuid)=graph,'105 rejected authority attempts changed source evidence');
  perform pg_temp.ap105_assert(pg_temp.ap105_paid_state()=before_state,'105 prospective verification touched existing paid work');
  raise notice 'VERIFIED_SOURCE_RUN_BINDING_OK';
 end if;
end $$;
rollback;

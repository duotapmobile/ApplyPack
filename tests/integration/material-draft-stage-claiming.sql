begin;
-- Fictional database fixture; no provider, encryption or rendering success is asserted.
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$ begin if value is not true then raise exception '%',message; end if; end $$;
create function pg_temp.reject(command text,expected text) returns void language plpgsql as $$ begin begin execute command; exception when others then if sqlerrm=expected then return; end if; raise; end; raise exception 'expected rejection: %',expected; end $$;
-- Expected digests were independently computed by Node SHA256(JSON.stringify(x))
-- over UTF-8. Preserve escapes and decomposed Unicode; do not normalize wording.
select pg_temp.assert_true(encode(extensions.digest(($json$"quote\" slash\\ newline\n cafe\u0301 \u96ea"$json$::jsonb)::text,'sha256'),'hex')=
 '2f9f863562783e7a89b692e7c89ace7e087bbfade8b184591c440adbf978117c','JSON scalar string UTF-8 hash differs from renderer');
select pg_temp.assert_true(encode(extensions.digest(('true'::jsonb)::text,'sha256'),'hex')=
 'b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b','JSON boolean hash differs from renderer');
select pg_temp.assert_true(encode(extensions.digest(('12.5'::jsonb)::text,'sha256'),'hex')=
 'b902cc4550838229a710bfec4c38cbc7eb11082367a409df9135e7f007a96bda','JSON decimal hash differs from renderer');
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('15000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chunk5-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('15000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chunk5-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('15000000-0000-4000-8000-000000000003','00000000-0000-0000-8000-000000000000','authenticated','authenticated','chunk5-reviewer@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='operator' where id='15000000-0000-4000-8000-000000000003';

\ir reviewed-source-fixture.sql

insert into public.ap_intake_snapshots(
  id,customer_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,
  desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,
  blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,
  schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,
  salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,
  salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,
  targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at,confirmed_review
) values(
  '45000000-0000-4000-8000-000000000009','15000000-0000-4000-8000-000000000001',1,'INITIAL',
  'chunk5-customer@example.invalid',null,'chunk5-customer@example.invalid',
  '["COORDINATING_PROJECTS"]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,
  '["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',7000000,6000000,false,'YEAR','BASE',
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',
  repeat('4',64),'applypack-c14n-v1','applypack-intake-v4',clock_timestamp()-interval '2 days',jsonb_build_object('id',gen_random_uuid(),'contractVersion','applypack-confirmed-intake-v1','draftVersion',1,'sourceSha256',repeat('a',64),'reviewSha256',repeat('b',64),'answersSha256',repeat('c',64),'preparedAt',clock_timestamp(),'entryMode','NO_RESUME')
);

-- The current material source is a distinct immutable factual correction;
-- contact remains the exact separately confirmed original checkout receipt.
insert into public.ap_intake_snapshots
select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(s)||jsonb_build_object(
 'id','45000000-0000-4000-8000-000000000001','version',2,'snapshot_kind','MATERIAL_FACT_REVISION',
 'parent_snapshot_id',s.id))).* from public.ap_intake_snapshots s where id='45000000-0000-4000-8000-000000000009';

insert into public.jobs(
  id,company,title,source_url,location_text,salary_text,checked_at,listing_status,
  official_application_url,source_job_url,normalized_source_url,external_job_id,description,
  employment_type,w2_or_contractor,work_mode,pay_model,posted_at,last_verified_at,
  source_freshness_status,is_active,review_status,reviewed_by,reviewed_at
) values(
  '65000000-0000-4000-8000-000000000001','Chunk 5 Fixture Employer','Operations Specialist',
  'https://chunk5-employer.example/jobs/1','Remote - United States','$70,000 annually',clock_timestamp(),
  'open','https://chunk5-employer.example/apply/1','https://chunk5-employer.example/jobs/1',
  'https://chunk5-employer.example/jobs/1','CHUNK5-REQ-1',
  'Current reviewed operations role with an employer-hosted application path.',
  'w2_full_time','w2','remote_us_nationwide','salary',clock_timestamp()-interval '1 day',
  clock_timestamp()-interval '1 minute','fresh',true,'approved',
  '15000000-0000-4000-8000-000000000003',clock_timestamp()
);

create temporary table fixture_job_snapshot_input(
  id,legacy_job_id,origin,discovery_source,external_job_id,canonical_application_url,
  application_host_type,canonical_employer_listing_url,source_url,company,exact_title,
  normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,
  live_verified_at,compensation_text,compensation_source,location_and_work_mode,parser_version,
  content_sha256,source_authorization_id,first_seen_at,canonical_employer_domain,
  employer_identity_result,application_path_result,listing_activity_result,material_restrictions,
  fraud_signals,legitimacy_result,requirement_completeness,compensation_completeness,
  canonicalization_version,legacy_compatibility
) as
with current_source as (
  select id from public.ap_source_authorizations
  where source_id='manual-reviewed' and authorization_version='zz-chunk-fixture'
)
select
  '75000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001',
  'APPLYPACK_FOUND','manual-reviewed','CHUNK5-REQ-1','https://chunk5-employer.example/apply/1',
  'EMPLOYER_HOSTED','https://chunk5-employer.example/jobs/1','https://chunk5-employer.example/jobs/1',
  'Chunk 5 Fixture Employer','Operations Specialist',repeat('7',64),
  '{"description":"Current reviewed operations role"}',clock_timestamp(),current_date,false,
  clock_timestamp()-interval '1 minute','$70,000 annually','EMPLOYER_LISTING',
  '{"mode":"REMOTE","location":"United States"}','listing-requirements-v3',repeat('8',64),
  current_source.id,clock_timestamp()-interval '1 day','chunk5-employer.example',
  'PASS','PASS','PASS','{}','{}','PASS',100,100,'applypack-c14n-v1',false
from current_source;

select pg_temp.verify_fixture_snapshot(to_jsonb(template),'15000000-0000-4000-8000-000000000003')
from fixture_job_snapshot_input template;
select pg_temp.assert_true(exists(select 1 from public.ap_current_source_verifications('75000000-0000-4000-8000-000000000001')),
 'fixture manual review must create current immutable source evidence');

insert into public.ap_employer_submission_rules(
  id,job_snapshot_id,content_sha256,source_evidence_ids,resume_requirement,
  cover_letter_requirement,allowed_formats,resume_page_limit,cover_letter_page_limit,
  reference_timing,submission_channel,parser_version,injection_scan_state,
  human_confirmed_by,human_confirmed_at,checked_at
) values(
  'c5500000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001',
  repeat('4',64),array['75000000-0000-4000-8000-000000000001'::uuid],
  'REQUIRED','REQUIRED',array['PDF']::text[],1,1,'OPTIONAL_NOW','HTTPS_UPLOAD',
  'fixture-open-font-v1','CLEAR','15000000-0000-4000-8000-000000000003',
  clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '10 minutes'
);

insert into public.orders(
  id,customer_id,product_kind,amount_cents,status,paid_at,delivery_deadline,delivered_at,
  human_review_checklist,human_reviewed_by,human_reviewed_at
) values(
  '25000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
  'job_search',2000,'delivered',clock_timestamp()-interval '3 days',
  clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',
  '{"approved":true}','15000000-0000-4000-8000-000000000003',clock_timestamp()-interval '2 days'
);
insert into public.job_matches(
  id,search_order_id,job_id,position,fit_summary,requirements,concerns,delivered_at,
  matching_experience,primary_outcome,core_responsibilities,hidden_job_functions,
  reviewed_by,reviewed_at,release_explanation,allowed_unknown_warnings,source_provenance,
  compensation_status,posted_on,posted_date_unknown,last_checked_at
) values(
  '85000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001',
  '65000000-0000-4000-8000-000000000001',1,'Evidence-bound fit summary','[]','[]',
  clock_timestamp()-interval '2 days','["Operations coordination"]','Coordinate accurate operations',
  '["Maintain workflow records"]','[]','15000000-0000-4000-8000-000000000003',
  clock_timestamp()-interval '2 days',
  '{"whatJobInvolves":"Coordinate operations","whyMadeList":"All gates passed","howExperienceConnects":"Confirmed coordination experience","whatMayBeNew":"Employer workflow","whatToKnow":"Use employer application path"}',
  '[]','{"authorization":"manual-reviewed"}','PUBLISHED_MEETS_MINIMUM',current_date,false,
  clock_timestamp()-interval '2 days'
);

insert into public.ap_payment_attempts(
  id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,
  payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified
) values(
  '95000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
  'stripe','pi_chunk5_fixture',799,'USD','PAID','NONE',clock_timestamp()-interval '25 hours',
  'succeeded','card',true
);
insert into public.ap_material_purchases(
  id,customer_id,payment_attempt_id,amount_cents,currency,completed_at
) values(
  'a5000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001',799,'USD',clock_timestamp()-interval '25 hours'
);
insert into public.ap_material_lines(
  id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,
  allocated_amount_cents,readiness,fulfillment,substitution,selected_reference_sheet,active_revision,
  selection_confirmed_at,materials_payment_verified_at,materials_capacity_confirmed_at,
  materials_started_at,materials_due_at,earned_revenue_at
) values(
  'b5000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001','chunk5-payment-allocation-1',799,
  'CHECKOUT_ELIGIBLE','PAID','NONE',false,1,statement_timestamp()-interval '26 hours',
  statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',
  statement_timestamp()-interval '1 minute',statement_timestamp()+interval '23 hours 59 minutes',null
);
insert into public.ap_material_line_revisions(
  id,line_id,version,revision_kind,job_snapshot_id,source_snapshot_id,employer_rule_snapshot_id,binding_sha256,
  accepted_at,started_at,due_at
) values(
  'c5000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001',1,
  'ORIGINAL','75000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000001',
  'c5500000-0000-4000-8000-000000000001',repeat('b',64),
  statement_timestamp()-interval '1 minute',(select materials_started_at from public.ap_material_lines where id='b5000000-0000-4000-8000-000000000001'),
  (select materials_due_at from public.ap_material_lines where id='b5000000-0000-4000-8000-000000000001')
);

insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,
 source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,catalog_version,schema_version)
values('65000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
 '45000000-0000-4000-8000-000000000001','fixture.responsibility','RESPONSIBILITY','{"activity":"Maintained records"}',
 'CUSTOMER_ASSERTION','45000000-0000-4000-8000-000000000001','fixture','fixture','CUSTOMER_CONFIRMED','fixture-v1','fixture-v1');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','65000000-0000-4000-8000-000000000002','semantic_key','fixture.limited',
 'typed_value',jsonb_build_object('activity','Studying records management','completionStatus','IN_PROGRESS')))).*
from public.ap_candidate_facts f where id='65000000-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','65000000-0000-4000-8000-000000000003','semantic_key','fixture.negative','capability_status','NOT_DONE'))).*
from public.ap_candidate_facts f where id='65000000-0000-4000-8000-000000000001';
insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
 content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
select ('e9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'15000000-0000-4000-8000-000000000001',decode('0102','hex'),'AES-256-GCM',
 decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('33',16),'hex'),repeat(n::text,64),'fictional-fixture-kms','1',repeat('a',64)
from generate_series(1,5) n;
insert into public.ap_releases(id,customer_id,order_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
values('ac910000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001',
 'SEARCH_EXACT_TEN',statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days','{}','15000000-0000-4000-8000-000000000003');
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,state,applied_at)
values('ad910000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','MATERIAL_CHECKOUT','stripe',repeat('a',64),'fictional-draft-contact-checkout','APPLIED',clock_timestamp());
insert into public.ap_material_checkout_intents(id,customer_id,delivered_order_id,delivered_release_id,source_snapshot_id,contact_payload_id,purchase_id,payment_attempt_id,
 command_id,request_key,selection_sha256,line_count,amount_cents,currency,tax_inclusive,pricing_version,tax_version,career_break_choice,document_contact_confirmed,document_facts_confirmed,state,completed_at)
values('ae910000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001','25000000-0000-4000-8000-000000000001','ac910000-0000-4000-8000-000000000001',
 '45000000-0000-4000-8000-000000000009','e9100000-0000-4000-8000-000000000005','a5000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',
 'ad910000-0000-4000-8000-000000000001','fictional-confirmed-contact',repeat('a',64),1,799,'USD',true,'fixture','fixture','KEEP_EXISTING_TIMELINE',true,true,'COMPLETED',clock_timestamp());
update public.ap_material_purchases set checkout_intent_id='ae910000-0000-4000-8000-000000000001' where id='a5000000-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','e9100000-0000-4000-8000-000000000005','snapshot_id','45000000-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','45000000-0000-4000-8000-000000000009','semantic_key','document_contact.confirmed','value_kind','PROTECTED_COMPOSITE',
 'typed_value',jsonb_build_object('protectedPayloadId','e9100000-0000-4000-8000-000000000005','contentSha256',repeat('5',64))))).*
from public.ap_candidate_facts f where id='65000000-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','65000000-0000-4000-8000-000000000009','snapshot_id','45000000-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','45000000-0000-4000-8000-000000000009'))).*
from public.ap_candidate_facts f where id='65000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(public.ap_material_draft_checkout_contact_matches('b5000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
 '45000000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000005'),'exact checkout contact did not survive factual correction');
select pg_temp.assert_true(not public.ap_material_draft_checkout_contact_matches('b5000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
 '45000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000009'),'ordinary old fact received contact exception');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object('id','e9100000-0000-4000-8000-000000000004',
 'typed_value',jsonb_build_object('protectedPayloadId','e9100000-0000-4000-8000-000000000004','contentSha256',repeat('4',64))))).*
from public.ap_candidate_facts f where id='e9100000-0000-4000-8000-000000000005';
select pg_temp.assert_true(not public.ap_material_draft_checkout_contact_matches('b5000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000001',
 '45000000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000004'),'wrong protected payload received contact exception');
create temporary table stage_fixture_state(job_id uuid,version_id uuid,policy_id uuid,worker_id uuid default gen_random_uuid());
insert into stage_fixture_state(job_id) select id from public.ap_material_draft_jobs;
select pg_temp.assert_true(public.ap_material_draft_stage_claiming_schema_installed(),'094 schema not installed');
select pg_temp.assert_true(public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' in('202610250094','202610250095'),'094 schema floor missing');
select pg_temp.reject('select public.ap_claim_material_draft_stage(null,''PREPARE'',1)','material_draft_stage_claim_invalid');
select pg_temp.reject('select public.ap_claim_material_draft_stage(gen_random_uuid(),''SEND'',1)','material_draft_stage_claim_invalid');
select pg_temp.reject('select public.ap_claim_material_draft_stage(gen_random_uuid(),''PREPARE'',6)','material_draft_stage_claim_invalid');
select pg_temp.assert_true(not has_function_privilege('anon','public.ap_claim_material_draft_stage(uuid,text,integer)','EXECUTE')
 and not has_function_privilege('authenticated','public.ap_claim_material_draft_stage(uuid,text,integer)','EXECUTE'),'public queue claim privilege');
select pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'PREPARE',1)='[]','missing initial listing consumed claim');
select pg_temp.assert_true((select claim_count=0 and lease_token is null from public.ap_material_draft_jobs),'human wait mutated initial lease/count');
select public.ap_record_material_draft_listing_check(job_id,null,gen_random_uuid(),'BEFORE_GENERATION',repeat('4',64),'ACTIVE','15000000-0000-4000-8000-000000000003') from stage_fixture_state;
savepoint initial_ready;
update public.ap_retention_restore_lock set locked=true;
select pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'PREPARE',1)='[]','restore lock failed');
select pg_temp.assert_true((select claim_count=0 and lease_token is null from public.ap_material_draft_jobs),'restore lock consumed claim');
rollback to savepoint initial_ready;

do $$ declare s stage_fixture_state; claimed jsonb; token uuid; v uuid; begin
 select * into s from stage_fixture_state;
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(s.worker_id,'GENERATE',1)='[]','initial job claimed for generation');
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(s.worker_id,'RENDER',1)='[]','initial job claimed for rendering');
 claimed:=public.ap_claim_material_draft_stage(s.worker_id,'PREPARE',1);
 perform pg_temp.assert_true(jsonb_array_length(claimed)=1 and claimed->0->>'state'='PREPARING'
  and claimed->0->>'active_version_id' is null and (claimed->0->>'lease_owner')::uuid=s.worker_id
  and (claimed->0->>'claim_count')::integer=1,'prepare exact claim shape');
 token:=(claimed->0->>'lease_token')::uuid;
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'PREPARE',1)='[]','active preparation lease stolen');
 v:=public.ap_attach_material_draft_packet(s.job_id,token,'e9100000-0000-4000-8000-000000000001',repeat('1',64),public.ap_material_draft_context_sha256(s.job_id));
 update stage_fixture_state set version_id=v;
end $$;
update public.ap_material_draft_jobs set lease_expires_at=clock_timestamp()-interval '1 second';
savepoint packet_ready;
select pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1)='[]','disabled provider consumed claim');
select pg_temp.assert_true((select claim_count=1 from public.ap_material_draft_jobs),'disabled provider changed count');
-- Fictional policies are metadata only. No provider/network calls occur.
do $$ declare p uuid; begin
 p:=public.ap_register_material_draft_policy(jsonb_build_object('provider','fictional','model','never-called','privacyReferenceSha256',repeat('a',64),
 'evaluationReferenceSha256',repeat('b',64),'quoteReferenceSha256',repeat('c',64),'maxInputTokens',100,'maxOutputTokens',100,
 'inputMicrousdPerMillion',1000000,'outputMicrousdPerMillion',1000000,'maxAttemptMicrousd',200,'rollingDayMicrousd',400,'maxAttempts',3),'15000000-0000-4000-8000-000000000003');
 perform public.ap_set_material_draft_runtime(true,p,'15000000-0000-4000-8000-000000000003');
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1)='[]','unsupported transport provider consumed claim');
 p:=public.ap_register_material_draft_policy(jsonb_build_object('provider','openai','model','fictional-never-called','privacyReferenceSha256',repeat('a',64),
 'evaluationReferenceSha256',repeat('b',64),'quoteReferenceSha256',repeat('c',64),'maxInputTokens',101,'maxOutputTokens',100,
 'inputMicrousdPerMillion',1000000,'outputMicrousdPerMillion',1000000,'maxAttemptMicrousd',200,'rollingDayMicrousd',400,'maxAttempts',3),'15000000-0000-4000-8000-000000000003');
 perform public.ap_set_material_draft_runtime(true,p,'15000000-0000-4000-8000-000000000003');
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1)='[]','exact policy caps exceeded per-call cap but claimed');
 p:=public.ap_register_material_draft_policy(jsonb_build_object('provider','openai','model','fictional-never-called','privacyReferenceSha256',repeat('a',64),
 'evaluationReferenceSha256',repeat('b',64),'quoteReferenceSha256',repeat('c',64),'maxInputTokens',100,'maxOutputTokens',100,
 'inputMicrousdPerMillion',1000000,'outputMicrousdPerMillion',1000000,'maxAttemptMicrousd',200,'rollingDayMicrousd',199,'maxAttempts',3),'15000000-0000-4000-8000-000000000003');
 perform public.ap_set_material_draft_runtime(true,p,'15000000-0000-4000-8000-000000000003');
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1)='[]','day budget exhausted but claimed');
 perform pg_temp.assert_true((select claim_count=1 from public.ap_material_draft_jobs),'policy waits consumed claims');
end $$;
rollback to savepoint packet_ready;
do $$ declare p uuid; begin
 p:=public.ap_register_material_draft_policy(jsonb_build_object('provider','openai','model','fictional-never-called','privacyReferenceSha256',repeat('a',64),
 'evaluationReferenceSha256',repeat('b',64),'quoteReferenceSha256',repeat('c',64),'maxInputTokens',100,'maxOutputTokens',100,
 'inputMicrousdPerMillion',1000000,'outputMicrousdPerMillion',1000000,'maxAttemptMicrousd',200,'rollingDayMicrousd',200,'maxAttempts',3),'15000000-0000-4000-8000-000000000003');
 perform public.ap_set_material_draft_runtime(true,p,'15000000-0000-4000-8000-000000000003');
 update stage_fixture_state set policy_id=p;
end $$;
-- Fictional fan-out has independent paid lines; no checkout/provider is called.
create function pg_temp.stage_clone_ready() returns uuid language plpgsql as $$
declare payment uuid:=gen_random_uuid(); purchase uuid:=gen_random_uuid(); line uuid:=gen_random_uuid(); revision uuid:=gen_random_uuid(); job uuid; version uuid:=gen_random_uuid(); begin
 insert into public.ap_payment_attempts select (jsonb_populate_record(null::public.ap_payment_attempts,to_jsonb(p)||jsonb_build_object(
  'id',payment,'provider_payment_id','pi_stage_clone_'||payment::text))).* from public.ap_payment_attempts p where id='95000000-0000-4000-8000-000000000001';
 insert into public.ap_material_purchases select (jsonb_populate_record(null::public.ap_material_purchases,to_jsonb(p)||jsonb_build_object(
  'id',purchase,'payment_attempt_id',payment,'checkout_intent_id',null))).* from public.ap_material_purchases p where id='a5000000-0000-4000-8000-000000000001';
 insert into public.ap_material_lines select (jsonb_populate_record(null::public.ap_material_lines,to_jsonb(l)||jsonb_build_object(
  'id',line,'purchase_id',purchase,'payment_attempt_id',payment,'payment_allocation_key','stage-clone-'||line::text))).* from public.ap_material_lines l where id='b5000000-0000-4000-8000-000000000001';
 insert into public.ap_material_line_revisions select (jsonb_populate_record(null::public.ap_material_line_revisions,to_jsonb(r)||jsonb_build_object(
  'id',revision,'line_id',line))).* from public.ap_material_line_revisions r where id='c5000000-0000-4000-8000-000000000001';
 select id into job from public.ap_material_draft_jobs where material_line_id=line;
 perform public.ap_record_material_draft_listing_check(job,null,gen_random_uuid(),'BEFORE_GENERATION',repeat('4',64),'ACTIVE','15000000-0000-4000-8000-000000000003');
 insert into public.ap_material_draft_versions(id,customer_id,material_line_id,job_id,version,packet_encrypted_payload_id,packet_sha256,context_sha256)
 values(version,'15000000-0000-4000-8000-000000000001',line,job,1,'e9100000-0000-4000-8000-000000000001',repeat('1',64),public.ap_material_draft_context_sha256(job));
 update public.ap_material_draft_jobs set state='READY',active_version_id=version where id=job;
 return job;
end $$;
savepoint generate_ready;
-- Twenty-five exhausted predecessors must not hide a later eligible job.
do $$ declare clone uuid; version uuid; policy uuid; claim jsonb; target uuid; begin
 select policy_id into policy from stage_fixture_state;
 for n in 1..25 loop
  if n=1 then select job_id into clone from stage_fixture_state; else clone:=pg_temp.stage_clone_ready(); end if;
  select active_version_id into version from public.ap_material_draft_jobs where id=clone;
  for attempt in 1..3 loop
   insert into public.ap_material_draft_attempts(id,customer_id,material_line_id,job_id,draft_version_id,policy_id,lease_generation,state,input_token_cap,output_token_cap,reserved_microusd,dispatched_at)
   select gen_random_uuid(),customer_id,material_line_id,id,version,policy,1,'NO_RESULT_CONFIRMED',100,100,200,clock_timestamp()-interval '2 days' from public.ap_material_draft_jobs where id=clone;
  end loop;
 end loop;
 insert into public.ap_material_draft_reconciliations(request_id,actual_microusd,no_result,evidence_sha256,reviewed_by)
 select a.id,0,true,repeat('a',64),'15000000-0000-4000-8000-000000000003' from public.ap_material_draft_attempts a;
 target:=pg_temp.stage_clone_ready();
 claim:=public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1);
 perform pg_temp.assert_true(jsonb_array_length(claim)=1 and (claim->0->>'id')::uuid=target,'25 exhausted predecessors starved eligible job');
 perform pg_temp.assert_true((select count(*)=25 from public.ap_material_draft_jobs where id<>target and claim_count<=1 and (lease_expires_at is null or lease_expires_at<clock_timestamp())),'exhausted predecessors consumed claims');
end $$;
rollback to savepoint generate_ready;
-- Inactive dispatched records remain financial obligations, but cannot occupy
-- the entire bounded recovery window ahead of an active expired dispatch.
do $$ declare ids uuid[]:='{}'; clone uuid; target uuid; policy uuid; begin
 select policy_id into policy from stage_fixture_state;
 for n in 1..25 loop
  if n=1 then select job_id into clone from stage_fixture_state; else clone:=pg_temp.stage_clone_ready(); end if;
  ids:=array_append(ids,clone);
 end loop;
 target:=pg_temp.stage_clone_ready();
 foreach clone in array array_append(ids,target) loop
  insert into public.ap_material_draft_attempts(id,customer_id,material_line_id,job_id,draft_version_id,policy_id,lease_generation,state,input_token_cap,output_token_cap,reserved_microusd)
  select gen_random_uuid(),customer_id,material_line_id,id,active_version_id,policy,1,'DISPATCHED',100,100,200 from public.ap_material_draft_jobs where id=clone;
  update public.ap_material_draft_jobs set state='DRAFTING',lease_expires_at=clock_timestamp()-interval '1 second' where id=clone;
 end loop;
 update public.ap_payment_attempts set funds_reversed_at=clock_timestamp() where id in(
  select line.payment_attempt_id from public.ap_material_lines line join public.ap_material_draft_jobs job on job.material_line_id=line.id where job.id=any(ids));
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'PREPARE',1)='[]','unknown recovery returned a work claim');
 perform pg_temp.assert_true((select state='RESULT_UNKNOWN' and claim_count=0 from public.ap_material_draft_jobs where id=target),'inactive predecessors starved active expired dispatch');
 perform pg_temp.assert_true((select count(*)=25 from public.ap_material_draft_attempts where job_id=any(ids) and state='DISPATCHED' and reserved_microusd=200),'inactive financial evidence was silently changed');
 perform pg_temp.assert_true((select sum(reserved_microusd)=5200 from public.ap_material_draft_attempts),'recovery released unknown financial reservations');
end $$;
rollback to savepoint generate_ready;
-- A changed current check changes context even when its result remains ACTIVE.
select public.ap_record_material_draft_listing_check(job_id,version_id,gen_random_uuid(),'BEFORE_GENERATION',repeat('4',64),'ACTIVE','15000000-0000-4000-8000-000000000003') from stage_fixture_state;
select pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1)='[]','stale packet claimed');
select pg_temp.assert_true((select state='OWNER_EXCEPTION' and error_code='EVIDENCE_STALE' and claim_count=1 from public.ap_material_draft_jobs),'stale packet did not surface without a claim');
rollback to savepoint generate_ready;
-- A settled financial result remains in the rolling budget; a fresh policy
-- never resets that shared spend. Reconciliation alone grants no new budget.
do $$ declare s stage_fixture_state; claim jsonb; request uuid:=gen_random_uuid(); token uuid; begin
 select * into s from stage_fixture_state;
 claim:=public.ap_claim_material_draft_stage(s.worker_id,'GENERATE',1);token:=(claim->0->>'lease_token')::uuid;
 perform pg_temp.assert_true(jsonb_array_length(claim)=1 and claim->0->>'state'='READY' and (claim->0->>'active_version_id')::uuid=s.version_id,'generate exact claim shape');
 perform public.ap_begin_material_draft_request(s.job_id,token,s.version_id,request,s.policy_id,100,100);
 update public.ap_material_draft_jobs set lease_expires_at=clock_timestamp()-interval '1 second';
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'RENDER',1)='[]','expired dispatch rendered');
 perform pg_temp.assert_true((select state='RESULT_UNKNOWN' and claim_count=2 and lease_token is null from public.ap_material_draft_jobs),'expired dispatch not fenced');
 perform pg_temp.assert_true((select state='RESULT_UNKNOWN' and reserved_microusd=200 from public.ap_material_draft_attempts where id=request),'unknown spend changed');
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1)='[]','unknown dispatch reissued');
 perform public.ap_reconcile_material_draft_attempt(request,200,true,repeat('a',64),'15000000-0000-4000-8000-000000000003');
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1)='[]','known spend evaded day budget');
 perform pg_temp.assert_true((select claim_count=2 from public.ap_material_draft_jobs),'budget hold consumed allowance');
end $$;
rollback to savepoint generate_ready;
-- Complete the ordinary saved-proposal path, then show that owner wording review
-- is required before the renderer receives a lease.
do $$ declare s stage_fixture_state; claim jsonb; request uuid:=gen_random_uuid(); token uuid; begin
 select * into s from stage_fixture_state;
 claim:=public.ap_claim_material_draft_stage(s.worker_id,'GENERATE',1);token:=(claim->0->>'lease_token')::uuid;
 perform public.ap_begin_material_draft_request(s.job_id,token,s.version_id,request,s.policy_id,100,100);
 perform public.ap_record_material_draft_result(s.job_id,token,request,'e9100000-0000-4000-8000-000000000002',repeat('2',64));
 update public.ap_material_draft_jobs set lease_expires_at=clock_timestamp()-interval '1 second';
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'RENDER',1)='[]','unreviewed source claimed for rendering');
 perform pg_temp.assert_true((select claim_count=2 from public.ap_material_draft_jobs),'human wording wait consumed allowance');
 perform public.ap_record_material_draft_claim_review(s.version_id,repeat('1',64),repeat('2',64),'e9100000-0000-4000-8000-000000000003',repeat('3',64),
  jsonb_build_array(jsonb_build_object('claimId',gen_random_uuid(),'decision','APPROVED','kind','NARRATIVE','qualification','NONFACTUAL',
   'wordingSha256',encode(extensions.digest('Thank you for your consideration.','sha256'),'hex'),'factRefs','[]'::jsonb,'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb)),
  '15000000-0000-4000-8000-000000000003');
end $$;
savepoint render_ready;
-- A revoked reviewer on25 older ready sources cannot starve a later source
-- whose exact saved wording review still belongs to an active operator.
do $$ declare clone uuid; target uuid; draft_version uuid; claims jsonb; begin
 update public.profiles set role='operator' where id='15000000-0000-4000-8000-000000000002';
 update public.ap_material_draft_jobs set state='OWNER_EXCEPTION' where id=(select job_id from stage_fixture_state);
 for n in 1..26 loop
  clone:=pg_temp.stage_clone_ready();
  select active_version_id into draft_version from public.ap_material_draft_jobs where id=clone;
  update public.ap_material_draft_versions set encrypted_payload_id='e9100000-0000-4000-8000-000000000002',source_sha256=repeat('2',64) where id=draft_version;
  update public.ap_material_draft_jobs set state='SOURCE_READY' where id=clone;
  claims:=jsonb_build_array(jsonb_build_object('claimId',gen_random_uuid(),'decision','APPROVED','kind','NARRATIVE','qualification','NONFACTUAL',
   'wordingSha256',encode(extensions.digest('Thank you for your consideration.','sha256'),'hex'),'factRefs','[]'::jsonb,'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb));
  perform public.ap_record_material_draft_claim_review(draft_version,repeat('1',64),repeat('2',64),'e9100000-0000-4000-8000-000000000003',repeat('3',64),claims,
   case when n=26 then '15000000-0000-4000-8000-000000000003'::uuid else '15000000-0000-4000-8000-000000000002'::uuid end);
  if n=26 then target:=clone; end if;
 end loop;
 update public.profiles set role='customer' where id='15000000-0000-4000-8000-000000000002';
 perform pg_temp.assert_true((public.ap_claim_material_draft_stage(gen_random_uuid(),'RENDER',1)->0->>'id')::uuid=target,'25 revoked reviewers starved later render-ready job');
 perform pg_temp.assert_true((select count(*)=25 from public.ap_material_draft_jobs where id<>target and state='SOURCE_READY' and claim_count=0),'revoked-reviewer waits consumed claims');
end $$;
rollback to savepoint render_ready;
update public.ap_material_lines set selected_reference_sheet=true;
select pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'RENDER',1)='[]','required third artifact was ignored');
select pg_temp.assert_true((select claim_count=2 from public.ap_material_draft_jobs),'reference hold consumed count');
rollback to savepoint render_ready;
update public.profiles set role='customer' where id='15000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'RENDER',1)='[]','revoked reviewer accepted');
rollback to savepoint render_ready;
do $$ declare claim jsonb; begin
 claim:=public.ap_claim_material_draft_stage(gen_random_uuid(),'RENDER',1);
 perform pg_temp.assert_true(jsonb_array_length(claim)=1 and claim->0->>'state'='SOURCE_READY' and (claim->0->>'claim_count')::integer=3,'reviewed render claim missing');
 perform pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'RENDER',1)='[]','active render lease stolen');
 update public.ap_material_draft_jobs set state='RENDERING',lease_expires_at=clock_timestamp()-interval '1 second';
 claim:=public.ap_claim_material_draft_stage(gen_random_uuid(),'RENDER',1);
 perform pg_temp.assert_true(jsonb_array_length(claim)=1 and (claim->0->>'claim_count')::integer=4,'expired render retry not bounded and resumable');
end $$;
rollback to savepoint render_ready;
update public.ap_material_draft_jobs set claim_count=30;
select pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'RENDER',1)='[]','claim maximum bypassed');
select pg_temp.assert_true((select claim_count=30 and state='OWNER_EXCEPTION' and error_code='ATTEMPTS_EXHAUSTED' from public.ap_material_draft_jobs),'exhausted claim not held');
rollback to savepoint generate_ready;
select 'MATERIAL_DRAFT_STAGE_FILTERS_OK';
-- BEGIN ISOLATED POSTGRES STAGE RACES
-- Only this disposable local/CI fixture commits fictional rows to make them
-- visible to independent PostgreSQL connections. No provider or storage exists.
commit;
do $$ begin if current_setting('listen_addresses')<>'127.0.0.1' then raise exception 'loopback_stage_fixture_required'; end if; end $$;
create extension if not exists dblink with schema extensions;
select extensions.dblink_connect('stage_racer','host=127.0.0.1 port='||current_setting('port')||' dbname='||current_database()||' user=postgres application_name=applypack_stage_racer');
create function public.stage_fixture_claim_delay() returns text language plpgsql as $$ declare result jsonb; begin
 result:=public.ap_claim_material_draft_stage('94000000-0000-4000-8000-000000000001','GENERATE',1); perform pg_sleep(2); return result::text;
end $$;
create function pg_temp.wait_for_stage_lock() returns void language plpgsql as $$ begin
 for attempt in 1..100 loop
  if exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='applypack_stage_racer' and l.locktype='advisory' and l.granted) then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'stage_racer_never_acquired_lock';
end $$;
select extensions.dblink_send_query('stage_racer','select public.stage_fixture_claim_delay()');
select pg_temp.wait_for_stage_lock();
select pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1)='[]','concurrent claim duplicated leased stage');
select pg_temp.assert_true(jsonb_array_length(result::jsonb)=1,'first concurrent claim missing') from extensions.dblink_get_result('stage_racer') as r(result text);
select result from extensions.dblink_get_result('stage_racer') as r(result text);
select pg_temp.assert_true((select claim_count=2 and lease_owner='94000000-0000-4000-8000-000000000001' from public.ap_material_draft_jobs),'concurrent workers consumed duplicate count');
-- The final dispatch is intentionally ambiguous. Concurrent recovery never
-- issues a new request or releases its durable budget reservation.
do $$ declare j public.ap_material_draft_jobs; p uuid; begin
 select * into j from public.ap_material_draft_jobs;
 select policy_id into p from public.ap_material_draft_runtime where singleton;
 perform public.ap_begin_material_draft_request(j.id,j.lease_token,j.active_version_id,'94000000-0000-4000-8000-000000000002',p,100,100);
 update public.ap_material_draft_jobs set lease_expires_at=clock_timestamp()-interval '1 second';
end $$;
select extensions.dblink_send_query('stage_racer','select public.stage_fixture_claim_delay()');
select pg_temp.wait_for_stage_lock();
select pg_temp.assert_true(public.ap_claim_material_draft_stage(gen_random_uuid(),'GENERATE',1)='[]','concurrent unknown recovery dispatched');
select pg_temp.assert_true(result::jsonb='[]'::jsonb,'unknown recovery returned claim') from extensions.dblink_get_result('stage_racer') as r(result text);
select result from extensions.dblink_get_result('stage_racer') as r(result text);
select pg_temp.assert_true((select state='RESULT_UNKNOWN' and claim_count=2 and lease_token is null from public.ap_material_draft_jobs),'unknown recovery changed claim count or retained lease');
select pg_temp.assert_true((select count(*)=1 and min(state)='RESULT_UNKNOWN' and sum(reserved_microusd)=200 from public.ap_material_draft_attempts),'unknown recovery duplicated or released spend');
select extensions.dblink_disconnect('stage_racer');
select 'MATERIAL_DRAFT_STAGE_CONCURRENCY_OK';

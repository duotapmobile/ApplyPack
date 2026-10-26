begin;
-- Source-aware093 fixture. All bytes/hashes below are fictional; this tests
-- database acceptance, not the external renderer or production readiness.
create temporary table fixture_initial_runtime as select enabled,policy_id from public.ap_material_draft_runtime;
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
  'REQUIRED','REQUIRED',array['PDF','DOCX']::text[],1,1,'OPTIONAL_NOW','HTTPS_UPLOAD',
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

insert into public.ap_material_listing_checks(material_line_id,line_revision_id,phase,job_snapshot_id,submission_rule_id,result,checked_by,checked_at,evidence_sha256)
values('b5000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','BEFORE_GENERATION',
 '75000000-0000-4000-8000-000000000001','c5500000-0000-4000-8000-000000000001','ACTIVE','15000000-0000-4000-8000-000000000003',clock_timestamp(),repeat('4',64));
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
create temporary table fixture_draft_state(job_id uuid,lease_token uuid,version_id uuid,context_sha256 text,policy_id uuid,claim_id uuid,member_sha256 text,approval_sha256 text);

select pg_temp.assert_true(public.ap_material_draft_pair_schema_installed(),'091 schema predicate failed');
select pg_temp.assert_true((select p.proname like 'ap_rr_%' and t.tgenabled='O'
 and position('ap_retention_redaction_permitted' in pg_get_functiondef(p.oid))>0
 and position('ap_material_draft_checkout_contact_matches' in pg_get_functiondef(p.oid))>0
 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
 where t.tgrelid='public.ap_generated_file_versions'::regclass and t.tgname='ap_material_file_fact_binding_guard'),
 'actual contact file trigger lost its retention permit or exact contact predicate');
select pg_temp.assert_true(not has_function_privilege('service_role','public.ap_material_draft_checkout_contact_matches(uuid,uuid,uuid,uuid)','EXECUTE'),
 'private contact exception helper became externally callable');
select pg_temp.assert_true((select required->>'requiredSchemaVersion' in ('202610250093','202610250094','202610250095','202610250096','202610250097') from (select public.ap_manual_launch_schema_readiness() required) r),'091 readiness floor missing');
select pg_temp.assert_true(not has_table_privilege('service_role','public.ap_material_draft_permits','INSERT')
 and not has_table_privilege('service_role','public.ap_material_draft_versions','UPDATE')
 and not has_function_privilege('authenticated','public.ap_claim_material_draft_jobs(uuid,integer)','EXECUTE'),'draft boundary allows caller mutation');
select pg_temp.assert_true((select count(*)=1 from public.ap_material_draft_jobs),'paid confirmed revision was not enqueued');
select public.ap_material_draft_enqueue('b5000000-0000-4000-8000-000000000001');
select pg_temp.assert_true((select count(*)=1 from public.ap_material_draft_jobs),'enqueue replay duplicated obligation');
update public.ap_retention_restore_lock set locked=true;
select pg_temp.assert_true(public.ap_claim_material_draft_jobs(gen_random_uuid(),1)='[]'::jsonb,'restored job was claimable while locked');
update public.ap_retention_restore_lock set locked=false;
do $$ declare claimed jsonb; j uuid; token uuid; ctx text; version_id uuid; policy uuid; response jsonb; request uuid:=gen_random_uuid(); begin
 claimed:=public.ap_claim_material_draft_jobs(gen_random_uuid(),1);
 perform pg_temp.assert_true(jsonb_array_length(claimed)=1,'job not claimable');
 j:=(claimed->0->>'id')::uuid;token:=(claimed->0->>'lease_token')::uuid;
 perform pg_temp.assert_true(public.ap_claim_material_draft_jobs(gen_random_uuid(),1)='[]'::jsonb,'active lease was stolen');
 perform pg_temp.reject(format('select public.ap_renew_material_draft_lease(%L,%L)',j,gen_random_uuid()),'material_draft_lease_stale');
 ctx:=public.ap_material_draft_context_sha256(j);
 perform pg_temp.reject(format('select public.ap_attach_material_draft_packet(%L,%L,%L,%L,%L)',j,token,'e9100000-0000-4000-8000-000000000001',repeat('1',64),repeat('0',64)),'material_draft_context_changed');
 version_id:=public.ap_attach_material_draft_packet(j,token,'e9100000-0000-4000-8000-000000000001',repeat('1',64),ctx);
 perform pg_temp.assert_true(version_id=public.ap_attach_material_draft_packet(j,token,'e9100000-0000-4000-8000-000000000001',repeat('1',64),ctx),'packet lost-response replay duplicated version');
 policy:=public.ap_register_material_draft_policy(jsonb_build_object('provider','fictional','model','no-provider-calls','privacyReferenceSha256',repeat('a',64),
 'evaluationReferenceSha256',repeat('b',64),'quoteReferenceSha256',repeat('c',64),'maxInputTokens',1000,'maxOutputTokens',1000,
 'inputMicrousdPerMillion',1000000,'outputMicrousdPerMillion',1000000,'maxAttemptMicrousd',1000,'rollingDayMicrousd',300,'maxAttempts',3),'15000000-0000-4000-8000-000000000003');
 perform pg_temp.reject(format('select public.ap_begin_material_draft_request(%L,%L,%L,%L,%L,100,100)',j,token,version_id,request,policy),'material_draft_provider_disabled');
 perform public.ap_set_material_draft_runtime(true,policy,'15000000-0000-4000-8000-000000000003');
 response:=public.ap_begin_material_draft_request(j,token,version_id,request,policy,100,100);
 perform pg_temp.assert_true((response->>'dispatchAuthorized')::boolean and (response->>'reservedMicrousd')::integer=200,'bounded provider reservation failed');
 perform pg_temp.assert_true(public.ap_assert_material_draft_dispatch_current(j,token,request,version_id,policy),'current dispatch was rejected');
 perform pg_temp.reject(format('select public.ap_assert_material_draft_dispatch_current(%L,null,%L,%L,%L)',j,request,version_id,policy),'material_draft_lease_required');
 perform public.ap_set_material_draft_runtime(false,policy,'15000000-0000-4000-8000-000000000003');
 perform pg_temp.reject(format('select public.ap_assert_material_draft_dispatch_current(%L,%L,%L,%L,%L)',j,token,request,version_id,policy),'material_draft_dispatch_no_longer_current');
 perform public.ap_set_material_draft_runtime(true,policy,'15000000-0000-4000-8000-000000000003');
 response:=public.ap_begin_material_draft_request(j,token,version_id,request,policy,100,100);
 perform pg_temp.assert_true(response->>'dispatchAuthorized'='false','lost reservation response authorized duplicate provider call');
 perform pg_temp.assert_true(public.ap_fail_material_draft_job(j,token,'PROVIDER_UNAVAILABLE')='RESULT_UNKNOWN','unknown provider spend was retried');
 perform pg_temp.assert_true(public.ap_claim_material_draft_jobs(gen_random_uuid(),1)='[]'::jsonb,'unknown result became automatically claimable');
 perform public.ap_reconcile_material_draft_attempt(request,0,true,repeat('d',64),'15000000-0000-4000-8000-000000000003');
 perform public.ap_reconcile_material_draft_attempt(request,0,true,repeat('d',64),'15000000-0000-4000-8000-000000000003');
 claimed:=public.ap_claim_material_draft_jobs(gen_random_uuid(),1);token:=(claimed->0->>'lease_token')::uuid;
 request:=gen_random_uuid();response:=public.ap_begin_material_draft_request(j,token,version_id,request,policy,100,100);
 perform pg_temp.assert_true(response->>'dispatchAuthorized'='true','confirmed no-result did not allow bounded retry');
 perform public.ap_record_material_draft_result(j,token,request,'e9100000-0000-4000-8000-000000000002',repeat('2',64));
 perform public.ap_record_material_draft_result(j,token,request,'e9100000-0000-4000-8000-000000000002',repeat('2',64));
 perform pg_temp.reject(format('update public.ap_material_draft_versions set source_sha256=%L where id=%L',repeat('a',64),version_id),'material_draft_version_write_once');
 insert into fixture_draft_state values(j,token,version_id,ctx,policy,gen_random_uuid(),null,null);
end $$;
savepoint before_qualified_review;
do $$ declare w fixture_draft_state; claims jsonb; begin
 select * into w from fixture_draft_state;
 claims:=jsonb_build_array(jsonb_build_object('claimId',w.claim_id,'decision','APPROVED','kind','CANDIDATE_FACT','qualification','EXACT','jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb,
  'wordingSha256',encode(extensions.digest('Currently studying records management','sha256'),'hex'),
  'factRefs',jsonb_build_array(jsonb_build_object('factId','65000000-0000-4000-8000-000000000002','field','activity',
   'attributionFactId','65000000-0000-4000-8000-000000000002','valueSha256',encode(extensions.digest('"Studying records management"','sha256'),'hex')))));
 perform pg_temp.reject(format('select public.ap_record_material_draft_claim_review(%L,%L,%L,%L,%L,%L,%L)',w.version_id,repeat('1',64),repeat('2',64),'e9100000-0000-4000-8000-000000000003',repeat('3',64),claims,'15000000-0000-4000-8000-000000000003'),'material_draft_claim_source_invalid');
 claims:=jsonb_set(claims,'{0,qualification}','"QUALIFIED_TRANSFER"');
 perform public.ap_record_material_draft_claim_review(w.version_id,repeat('1',64),repeat('2',64),'e9100000-0000-4000-8000-000000000003',repeat('3',64),claims,'15000000-0000-4000-8000-000000000003');
 claims:=jsonb_set(claims,'{0,factRefs}',jsonb_build_array(jsonb_build_object('factId','65000000-0000-4000-8000-000000000003','field','activity','attributionFactId','65000000-0000-4000-8000-000000000003','valueSha256',encode(extensions.digest('"Maintained records"','sha256'),'hex'))));
 perform pg_temp.reject(format('select public.ap_record_material_draft_claim_review(%L,%L,%L,%L,%L,%L,%L)',w.version_id,repeat('1',64),repeat('2',64),'e9100000-0000-4000-8000-000000000003',repeat('3',64),claims,'15000000-0000-4000-8000-000000000003'),'material_draft_claim_source_invalid');
end $$;
rollback to savepoint before_qualified_review;
do $$ declare w fixture_draft_state; claims jsonb; begin
 select * into w from fixture_draft_state;
 claims:=jsonb_build_array(jsonb_build_object('claimId',w.claim_id,'decision','APPROVED','kind','CANDIDATE_FACT','qualification','EXACT','jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb,
  'wordingSha256',encode(extensions.digest('Maintained records','sha256'),'hex'),
  'factRefs',jsonb_build_array(jsonb_build_object('factId','65000000-0000-4000-8000-000000000001','field','activity',
   'attributionFactId','65000000-0000-4000-8000-000000000001','valueSha256',encode(extensions.digest('"Maintained records"','sha256'),'hex')))));
 claims:=claims||jsonb_build_array(jsonb_build_object('claimId','af910000-0000-4000-8000-000000000001','decision','APPROVED','kind','CANDIDATE_FACT','qualification','EXACT',
  'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb,'wordingSha256',encode(extensions.digest('Fictional Confirmed Contact','sha256'),'hex'),
  'factRefs',jsonb_build_array(jsonb_build_object('factId','e9100000-0000-4000-8000-000000000005','field','contentSha256','attributionFactId','e9100000-0000-4000-8000-000000000005',
   'valueSha256',encode(extensions.digest(to_jsonb(repeat('5',64))::text,'sha256'),'hex')))));
 perform public.ap_record_material_draft_claim_review(w.version_id,repeat('1',64),repeat('2',64),'e9100000-0000-4000-8000-000000000003',repeat('3',64),claims,'15000000-0000-4000-8000-000000000003');
 perform pg_temp.reject(format('select public.ap_commit_material_draft_pair(%L,%L,%L,%L,%L,%L)',w.job_id,w.lease_token,w.version_id,repeat('1',64),repeat('2',64),'[{"p_artifact_type":"RESUME"}]'),'material_draft_pair_incomplete');
 perform pg_temp.reject(format('select public.ap_approve_material_draft_pair(%L,%L,%L,%L,%L,%L,%L)',w.version_id,repeat('1',64),repeat('2',64),repeat('a',64),'{}','Synthetic actual owner review for the fixture','15000000-0000-4000-8000-000000000003'),'material_draft_version_stale');
 perform pg_temp.reject(format('select public.ap_assert_material_draft_permit(%L,%L)','b5000000-0000-4000-8000-000000000001','REGISTER'),'material_draft_pair_workflow_required');
end $$;

update public.ap_commerce_configuration set download_ttl_seconds=900,reauthentication_window_seconds=900,
 materials_generation_approved=true,materials_generation_approval_reference='synthetic-database-fixture-only',
 material_output_formats=array['PDF'],document_renderer_identity='fixture-tagged-pdf-renderer',document_font_family='Liberation Sans',
 document_font_sha256='76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
 document_font_manifest_sha256='d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb',document_safety_policy='generated-structural-v1',materials_rule_ttl_seconds=3600 where singleton;

create temporary table fixture_registrations(payload jsonb);
do $$ declare w fixture_draft_state; kind text; artifact uuid; file_id uuid; base text; provenance jsonb; structural jsonb; checks jsonb; payload jsonb:='[]'; node_id uuid; begin
 select * into w from fixture_draft_state;
 select id into node_id from public.ap_requirement_nodes where job_snapshot_id='75000000-0000-4000-8000-000000000001' limit 1;
 select jsonb_object_agg(k,true) into structural from unnest(array['noMacros','noHiddenText','noComments','noTrackedChanges','noCustomXml','noExternalRelationships','noLayoutTables','nativeBullets','linearText','noPlaceholders','noMetadataLeak','noPromptArtifacts','filenameValid','mimeValid','checksumValid','pageGeometryValid','textExtracted']) k;
 select jsonb_object_agg(k,true) into checks from unnest(array['factsBound','jobEvidenceBound','narrativeTyped','historicalTitlesPreserved','injectionReviewed','noUnsupportedClaims','sameCurrentBinding']) k;
 foreach kind in array array['RESUME','COVER_LETTER'] loop
  artifact:=gen_random_uuid();file_id:=gen_random_uuid();
  base:='15000000-0000-4000-8000-000000000001/materials/b5000000-0000-4000-8000-000000000001/'||file_id;
  provenance:=jsonb_build_object('schemaVersion','applypack-claim-provenance-v1',
   'sourceBinding',jsonb_build_object('candidateFactIds',jsonb_build_array('65000000-0000-4000-8000-000000000001','e9100000-0000-4000-8000-000000000005'),'jobEvidenceIds',jsonb_build_array(node_id),'referencePermissionIds','[]'::jsonb),
   'claims',jsonb_build_array(jsonb_build_object('id',w.claim_id,'placement','experience.bullet','kind','CANDIDATE_FACT','visibleTextSha256',encode(extensions.digest('Maintained records','sha256'),'hex'),
    'candidateFactIds',jsonb_build_array('65000000-0000-4000-8000-000000000001'),'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb),
    jsonb_build_object('id','af910000-0000-4000-8000-000000000001','placement','header.name','kind','CANDIDATE_FACT',
     'visibleTextSha256',encode(extensions.digest('Fictional Confirmed Contact','sha256'),'hex'),
     'candidateFactIds',jsonb_build_array('e9100000-0000-4000-8000-000000000005'),'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb)),
   'draftPair',jsonb_build_object('versionId',w.version_id,'packetSha256',repeat('1',64),'sourceSha256',repeat('2',64),'claimReviewSha256',repeat('3',64)),
   'editableSource',jsonb_build_object('storageBucket','operator-drafts','storagePath',base||'/editable-source/Fixture_'||kind||'.docx','safeFilename','Fixture_'||kind||'.docx',
    'checksumSha256',repeat('5',64),'sizeBytes',4096,'mimeType','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
   'uploadCleanup',jsonb_build_array(jsonb_build_object('storageBucket','operator-drafts','storagePath',base||'/editable-source/Fixture_'||kind||'.docx'),
    jsonb_build_object('storageBucket','operator-render-previews','storagePath',base||'/render-preview.pdf'),jsonb_build_object('storageBucket','customer-deliveries','storagePath',base||'/Fixture_'||kind||'.pdf')),
   'deliveryFormatDecision',jsonb_build_object('format','PDF','reason','DEFAULT_PDF','employerRuleId','c5500000-0000-4000-8000-000000000001'),
   'documentFontAttestation',jsonb_build_object('family','Liberation Sans','version','2.1.5','manifestSha256','d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb',
    'styleSha256',jsonb_build_object('regular','76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8','bold','788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173',
     'italic','e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0','boldItalic','698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee')));
  payload:=payload||jsonb_build_array(jsonb_build_object('p_artifact_id',artifact,'p_file_version_id',file_id,'p_material_line_id','b5000000-0000-4000-8000-000000000001','p_reviewer_id',null,'p_artifact_type',kind,
   'p_source_snapshot_id','45000000-0000-4000-8000-000000000001','p_source_line_revision_id','c5000000-0000-4000-8000-000000000001','p_job_snapshot_id','75000000-0000-4000-8000-000000000001',
   'p_reference_regeneration_id',null,'p_reference_permission_ids','[]'::jsonb,'p_claim_provenance',provenance,
   'p_generator_version','applypack-documents|instructions=applypack-universal-document-standard-2026-10-19.1|standardSha256=2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778|content=applypack-content-2026-10-19.1|template=applypack-template-2026-10-19.1|exporter=libreoffice-tagged-pdf-2026-10-19.1',
   'p_storage_bucket','customer-deliveries','p_storage_path',base||'/Fixture_'||kind||'.pdf','p_safe_filename','Fixture_'||kind||'.pdf','p_checksum_sha256',repeat('6',64),'p_mime_type','application/pdf','p_size_bytes',4096,
   'p_binding_sha256',repeat('b',64),'p_package_qa_sha256',repeat('7',64),'p_structural_checks',structural,'p_provenance_checks',checks,'p_extracted_text_sha256',repeat('8',64),'p_rendered_page_count',1,
   'p_renderer_identity','fixture-tagged-pdf-renderer','p_arial_font_sha256','76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
   'p_malware_scanner_identity','NOT_SCANNED:generated-structural-v1','p_render_preview_bucket','operator-render-previews','p_render_preview_path',base||'/render-preview.pdf',
   'p_render_preview_sha256',repeat('9',64),'p_rendered_page_sha256',jsonb_build_array(repeat('a',64)),'p_arial_resolved',true));
 end loop;
 insert into fixture_registrations values(payload);
end $$;

select pg_temp.assert_true(public.ap_source_aware_document_schema_installed(),'093 schema predicate failed');
select pg_temp.assert_true((select not enabled and policy_id is null from fixture_initial_runtime),'093 enabled provider drafting');
select pg_temp.assert_true(not has_function_privilege('service_role','public.ap_assert_source_aware_artifact_qa(uuid)','execute'),'internal QA assertion exposed to service role');
select pg_temp.assert_true(not has_function_privilege('anon','public.ap_source_aware_document_schema_installed()','execute'),'readiness exposed to anonymous callers');

-- Connect the new finite QA receipt to the actual same-pair registration wire.
update fixture_registrations set payload=(select jsonb_agg(entry||jsonb_build_object(
 'p_generator_version',public.ap_source_aware_document_generator(),'p_checksum_sha256',repeat('9',64),
 'p_structural_checks',(entry->'p_structural_checks')||'{"metadataValid":true,"taggedPdf":true,"pdfStructureValid":true}'::jsonb,
 'p_claim_provenance',(entry->'p_claim_provenance')||jsonb_build_object(
  'draftSource',jsonb_build_object('renderSourceSha256',repeat('2',64),'proposalSourceSha256',repeat('f',64),'packetSha256',repeat('1',64)),
  'sourceAwareQa',jsonb_build_object('schemaVersion','applypack-source-aware-document-qa-v1',
   'generatorVersion',public.ap_source_aware_document_generator(),'packageQaSha256',entry->>'p_package_qa_sha256',
   'extractedTextSha256',entry->>'p_extracted_text_sha256','metadataSha256',repeat('c',64),
   'packageChecks','{"exactReviewedText":true,"exactParagraphCount":true,"exactParagraphText":true,"exactParagraphStructure":true,"exactContactLinks":true,"exactMetadata":true,"exactHeadingCount":true,"nativeBullets":true}'::jsonb,
   'pdf',jsonb_build_object('schemaVersion','applypack-reviewed-draft-pdf-v1','generatorVersion',public.ap_source_aware_document_generator(),
    'artifact',entry->>'p_artifact_type','renderSourceSha256',repeat('2',64),'docxSha256',repeat('5',64),
    'expectationSha256',repeat('d',64),'searchablePdfSha256',repeat('9',64),'structureTextSha256',repeat('e',64),'linkXmlSha256',repeat('f',64),
    'paragraphCount',12,'listItemCount',0,'linkCount',2))))) from jsonb_array_elements(payload) entry);

create function pg_temp.reject_qa_payload(bad jsonb,expected text default 'source_aware_document_qa_invalid') returns void language plpgsql as $$
declare w fixture_draft_state;
begin
 select * into w from fixture_draft_state;
 perform pg_temp.reject(format('select public.ap_commit_material_draft_pair(%L,%L,%L,%L,%L,%L)',w.job_id,w.lease_token,w.version_id,repeat('1',64),repeat('2',64),bad),expected);
 perform pg_temp.assert_true(not exists(select 1 from public.ap_generated_artifacts),'rejected QA left half a pair');
end $$;

do $$ declare payload jsonb; path text[]; replacement jsonb; key text; begin
 select r.payload into payload from fixture_registrations r;
 -- Unknown keys and asserted booleans cannot substitute the exact source profile.
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,sourceAwareQa}', '{}'));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,sourceAwareQa,privateText}', '"not allowed"'));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,sourceAwareQa,pdf,unknown}', 'true'));
 foreach key in array array['exactReviewedText','exactParagraphCount','exactParagraphText','exactParagraphStructure','exactContactLinks','exactMetadata','exactHeadingCount','nativeBullets'] loop
  path:=array['1','p_claim_provenance','sourceAwareQa','packageChecks',key];
  perform pg_temp.reject_qa_payload(jsonb_set(payload,path,'false'));
  perform pg_temp.reject_qa_payload(jsonb_set(payload,path,'"true"'));
  perform pg_temp.reject_qa_payload(payload #- path);
 end loop;
 foreach key in array array['docxSha256','renderSourceSha256','searchablePdfSha256','generatorVersion','artifact','schemaVersion'] loop
  path:=array['1','p_claim_provenance','sourceAwareQa','pdf',key];
  perform pg_temp.reject_qa_payload(jsonb_set(payload,path,to_jsonb(repeat('b',64))));
 end loop;
 foreach key in array array['metadataSha256','packageQaSha256','extractedTextSha256'] loop
  perform pg_temp.reject_qa_payload(jsonb_set(payload,array['1','p_claim_provenance','sourceAwareQa',key],'null'));
 end loop;
 foreach key in array array['metadataValid','taggedPdf','pdfStructureValid','nativeBullets'] loop
  perform pg_temp.reject_qa_payload(jsonb_set(payload,array['1','p_structural_checks',key],'false'));
 end loop;
 foreach replacement in array array['-1'::jsonb,'251','1.5','"12"','null'] loop
  perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,sourceAwareQa,pdf,paragraphCount}',replacement));
 end loop;
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,sourceAwareQa,pdf,listItemCount}','1')); -- cover letter cannot invent bullets
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{0,p_claim_provenance,sourceAwareQa,pdf,listItemCount}','13'));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{0,p_claim_provenance,sourceAwareQa,pdf,linkCount}','0'));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{0,p_claim_provenance,sourceAwareQa,pdf,linkCount}','6'));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_checksum_sha256}',to_jsonb(repeat('b',64))));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_package_qa_sha256}',to_jsonb(repeat('b',64))));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_extracted_text_sha256}',to_jsonb(repeat('b',64))));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_arial_resolved}','false'),'source_aware_document_font_invalid');
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,draftSource,packetSha256}',to_jsonb(repeat('b',64))));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,draftSource,renderSourceSha256}',to_jsonb(repeat('b',64))));
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,documentFontAttestation,styleSha256,bold}',to_jsonb(repeat('b',64))),'document_font_attestation_invalid');
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,editableSource,storageBucket}','"customer-deliveries"'),'locked_editable_document_source_required');
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,deliveryFormatDecision,format}','"DOCX"'),'document_delivery_format_decision_invalid');
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,draftPair,sourceSha256}',to_jsonb(repeat('b',64))),'material_draft_pair_binding_invalid');
 perform pg_temp.reject_qa_payload(jsonb_set(payload,'{1,p_claim_provenance,claims,0,visibleTextSha256}',to_jsonb(repeat('b',64))),'material_draft_wording_not_reviewed');
end $$;

-- DOCX delivery remains a genuine format decision, with its own byte identity.
savepoint docx_delivery;
select public.ap_record_applicant_document_format_request(gen_random_uuid(),'b5000000-0000-4000-8000-000000000001','15000000-0000-4000-8000-000000000003','DOCX',repeat('f',64));
update public.ap_commerce_configuration set material_output_formats=array['PDF','DOCX'] where singleton;
update fixture_registrations set payload=(select jsonb_agg(entry||jsonb_build_object(
 'p_checksum_sha256',repeat('5',64),'p_mime_type','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'p_safe_filename',replace(entry->>'p_safe_filename','.pdf','.docx'),'p_storage_path',replace(entry->>'p_storage_path','.pdf','.docx'),
 'p_claim_provenance',jsonb_set(entry->'p_claim_provenance','{deliveryFormatDecision}',jsonb_build_object('format','DOCX','reason','APPLICANT_REQUEST',
  'employerRuleId','c5500000-0000-4000-8000-000000000001','applicantRequestId',(select id from public.ap_applicant_document_format_requests),
  'requestReferenceSha256',repeat('f',64))))) from jsonb_array_elements(payload) entry);
do $$ declare w fixture_draft_state; receipt jsonb; begin
 select * into w from fixture_draft_state;
 receipt:=public.ap_commit_material_draft_pair(w.job_id,w.lease_token,w.version_id,repeat('1',64),repeat('2',64),(select payload from fixture_registrations));
 perform pg_temp.assert_true(jsonb_array_length(receipt->'members')=2,'source-aware DOCX pair failed');
 perform public.ap_assert_current_artifact_facts(id) from public.ap_generated_artifacts;
end $$;
rollback to savepoint docx_delivery;

do $$ declare w fixture_draft_state; payload jsonb; receipt jsonb; approval text; checklist jsonb; begin
 select * into w from fixture_draft_state;select r.payload into payload from fixture_registrations r;
 receipt:=public.ap_commit_material_draft_pair(w.job_id,w.lease_token,w.version_id,repeat('1',64),repeat('2',64),payload);
 perform pg_temp.assert_true(jsonb_array_length(receipt->'members')=2,'source-aware zero-list pair failed');
 perform pg_temp.assert_true(not exists(select 1 from public.ap_artifact_quality_reviews where content_approved_at is not null or visual_approved_at is not null),'system invented human approval');
 perform pg_temp.assert_true(public.ap_commit_material_draft_pair(w.job_id,w.lease_token,w.version_id,repeat('1',64),repeat('2',64),payload)->>'replayed'='true','same exact pair replay failed');
 select jsonb_object_agg(k,true) into checklist from unnest(array['contentReviewed','instructionsReparsed','linksRechecked','listingRechecked','provenanceReviewed','secureFilesConfirmed','visualReviewed']) k;
 approval:=public.ap_approve_material_draft_pair(w.version_id,repeat('1',64),repeat('2',64),receipt->>'memberSetSha256',checklist,'Fictional owner reviewed the exact new source and rendered pages.','15000000-0000-4000-8000-000000000003');
 update fixture_draft_state set member_sha256=receipt->>'memberSetSha256',approval_sha256=approval;
 perform public.ap_assert_current_artifact_facts(id) from public.ap_generated_artifacts;
end $$;

-- Guard provenance after approval and detect changed file bytes before send.
select pg_temp.reject(format('update public.ap_generated_artifacts set claim_provenance=jsonb_set(claim_provenance,%L,%L) where id=%L',
 '{sourceAwareQa,metadataSha256}',to_jsonb(repeat('b',64)),id),'source_aware_document_provenance_immutable') from public.ap_generated_artifacts;
select pg_temp.reject(format('update public.ap_generated_artifacts set generator_version=%L where id=%L','legacy-spoof',id),'source_aware_document_provenance_immutable') from public.ap_generated_artifacts;
savepoint changed_preview;
update public.ap_artifact_quality_reviews set render_preview_sha256=repeat('b',64);
select pg_temp.reject(format('select public.ap_assert_current_artifact_facts(%L)',id),'source_aware_document_pair_invalid') from public.ap_generated_artifacts;
rollback to savepoint changed_preview;
savepoint changed_pinned_font;
update public.ap_artifact_quality_reviews set document_font_sha256=repeat('b',64);
select pg_temp.reject(format('select public.ap_assert_current_artifact_facts(%L)',id),'source_aware_document_font_invalid') from public.ap_generated_artifacts;
rollback to savepoint changed_pinned_font;
savepoint changed_source_claim;
update public.ap_generated_file_versions set checksum_sha256=repeat('b',64);
select pg_temp.reject(format('select public.ap_assert_current_artifact_facts(%L)',id),'source_aware_document_pair_invalid') from public.ap_generated_artifacts;
rollback to savepoint changed_source_claim;
savepoint required_reference;
update public.ap_material_lines set selected_reference_sheet=true;
select pg_temp.reject(format('select public.ap_assert_material_draft_members_current(%L)',version_id),'material_draft_pair_incomplete') from fixture_draft_state;
rollback to savepoint required_reference;

insert into public.ap_material_listing_checks(material_line_id,line_revision_id,phase,job_snapshot_id,submission_rule_id,result,checked_by,checked_at,evidence_sha256)
values('b5000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','BEFORE_RELEASE','75000000-0000-4000-8000-000000000001','c5500000-0000-4000-8000-000000000001','ACTIVE','15000000-0000-4000-8000-000000000003',clock_timestamp(),repeat('4',64));
do $$ declare w fixture_draft_state; release_id uuid:=gen_random_uuid(); outbox_id uuid:=gen_random_uuid(); result uuid; begin
 select * into w from fixture_draft_state;
 result:=public.ap_send_material_draft_pair(w.version_id,repeat('1',64),repeat('2',64),w.member_sha256,w.approval_sha256,'15000000-0000-4000-8000-000000000003',release_id,outbox_id,'Fictional owner separately sends the exact source-aware approved pair.');
 perform pg_temp.assert_true(result=release_id,'source-aware separate send failed');
 perform public.ap_assert_supported_artifact_facts(id) from public.ap_generated_artifacts;
 perform pg_temp.assert_true(public.ap_send_material_draft_pair(w.version_id,repeat('1',64),repeat('2',64),w.member_sha256,w.approval_sha256,'15000000-0000-4000-8000-000000000003',release_id,outbox_id,'Fictional exact lost response replay.')=release_id,'source-aware send replay failed');
end $$;
select 'SOURCE_AWARE_DOCUMENT_ACCEPTANCE_OK' as result;
-- Exercise the exact internal redaction permit against the new active guard.
-- This is not a purge-policy authorization or a storage-deletion assertion.
savepoint exact_retention_redaction;
do $$ declare a public.ap_generated_artifacts; policy public.ap_retention_private_tables; before_value jsonb; after_value jsonb; assignments text; begin
 select * into a from public.ap_generated_artifacts limit 1;
 select * into policy from public.ap_retention_private_tables where table_name='ap_generated_artifacts';
 before_value:=to_jsonb(a); after_value:=public.ap_retention_patch_row(policy.table_name,before_value,policy.redaction_patch);
 insert into public.ap_retention_redaction_permits values(txid_current(),pg_backend_pid(),'public.ap_generated_artifacts'::regclass,
  encode(extensions.digest((before_value-'updated_at')::text,'sha256'),'hex'),encode(extensions.digest((after_value-'updated_at')::text,'sha256'),'hex'));
 select string_agg(format('%I=typed.%I',key,key),',') into assignments from jsonb_object_keys(policy.redaction_patch) key;
 execute format('update public.ap_generated_artifacts a set %s from jsonb_populate_record(null::public.ap_generated_artifacts,$1) typed where a.id=$2',assignments) using after_value,a.id;
 perform pg_temp.assert_true((select claim_provenance='{}'::jsonb from public.ap_generated_artifacts where id=a.id),'093 source QA prevented exact permitted redaction');
 delete from public.ap_retention_redaction_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid();
end $$;
rollback to savepoint exact_retention_redaction;
rollback;

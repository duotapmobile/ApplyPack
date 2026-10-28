-- Exact103→104 preservation seed. Fictional rows, no provider calls.
begin;
do $$ begin if (select max(version) from supabase_migrations.schema_migrations)<>'202610260103' or to_regclass('public.ap_employer_rule_review_receipts') is not null then raise exception 'employer_rule_upgrade_exact103_required'; end if; end $$;
-- Fictional104 fixture derived from published092 bootstrap before its review actions.
-- All constraints/triggers remain active; UUIDs, provider keys and source names are fixture-scoped.
-- The saved employer text explicitly states the instruction choices used below. No provider proof.
-- Synthetic setup copied from the published091 pair fixture through actual owner approval.
-- This independent092 fixture deliberately starts with an expired employer rule.

-- Fictional database fixture; no provider, encryption or rendering success is asserted.
create or replace function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$ begin if value is not true then raise exception '%',message; end if; end $$;
create or replace function pg_temp.reject(command text,expected text) returns void language plpgsql as $$ begin begin execute command; exception when others then if sqlerrm=expected then return; end if; raise; end; raise exception 'expected rejection: %',expected; end $$;
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
  ('c1040000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c104-chunk5-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('c1040000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c104-chunk5-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('c1040000-0000-4000-8000-000000000003','00000000-0000-0000-8000-000000000000','authenticated','authenticated','c104-chunk5-reviewer@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='operator' where id='c1040000-0000-4000-8000-000000000003';

-- Included inside the calling fixture's rollback-only transaction. These .example
-- permissions are synthetic test evidence, never production source authorization.
insert into public.employers(id,display_name,source_category)
values('c104-fixture-reviewed-employer','c104 Synthetic reviewed source fixture','core_direct_employer');
insert into public.job_sources(id,canonical_employer_id,source_name,source_category,official_url,
 adapter_kind,automation_status,is_official,is_direct_employer,is_active,paid_display_permission_status)
values('c104-manual-reviewed','c104-fixture-reviewed-employer','c104 Synthetic rollback-only manual fixture','core_direct_employer',
 'https://chunk5-employer.example','official_link_only','official_link_only',true,true,true,'documented_paid_display_authorized')
on conflict(id) do update set canonical_employer_id=excluded.canonical_employer_id,is_active=true,
 paid_display_permission_status=excluded.paid_display_permission_status;
insert into public.ap_source_authorizations(source_id,source_display_name,state,access_method,evidence_reference,
 allowed_hosts,allowed_actions,verified_by_role,verified_at,authorization_version,content_sha256)
values('c104-manual-reviewed','c104 Synthetic rollback-only manual fixture','AUTHORIZED_MANUAL_ONLY','MANUAL',
 'tests/integration/reviewed-source-fixture.sql: synthetic authorization, transaction rolled back',
 array['chunk5-employer.example','employer1.example','employer2.example','employer3.example','employer4.example',
 'employer5.example','employer6.example','employer7.example','employer8.example','employer9.example','employer10.example'],
 array['MANUAL_REVIEW'],'operator',clock_timestamp(),'c104-zz-chunk-fixture',repeat('a',64));

create or replace function pg_temp.verify_fixture_snapshot(snapshot jsonb,actor uuid) returns uuid
language plpgsql as $$
declare payload jsonb; posting jsonb; review jsonb; nodes jsonb; authority uuid; revision bigint;
 body text:='A resume and a cover letter are required. Upload PDF files. Each document must be one page. References are optional now. Apply through our secure HTTPS application form.';
begin
 select id into authority from public.ap_source_authorizations
 where source_id='c104-manual-reviewed' and authorization_version='c104-zz-chunk-fixture';
 select h.revision into revision from public.ap_source_authorization_heads h where h.source_id='c104-manual-reviewed';
 if not exists(select 1 from public.ap_source_authorization_heads where source_id='c104-manual-reviewed' and current_authorization_id=authority) then
   perform public.ap_set_source_authorization_head('c104-manual-reviewed',authority,coalesce(revision,0),actor);
 end if;
 update public.jobs set source_id='c104-manual-reviewed',canonical_employer_id='c104-fixture-reviewed-employer',
  source_name='c104 Synthetic rollback-only manual fixture',source_category='core_direct_employer',
  is_official_source=true,is_direct_employer_source=true,raw_title=title,normalized_title=lower(title),
  description=body,content_hash=snapshot->>'content_sha256',deduplication_key=snapshot->>'normalized_fingerprint',
  last_observed_at=transaction_timestamp()-interval '1 minute'
 where id=(snapshot->>'legacy_job_id')::uuid;
 select to_jsonb(j) into payload from public.jobs j where id=(snapshot->>'legacy_job_id')::uuid;
 posting:=jsonb_build_object('title',payload->>'raw_title','externalJobId',payload->>'external_job_id',
  'sourceJobUrl',payload->>'source_job_url','description',body);
 review:=jsonb_build_object('method','HUMAN_DIRECT_OFFICIAL_REVIEW','checkedAt',transaction_timestamp(),
  'officialListingUrl',payload->>'source_job_url','officialApplicationUrl',payload->>'official_application_url',
  'capturedText',body,'captureSha256',encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),
  'evidenceNotes','Synthetic operator checked the explicit fixture listing and employer application path.',
  'transitionReason','Explicit synthetic source review inside a rollback-only integration fixture.',
  'employerIdentityConfirmed',true,'applicationPathConfirmed',true,'listingActiveConfirmed',true,'legitimacyConfirmed',true);
 snapshot:=snapshot||jsonb_build_object('captured_listing',jsonb_build_object('text',body),
  'location_and_work_mode',(snapshot->>'location_and_work_mode')::jsonb);
 nodes:=jsonb_build_array(jsonb_build_object('id',case when snapshot->>'id' like 'b4100000-%'
  then replace(snapshot->>'id','b4100000-','b4300000-')::uuid else gen_random_uuid() end,'position',0,'node_kind','ALL_OF',
  'classification_method','fixture-human-reviewed','human_correction_history','[]'::jsonb));
 return public.ap_verify_manual_source_observation(gen_random_uuid(),actor,'c104-manual-reviewed',posting,review,
  'requisition|c104-fixture-reviewed-employer|'||(payload->>'external_job_id'),snapshot,nodes,payload);
end $$;


insert into public.ap_intake_snapshots(
  id,customer_id,version,snapshot_kind,access_email_normalized,payer_receipt_email,document_contact_email,
  desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,
  blocked_industries,search_breadth,guidance_requested,work_modes,us_state_or_dc,employment_types,
  schedules,travel,benefits,dealbreakers,salary_target_cents,salary_hard_minimum_cents,
  salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,
  salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,prior_cover_letter_use,
  targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at,confirmed_review
) values(
  'c1040002-0000-4000-8000-000000000009','c1040000-0000-4000-8000-000000000001',1,'INITIAL',
  'c104-chunk5-customer@example.invalid',null,'c104-chunk5-customer@example.invalid',
  '["COORDINATING_PROJECTS"]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,
  '["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',7000000,6000000,false,'YEAR','BASE',
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',
  repeat('4',64),'applypack-c14n-v1','applypack-intake-v4',clock_timestamp()-interval '2 days',jsonb_build_object('id',gen_random_uuid(),'contractVersion','applypack-confirmed-intake-v1','draftVersion',1,'sourceSha256',repeat('a',64),'reviewSha256',repeat('b',64),'answersSha256',repeat('c',64),'preparedAt',clock_timestamp(),'entryMode','NO_RESUME')
);

-- The current material source is a distinct immutable factual correction;
-- contact remains the exact separately confirmed original checkout receipt.
insert into public.ap_intake_snapshots
select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(s)||jsonb_build_object(
 'id','c1040002-0000-4000-8000-000000000001','version',2,'snapshot_kind','MATERIAL_FACT_REVISION',
 'parent_snapshot_id',s.id))).* from public.ap_intake_snapshots s where id='c1040002-0000-4000-8000-000000000009';

insert into public.jobs(
  id,company,title,source_url,location_text,salary_text,checked_at,listing_status,
  official_application_url,source_job_url,normalized_source_url,external_job_id,description,
  employment_type,w2_or_contractor,work_mode,pay_model,posted_at,last_verified_at,
  source_freshness_status,is_active,review_status,reviewed_by,reviewed_at
) values(
  'c1040003-0000-4000-8000-000000000001','Chunk 5 Fixture Employer','Operations Specialist',
  'https://chunk5-employer.example/jobs/1','Remote - United States','$70,000 annually',clock_timestamp(),
  'open','https://chunk5-employer.example/apply/1','https://chunk5-employer.example/jobs/1',
  'https://chunk5-employer.example/jobs/1','CHUNK5-REQ-1',
  'A resume and a cover letter are required. Upload PDF files. Each document must be one page. References are optional now. Apply through our secure HTTPS application form.',
  'w2_full_time','w2','remote_us_nationwide','salary',clock_timestamp()-interval '1 day',
  clock_timestamp()-interval '1 minute','fresh',true,'approved',
  'c1040000-0000-4000-8000-000000000003',clock_timestamp()
);

create temporary table c104_fixture_job_snapshot_input(
  id,legacy_job_id,origin,discovery_source,external_job_id,canonical_application_url,
  application_host_type,canonical_employer_listing_url,source_url,company,exact_title,
  normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,
  live_verified_at,compensation_text,compensation_source,location_and_work_mode,parser_version,
  content_sha256,source_authorization_id,first_seen_at,canonical_employer_domain,
  employer_identity_result,application_path_result,listing_activity_result,material_restrictions,
  fraud_signals,legitimacy_result,requirement_completeness,compensation_completeness,
  canonicalization_version,legacy_compatibility
) on commit drop as
with current_source as (
  select id from public.ap_source_authorizations
  where source_id='c104-manual-reviewed' and authorization_version='c104-zz-chunk-fixture'
)
select
  'c1040004-0000-4000-8000-000000000001','c1040003-0000-4000-8000-000000000001',
  'APPLYPACK_FOUND','c104-manual-reviewed','CHUNK5-REQ-1','https://chunk5-employer.example/apply/1',
  'EMPLOYER_HOSTED','https://chunk5-employer.example/jobs/1','https://chunk5-employer.example/jobs/1',
  'Chunk 5 Fixture Employer','Operations Specialist',repeat('7',64),
  '{"description":"Current reviewed operations role"}',clock_timestamp(),current_date,false,
  clock_timestamp()-interval '1 minute','$70,000 annually','EMPLOYER_LISTING',
  '{"mode":"REMOTE","location":"United States"}','listing-requirements-v3',repeat('8',64),
  current_source.id,clock_timestamp()-interval '1 day','chunk5-employer.example',
  'PASS','PASS','PASS','{}','{}','PASS',100,100,'applypack-c14n-v1',false
from current_source;

select pg_temp.verify_fixture_snapshot(to_jsonb(template),'c1040000-0000-4000-8000-000000000003')
from c104_fixture_job_snapshot_input template;
select pg_temp.assert_true(exists(select 1 from public.ap_current_source_verifications('c1040004-0000-4000-8000-000000000001')),
 'fixture manual review must create current immutable source evidence');

insert into public.ap_employer_submission_rules(
  id,job_snapshot_id,content_sha256,source_evidence_ids,resume_requirement,
  cover_letter_requirement,allowed_formats,resume_page_limit,cover_letter_page_limit,
  reference_timing,submission_channel,parser_version,injection_scan_state,
  human_confirmed_by,human_confirmed_at,checked_at
) values(
  'c104000d-0000-4000-8000-000000000001','c1040004-0000-4000-8000-000000000001',
  repeat('4',64),array['c1040004-0000-4000-8000-000000000001'::uuid],
  'REQUIRED','REQUIRED',array['PDF']::text[],1,1,'OPTIONAL_NOW','HTTPS_UPLOAD',
  'fixture-open-font-v1','CLEAR','c1040000-0000-4000-8000-000000000003',
  clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours'
);

insert into public.orders(
  id,customer_id,product_kind,amount_cents,status,paid_at,delivery_deadline,delivered_at,
  human_review_checklist,human_reviewed_by,human_reviewed_at
) values(
  'c1040001-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001',
  'job_search',2000,'delivered',clock_timestamp()-interval '3 days',
  clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',
  '{"approved":true}','c1040000-0000-4000-8000-000000000003',clock_timestamp()-interval '2 days'
);
insert into public.job_matches(
  id,search_order_id,job_id,position,fit_summary,requirements,concerns,delivered_at,
  matching_experience,primary_outcome,core_responsibilities,hidden_job_functions,
  reviewed_by,reviewed_at,release_explanation,allowed_unknown_warnings,source_provenance,
  compensation_status,posted_on,posted_date_unknown,last_checked_at
) values(
  'c1040005-0000-4000-8000-000000000001','c1040001-0000-4000-8000-000000000001',
  'c1040003-0000-4000-8000-000000000001',1,'Evidence-bound fit summary','[]','[]',
  clock_timestamp()-interval '2 days','["Operations coordination"]','Coordinate accurate operations',
  '["Maintain workflow records"]','[]','c1040000-0000-4000-8000-000000000003',
  clock_timestamp()-interval '2 days',
  '{"whatJobInvolves":"Coordinate operations","whyMadeList":"All gates passed","howExperienceConnects":"Confirmed coordination experience","whatMayBeNew":"Employer workflow","whatToKnow":"Use employer application path"}',
  '[]','{"authorization":"c104-manual-reviewed"}','PUBLISHED_MEETS_MINIMUM',current_date,false,
  clock_timestamp()-interval '2 days'
);

insert into public.ap_payment_attempts(
  id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,
  payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified
) values(
  'c1040006-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001',
  'stripe','c104-pi_chunk5_fixture',799,'USD','PAID','NONE',clock_timestamp()-interval '25 hours',
  'succeeded','card',true
);
insert into public.ap_material_purchases(
  id,customer_id,payment_attempt_id,amount_cents,currency,completed_at
) values(
  'c1040007-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001',
  'c1040006-0000-4000-8000-000000000001',799,'USD',clock_timestamp()-interval '25 hours'
);
insert into public.ap_material_lines(
  id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,
  allocated_amount_cents,readiness,fulfillment,substitution,selected_reference_sheet,active_revision,
  selection_confirmed_at,materials_payment_verified_at,materials_capacity_confirmed_at,
  materials_started_at,materials_due_at,earned_revenue_at
) values(
  'c104000b-0000-4000-8000-000000000001','c1040007-0000-4000-8000-000000000001',
  'c1040001-0000-4000-8000-000000000001','c1040005-0000-4000-8000-000000000001',
  'c1040006-0000-4000-8000-000000000001','c104-chunk5-payment-allocation-1',799,
  'CHECKOUT_ELIGIBLE','PAID','NONE',false,1,statement_timestamp()-interval '26 hours',
  statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',
  statement_timestamp()-interval '1 minute',statement_timestamp()+interval '23 hours 59 minutes',null
);
insert into public.ap_material_line_revisions(
  id,line_id,version,revision_kind,job_snapshot_id,source_snapshot_id,employer_rule_snapshot_id,binding_sha256,
  accepted_at,started_at,due_at
) values(
  'c104000c-0000-4000-8000-000000000001','c104000b-0000-4000-8000-000000000001',1,
  'ORIGINAL','c1040004-0000-4000-8000-000000000001','c1040002-0000-4000-8000-000000000001',
  'c104000d-0000-4000-8000-000000000001',repeat('b',64),
  statement_timestamp()-interval '1 minute',(select materials_started_at from public.ap_material_lines where id='c104000b-0000-4000-8000-000000000001'),
  (select materials_due_at from public.ap_material_lines where id='c104000b-0000-4000-8000-000000000001')
);


insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,
 source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,catalog_version,schema_version)
values('c1040003-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001',
 'c1040002-0000-4000-8000-000000000001','fixture.responsibility','RESPONSIBILITY','{"activity":"Maintained records"}',
 'CUSTOMER_ASSERTION','c1040002-0000-4000-8000-000000000001','fixture','fixture','CUSTOMER_CONFIRMED','fixture-v1','fixture-v1');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','c1040003-0000-4000-8000-000000000002','semantic_key','fixture.limited',
 'typed_value',jsonb_build_object('activity','Studying records management','completionStatus','IN_PROGRESS')))).*
from public.ap_candidate_facts f where id='c1040003-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','c1040003-0000-4000-8000-000000000003','semantic_key','fixture.negative','capability_status','NOT_DONE'))).*
from public.ap_candidate_facts f where id='c1040003-0000-4000-8000-000000000001';
insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
 content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
select ('c104000e-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c1040000-0000-4000-8000-000000000001',decode('0102','hex'),'AES-256-GCM',
 decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('33',16),'hex'),repeat(n::text,64),'fictional-fixture-kms','1',repeat('a',64)
from generate_series(1,5) n;
insert into public.ap_releases(id,customer_id,order_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
values('c1040008-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001','c1040001-0000-4000-8000-000000000001',
 'SEARCH_EXACT_TEN',statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days','{}','c1040000-0000-4000-8000-000000000003');
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,state,applied_at)
values('c1040009-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001','MATERIAL_CHECKOUT','stripe',repeat('a',64),'c104-fictional-draft-contact-checkout','APPLIED',clock_timestamp());
insert into public.ap_material_checkout_intents(id,customer_id,delivered_order_id,delivered_release_id,source_snapshot_id,contact_payload_id,purchase_id,payment_attempt_id,
 command_id,request_key,selection_sha256,line_count,amount_cents,currency,tax_inclusive,pricing_version,tax_version,career_break_choice,document_contact_confirmed,document_facts_confirmed,state,completed_at)
values('c104000a-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001','c1040001-0000-4000-8000-000000000001','c1040008-0000-4000-8000-000000000001',
 'c1040002-0000-4000-8000-000000000009','c104000e-0000-4000-8000-000000000005','c1040007-0000-4000-8000-000000000001','c1040006-0000-4000-8000-000000000001',
 'c1040009-0000-4000-8000-000000000001','c104-fictional-confirmed-contact',repeat('a',64),1,799,'USD',true,'fixture','fixture','KEEP_EXISTING_TIMELINE',true,true,'COMPLETED',clock_timestamp());
update public.ap_material_purchases set checkout_intent_id='c104000a-0000-4000-8000-000000000001' where id='c1040007-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','c104000e-0000-4000-8000-000000000005','snapshot_id','c1040002-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','c1040002-0000-4000-8000-000000000009','semantic_key','document_contact.confirmed','value_kind','PROTECTED_COMPOSITE',
 'typed_value',jsonb_build_object('protectedPayloadId','c104000e-0000-4000-8000-000000000005','contentSha256',repeat('5',64))))).*
from public.ap_candidate_facts f where id='c1040003-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','c1040003-0000-4000-8000-000000000009','snapshot_id','c1040002-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','c1040002-0000-4000-8000-000000000009'))).*
from public.ap_candidate_facts f where id='c1040003-0000-4000-8000-000000000001';
select pg_temp.assert_true(public.ap_material_draft_checkout_contact_matches('c104000b-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001',
 'c1040002-0000-4000-8000-000000000001','c104000e-0000-4000-8000-000000000005'),'exact checkout contact did not survive factual correction');
select pg_temp.assert_true(not public.ap_material_draft_checkout_contact_matches('c104000b-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001',
 'c1040002-0000-4000-8000-000000000001','c1040003-0000-4000-8000-000000000009'),'ordinary old fact received contact exception');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object('id','c104000e-0000-4000-8000-000000000004',
 'typed_value',jsonb_build_object('protectedPayloadId','c104000e-0000-4000-8000-000000000004','contentSha256',repeat('4',64))))).*
from public.ap_candidate_facts f where id='c104000e-0000-4000-8000-000000000005';
select pg_temp.assert_true(not public.ap_material_draft_checkout_contact_matches('c104000b-0000-4000-8000-000000000001','c1040000-0000-4000-8000-000000000001',
 'c1040002-0000-4000-8000-000000000001','c104000e-0000-4000-8000-000000000004'),'wrong protected payload received contact exception');

select set_config('employer_test.actor','c1040000-0000-4000-8000-000000000003',true), set_config('employer_test.customer','c1040000-0000-4000-8000-000000000001',true), set_config('employer_test.job','c1040004-0000-4000-8000-000000000001',true), set_config('employer_test.rule','c104000d-0000-4000-8000-000000000001',true), set_config('employer_test.line','c104000b-0000-4000-8000-000000000001',true);

-- Capture an actually valid103 paid context.104 must preserve these bytes,
-- even though its forward context function learns to ignore exact source-only nodes.
do $$ declare j public.ap_material_draft_jobs; basis jsonb; begin
 select * into j from public.ap_material_draft_jobs where material_line_id='c104000b-0000-4000-8000-000000000001';
 basis:=public.ap_material_draft_rule_evidence(j.id)->'basis';
 perform public.ap_record_material_draft_listing_check(j.id,null,'c104f004-0000-4000-8000-000000000001','BEFORE_GENERATION',basis->>'ruleSha256','ACTIVE','c1040000-0000-4000-8000-000000000003');
 basis:=public.ap_material_draft_rule_evidence(j.id)->'basis';
 perform public.ap_revalidate_material_draft_rule(j.id,null,'c104f006-0000-4000-8000-000000000001',basis,
 '{"applicationAccessReviewed":true,"liveListingOpened":true,"submissionInstructionsCompared":true,"unchangedRuleConfirmed":true}','c1040000-0000-4000-8000-000000000003');
 perform set_config('employer_test.paid_job',j.id::text,true);
 perform set_config('employer_test.paid_context',public.ap_material_draft_context_sha256(j.id),true);
end $$;
-- Model a genuine prior worker failure without discarding the paid obligation.
-- The existing API acquires its lease and records PROVIDER_UNAVAILABLE; no
-- provider attempt or budget reservation is created. Later current-contract
-- schedulers must leave this owner-held work intact, not claim it as their own.
do $$ declare j public.ap_material_draft_jobs; claimed jsonb; token uuid;
 line_before jsonb; revision_before jsonb; payment_before jsonb; attempts_before jsonb;
begin
 select * into j from public.ap_material_draft_jobs where id=current_setting('employer_test.paid_job')::uuid;
 select to_jsonb(l) into line_before from public.ap_material_lines l where id=j.material_line_id;
 select to_jsonb(r) into revision_before from public.ap_material_line_revisions r where id=j.line_revision_id;
 select to_jsonb(p) into payment_before from public.ap_payment_attempts p where id=(line_before->>'payment_attempt_id')::uuid;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into attempts_before from public.ap_material_draft_attempts a where job_id=j.id;
 perform pg_temp.assert_true(attempts_before='[]'::jsonb,'owner-held seed unexpectedly has provider attempts');
 claimed:=public.ap_claim_material_draft_jobs('c104f007-0000-4000-8000-000000000001',1);
 token:=(claimed->0->>'lease_token')::uuid;
 perform pg_temp.assert_true(jsonb_array_length(claimed)=1 and (claimed->0->>'id')::uuid=j.id and token is not null
  and (claimed->0->>'lease_owner')::uuid='c104f007-0000-4000-8000-000000000001','owner-held seed did not claim exact paid job');
 perform pg_temp.assert_true(public.ap_fail_material_draft_job(j.id,token,'PROVIDER_UNAVAILABLE')='OWNER_EXCEPTION','owner-held seed failure transition missing');
 perform pg_temp.assert_true((select state='OWNER_EXCEPTION' and error_code='PROVIDER_UNAVAILABLE' and lease_token is null
  and lease_expires_at is null and claim_count=j.claim_count+1 and lease_generation=j.lease_generation+1
  and active_version_id is not distinct from j.active_version_id from public.ap_material_draft_jobs where id=j.id),'owner-held seed lease/history incorrect');
 perform pg_temp.assert_true((select to_jsonb(l)=line_before from public.ap_material_lines l where id=j.material_line_id)
  and (select to_jsonb(r)=revision_before from public.ap_material_line_revisions r where id=j.line_revision_id)
  and (select to_jsonb(p)=payment_before from public.ap_payment_attempts p where id=(line_before->>'payment_attempt_id')::uuid)
  and (select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb)=attempts_before from public.ap_material_draft_attempts a where job_id=j.id)
  and public.ap_material_draft_context_sha256(j.id)=current_setting('employer_test.paid_context'),
  'owner-held seed changed paid obligation, deadline, provider spend or valid context');
end $$;
create table public.employer_rule_104_preservation_fixture(kind text,identity text,body_sha256 text);
do $$ declare item record; digest text; begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') and c.relname not in('ap_migration_checkpoints','ap_archive_fence_relations','ap_archive_fence_function_contracts','employer_rule_104_preservation_fixture') order by c.relname loop
 execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.relname) into digest;
 insert into public.employer_rule_104_preservation_fixture values('table',item.relname,digest); end loop;
 insert into public.employer_rule_104_preservation_fixture select 'function',p.oid::regprocedure::text,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('ap_material_draft_rule_evidence','ap_revalidate_material_draft_rule');
 insert into public.employer_rule_104_preservation_fixture values('paid_context',current_setting('employer_test.paid_job'),current_setting('employer_test.paid_context'));
 insert into public.employer_rule_104_preservation_fixture select 'checkpoint',migration_id||':'||checkpoint,encode(extensions.digest(to_jsonb(c)::text,'sha256'),'hex') from public.ap_migration_checkpoints c;
 insert into public.employer_rule_104_preservation_fixture select 'fence_relation',schema_name||'.'||table_name,encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex') from public.ap_archive_fence_relations r;
 insert into public.employer_rule_104_preservation_fixture select 'fence_function',signature,encode(extensions.digest(to_jsonb(f)::text,'sha256'),'hex') from public.ap_archive_fence_function_contracts f;
end $$;
commit;
select 'EMPLOYER_RULE_REVIEW_104_UPGRADE_SEEDED';

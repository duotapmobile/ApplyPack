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
  ('b1040000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b104-chunk5-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('b1040000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b104-chunk5-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('b1040000-0000-4000-8000-000000000003','00000000-0000-0000-8000-000000000000','authenticated','authenticated','b104-chunk5-reviewer@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='operator' where id='b1040000-0000-4000-8000-000000000003';

-- Included inside the calling fixture's rollback-only transaction. These .example
-- permissions are synthetic test evidence, never production source authorization.
insert into public.employers(id,display_name,source_category)
values('b104-fixture-reviewed-employer','b104 Synthetic reviewed source fixture','core_direct_employer');
insert into public.job_sources(id,canonical_employer_id,source_name,source_category,official_url,
 adapter_kind,automation_status,is_official,is_direct_employer,is_active,paid_display_permission_status)
values('b104-manual-reviewed','b104-fixture-reviewed-employer','b104 Synthetic rollback-only manual fixture','core_direct_employer',
 'https://chunk5-employer.example','official_link_only','official_link_only',true,true,true,'documented_paid_display_authorized')
on conflict(id) do update set canonical_employer_id=excluded.canonical_employer_id,is_active=true,
 paid_display_permission_status=excluded.paid_display_permission_status;
insert into public.ap_source_authorizations(source_id,source_display_name,state,access_method,evidence_reference,
 allowed_hosts,allowed_actions,verified_by_role,verified_at,authorization_version,content_sha256)
values('b104-manual-reviewed','b104 Synthetic rollback-only manual fixture','AUTHORIZED_MANUAL_ONLY','MANUAL',
 'tests/integration/reviewed-source-fixture.sql: synthetic authorization, transaction rolled back',
 array['chunk5-employer.example','employer1.example','employer2.example','employer3.example','employer4.example',
 'employer5.example','employer6.example','employer7.example','employer8.example','employer9.example','employer10.example'],
 array['MANUAL_REVIEW'],'operator',clock_timestamp(),'b104-zz-chunk-fixture',repeat('a',64));

create or replace function pg_temp.verify_fixture_snapshot(snapshot jsonb,actor uuid) returns uuid
language plpgsql as $$
declare payload jsonb; posting jsonb; review jsonb; nodes jsonb; authority uuid; revision bigint;
 body text:='A resume and a cover letter are required. Upload PDF files. Each document must be one page. References are optional now. Apply through our secure HTTPS application form.';
begin
 select id into authority from public.ap_source_authorizations
 where source_id='b104-manual-reviewed' and authorization_version='b104-zz-chunk-fixture';
 select h.revision into revision from public.ap_source_authorization_heads h where h.source_id='b104-manual-reviewed';
 if not exists(select 1 from public.ap_source_authorization_heads where source_id='b104-manual-reviewed' and current_authorization_id=authority) then
   perform public.ap_set_source_authorization_head('b104-manual-reviewed',authority,coalesce(revision,0),actor);
 end if;
 update public.jobs set source_id='b104-manual-reviewed',canonical_employer_id='b104-fixture-reviewed-employer',
  source_name='b104 Synthetic rollback-only manual fixture',source_category='core_direct_employer',
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
 return public.ap_verify_manual_source_observation(gen_random_uuid(),actor,'b104-manual-reviewed',posting,review,
  'requisition|b104-fixture-reviewed-employer|'||(payload->>'external_job_id'),snapshot,nodes,payload);
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
  'b1040002-0000-4000-8000-000000000009','b1040000-0000-4000-8000-000000000001',1,'INITIAL',
  'b104-chunk5-customer@example.invalid',null,'b104-chunk5-customer@example.invalid',
  '["COORDINATING_PROJECTS"]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,
  '["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',7000000,6000000,false,'YEAR','BASE',
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',
  repeat('4',64),'applypack-c14n-v1','applypack-intake-v4',clock_timestamp()-interval '2 days',jsonb_build_object('id',gen_random_uuid(),'contractVersion','applypack-confirmed-intake-v1','draftVersion',1,'sourceSha256',repeat('a',64),'reviewSha256',repeat('b',64),'answersSha256',repeat('c',64),'preparedAt',clock_timestamp(),'entryMode','NO_RESUME')
);

-- The current material source is a distinct immutable factual correction;
-- contact remains the exact separately confirmed original checkout receipt.
insert into public.ap_intake_snapshots
select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(s)||jsonb_build_object(
 'id','b1040002-0000-4000-8000-000000000001','version',2,'snapshot_kind','MATERIAL_FACT_REVISION',
 'parent_snapshot_id',s.id))).* from public.ap_intake_snapshots s where id='b1040002-0000-4000-8000-000000000009';

insert into public.jobs(
  id,company,title,source_url,location_text,salary_text,checked_at,listing_status,
  official_application_url,source_job_url,normalized_source_url,external_job_id,description,
  employment_type,w2_or_contractor,work_mode,pay_model,posted_at,last_verified_at,
  source_freshness_status,is_active,review_status,reviewed_by,reviewed_at
) values(
  'b1040003-0000-4000-8000-000000000001','Chunk 5 Fixture Employer','Operations Specialist',
  'https://chunk5-employer.example/jobs/1','Remote - United States','$70,000 annually',clock_timestamp(),
  'open','https://chunk5-employer.example/apply/1','https://chunk5-employer.example/jobs/1',
  'https://chunk5-employer.example/jobs/1','CHUNK5-REQ-1',
  'A resume and a cover letter are required. Upload PDF files. Each document must be one page. References are optional now. Apply through our secure HTTPS application form.',
  'w2_full_time','w2','remote_us_nationwide','salary',clock_timestamp()-interval '1 day',
  clock_timestamp()-interval '1 minute','fresh',true,'approved',
  'b1040000-0000-4000-8000-000000000003',clock_timestamp()
);

create temporary table b104_fixture_job_snapshot_input(
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
  where source_id='b104-manual-reviewed' and authorization_version='b104-zz-chunk-fixture'
)
select
  'b1040004-0000-4000-8000-000000000001','b1040003-0000-4000-8000-000000000001',
  'APPLYPACK_FOUND','b104-manual-reviewed','CHUNK5-REQ-1','https://chunk5-employer.example/apply/1',
  'EMPLOYER_HOSTED','https://chunk5-employer.example/jobs/1','https://chunk5-employer.example/jobs/1',
  'Chunk 5 Fixture Employer','Operations Specialist',repeat('7',64),
  '{"description":"Current reviewed operations role"}',clock_timestamp(),current_date,false,
  clock_timestamp()-interval '1 minute','$70,000 annually','EMPLOYER_LISTING',
  '{"mode":"REMOTE","location":"United States"}','listing-requirements-v3',repeat('8',64),
  current_source.id,clock_timestamp()-interval '1 day','chunk5-employer.example',
  'PASS','PASS','PASS','{}','{}','PASS',100,100,'applypack-c14n-v1',false
from current_source;

select pg_temp.verify_fixture_snapshot(to_jsonb(template),'b1040000-0000-4000-8000-000000000003')
from b104_fixture_job_snapshot_input template;
select pg_temp.assert_true(exists(select 1 from public.ap_current_source_verifications('b1040004-0000-4000-8000-000000000001')),
 'fixture manual review must create current immutable source evidence');

insert into public.ap_employer_submission_rules(
  id,job_snapshot_id,content_sha256,source_evidence_ids,resume_requirement,
  cover_letter_requirement,allowed_formats,resume_page_limit,cover_letter_page_limit,
  reference_timing,submission_channel,parser_version,injection_scan_state,
  human_confirmed_by,human_confirmed_at,checked_at
) values(
  'b104000d-0000-4000-8000-000000000001','b1040004-0000-4000-8000-000000000001',
  repeat('4',64),array['b1040004-0000-4000-8000-000000000001'::uuid],
  'REQUIRED','REQUIRED',array['PDF']::text[],1,1,'OPTIONAL_NOW','HTTPS_UPLOAD',
  'fixture-open-font-v1','CLEAR','b1040000-0000-4000-8000-000000000003',
  clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours'
);

insert into public.orders(
  id,customer_id,product_kind,amount_cents,status,paid_at,delivery_deadline,delivered_at,
  human_review_checklist,human_reviewed_by,human_reviewed_at
) values(
  'b1040001-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001',
  'job_search',2000,'delivered',clock_timestamp()-interval '3 days',
  clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',
  '{"approved":true}','b1040000-0000-4000-8000-000000000003',clock_timestamp()-interval '2 days'
);
insert into public.job_matches(
  id,search_order_id,job_id,position,fit_summary,requirements,concerns,delivered_at,
  matching_experience,primary_outcome,core_responsibilities,hidden_job_functions,
  reviewed_by,reviewed_at,release_explanation,allowed_unknown_warnings,source_provenance,
  compensation_status,posted_on,posted_date_unknown,last_checked_at
) values(
  'b1040005-0000-4000-8000-000000000001','b1040001-0000-4000-8000-000000000001',
  'b1040003-0000-4000-8000-000000000001',1,'Evidence-bound fit summary','[]','[]',
  clock_timestamp()-interval '2 days','["Operations coordination"]','Coordinate accurate operations',
  '["Maintain workflow records"]','[]','b1040000-0000-4000-8000-000000000003',
  clock_timestamp()-interval '2 days',
  '{"whatJobInvolves":"Coordinate operations","whyMadeList":"All gates passed","howExperienceConnects":"Confirmed coordination experience","whatMayBeNew":"Employer workflow","whatToKnow":"Use employer application path"}',
  '[]','{"authorization":"b104-manual-reviewed"}','PUBLISHED_MEETS_MINIMUM',current_date,false,
  clock_timestamp()-interval '2 days'
);

insert into public.ap_payment_attempts(
  id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,
  payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified
) values(
  'b1040006-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001',
  'stripe','b104-pi_chunk5_fixture',799,'USD','PAID','NONE',clock_timestamp()-interval '25 hours',
  'succeeded','card',true
);
insert into public.ap_material_purchases(
  id,customer_id,payment_attempt_id,amount_cents,currency,completed_at
) values(
  'b1040007-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001',
  'b1040006-0000-4000-8000-000000000001',799,'USD',clock_timestamp()-interval '25 hours'
);
insert into public.ap_material_lines(
  id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,
  allocated_amount_cents,readiness,fulfillment,substitution,selected_reference_sheet,active_revision,
  selection_confirmed_at,materials_payment_verified_at,materials_capacity_confirmed_at,
  materials_started_at,materials_due_at,earned_revenue_at
) values(
  'b104000b-0000-4000-8000-000000000001','b1040007-0000-4000-8000-000000000001',
  'b1040001-0000-4000-8000-000000000001','b1040005-0000-4000-8000-000000000001',
  'b1040006-0000-4000-8000-000000000001','b104-chunk5-payment-allocation-1',799,
  'CHECKOUT_ELIGIBLE','PAID','NONE',false,1,statement_timestamp()-interval '26 hours',
  statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',
  statement_timestamp()-interval '1 minute',statement_timestamp()+interval '23 hours 59 minutes',null
);
insert into public.ap_material_line_revisions(
  id,line_id,version,revision_kind,job_snapshot_id,source_snapshot_id,employer_rule_snapshot_id,binding_sha256,
  accepted_at,started_at,due_at
) values(
  'b104000c-0000-4000-8000-000000000001','b104000b-0000-4000-8000-000000000001',1,
  'ORIGINAL','b1040004-0000-4000-8000-000000000001','b1040002-0000-4000-8000-000000000001',
  'b104000d-0000-4000-8000-000000000001',repeat('b',64),
  statement_timestamp()-interval '1 minute',(select materials_started_at from public.ap_material_lines where id='b104000b-0000-4000-8000-000000000001'),
  (select materials_due_at from public.ap_material_lines where id='b104000b-0000-4000-8000-000000000001')
);


insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,
 source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,catalog_version,schema_version)
values('b1040003-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001',
 'b1040002-0000-4000-8000-000000000001','fixture.responsibility','RESPONSIBILITY','{"activity":"Maintained records"}',
 'CUSTOMER_ASSERTION','b1040002-0000-4000-8000-000000000001','fixture','fixture','CUSTOMER_CONFIRMED','fixture-v1','fixture-v1');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','b1040003-0000-4000-8000-000000000002','semantic_key','fixture.limited',
 'typed_value',jsonb_build_object('activity','Studying records management','completionStatus','IN_PROGRESS')))).*
from public.ap_candidate_facts f where id='b1040003-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','b1040003-0000-4000-8000-000000000003','semantic_key','fixture.negative','capability_status','NOT_DONE'))).*
from public.ap_candidate_facts f where id='b1040003-0000-4000-8000-000000000001';
insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
 content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
select ('b104000e-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b1040000-0000-4000-8000-000000000001',decode('0102','hex'),'AES-256-GCM',
 decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('33',16),'hex'),repeat(n::text,64),'fictional-fixture-kms','1',repeat('a',64)
from generate_series(1,5) n;
insert into public.ap_releases(id,customer_id,order_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
values('b1040008-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001','b1040001-0000-4000-8000-000000000001',
 'SEARCH_EXACT_TEN',statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days','{}','b1040000-0000-4000-8000-000000000003');
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,state,applied_at)
values('b1040009-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001','MATERIAL_CHECKOUT','stripe',repeat('a',64),'b104-fictional-draft-contact-checkout','APPLIED',clock_timestamp());
insert into public.ap_material_checkout_intents(id,customer_id,delivered_order_id,delivered_release_id,source_snapshot_id,contact_payload_id,purchase_id,payment_attempt_id,
 command_id,request_key,selection_sha256,line_count,amount_cents,currency,tax_inclusive,pricing_version,tax_version,career_break_choice,document_contact_confirmed,document_facts_confirmed,state,completed_at)
values('b104000a-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001','b1040001-0000-4000-8000-000000000001','b1040008-0000-4000-8000-000000000001',
 'b1040002-0000-4000-8000-000000000009','b104000e-0000-4000-8000-000000000005','b1040007-0000-4000-8000-000000000001','b1040006-0000-4000-8000-000000000001',
 'b1040009-0000-4000-8000-000000000001','b104-fictional-confirmed-contact',repeat('a',64),1,799,'USD',true,'fixture','fixture','KEEP_EXISTING_TIMELINE',true,true,'COMPLETED',clock_timestamp());
update public.ap_material_purchases set checkout_intent_id='b104000a-0000-4000-8000-000000000001' where id='b1040007-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','b104000e-0000-4000-8000-000000000005','snapshot_id','b1040002-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','b1040002-0000-4000-8000-000000000009','semantic_key','document_contact.confirmed','value_kind','PROTECTED_COMPOSITE',
 'typed_value',jsonb_build_object('protectedPayloadId','b104000e-0000-4000-8000-000000000005','contentSha256',repeat('5',64))))).*
from public.ap_candidate_facts f where id='b1040003-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','b1040003-0000-4000-8000-000000000009','snapshot_id','b1040002-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','b1040002-0000-4000-8000-000000000009'))).*
from public.ap_candidate_facts f where id='b1040003-0000-4000-8000-000000000001';
select pg_temp.assert_true(public.ap_material_draft_checkout_contact_matches('b104000b-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001',
 'b1040002-0000-4000-8000-000000000001','b104000e-0000-4000-8000-000000000005'),'exact checkout contact did not survive factual correction');
select pg_temp.assert_true(not public.ap_material_draft_checkout_contact_matches('b104000b-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001',
 'b1040002-0000-4000-8000-000000000001','b1040003-0000-4000-8000-000000000009'),'ordinary old fact received contact exception');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object('id','b104000e-0000-4000-8000-000000000004',
 'typed_value',jsonb_build_object('protectedPayloadId','b104000e-0000-4000-8000-000000000004','contentSha256',repeat('4',64))))).*
from public.ap_candidate_facts f where id='b104000e-0000-4000-8000-000000000005';
select pg_temp.assert_true(not public.ap_material_draft_checkout_contact_matches('b104000b-0000-4000-8000-000000000001','b1040000-0000-4000-8000-000000000001',
 'b1040002-0000-4000-8000-000000000001','b104000e-0000-4000-8000-000000000004'),'wrong protected payload received contact exception');

select set_config('employer_test.actor','b1040000-0000-4000-8000-000000000003',true), set_config('employer_test.customer','b1040000-0000-4000-8000-000000000001',true), set_config('employer_test.job','b1040004-0000-4000-8000-000000000001',true), set_config('employer_test.rule','b104000d-0000-4000-8000-000000000001',true), set_config('employer_test.line','b104000b-0000-4000-8000-000000000001',true);

create or replace function pg_temp.employer_checklist() returns jsonb language sql as $$
 select '{"applicationOpened":true,"listingOpened":true,"noUnsupportedDefaults":true,"questionsReviewed":true,"requirementsConfirmed":true,"sourceCompared":true}'::jsonb;
$$;
create or replace function pg_temp.employer_citations(evidence_id uuid,rules jsonb) returns jsonb language plpgsql as $$
declare body bytea; citations jsonb; begin
 select convert_to(source_excerpt,'UTF8') into body from public.ap_requirement_nodes where id=evidence_id;
 select jsonb_agg(jsonb_build_object('field',key,'startByte',0,'endByte',octet_length(body),'quoteSha256',encode(extensions.digest(body,'sha256'),'hex')) order by key)
 into citations from jsonb_each(rules) item where key=any(array['resumeRequirement','coverLetterRequirement','allowedFormats','submissionChannel','resumePageLimit','coverLetterPageLimit',
 'resumeFilenameInstruction','coverLetterFilenameInstruction','referenceFilenameInstruction','referenceTiming','referenceCount','portfolioInstruction','workSampleInstruction'])
 and item.value<>'null'::jsonb and not(key='referenceTiming' and item.value='"LATER_OR_UNKNOWN"'::jsonb);
 return jsonb_build_object('version','applypack-employer-rule-citations-v1','sourceEvidenceId',evidence_id,
 'sourceTextSha256',encode(extensions.digest(body,'sha256'),'hex'),'citations',citations);
end $$;
-- A distinct permitted source observation, not an UPDATE of the paid snapshot.
create or replace function pg_temp.new_employer_job(suffix integer) returns uuid language plpgsql as $$
declare legacy_id uuid:=('b104f001-0000-4000-8000-'||lpad(suffix::text,12,'0'))::uuid;
 snapshot_id uuid:=('b104f002-0000-4000-8000-'||lpad(suffix::text,12,'0'))::uuid; snapshot jsonb; job_input jsonb; writable_columns text;
 listing_url text:='https://chunk5-employer.example/jobs/employer-rule-'||suffix;
 application_url text:='https://chunk5-employer.example/apply/employer-rule-'||suffix;
begin
 select to_jsonb(j)||jsonb_build_object('id',legacy_id,
 'source_url',listing_url,'source_job_url',listing_url,'normalized_source_url',listing_url,'official_application_url',application_url,
 'external_job_id','EMPLOYER-RULE-'||suffix,'deduplication_key',encode(extensions.digest(suffix::text,'sha256'),'hex')) into job_input
 from public.jobs j where id='b1040003-0000-4000-8000-000000000001';
 select string_agg(quote_ident(attname),',' order by attnum) into writable_columns from pg_attribute
 where attrelid='public.jobs'::regclass and attnum>0 and not attisdropped and attgenerated='' and attidentity='';
 execute format('insert into public.jobs(%s) select %s from jsonb_populate_record(null::public.jobs,$1) r',writable_columns,writable_columns) using job_input;
 select to_jsonb(j)||jsonb_build_object('id',snapshot_id,'legacy_job_id',legacy_id,'external_job_id','EMPLOYER-RULE-'||suffix,
 'canonical_application_url',application_url,'canonical_employer_listing_url',listing_url,'source_url',listing_url,
 'normalized_fingerprint',encode(extensions.digest('employer-rule-'||suffix,'sha256'),'hex')) into snapshot from b104_fixture_job_snapshot_input j;
 return pg_temp.verify_fixture_snapshot(snapshot,current_setting('employer_test.actor')::uuid);
end $$;

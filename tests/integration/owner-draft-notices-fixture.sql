-- Re-including this helper preserves every committed upgrade row and function.
-- An existing install must have exactly the same source and function definitions.
do $install_fixture$ declare definitions jsonb; begin
 if to_regnamespace('owner_notice_fixture') is not null then
  if to_regclass('owner_notice_fixture.installation') is null then raise exception 'owner_notice_fixture_foreign_schema'; end if;
  select jsonb_object_agg(p.proname,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')) into definitions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='owner_notice_fixture';
  if not exists(select 1 from owner_notice_fixture.installation where source_sha256='2783fed95a54c90fd96f4aa27b7387f38a56587d3a43ccd696993b2e45422c22' and function_sha256=definitions) then raise exception 'owner_notice_fixture_install_changed'; end if;
  return;
 end if;
 execute $installation_source$-- Synthetic SQL contract graph derived from material-draft-pair-workflow.sql.
-- No real model, crypto, rendering, owner decision, provider or customer delivery is asserted.
-- Every namespace creates an independent graph through actual draft RPCs, all guards enabled.
create schema owner_notice_fixture;
create function owner_notice_fixture.assert_true(value boolean,message text) returns void language plpgsql as $$ begin if value is not true then raise exception '%',message; end if; end $$;
create function owner_notice_fixture.reject(command text,expected text) returns void language plpgsql as $$ begin begin execute command; exception when others then if sqlerrm=expected then return; end if; raise; end; raise exception 'expected rejection: %',expected; end $$;
create table owner_notice_fixture.state(namespace text primary key,customer_id uuid,operator_id uuid,line_id uuid,job_id uuid,lease_token uuid,version_id uuid,context_sha256 text,policy_id uuid,claim_id uuid,request_id uuid,deadline timestamptz,member_sha256 text);
create function owner_notice_fixture.seed(p_namespace text,p_references boolean default false,p_retention boolean default false) returns void language plpgsql as $seed_fn$ declare seed_text text; begin
 if p_namespace!~'^[a-f][0-9]{3}$' or p_namespace is null then raise exception 'invalid fixture namespace'; end if;
 seed_text:=replace($seed_sql$insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('@NS@0001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','notice-@NS@-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('@NS@0001-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','notice-@NS@-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('@NS@0001-0000-4000-8000-000000000003','00000000-0000-0000-8000-000000000000','authenticated','authenticated','notice-@NS@-reviewer@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='operator' where id='@NS@0001-0000-4000-8000-000000000003';

-- Included inside the calling fixture's rollback-only transaction. These .example
-- permissions are synthetic test evidence, never production source authorization.
insert into public.employers(id,display_name,source_category)
values('notice-@NS@-reviewed-employer','Synthetic owner notice @NS@ source','core_direct_employer');
insert into public.job_sources(id,canonical_employer_id,source_name,source_category,official_url,
 adapter_kind,automation_status,is_official,is_direct_employer,is_active,paid_display_permission_status)
values('notice-@NS@-manual','notice-@NS@-reviewed-employer','Synthetic owner notice @NS@ manual fixture','core_direct_employer',
 'https://notice-@NS@-employer.example','official_link_only','official_link_only',true,true,true,'documented_paid_display_authorized')
on conflict(id) do update set canonical_employer_id=excluded.canonical_employer_id,is_active=true,
 paid_display_permission_status=excluded.paid_display_permission_status;
insert into public.ap_source_authorizations(source_id,source_display_name,state,access_method,evidence_reference,
 allowed_hosts,allowed_actions,verified_by_role,verified_at,authorization_version,content_sha256)
values('notice-@NS@-manual','Synthetic owner notice @NS@ manual fixture','AUTHORIZED_MANUAL_ONLY','MANUAL',
 'tests/integration/reviewed-source-fixture.sql: synthetic authorization, transaction rolled back',
 array['notice-@NS@-employer.example','employer1.example','employer2.example','employer3.example','employer4.example',
 'employer5.example','employer6.example','employer7.example','employer8.example','employer9.example','employer10.example'],
 array['MANUAL_REVIEW'],'operator',clock_timestamp(),'zz-owner-notice-@NS@',repeat('a',64));

create or replace function pg_temp.verify_fixture_snapshot(snapshot jsonb,actor uuid) returns uuid
language plpgsql as $$
declare payload jsonb; posting jsonb; review jsonb; nodes jsonb; authority uuid; revision bigint;
 body text:='Current reviewed operations role with an employer-hosted application path.';
begin
 select id into authority from public.ap_source_authorizations
 where source_id='notice-@NS@-manual' and authorization_version='zz-owner-notice-@NS@';
 select h.revision into revision from public.ap_source_authorization_heads h where h.source_id='notice-@NS@-manual';
 if not exists(select 1 from public.ap_source_authorization_heads where source_id='notice-@NS@-manual' and current_authorization_id=authority) then
   perform public.ap_set_source_authorization_head('notice-@NS@-manual',authority,coalesce(revision,0),actor);
 end if;
 update public.jobs set source_id='notice-@NS@-manual',canonical_employer_id='notice-@NS@-reviewed-employer',
  source_name='Synthetic owner notice @NS@ manual fixture',source_category='core_direct_employer',
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
 return public.ap_verify_manual_source_observation(gen_random_uuid(),actor,'notice-@NS@-manual',posting,review,
  'requisition|notice-@NS@-reviewed-employer|'||(payload->>'external_job_id'),snapshot,nodes,payload);
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
  '@NS@0002-0000-4000-8000-000000000009','@NS@0001-0000-4000-8000-000000000001',1,'INITIAL',
  'notice-@NS@-customer@example.invalid',null,'notice-@NS@-customer@example.invalid',
  '["COORDINATING_PROJECTS"]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,
  '["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',7000000,6000000,false,'YEAR','BASE',
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',
  repeat('4',64),'applypack-c14n-v1','applypack-intake-v4',clock_timestamp()-interval '2 days',jsonb_build_object('id',gen_random_uuid(),'contractVersion','applypack-confirmed-intake-v1','draftVersion',1,'sourceSha256',repeat('a',64),'reviewSha256',repeat('b',64),'answersSha256',repeat('c',64),'preparedAt',clock_timestamp(),'entryMode','NO_RESUME')
);

-- The current material source is a distinct immutable factual correction;
-- contact remains the exact separately confirmed original checkout receipt.
insert into public.ap_intake_snapshots
select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(s)||jsonb_build_object(
 'id','@NS@0002-0000-4000-8000-000000000001','version',2,'snapshot_kind','MATERIAL_FACT_REVISION',
 'parent_snapshot_id',s.id))).* from public.ap_intake_snapshots s where id='@NS@0002-0000-4000-8000-000000000009';

insert into public.jobs(
  id,company,title,source_url,location_text,salary_text,checked_at,listing_status,
  official_application_url,source_job_url,normalized_source_url,external_job_id,description,
  employment_type,w2_or_contractor,work_mode,pay_model,posted_at,last_verified_at,
  source_freshness_status,is_active,review_status,reviewed_by,reviewed_at
) values(
  '@NS@0003-0000-4000-8000-000000000001','Owner Notice @NS@ Fixture Employer','Operations Specialist',
  'https://notice-@NS@-employer.example/jobs/1','Remote - United States','$70,000 annually',clock_timestamp(),
  'open','https://notice-@NS@-employer.example/apply/1','https://notice-@NS@-employer.example/jobs/1',
  'https://notice-@NS@-employer.example/jobs/1','NOTICE-@NS@-REQ-1',
  'Current reviewed operations role with an employer-hosted application path.',
  'w2_full_time','w2','remote_us_nationwide','salary',clock_timestamp()-interval '1 day',
  clock_timestamp()-interval '1 minute','fresh',true,'approved',
  '@NS@0001-0000-4000-8000-000000000003',clock_timestamp()
);

create temporary table notice_@NS@_snapshot_input(
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
  where source_id='notice-@NS@-manual' and authorization_version='zz-owner-notice-@NS@'
)
select
  '@NS@0004-0000-4000-8000-000000000001','@NS@0003-0000-4000-8000-000000000001',
  'APPLYPACK_FOUND','notice-@NS@-manual','NOTICE-@NS@-REQ-1','https://notice-@NS@-employer.example/apply/1',
  'EMPLOYER_HOSTED','https://notice-@NS@-employer.example/jobs/1','https://notice-@NS@-employer.example/jobs/1',
  'Owner Notice @NS@ Fixture Employer','Operations Specialist',encode(extensions.digest('owner-notice-@NS@-fingerprint','sha256'),'hex'),
  '{"description":"Current reviewed operations role"}',clock_timestamp(),current_date,false,
  clock_timestamp()-interval '1 minute','$70,000 annually','EMPLOYER_LISTING',
  '{"mode":"REMOTE","location":"United States"}','listing-requirements-v3',repeat('8',64),
  current_source.id,clock_timestamp()-interval '1 day','notice-@NS@-employer.example',
  'PASS','PASS','PASS','{}','{}','PASS',100,100,'applypack-c14n-v1',false
from current_source;

select pg_temp.verify_fixture_snapshot(to_jsonb(template),'@NS@0001-0000-4000-8000-000000000003')
from notice_@NS@_snapshot_input template;
select owner_notice_fixture.assert_true(exists(select 1 from public.ap_current_source_verifications('@NS@0004-0000-4000-8000-000000000001')),
 'fixture manual review must create current immutable source evidence');

insert into public.ap_employer_submission_rules(
  id,job_snapshot_id,content_sha256,source_evidence_ids,resume_requirement,
  cover_letter_requirement,allowed_formats,resume_page_limit,cover_letter_page_limit,
  reference_timing,submission_channel,parser_version,injection_scan_state,
  human_confirmed_by,human_confirmed_at,checked_at
) values(
  '@NS@0005-0000-4000-8000-000000000001','@NS@0004-0000-4000-8000-000000000001',
  repeat('4',64),array['@NS@0004-0000-4000-8000-000000000001'::uuid],
  'REQUIRED','REQUIRED',array['PDF']::text[],1,1,'OPTIONAL_NOW','HTTPS_UPLOAD',
  'fixture-open-font-v1','CLEAR','@NS@0001-0000-4000-8000-000000000003',
  clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '10 minutes'
);

insert into public.orders(
  id,customer_id,product_kind,amount_cents,status,paid_at,delivery_deadline,delivered_at,
  human_review_checklist,human_reviewed_by,human_reviewed_at
) values(
  '@NS@0006-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
  'job_search',2000,'delivered',clock_timestamp()-interval '3 days',
  clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',
  '{"approved":true}','@NS@0001-0000-4000-8000-000000000003',clock_timestamp()-interval '2 days'
);
insert into public.job_matches(
  id,search_order_id,job_id,position,fit_summary,requirements,concerns,delivered_at,
  matching_experience,primary_outcome,core_responsibilities,hidden_job_functions,
  reviewed_by,reviewed_at,release_explanation,allowed_unknown_warnings,source_provenance,
  compensation_status,posted_on,posted_date_unknown,last_checked_at
) values(
  '@NS@0007-0000-4000-8000-000000000001','@NS@0006-0000-4000-8000-000000000001',
  '@NS@0003-0000-4000-8000-000000000001',1,'Evidence-bound fit summary','[]','[]',
  clock_timestamp()-interval '2 days','["Operations coordination"]','Coordinate accurate operations',
  '["Maintain workflow records"]','[]','@NS@0001-0000-4000-8000-000000000003',
  clock_timestamp()-interval '2 days',
  '{"whatJobInvolves":"Coordinate operations","whyMadeList":"All gates passed","howExperienceConnects":"Confirmed coordination experience","whatMayBeNew":"Employer workflow","whatToKnow":"Use employer application path"}',
  '[]','{"authorization":"notice-@NS@-manual"}','PUBLISHED_MEETS_MINIMUM',current_date,false,
  clock_timestamp()-interval '2 days'
);

insert into public.ap_payment_attempts(
  id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,
  payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified
) values(
  '@NS@0008-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
  'stripe','pi_notice-@NS@_fixture',799,'USD','PAID','NONE',clock_timestamp()-interval '25 hours',
  'succeeded','card',true
);
insert into public.ap_material_purchases(
  id,customer_id,payment_attempt_id,amount_cents,currency,completed_at
) values(
  '@NS@0009-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
  '@NS@0008-0000-4000-8000-000000000001',799,'USD',clock_timestamp()-interval '25 hours'
);
insert into public.ap_material_lines(
  id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,
  allocated_amount_cents,readiness,fulfillment,substitution,selected_reference_sheet,active_revision,
  selection_confirmed_at,materials_payment_verified_at,materials_capacity_confirmed_at,
  materials_started_at,materials_due_at,earned_revenue_at
) values(
  '@NS@000a-0000-4000-8000-000000000001','@NS@0009-0000-4000-8000-000000000001',
  '@NS@0006-0000-4000-8000-000000000001','@NS@0007-0000-4000-8000-000000000001',
  '@NS@0008-0000-4000-8000-000000000001','notice-@NS@-payment-allocation-1',799,
  'CHECKOUT_ELIGIBLE','PAID','NONE',false,1,statement_timestamp()-interval '26 hours',
  statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',
  statement_timestamp()-interval '1 minute',statement_timestamp()+interval '23 hours 59 minutes',null
);
insert into public.ap_material_line_revisions(
  id,line_id,version,revision_kind,job_snapshot_id,source_snapshot_id,employer_rule_snapshot_id,binding_sha256,
  accepted_at,started_at,due_at
) values(
  '@NS@000b-0000-4000-8000-000000000001','@NS@000a-0000-4000-8000-000000000001',1,
  'ORIGINAL','@NS@0004-0000-4000-8000-000000000001','@NS@0002-0000-4000-8000-000000000001',
  '@NS@0005-0000-4000-8000-000000000001',repeat('b',64),
  statement_timestamp()-interval '1 minute',(select materials_started_at from public.ap_material_lines where id='@NS@000a-0000-4000-8000-000000000001'),
  (select materials_due_at from public.ap_material_lines where id='@NS@000a-0000-4000-8000-000000000001')
);

insert into public.ap_material_listing_checks(material_line_id,line_revision_id,phase,job_snapshot_id,submission_rule_id,result,checked_by,checked_at,evidence_sha256)
values('@NS@000a-0000-4000-8000-000000000001','@NS@000b-0000-4000-8000-000000000001','BEFORE_GENERATION',
 '@NS@0004-0000-4000-8000-000000000001','@NS@0005-0000-4000-8000-000000000001','ACTIVE','@NS@0001-0000-4000-8000-000000000003',clock_timestamp(),repeat('4',64));
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,
 source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,catalog_version,schema_version)
values('@NS@0003-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000001','fixture.responsibility','RESPONSIBILITY','{"activity":"Maintained records"}',
 'CUSTOMER_ASSERTION','@NS@0002-0000-4000-8000-000000000001','fixture','fixture','CUSTOMER_CONFIRMED','fixture-v1','fixture-v1');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','@NS@0003-0000-4000-8000-000000000002','semantic_key','fixture.limited',
 'typed_value',jsonb_build_object('activity','Studying records management','completionStatus','IN_PROGRESS')))).*
from public.ap_candidate_facts f where id='@NS@0003-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','@NS@0003-0000-4000-8000-000000000003','semantic_key','fixture.negative','capability_status','NOT_DONE'))).*
from public.ap_candidate_facts f where id='@NS@0003-0000-4000-8000-000000000001';
insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
 content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
select ('@NS@000c-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'@NS@0001-0000-4000-8000-000000000001',decode('0102','hex'),'AES-256-GCM',
 decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('33',16),'hex'),repeat(n::text,64),'fictional-fixture-kms','1',repeat('a',64)
from generate_series(1,5) n;
insert into public.ap_releases(id,customer_id,order_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
values('@NS@000d-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','@NS@0006-0000-4000-8000-000000000001',
 'SEARCH_EXACT_TEN',statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days','{}','@NS@0001-0000-4000-8000-000000000003');
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,state,applied_at)
values('@NS@000e-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','MATERIAL_CHECKOUT','stripe',repeat('a',64),'owner-notice-@NS@-contact-checkout','APPLIED',clock_timestamp());
insert into public.ap_material_checkout_intents(id,customer_id,delivered_order_id,delivered_release_id,source_snapshot_id,contact_payload_id,purchase_id,payment_attempt_id,
 command_id,request_key,selection_sha256,line_count,amount_cents,currency,tax_inclusive,pricing_version,tax_version,career_break_choice,document_contact_confirmed,document_facts_confirmed,state,completed_at)
values('@NS@000f-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','@NS@0006-0000-4000-8000-000000000001','@NS@000d-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000009','@NS@000c-0000-4000-8000-000000000005','@NS@0009-0000-4000-8000-000000000001','@NS@0008-0000-4000-8000-000000000001',
 '@NS@000e-0000-4000-8000-000000000001','owner-notice-@NS@-confirmed-contact',repeat('a',64),1,799,'USD',true,'fixture','fixture','KEEP_EXISTING_TIMELINE',true,true,'COMPLETED',clock_timestamp());
update public.ap_material_purchases set checkout_intent_id='@NS@000f-0000-4000-8000-000000000001' where id='@NS@0009-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','@NS@000c-0000-4000-8000-000000000005','snapshot_id','@NS@0002-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','@NS@0002-0000-4000-8000-000000000009','semantic_key','document_contact.confirmed','value_kind','PROTECTED_COMPOSITE',
 'typed_value',jsonb_build_object('protectedPayloadId','@NS@000c-0000-4000-8000-000000000005','contentSha256',repeat('5',64))))).*
from public.ap_candidate_facts f where id='@NS@0003-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','@NS@0003-0000-4000-8000-000000000009','snapshot_id','@NS@0002-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','@NS@0002-0000-4000-8000-000000000009'))).*
from public.ap_candidate_facts f where id='@NS@0003-0000-4000-8000-000000000001';
select owner_notice_fixture.assert_true(public.ap_material_draft_checkout_contact_matches('@NS@000a-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000001','@NS@000c-0000-4000-8000-000000000005'),'exact checkout contact did not survive factual correction');
select owner_notice_fixture.assert_true(not public.ap_material_draft_checkout_contact_matches('@NS@000a-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000001','@NS@0003-0000-4000-8000-000000000009'),'ordinary old fact received contact exception');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object('id','@NS@000c-0000-4000-8000-000000000004',
 'typed_value',jsonb_build_object('protectedPayloadId','@NS@000c-0000-4000-8000-000000000004','contentSha256',repeat('4',64))))).*
from public.ap_candidate_facts f where id='@NS@000c-0000-4000-8000-000000000005';
select owner_notice_fixture.assert_true(not public.ap_material_draft_checkout_contact_matches('@NS@000a-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000001','@NS@000c-0000-4000-8000-000000000004'),'wrong protected payload received contact exception');
$seed_sql$,'@NS@',p_namespace);
 if p_retention then seed_text:=replace($retention_graph$insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('@NS@0001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','notice-@NS@-customer@example.invalid','',now(),'{}','{}',now(),now()),
  ('@NS@0001-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','notice-@NS@-other@example.invalid','',now(),'{}','{}',now(),now()),
  ('@NS@0001-0000-4000-8000-000000000003','00000000-0000-0000-8000-000000000000','authenticated','authenticated','notice-@NS@-reviewer@example.invalid','',now(),'{}','{}',now(),now());
update public.profiles set role='operator' where id='@NS@0001-0000-4000-8000-000000000003';

-- Included inside the calling fixture's rollback-only transaction. These .example
-- permissions are synthetic test evidence, never production source authorization.
insert into public.employers(id,display_name,source_category)
values('notice-@NS@-reviewed-employer','Synthetic owner notice @NS@ source','core_direct_employer');
insert into public.job_sources(id,canonical_employer_id,source_name,source_category,official_url,
 adapter_kind,automation_status,is_official,is_direct_employer,is_active,paid_display_permission_status)
values('notice-@NS@-manual','notice-@NS@-reviewed-employer','Synthetic owner notice @NS@ manual fixture','core_direct_employer',
 'https://notice-@NS@-employer.example','official_link_only','official_link_only',true,true,true,'documented_paid_display_authorized')
on conflict(id) do update set canonical_employer_id=excluded.canonical_employer_id,is_active=true,
 paid_display_permission_status=excluded.paid_display_permission_status;
insert into public.ap_source_authorizations(source_id,source_display_name,state,access_method,evidence_reference,
 allowed_hosts,allowed_actions,verified_by_role,verified_at,authorization_version,content_sha256)
values('notice-@NS@-manual','Synthetic owner notice @NS@ manual fixture','AUTHORIZED_MANUAL_ONLY','MANUAL',
 'tests/integration/reviewed-source-fixture.sql: synthetic authorization, transaction rolled back',
 array['notice-@NS@-employer.example','employer1.example','employer2.example','employer3.example','employer4.example',
 'employer5.example','employer6.example','employer7.example','employer8.example','employer9.example','employer10.example'],
 array['MANUAL_REVIEW'],'operator',clock_timestamp(),'zz-owner-notice-@NS@',repeat('a',64));

create or replace function pg_temp.verify_fixture_snapshot(snapshot jsonb,actor uuid) returns uuid
language plpgsql as $$
declare payload jsonb; posting jsonb; review jsonb; nodes jsonb; authority uuid; revision bigint;
 body text:='Current reviewed operations role with an employer-hosted application path.';
begin
 select id into authority from public.ap_source_authorizations
 where source_id='notice-@NS@-manual' and authorization_version='zz-owner-notice-@NS@';
 select h.revision into revision from public.ap_source_authorization_heads h where h.source_id='notice-@NS@-manual';
 if not exists(select 1 from public.ap_source_authorization_heads where source_id='notice-@NS@-manual' and current_authorization_id=authority) then
   perform public.ap_set_source_authorization_head('notice-@NS@-manual',authority,coalesce(revision,0),actor);
 end if;
 update public.jobs set source_id='notice-@NS@-manual',canonical_employer_id='notice-@NS@-reviewed-employer',
  source_name='Synthetic owner notice @NS@ manual fixture',source_category='core_direct_employer',
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
 return public.ap_verify_manual_source_observation(gen_random_uuid(),actor,'notice-@NS@-manual',posting,review,
  'requisition|notice-@NS@-reviewed-employer|'||(payload->>'external_job_id'),snapshot,nodes,payload);
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
  '@NS@0002-0000-4000-8000-000000000009','@NS@0001-0000-4000-8000-000000000001',1,'INITIAL',
  'notice-@NS@-customer@example.invalid',null,'notice-@NS@-customer@example.invalid',
  '["COORDINATING_PROJECTS"]','[]','[]',null,'[]','[]','ADJACENT_OPPORTUNITIES',false,
  '["REMOTE"]','VA','["FULL_TIME"]','[]','{}','{}','[]',7000000,6000000,false,'YEAR','BASE',
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',
  repeat('4',64),'applypack-c14n-v1','applypack-intake-v4',clock_timestamp()-(interval '720 hours'-interval '20 seconds'),jsonb_build_object('id',gen_random_uuid(),'contractVersion','applypack-confirmed-intake-v1','draftVersion',1,'sourceSha256',repeat('a',64),'reviewSha256',repeat('b',64),'answersSha256',repeat('c',64),'preparedAt',clock_timestamp(),'entryMode','NO_RESUME')
);

-- The current material source is a distinct immutable factual correction;
-- contact remains the exact separately confirmed original checkout receipt.
insert into public.ap_intake_snapshots
select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(s)||jsonb_build_object(
 'id','@NS@0002-0000-4000-8000-000000000001','version',2,'snapshot_kind','MATERIAL_FACT_REVISION',
 'parent_snapshot_id',s.id))).* from public.ap_intake_snapshots s where id='@NS@0002-0000-4000-8000-000000000009';

insert into public.jobs(
  id,company,title,source_url,location_text,salary_text,checked_at,listing_status,
  official_application_url,source_job_url,normalized_source_url,external_job_id,description,
  employment_type,w2_or_contractor,work_mode,pay_model,posted_at,last_verified_at,
  source_freshness_status,is_active,review_status,reviewed_by,reviewed_at
) values(
  '@NS@0003-0000-4000-8000-000000000001','Owner Notice @NS@ Fixture Employer','Operations Specialist',
  'https://notice-@NS@-employer.example/jobs/1','Remote - United States','$70,000 annually',clock_timestamp(),
  'open','https://notice-@NS@-employer.example/apply/1','https://notice-@NS@-employer.example/jobs/1',
  'https://notice-@NS@-employer.example/jobs/1','NOTICE-@NS@-REQ-1',
  'Current reviewed operations role with an employer-hosted application path.',
  'w2_full_time','w2','remote_us_nationwide','salary',clock_timestamp()-interval '1 day',
  clock_timestamp()-interval '1 minute','fresh',true,'approved',
  '@NS@0001-0000-4000-8000-000000000003',clock_timestamp()
);

create temporary table notice_@NS@_snapshot_input(
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
  where source_id='notice-@NS@-manual' and authorization_version='zz-owner-notice-@NS@'
)
select
  '@NS@0004-0000-4000-8000-000000000001','@NS@0003-0000-4000-8000-000000000001',
  'APPLYPACK_FOUND','notice-@NS@-manual','NOTICE-@NS@-REQ-1','https://notice-@NS@-employer.example/apply/1',
  'EMPLOYER_HOSTED','https://notice-@NS@-employer.example/jobs/1','https://notice-@NS@-employer.example/jobs/1',
  'Owner Notice @NS@ Fixture Employer','Operations Specialist',encode(extensions.digest('owner-notice-@NS@-fingerprint','sha256'),'hex'),
  '{"description":"Current reviewed operations role"}',clock_timestamp(),current_date,false,
  clock_timestamp()-interval '1 minute','$70,000 annually','EMPLOYER_LISTING',
  '{"mode":"REMOTE","location":"United States"}','listing-requirements-v3',repeat('8',64),
  current_source.id,clock_timestamp()-interval '1 day','notice-@NS@-employer.example',
  'PASS','PASS','PASS','{}','{}','PASS',100,100,'applypack-c14n-v1',false
from current_source;

select pg_temp.verify_fixture_snapshot(to_jsonb(template),'@NS@0001-0000-4000-8000-000000000003')
from notice_@NS@_snapshot_input template;
select owner_notice_fixture.assert_true(exists(select 1 from public.ap_current_source_verifications('@NS@0004-0000-4000-8000-000000000001')),
 'fixture manual review must create current immutable source evidence');

insert into public.ap_employer_submission_rules(
  id,job_snapshot_id,content_sha256,source_evidence_ids,resume_requirement,
  cover_letter_requirement,allowed_formats,resume_page_limit,cover_letter_page_limit,
  reference_timing,submission_channel,parser_version,injection_scan_state,
  human_confirmed_by,human_confirmed_at,checked_at
) values(
  '@NS@0005-0000-4000-8000-000000000001','@NS@0004-0000-4000-8000-000000000001',
  repeat('4',64),array['@NS@0004-0000-4000-8000-000000000001'::uuid],
  'REQUIRED','REQUIRED',array['PDF']::text[],1,1,'OPTIONAL_NOW','HTTPS_UPLOAD',
  'fixture-open-font-v1','CLEAR','@NS@0001-0000-4000-8000-000000000003',
  clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '10 minutes'
);

insert into public.orders(
  id,customer_id,product_kind,amount_cents,status,paid_at,delivery_deadline,delivered_at,
  human_review_checklist,human_reviewed_by,human_reviewed_at
) values(
  '@NS@0006-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
  'job_search',1899,'delivered',statement_timestamp()-interval '743 hours',
  statement_timestamp()-interval '719 hours',clock_timestamp()-(interval '720 hours'-interval '20 seconds'),
  '{"approved":true}','@NS@0001-0000-4000-8000-000000000003',clock_timestamp()-(interval '720 hours'-interval '20 seconds')
);
insert into public.job_matches(
  id,search_order_id,job_id,position,fit_summary,requirements,concerns,delivered_at,
  matching_experience,primary_outcome,core_responsibilities,hidden_job_functions,
  reviewed_by,reviewed_at,release_explanation,allowed_unknown_warnings,source_provenance,
  compensation_status,posted_on,posted_date_unknown,last_checked_at
) values(
  '@NS@0007-0000-4000-8000-000000000001','@NS@0006-0000-4000-8000-000000000001',
  '@NS@0003-0000-4000-8000-000000000001',1,'Evidence-bound fit summary','[]','[]',
  clock_timestamp()-(interval '720 hours'-interval '20 seconds'),'["Operations coordination"]','Coordinate accurate operations',
  '["Maintain workflow records"]','[]','@NS@0001-0000-4000-8000-000000000003',
  clock_timestamp()-(interval '720 hours'-interval '20 seconds'),
  '{"whatJobInvolves":"Coordinate operations","whyMadeList":"All gates passed","howExperienceConnects":"Confirmed coordination experience","whatMayBeNew":"Employer workflow","whatToKnow":"Use employer application path"}',
  '[]','{"authorization":"notice-@NS@-manual"}','PUBLISHED_MEETS_MINIMUM',current_date,false,
  clock_timestamp()-(interval '720 hours'-interval '20 seconds')
);

insert into public.ap_payment_attempts(
  id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,
  payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified
) values(
  '@NS@0008-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
  'stripe','pi_notice-@NS@_fixture',799,'USD','PAID','NONE',statement_timestamp()-interval '25 hours',
  'succeeded','card',true
);
insert into public.ap_material_purchases(
  id,customer_id,payment_attempt_id,amount_cents,currency,completed_at
) values(
  '@NS@0009-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
  '@NS@0008-0000-4000-8000-000000000001',799,'USD',statement_timestamp()-interval '25 hours'
);
insert into public.ap_material_lines(
  id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,payment_allocation_key,
  allocated_amount_cents,readiness,fulfillment,substitution,selected_reference_sheet,active_revision,
  selection_confirmed_at,materials_payment_verified_at,materials_capacity_confirmed_at,
  materials_started_at,materials_due_at,earned_revenue_at
) values(
  '@NS@000a-0000-4000-8000-000000000001','@NS@0009-0000-4000-8000-000000000001',
  '@NS@0006-0000-4000-8000-000000000001','@NS@0007-0000-4000-8000-000000000001',
  '@NS@0008-0000-4000-8000-000000000001','notice-@NS@-payment-allocation-1',799,
  'CHECKOUT_ELIGIBLE','PAID','NONE',false,1,statement_timestamp()-interval '26 hours',
  statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',
  statement_timestamp()-interval '1 minute',statement_timestamp()+interval '23 hours 59 minutes',null
);
insert into public.ap_material_line_revisions(
  id,line_id,version,revision_kind,job_snapshot_id,source_snapshot_id,employer_rule_snapshot_id,binding_sha256,
  accepted_at,started_at,due_at
) values(
  '@NS@000b-0000-4000-8000-000000000001','@NS@000a-0000-4000-8000-000000000001',1,
  'ORIGINAL','@NS@0004-0000-4000-8000-000000000001','@NS@0002-0000-4000-8000-000000000001',
  '@NS@0005-0000-4000-8000-000000000001',repeat('b',64),
  statement_timestamp()-interval '1 minute',(select materials_started_at from public.ap_material_lines where id='@NS@000a-0000-4000-8000-000000000001'),
  (select materials_due_at from public.ap_material_lines where id='@NS@000a-0000-4000-8000-000000000001')
);

insert into public.ap_material_listing_checks(material_line_id,line_revision_id,phase,job_snapshot_id,submission_rule_id,result,checked_by,checked_at,evidence_sha256)
values('@NS@000a-0000-4000-8000-000000000001','@NS@000b-0000-4000-8000-000000000001','BEFORE_GENERATION',
 '@NS@0004-0000-4000-8000-000000000001','@NS@0005-0000-4000-8000-000000000001','ACTIVE','@NS@0001-0000-4000-8000-000000000003',clock_timestamp(),repeat('4',64));
insert into public.ap_candidate_facts(id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,
 source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,catalog_version,schema_version)
values('@NS@0003-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000001','fixture.responsibility','RESPONSIBILITY','{"activity":"Maintained records"}',
 'CUSTOMER_ASSERTION','@NS@0002-0000-4000-8000-000000000001','fixture','fixture','CUSTOMER_CONFIRMED','fixture-v1','fixture-v1');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','@NS@0003-0000-4000-8000-000000000002','semantic_key','fixture.limited',
 'typed_value',jsonb_build_object('activity','Studying records management','completionStatus','IN_PROGRESS')))).*
from public.ap_candidate_facts f where id='@NS@0003-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','@NS@0003-0000-4000-8000-000000000003','semantic_key','fixture.negative','capability_status','NOT_DONE'))).*
from public.ap_candidate_facts f where id='@NS@0003-0000-4000-8000-000000000001';
insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
 content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
select ('@NS@000c-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'@NS@0001-0000-4000-8000-000000000001',decode('0102','hex'),'AES-256-GCM',
 decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('33',16),'hex'),repeat(n::text,64),'fictional-fixture-kms','1',repeat('a',64)
from generate_series(1,5) n;
insert into public.ap_releases(id,customer_id,order_id,release_kind,committed_at,active_due_at,version_bundle,human_approved_by)
values('@NS@000d-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','@NS@0006-0000-4000-8000-000000000001',
 'SEARCH_EXACT_TEN',statement_timestamp()-(interval '720 hours'-interval '20 seconds'),statement_timestamp()-interval '719 hours','{}','@NS@0001-0000-4000-8000-000000000003');
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,state,applied_at,created_at,updated_at)
values('@NS@000e-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','MATERIAL_CHECKOUT','stripe',repeat('a',64),'owner-notice-@NS@-contact-checkout','APPLIED',statement_timestamp()-interval '25 hours',statement_timestamp()-interval '26 hours',statement_timestamp()-interval '25 hours');
insert into public.ap_material_checkout_intents(id,customer_id,delivered_order_id,delivered_release_id,source_snapshot_id,contact_payload_id,purchase_id,payment_attempt_id,
 command_id,request_key,selection_sha256,line_count,amount_cents,currency,tax_inclusive,pricing_version,tax_version,career_break_choice,document_contact_confirmed,document_facts_confirmed,state,completed_at,created_at,updated_at)
values('@NS@000f-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','@NS@0006-0000-4000-8000-000000000001','@NS@000d-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000009','@NS@000c-0000-4000-8000-000000000005','@NS@0009-0000-4000-8000-000000000001','@NS@0008-0000-4000-8000-000000000001',
 '@NS@000e-0000-4000-8000-000000000001','owner-notice-@NS@-confirmed-contact',repeat('a',64),1,799,'USD',true,'fixture','fixture','KEEP_EXISTING_TIMELINE',true,true,'COMPLETED',statement_timestamp()-interval '25 hours',statement_timestamp()-interval '26 hours',statement_timestamp()-interval '25 hours');
update public.ap_material_purchases set checkout_intent_id='@NS@000f-0000-4000-8000-000000000001' where id='@NS@0009-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','@NS@000c-0000-4000-8000-000000000005','snapshot_id','@NS@0002-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','@NS@0002-0000-4000-8000-000000000009','semantic_key','document_contact.confirmed','value_kind','PROTECTED_COMPOSITE',
 'typed_value',jsonb_build_object('protectedPayloadId','@NS@000c-0000-4000-8000-000000000005','contentSha256',repeat('5',64))))).*
from public.ap_candidate_facts f where id='@NS@0003-0000-4000-8000-000000000001';
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object(
 'id','@NS@0003-0000-4000-8000-000000000009','snapshot_id','@NS@0002-0000-4000-8000-000000000009',
 'customer_assertion_snapshot_id','@NS@0002-0000-4000-8000-000000000009'))).*
from public.ap_candidate_facts f where id='@NS@0003-0000-4000-8000-000000000001';
select owner_notice_fixture.assert_true(public.ap_material_draft_checkout_contact_matches('@NS@000a-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000001','@NS@000c-0000-4000-8000-000000000005'),'exact checkout contact did not survive factual correction');
select owner_notice_fixture.assert_true(not public.ap_material_draft_checkout_contact_matches('@NS@000a-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000001','@NS@0003-0000-4000-8000-000000000009'),'ordinary old fact received contact exception');
insert into public.ap_candidate_facts
select (jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object('id','@NS@000c-0000-4000-8000-000000000004',
 'typed_value',jsonb_build_object('protectedPayloadId','@NS@000c-0000-4000-8000-000000000004','contentSha256',repeat('4',64))))).*
from public.ap_candidate_facts f where id='@NS@000c-0000-4000-8000-000000000005';
select owner_notice_fixture.assert_true(not public.ap_material_draft_checkout_contact_matches('@NS@000a-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001',
 '@NS@0002-0000-4000-8000-000000000001','@NS@000c-0000-4000-8000-000000000004'),'wrong protected payload received contact exception');
$retention_graph$,'@NS@',p_namespace); end if;
 execute seed_text;
 if p_retention then execute replace($retention_seed$insert into public.ap_anonymous_drafts(id,capability_secret_hash,expires_at,flow_version,answers,created_at,updated_at)
values('@NS@0016-0000-4000-8000-000000000001',encode(extensions.digest('owner-notice-@NS@-draft','sha256'),'hex'),statement_timestamp()-interval '720 hours','FOUR_STEP_RESPONSIBILITY_V1','{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1"}',statement_timestamp()-interval '747 hours',statement_timestamp()-interval '744 hours');
insert into public.ap_intake_snapshots(id,draft_id,intake_id,customer_id,version,snapshot_kind,access_email_normalized,
  desired_activities,avoided_activities,optional_titles,optional_industries,blocked_industries,search_breadth,guidance_requested,
  work_modes,employment_types,schedules,travel,benefits,dealbreakers,salary_minimum_flexible,salary_overlap_policy,
  salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,
  prior_cover_letter_use,targeted_authorization_answers,content_sha256,canonicalization_version,schema_version,finalized_at,preferred_work_mode,preferred_employment_type,work_condition_preferences)
values('@NS@0017-0000-4000-8000-000000000001','@NS@0016-0000-4000-8000-000000000001',null,
  '@NS@0001-0000-4000-8000-000000000001',1,'INITIAL','retention-new@example.invalid','["synthetic private activity"]','[]','[]','[]','[]',
  'ADJACENT_OPPORTUNITIES',false,'["REMOTE"]','["FULL_TIME"]','[]','{}','{}','[]',false,
  'PUBLISHED_OVERLAP_ALLOWED','ALLOW_WITH_WARNING','HUMAN_REVIEW','EXCLUDE_VARIABLE','{}','NEITHER','{}',repeat('b',64),'applypack-c14n-v1','applypack-intake-v3',statement_timestamp()-interval '744 hours','REMOTE','FULL_TIME','{"fictionalPrivatePreference":"quiet environment"}');
insert into public.ap_snapshot_legal_acceptances(id,draft_id,snapshot_id,terms_version,privacy_version,acceptance_sha256,accepted_at)
values('@NS@0018-0000-4000-8000-000000000001','@NS@0016-0000-4000-8000-000000000001','@NS@0017-0000-4000-8000-000000000001',
  'manual-launch-terms-2026-10-24-v3','privacy-2026-10-24-v3',repeat('c',64),statement_timestamp()-interval '744 hours');
insert into public.ap_snapshot_legal_content_receipts(id,legal_acceptance_id,draft_id,snapshot_id,terms_version,terms_content_sha256,
  privacy_version,privacy_content_sha256,acceptance_copy_version,acceptance_copy_sha256,content_canonicalization_version,receipt_schema_version,acceptance_sha256,accepted_at)
select '@NS@0019-0000-4000-8000-000000000001','@NS@0018-0000-4000-8000-000000000001','@NS@0016-0000-4000-8000-000000000001',
  '@NS@0017-0000-4000-8000-000000000001',terms_version,terms_content_sha256,privacy_version,privacy_content_sha256,
  legal_acceptance_copy_version,legal_acceptance_copy_sha256,legal_content_canonicalization_version,legal_receipt_schema_version,repeat('c',64),statement_timestamp()-interval '744 hours'
from public.ap_commerce_configuration where singleton;
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,created_at,updated_at)
values('@NS@001a-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','CREATE_CHECKOUT','stripe',repeat('d',64),'owner-notice-@NS@-retention-command',statement_timestamp()-interval '743 hours 30 minutes',statement_timestamp()-interval '743 hours 30 minutes');
insert into public.ap_checkout_attempts(id,customer_id,draft_id,command_id,created_at,updated_at)
values('@NS@001b-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','@NS@0016-0000-4000-8000-000000000001','@NS@001a-0000-4000-8000-000000000001',statement_timestamp()-interval '743 hours 30 minutes',statement_timestamp()-interval '743 hours 30 minutes');
-- Only this synthetic superuser fixture seeds a prospective consent binding.
-- Production checkout remains blocked until the separately authorized executor exists.
insert into public.ap_retention_checkout_contracts(checkout_attempt_id,legal_receipt_id,policy_version)
values('@NS@001b-0000-4000-8000-000000000001','@NS@0019-0000-4000-8000-000000000001','one_off_30d_v1');
insert into public.ap_payment_attempts(id,customer_id,draft_id,checkout_attempt_id,provider,amount_cents,currency,settlement,payment_verified_at,immediate_charge_verified)
values('@NS@001c-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','@NS@0016-0000-4000-8000-000000000001',
  '@NS@001b-0000-4000-8000-000000000001','stripe',1899,'USD','PAID',statement_timestamp()-interval '743 hours',true);
insert into public.ap_search_services(id,legacy_order_id,customer_id,winning_payment_attempt_id,original_snapshot_id,active_snapshot_id,fulfillment,legacy_record) values('@NS@001d-0000-4000-8000-000000000001','@NS@0006-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000001','@NS@001c-0000-4000-8000-000000000001','@NS@0017-0000-4000-8000-000000000001','@NS@0017-0000-4000-8000-000000000001','DELIVERED',true);
$retention_seed$,'@NS@',p_namespace); end if;
 if p_references then execute replace($reference_seed$insert into public.ap_sensitive_payloads(id,customer_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,
 content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
select ('@NS@0011-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'@NS@0001-0000-4000-8000-000000000001',decode('0102','hex'),'AES-256-GCM',
 decode(repeat('11',32),'hex'),decode(repeat('22',12),'hex'),decode(repeat('33',16),'hex'),repeat((n+5)::text,64),'fictional-reference-kms','1',repeat('b',64) from generate_series(1,3) n;
insert into public.ap_reference_records(id,customer_id)
select ('@NS@0012-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'@NS@0001-0000-4000-8000-000000000001' from generate_series(1,3) n;
insert into public.ap_reference_record_versions(id,reference_record_id,version,encrypted_payload_id,payload_schema_version,payload_sha256,permission_status,permission_last_confirmed_at)
select ('@NS@0013-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('@NS@0012-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,1,
 ('@NS@0011-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'chunk5-reference-record-v1',repeat((n+5)::text,64),'CONFIRMED',clock_timestamp()-interval '1 minute' from generate_series(1,3) n;
insert into public.ap_reference_permissions(id,customer_id,reference_record_version_id,delivered_release_id,job_snapshot_id,job_snapshot_hash,employer_snapshot,exact_position_snapshot,permission_text_version,attested_at)
select ('@NS@0014-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'@NS@0001-0000-4000-8000-000000000001',('@NS@0013-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '@NS@000d-0000-4000-8000-000000000001','@NS@0004-0000-4000-8000-000000000001',repeat('8',64),'Fixture Employer','Fixture Position','fixture-permission-v1',clock_timestamp()-interval '1 minute' from generate_series(1,3) n;
insert into public.ap_material_checkout_items(id,checkout_intent_id,material_line_id,delivered_match_id,job_snapshot_id,submission_rule_id,selected_reference_sheet,originally_selected_reference_sheet,readiness)
values('@NS@0015-0000-4000-8000-000000000001','@NS@000f-0000-4000-8000-000000000001','@NS@000a-0000-4000-8000-000000000001','@NS@0007-0000-4000-8000-000000000001',
 '@NS@0004-0000-4000-8000-000000000001','@NS@0005-0000-4000-8000-000000000001',true,true,'CHECKOUT_ELIGIBLE');
insert into public.ap_material_checkout_references(checkout_item_id,reference_permission_id,position)
select '@NS@0015-0000-4000-8000-000000000001',('@NS@0014-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n from generate_series(1,3) n;
update public.ap_material_lines set selected_reference_sheet=true where id='@NS@000a-0000-4000-8000-000000000001';

$reference_seed$,'@NS@',p_namespace); end if;
 execute replace($prepare_seed$
do $prepare$ declare claimed jsonb; j uuid; token uuid; ctx text; version_id uuid; policy uuid; request uuid:=gen_random_uuid(); prior_attempts jsonb; prior_reconciliations jsonb; begin
 select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) into prior_attempts from public.ap_material_draft_attempts a;
 select coalesce(jsonb_agg(to_jsonb(r) order by request_id),'[]'::jsonb) into prior_reconciliations from public.ap_material_draft_reconciliations r;
 claimed:=public.ap_claim_material_draft_stage(gen_random_uuid(),'PREPARE',1);
 perform owner_notice_fixture.assert_true(jsonb_array_length(claimed)=1 and (claimed->0->>'material_line_id')::uuid='@NS@000a-0000-4000-8000-000000000001','fixture did not claim its exact new paid obligation');
 j:=(claimed->0->>'id')::uuid; token:=(claimed->0->>'lease_token')::uuid;
 ctx:=public.ap_material_draft_context_sha256(j);
 version_id:=public.ap_attach_material_draft_packet(j,token,'@NS@000c-0000-4000-8000-000000000001',repeat('1',64),ctx);
 policy:=public.ap_register_material_draft_policy(jsonb_build_object('provider','fictional','model','owner-notice-@NS@','privacyReferenceSha256',repeat('a',64),'evaluationReferenceSha256',repeat('b',64),'quoteReferenceSha256',repeat('c',64),'maxInputTokens',1000,'maxOutputTokens',1000,'inputMicrousdPerMillion',1000000,'outputMicrousdPerMillion',1000000,'maxAttemptMicrousd',1000,'rollingDayMicrousd',10000,'maxAttempts',3),'@NS@0001-0000-4000-8000-000000000003');
 perform public.ap_set_material_draft_runtime(true,policy,'@NS@0001-0000-4000-8000-000000000003');
 perform public.ap_begin_material_draft_request(j,token,version_id,request,policy,100,100);
 perform public.ap_observe_material_draft_response(j,request,version_id,policy,'PROPOSAL_VALIDATED','fixture-notice-@NS@','owner-notice-@NS@',100,100,200);
 perform public.ap_record_material_draft_result(j,token,request,'@NS@000c-0000-4000-8000-000000000002',repeat('2',64));
 perform owner_notice_fixture.assert_true(not exists(select value from jsonb_array_elements(prior_attempts) except all select to_jsonb(a) from public.ap_material_draft_attempts a),'new fictional work changed prior attempt history');
 perform owner_notice_fixture.assert_true(not exists(select value from jsonb_array_elements(prior_reconciliations) except all select to_jsonb(r) from public.ap_material_draft_reconciliations r),'new fictional work changed prior spend history');
 perform public.ap_set_material_draft_runtime(false,null,'@NS@0001-0000-4000-8000-000000000003');
 insert into owner_notice_fixture.state(namespace,customer_id,operator_id,line_id,job_id,lease_token,version_id,context_sha256,policy_id,claim_id,request_id,deadline)
 select '@NS@','@NS@0001-0000-4000-8000-000000000001','@NS@0001-0000-4000-8000-000000000003','@NS@000a-0000-4000-8000-000000000001',j,token,version_id,ctx,policy,gen_random_uuid(),request,materials_due_at from public.ap_material_lines where id='@NS@000a-0000-4000-8000-000000000001';
end $prepare$;
drop table notice_@NS@_snapshot_input;
$prepare_seed$,'@NS@',p_namespace);
end $seed_fn$;
create function owner_notice_fixture.to_review(p_namespace text) returns void language plpgsql as $review_fn$ begin
 if p_namespace!~'^[a-f][0-9]{3}$' or p_namespace is null then raise exception 'invalid fixture namespace'; end if;
 execute replace($review_state$create temporary table fixture_draft_state as select job_id,lease_token,version_id,context_sha256,policy_id,claim_id,member_sha256,null::text approval_sha256 from owner_notice_fixture.state where namespace='@NS@';
$review_state$,'@NS@',p_namespace);
 if (select l.selected_reference_sheet from owner_notice_fixture.state s join public.ap_material_lines l on l.id=s.line_id where s.namespace=p_namespace) then
 execute replace($reference_review$create temporary table fixture_reference_claims as
select jsonb_build_object('claimId',gen_random_uuid(),'decision','APPROVED','kind','REFERENCE_PERMISSION','qualification','EXACT',
 'wordingSha256',encode(extensions.digest('Fictional reference '||(binding->>'permissionId')||' '||field,'sha256'),'hex'),
 'factRefs','[]'::jsonb,'jobEvidenceIds','[]'::jsonb,'referencePermissionIds',jsonb_build_array(binding->>'permissionId'),
 'referenceBinding',jsonb_build_object('permissionId',binding->>'permissionId','recordVersionId',binding->>'recordVersionId','payloadId',binding->>'payloadId','contentSha256',binding->>'contentSha256','field',field)) claim
from fixture_draft_state w,lateral jsonb_array_elements(public.ap_material_draft_reference_evidence(w.job_id)->'bindings') binding,
 unnest(array['name','title','organization','relationship','email','phone']) field;
do $$ declare w fixture_draft_state; claims jsonb; begin
 select * into w from fixture_draft_state;
 claims:=jsonb_build_array(jsonb_build_object('claimId',w.claim_id,'decision','APPROVED','kind','CANDIDATE_FACT','qualification','EXACT','jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb,
  'wordingSha256',encode(extensions.digest('Maintained records','sha256'),'hex'),
  'factRefs',jsonb_build_array(jsonb_build_object('factId','@NS@0003-0000-4000-8000-000000000001','field','activity',
   'attributionFactId','@NS@0003-0000-4000-8000-000000000001','valueSha256',encode(extensions.digest('"Maintained records"','sha256'),'hex')))));
 claims:=claims||jsonb_build_array(jsonb_build_object('claimId','@NS@0010-0000-4000-8000-000000000001','decision','APPROVED','kind','CANDIDATE_FACT','qualification','EXACT',
  'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb,'wordingSha256',encode(extensions.digest('Fictional Confirmed Contact','sha256'),'hex'),
  'factRefs',jsonb_build_array(jsonb_build_object('factId','@NS@000c-0000-4000-8000-000000000005','field','contentSha256','attributionFactId','@NS@000c-0000-4000-8000-000000000005',
   'valueSha256',encode(extensions.digest(to_jsonb(repeat('5',64))::text,'sha256'),'hex')))));
 claims:=claims||(select jsonb_agg(claim order by claim#>>'{referenceBinding,permissionId}',claim#>>'{referenceBinding,field}') from fixture_reference_claims);
 perform public.ap_record_material_draft_claim_review(w.version_id,repeat('1',64),repeat('2',64),'@NS@000c-0000-4000-8000-000000000003',repeat('3',64),claims,'@NS@0001-0000-4000-8000-000000000003');
end $$;

update public.ap_commerce_configuration set download_ttl_seconds=900,reauthentication_window_seconds=900,
 materials_generation_approved=true,materials_generation_approval_reference='synthetic-database-fixture-only',
 material_output_formats=array['PDF'],document_renderer_identity='fixture-tagged-pdf-renderer',document_font_family='Liberation Sans',
 document_font_sha256='76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
 document_font_manifest_sha256='d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb',document_safety_policy='generated-structural-v1',materials_rule_ttl_seconds=3600 where singleton;

create temporary table notice_@NS@_registrations(payload jsonb);
do $$ declare w fixture_draft_state; kind text; artifact uuid; file_id uuid; base text; provenance jsonb; structural jsonb; checks jsonb; payload jsonb:='[]'; node_id uuid; begin
 select * into w from fixture_draft_state;
 select id into node_id from public.ap_requirement_nodes where job_snapshot_id='@NS@0004-0000-4000-8000-000000000001' limit 1;
 select jsonb_object_agg(k,true) into structural from unnest(array['noMacros','noHiddenText','noComments','noTrackedChanges','noCustomXml','noExternalRelationships','noLayoutTables','nativeBullets','linearText','noPlaceholders','noMetadataLeak','noPromptArtifacts','filenameValid','mimeValid','checksumValid','pageGeometryValid','textExtracted']) k;
 select jsonb_object_agg(k,true) into checks from unnest(array['factsBound','jobEvidenceBound','narrativeTyped','historicalTitlesPreserved','injectionReviewed','noUnsupportedClaims','sameCurrentBinding']) k;
 foreach kind in array array['RESUME','COVER_LETTER','REFERENCE_SHEET'] loop
  artifact:=gen_random_uuid();file_id:=gen_random_uuid();
  base:='@NS@0001-0000-4000-8000-000000000001/materials/@NS@000a-0000-4000-8000-000000000001/'||file_id;
  provenance:=jsonb_build_object('schemaVersion','applypack-claim-provenance-v1',
   'sourceBinding',jsonb_build_object('candidateFactIds',jsonb_build_array('@NS@0003-0000-4000-8000-000000000001','@NS@000c-0000-4000-8000-000000000005'),'jobEvidenceIds',jsonb_build_array(node_id),'referencePermissionIds','[]'::jsonb),
   'claims',jsonb_build_array(jsonb_build_object('id',w.claim_id,'placement','experience.bullet','kind','CANDIDATE_FACT','visibleTextSha256',encode(extensions.digest('Maintained records','sha256'),'hex'),
    'candidateFactIds',jsonb_build_array('@NS@0003-0000-4000-8000-000000000001'),'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb),
    jsonb_build_object('id','@NS@0010-0000-4000-8000-000000000001','placement','header.name','kind','CANDIDATE_FACT',
     'visibleTextSha256',encode(extensions.digest('Fictional Confirmed Contact','sha256'),'hex'),
     'candidateFactIds',jsonb_build_array('@NS@000c-0000-4000-8000-000000000005'),'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb)),
   'draftPair',jsonb_build_object('versionId',w.version_id,'packetSha256',repeat('1',64),'sourceSha256',repeat('2',64),'claimReviewSha256',repeat('3',64)),
   'editableSource',jsonb_build_object('storageBucket','operator-drafts','storagePath',base||'/editable-source/Fixture_'||kind||'.docx','safeFilename','Fixture_'||kind||'.docx',
    'checksumSha256',repeat('5',64),'sizeBytes',4096,'mimeType','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
   'uploadCleanup',jsonb_build_array(jsonb_build_object('storageBucket','operator-drafts','storagePath',base||'/editable-source/Fixture_'||kind||'.docx'),
    jsonb_build_object('storageBucket','operator-render-previews','storagePath',base||'/render-preview.pdf'),jsonb_build_object('storageBucket','customer-deliveries','storagePath',base||'/Fixture_'||kind||'.pdf')),
   'deliveryFormatDecision',jsonb_build_object('format','PDF','reason','DEFAULT_PDF','employerRuleId','@NS@0005-0000-4000-8000-000000000001'),
   'documentFontAttestation',jsonb_build_object('family','Liberation Sans','version','2.1.5','manifestSha256','d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb',
    'styleSha256',jsonb_build_object('regular','76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8','bold','788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173',
     'italic','e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0','boldItalic','698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee')));

  if kind='REFERENCE_SHEET' then
   provenance:=jsonb_set(provenance,'{sourceBinding,referencePermissionIds}',(select jsonb_agg(binding->>'permissionId' order by binding->>'permissionId') from jsonb_array_elements(public.ap_material_draft_reference_evidence(w.job_id)->'bindings') binding));
   provenance:=jsonb_set(provenance,'{claims}',jsonb_build_array(provenance#>'{claims,1}')||(select jsonb_agg(jsonb_build_object(
    'id',claim->>'claimId','placement','referenceSheet.records.0.'||(claim#>>'{referenceBinding,field}'),'kind','REFERENCE_PERMISSION','visibleTextSha256',claim->>'wordingSha256',
    'candidateFactIds','[]'::jsonb,'jobEvidenceIds','[]'::jsonb,'referencePermissionIds',claim->'referencePermissionIds','referenceBinding',claim->'referenceBinding')) from fixture_reference_claims));
   provenance:=provenance||jsonb_build_object('referenceBindings',public.ap_material_draft_reference_evidence(w.job_id)->'bindings');
  end if;
  payload:=payload||jsonb_build_array(jsonb_build_object('p_artifact_id',artifact,'p_file_version_id',file_id,'p_material_line_id','@NS@000a-0000-4000-8000-000000000001','p_reviewer_id',null,'p_artifact_type',kind,
   'p_source_snapshot_id','@NS@0002-0000-4000-8000-000000000001','p_source_line_revision_id','@NS@000b-0000-4000-8000-000000000001','p_job_snapshot_id','@NS@0004-0000-4000-8000-000000000001',
   'p_reference_regeneration_id',null,'p_reference_permission_ids',provenance#>'{sourceBinding,referencePermissionIds}','p_claim_provenance',provenance,
   'p_generator_version','applypack-documents|instructions=applypack-universal-document-standard-2026-10-19.1|standardSha256=2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778|content=applypack-content-2026-10-19.1|template=applypack-template-2026-10-19.1|exporter=libreoffice-tagged-pdf-2026-10-19.1',
   'p_storage_bucket','customer-deliveries','p_storage_path',base||'/Fixture_'||kind||'.pdf','p_safe_filename','Fixture_'||kind||'.pdf','p_checksum_sha256',repeat('6',64),'p_mime_type','application/pdf','p_size_bytes',4096,
   'p_binding_sha256',repeat('b',64),'p_package_qa_sha256',repeat('7',64),'p_structural_checks',structural,'p_provenance_checks',checks,'p_extracted_text_sha256',repeat('8',64),'p_rendered_page_count',1,
   'p_renderer_identity','fixture-tagged-pdf-renderer','p_arial_font_sha256','76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
   'p_malware_scanner_identity','NOT_SCANNED:generated-structural-v1','p_render_preview_bucket','operator-render-previews','p_render_preview_path',base||'/render-preview.pdf',
   'p_render_preview_sha256',repeat('9',64),'p_rendered_page_sha256',jsonb_build_array(repeat('a',64)),'p_arial_resolved',true));
 end loop;
 insert into notice_@NS@_registrations values(payload);
end $$;

update notice_@NS@_registrations set payload=(select jsonb_agg(entry||jsonb_build_object(
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


$reference_review$,'@NS@',p_namespace);
 else execute replace($pair_review$do $$ declare w fixture_draft_state; claims jsonb; begin
 select * into w from fixture_draft_state;
 claims:=jsonb_build_array(jsonb_build_object('claimId',w.claim_id,'decision','APPROVED','kind','CANDIDATE_FACT','qualification','EXACT','jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb,
  'wordingSha256',encode(extensions.digest('Maintained records','sha256'),'hex'),
  'factRefs',jsonb_build_array(jsonb_build_object('factId','@NS@0003-0000-4000-8000-000000000001','field','activity',
   'attributionFactId','@NS@0003-0000-4000-8000-000000000001','valueSha256',encode(extensions.digest('"Maintained records"','sha256'),'hex')))));
 claims:=claims||jsonb_build_array(jsonb_build_object('claimId','@NS@0010-0000-4000-8000-000000000001','decision','APPROVED','kind','CANDIDATE_FACT','qualification','EXACT',
  'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb,'wordingSha256',encode(extensions.digest('Fictional Confirmed Contact','sha256'),'hex'),
  'factRefs',jsonb_build_array(jsonb_build_object('factId','@NS@000c-0000-4000-8000-000000000005','field','contentSha256','attributionFactId','@NS@000c-0000-4000-8000-000000000005',
   'valueSha256',encode(extensions.digest(to_jsonb(repeat('5',64))::text,'sha256'),'hex')))));
 perform public.ap_record_material_draft_claim_review(w.version_id,repeat('1',64),repeat('2',64),'@NS@000c-0000-4000-8000-000000000003',repeat('3',64),claims,'@NS@0001-0000-4000-8000-000000000003');
end $$;

update public.ap_commerce_configuration set download_ttl_seconds=900,reauthentication_window_seconds=900,
 materials_generation_approved=true,materials_generation_approval_reference='synthetic-database-fixture-only',
 material_output_formats=array['PDF'],document_renderer_identity='fixture-tagged-pdf-renderer',document_font_family='Liberation Sans',
 document_font_sha256='76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
 document_font_manifest_sha256='d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb',document_safety_policy='generated-structural-v1',materials_rule_ttl_seconds=3600 where singleton;

create temporary table notice_@NS@_registrations(payload jsonb);
do $$ declare w fixture_draft_state; kind text; artifact uuid; file_id uuid; base text; provenance jsonb; structural jsonb; checks jsonb; payload jsonb:='[]'; node_id uuid; begin
 select * into w from fixture_draft_state;
 select id into node_id from public.ap_requirement_nodes where job_snapshot_id='@NS@0004-0000-4000-8000-000000000001' limit 1;
 select jsonb_object_agg(k,true) into structural from unnest(array['noMacros','noHiddenText','noComments','noTrackedChanges','noCustomXml','noExternalRelationships','noLayoutTables','nativeBullets','linearText','noPlaceholders','noMetadataLeak','noPromptArtifacts','filenameValid','mimeValid','checksumValid','pageGeometryValid','textExtracted']) k;
 select jsonb_object_agg(k,true) into checks from unnest(array['factsBound','jobEvidenceBound','narrativeTyped','historicalTitlesPreserved','injectionReviewed','noUnsupportedClaims','sameCurrentBinding']) k;
 foreach kind in array array['RESUME','COVER_LETTER'] loop
  artifact:=gen_random_uuid();file_id:=gen_random_uuid();
  base:='@NS@0001-0000-4000-8000-000000000001/materials/@NS@000a-0000-4000-8000-000000000001/'||file_id;
  provenance:=jsonb_build_object('schemaVersion','applypack-claim-provenance-v1',
   'sourceBinding',jsonb_build_object('candidateFactIds',jsonb_build_array('@NS@0003-0000-4000-8000-000000000001','@NS@000c-0000-4000-8000-000000000005'),'jobEvidenceIds',jsonb_build_array(node_id),'referencePermissionIds','[]'::jsonb),
   'claims',jsonb_build_array(jsonb_build_object('id',w.claim_id,'placement','experience.bullet','kind','CANDIDATE_FACT','visibleTextSha256',encode(extensions.digest('Maintained records','sha256'),'hex'),
    'candidateFactIds',jsonb_build_array('@NS@0003-0000-4000-8000-000000000001'),'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb),
    jsonb_build_object('id','@NS@0010-0000-4000-8000-000000000001','placement','header.name','kind','CANDIDATE_FACT',
     'visibleTextSha256',encode(extensions.digest('Fictional Confirmed Contact','sha256'),'hex'),
     'candidateFactIds',jsonb_build_array('@NS@000c-0000-4000-8000-000000000005'),'jobEvidenceIds','[]'::jsonb,'referencePermissionIds','[]'::jsonb)),
   'draftPair',jsonb_build_object('versionId',w.version_id,'packetSha256',repeat('1',64),'sourceSha256',repeat('2',64),'claimReviewSha256',repeat('3',64)),
   'editableSource',jsonb_build_object('storageBucket','operator-drafts','storagePath',base||'/editable-source/Fixture_'||kind||'.docx','safeFilename','Fixture_'||kind||'.docx',
    'checksumSha256',repeat('5',64),'sizeBytes',4096,'mimeType','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
   'uploadCleanup',jsonb_build_array(jsonb_build_object('storageBucket','operator-drafts','storagePath',base||'/editable-source/Fixture_'||kind||'.docx'),
    jsonb_build_object('storageBucket','operator-render-previews','storagePath',base||'/render-preview.pdf'),jsonb_build_object('storageBucket','customer-deliveries','storagePath',base||'/Fixture_'||kind||'.pdf')),
   'deliveryFormatDecision',jsonb_build_object('format','PDF','reason','DEFAULT_PDF','employerRuleId','@NS@0005-0000-4000-8000-000000000001'),
   'documentFontAttestation',jsonb_build_object('family','Liberation Sans','version','2.1.5','manifestSha256','d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb',
    'styleSha256',jsonb_build_object('regular','76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8','bold','788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173',
     'italic','e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0','boldItalic','698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee')));
  payload:=payload||jsonb_build_array(jsonb_build_object('p_artifact_id',artifact,'p_file_version_id',file_id,'p_material_line_id','@NS@000a-0000-4000-8000-000000000001','p_reviewer_id',null,'p_artifact_type',kind,
   'p_source_snapshot_id','@NS@0002-0000-4000-8000-000000000001','p_source_line_revision_id','@NS@000b-0000-4000-8000-000000000001','p_job_snapshot_id','@NS@0004-0000-4000-8000-000000000001',
   'p_reference_regeneration_id',null,'p_reference_permission_ids','[]'::jsonb,'p_claim_provenance',provenance,
   'p_generator_version','applypack-documents|instructions=applypack-universal-document-standard-2026-10-19.1|standardSha256=2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778|content=applypack-content-2026-10-19.1|template=applypack-template-2026-10-19.1|exporter=libreoffice-tagged-pdf-2026-10-19.1',
   'p_storage_bucket','customer-deliveries','p_storage_path',base||'/Fixture_'||kind||'.pdf','p_safe_filename','Fixture_'||kind||'.pdf','p_checksum_sha256',repeat('6',64),'p_mime_type','application/pdf','p_size_bytes',4096,
   'p_binding_sha256',repeat('b',64),'p_package_qa_sha256',repeat('7',64),'p_structural_checks',structural,'p_provenance_checks',checks,'p_extracted_text_sha256',repeat('8',64),'p_rendered_page_count',1,
   'p_renderer_identity','fixture-tagged-pdf-renderer','p_arial_font_sha256','76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8',
   'p_malware_scanner_identity','NOT_SCANNED:generated-structural-v1','p_render_preview_bucket','operator-render-previews','p_render_preview_path',base||'/render-preview.pdf',
   'p_render_preview_sha256',repeat('9',64),'p_rendered_page_sha256',jsonb_build_array(repeat('a',64)),'p_arial_resolved',true));
 end loop;
 insert into notice_@NS@_registrations values(payload);
end $$;
$pair_review$,'@NS@',p_namespace); end if;
 execute replace($commit_review$
do $commit_pair$ declare w owner_notice_fixture.state; payload jsonb; receipt jsonb; begin
 select * into w from owner_notice_fixture.state where namespace='@NS@';
 select r.payload into payload from notice_@NS@_registrations r;
 receipt:=public.ap_commit_material_draft_pair(w.job_id,w.lease_token,w.version_id,repeat('1',64),repeat('2',64),payload);
 perform owner_notice_fixture.assert_true(jsonb_array_length(receipt->'members')=(select case when selected_reference_sheet then 3 else 2 end from public.ap_material_lines where id=w.line_id),'fixture pair registration incomplete');
 update owner_notice_fixture.state set member_sha256=receipt->>'memberSetSha256' where namespace='@NS@';
end $commit_pair$;
drop table fixture_draft_state;
drop table notice_@NS@_registrations;
drop table if exists fixture_reference_claims;
$commit_review$,'@NS@',p_namespace);
end $review_fn$;
$installation_source$;
 create table owner_notice_fixture.installation(source_sha256 text primary key,function_sha256 jsonb not null);
 select jsonb_object_agg(p.proname,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')) into definitions from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='owner_notice_fixture';
 insert into owner_notice_fixture.installation values('2783fed95a54c90fd96f4aa27b7387f38a56587d3a43ccd696993b2e45422c22',definitions);
end $install_fixture$;

-- Fictional accounts and content; actual103 ownership/confirmation RPCs.
-- Engine proof is separate from provider OTP and browser acceptance.
begin;
create function pg_temp.owned_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;
create function pg_temp.owned_reject(statement text,expected text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then if sqlerrm=expected then return; end if; raise; end;
 raise exception 'expected rejection: %',expected;
end $$;
select pg_temp.owned_assert(public.ap_verified_intake_ownership_schema_installed(),'verified ownership schema missing');
insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a1080000-0000-4000-8000-000000000001','owned-intake@example.invalid',now(),false,'{}','{}',now(),now()),
 ('a1080000-0000-4000-8000-000000000002','owned-operator@example.invalid',now(),false,'{}','{}',now(),now()),
 ('a1080000-0000-4000-8000-000000000003','owned-outsider@example.invalid',now(),false,'{}','{}',now(),now()),
 ('a1080000-0000-4000-8000-000000000004','owned-anonymous@example.invalid',now(),true,'{}','{}',now(),now()),
 ('a1080000-0000-4000-8000-000000000005','owned-unverified@example.invalid',null,false,'{}','{}',now(),now());
update public.profiles set role='operator' where id='a1080000-0000-4000-8000-000000000002';
select pg_temp.owned_reject($s$select public.ap_create_owned_intake_draft('a1080000-0000-4000-8000-000000000004','owned-anonymous@example.invalid','a1080000-0000-4000-8000-000000000011','a1080000-0000-4000-8000-000000000010',repeat('a8',32),now()+interval '1 day')$s$,'verified_intake_identity_required');
select pg_temp.owned_reject($s$select public.ap_create_owned_intake_draft('a1080000-0000-4000-8000-000000000005','owned-unverified@example.invalid','a1080000-0000-4000-8000-000000000011','a1080000-0000-4000-8000-000000000010',repeat('a8',32),now()+interval '1 day')$s$,'verified_intake_identity_required');
select public.ap_create_owned_intake_draft('a1080000-0000-4000-8000-000000000001','owned-intake@example.invalid','a1080000-0000-4000-8000-000000000011','a1080000-0000-4000-8000-000000000010',repeat('a8',32),now()+interval '1 day');
select pg_temp.owned_assert((public.ap_create_owned_intake_draft('a1080000-0000-4000-8000-000000000001','owned-intake@example.invalid','a1080000-0000-4000-8000-000000000011','a1080000-0000-4000-8000-000000000012',repeat('c8',32),now()+interval '1 day')->>'replayed')::boolean,'create replay failed');
select pg_temp.owned_assert(not exists(select 1 from public.ap_anonymous_drafts where id='a1080000-0000-4000-8000-000000000012'),'lost create response duplicated draft');
select pg_temp.owned_assert(public.ap_retention_row_customers('ap_anonymous_drafts',to_jsonb(d))=array['a1080000-0000-4000-8000-000000000001'::uuid],'unfinalized owner missing from retention') from public.ap_anonymous_drafts d where id='a1080000-0000-4000-8000-000000000010';
select pg_temp.owned_assert(jsonb_array_length(public.ap_owned_intake_drafts('a1080000-0000-4000-8000-000000000003'))=0,'outsider list disclosed draft');
select pg_temp.owned_reject($s$select public.ap_owned_intake_draft_context('a1080000-0000-4000-8000-000000000003','a1080000-0000-4000-8000-000000000010',repeat('a8',32))$s$,'owned_intake_unavailable');
select pg_temp.owned_reject($s$select public.ap_claim_intake_draft('a1080000-0000-4000-8000-000000000003','owned-outsider@example.invalid','a1080000-0000-4000-8000-000000000010',repeat('a8',32))$s$,'owned_intake_unavailable');
select * from public.ap_save_four_step_draft('a1080000-0000-4000-8000-000000000010',repeat('a8',32),1,3,
 '{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","email":"owned-intake@example.invalid","documentContactEmail":"resume-contact@example.invalid","entryMode":"GUIDED","backgroundReviewed":true,"noPriorEmployment":true,"experienceAdditions":[]}');
select pg_temp.owned_reject($s$select public.ap_save_four_step_draft('a1080000-0000-4000-8000-000000000010',repeat('a8',32),2,3,'{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","email":"foreign@example.invalid"}')$s$,'owned_intake_access_identity_mismatch');
create temp table owned_before_resume as select to_jsonb(d)-array['capability_secret_hash','capability_version','capability_rotated_at'] body from public.ap_anonymous_drafts d where id='a1080000-0000-4000-8000-000000000010';
select public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010','a1080000-0000-4000-8000-000000000010',1,repeat('b8',32));
select pg_temp.owned_assert((select body from owned_before_resume)=to_jsonb(d)-array['capability_secret_hash','capability_version','capability_rotated_at'],'resume changed content/version/expiry') from public.ap_anonymous_drafts d where id='a1080000-0000-4000-8000-000000000010';
select pg_temp.owned_assert((public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010','a1080000-0000-4000-8000-000000000010',1,repeat('b8',32))->>'replayed')::boolean,'same resume lost-response replay failed');
select pg_temp.owned_reject($s$select public.ap_owned_intake_draft_context('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010',repeat('a8',32))$s$,'owned_intake_unavailable');
select pg_temp.owned_reject($s$select public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010','a1080000-0000-4000-8000-000000000010',1,repeat('c8',32))$s$,'owned_intake_changed');

create function pg_temp.owned_finalize(draft uuid,secret text,snapshot uuid,payload_id uuid) returns void language plpgsql as $$
declare d public.ap_anonymous_drafts; receipt jsonb; payload jsonb; cfg public.ap_commerce_configuration; fact record; reviews jsonb:='{}';
begin
 select * into strict d from public.ap_anonymous_drafts where id=draft;
 for fact in select id from public.ap_candidate_facts where draft_id=d.id and snapshot_id is null and superseded_at is null loop
  perform public.ap_record_fact_presentation(d.id,secret,d.version,fact.id,'fact-'||fact.id::text);
  reviews:=reviews||jsonb_build_object(fact.id::text,jsonb_build_object('decision',coalesce(d.answers->'factReviews'->>fact.id::text,'CONFIRM'),'correction',d.answers->'factCorrections'->fact.id::text));
 end loop;
 receipt:=public.ap_prepare_intake_confirmation(d.id,secret,d.version,public.ap_intake_confirmation_source(d.id,secret,d.version),repeat('c8',32),repeat('d8',32));
 payload:='{"desiredActivities":["SUPPORTING_CUSTOMERS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v4","entryMode":"GUIDED"}'::jsonb
  ||jsonb_build_object('accessEmailNormalized',d.answers->>'email','documentContactEmail',coalesce(d.answers->>'documentContactEmail',d.answers->>'email'),'confirmedReview',receipt,'entryMode',d.answers->>'entryMode');
 if d.answers ? 'clarifications' then payload:=payload||jsonb_build_object('clarifications',d.answers->'clarifications'); end if;
 select * into strict cfg from public.ap_commerce_configuration where singleton;
 perform public.ap_finalize_four_step_intake_with_legal_acceptance_v3(d.id,secret,d.version,snapshot,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),payload_id,
  decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),reviews,
  cfg.terms_version,cfg.terms_content_sha256,cfg.privacy_version,cfg.privacy_content_sha256,cfg.legal_acceptance_copy_version,cfg.legal_acceptance_copy_sha256,
  cfg.legal_content_canonicalization_version,cfg.legal_receipt_schema_version,encode(extensions.digest(snapshot::text,'sha256'),'hex'));
end $$;
select pg_temp.owned_finalize('a1080000-0000-4000-8000-000000000010',repeat('b8',32),'a1080000-0000-4000-8000-000000000020','a1080000-0000-4000-8000-000000000021');
select pg_temp.owned_assert(public.ap_customer_owns_snapshot('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000020'),'unpaid confirmed source missing owner');
create temp table owned_original as select to_jsonb(s) body from public.ap_intake_snapshots s where id='a1080000-0000-4000-8000-000000000020';
insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,legacy_compatibility)
 values('a1080000-0000-4000-8000-000000000030','APPLYPACK_FOUND','manual-reviewed','https://owned.example.invalid/apply','EMPLOYER_HOSTED','https://owned.example.invalid/job','Fictional Employer','Support',repeat('7',64),'{}',now(),true,now(),'{}','fixture-v1',repeat('7',64),true);
insert into public.ap_requirement_nodes(id,job_snapshot_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
 values('a1080000-0000-4000-8000-000000000031','a1080000-0000-4000-8000-000000000030',0,'CRITERION','WORK_MODE','a1080000-0000-4000-8000-000000000031','work-mode','INFORMATIONAL','line:1',1,'fixture-v1','{"kind":"WORK_MODE","modes":["REMOTE"]}','Remote work','fixture-v1','[]');
insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
 values('a1080000-0000-4000-8000-000000000032',now(),'fixture-v1','fixture-v1','fixture-v1',repeat('9',64));
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
 values('a1080000-0000-4000-8000-000000000033','a1080000-0000-4000-8000-000000000020','a1080000-0000-4000-8000-000000000032','fixture-v1','{}','REQUIRED',repeat('2',64));
insert into public.ap_inventory_members(inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication,exclusion_reason)
 values('a1080000-0000-4000-8000-000000000032','a1080000-0000-4000-8000-000000000030','owned-question-only',false,'Synthetic unverified candidate for question-only fixture');
create temp table owned_question as select public.ap_issue_candidate_question('a1080000-0000-4000-8000-000000000020','a1080000-0000-4000-8000-000000000030','a1080000-0000-4000-8000-000000000031','a1080000-0000-4000-8000-000000000002','Please describe your actual experience answering customer calls.') id;
select pg_temp.owned_assert((select count(*)=1 from public.ap_intake_clarification_notices where root_draft_id='a1080000-0000-4000-8000-000000000010'),'question notice not atomically enqueued');
select public.ap_issue_candidate_question('a1080000-0000-4000-8000-000000000020','a1080000-0000-4000-8000-000000000030','a1080000-0000-4000-8000-000000000031','a1080000-0000-4000-8000-000000000002','Please describe your actual experience answering customer calls.');
select pg_temp.owned_assert((select count(*)=1 from public.ap_intake_clarification_notices where root_draft_id='a1080000-0000-4000-8000-000000000010'),'replayed question duplicated notice');
select public.ap_answer_material_clarification((select id from owned_question),null,null,'a1080000-0000-4000-8000-000000000001','I answered customer calls.','a1080000-0000-4000-8000-000000000040',repeat('c8',32));
select pg_temp.owned_assert(public.ap_owned_intake_draft_context('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010',repeat('b8',32))->>'draftId'='a1080000-0000-4000-8000-000000000010','lost successor cookie blocked original-source recovery');
select * from public.ap_save_four_step_draft('a1080000-0000-4000-8000-000000000040',repeat('c8',32),
 (select version from public.ap_anonymous_drafts where id='a1080000-0000-4000-8000-000000000040'),3,
 (select jsonb_set(answers,'{clarifications,0,answer}','"I answered calls and scheduled appointments."') from public.ap_anonymous_drafts where id='a1080000-0000-4000-8000-000000000040'));
create temp table owned_saved_answer as select to_jsonb(a) body from public.ap_intake_clarification_answers a where question_id=(select id from owned_question);
select public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010','a1080000-0000-4000-8000-000000000040',1,repeat('d8',32));
select pg_temp.owned_assert((select answers#>>'{clarifications,0,answer}'='I answered calls and scheduled appointments.' from public.ap_anonymous_drafts where id='a1080000-0000-4000-8000-000000000040'),'owned resume replayed original answer');
select pg_temp.owned_assert((select body from owned_saved_answer)=to_jsonb(a),'owned resume changed immutable initial answer') from public.ap_intake_clarification_answers a where question_id=(select id from owned_question);
select pg_temp.owned_reject($s$select public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010','a1080000-0000-4000-8000-000000000010',2,repeat('e8',32))$s$,'owned_intake_changed');
update public.ap_outbox_messages set state='SENDING',lease_owner='owned-fixture',lease_expires_at=now()+interval '1 minute',first_submitted_at=now(),attempts=1
 where id=(select message_id from public.ap_intake_clarification_notices where question_id=(select id from owned_question));
select pg_temp.owned_assert(public.ap_prepare_intake_clarification_notification((select message_id from public.ap_intake_clarification_notices where question_id=(select id from owned_question)),'owned-fixture')->>'recipientEmail'='owned-intake@example.invalid','pinned notice context wrong');
select public.ap_pin_intake_clarification_delivery((select message_id from public.ap_intake_clarification_notices where question_id=(select id from owned_question)),'owned-fixture',repeat('18',32));
select pg_temp.owned_assert(public.ap_pin_intake_clarification_delivery((select message_id from public.ap_intake_clarification_notices where question_id=(select id from owned_question)),'owned-fixture',repeat('18',32))->>'payloadSha256'=repeat('18',32),'same notice envelope replay failed');
select pg_temp.owned_reject($s$select public.ap_pin_intake_clarification_delivery((select message_id from public.ap_intake_clarification_notices where question_id=(select id from owned_question)),'owned-fixture',repeat('28',32))$s$,'intake_notice_envelope_changed');
update auth.users set email='changed-owned@example.invalid' where id='a1080000-0000-4000-8000-000000000001';
update public.profiles set email='changed-owned@example.invalid' where id='a1080000-0000-4000-8000-000000000001';
update auth.users set email='owned-intake@example.invalid' where id='a1080000-0000-4000-8000-000000000003';
update public.profiles set email='owned-intake@example.invalid' where id='a1080000-0000-4000-8000-000000000003';
select pg_temp.owned_assert(public.ap_owned_intake_draft_context('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000040',repeat('d8',32))->>'verifiedEmail'='changed-owned@example.invalid','account email change lost stable ownership');
select pg_temp.owned_assert(public.ap_intake_payment_identity('a1080000-0000-4000-8000-000000000010','a1080000-0000-4000-8000-000000000020')->>'customerId'='a1080000-0000-4000-8000-000000000001','payment identity followed reused email');
select pg_temp.owned_assert(public.ap_claim_intake_draft('a1080000-0000-4000-8000-000000000001','changed-owned@example.invalid','a1080000-0000-4000-8000-000000000010',repeat('b8',32))->>'draftId'='a1080000-0000-4000-8000-000000000040','same-owner source claim replay did not preserve current leaf');
select pg_temp.owned_reject($s$select public.ap_claim_intake_draft('a1080000-0000-4000-8000-000000000003','owned-intake@example.invalid','a1080000-0000-4000-8000-000000000010',repeat('b8',32))$s$,'owned_intake_unavailable');
select pg_temp.owned_reject($s$select public.ap_prepare_intake_clarification_notification((select message_id from public.ap_intake_clarification_notices where question_id=(select id from owned_question)),'owned-fixture')$s$,'intake_notice_unavailable');
select pg_temp.owned_assert((select body from owned_original)=to_jsonb(s),'account or clarification changed immutable source') from public.ap_intake_snapshots s where id='a1080000-0000-4000-8000-000000000020';
select * from public.ap_save_four_step_draft('a1080000-0000-4000-8000-000000000040',repeat('d8',32),
 (select version from public.ap_anonymous_drafts where id='a1080000-0000-4000-8000-000000000040'),3,
 (select jsonb_set(answers,'{backgroundReviewed}','true') from public.ap_anonymous_drafts where id='a1080000-0000-4000-8000-000000000040'));
select pg_temp.owned_finalize('a1080000-0000-4000-8000-000000000040',repeat('d8',32),'a1080000-0000-4000-8000-000000000041','a1080000-0000-4000-8000-000000000042');
select pg_temp.owned_assert(public.ap_customer_owns_snapshot('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000041'),'confirmed descendant lost root ownership');
-- Existing unclaimed content requires both exact verified access identity and
-- current possession. Claiming cannot silently change supplied contact data.
select * from public.ap_create_anonymous_draft('a1080000-0000-4000-8000-000000000050',repeat('58',32),now()+interval '1 day');
select * from public.ap_save_four_step_draft('a1080000-0000-4000-8000-000000000050',repeat('58',32),1,0,'{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","email":"changed-owned@example.invalid","phone":"555-0100"}');
create temp table unclaimed_before as select to_jsonb(d) body from public.ap_anonymous_drafts d where id='a1080000-0000-4000-8000-000000000050';
select pg_temp.owned_reject($s$select public.ap_claim_intake_draft('a1080000-0000-4000-8000-000000000003','owned-intake@example.invalid','a1080000-0000-4000-8000-000000000050',repeat('58',32))$s$,'owned_intake_access_identity_mismatch');
select pg_temp.owned_reject($s$select public.ap_claim_intake_draft('a1080000-0000-4000-8000-000000000001','changed-owned@example.invalid','a1080000-0000-4000-8000-000000000050',repeat('00',32))$s$,'owned_intake_unavailable');
select public.ap_claim_intake_draft('a1080000-0000-4000-8000-000000000001','changed-owned@example.invalid','a1080000-0000-4000-8000-000000000050',repeat('58',32));
select pg_temp.owned_assert((select body from unclaimed_before)=to_jsonb(d),'claim rewrote existing private draft') from public.ap_anonymous_drafts d where id='a1080000-0000-4000-8000-000000000050';
select * from public.ap_create_anonymous_draft('a1080000-0000-4000-8000-000000000060',repeat('68',32),now()+interval '1 day');
select * from public.ap_save_four_step_draft('a1080000-0000-4000-8000-000000000060',repeat('68',32),1,0,'{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","name":"Fictional Applicant"}');
select pg_temp.owned_reject($s$select public.ap_claim_intake_draft('a1080000-0000-4000-8000-000000000001','changed-owned@example.invalid','a1080000-0000-4000-8000-000000000060',repeat('68',32))$s$,'owned_intake_access_identity_required');
select pg_temp.owned_reject($s$insert into public.ap_service_retention_claims(customer_id,order_ids) values('a1080000-0000-4000-8000-000000000001',array[gen_random_uuid()]); select public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000050','a1080000-0000-4000-8000-000000000050',1,repeat('78',32))$s$,'service_retention_purge_committed');
select pg_temp.owned_reject($s$insert into public.ap_archive_retention_runs(id,release_sha) values('a1080000-0000-4000-8000-000000000070',repeat('a',40)); select public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000050','a1080000-0000-4000-8000-000000000050',1,repeat('78',32))$s$,'archive_maintenance_retry_required');
select pg_temp.owned_reject($s$insert into public.orders(id,customer_id,product_kind,amount_cents,status,paid_at) values('a1080000-0000-4000-8000-000000000071','a1080000-0000-4000-8000-000000000001','job_search',1899,'paid',now()); insert into public.ap_search_services(legacy_order_id,customer_id,original_snapshot_id,active_snapshot_id,legacy_record) values('a1080000-0000-4000-8000-000000000071','a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000041','a1080000-0000-4000-8000-000000000041',true); select public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010','a1080000-0000-4000-8000-000000000040',2,repeat('78',32))$s$,'owned_intake_paid_or_checkout');
-- A begun checkout binds the immutable owner and remains readable only with
-- its already-current cookie; account capability rotation remains forbidden.
savepoint checkout_owner_fixture;
insert into public.ap_external_commands(id,draft_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,state)
 values('a1080000-0000-4000-8000-000000000072','a1080000-0000-4000-8000-000000000040','CREATE_CHECKOUT','stripe',repeat('9',64),'fictional-owned-checkout','CREATING');
insert into public.ap_checkout_attempts(id,draft_id,command_id,state) values('a1080000-0000-4000-8000-000000000073','a1080000-0000-4000-8000-000000000040','a1080000-0000-4000-8000-000000000072','NONE');
select pg_temp.owned_assert((select customer_id='a1080000-0000-4000-8000-000000000001' from public.ap_checkout_attempts where id='a1080000-0000-4000-8000-000000000073'),'checkout did not bind stable owner');
select pg_temp.owned_reject($s$update public.ap_checkout_attempts set customer_id='a1080000-0000-4000-8000-000000000003' where id='a1080000-0000-4000-8000-000000000073'$s$,'access_identity_mismatch');
select public.ap_owned_intake_draft_context('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000040',repeat('d8',32));
select pg_temp.owned_reject($s$select public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010','a1080000-0000-4000-8000-000000000040',2,repeat('78',32))$s$,'owned_intake_paid_or_checkout');
rollback to checkout_owner_fixture;
-- Synthetic historical direct-owner state, with every constraint/trigger on.
-- An unfinalized child must not hide the original owner's identity when an
-- old access email is later verified by somebody else.
insert into public.ap_anonymous_drafts select (jsonb_populate_record(null::public.ap_anonymous_drafts,to_jsonb(d)||jsonb_build_object(
 'id','a1080000-0000-4000-8000-000000000080','capability_secret_hash',repeat('88',32),'finalized_snapshot_id',null))).*
 from public.ap_anonymous_drafts d where id='a1080000-0000-4000-8000-000000000010';
insert into public.ap_intake_snapshots select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(s)||jsonb_build_object(
 'id','a1080000-0000-4000-8000-000000000081','draft_id','a1080000-0000-4000-8000-000000000080','customer_id','a1080000-0000-4000-8000-000000000001'))).*
 from public.ap_intake_snapshots s where id='a1080000-0000-4000-8000-000000000020';
update public.ap_anonymous_drafts set finalized_snapshot_id='a1080000-0000-4000-8000-000000000081' where id='a1080000-0000-4000-8000-000000000080';
insert into public.ap_feasibility_coverage_plans(snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
 values('a1080000-0000-4000-8000-000000000081','a1080000-0000-4000-8000-000000000032','fixture-v1','{}','REQUIRED',repeat('2',64));
create temp table owned_foreign_question as select public.ap_issue_candidate_question('a1080000-0000-4000-8000-000000000081','a1080000-0000-4000-8000-000000000030','a1080000-0000-4000-8000-000000000031','a1080000-0000-4000-8000-000000000002','Please describe your actual experience answering customer calls.') id;
select public.ap_answer_material_clarification((select id from owned_foreign_question),null,null,'a1080000-0000-4000-8000-000000000001','I answered customer calls.','a1080000-0000-4000-8000-000000000082',repeat('89',32));
select pg_temp.owned_reject($s$select public.ap_claim_intake_draft('a1080000-0000-4000-8000-000000000003','owned-intake@example.invalid','a1080000-0000-4000-8000-000000000082',repeat('89',32))$s$,'owned_intake_unavailable');
update public.ap_retention_restore_lock set locked=true where singleton;
select pg_temp.owned_reject($s$select public.ap_owned_intake_draft_context('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000040',repeat('d8',32))$s$,'retention_restore_locked');
update public.ap_retention_restore_lock set locked=false where singleton;
update public.ap_anonymous_drafts set expires_at=created_at+interval '1 microsecond' where id='a1080000-0000-4000-8000-000000000040';
select pg_temp.owned_reject($s$select public.ap_resume_owned_intake_draft('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000010','a1080000-0000-4000-8000-000000000040',2,repeat('e8',32))$s$,'owned_intake_unavailable');
select pg_temp.owned_assert((public.ap_intake_payment_identity('a1080000-0000-4000-8000-000000000040','a1080000-0000-4000-8000-000000000041')->>'claimed')::boolean,'expired claim became historical fallback');
select pg_temp.owned_assert(not public.ap_customer_owns_snapshot('a1080000-0000-4000-8000-000000000001','a1080000-0000-4000-8000-000000000041'),'expired unpaid claim still authorized private question reads');
rollback;
select 'VERIFIED_INTAKE_OWNERSHIP_OK';

-- Independent connections require committed fictional setup. Keep the draft
-- history afterward; only the test helper function/config snapshot is removed.
do $$ begin if current_setting('listen_addresses')<>'127.0.0.1' then raise exception 'owned_intake_loopback_fixture_required'; end if; end $$;
create extension if not exists dblink with schema extensions;
insert into auth.users(id,email,email_confirmed_at,is_anonymous,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('a1090000-0000-4000-8000-000000000001','owned-race@example.invalid',now(),false,'{}','{}',now(),now());
do $$ declare draft_id uuid; secret text; begin
 for scenario in 1..5 loop
  draft_id:=('a1090000-0000-4000-8000-'||lpad((scenario*10)::text,12,'0'))::uuid;
  secret:=repeat(scenario::text||'9',32);
  perform public.ap_create_owned_intake_draft('a1090000-0000-4000-8000-000000000001','owned-race@example.invalid',gen_random_uuid(),draft_id,secret,clock_timestamp()+interval '1 day');
  perform public.ap_save_four_step_draft(draft_id,secret,1,3,'{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","email":"owned-race@example.invalid","entryMode":"GUIDED","backgroundReviewed":true,"noPriorEmployment":true,"experienceAdditions":[]}');
 end loop;
end $$;
create function public.owned_intake_race(scenario integer) returns text language plpgsql as $$
declare draft_id uuid; secret text;
begin
 draft_id:=('a1090000-0000-4000-8000-'||lpad((scenario*10)::text,12,'0'))::uuid;
 secret:=repeat(scenario::text||'9',32);
 if scenario=2 then
  perform public.ap_save_four_step_draft(draft_id,secret,2,3,'{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","email":"owned-race@example.invalid","entryMode":"GUIDED","backgroundReviewed":true,"noPriorEmployment":true,"experienceAdditions":[],"phone":"555-0199"}');
 elsif scenario=3 then
  perform public.ap_prepare_intake_confirmation(draft_id,secret,2,public.ap_intake_confirmation_source(draft_id,secret,2),repeat('a9',32),repeat('b9',32));
 elsif scenario=5 then
  perform public.ap_resume_owned_intake_draft('a1090000-0000-4000-8000-000000000001','a1090000-0000-4000-8000-000000000010','a1090000-0000-4000-8000-000000000010',2,repeat('f9',32));
 elsif scenario=6 then
  perform public.ap_resume_owned_intake_draft('a1090000-0000-4000-8000-000000000001','a1090000-0000-4000-8000-000000000020','a1090000-0000-4000-8000-000000000020',2,repeat('6a',32));
 else
  perform public.ap_resume_owned_intake_draft('a1090000-0000-4000-8000-000000000001',draft_id,draft_id,1,repeat(scenario::text||'a',32));
 end if;
 perform pg_sleep(2);
 return 'committed';
end $$;
create function pg_temp.owned_race_wait() returns void language plpgsql as $$ begin
 for attempt in 1..150 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='applypack_owned_racer' and state='active' and wait_event='PgSleep') then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'owned race never reached guarded delay';
end $$;
create function pg_temp.owned_race_reject(statement text,expected text) returns void language plpgsql as $$ begin
 begin execute statement; exception when others then if sqlerrm=expected then return; end if; raise; end;
 raise exception 'owned race unexpectedly accepted stale operation';
end $$;
select extensions.dblink_connect('owned_racer','host=127.0.0.1 port='||current_setting('port')||' dbname='||current_database()||' user=postgres application_name=applypack_owned_racer');
-- Resume commits first; the blocked stale save must recheck its capability.
select extensions.dblink_send_query('owned_racer','select public.owned_intake_race(1)');
select pg_temp.owned_race_wait();
select pg_temp.owned_race_reject($s$select public.ap_save_four_step_draft('a1090000-0000-4000-8000-000000000010',repeat('19',32),2,3,'{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","email":"owned-race@example.invalid"}')$s$,'draft_capability_invalid');
select result from extensions.dblink_get_result('owned_racer') as r(result text);
select result from extensions.dblink_get_result('owned_racer') as r(result text);
-- Save commits first; resume changes only capability and retains the new data.
select extensions.dblink_send_query('owned_racer','select public.owned_intake_race(2)');
select pg_temp.owned_race_wait();
select public.ap_resume_owned_intake_draft('a1090000-0000-4000-8000-000000000001','a1090000-0000-4000-8000-000000000020','a1090000-0000-4000-8000-000000000020',1,repeat('2a',32));
select result from extensions.dblink_get_result('owned_racer') as r(result text);
select result from extensions.dblink_get_result('owned_racer') as r(result text);
do $$ begin if not exists(select 1 from public.ap_anonymous_drafts where id='a1090000-0000-4000-8000-000000000020' and version=3 and answers->>'phone'='555-0199' and capability_version=2)
 then raise exception 'owned resume erased concurrent save'; end if; end $$;
-- Confirmation preparation has the same owner-before-draft order as resume.
select extensions.dblink_send_query('owned_racer','select public.owned_intake_race(3)');
select pg_temp.owned_race_wait();
select public.ap_resume_owned_intake_draft('a1090000-0000-4000-8000-000000000001','a1090000-0000-4000-8000-000000000030','a1090000-0000-4000-8000-000000000030',1,repeat('3a',32));
select result from extensions.dblink_get_result('owned_racer') as r(result text);
select result from extensions.dblink_get_result('owned_racer') as r(result text);
do $$ begin if not exists(select 1 from public.ap_anonymous_drafts where id='a1090000-0000-4000-8000-000000000030' and version=2 and confirmation_receipt is not null and finalized_snapshot_id is null)
 then raise exception 'owned resume changed confirmation'; end if; end $$;
-- The actual finalization entry point waits and rejects a rotated capability
-- before it can create a snapshot, legal receipt or research preparation.
select extensions.dblink_send_query('owned_racer','select public.owned_intake_race(4)');
select pg_temp.owned_race_wait();
select pg_temp.owned_race_reject($s$select public.ap_finalize_four_step_intake('a1090000-0000-4000-8000-000000000040',repeat('49',32),2,'a1090000-0000-4000-8000-000000000041','{}',repeat('b9',32),null,'{}')$s$,'draft_capability_invalid');
select result from extensions.dblink_get_result('owned_racer') as r(result text);
select result from extensions.dblink_get_result('owned_racer') as r(result text);
do $$ begin if exists(select 1 from public.ap_intake_snapshots where draft_id='a1090000-0000-4000-8000-000000000040') then raise exception 'stale race finalized intake'; end if; end $$;
create temp table owned_cleanup_configuration as select * from public.ap_retention_configuration;
update public.ap_retention_configuration set unpaid_draft_seconds=604800,unpaid_file_seconds=2592000,privacy_policy_approval_reference='fictional isolated cleanup contention fixture',approved=true where singleton;
update public.ap_anonymous_drafts set created_at=clock_timestamp()-interval '40 days',expires_at=clock_timestamp()-interval '1 day' where id='a1090000-0000-4000-8000-000000000050';
-- A real account resume holds the owner lock; expired-draft maintenance skips
-- without locking the draft and safely retries after the resume commits.
select extensions.dblink_send_query('owned_racer','select public.owned_intake_race(5)');
select pg_temp.owned_race_wait();
select * from public.ap_claim_unpaid_source_cleanup(20);
do $$ begin if (select state from public.ap_anonymous_drafts where id='a1090000-0000-4000-8000-000000000050')<>'IN_PROGRESS' then raise exception 'cleanup ignored held owner lock'; end if; end $$;
select result from extensions.dblink_get_result('owned_racer') as r(result text);
select result from extensions.dblink_get_result('owned_racer') as r(result text);
select * from public.ap_claim_unpaid_source_cleanup(20);
do $$ begin if (select state from public.ap_anonymous_drafts where id='a1090000-0000-4000-8000-000000000050')<>'EXPIRED' then raise exception 'cleanup failed after owner lock release'; end if; end $$;
update public.ap_retention_configuration c set unpaid_draft_seconds=s.unpaid_draft_seconds,unpaid_file_seconds=s.unpaid_file_seconds,
 privacy_policy_approval_reference=s.privacy_policy_approval_reference,approved=s.approved,updated_at=s.updated_at from owned_cleanup_configuration s where c.singleton=s.singleton;
-- New financial email pins never wait for an owner lock while holding a row.
-- A real concurrent resume owns that lock; insertion fails retryably, then the
-- identical insertion succeeds after release. The fictional checkout rolls back.
-- Leave the temporary command unbound so its FK does not hold a draft row lock
-- before the competing resume; the checkout itself carries the exact draft.
begin;
insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,state)
 values('a1090000-0000-4000-8000-000000000072','a1090000-0000-4000-8000-000000000001','CREATE_CHECKOUT','stripe',repeat('9a',32),'fictional-owned-pin-race','CREATING');
select extensions.dblink_send_query('owned_racer','select public.owned_intake_race(6)');
select pg_temp.owned_race_wait();
select pg_temp.owned_race_reject($s$insert into public.ap_checkout_attempts(id,draft_id,command_id,state)
 values('a1090000-0000-4000-8000-000000000073','a1090000-0000-4000-8000-000000000020','a1090000-0000-4000-8000-000000000072','NONE')$s$,'claimed_delivery_owner_busy');
select result from extensions.dblink_get_result('owned_racer') as r(result text);
select result from extensions.dblink_get_result('owned_racer') as r(result text);
insert into public.ap_checkout_attempts(id,draft_id,command_id,state)
 values('a1090000-0000-4000-8000-000000000073','a1090000-0000-4000-8000-000000000020','a1090000-0000-4000-8000-000000000072','NONE');
do $$ begin if not exists(select 1 from public.ap_checkout_attempts where id='a1090000-0000-4000-8000-000000000073' and claimed_customer_email='owned-race@example.invalid')
 then raise exception 'claimed recipient pin retry did not preserve verified identity'; end if; end $$;
rollback;
select 'VERIFIED_CLAIMED_DELIVERY_PIN_CONTENTION_RETRY_OK';
select extensions.dblink_disconnect('owned_racer');
drop function public.owned_intake_race(integer);
select 'VERIFIED_INTAKE_OWNERSHIP_REAL_CONNECTION_RACES_OK';

-- Fictional data only; real confirmation, question, answer and draft-save RPCs.
begin;
create function pg_temp.resume_current_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;
create function pg_temp.resume_current_answers() returns jsonb language sql as $$
 select '{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","entryMode":"GUIDED","backgroundReviewed":true,"noPriorEmployment":true,"experienceAdditions":[]}'::jsonb;
$$;
create function pg_temp.resume_current_finalize(draft uuid,secret text,snapshot uuid,payload_id uuid) returns void language plpgsql as $$
declare d public.ap_anonymous_drafts; receipt jsonb; payload jsonb; cfg public.ap_commerce_configuration; fact record; reviews jsonb:='{}';
begin
  select * into strict d from public.ap_anonymous_drafts where id=draft;
  for fact in select id from public.ap_candidate_facts where draft_id=d.id and snapshot_id is null and superseded_at is null loop
   perform public.ap_record_fact_presentation(d.id,secret,d.version,fact.id,'fact-'||fact.id::text);
   reviews:=reviews||jsonb_build_object(fact.id::text,jsonb_build_object('decision',coalesce(d.answers->'factReviews'->>fact.id::text,'CONFIRM'),'correction',d.answers->'factCorrections'->fact.id::text));
  end loop;
 receipt:=public.ap_prepare_intake_confirmation(d.id,secret,d.version,public.ap_intake_confirmation_source(d.id,secret,d.version),repeat('c',64),repeat('d',64));
 payload:='{"accessEmailNormalized":"resume-current@example.invalid","documentContactEmail":"resume-current@example.invalid","desiredActivities":["SUPPORTING_CUSTOMERS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v4","entryMode":"GUIDED"}'::jsonb
   ||jsonb_build_object('confirmedReview',receipt,'entryMode',d.answers->>'entryMode');
 if d.answers ? 'clarifications' then payload:=payload||jsonb_build_object('clarifications',d.answers->'clarifications'); end if;
 select * into strict cfg from public.ap_commerce_configuration where singleton;
 perform public.ap_finalize_four_step_intake_with_legal_acceptance_v3(d.id,secret,d.version,snapshot,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),payload_id,
   decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),reviews,
  cfg.terms_version,cfg.terms_content_sha256,cfg.privacy_version,cfg.privacy_content_sha256,cfg.legal_acceptance_copy_version,cfg.legal_acceptance_copy_sha256,
  cfg.legal_content_canonicalization_version,cfg.legal_receipt_schema_version,encode(extensions.digest(snapshot::text,'sha256'),'hex'));
end $$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('a1060000-0000-4000-8000-000000000001','authenticated','authenticated','resume-current-operator@example.invalid','{}','{}',now(),now());
update public.profiles set role='operator' where id='a1060000-0000-4000-8000-000000000001';
select * from public.ap_create_anonymous_draft('a1060000-0000-4000-8000-000000000002',repeat('a',64),now()+interval '1 day');
select * from public.ap_save_four_step_draft('a1060000-0000-4000-8000-000000000002',repeat('a',64),1,3,pg_temp.resume_current_answers());
select pg_temp.resume_current_finalize('a1060000-0000-4000-8000-000000000002',repeat('a',64),'a1060000-0000-4000-8000-000000000003','a1060000-0000-4000-8000-000000000004');

-- Synthetic SQL authorization state: seed customer_id on the initial INSERT
-- with every production constraint/trigger enabled. This is not proof of a
-- current signed-in HTTP intake binding. The separate actual HTTP journey uses
-- real anonymous confirmation/capabilities; no frozen historical guard is bypassed.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('a1060000-0000-4000-8000-000000000020','authenticated','authenticated','resume-current-customer@example.invalid','{}','{}',now(),now());
select * from public.ap_create_anonymous_draft('a1060000-0000-4000-8000-000000000061',repeat('2',64),now()+interval '1 day');
update public.ap_anonymous_drafts target set answers=source.answers,version=source.version,current_step=source.current_step,
 state='COMPLETE',confirmation_receipt=source.confirmation_receipt,access_email_normalized=source.access_email_normalized
 from public.ap_anonymous_drafts source where target.id='a1060000-0000-4000-8000-000000000061' and source.id='a1060000-0000-4000-8000-000000000002';
insert into public.ap_intake_snapshots select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(source)||jsonb_build_object(
 'id','a1060000-0000-4000-8000-000000000060','draft_id','a1060000-0000-4000-8000-000000000061','customer_id','a1060000-0000-4000-8000-000000000020'))).*
 from public.ap_intake_snapshots source where source.id='a1060000-0000-4000-8000-000000000003';
update public.ap_anonymous_drafts set finalized_snapshot_id='a1060000-0000-4000-8000-000000000060' where id='a1060000-0000-4000-8000-000000000061';
insert into public.ap_feasibility_requests(id,draft_id,snapshot_id,request_version,idempotency_key)
 values(gen_random_uuid(),'a1060000-0000-4000-8000-000000000061','a1060000-0000-4000-8000-000000000060','chunk2-v2','feasibility:a1060000-0000-4000-8000-000000000060');
create temp table resume_current_original as select to_jsonb(s) snapshot, d.answers, d.confirmation_receipt from public.ap_intake_snapshots s join public.ap_anonymous_drafts d on d.id=s.draft_id where s.id='a1060000-0000-4000-8000-000000000060';
do $$ begin
 begin perform public.ap_save_four_step_draft('a1060000-0000-4000-8000-000000000061',repeat('2',64),3,3,pg_temp.resume_current_answers()||'{"phone":"wrong"}');
  raise exception 'ordinary save reopened original confirmed intake';
 exception when others then if sqlerrm<>'confirmed_intake_requires_successor_review' then raise; end if; end;
end $$;

-- A fictional criterion is attached to the original bounded inventory. No claim
-- that this synthetic source is a real verified listing or eligible for delivery.
insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,legacy_compatibility)
 values('a1060000-0000-4000-8000-000000000010','APPLYPACK_FOUND','manual-reviewed','https://resume-current.example.invalid/apply','EMPLOYER_HOSTED','https://resume-current.example.invalid/job','Fictional Employer','Support',repeat('6',64),'{}',now(),true,now(),'{}','fixture-v1',repeat('6',64),true);
insert into public.ap_requirement_nodes(id,job_snapshot_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
 values('a1060000-0000-4000-8000-000000000011','a1060000-0000-4000-8000-000000000010',0,'CRITERION','WORK_MODE','a1060000-0000-4000-8000-000000000011','work-mode','INFORMATIONAL','line:1',1,'fixture-v1','{"kind":"WORK_MODE","modes":["REMOTE"]}','Remote work','fixture-v1','[]');
insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
 values('a1060000-0000-4000-8000-000000000012',now(),'fixture-v1','fixture-v1','fixture-v1',repeat('8',64));
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
 values('a1060000-0000-4000-8000-000000000013','a1060000-0000-4000-8000-000000000060','a1060000-0000-4000-8000-000000000012','fixture-v1','{}','REQUIRED',repeat('2',64));
insert into public.ap_inventory_members(inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication,exclusion_reason)
 values('a1060000-0000-4000-8000-000000000012','a1060000-0000-4000-8000-000000000010','fixture-question-only',false,'Synthetic unverified candidate for question-only fixture');
create temp table resume_current_question as select public.ap_issue_candidate_question('a1060000-0000-4000-8000-000000000060','a1060000-0000-4000-8000-000000000010','a1060000-0000-4000-8000-000000000011','a1060000-0000-4000-8000-000000000001','Please describe your actual experience answering customer calls.') id;
select pg_temp.resume_current_assert(not public.ap_research_snapshot_current('a1060000-0000-4000-8000-000000000060'),'question did not invalidate old research');
select pg_temp.resume_current_assert((select state='STALE' from public.ap_research_preparations where snapshot_id='a1060000-0000-4000-8000-000000000060'),'old preparation not fenced');

select pg_temp.resume_current_assert(public.ap_material_clarification_resume_schema_installed()
 and public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'='202610260103'
 and jsonb_array_length(public.ap_manual_launch_schema_readiness()->'requiredMigrations')=27,'resume103 readiness incomplete');
select public.ap_answer_material_clarification((select id from resume_current_question),'a1060000-0000-4000-8000-000000000061',repeat('2',64),null,
 'I answered customer calls.','a1060000-0000-4000-8000-000000000005',repeat('b',64));
select * from public.ap_save_four_step_draft('a1060000-0000-4000-8000-000000000005',repeat('b',64),
 (select version from public.ap_anonymous_drafts where id='a1060000-0000-4000-8000-000000000005'),3,
 (select jsonb_set(answers,'{clarifications,0,answer}','"I answered customer calls and scheduled appointments."') from public.ap_anonymous_drafts where id='a1060000-0000-4000-8000-000000000005'));
create temp table resume_current_before as select to_jsonb(d) draft,to_jsonb(a) receipt from public.ap_anonymous_drafts d
 join public.ap_intake_clarification_answers a on a.draft_id=d.id where d.id='a1060000-0000-4000-8000-000000000005';
create function pg_temp.resume_current_rejected(setup text,operation text,expected text) returns void language plpgsql as $$
begin
 if setup is not null then execute setup; end if;
 execute operation; raise exception 'resume unexpectedly accepted';
exception when others then if sqlerrm<>expected then raise; end if;
end $$;
do $$ declare q uuid; operation text; reply jsonb; d public.ap_anonymous_drafts; begin
 select id into q from resume_current_question;
 operation:=format('select public.ap_resume_material_clarification(%L,%L,%L,null,%L,%L)',q,'a1060000-0000-4000-8000-000000000061',repeat('2',64),'a1060000-0000-4000-8000-000000000005',repeat('b',64));
 perform pg_temp.resume_current_rejected(null,format('select public.ap_answer_material_clarification(%L,%L,%L,null,%L,%L,%L)',q,
  'a1060000-0000-4000-8000-000000000061',repeat('2',64),'I answered customer calls and scheduled appointments.','a1060000-0000-4000-8000-000000000005',repeat('b',64)),
  'clarification_answer_already_saved_edit_review');
 perform pg_temp.resume_current_rejected(null,replace(operation,repeat('2',64),repeat('0',64)),'question_owner_or_version_invalid');
 perform pg_temp.resume_current_rejected(null,replace(operation,repeat('b',64),repeat('0',64)),'clarification_capability_conflict');
 perform pg_temp.resume_current_rejected(null,replace(operation,'a1060000-0000-4000-8000-000000000005','a1060000-0000-4000-8000-000000000099'),'clarification_not_open');
 perform pg_temp.resume_current_rejected(null,format('select public.ap_resume_material_clarification(%L,null,null,%L,%L,%L)',q,
  'a1060000-0000-4000-8000-000000000001','a1060000-0000-4000-8000-000000000005',repeat('f',64)),'question_owner_or_version_invalid');
 perform pg_temp.resume_current_rejected('update public.ap_retention_restore_lock set locked=true where singleton',operation,'retention_restore_locked');
 perform pg_temp.resume_current_rejected(format('insert into public.ap_requirement_nodes select (jsonb_populate_record(null::public.ap_requirement_nodes,to_jsonb(n)||jsonb_build_object(''id'',''a1060000-0000-4000-8000-000000000070'',''stable_criterion_id'',''a1060000-0000-4000-8000-000000000070'',''position'',1))).* from public.ap_requirement_nodes n where id=''a1060000-0000-4000-8000-000000000011''; insert into public.ap_candidate_questions select (jsonb_populate_record(null::public.ap_candidate_questions,to_jsonb(q)||jsonb_build_object(''id'',''a1060000-0000-4000-8000-000000000071'',''requirement_node_id'',''a1060000-0000-4000-8000-000000000070''))).* from public.ap_candidate_questions q where id=%L',q),replace(operation,q::text,'a1060000-0000-4000-8000-000000000071'),'clarification_not_open');
 perform pg_temp.resume_current_rejected('update public.ap_anonymous_drafts set created_at=now()-interval ''2 days'',expires_at=now()-interval ''1 day'' where id=''a1060000-0000-4000-8000-000000000061''',operation,'question_owner_or_version_invalid');
 perform pg_temp.resume_current_rejected('update public.ap_anonymous_drafts set created_at=now()-interval ''2 days'',expires_at=now()-interval ''1 day'' where id=''a1060000-0000-4000-8000-000000000005''',operation,'clarification_not_open');
 perform pg_temp.resume_current_rejected('update public.ap_anonymous_drafts set retention_state=''DELETE_PENDING'' where id=''a1060000-0000-4000-8000-000000000005''',operation,'clarification_not_open');
 perform pg_temp.resume_current_rejected('insert into public.ap_service_retention_claims(customer_id,order_ids) values(''a1060000-0000-4000-8000-000000000020'',array[gen_random_uuid()])',operation,'service_retention_purge_committed');
 perform pg_temp.resume_current_rejected('insert into public.orders(id,customer_id,product_kind,amount_cents,status,paid_at) values(''a1060000-0000-4000-8000-000000000030'',''a1060000-0000-4000-8000-000000000020'',''job_search'',1899,''paid'',now()); insert into public.ap_search_services(legacy_order_id,customer_id,original_snapshot_id,active_snapshot_id,legacy_record) values(''a1060000-0000-4000-8000-000000000030'',''a1060000-0000-4000-8000-000000000020'',''a1060000-0000-4000-8000-000000000060'',''a1060000-0000-4000-8000-000000000060'',true)',operation,'clarification_paid_or_checkout_owner_exception');
 perform pg_temp.resume_current_rejected('insert into public.ap_external_commands(id,draft_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,state) values(''a1060000-0000-4000-8000-000000000031'',''a1060000-0000-4000-8000-000000000005'',''CREATE_CHECKOUT'',''stripe'',repeat(''9'',64),''fictional-resume-checkout'',''CREATING''); insert into public.ap_checkout_attempts(draft_id,command_id,state) values(''a1060000-0000-4000-8000-000000000005'',''a1060000-0000-4000-8000-000000000031'',''NONE'')',operation,'clarification_paid_or_checkout_owner_exception');
 execute operation into reply;
 select * into d from public.ap_anonymous_drafts where id='a1060000-0000-4000-8000-000000000005';
 perform pg_temp.resume_current_assert(reply=jsonb_build_object('state','FULL_REVIEW_REQUIRED','draftId',d.id,'version',d.version,'expiresAt',d.expires_at,'replayed',true),'anonymous resume receipt changed');
 perform pg_temp.resume_current_assert((select draft=to_jsonb(d) from resume_current_before),'anonymous resume rewrote working review');
 reply:=public.ap_resume_material_clarification(q,d.id,repeat('b',64),null,d.id,repeat('b',64));
 perform pg_temp.resume_current_assert(reply->>'draftId'=d.id::text,'successor capability did not resume');
 reply:=public.ap_resume_material_clarification(q,null,null,'a1060000-0000-4000-8000-000000000020',d.id,repeat('f',64));
 select * into d from public.ap_anonymous_drafts where id=d.id;
 perform pg_temp.resume_current_assert(d.capability_secret_hash=repeat('f',64) and d.capability_version=2,'authenticated recovery did not rotate exactly once');
 perform pg_temp.resume_current_assert((select draft-array['capability_secret_hash','capability_version','capability_rotated_at']=to_jsonb(d)-array['capability_secret_hash','capability_version','capability_rotated_at'] from resume_current_before),'rotation altered answer/version/confirmation');
 perform pg_temp.resume_current_rejected(null,format('select public.ap_resume_material_clarification(%L,%L,%L,null,%L,%L)',q,d.id,repeat('b',64),d.id,repeat('b',64)),'question_owner_or_version_invalid');
 perform pg_temp.resume_current_rejected(null,operation,'clarification_capability_conflict');
 reply:=public.ap_resume_material_clarification(q,null,null,'a1060000-0000-4000-8000-000000000020',d.id,repeat('f',64));
 perform pg_temp.resume_current_assert((select capability_version=2 from public.ap_anonymous_drafts where id=d.id),'same-hash customer replay rotated again');
 perform pg_temp.resume_current_assert((select receipt=to_jsonb(a) from resume_current_before,public.ap_intake_clarification_answers a where a.question_id=q),'immutable initial answer receipt changed');
 perform pg_temp.resume_current_assert((select snapshot=to_jsonb(s) and original.answers=source.answers and original.confirmation_receipt=source.confirmation_receipt from resume_current_original original,public.ap_intake_snapshots s join public.ap_anonymous_drafts source on source.id=s.draft_id where s.id='a1060000-0000-4000-8000-000000000060'),'original confirmed source changed');
 perform pg_temp.resume_current_assert(not exists(select 1 from public.ap_candidate_answers where question_id=q),'resume confirmed an answer');
 perform public.ap_save_four_step_draft(d.id,repeat('f',64),d.version,3,jsonb_set(d.answers,'{backgroundReviewed}','true'));
 perform pg_temp.resume_current_finalize(d.id,repeat('f',64),'a1060000-0000-4000-8000-000000000040','a1060000-0000-4000-8000-000000000041');
 perform pg_temp.resume_current_rejected(null,format('select public.ap_resume_material_clarification(%L,null,null,%L,%L,%L)',q,'a1060000-0000-4000-8000-000000000020',d.id,repeat('f',64)),'clarification_not_open');
end $$;
rollback;
select 'MATERIAL_CLARIFICATION_RESUME_OK';

-- Fictional data; real confirmation, question, successor and finalization RPCs.
begin;
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;
select pg_temp.assert_true(public.ap_material_clarification_schema_installed()
 and public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' in('202610250101','202610260102')
 and (public.ap_manual_launch_schema_readiness()->>'ready')::boolean
 and jsonb_array_length(public.ap_manual_launch_schema_readiness()->'requiredMigrations')=case public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' when '202610250101' then 25 when '202610260102' then 26 end
 and public.ap_manual_launch_schema_readiness()->'requiredMigrations' @> '["202610250099","202610250100","202610250101"]'::jsonb,
 'clarification aggregate schema readiness incomplete');
alter table public.ap_document_versions disable trigger ap_confirmed_document_source_frozen;
select pg_temp.assert_true(not public.ap_material_clarification_schema_installed(),'disabled confirmed-source guard passed readiness');
alter table public.ap_document_versions enable trigger ap_confirmed_document_source_frozen;
grant execute on function public.ap_clone_clarification_sources(uuid,uuid) to service_role;
select pg_temp.assert_true(not public.ap_material_clarification_schema_installed(),'exposed internal source clone passed readiness');
revoke execute on function public.ap_clone_clarification_sources(uuid,uuid) from service_role;
select pg_temp.assert_true(public.ap_material_clarification_schema_installed(),'restored exact guards did not pass readiness');
create function pg_temp.answers() returns jsonb language sql as $$
 select '{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","entryMode":"GUIDED","backgroundReviewed":true,"noPriorEmployment":true,"experienceAdditions":[]}'::jsonb;
$$;
create function pg_temp.finalize(draft uuid,secret text,snapshot uuid,payload_id uuid) returns void language plpgsql as $$
declare d public.ap_anonymous_drafts; receipt jsonb; payload jsonb; cfg public.ap_commerce_configuration; fact record; reviews jsonb:='{}';
begin
  select * into strict d from public.ap_anonymous_drafts where id=draft;
  for fact in select id from public.ap_candidate_facts where draft_id=d.id and snapshot_id is null and superseded_at is null loop
   perform public.ap_record_fact_presentation(d.id,secret,d.version,fact.id,'fact-'||fact.id::text);
   reviews:=reviews||jsonb_build_object(fact.id::text,jsonb_build_object('decision',coalesce(d.answers->'factReviews'->>fact.id::text,'CONFIRM'),'correction',d.answers->'factCorrections'->fact.id::text));
  end loop;
 receipt:=public.ap_prepare_intake_confirmation(d.id,secret,d.version,public.ap_intake_confirmation_source(d.id,secret,d.version),repeat('c',64),repeat('d',64));
 payload:='{"accessEmailNormalized":"clarification@example.invalid","documentContactEmail":"clarification@example.invalid","desiredActivities":["SUPPORTING_CUSTOMERS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v4","entryMode":"GUIDED"}'::jsonb
   ||jsonb_build_object('confirmedReview',receipt,'entryMode',d.answers->>'entryMode');
 if d.answers ? 'clarifications' then payload:=payload||jsonb_build_object('clarifications',d.answers->'clarifications'); end if;
 select * into strict cfg from public.ap_commerce_configuration where singleton;
 perform public.ap_finalize_four_step_intake_with_legal_acceptance_v3(d.id,secret,d.version,snapshot,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),payload_id,
   decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),reviews,
  cfg.terms_version,cfg.terms_content_sha256,cfg.privacy_version,cfg.privacy_content_sha256,cfg.legal_acceptance_copy_version,cfg.legal_acceptance_copy_sha256,
  cfg.legal_content_canonicalization_version,cfg.legal_receipt_schema_version,encode(extensions.digest(snapshot::text,'sha256'),'hex'));
end $$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('a1010000-0000-4000-8000-000000000001','authenticated','authenticated','clarification-operator@example.invalid','{}','{}',now(),now());
update public.profiles set role='operator' where id='a1010000-0000-4000-8000-000000000001';
select * from public.ap_create_anonymous_draft('a1010000-0000-4000-8000-000000000002',repeat('a',64),now()+interval '1 day');
select * from public.ap_save_four_step_draft('a1010000-0000-4000-8000-000000000002',repeat('a',64),1,3,pg_temp.answers());
select pg_temp.finalize('a1010000-0000-4000-8000-000000000002',repeat('a',64),'a1010000-0000-4000-8000-000000000003','a1010000-0000-4000-8000-000000000004');
create temp table original as select to_jsonb(s) snapshot, d.answers, d.confirmation_receipt from public.ap_intake_snapshots s join public.ap_anonymous_drafts d on d.id=s.draft_id where s.id='a1010000-0000-4000-8000-000000000003';
do $$ begin
 begin perform public.ap_save_four_step_draft('a1010000-0000-4000-8000-000000000002',repeat('a',64),3,3,pg_temp.answers()||'{"phone":"wrong"}');
  raise exception 'ordinary save reopened original confirmed intake';
 exception when others then if sqlerrm<>'confirmed_intake_requires_successor_review' then raise; end if; end;
end $$;

-- A fictional criterion is attached to the original bounded inventory. No claim
-- that this synthetic source is a real verified listing or eligible for delivery.
insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,legacy_compatibility)
 values('a1010000-0000-4000-8000-000000000010','APPLYPACK_FOUND','manual-reviewed','https://clarification.example.invalid/apply','EMPLOYER_HOSTED','https://clarification.example.invalid/job','Fictional Employer','Support',repeat('b',64),'{}',now(),true,now(),'{}','fixture-v1',repeat('b',64),true);
insert into public.ap_requirement_nodes(id,job_snapshot_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
 values('a1010000-0000-4000-8000-000000000011','a1010000-0000-4000-8000-000000000010',0,'CRITERION','WORK_MODE','a1010000-0000-4000-8000-000000000011','work-mode','INFORMATIONAL','line:1',1,'fixture-v1','{"kind":"WORK_MODE","modes":["REMOTE"]}','Remote work','fixture-v1','[]');
insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
 values('a1010000-0000-4000-8000-000000000012',now(),'fixture-v1','fixture-v1','fixture-v1',repeat('1',64));
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
 values('a1010000-0000-4000-8000-000000000013','a1010000-0000-4000-8000-000000000003','a1010000-0000-4000-8000-000000000012','fixture-v1','{}','REQUIRED',repeat('2',64));
insert into public.ap_inventory_members(inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication,exclusion_reason)
 values('a1010000-0000-4000-8000-000000000012','a1010000-0000-4000-8000-000000000010','fixture-question-only',false,'Synthetic unverified candidate for question-only fixture');
create temp table question as select public.ap_issue_candidate_question('a1010000-0000-4000-8000-000000000003','a1010000-0000-4000-8000-000000000010','a1010000-0000-4000-8000-000000000011','a1010000-0000-4000-8000-000000000001','Please describe your actual experience answering customer calls.') id;
select pg_temp.assert_true(not public.ap_research_snapshot_current('a1010000-0000-4000-8000-000000000003'),'question did not invalidate old research');
select pg_temp.assert_true((select state='STALE' from public.ap_research_preparations where snapshot_id='a1010000-0000-4000-8000-000000000003'),'old preparation not fenced');
do $$ declare reply jsonb; replay jsonb; q uuid; d public.ap_anonymous_drafts; begin
  select id into q from question;
  perform pg_temp.assert_true(public.ap_material_clarification_answer_context(q,'a1010000-0000-4000-8000-000000000002',repeat('a',64),null)=jsonb_build_object(
   'mode','CONFIRMED_INTAKE','sourceDraftId','a1010000-0000-4000-8000-000000000002','successorDraftId',null),'authenticated capability context was not exact');
  begin perform public.ap_material_clarification_answer_context(q,'a1010000-0000-4000-8000-000000000002',repeat('f',64),null);
   raise exception 'foreign context read accepted'; exception when others then if sqlerrm<>'question_owner_or_version_invalid' then raise; end if; end;
  begin update public.ap_retention_restore_lock set locked=true where singleton;
   perform public.ap_answer_material_clarification(q,'a1010000-0000-4000-8000-000000000002',repeat('a',64),null,'I answered customer calls.','a1010000-0000-4000-8000-000000000005',repeat('b',64));
   raise exception 'restore lock allowed clarification'; exception when others then if sqlerrm<>'retention_restore_locked' then raise; end if; end;
  begin perform public.ap_answer_material_clarification(q,'a1010000-0000-4000-8000-000000000002',repeat('a',64),null,'I answered customer calls.','a1010000-0000-4000-8000-000000000002',repeat('b',64));
   raise exception 'successor identity collision accepted'; exception when unique_violation then null; end;
 begin perform public.ap_answer_material_clarification(q,'a1010000-0000-4000-8000-000000000002',repeat('f',64),null,'I answered customer calls.','a1010000-0000-4000-8000-000000000005',repeat('b',64));
  raise exception 'wrong capability accepted'; exception when others then if sqlerrm<>'question_owner_or_version_invalid' then raise; end if; end;
 reply:=public.ap_answer_material_clarification(q,'a1010000-0000-4000-8000-000000000002',repeat('a',64),null,'I answered customer calls.','a1010000-0000-4000-8000-000000000005',repeat('b',64));
 replay:=public.ap_answer_material_clarification(q,'a1010000-0000-4000-8000-000000000002',repeat('a',64),null,'I answered customer calls.',gen_random_uuid(),repeat('b',64));
 perform pg_temp.assert_true(reply->>'state'='FULL_REVIEW_REQUIRED' and reply->>'draftId'=replay->>'draftId' and (replay->>'replayed')::boolean,'successor replay was not exact');
 perform pg_temp.assert_true(not exists(select 1 from public.ap_candidate_answers where question_id=q),'answer became confirmed evidence before full review');
 perform pg_temp.assert_true((select answered and review_required from public.ap_material_clarification_questions('a1010000-0000-4000-8000-000000000005',repeat('b',64),null) where id=q),'answered anonymous question reappears');
 select * into d from public.ap_anonymous_drafts where id='a1010000-0000-4000-8000-000000000005';
 perform pg_temp.assert_true(not public.ap_material_clarification_answers_valid(d.id,d.answers-'clarifications'),'missing full answers passed');
 perform public.ap_save_four_step_draft(d.id,repeat('b',64),d.version,3,jsonb_set(d.answers,'{backgroundReviewed}','true'));
 perform pg_temp.finalize(d.id,repeat('b',64),'a1010000-0000-4000-8000-000000000006','a1010000-0000-4000-8000-000000000007');
 perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_answers a join public.ap_candidate_facts f on f.id=a.fact_id where a.question_id=q and f.snapshot_id='a1010000-0000-4000-8000-000000000006'),'clarification not bound exclusively to successor');
end $$;
select pg_temp.assert_true((select original.snapshot=to_jsonb(s) and original.answers=d.answers and original.confirmation_receipt=d.confirmation_receipt from original,public.ap_intake_snapshots s join public.ap_anonymous_drafts d on d.id=s.draft_id where s.id='a1010000-0000-4000-8000-000000000003'),'original immutable evidence changed');
select pg_temp.assert_true(public.ap_research_snapshot_current('a1010000-0000-4000-8000-000000000006') and exists(select 1 from public.ap_research_preparations where snapshot_id='a1010000-0000-4000-8000-000000000006'),'confirmed successor not enqueued');

-- Existing separate correction snapshots remain appendable; original source
-- rows still cannot be edited in place. This creates no new remedy or payment.
insert into public.ap_intake_snapshots
 select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(s)||jsonb_build_object(
  'id','a1010000-0000-4000-8000-000000000020','version',2,'snapshot_kind','MATERIAL_FACT_REVISION','parent_snapshot_id',s.id))).*
 from public.ap_intake_snapshots s where s.id='a1010000-0000-4000-8000-000000000006';
insert into public.ap_candidate_facts(draft_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,
 assertion_control_id,source_locator,verification,catalog_version,schema_version,fact_tier)
 values('a1010000-0000-4000-8000-000000000005','a1010000-0000-4000-8000-000000000020','separate-correction','CLARIFICATION','{"statement":"Fictional separately reviewed correction."}',
 'CUSTOMER_ASSERTION','a1010000-0000-4000-8000-000000000020','separate-correction','Separate immutable correction snapshot','CUSTOMER_CONFIRMED','fixture-v1','fixture-v1','MATCH_ENHANCING');
do $$ begin
 begin update public.ap_candidate_facts set typed_value='{"statement":"Changed original"}' where snapshot_id='a1010000-0000-4000-8000-000000000006';
  raise exception 'confirmed snapshot facts were mutable';
 exception when others then if sqlerrm not in('confirmed_intake_source_frozen','invalid_candidate_fact_mutation') then raise; end if; end;
end $$;

-- Real uploaded-document rows are inherited by exact identity, never copied to
-- a second storage_path row. Their original extracted facts stay unchanged.
select * from public.ap_create_anonymous_draft('a1010000-0000-4000-8000-000000000030',repeat('c',64),now()+interval '1 day');
select * from public.ap_register_anonymous_document('a1010000-0000-4000-8000-000000000030',repeat('c',64),1,
 'a1010000-0000-4000-8000-000000000031','RESUME','fixture.pdf','anonymous/a1010000-0000-4000-8000-000000000030/resume/fixture.pdf',128,'application/pdf','application/pdf',repeat('1',64));
select public.ap_record_isolated_document_review('a1010000-0000-4000-8000-000000000030','a1010000-0000-4000-8000-000000000031',repeat('1',64),'isolated-extractor-v1','["Worked as cashier at Fictional Store."]');
insert into public.ap_candidate_facts(id,draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,verification,catalog_version,schema_version,fact_tier,customer_display_label,customer_display_value)
 values('a1010000-0000-4000-8000-000000000032','a1010000-0000-4000-8000-000000000030','annotated:EMPLOYMENT:fixture','EMPLOYMENT','{"employer":"Fictional Store","historicalTitle":"Cashier"}',
 'DOCUMENT','a1010000-0000-4000-8000-000000000031','Fixture page1','EXTRACTED_UNCONFIRMED','fixture-v1','fixture-v1','SEARCH_CRITICAL','Employment','{"summary":"Cashier at Fictional Store"}');
insert into public.ap_candidate_facts(id,draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,verification,catalog_version,schema_version,fact_tier,customer_display_label,customer_display_value)
 values('a1010000-0000-4000-8000-000000000033','a1010000-0000-4000-8000-000000000030','annotated:RESPONSIBILITY:fixture','RESPONSIBILITY','{"employmentFactId":"a1010000-0000-4000-8000-000000000032","activity":"Handled customer calls"}',
 'DOCUMENT','a1010000-0000-4000-8000-000000000031','Fixture page1','EXTRACTED_UNCONFIRMED','fixture-v1','fixture-v1','MATCH_ENHANCING','Responsibility','{"summary":"Handled customer calls"}');
select * from public.ap_save_four_step_draft('a1010000-0000-4000-8000-000000000030',repeat('c',64),2,3,pg_temp.answers()||'{"entryMode":"CURRENT_RESUME","factReviews":{"a1010000-0000-4000-8000-000000000032":"CONFIRM","a1010000-0000-4000-8000-000000000033":"CONFIRM"}}');
select pg_temp.finalize('a1010000-0000-4000-8000-000000000030',repeat('c',64),'a1010000-0000-4000-8000-000000000034','a1010000-0000-4000-8000-000000000035');
select * from public.ap_create_anonymous_draft('a1010000-0000-4000-8000-000000000070',repeat('7',64),now()+interval '1 day');
do $$ begin
 begin
  update public.ap_document_versions set draft_id='a1010000-0000-4000-8000-000000000070',safe_display_name='changed.pdf'
   where id='a1010000-0000-4000-8000-000000000031';
  raise exception 'confirmed document was reparented to an unconfirmed draft';
 exception when others then if sqlerrm<>'confirmed_intake_source_frozen' then raise; end if; end;
 begin
  update public.ap_candidate_facts set draft_id='a1010000-0000-4000-8000-000000000070',typed_value='{"employer":"Invented","historicalTitle":"Changed"}'
   where id='a1010000-0000-4000-8000-000000000032';
  raise exception 'confirmed extracted fact was reparented to an unconfirmed draft';
 exception when others then if sqlerrm not in('confirmed_intake_source_frozen','invalid_candidate_fact_mutation') then raise; end if; end;
 begin
  update public.ap_candidate_facts set draft_id='a1010000-0000-4000-8000-000000000070',snapshot_id='a1010000-0000-4000-8000-000000000006',typed_value='{"employer":"Invented","historicalTitle":"Changed"}'
   where id='a1010000-0000-4000-8000-000000000032';
  raise exception 'confirmed extracted fact escaped via simultaneous draft and snapshot reparenting';
 exception when others then if sqlerrm not in('confirmed_intake_source_frozen','invalid_candidate_fact_mutation') then raise; end if; end;
 perform pg_temp.assert_true((select draft_id='a1010000-0000-4000-8000-000000000030' and safe_display_name='fixture.pdf' from public.ap_document_versions where id='a1010000-0000-4000-8000-000000000031'),'reparent changed original document');
 perform pg_temp.assert_true((select draft_id='a1010000-0000-4000-8000-000000000030' and typed_value->>'employer'='Fictional Store' from public.ap_candidate_facts where id='a1010000-0000-4000-8000-000000000032'),'reparent changed original fact');
end $$;
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
 values('a1010000-0000-4000-8000-000000000036','a1010000-0000-4000-8000-000000000034','a1010000-0000-4000-8000-000000000012','fixture-v1','{}','REQUIRED',repeat('2',64));
create temp table upload_question as select public.ap_issue_candidate_question('a1010000-0000-4000-8000-000000000034','a1010000-0000-4000-8000-000000000010','a1010000-0000-4000-8000-000000000011','a1010000-0000-4000-8000-000000000001','Which tools did you actually use to keep appointment records?') id;
create temp table upload_original as select to_jsonb(v) document from public.ap_document_versions v where id='a1010000-0000-4000-8000-000000000031';
do $$ declare q uuid; d public.ap_anonymous_drafts; reply jsonb; path text; begin
 select id into q from upload_question;
 select storage_path into path from public.ap_document_versions where id='a1010000-0000-4000-8000-000000000031';
 -- A durable cleanup claim that wins first prevents inheritance; its subtransaction
 -- is rolled back with the expected error, not deleted to accelerate a test.
 begin
  insert into public.ap_retention_legacy_object_intents(bucket,path_sha256) values('customer-source-documents',encode(extensions.digest(path,'sha256'),'hex'));
  perform public.ap_answer_material_clarification(q,'a1010000-0000-4000-8000-000000000030',repeat('c',64),null,'A paper calendar.','a1010000-0000-4000-8000-000000000037',repeat('d',64));
  raise exception 'cleanup-claimed source inherited';
 exception when others then if sqlerrm<>'clarification_source_unavailable' then raise; end if; end;
 perform pg_temp.assert_true(not exists(select 1 from public.ap_anonymous_drafts where id='a1010000-0000-4000-8000-000000000037'),'failed inheritance leaked successor');
 reply:=public.ap_answer_material_clarification(q,'a1010000-0000-4000-8000-000000000030',repeat('c',64),null,'A paper calendar.','a1010000-0000-4000-8000-000000000037',repeat('d',64));
 select * into d from public.ap_anonymous_drafts where id='a1010000-0000-4000-8000-000000000037';
 perform pg_temp.assert_true(not exists(select 1 from public.ap_document_versions where draft_id=d.id),'inherited upload duplicated a document row');
 perform pg_temp.assert_true((select count(*)=1 from public.ap_effective_intake_documents(d.id) where id='a1010000-0000-4000-8000-000000000031' and draft_id='a1010000-0000-4000-8000-000000000030'),'inherited source lost real identity');
 perform pg_temp.assert_true(not public.ap_legacy_retention_object_allowed('customer-source-documents',path),'active inherited source allowed deletion');
 perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts child join public.ap_candidate_facts parent on parent.id=(child.typed_value->>'employmentFactId')::uuid
  where child.draft_id=d.id and child.snapshot_id is null and parent.draft_id=d.id and parent.id<>'a1010000-0000-4000-8000-000000000032'),'cloned responsibility retained foreign parent');
 begin perform public.ap_answer_material_clarification(q,null,null,'a1010000-0000-4000-8000-000000000001','A paper calendar.',d.id,repeat('e',64));
  raise exception 'foreign signed-in customer answered'; exception when others then if sqlerrm<>'question_owner_or_version_invalid' then raise; end if; end;
 begin perform public.ap_answer_material_clarification(q,d.id,repeat('d',64),null,'Changed answer.',d.id,repeat('d',64));
  raise exception 'changed answer replay accepted'; exception when others then if sqlerrm<>'clarification_answer_already_saved_edit_review' then raise; end if; end;
 begin perform public.ap_answer_material_clarification(q,'a1010000-0000-4000-8000-000000000030',repeat('c',64),null,'A paper calendar.',d.id,repeat('e',64));
  raise exception 'different replay capability accepted'; exception when others then if sqlerrm<>'clarification_capability_conflict' then raise; end if; end;
 perform public.ap_save_four_step_draft(d.id,repeat('d',64),d.version,3,jsonb_set(d.answers,'{backgroundReviewed}','true'));
 perform pg_temp.finalize(d.id,repeat('d',64),'a1010000-0000-4000-8000-000000000038','a1010000-0000-4000-8000-000000000039');
 perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts where snapshot_id='a1010000-0000-4000-8000-000000000038' and document_version_id='a1010000-0000-4000-8000-000000000031'),'successor did not retain source-bound reviewed facts');
 perform pg_temp.assert_true((select document=to_jsonb(v) from upload_original,public.ap_document_versions v where v.id='a1010000-0000-4000-8000-000000000031'),'original upload metadata changed');
end $$;

-- Pending provider work blocks clarification without expiring/replacing it.
select * from public.ap_create_anonymous_draft('a1010000-0000-4000-8000-000000000040',repeat('e',64),now()+interval '1 day');
select * from public.ap_save_four_step_draft('a1010000-0000-4000-8000-000000000040',repeat('e',64),1,3,pg_temp.answers());
select pg_temp.finalize('a1010000-0000-4000-8000-000000000040',repeat('e',64),'a1010000-0000-4000-8000-000000000041','a1010000-0000-4000-8000-000000000042');
insert into public.ap_external_commands(id,draft_id,command_kind,provider,immutable_input_sha256,provider_idempotency_key,state)
 values('a1010000-0000-4000-8000-000000000043','a1010000-0000-4000-8000-000000000040','CREATE_CHECKOUT','stripe',repeat('9',64),'fictional-clarification-pending','CREATING');
insert into public.ap_checkout_attempts(id,draft_id,command_id,state)
 values('a1010000-0000-4000-8000-000000000044','a1010000-0000-4000-8000-000000000040','a1010000-0000-4000-8000-000000000043','NONE');
do $$ begin
 begin perform public.ap_issue_candidate_question('a1010000-0000-4000-8000-000000000041','a1010000-0000-4000-8000-000000000010','a1010000-0000-4000-8000-000000000011','a1010000-0000-4000-8000-000000000001','Please clarify your actual customer service experience.');
  raise exception 'in-flight provider command was replaced'; exception when others then if sqlerrm<>'clarification_paid_or_checkout_owner_exception' then raise; end if; end;
 perform pg_temp.assert_true((select state='NONE' and invalidated_at is null from public.ap_checkout_attempts where id='a1010000-0000-4000-8000-000000000044'),'pending checkout was modified');
 perform pg_temp.assert_true(not exists(select 1 from public.ap_intake_clarifications where source_snapshot_id='a1010000-0000-4000-8000-000000000041'),'pending checkout received a successor');
end $$;
select pg_temp.assert_true(public.ap_archive_fence_coverage_current(),'clarification ownership graph not protected by archive fence');
rollback;
select 'MATERIAL_CLARIFICATION_CONFIRMATION_OK';

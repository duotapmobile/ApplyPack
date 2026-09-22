begin;
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;

-- Synthetic fixture only: no provider document, source permission or customer proof.
select * from public.ap_create_anonymous_draft('45000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day');
select * from public.ap_create_anonymous_draft('45000000-0000-4000-8000-000000000002',repeat('b',64),now()+interval '1 day');
select * from public.ap_register_anonymous_document('45000000-0000-4000-8000-000000000001',repeat('a',64),1,'45000000-0000-4000-8000-000000000003','RESUME','synthetic.pdf','anonymous/45000000-0000-4000-8000-000000000001/resume/synthetic.pdf',128,'application/pdf','application/pdf',repeat('1',64));
select public.ap_record_isolated_document_review('45000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000003',repeat('1',64),'isolated-extractor-v1','["Synthetic Company — Coordinator, 2020–2022", "Maintained records and coordinated schedules."]');
do $$ declare sources uuid[]; annotated uuid; replay uuid;
begin
 select array_agg(id order by source_locator) into sources from public.ap_candidate_facts where draft_id='45000000-0000-4000-8000-000000000001';
 annotated:=public.ap_annotate_document_facts('45000000-0000-4000-8000-000000000001',repeat('a',64),sources,
   '{"kind":"EMPLOYMENT","historicalTitle":"Coordinator","employer":"Synthetic Company","dates":"2020–2022","bullets":["Maintained records and coordinated schedules."],"coverLetterEvidence":[]}',
   'Coordinator at Synthetic Company, 2020–2022. Maintained records and coordinated schedules.');
 replay:=public.ap_annotate_document_facts('45000000-0000-4000-8000-000000000001',repeat('a',64),sources,
   '{"kind":"EMPLOYMENT","historicalTitle":"Coordinator","employer":"Synthetic Company","dates":"2020–2022","bullets":["Maintained records and coordinated schedules."],"coverLetterEvidence":[]}',
   'Coordinator at Synthetic Company, 2020–2022. Maintained records and coordinated schedules.');
 perform pg_temp.assert_true(annotated=replay,'annotation replay duplicated facts');
 perform pg_temp.assert_true((select verification='EXTRACTED_UNCONFIRMED' and source_kind='DOCUMENT' and fact_tier='SEARCH_CRITICAL'
   and document_version_id='45000000-0000-4000-8000-000000000003' and typed_value->'sourceFactIds'=to_jsonb(sources)
   from public.ap_candidate_facts where id=annotated),'annotation lost provenance or invented confirmation');
 perform pg_temp.assert_true((select count(*)=2 from public.ap_candidate_facts where id=any(sources) and verification='EXTRACTED_UNCONFIRMED' and superseded_at is null),'annotation mutated original excerpts');
 begin
   perform public.ap_annotate_document_facts('45000000-0000-4000-8000-000000000002',repeat('b',64),sources,'{"kind":"RESPONSIBILITY","activity":"Maintained records"}','Maintained records');
   raise exception 'cross-draft annotation accepted';
 exception when raise_exception then if sqlerrm<>'annotation_source_binding_invalid' then raise; end if; end;
 begin
   perform public.ap_annotate_document_facts('45000000-0000-4000-8000-000000000001',repeat('b',64),sources,'{"kind":"RESPONSIBILITY","activity":"Maintained records"}','Maintained records');
   raise exception 'wrong secret accepted';
 exception when raise_exception then if sqlerrm<>'draft_capability_invalid' then raise; end if; end;
 begin
   perform public.ap_annotate_document_facts('45000000-0000-4000-8000-000000000001',repeat('a',64),sources,'{"kind":"EMPLOYMENT","employer":"Synthetic Company"}','Incomplete employment');
   raise exception 'incomplete employment accepted';
 exception when raise_exception then if sqlerrm<>'annotation_fields_required' then raise; end if; end;
end $$;
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ap_annotate_document_facts(uuid,text,uuid[],jsonb,text)','execute'),'direct customer annotation RPC exposed');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ap_begin_research_round(uuid,uuid,text,jsonb,uuid[],integer)','execute'),'direct research bootstrap exposed');
select pg_temp.assert_true(not has_table_privilege('service_role','public.ap_research_rounds','insert'),'research receipt bypass available');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ap_candidate_answers','select'),'candidate clarification leaked');
insert into public.ap_sensitive_payloads(id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
values('45000000-0000-4000-8000-000000000004','45000000-0000-4000-8000-000000000001',decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),repeat('5',64),'synthetic-kms','1',repeat('6',64));
select public.ap_record_fact_presentation('45000000-0000-4000-8000-000000000001',repeat('a',64),2,id,'annotation-review')
 from public.ap_candidate_facts where draft_id='45000000-0000-4000-8000-000000000001' and value_kind='EMPLOYMENT';
select * from public.ap_finalize_four_step_intake('45000000-0000-4000-8000-000000000001',repeat('a',64),2,'45000000-0000-4000-8000-000000000005',
 '{"accessEmailNormalized":"synthetic@example.invalid","documentContactEmail":"synthetic@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v3"}',repeat('7',64),'45000000-0000-4000-8000-000000000004',
 (select jsonb_object_agg(id::text,jsonb_build_object('decision','CONFIRM')) from public.ap_candidate_facts where draft_id='45000000-0000-4000-8000-000000000001' and value_kind='EMPLOYMENT'));
select pg_temp.assert_true((select count(*)=1 from public.ap_candidate_facts where snapshot_id='45000000-0000-4000-8000-000000000005'
 and verification='CUSTOMER_CONFIRMED' and value_kind='EMPLOYMENT' and typed_value ? 'sourceDocumentFactId'),'confirmed source fact did not reach immutable matching snapshot');
select public.ap_bind_confirmed_document_facts('45000000-0000-4000-8000-000000000005');
select pg_temp.assert_true((select count(*)=1 from public.ap_candidate_facts where snapshot_id='45000000-0000-4000-8000-000000000005'),'binding replay duplicated facts');
select pg_temp.assert_true(not public.ap_customer_owns_snapshot('45000000-0000-4000-8000-000000000099','45000000-0000-4000-8000-000000000005'),'unclaimed draft became customer owned');
update public.ap_candidate_facts set verification='DISPUTED' where draft_id='45000000-0000-4000-8000-000000000001' and snapshot_id is null and value_kind='EMPLOYMENT';
select pg_temp.assert_true((select verification='DISPUTED' from public.ap_candidate_facts where snapshot_id='45000000-0000-4000-8000-000000000005'),'disputed source did not invalidate snapshot copy');
-- Fixture claim represents already verified account ownership; it does not prove a real payment.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('45000000-0000-4000-8000-000000000010','00000000-0000-0000-0000-000000000000','authenticated','authenticated','synthetic@example.invalid','',now(),'{}','{}',now(),now());
insert into public.ap_board_profile_claims(profile_snapshot_id,draft_id,customer_id,profile_version,access_email_normalized)
values('45000000-0000-4000-8000-000000000005','45000000-0000-4000-8000-000000000001','45000000-0000-4000-8000-000000000010',1,'synthetic@example.invalid');
insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_on,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,legacy_compatibility)
values('45000000-0000-4000-8000-000000000011','APPLYPACK_FOUND','manual-reviewed','https://synthetic.invalid/apply','EMPLOYER_HOSTED','https://synthetic.invalid/job','Synthetic Company','Coordinator',repeat('a',64),'{}',now(),null,true,now(),'{}','synthetic-v1',repeat('b',64),true);
insert into public.ap_requirement_nodes(id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
values('45000000-0000-4000-8000-000000000012','45000000-0000-4000-8000-000000000011',null,0,'CRITERION','EXPERIENCE','45000000-0000-4000-8000-000000000013','experience.records','REQUIRED','line:1',1,'synthetic-v1','{"kind":"EXPERIENCE"}','Records experience.','synthetic-v1','[]');
insert into public.ap_candidate_questions(id,snapshot_id,job_snapshot_id,requirement_node_id,prompt,issued_by)
values('45000000-0000-4000-8000-000000000014','45000000-0000-4000-8000-000000000005','45000000-0000-4000-8000-000000000011','45000000-0000-4000-8000-000000000012','Which records did you maintain?','45000000-0000-4000-8000-000000000010');
select pg_temp.assert_true((select count(*)=1 from public.ap_customer_candidate_questions('45000000-0000-4000-8000-000000000010')),'verified owner cannot see clarification');
select pg_temp.assert_true((select count(*)=0 from public.ap_customer_candidate_questions('45000000-0000-4000-8000-000000000099')),'questions leaked across customers');
do $$ declare first_fact uuid; second_fact uuid;
begin
 begin
  perform public.ap_answer_customer_question('45000000-0000-4000-8000-000000000099','45000000-0000-4000-8000-000000000014','I maintained schedules.');
  raise exception 'cross-customer answer accepted';
 exception when raise_exception then if sqlerrm<>'question_owner_or_version_invalid' then raise; end if; end;
 first_fact:=public.ap_answer_customer_question('45000000-0000-4000-8000-000000000010','45000000-0000-4000-8000-000000000014','I maintained schedules.');
 second_fact:=public.ap_answer_customer_question('45000000-0000-4000-8000-000000000010','45000000-0000-4000-8000-000000000014','I maintained schedules.');
 perform pg_temp.assert_true(first_fact=second_fact,'answer replay duplicated evidence');
 begin
  perform public.ap_answer_customer_question('45000000-0000-4000-8000-000000000010','45000000-0000-4000-8000-000000000014','Different answer');
  raise exception 'answer history overwritten';
 exception when raise_exception then if sqlerrm<>'answer_immutable_correction_required' then raise; end if; end;
end $$;
insert into public.ap_intake_snapshots select (jsonb_populate_record(null::public.ap_intake_snapshots,to_jsonb(s)||jsonb_build_object('id','45000000-0000-4000-8000-000000000015','version',2,'parent_snapshot_id',s.id))).*
from public.ap_intake_snapshots s where id='45000000-0000-4000-8000-000000000005';
select pg_temp.assert_true((select count(*)=0 from public.ap_customer_candidate_questions('45000000-0000-4000-8000-000000000010')),'stale criteria clarification remained current');
-- Manual bounded checklist regression: empty findings cannot become ten jobs or
-- automated enumeration evidence. All identities and URLs here are synthetic.
update public.profiles set role='admin' where id='45000000-0000-4000-8000-000000000010';
insert into public.ap_feasibility_source_configurations(id,source_authorization_id,config_version,pagination_bound,lookback_bound,result_bound,release_verification_ttl,parser_version,cutoff_version,content_sha256,approved_by_role,approved_at)
select '45000000-0000-4000-8000-000000000020',a.id,'manual-fixture-v1',2,interval '1 day',10,interval '1 hour','fixture','fixture',repeat('a',64),'admin',now()
from public.ap_source_authorizations a join public.ap_source_authorization_heads h on h.current_authorization_id=a.id where a.source_id='manual-reviewed' and a.state='AUTHORIZED_MANUAL_ONLY';
insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
values('45000000-0000-4000-8000-000000000021',now(),'fixture','fixture','fixture',repeat('a',64));
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
values('45000000-0000-4000-8000-000000000022','45000000-0000-4000-8000-000000000015','45000000-0000-4000-8000-000000000021','fixture','{"requiredFamilyIds":["records"]}','REQUIRED',repeat('b',64));
insert into public.ap_feasibility_coverage_cells(id,plan_id,source_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,terminal_outcome,parser_result,query_family_id,source_authorization_id,configuration_id)
select '45000000-0000-4000-8000-000000000023','45000000-0000-4000-8000-000000000022','manual-reviewed','AUTHORIZED_MANUAL_ONLY',repeat('c',64),2,interval '1 day',10,'MANUAL','PENDING','{}','records',config.source_authorization_id,config.id from public.ap_feasibility_source_configurations config where id='45000000-0000-4000-8000-000000000020';
do $$ declare checklist jsonb:=jsonb_build_object('queryFingerprint',repeat('c',64),'pagesReviewed',1,'allEncounteredListingsAccountedFor',true,'stopReason','REVIEWED_CONFIGURED_SCOPE'); checked timestamptz:=clock_timestamp();
begin
 begin
  perform public.ap_complete_manual_research_cell('45000000-0000-4000-8000-000000000023','45000000-0000-4000-8000-000000000099',checked,'{}','["https://synthetic.invalid/careers"]',checklist,'Reviewed the bounded synthetic scope; no listings encountered.');
  raise exception 'unauthorized checklist accepted';
 exception when raise_exception then if sqlerrm<>'manual_research_operator_required' then raise; end if; end;
 begin
  perform public.ap_complete_manual_research_cell('45000000-0000-4000-8000-000000000023','45000000-0000-4000-8000-000000000010',checked,'{}','["https://synthetic.invalid/careers"]',checklist||'{"pagesReviewed":3}','Reviewed the bounded synthetic scope; no listings encountered.');
  raise exception 'out-of-bound checklist accepted';
 exception when raise_exception then if sqlerrm<>'manual_research_bound_exceeded' then raise; end if; end;
 begin
  perform public.ap_complete_manual_research_cell('45000000-0000-4000-8000-000000000023','45000000-0000-4000-8000-000000000010',checked,array['45000000-0000-4000-8000-000000000011']::uuid[],'["https://synthetic.invalid/careers"]',checklist,'Reviewed the bounded synthetic scope; no listings encountered.');
  raise exception 'unverified unevaluated manual job accepted';
 exception when raise_exception then if sqlerrm<>'manual_research_verified_evaluation_required' then raise; end if; end;
 perform public.ap_complete_manual_research_cell('45000000-0000-4000-8000-000000000023','45000000-0000-4000-8000-000000000010',checked,'{}','["https://synthetic.invalid/careers"]',checklist,'Reviewed the bounded synthetic scope; no listings encountered.');
 perform public.ap_complete_manual_research_cell('45000000-0000-4000-8000-000000000023','45000000-0000-4000-8000-000000000010',checked,'{}','["https://synthetic.invalid/careers"]',checklist,'Reviewed the bounded synthetic scope; no listings encountered.');
 perform pg_temp.assert_true((select count(*)=1 from public.ap_manual_research_reviews),'manual replay duplicated receipt');
 perform pg_temp.assert_true((select terminal_outcome='SUCCEEDED_EMPTY' and result_count=0 and manual_checklist_complete and not configured_bound_satisfied and parser_result->'automatedEnumeration'='false' from public.ap_feasibility_coverage_cells where id='45000000-0000-4000-8000-000000000023'),'manual scope was mislabeled exhaustive or padded');
 perform pg_temp.assert_true((select count(*)=0 from public.ap_match_evaluations where snapshot_id='45000000-0000-4000-8000-000000000015'),'manual checklist manufactured qualification');
end $$;
select pg_temp.assert_true(not has_function_privilege('authenticated','public.ap_complete_manual_research_cell(uuid,uuid,timestamptz,uuid[],jsonb,jsonb,text)','execute'),'manual completion exposed directly to customers');
rollback;

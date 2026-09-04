begin;

create function pg_temp.assert_true(value boolean, failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%', failure_message; end if; end $$;

select * from public.ap_create_anonymous_draft('31000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day');
select pg_temp.assert_true((select flow_version='FOUR_STEP_RESPONSIBILITY_V1' and current_step=0 from public.ap_anonymous_drafts where id='31000000-0000-4000-8000-000000000001'),'four-step draft not created');
select pg_temp.assert_true((select count(*)=0 from public.ap_read_four_step_draft('31000000-0000-4000-8000-000000000001',repeat('b',64))),'guessed secret accessed four-step draft');
select * from public.ap_save_four_step_draft('31000000-0000-4000-8000-000000000001',repeat('a',64),1,1,'{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","partial":true}');
do $$ begin
  perform public.ap_save_four_step_draft('31000000-0000-4000-8000-000000000001',repeat('a',64),1,2,'{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1"}');
  raise exception 'stale four-step write accepted';
exception when serialization_failure then if sqlerrm<>'draft_version_conflict' then raise; end if; end $$;

select * from public.ap_register_anonymous_document('31000000-0000-4000-8000-000000000001',repeat('a',64),2,'41000000-0000-4000-8000-000000000001','RESUME','resume.pdf','anonymous/31000000-0000-4000-8000-000000000001/resume/v1.pdf',128,'application/pdf','application/pdf',repeat('1',64));
select public.ap_apply_document_pipeline_result('41000000-0000-4000-8000-000000000001',1,'FAILED','ERROR','ERROR','ERROR','ERROR','fixture','{}','none','SCANNER_UNAVAILABLE');
select * from public.ap_retry_anonymous_document('31000000-0000-4000-8000-000000000001',repeat('a',64),3,'RESUME');
select pg_temp.assert_true((select processing_state='QUARANTINED' and failure_code is null from public.ap_document_versions where id='41000000-0000-4000-8000-000000000001'),'failed upload retry did not return to quarantine');

insert into public.ap_candidate_facts(id,draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,extraction_confidence,verification,catalog_version,schema_version,fact_tier,customer_display_label,customer_display_value)
values('61000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','latest-role','ROLE','{"summary":"Operations coordinator"}','DOCUMENT','41000000-0000-4000-8000-000000000001','page 1, role heading',.9,'EXTRACTED_UNCONFIRMED','catalog-v1','schema-v1','SEARCH_CRITICAL','Most recent role','{"summary":"Operations coordinator"}');
select public.ap_record_fact_presentation('31000000-0000-4000-8000-000000000001',repeat('a',64),4,'61000000-0000-4000-8000-000000000001','fact-61000000-0000-4000-8000-000000000001');

insert into public.ap_sensitive_payloads(id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
values('51000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001',decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),repeat('5',64),'synthetic-kms','1',repeat('6',64));

do $$ begin
  perform public.ap_finalize_four_step_intake('31000000-0000-4000-8000-000000000001',repeat('a',64),4,'52000000-0000-4000-8000-000000000001',
    '{"accessEmailNormalized":"person@example.invalid","documentContactEmail":"person@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"schedules":[],"travel":{},"benefits":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v2"}',repeat('7',64),'51000000-0000-4000-8000-000000000001','{"61000000-0000-4000-8000-000000000001":{"decision":"SKIP"}}');
  raise exception 'search-critical skip was accepted';
exception when others then if sqlerrm='search-critical skip was accepted' then raise; end if; if sqlerrm<>'search_critical_fact_review_required' then raise; end if; end $$;

select * from public.ap_finalize_four_step_intake('31000000-0000-4000-8000-000000000001',repeat('a',64),4,'52000000-0000-4000-8000-000000000001',
  '{"accessEmailNormalized":"person@example.invalid","documentContactEmail":"person@example.invalid","desiredActivities":["COORDINATING_PROJECTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"schedules":[],"travel":{},"benefits":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[{"clientId":"71000000-0000-4000-8000-000000000001","kind":"CAREGIVING","organizationOrProject":"","roleOrRelationship":"Caregiver","startsOn":"2024-01-01","endsOn":"2024-12-31","intensityPercent":50},{"clientId":"71000000-0000-4000-8000-000000000002","kind":"OTHER_RELEVANT_LIFE_CONTEXT","organizationOrProject":"","roleOrRelationship":"Relevant life context","startsOn":"2023-01-01","endsOn":"2023-06-30","intensityPercent":25}],"capabilities":{"EXCEL_SORT_FILTER":"CAN_DO_NOW"},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v2"}',repeat('7',64),'51000000-0000-4000-8000-000000000001','{"61000000-0000-4000-8000-000000000001":{"decision":"CONFIRM"}}');
select pg_temp.assert_true((select state='COMPLETE' and finalized_snapshot_id='52000000-0000-4000-8000-000000000001' from public.ap_anonymous_drafts where id='31000000-0000-4000-8000-000000000001'),'finalized draft state missing');
select pg_temp.assert_true((select state='PENDING' from public.ap_feasibility_requests where snapshot_id='52000000-0000-4000-8000-000000000001'),'real pending feasibility request missing');
select pg_temp.assert_true((select verification='CUSTOMER_CONFIRMED' from public.ap_candidate_facts where id='61000000-0000-4000-8000-000000000001'),'presented fact confirmation missing');
select pg_temp.assert_true((select not occupational_credit_eligible and intensity_percent=50 from public.ap_experience_identities where draft_id='31000000-0000-4000-8000-000000000001' and kind='CAREGIVING'),'caregiving identity or intensity incorrect');
select pg_temp.assert_true((select not occupational_credit_eligible and intensity_percent=25 from public.ap_experience_identities where draft_id='31000000-0000-4000-8000-000000000001' and kind='OTHER_RELEVANT_LIFE_CONTEXT'),'life-context identity or intensity incorrect');
select pg_temp.assert_true((select capability_status='CAN_DO_NOW' from public.ap_candidate_facts where semantic_key='capability:EXCEL_SORT_FILTER'),'task capability fact missing');

select * from public.ap_save_four_step_draft('31000000-0000-4000-8000-000000000001',repeat('a',64),5,3,'{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","edited":true}');
insert into public.ap_sensitive_payloads(id,draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash)
values('51000000-0000-4000-8000-000000000002','31000000-0000-4000-8000-000000000001',decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),repeat('8',64),'synthetic-kms','1',repeat('9',64));
select * from public.ap_finalize_four_step_intake('31000000-0000-4000-8000-000000000001',repeat('a',64),6,'52000000-0000-4000-8000-000000000002',
  '{"accessEmailNormalized":"person@example.invalid","documentContactEmail":"person@example.invalid","desiredActivities":["PREPARING_REPORTS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"schedules":[],"travel":{},"benefits":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"8888888888888888888888888888888888888888888888888888888888888888","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v2"}',repeat('a',64),'51000000-0000-4000-8000-000000000002','{}');
select pg_temp.assert_true((select parent_snapshot_id='52000000-0000-4000-8000-000000000001' and snapshot_kind='PRE_ACTIVATION_EDIT' from public.ap_intake_snapshots where id='52000000-0000-4000-8000-000000000002'),'immutable child snapshot missing');
select pg_temp.assert_true((select state='STALE' from public.ap_feasibility_requests where snapshot_id='52000000-0000-4000-8000-000000000001'),'superseded pending feasibility remained active');

select public.ap_increment_intake_event('STEP_VIEWED',1);
select public.ap_increment_intake_event('STEP_VIEWED',1);
select pg_temp.assert_true((select count=2 from public.ap_intake_event_counts where event_name='STEP_VIEWED' and step=1),'privacy-safe aggregate event count incorrect');
select pg_temp.assert_true(not has_table_privilege('anon','public.ap_anonymous_drafts','select'),'anonymous direct draft read granted');
select pg_temp.assert_true(not has_table_privilege('anon','public.ap_feasibility_requests','select'),'anonymous direct feasibility request read granted');

rollback;

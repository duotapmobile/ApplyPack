begin;
do $$ declare readiness jsonb:=public.ap_manual_launch_schema_readiness(); begin
 if readiness->>'requiredSchemaVersion' not in ('202610250089','202610250090','202610250091','202610250092','202610250093') or not (readiness->'requiredMigrations' ?& array['202610240087','202610250088','202610250089'])
   or not public.ap_confirmed_intake_schema_installed() then raise exception 'confirmed intake schema readiness is incomplete'; end if;
end $$;
create function pg_temp.assert_true(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;
create function pg_temp.answers(mode text) returns jsonb language sql as $$
  select jsonb_build_object('flowVersion','FOUR_STEP_RESPONSIBILITY_V1','entryMode',mode,'backgroundReviewed',true,'noPriorEmployment',true,'experienceAdditions','[]'::jsonb);
$$;
create function pg_temp.payload(mode text,receipt jsonb) returns jsonb language sql as $$
  select '{"accessEmailNormalized":"confirmed@example.invalid","documentContactEmail":"confirmed@example.invalid","desiredActivities":["SUPPORTING_CUSTOMERS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v4"}'::jsonb
    ||jsonb_build_object('entryMode',mode,'confirmedReview',receipt);
$$;
create function pg_temp.finalize(draft_id uuid,version bigint,snapshot_id uuid,sensitive_id uuid,payload jsonb,reviews jsonb)
returns void language plpgsql as $$ declare cfg public.ap_commerce_configuration; begin
  select * into strict cfg from public.ap_commerce_configuration where singleton;
  perform public.ap_finalize_four_step_intake_with_legal_acceptance_v3(
    draft_id,repeat(case right(draft_id::text,1) when '1' then 'a' when '2' then 'b' else 'c' end,64),version,snapshot_id,payload,repeat('7',64),sensitive_id,
    decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),
    repeat('5',64),'fixture-kms','1',repeat('6',64),reviews,
    cfg.terms_version,cfg.terms_content_sha256,cfg.privacy_version,cfg.privacy_content_sha256,
    cfg.legal_acceptance_copy_version,cfg.legal_acceptance_copy_sha256,
    cfg.legal_content_canonicalization_version,cfg.legal_receipt_schema_version,encode(extensions.digest(snapshot_id::text,'sha256'),'hex'));
end $$;

select * from public.ap_create_anonymous_draft('e8900000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day');
select * from public.ap_save_four_step_draft('e8900000-0000-4000-8000-000000000001',repeat('a',64),1,3,pg_temp.answers('GUIDED'));
do $$ declare source text; receipt jsonb; second_receipt jsonb; payload jsonb; begin
  source:=public.ap_intake_confirmation_source('e8900000-0000-4000-8000-000000000001',repeat('a',64),2);
  begin
    perform public.ap_prepare_intake_confirmation('e8900000-0000-4000-8000-000000000001',repeat('b',64),2,source,repeat('c',64),repeat('d',64));
    raise exception 'foreign capability accepted';
  exception when others then if sqlerrm<>'draft_capability_invalid' then raise; end if; end;
  begin
    perform public.ap_prepare_intake_confirmation('e8900000-0000-4000-8000-000000000001',repeat('a',64),2,repeat('0',64),repeat('c',64),repeat('d',64));
    raise exception 'wrong source accepted';
  exception when others then if sqlerrm<>'intake_review_stale' then raise; end if; end;
  receipt:=public.ap_prepare_intake_confirmation('e8900000-0000-4000-8000-000000000001',repeat('a',64),2,source,repeat('c',64),repeat('d',64));
  second_receipt:=public.ap_prepare_intake_confirmation('e8900000-0000-4000-8000-000000000001',repeat('a',64),2,source,repeat('c',64),repeat('d',64));
  perform pg_temp.assert_true(receipt=second_receipt,'identical review preparation was not idempotent');
  begin
    perform pg_temp.finalize('e8900000-0000-4000-8000-000000000001',2,'e8900000-0000-4000-8000-000000000011','e8900000-0000-4000-8000-000000000021',pg_temp.payload('GUIDED',null),'{}');
    raise exception 'missing factual confirmation accepted';
  exception when others then if sqlerrm<>'intake_review_stale' then raise; end if; end;
  payload:=pg_temp.payload('GUIDED',receipt);
  perform pg_temp.finalize('e8900000-0000-4000-8000-000000000001',2,'e8900000-0000-4000-8000-000000000011','e8900000-0000-4000-8000-000000000021',payload,'{}');
  perform pg_temp.finalize('e8900000-0000-4000-8000-000000000001',2,'e8900000-0000-4000-8000-000000000011','e8900000-0000-4000-8000-000000000021',payload,'{}');
  perform pg_temp.assert_true((select count(*)=1 from public.ap_intake_snapshots where draft_id='e8900000-0000-4000-8000-000000000001'),'lost response created duplicate snapshot');
  perform pg_temp.assert_true((select count(*)=1 from public.ap_snapshot_legal_acceptances where snapshot_id='e8900000-0000-4000-8000-000000000011'),'missing atomic legal receipt');
  perform pg_temp.assert_true(not exists(select 1 from public.ap_document_versions where draft_id='e8900000-0000-4000-8000-000000000001'),'guided intake invented a document');
  perform pg_temp.assert_true((select confirmed_review=receipt from public.ap_intake_snapshots where id='e8900000-0000-4000-8000-000000000011'),'snapshot lost the exact confirmation receipt');
end $$;

-- A later answer revision invalidates the prepared review without mutating the earlier snapshot.
select * from public.ap_save_four_step_draft('e8900000-0000-4000-8000-000000000001',repeat('a',64),3,3,pg_temp.answers('GUIDED')||'{"phone":"555 0101"}'::jsonb);
select pg_temp.assert_true(public.ap_read_intake_confirmation('e8900000-0000-4000-8000-000000000001',repeat('a',64)) is null,'edited answers retained prior approval');
select pg_temp.assert_true((select confirmed_review is not null from public.ap_intake_snapshots where id='e8900000-0000-4000-8000-000000000011'),'edit rewrote historical confirmation');

-- Uploaded facts retain their full values and references, including a previously confirmed fact corrected before payment.
select * from public.ap_create_anonymous_draft('e8900000-0000-4000-8000-000000000002',repeat('b',64),now()+interval '1 day');
select * from public.ap_register_anonymous_document('e8900000-0000-4000-8000-000000000002',repeat('b',64),1,
 'e8900000-0000-4000-8000-000000000032','RESUME','fixture.pdf','anonymous/e8900000-0000-4000-8000-000000000002/resume/fixture.pdf',128,'application/pdf','application/pdf',repeat('1',64));
select public.ap_record_isolated_document_review('e8900000-0000-4000-8000-000000000002','e8900000-0000-4000-8000-000000000032',repeat('1',64),'isolated-extractor-v1','["Worked as cashier at Fixture Store."]');
insert into public.ap_candidate_facts(id,draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,verification,catalog_version,schema_version,fact_tier,customer_display_label,customer_display_value,starts_on,ends_on,calendar_duration_days,intensity_percent)
values('e8900000-0000-4000-8000-000000000042','e8900000-0000-4000-8000-000000000002','annotated:EMPLOYMENT:fixture','EMPLOYMENT',
 '{"employer":"Fixture Store","historicalTitle":"Cashier","startsOn":"2020-01-01","endsOn":"2022-01-01","datePrecision":"EXACT_DAY","phone":"555 0100"}',
 'DOCUMENT','e8900000-0000-4000-8000-000000000032','Fixture page 1','EXTRACTED_UNCONFIRMED','fixture-v1','fixture-v1','SEARCH_CRITICAL','Employment','{"summary":"Cashier at Fixture Store"}','2020-01-01','2022-01-01',731,50);
insert into public.ap_candidate_facts(id,draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,verification,catalog_version,schema_version,fact_tier,customer_display_label,customer_display_value)
values('e8900000-0000-4000-8000-000000000043','e8900000-0000-4000-8000-000000000002','annotated:RESPONSIBILITY:fixture','RESPONSIBILITY',
 '{"employmentFactId":"e8900000-0000-4000-8000-000000000042","activity":"Handled cash"}',
 'DOCUMENT','e8900000-0000-4000-8000-000000000032','Fixture page 1','EXTRACTED_UNCONFIRMED','fixture-v1','fixture-v1','MATCH_ENHANCING','Responsibility','{"summary":"Handled cash"}');
insert into public.ap_candidate_facts(id,draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,verification,catalog_version,schema_version,fact_tier,customer_display_label,customer_display_value,capability_status)
values('e8900000-0000-4000-8000-000000000044','e8900000-0000-4000-8000-000000000002','annotated:TOOL:fixture','TOOL_CAPABILITY',
 '{"taskOrTool":"Excel sorting","capabilityStatus":"CAN_DO_NOW"}',
 'DOCUMENT','e8900000-0000-4000-8000-000000000032','Fixture page 1','EXTRACTED_UNCONFIRMED','fixture-v1','fixture-v1','MATCH_ENHANCING','Excel','{"summary":"Excel sorting: can do now"}','CAN_DO_NOW');
select * from public.ap_save_four_step_draft('e8900000-0000-4000-8000-000000000002',repeat('b',64),2,3,pg_temp.answers('CURRENT_RESUME'));
do $$ declare fact record; reviews jsonb:='{}'; receipt jsonb; begin
  for fact in select id from public.ap_candidate_facts where draft_id='e8900000-0000-4000-8000-000000000002' and snapshot_id is null loop
    perform public.ap_record_fact_presentation('e8900000-0000-4000-8000-000000000002',repeat('b',64),3,fact.id,'fact-'||fact.id::text);
    reviews:=reviews||jsonb_build_object(fact.id::text,jsonb_build_object('decision','CONFIRM','correction',null));
  end loop;
  reviews:=reviews||jsonb_build_object('e8900000-0000-4000-8000-000000000043',jsonb_build_object('decision','CORRECT','correction',jsonb_build_object('category','RESPONSIBILITY','responsibility','Handled customer payments')));
  receipt:=public.ap_prepare_intake_confirmation('e8900000-0000-4000-8000-000000000002',repeat('b',64),3,
    public.ap_intake_confirmation_source('e8900000-0000-4000-8000-000000000002',repeat('b',64),3),repeat('c',64),repeat('d',64));
  perform pg_temp.finalize('e8900000-0000-4000-8000-000000000002',3,'e8900000-0000-4000-8000-000000000012','e8900000-0000-4000-8000-000000000022',pg_temp.payload('CURRENT_RESUME',receipt),reviews);
  perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts child join public.ap_candidate_facts parent on parent.id=(child.typed_value->>'employmentFactId')::uuid
    where child.snapshot_id='e8900000-0000-4000-8000-000000000012' and parent.snapshot_id=child.snapshot_id and child.typed_value->>'activity'='Handled customer payments'), 'corrected responsibility lost its same-snapshot employment link');
  perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts where snapshot_id='e8900000-0000-4000-8000-000000000012' and value_kind='EMPLOYMENT' and starts_on='2020-01-01' and ends_on='2022-01-01' and calendar_duration_days=731 and intensity_percent=50),'unchanged confirmed duration/intensity lost');
  perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts where snapshot_id='e8900000-0000-4000-8000-000000000012' and capability_status='CAN_DO_NOW'),'unchanged confirmed capability lost');
  perform public.ap_save_four_step_draft('e8900000-0000-4000-8000-000000000002',repeat('b',64),4,3,pg_temp.answers('OUTDATED_RESUME'));
  reviews:=reviews||jsonb_build_object('e8900000-0000-4000-8000-000000000044',jsonb_build_object('decision','CORRECT','correction',jsonb_build_object('category','FIELD_EDITS','fields',jsonb_build_object('capabilityStatus','NOT_DONE'))));

  reviews:=reviews||jsonb_build_object('e8900000-0000-4000-8000-000000000042',jsonb_build_object('decision','CORRECT','correction',jsonb_build_object('category','FIELD_EDITS','fields',jsonb_build_object('employer','Corrected Store','historicalTitle','Team lead','phone','555 0199','startsOn','2021-01-01','endsOn','2024-01-01'))));
  receipt:=public.ap_prepare_intake_confirmation('e8900000-0000-4000-8000-000000000002',repeat('b',64),5,
    public.ap_intake_confirmation_source('e8900000-0000-4000-8000-000000000002',repeat('b',64),5),repeat('e',64),repeat('f',64));
  perform pg_temp.finalize('e8900000-0000-4000-8000-000000000002',5,'e8900000-0000-4000-8000-000000000013','e8900000-0000-4000-8000-000000000023',pg_temp.payload('OUTDATED_RESUME',receipt),reviews);
  perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts where snapshot_id='e8900000-0000-4000-8000-000000000013' and typed_value->>'employer'='Corrected Store' and typed_value->>'historicalTitle'='Team lead' and typed_value->>'phone'='555 0199' and typed_value->>'startsOn'='2021-01-01'),'reopened correction was ignored or lost unchanged source fields');
  perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts where snapshot_id='e8900000-0000-4000-8000-000000000012' and typed_value->>'employer'='Fixture Store'),'reopened correction rewrote the old snapshot');
  perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts where snapshot_id='e8900000-0000-4000-8000-000000000013' and value_kind='EMPLOYMENT' and starts_on='2021-01-01' and ends_on='2024-01-01' and calendar_duration_days=1095 and intensity_percent=50 and customer_display_value->>'summary' like '%Team lead%' and customer_display_value->>'summary' not like '%Cashier%'),'corrected projection/display retained stale source');
  perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts where snapshot_id='e8900000-0000-4000-8000-000000000013' and capability_status='NOT_DONE'),'corrected capability projection retained old claim');
  perform public.ap_save_four_step_draft('e8900000-0000-4000-8000-000000000002',repeat('b',64),6,3,pg_temp.answers('OUTDATED_RESUME'));
  reviews:=jsonb_set(reviews,'{e8900000-0000-4000-8000-000000000042,correction,fields,datePrecision}','"YEAR"');
  receipt:=public.ap_prepare_intake_confirmation('e8900000-0000-4000-8000-000000000002',repeat('b',64),7,
    public.ap_intake_confirmation_source('e8900000-0000-4000-8000-000000000002',repeat('b',64),7),repeat('e',64),repeat('f',64));
  perform pg_temp.finalize('e8900000-0000-4000-8000-000000000002',7,'e8900000-0000-4000-8000-000000000016','e8900000-0000-4000-8000-000000000026',pg_temp.payload('OUTDATED_RESUME',receipt),reviews);
  perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts where snapshot_id='e8900000-0000-4000-8000-000000000016' and value_kind='EMPLOYMENT' and starts_on is null and ends_on is null and calendar_duration_days is null),'approximate corrected dates retained exact projection');

end $$;

-- Source changes invalidate a prepared review; approximate guided dates stay approximate.
select * from public.ap_create_anonymous_draft('e8900000-0000-4000-8000-000000000003',repeat('c',64),now()+interval '1 day');
do $$ declare answers jsonb; receipt jsonb; payload jsonb; begin
 answers:=pg_temp.answers('GUIDED')||'{"noPriorEmployment":false,"experienceAdditions":[{"clientId":"guide-1","kind":"PAID_EMPLOYMENT","organizationOrProject":"Fixture Store","roleOrRelationship":"Cashier","startsOn":"2020-01-01","endsOn":"2022-01-01","datePrecision":"YEAR","responsibilities":["Handled payments"],"intensityPercent":null}]}'::jsonb;
 perform public.ap_save_four_step_draft('e8900000-0000-4000-8000-000000000003',repeat('c',64),1,3,answers);
 receipt:=public.ap_prepare_intake_confirmation('e8900000-0000-4000-8000-000000000003',repeat('c',64),2,
   public.ap_intake_confirmation_source('e8900000-0000-4000-8000-000000000003',repeat('c',64),2),repeat('c',64),repeat('d',64));
 payload:=pg_temp.payload('GUIDED',receipt)||jsonb_build_object('experienceAdditions',answers->'experienceAdditions');
 perform pg_temp.finalize('e8900000-0000-4000-8000-000000000003',2,'e8900000-0000-4000-8000-000000000014','e8900000-0000-4000-8000-000000000024',payload,'{}');
 perform pg_temp.assert_true(exists(select 1 from public.ap_candidate_facts where snapshot_id='e8900000-0000-4000-8000-000000000014' and typed_value->>'datePrecision'='YEAR' and starts_on is null and ends_on is null),'approximate dates became exact experience credit');
 perform pg_temp.assert_true(exists(select 1 from public.ap_experience_identities where draft_id='e8900000-0000-4000-8000-000000000003' and starts_on is null and ends_on is null),'approximate identity dates became exact');
 perform public.ap_save_four_step_draft('e8900000-0000-4000-8000-000000000003',repeat('c',64),3,3,answers);
 receipt:=public.ap_prepare_intake_confirmation('e8900000-0000-4000-8000-000000000003',repeat('c',64),4,
   public.ap_intake_confirmation_source('e8900000-0000-4000-8000-000000000003',repeat('c',64),4),repeat('c',64),repeat('d',64));
 perform public.ap_register_anonymous_document('e8900000-0000-4000-8000-000000000003',repeat('c',64),4,
   'e8900000-0000-4000-8000-000000000033','PRIOR_COVER_LETTER','fixture.pdf','anonymous/e8900000-0000-4000-8000-000000000003/prior_cover_letter/fixture.pdf',128,'application/pdf','application/pdf',repeat('1',64));
 begin
  perform pg_temp.finalize('e8900000-0000-4000-8000-000000000003',5,'e8900000-0000-4000-8000-000000000015','e8900000-0000-4000-8000-000000000025',pg_temp.payload('GUIDED',receipt)||jsonb_build_object('experienceAdditions',answers->'experienceAdditions'),'{}');
  raise exception 'changed source accepted stale receipt';
 exception when others then if sqlerrm<>'intake_review_stale' then raise; end if; end;
end $$;

select pg_temp.assert_true(not public.ap_confirmed_field_edits_valid('{"phone":"555"}', '{"employmentFactId":"forged"}'), 'field editor can change provenance');
select pg_temp.assert_true(not public.ap_confirmed_field_edits_valid('{"phone":"555"}', '{"phone":["wrong type"]}'), 'field editor changes original type');
select pg_temp.assert_true(not public.ap_confirmed_field_edits_valid('{"phone":"555"}', '{"employer":"invented field"}'), 'field editor adds absent fields');
select pg_temp.assert_true(not public.ap_confirmed_field_edits_valid('{"startsOn":"2020-01-01"}', '{"startsOn":"2025-02-30"}'), 'field editor accepts impossible date');

select pg_temp.assert_true(not has_function_privilege('anon','public.ap_prepare_intake_confirmation(uuid,text,bigint,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.ap_intake_confirmation_source(uuid,text,bigint)','EXECUTE'),'confirmation source leaked to a browser database role');
select pg_temp.assert_true((select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='intakes' and column_name='resume_path'),'guided source still requires a fabricated path');
rollback;

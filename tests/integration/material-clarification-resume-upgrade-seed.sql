-- Fictional data only; real confirmation, question, answer and draft-save RPCs.
create function pg_temp.resume_upgrade_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;
do $$ begin if (select max(version) from supabase_migrations.schema_migrations)<>'202610260102' or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610260102' or not public.ap_service_repair_case_state_schema_installed() or to_regprocedure('public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text)') is not null then raise exception 'clarification_resume_upgrade_exact_102_required'; end if; end $$;
create function pg_temp.resume_upgrade_answers() returns jsonb language sql as $$
 select '{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","entryMode":"GUIDED","backgroundReviewed":true,"noPriorEmployment":true,"experienceAdditions":[]}'::jsonb;
$$;
create function pg_temp.resume_upgrade_finalize(draft uuid,secret text,snapshot uuid,payload_id uuid) returns void language plpgsql as $$
declare d public.ap_anonymous_drafts; receipt jsonb; payload jsonb; cfg public.ap_commerce_configuration; fact record; reviews jsonb:='{}';
begin
  select * into strict d from public.ap_anonymous_drafts where id=draft;
  for fact in select id from public.ap_candidate_facts where draft_id=d.id and snapshot_id is null and superseded_at is null loop
   perform public.ap_record_fact_presentation(d.id,secret,d.version,fact.id,'fact-'||fact.id::text);
   reviews:=reviews||jsonb_build_object(fact.id::text,jsonb_build_object('decision',coalesce(d.answers->'factReviews'->>fact.id::text,'CONFIRM'),'correction',d.answers->'factCorrections'->fact.id::text));
  end loop;
 receipt:=public.ap_prepare_intake_confirmation(d.id,secret,d.version,public.ap_intake_confirmation_source(d.id,secret,d.version),repeat('c',64),repeat('d',64));
 payload:='{"accessEmailNormalized":"resume-upgrade@example.invalid","documentContactEmail":"resume-upgrade@example.invalid","desiredActivities":["SUPPORTING_CUSTOMERS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v4","entryMode":"GUIDED"}'::jsonb
   ||jsonb_build_object('confirmedReview',receipt,'entryMode',d.answers->>'entryMode');
 if d.answers ? 'clarifications' then payload:=payload||jsonb_build_object('clarifications',d.answers->'clarifications'); end if;
 select * into strict cfg from public.ap_commerce_configuration where singleton;
 perform public.ap_finalize_four_step_intake_with_legal_acceptance_v3(d.id,secret,d.version,snapshot,payload,encode(extensions.digest(payload::text,'sha256'),'hex'),payload_id,
   decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),repeat('5',64),'fixture-kms','1',repeat('6',64),reviews,
  cfg.terms_version,cfg.terms_content_sha256,cfg.privacy_version,cfg.privacy_content_sha256,cfg.legal_acceptance_copy_version,cfg.legal_acceptance_copy_sha256,
  cfg.legal_content_canonicalization_version,cfg.legal_receipt_schema_version,encode(extensions.digest(snapshot::text,'sha256'),'hex'));
end $$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('a1070000-0000-4000-8000-000000000001','authenticated','authenticated','resume-upgrade-operator@example.invalid','{}','{}',now(),now());
update public.profiles set role='operator' where id='a1070000-0000-4000-8000-000000000001';
select * from public.ap_create_anonymous_draft('a1070000-0000-4000-8000-000000000002',repeat('c',64),now()+interval '1 day');
select * from public.ap_save_four_step_draft('a1070000-0000-4000-8000-000000000002',repeat('c',64),1,3,pg_temp.resume_upgrade_answers());
select pg_temp.resume_upgrade_finalize('a1070000-0000-4000-8000-000000000002',repeat('c',64),'a1070000-0000-4000-8000-000000000003','a1070000-0000-4000-8000-000000000004');
create temp table resume_upgrade_original as select to_jsonb(s) snapshot, d.answers, d.confirmation_receipt from public.ap_intake_snapshots s join public.ap_anonymous_drafts d on d.id=s.draft_id where s.id='a1070000-0000-4000-8000-000000000003';
do $$ begin
 begin perform public.ap_save_four_step_draft('a1070000-0000-4000-8000-000000000002',repeat('c',64),3,3,pg_temp.resume_upgrade_answers()||'{"phone":"wrong"}');
  raise exception 'ordinary save reopened original confirmed intake';
 exception when others then if sqlerrm<>'confirmed_intake_requires_successor_review' then raise; end if; end;
end $$;

-- A fictional criterion is attached to the original bounded inventory. No claim
-- that this synthetic source is a real verified listing or eligible for delivery.
insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,legacy_compatibility)
 values('a1070000-0000-4000-8000-000000000010','APPLYPACK_FOUND','manual-reviewed','https://resume-upgrade.example.invalid/apply','EMPLOYER_HOSTED','https://resume-upgrade.example.invalid/job','Fictional Employer','Support',repeat('7',64),'{}',now(),true,now(),'{}','fixture-v1',repeat('7',64),true);
insert into public.ap_requirement_nodes(id,job_snapshot_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
 values('a1070000-0000-4000-8000-000000000011','a1070000-0000-4000-8000-000000000010',0,'CRITERION','WORK_MODE','a1070000-0000-4000-8000-000000000011','work-mode','INFORMATIONAL','line:1',1,'fixture-v1','{"kind":"WORK_MODE","modes":["REMOTE"]}','Remote work','fixture-v1','[]');
insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
 values('a1070000-0000-4000-8000-000000000012',now(),'fixture-v1','fixture-v1','fixture-v1',repeat('9',64));
insert into public.ap_feasibility_coverage_plans(id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
 values('a1070000-0000-4000-8000-000000000013','a1070000-0000-4000-8000-000000000003','a1070000-0000-4000-8000-000000000012','fixture-v1','{}','REQUIRED',repeat('2',64));
insert into public.ap_inventory_members(inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication,exclusion_reason)
 values('a1070000-0000-4000-8000-000000000012','a1070000-0000-4000-8000-000000000010','fixture-question-only',false,'Synthetic unverified candidate for question-only fixture');
create temp table resume_upgrade_question as select public.ap_issue_candidate_question('a1070000-0000-4000-8000-000000000003','a1070000-0000-4000-8000-000000000010','a1070000-0000-4000-8000-000000000011','a1070000-0000-4000-8000-000000000001','Please describe your actual experience answering customer calls.') id;
select pg_temp.resume_upgrade_assert(not public.ap_research_snapshot_current('a1070000-0000-4000-8000-000000000003'),'question did not invalidate old research');
select pg_temp.resume_upgrade_assert((select state='STALE' from public.ap_research_preparations where snapshot_id='a1070000-0000-4000-8000-000000000003'),'old preparation not fenced');

select public.ap_answer_material_clarification((select id from resume_upgrade_question),'a1070000-0000-4000-8000-000000000002',repeat('c',64),null,
 'I answered customer calls.','a1070000-0000-4000-8000-000000000005',repeat('d',64));
select * from public.ap_save_four_step_draft('a1070000-0000-4000-8000-000000000005',repeat('d',64),
 (select version from public.ap_anonymous_drafts where id='a1070000-0000-4000-8000-000000000005'),3,
 (select jsonb_set(answers,'{clarifications,0,answer}','"I answered customer calls and scheduled appointments."') from public.ap_anonymous_drafts where id='a1070000-0000-4000-8000-000000000005'));
insert into public.ap_payment_attempts(id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified)
 values('a1070000-0000-4000-8000-000000000050','a1070000-0000-4000-8000-000000000001','stripe','pi_fictional_clarification_resume_upgrade_102',799,'USD','PAID','NONE','2026-10-01T12:00:00Z','succeeded','card',true);
create table public.clarification_resume_103_upgrade_preservation_fixture(kind text,identity text,body_sha256 text);
do $$ declare item record; digest text; row_value jsonb; begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in('r','p') and c.relname<>'clarification_resume_103_upgrade_preservation_fixture' order by c.relname loop
  if item.relname in('ap_migration_checkpoints','ap_retention_private_tables','ap_archive_fence_relations','ap_archive_fence_function_contracts') then
   for row_value in execute format('select to_jsonb(t) from public.%I t',item.relname) loop
    if item.relname<>'ap_archive_fence_function_contracts' or row_value->>'signature' not in('public.ap_retention_snapshot_customers(uuid)','public.ap_retention_row_customers(text,jsonb)') then
     insert into public.clarification_resume_103_upgrade_preservation_fixture values('row',item.relname,encode(extensions.digest(row_value::text,'sha256'),'hex'));
    end if;
   end loop;
  else
   execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.relname) into digest;
   insert into public.clarification_resume_103_upgrade_preservation_fixture values('table',item.relname,digest);
  end if;
 end loop;
 insert into public.clarification_resume_103_upgrade_preservation_fixture
 select 'function',p.oid::regprocedure::text,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
  and p.proname not in('ap_manual_launch_schema_readiness','ap_archive_snapshot_schema_supported','ap_archive_fence_coverage_current',
   'ap_customer_owns_snapshot','ap_issue_candidate_question','ap_retention_snapshot_customers','ap_retention_row_customers',
   'ap_apply_verified_search_payment','ap_begin_search_checkout','ap_begin_authorized_search_checkout','ap_save_four_step_draft','ap_register_anonymous_document','ap_remove_anonymous_document',
   'ap_retry_anonymous_document','ap_record_fact_presentation','ap_record_isolated_document_review','ap_finalize_four_step_intake',
   'ap_prepare_intake_confirmation','ap_annotate_document_facts','ap_retry_document_processing',
   'ap_claim_unpaid_source_cleanup','ap_authorize_unpaid_source_delete','ap_finish_unpaid_source_delete',
   'ap_find_latest_access_order','ap_consume_order_access','ap_issue_order_access_capability','ap_authorize_staging_rehearsal_checkout');
end $$;
select 'MATERIAL_CLARIFICATION_RESUME_103_UPGRADE_SEEDED';

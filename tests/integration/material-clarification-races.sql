-- Disposable native/PG17 loopback database only. Fictional committed setup is
-- required for independent connections; no provider or hosted database calls.
do $$begin if current_setting('listen_addresses')<>'127.0.0.1' then raise exception 'native_loopback_fixture_required'; end if; end$$;
create extension if not exists dblink with schema extensions;
create table public.clarification_race_commands(id integer primary key,source_snapshot uuid,draft_id uuid,snapshot_id uuid,payload_id uuid,expected_version bigint,payload jsonb,secret_hash text,source_draft_id uuid,source_secret_hash text);
create function public.clarification_race_payload(receipt jsonb,clarifications jsonb) returns jsonb language sql as $$
 select '{"accessEmailNormalized":"clarification-race@example.invalid","documentContactEmail":"clarification-race@example.invalid","desiredActivities":["SUPPORTING_CUSTOMERS"],"avoidedActivities":[],"optionalTitles":[],"confirmedTitleRestriction":null,"optionalIndustries":[],"blockedIndustries":[],"searchBreadth":"ADJACENT_OPPORTUNITIES","guidanceRequested":false,"workModes":["REMOTE"],"preferredWorkMode":null,"stateOrDc":"VA","employmentTypes":["FULL_TIME"],"preferredEmploymentType":null,"schedules":[],"travel":{},"benefits":{},"workConditionPreferences":{},"dealbreakers":[],"salaryTargetCents":null,"salaryHardMinimumCents":null,"salaryMinimumFlexible":false,"salaryPeriod":null,"salaryBasis":null,"salaryOverlapPolicy":"EXCLUDE","salaryUnpublishedPolicy":"EXCLUDE","salaryNoncomparablePolicy":"EXCLUDE","salaryVariablePayPolicy":"EXCLUDE","employerUnknownPolicies":{},"priorCoverLetterUse":"NEITHER","experienceAdditions":[],"capabilities":{},"sensitivePayloadSha256":"5555555555555555555555555555555555555555555555555555555555555555","canonicalizationVersion":"applypack-c14n-v1","schemaVersion":"applypack-intake-v4","entryMode":"GUIDED"}'::jsonb
 ||jsonb_build_object('confirmedReview',receipt)||case when clarifications is null then '{}'::jsonb else jsonb_build_object('clarifications',clarifications) end;
$$;
create function public.clarification_race_finalize(command_id integer,delay boolean default false) returns text language plpgsql as $$
declare c public.clarification_race_commands; cfg public.ap_commerce_configuration; begin
 select * into strict c from public.clarification_race_commands where id=command_id;
 select * into strict cfg from public.ap_commerce_configuration where singleton;
  perform public.ap_finalize_four_step_intake_with_legal_acceptance_v3(c.draft_id,c.secret_hash,c.expected_version,c.snapshot_id,c.payload,
  encode(extensions.digest(c.payload::text,'sha256'),'hex'),c.payload_id,decode('01','hex'),'AES-256-GCM',decode('02','hex'),decode(repeat('03',12),'hex'),decode(repeat('04',16),'hex'),
  repeat('5',64),'fixture-kms','1',repeat('6',64),'{}',cfg.terms_version,cfg.terms_content_sha256,cfg.privacy_version,cfg.privacy_content_sha256,
  cfg.legal_acceptance_copy_version,cfg.legal_acceptance_copy_sha256,cfg.legal_content_canonicalization_version,cfg.legal_receipt_schema_version,
  encode(extensions.digest(c.snapshot_id::text,'sha256'),'hex'));
 if delay then perform pg_sleep(2); end if; return 'confirmed';
end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('a1020000-0000-4000-8000-000000000001','authenticated','authenticated','clarification-race-operator@example.invalid','{}','{}',now(),now());
update public.profiles set role='operator' where id='a1020000-0000-4000-8000-000000000001';
insert into public.ap_job_snapshots(id,origin,discovery_source,canonical_application_url,application_host_type,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,posted_date_unknown,live_verified_at,location_and_work_mode,parser_version,content_sha256,legacy_compatibility)
 values('a1020000-0000-4000-8000-000000000010','APPLYPACK_FOUND','manual-reviewed','https://clarification-race.example.invalid/apply','EMPLOYER_HOSTED','https://clarification-race.example.invalid/job','Fictional Employer','Support',repeat('b',64),'{}',now(),true,now(),'{}','fixture-v1',repeat('b',64),true);
insert into public.ap_requirement_nodes(id,job_snapshot_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,human_correction_history)
 values('a1020000-0000-4000-8000-000000000011','a1020000-0000-4000-8000-000000000010',0,'CRITERION','WORK_MODE','a1020000-0000-4000-8000-000000000011','work-mode-first','INFORMATIONAL','line:1',1,'fixture-v1','{"kind":"WORK_MODE","modes":["REMOTE"]}','Remote work','fixture-v1','[]'),
 ('a1020000-0000-4000-8000-000000000012','a1020000-0000-4000-8000-000000000010',1,'CRITERION','WORK_MODE','a1020000-0000-4000-8000-000000000012','work-mode-second','INFORMATIONAL','line:2',1,'fixture-v1','{"kind":"WORK_MODE","modes":["REMOTE"]}','Remote scheduling','fixture-v1','[]');
insert into public.ap_inventory_versions(id,cutoff_at,source_registry_version,query_version,parser_version,content_sha256)
 values('a1020000-0000-4000-8000-000000000013',now(),'fixture-v1','fixture-v1','fixture-v1',repeat('1',64));
insert into public.ap_inventory_members(inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication,exclusion_reason)
 values('a1020000-0000-4000-8000-000000000013','a1020000-0000-4000-8000-000000000010','fictional-race-question-only',false,'Synthetic unverified question fixture');
do $$ declare source_draft uuid; original uuid; successor uuid; q uuid; receipt jsonb; answers jsonb; original_hash text; successor_hash text; d public.ap_anonymous_drafts; begin
  for scenario in 1..3 loop
   source_draft:=gen_random_uuid(); original:=gen_random_uuid(); successor:=gen_random_uuid();
   original_hash:=repeat(scenario::text,64); successor_hash:=repeat((scenario+4)::text,64);
  answers:='{"flowVersion":"FOUR_STEP_RESPONSIBILITY_V1","entryMode":"GUIDED","backgroundReviewed":true,"noPriorEmployment":true,"experienceAdditions":[]}'::jsonb;
   perform public.ap_create_anonymous_draft(source_draft,original_hash,clock_timestamp()+interval '1 day');
   perform public.ap_save_four_step_draft(source_draft,original_hash,1,3,answers);
   receipt:=public.ap_prepare_intake_confirmation(source_draft,original_hash,2,public.ap_intake_confirmation_source(source_draft,original_hash,2),repeat('c',64),repeat('d',64));
   insert into public.clarification_race_commands values(scenario,original,source_draft,original,gen_random_uuid(),2,public.clarification_race_payload(receipt,null),original_hash,source_draft,original_hash);
  perform public.clarification_race_finalize(scenario);
  insert into public.ap_feasibility_coverage_plans(snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,content_sha256)
   values(original,'a1020000-0000-4000-8000-000000000013','fixture-v1','{}','REQUIRED',repeat('2',64));
  q:=public.ap_issue_candidate_question(original,'a1020000-0000-4000-8000-000000000010','a1020000-0000-4000-8000-000000000011','a1020000-0000-4000-8000-000000000001','Describe the actual scheduling tools you have used.');
   perform public.ap_answer_material_clarification(q,source_draft,original_hash,null,'A paper calendar.',successor,successor_hash);
  select * into strict d from public.ap_anonymous_drafts where id=successor;
   perform public.ap_save_four_step_draft(successor,successor_hash,d.version,3,jsonb_set(d.answers,'{backgroundReviewed}','true'));
  select * into strict d from public.ap_anonymous_drafts where id=successor;
   receipt:=public.ap_prepare_intake_confirmation(successor,successor_hash,d.version,public.ap_intake_confirmation_source(successor,successor_hash,d.version),repeat('c',64),repeat('d',64));
  update public.clarification_race_commands set draft_id=successor,snapshot_id=gen_random_uuid(),payload_id=gen_random_uuid(),expected_version=d.version,
    payload=public.clarification_race_payload(receipt,d.answers->'clarifications'),secret_hash=successor_hash where id=scenario;
 end loop;
end $$;
create function public.clarification_race_issue(scenario integer,delay boolean default false) returns text language plpgsql as $$begin
 perform public.ap_issue_candidate_question((select source_snapshot from public.clarification_race_commands where id=scenario),
  'a1020000-0000-4000-8000-000000000010','a1020000-0000-4000-8000-000000000012','a1020000-0000-4000-8000-000000000001','Which customer calls did you personally answer?');
 if delay then perform pg_sleep(2); end if; return 'question issued';
end $$;
create function pg_temp.wait_clarification_racer() returns void language plpgsql as $$begin
 for attempt in 1..150 loop
  if exists(select 1 from pg_stat_activity where application_name='applypack_clarification_racer' and state='active' and wait_event='PgSleep') then return; end if;
  perform pg_sleep(0.02);
 end loop; raise exception 'clarification race never reached guarded delay';
end $$;
create function pg_temp.expect_clarification_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement; exception when others then if sqlerrm=expected then return; end if; raise; end;
 raise exception 'expected clarification rejection:%',expected;
end $$;
select extensions.dblink_connect('clarification_racer','host=127.0.0.1 port='||current_setting('port')||' dbname='||current_database()||' user=postgres application_name=applypack_clarification_racer');

-- Confirmation wins: a concurrent late question waits, then rejects the closed
-- original case. No new question is attached to a confirmed replacement.
select extensions.dblink_send_query('clarification_racer','select public.clarification_race_finalize(1,true)');
select pg_temp.wait_clarification_racer();
select pg_temp.expect_clarification_error('select public.clarification_race_issue(1)','question_owner_or_version_invalid');
select result from extensions.dblink_get_result('clarification_racer') as r(result text);
select result from extensions.dblink_get_result('clarification_racer') as r(result text);
do $$begin
 if (select count(*) from public.ap_candidate_questions where snapshot_id=(select source_snapshot from public.clarification_race_commands where id=1))<>1
  then raise exception 'late question crossed final confirmation'; end if;
end $$;

-- Question wins: the stale finalization waits, then rejects its old draft
-- version. The new question remains unanswered and the full review is cleared.
select extensions.dblink_send_query('clarification_racer','select public.clarification_race_issue(2,true)');
select pg_temp.wait_clarification_racer();
select pg_temp.expect_clarification_error('select public.clarification_race_finalize(2)','draft_version_conflict');
select result from extensions.dblink_get_result('clarification_racer') as r(result text);
select result from extensions.dblink_get_result('clarification_racer') as r(result text);
do $$begin
 if not exists(select 1 from public.ap_anonymous_drafts d join public.clarification_race_commands c on c.draft_id=d.id where c.id=2
  and d.state='IN_PROGRESS' and d.confirmation_receipt is null and jsonb_array_length(d.answers->'clarifications')=2)
  then raise exception 'new question did not invalidate pending confirmation'; end if;
 if exists(select 1 from public.ap_intake_snapshots s join public.clarification_race_commands c on c.snapshot_id=s.id where c.id=2)
  then raise exception 'stale confirmation created a snapshot'; end if;
end $$;
create function public.clarification_race_rotate() returns text language plpgsql as $$begin
 update public.ap_anonymous_drafts set capability_secret_hash=repeat('f',64),capability_version=capability_version+1,capability_rotated_at=clock_timestamp()
  where id=(select source_draft_id from public.clarification_race_commands where id=3);
 perform pg_sleep(2); return 'rotated';
end $$;
create function public.clarification_race_answer() returns jsonb language plpgsql as $$
declare c public.clarification_race_commands; q uuid; begin
 select * into strict c from public.clarification_race_commands where id=3;
 select id into strict q from public.ap_candidate_questions where snapshot_id=c.source_snapshot;
 return public.ap_answer_material_clarification(q,c.source_draft_id,c.source_secret_hash,null,'A paper calendar.',c.draft_id,c.secret_hash);
end $$;
-- A capability can rotate after the initial authorization read but before this
-- answer obtains the source lock. Recheck under the locks; do not honor stale
-- authorization even for an otherwise identical answer replay.
create temp table clarification_race_unchanged_successor as
 select to_jsonb(d) body from public.ap_anonymous_drafts d join public.clarification_race_commands c on c.draft_id=d.id where c.id=3;
select extensions.dblink_send_query('clarification_racer','select public.clarification_race_rotate()');
select pg_temp.wait_clarification_racer();
select pg_temp.expect_clarification_error('select public.clarification_race_answer()','question_owner_or_version_invalid');
select result from extensions.dblink_get_result('clarification_racer') as r(result text);
select result from extensions.dblink_get_result('clarification_racer') as r(result text);
do $$begin
 if not exists(select 1 from public.ap_anonymous_drafts d join public.clarification_race_commands c on c.draft_id=d.id
  cross join clarification_race_unchanged_successor original where c.id=3 and original.body=to_jsonb(d))
  then raise exception 'stale capability changed successor'; end if;
end $$;
select extensions.dblink_disconnect('clarification_racer');
drop function public.clarification_race_rotate();
drop function public.clarification_race_answer();
drop function public.clarification_race_issue(integer,boolean);
drop function public.clarification_race_finalize(integer,boolean);
drop function public.clarification_race_payload(jsonb,jsonb);
drop table public.clarification_race_commands;
select 'MATERIAL_CLARIFICATION_REAL_CONNECTION_RACES_OK';

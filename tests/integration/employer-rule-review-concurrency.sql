-- Mandatory isolated engine proof. This commits fictional records solely so
-- independent PostgreSQL connections can contend on actual production locks.
do $$ begin if current_setting('listen_addresses')<>'127.0.0.1' then raise exception 'employer_rule_loopback_fixture_required'; end if; end $$;
create extension if not exists dblink with schema extensions;
begin;
\ir employer-rule-review-fixture.sql
create table public.employer_rule_race_inputs(scenario integer primary key,job uuid,actor uuid,request uuid,basis jsonb,rules jsonb,citations jsonb);
do $$ declare job uuid; prepared jsonb; rules jsonb; actor uuid:=current_setting('employer_test.actor')::uuid; begin
 for scenario in 1..3 loop
  job:=case when scenario=1 then current_setting('employer_test.job')::uuid else pg_temp.new_employer_job(scenario+10) end;
  prepared:=public.ap_prepare_employer_rule_source_evidence(job,actor);
  select public.ap_employer_rule_fields(r)||jsonb_build_object('sourceEvidenceIds',jsonb_build_array(prepared->>'sourceEvidenceId')) into rules
   from public.ap_employer_submission_rules r where id=current_setting('employer_test.rule')::uuid;
  insert into public.employer_rule_race_inputs values(scenario,job,actor,('b104f006-0000-4000-8000-'||lpad(scenario::text,12,'0'))::uuid,
   prepared->'basis',rules,pg_temp.employer_citations((prepared->>'sourceEvidenceId')::uuid,rules));
 end loop;
end $$;
create table public.employer_rule_paid_race_input(job uuid,actor uuid,basis jsonb);
do $$ declare j public.ap_material_draft_jobs; evidence jsonb; actor uuid:=current_setting('employer_test.actor')::uuid; begin
 select * into j from public.ap_material_draft_jobs where material_line_id=current_setting('employer_test.line')::uuid;
 evidence:=public.ap_material_draft_rule_evidence(j.id);
 perform public.ap_record_material_draft_listing_check(j.id,null,'b104f004-0000-4000-8000-000000000002','BEFORE_GENERATION',evidence#>>'{basis,ruleSha256}','ACTIVE',actor);
 insert into public.employer_rule_paid_race_input values(j.id,actor,public.ap_material_draft_rule_evidence(j.id)->'basis');
end $$;
create function public.employer_rule_test_race(scenario integer) returns text language plpgsql as $$
declare r public.employer_rule_race_inputs; paid public.employer_rule_paid_race_input; result jsonb;
 checklist jsonb:='{"applicationOpened":true,"listingOpened":true,"noUnsupportedDefaults":true,"questionsReviewed":true,"requirementsConfirmed":true,"sourceCompared":true}';
begin
 if scenario=5 then
  update public.job_sources set is_active=false where id='b104-manual-reviewed';
 elsif scenario=4 then
  select * into paid from public.employer_rule_paid_race_input;
  perform public.ap_revalidate_material_draft_rule(paid.job,null,'b104f006-0000-4000-8000-000000000004',paid.basis,
   '{"applicationAccessReviewed":true,"liveListingOpened":true,"submissionInstructionsCompared":true,"unchangedRuleConfirmed":true}',paid.actor);
 elsif scenario=3 then
  select * into r from public.employer_rule_race_inputs where employer_rule_race_inputs.scenario=3;
  perform public.ap_upsert_employer_submission_rules(r.actor,r.job,repeat('3f',32),array[(r.rules#>>'{sourceEvidenceIds,0}')::uuid],
   'REQUIRED','REQUIRED',array['PDF'],1,1,null,null,null,'OPTIONAL_NOW',null,'HTTPS_UPLOAD',null,null,'[]','legacy-first-create','CLEAR',null,clock_timestamp());
 else
  select * into r from public.employer_rule_race_inputs where employer_rule_race_inputs.scenario=employer_rule_test_race.scenario;
  result:=public.ap_confirm_employer_submission_rules(r.job,r.actor,r.request,r.basis,r.rules,checklist,r.citations);
 end if;
 perform pg_sleep(1.5);
 return 'committed';
end $$;
commit;
create function pg_temp.employer_race_wait() returns void language plpgsql as $$ begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='applypack_employer_rule_racer' and state='active' and wait_event='PgSleep') then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'employer rule race never reached guarded delay';
end $$;
select extensions.dblink_connect('employer_racer','host=127.0.0.1 port='||current_setting('port')||' dbname='||current_database()||' user=postgres application_name=applypack_employer_rule_racer');

-- Same request waits, then replays the exact committed original review.
select extensions.dblink_send_query('employer_racer','select public.employer_rule_test_race(1)');
select pg_temp.employer_race_wait();
select pg_temp.assert_true(public.ap_confirm_employer_submission_rules(job,actor,request,basis,rules,pg_temp.employer_checklist(),citations)->>'replayed'='true','concurrent exact request did not replay') from public.employer_rule_race_inputs where scenario=1;
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select pg_temp.assert_true((select count(*)=1 from public.ap_employer_rule_review_receipts where request_id=r.request),'same request duplicated review') from public.employer_rule_race_inputs r where scenario=1;

-- Two reviewers of an absent rule cannot both publish their stale basis.
select extensions.dblink_send_query('employer_racer','select public.employer_rule_test_race(2)');
select pg_temp.employer_race_wait();
select pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',job,actor,gen_random_uuid(),basis,rules,pg_temp.employer_checklist(),citations),'employer_rule_review_basis_changed') from public.employer_rule_race_inputs where scenario=2;
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select pg_temp.assert_true((select count(*)=1 from public.ap_employer_submission_rules where job_snapshot_id=r.job),'stale basis created second rule') from public.employer_rule_race_inputs r where scenario=2;

-- Historical writer shares serialization and preserves its first-create hash.
select extensions.dblink_send_query('employer_racer','select public.employer_rule_test_race(3)');
select pg_temp.employer_race_wait();
select pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',job,actor,request,basis,rules,pg_temp.employer_checklist(),citations),'employer_rule_review_basis_changed') from public.employer_rule_race_inputs where scenario=3;
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select pg_temp.assert_true((select count(*)=1 and min(content_sha256)=repeat('3f',32) from public.ap_employer_submission_rules where job_snapshot_id=r.job),'legacy initial hash contract changed') from public.employer_rule_race_inputs r where scenario=3;

-- Actual092 paid revalidation holds SHARE before its row locks. Ordinary104
-- confirmation waits at write intention, never reverses that lock order.
select extensions.dblink_send_query('employer_racer','select public.employer_rule_test_race(4)');
select pg_temp.employer_race_wait();
select pg_temp.assert_true(public.ap_confirm_employer_submission_rules(job,actor,'b104f006-0000-4000-8000-000000000005',basis,rules,pg_temp.employer_checklist(),citations)->>'current'='true','ordinary review failed after paid reader') from public.employer_rule_race_inputs where scenario=1;
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select pg_temp.assert_true(public.ap_material_draft_context_sha256(job) ~ '^[0-9a-f]{64}$','ordinary review invalidated explicit paid092 review') from public.employer_rule_paid_race_input;

-- Permission loss wins first. Confirmation must re-read it after acquiring its
-- source locks, rather than publishing the previously displayed basis.
select extensions.dblink_send_query('employer_racer','select public.employer_rule_test_race(5)');
select pg_temp.employer_race_wait();
select pg_temp.reject(format('select public.ap_confirm_employer_submission_rules(%L,%L,%L,%L,%L,%L,%L)',job,actor,'b104f006-0000-4000-8000-000000000006',basis,rules,pg_temp.employer_checklist(),citations),'employer_rule_current_source_required') from public.employer_rule_race_inputs where scenario=1;
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select result from extensions.dblink_get_result('employer_racer') as r(result text);
select pg_temp.assert_true(not exists(select 1 from public.ap_employer_rule_review_receipts where request_id='b104f006-0000-4000-8000-000000000006'),'source revocation race created review');
update public.job_sources set is_active=true where id='b104-manual-reviewed';
select extensions.dblink_disconnect('employer_racer');
drop function public.employer_rule_test_race(integer);
drop table public.employer_rule_race_inputs,public.employer_rule_paid_race_input;
select 'EMPLOYER_RULE_REVIEW_REAL_CONNECTION_RACES_OK';

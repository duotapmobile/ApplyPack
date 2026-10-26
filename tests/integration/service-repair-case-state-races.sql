-- Independent connections require a disposable loopback-only PostgreSQL cluster.
do $$begin if current_setting('listen_addresses')<>'127.0.0.1' then raise exception 'native_loopback_fixture_required'; end if; end$$;
\ir service-repair-case-state-fixture.sql
create extension if not exists dblink with schema extensions;
create table public.repair_case_state_race_fixture(case_id uuid,scope_sha text,review_sha text,members jsonb);
insert into public.repair_case_state_race_fixture
select (w.report->>'caseId')::uuid,r.scope_sha,
 public.ap_read_service_repair_case_review((w.report->>'caseId')::uuid,'15000000-0000-4000-8000-000000000003')->>'reviewContextSha256',
 jsonb_build_array(jsonb_build_object('artifactId',r.original->>'artifactId','fileVersionId','f0990000-0000-4000-8000-000000000001'))
from fixture_service_state w cross join repair_state r;
create function public.repair_case_state_race_feedback(request_id uuid,delay boolean) returns text language plpgsql as $$declare f public.repair_case_state_race_fixture; begin
 select * into strict f from public.repair_case_state_race_fixture;
 perform public.ap_record_service_repair_feedback('15000000-0000-4000-8000-000000000001',f.case_id,request_id,
  'a0990000-0000-4000-8000-000000000002','e0960000-0000-4000-8000-000000000004',repeat('4',64),f.members);
 if delay then perform pg_sleep(2); end if; return 'feedback';
end$$;
create function public.repair_case_state_race_close(request_id uuid,delay boolean) returns text language plpgsql as $$declare f public.repair_case_state_race_fixture; begin
 select * into strict f from public.repair_case_state_race_fixture;
 perform public.ap_set_service_repair_case_state_reviewed(f.case_id,request_id,f.scope_sha,f.review_sha,true,
  'e0960000-0000-4000-8000-000000000004',repeat('4',64),'15000000-0000-4000-8000-000000000003');
 if delay then perform pg_sleep(2); end if; return 'closed';
end$$;
commit;
create function pg_temp.wait_repair_case_racer() returns void language plpgsql as $$begin
 for attempt in 1..150 loop
  if exists(select 1 from pg_stat_activity where application_name='applypack_repair_case_racer' and state='active' and wait_event='PgSleep') then return; end if;
  perform pg_sleep(0.02);
 end loop; raise exception 'case race never reached guarded delay';
end$$;
select extensions.dblink_connect('repair_case_racer','host=127.0.0.1 port='||current_setting('port')||' dbname='||current_database()||' user=postgres application_name=applypack_repair_case_racer');
-- Feedback wins the shared case lock: the waiting close must see new metadata
-- and fail before inserting an event or changing the reopened state.
select extensions.dblink_send_query('repair_case_racer',$q$select public.repair_case_state_race_feedback('a1020000-0000-4000-8000-000000000010',true)$q$);
select pg_temp.wait_repair_case_racer();
select pg_temp.reject($q$select public.repair_case_state_race_close('a1020000-0000-4000-8000-000000000011',false)$q$,'service_repair_case_review_changed');
select result from extensions.dblink_get_result('repair_case_racer') as r(result text);
select result from extensions.dblink_get_result('repair_case_racer') as r(result text);
select pg_temp.assert_true(not exists(select 1 from public.ap_service_repair_case_events where id='a1020000-0000-4000-8000-000000000011')
 and (select state='OPEN' from public.ap_material_support_cases where id=(select case_id from public.repair_case_state_race_fixture)), 'stale close overwrote feedback');
-- Close wins first: later genuine feedback waits, then reopens the same case.
update public.repair_case_state_race_fixture set review_sha=public.ap_read_service_repair_case_review(case_id,'15000000-0000-4000-8000-000000000003')->>'reviewContextSha256';
select extensions.dblink_send_query('repair_case_racer',$q$select public.repair_case_state_race_close('a1020000-0000-4000-8000-000000000012',true)$q$);
select pg_temp.wait_repair_case_racer();
select public.repair_case_state_race_feedback('a1020000-0000-4000-8000-000000000013',false);
select result from extensions.dblink_get_result('repair_case_racer') as r(result text);
select result from extensions.dblink_get_result('repair_case_racer') as r(result text);
select pg_temp.assert_true((select state='OPEN' from public.ap_material_support_cases where id=(select case_id from public.repair_case_state_race_fixture)), 'later feedback failed to reopen');
-- A lost response from the winning close is reconciled without a second state
-- transition, even though its original review context is now stale.
select public.repair_case_state_race_close('a1020000-0000-4000-8000-000000000012',false);
select pg_temp.assert_true((select state='OPEN' from public.ap_material_support_cases where id=(select case_id from public.repair_case_state_race_fixture))
 and (select count(*)=1 from public.ap_service_repair_case_events where id='a1020000-0000-4000-8000-000000000012'), 'same-request replay reclosed the case');
-- Identical concurrent fixed-ID requests reconcile the winning receipt after
-- waiting, rather than treating its own committed event as foreign new work.
update public.repair_case_state_race_fixture set review_sha=public.ap_read_service_repair_case_review(case_id,'15000000-0000-4000-8000-000000000003')->>'reviewContextSha256';
select extensions.dblink_send_query('repair_case_racer',$q$select public.repair_case_state_race_close('a1020000-0000-4000-8000-000000000014',true)$q$);
select pg_temp.wait_repair_case_racer();
select public.repair_case_state_race_close('a1020000-0000-4000-8000-000000000014',false);
select result from extensions.dblink_get_result('repair_case_racer') as r(result text);
select result from extensions.dblink_get_result('repair_case_racer') as r(result text);
select pg_temp.assert_true((select count(*)=1 from public.ap_service_repair_case_events where id='a1020000-0000-4000-8000-000000000014'),'concurrent same-ID request duplicated event');
select extensions.dblink_disconnect('repair_case_racer');
select 'SERVICE_REPAIR_CASE_STATE_CAS_AND_RACES_OK';

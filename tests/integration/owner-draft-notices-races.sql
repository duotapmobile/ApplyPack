-- Fresh disposable loopback cluster only: committed fictional rows allow real
-- independent sessions to contend on production advisory/financial/outbox locks.
do $$ begin if current_setting('listen_addresses')<>'127.0.0.1' then raise exception 'owner_notice_loopback_fixture_required'; end if; end $$;
create extension if not exists dblink with schema extensions;
begin;
\ir owner-draft-notices-fixture.sql
select owner_notice_fixture.seed('a106');
select owner_notice_fixture.seed('b106');
select owner_notice_fixture.seed('c106');
select owner_notice_fixture.to_review('c106');
update public.ap_commerce_configuration set provider_idempotent_email_approved=true,provider_email_approval_reference='fictional owner notice race' where singleton;
select count(*) from public.ap_claim_outbox_messages('race-worker',25);
create function owner_notice_fixture.race(p_scenario integer) returns text language plpgsql as $$
declare message uuid; s owner_notice_fixture.state; begin
 select * into s from owner_notice_fixture.state where namespace=case p_scenario when 1 then 'a106' when 2 then 'b106' else 'c106' end;
 select message_id into message from public.ap_material_draft_owner_notices where job_id=s.job_id and phase='SOURCE_READY';
 if p_scenario in(1,2) then
  perform public.ap_pin_owner_draft_delivery(message,'race-worker','owner@example.invalid',repeat('a1',32));
 elsif p_scenario=3 then
  perform public.ap_suppress_owner_draft_notification(message,'race-worker');
 elsif p_scenario=4 then
  perform pg_advisory_xact_lock(hashtextextended('service-retention:'||s.customer_id::text,0));
  insert into public.ap_service_retention_claims(customer_id,order_ids) select s.customer_id,array[delivered_order_id] from public.ap_material_lines where id=s.line_id;
 else raise exception 'unexpected owner notice race'; end if;
 perform pg_sleep(1.5);
 return 'committed';
end $$;
commit;
create function pg_temp.owner_notice_wait() returns void language plpgsql as $$ begin
 for attempt in 1..200 loop
  perform pg_stat_clear_snapshot();
  if exists(select 1 from pg_stat_activity where application_name='applypack_owner_notice_racer' and state='active' and wait_event='PgSleep') then return; end if;
  perform pg_sleep(0.02);
 end loop;
 raise exception 'owner notice race did not reach its guarded delay';
end $$;
select extensions.dblink_connect('owner_notice_racer','host=127.0.0.1 port='||current_setting('port')||' dbname='||current_database()||' user=postgres application_name=applypack_owner_notice_racer');
select extensions.dblink_send_query('owner_notice_racer','select owner_notice_fixture.race(1)');
select pg_temp.owner_notice_wait();
select owner_notice_fixture.assert_true(public.ap_pin_owner_draft_delivery(n.message_id,'race-worker','owner@example.invalid',repeat('a1',32))->>'payloadSha256'=repeat('a1',32),'concurrent identical pin did not converge') from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='a106';
select result from extensions.dblink_get_result('owner_notice_racer') as r(result text);
select result from extensions.dblink_get_result('owner_notice_racer') as r(result text);

select extensions.dblink_send_query('owner_notice_racer','select owner_notice_fixture.race(2)');
select pg_temp.owner_notice_wait();
select owner_notice_fixture.reject(format('select public.ap_pin_owner_draft_delivery(%L,%L,%L,%L)',n.message_id,'race-worker','changed@example.invalid',repeat('a1',32)),'owner_notice_recipient_changed') from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='b106';
select result from extensions.dblink_get_result('owner_notice_racer') as r(result text);
select result from extensions.dblink_get_result('owner_notice_racer') as r(result text);

select extensions.dblink_send_query('owner_notice_racer','select owner_notice_fixture.race(3)');
select pg_temp.owner_notice_wait();
select owner_notice_fixture.reject(format('select public.ap_pin_owner_draft_delivery(%L,%L,%L,%L)',n.message_id,'race-worker','owner@example.invalid',repeat('a1',32)),'owner_notice_lease_invalid') from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='c106' and n.phase='SOURCE_READY';
select result from extensions.dblink_get_result('owner_notice_racer') as r(result text);
select result from extensions.dblink_get_result('owner_notice_racer') as r(result text);
select owner_notice_fixture.assert_true((select m.state::text='SUPPRESSED' and n.delivery_envelope_sha256 is null and m.provider_message_id is null from public.ap_material_draft_owner_notices n join public.ap_outbox_messages m on m.id=n.message_id join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='c106' and n.phase='SOURCE_READY'),'suppression race invented provider submission');

select extensions.dblink_send_query('owner_notice_racer','select owner_notice_fixture.race(4)');
select pg_temp.owner_notice_wait();
select owner_notice_fixture.reject(format('select public.ap_prepare_owner_draft_notification(%L,%L,%L)',n.message_id,'race-worker','owner@example.invalid'),'owner_notice_content_unavailable') from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='c106' and n.phase='REVIEW_READY';
select result from extensions.dblink_get_result('owner_notice_racer') as r(result text);
select result from extensions.dblink_get_result('owner_notice_racer') as r(result text);
select extensions.dblink_disconnect('owner_notice_racer');
select owner_notice_fixture.assert_true((select count(*)=4 from public.ap_material_draft_owner_notices),'concurrent handlers duplicated readiness events');
select owner_notice_fixture.assert_true(not exists(select 1 from owner_notice_fixture.state s join public.ap_material_lines l on l.id=s.line_id where l.materials_due_at is distinct from s.deadline),'race altered a paid deadline');
select 'OWNER_DRAFT_READY_NOTICES_RACES_OK';

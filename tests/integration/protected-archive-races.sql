-- Native/PG17 isolated loopback fixture only. Independent real connections;
-- fictional records, no provider calls. Deliberate commits require a disposable DB.
do $$begin if current_setting('listen_addresses')<>'127.0.0.1' then raise exception 'native_loopback_fixture_required'; end if; end$$;
create extension if not exists dblink with schema extensions;
update public.ap_archive_lifecycle_configuration set enabled=true;
select extensions.dblink_connect('archive_racer','host=127.0.0.1 port='||current_setting('port')||' dbname='||current_database()||' user=postgres application_name=applypack_archive_racer');
create function pg_temp.archive_assert(value boolean,message text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'archive race assertion: %',message; end if; end$$;
create function pg_temp.archive_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement; exception when others then if sqlerrm=expected then return; end if; raise; end;
 raise exception 'archive expected rejection: %',expected; end$$;
create function pg_temp.wait_archive_racer(with_lock boolean) returns void language plpgsql as $$begin
 for attempt in 1..150 loop
  if exists(select 1 from pg_stat_activity a where a.application_name='applypack_archive_racer' and a.state='active' and a.wait_event='PgSleep'
    and (not with_lock or exists(select 1 from pg_locks l where l.pid=a.pid and l.locktype='advisory' and l.granted))) then return; end if;
  perform pg_sleep(0.02);
 end loop; raise exception 'archive concurrent fixture did not reach guarded delay'; end$$;
create function public.archive_fixture_upload_delay() returns text language plpgsql as $$begin
 insert into storage.objects(bucket_id,name) values('customer-source-documents','archive-race/fictional-source.pdf');
 perform pg_sleep(2); return 'source committed'; end$$;
create function public.archive_fixture_writer_delay() returns text language plpgsql as $$begin
 perform public.ap_begin_archive_writer('f9810000-0000-4000-8000-000000000003','FILE',repeat('a',40));
 perform pg_sleep(2); return 'writer registered'; end$$;
create function public.archive_fixture_fence_delay() returns text language plpgsql as $$begin
 perform public.ap_begin_archive_retention('f9810000-0000-4000-8000-000000000004',repeat('a',40));
 perform pg_sleep(2); return 'fence committed'; end$$;
create function public.archive_fixture_event_delay() returns text language plpgsql as $$begin
 insert into public.webhook_events(provider,provider_event_id,event_type) values('stripe','evt_archive_old_transaction','checkout.session.completed');
 perform pg_sleep(2); return 'verified event committed'; end$$;

-- A source mutation holding the shared lock commits before fence acceptance.
select extensions.dblink_send_query('archive_racer','select public.archive_fixture_upload_delay()');
select pg_temp.wait_archive_racer(true);
select public.ap_begin_archive_retention('f9810000-0000-4000-8000-000000000001',repeat('a',40));
select pg_temp.archive_assert(exists(select 1 from storage.objects where bucket_id='customer-source-documents' and name='archive-race/fictional-source.pdf'),'completed alias is visible to the first fenced inventory');
select result from extensions.dblink_get_result('archive_racer') as r(result text);
select result from extensions.dblink_get_result('archive_racer') as r(result text);
select pg_temp.archive_error($q$delete from storage.objects where name='archive-race/fictional-source.pdf'$q$,'archive_maintenance_retry_required');
select public.ap_finish_archive_retention('f9810000-0000-4000-8000-000000000001',null,true);

-- A writer whose registration wins cannot be omitted by a concurrent fence.
select extensions.dblink_send_query('archive_racer','select public.archive_fixture_writer_delay()');
select pg_temp.wait_archive_racer(true);
select pg_temp.archive_error($q$select public.ap_begin_archive_retention('f9810000-0000-4000-8000-000000000002',repeat('a',40))$q$,'archive_writer_reconciliation_required');
select result from extensions.dblink_get_result('archive_racer') as r(result text);
select result from extensions.dblink_get_result('archive_racer') as r(result text);
select public.ap_finish_archive_writer('f9810000-0000-4000-8000-000000000003',repeat('b',64),true);

-- A fence that wins rejects the next actual source mutation after waiting.
select extensions.dblink_send_query('archive_racer','select public.archive_fixture_fence_delay()');
select pg_temp.wait_archive_racer(true);
select pg_temp.archive_error($q$update storage.objects set name='archive-race/changed.pdf' where name='archive-race/fictional-source.pdf'$q$,'archive_maintenance_retry_required');
select result from extensions.dblink_get_result('archive_racer') as r(result text);
select result from extensions.dblink_get_result('archive_racer') as r(result text);
select pg_temp.archive_error($q$select public.ap_begin_archive_writer('f9810000-0000-4000-8000-000000000005','DATABASE',repeat('a',40))$q$,'archive_maintenance_retry_required');
select public.ap_finish_archive_retention('f9810000-0000-4000-8000-000000000004',null,true);

-- An event transaction begins before the fence but commits later. Its older
-- received_at must not be filtered out; durable intake is never discarded.
select extensions.dblink_send_query('archive_racer','select public.archive_fixture_event_delay()');
select pg_temp.wait_archive_racer(false);
select public.ap_begin_archive_retention('f9810000-0000-4000-8000-000000000006',repeat('a',40));
select public.ap_plan_archive_retention('f9810000-0000-4000-8000-000000000006',repeat('b',64),repeat('c',64),repeat('d',64),
 jsonb_build_array(jsonb_build_object('key','manifests/'||repeat('a',64)||'.json','versionId','fixture-v1','identitySha256',repeat('e',64))));
select result from extensions.dblink_get_result('archive_racer') as r(result text);
select result from extensions.dblink_get_result('archive_racer') as r(result text);
select pg_temp.archive_assert((select received_at<(select started_at from public.ap_archive_retention_runs where id='f9810000-0000-4000-8000-000000000006') from public.webhook_events where provider_event_id='evt_archive_old_transaction'),'event began before fence');
select pg_temp.archive_error($q$select public.ap_dispatch_archive_retention_version('f9810000-0000-4000-8000-000000000006','manifests/'||repeat('a',64)||'.json','fixture-v1',repeat('b',64))$q$,'archive_payment_reconciliation_required');
select pg_temp.archive_assert(exists(select 1 from public.webhook_events where provider_event_id='evt_archive_old_transaction' and processed_at is null),'late event preserved for retry');
select public.ap_finish_archive_retention('f9810000-0000-4000-8000-000000000006',repeat('b',64),true);
update public.webhook_events set processed_at=clock_timestamp() where provider_event_id='evt_archive_old_transaction';

-- Corrected-contract provider events are an independent reconciliation source.
insert into public.ap_provider_events(provider,provider_event_id,event_type,payload_sha256,signature_verified_at)
 values('stripe','evt_archive_corrected_pending','checkout.session.completed',repeat('a',64),clock_timestamp());
select pg_temp.archive_error($q$select public.ap_begin_archive_retention('f9810000-0000-4000-8000-000000000007',repeat('a',40))$q$,'archive_payment_reconciliation_required');
select pg_temp.archive_assert(exists(select 1 from public.ap_provider_events where provider_event_id='evt_archive_corrected_pending' and applied_at is null),'corrected pending evidence preserved');

select extensions.dblink_disconnect('archive_racer');
drop function public.archive_fixture_upload_delay();
drop function public.archive_fixture_writer_delay();
drop function public.archive_fixture_fence_delay();
drop function public.archive_fixture_event_delay();
update public.ap_archive_lifecycle_configuration set enabled=false;
select 'PROTECTED_ARCHIVE_REAL_CONNECTION_RACES_OK';

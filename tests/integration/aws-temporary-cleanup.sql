begin;

create function pg_temp.assert_true(value boolean,failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%',failure_message; end if; end $$;

-- Old maintenance sees only its unchanged Supabase queue. Its historical
-- bucket/path, immediate-eligibility and filename contracts remain intact.
insert into public.storage_cleanup_queue(bucket,storage_path,reason)
select bucket,'fixture/aws-cleanup-compat/render-preview.pdf','fixture-existing-supabase-cleanup'
from unnest(array['customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews']) bucket;
select pg_temp.assert_true((select count(*)=4 and bool_and(not_before='-infinity'::timestamptz and attempts=0)
  from public.storage_cleanup_queue where reason='fixture-existing-supabase-cleanup'),
  'AWS cleanup changed existing Supabase cleanup semantics');
do $$ begin
  insert into public.storage_cleanup_queue(bucket,storage_path,reason)
  values('applypack-838445019912-staging-document-worker-temp','ephemeral/85000000-0000-4000-8000-00000000aa01','fixture');
  raise exception 'old-maintenance-could-observe-aws-cleanup';
exception when check_violation then null; end $$;

update public.ap_commerce_configuration set canonical_site_url='https://applypack-staging-staging.up.railway.app' where singleton;
set local role service_role;
select public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa01','staging');
reset role;
create temp table aws_cleanup_receipt as select public.ap_begin_aws_temporary_cleanup(
  '85000000-0000-4000-8000-00000000aa01','staging') as result;
select pg_temp.assert_true((select count(*)=4 and bool_and(attempts=0 and completed_at is null
    and bucket='applypack-838445019912-staging-document-worker-temp'
    and not_before=created_at+interval '10 minutes') from public.ap_aws_temporary_cleanup
    where operation_id='85000000-0000-4000-8000-00000000aa01')
  and (select result->'keys'=jsonb_build_array('ephemeral/85000000-0000-4000-8000-00000000aa01',
    'ephemeral/85000000-0000-4000-8000-00000000aa01.render.pdf',
    'ephemeral/85000000-0000-4000-8000-00000000aa01.page-1.png',
    'ephemeral/85000000-0000-4000-8000-00000000aa01.page-2.png')
    and (result->>'submissionDeadline')::timestamptz=(result->>'createdAt')::timestamptz+interval '60 seconds'
    and result->>'completed'='false' from aws_cleanup_receipt),
  'AWS intent RPC did not atomically register all four exact keys and immutable deadlines');
select pg_temp.assert_true((select result=public.ap_begin_aws_temporary_cleanup(
  '85000000-0000-4000-8000-00000000aa01','staging') from aws_cleanup_receipt),
  'AWS operation replay changed keys or extended its original lease');
select pg_temp.assert_true(not exists(select 1 from public.ap_aws_temporary_cleanup
  where operation_id='85000000-0000-4000-8000-00000000aa01' and completed_at is null and attempts<20 and not_before<=clock_timestamp())
  and (select count(*)=4 from public.ap_aws_temporary_cleanup where operation_id='85000000-0000-4000-8000-00000000aa01'
    and completed_at is null and attempts<20 and not_before<=(select (result->>'createdAt')::timestamptz+interval '10 minutes' from aws_cleanup_receipt)),
  'AWS delayed cleanup eligibility is not ten minutes after durable registration');

do $$ begin
  perform public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa02','production');
  raise exception 'opposite-environment-cleanup-accepted';
exception when raise_exception then if sqlerrm<>'aws_temporary_cleanup_environment_mismatch' then raise; end if; end $$;
do $$ begin
  perform public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa02','development');
  raise exception 'unknown-environment-cleanup-accepted';
exception when raise_exception then if sqlerrm<>'aws_temporary_cleanup_scope_invalid' then raise; end if; end $$;
do $$ begin
  perform public.ap_begin_aws_temporary_cleanup('85000000-0000-3000-8000-00000000aa02','staging');
  raise exception 'non-v4-cleanup-operation-accepted';
exception when raise_exception then if sqlerrm<>'aws_temporary_cleanup_scope_invalid' then raise; end if; end $$;

update public.ap_commerce_configuration set canonical_site_url='https://applypack.work' where singleton;
select public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa02','production');
select pg_temp.assert_true((select count(*)=4 and bool_and(bucket='applypack-838445019912-production-document-worker-temp')
  from public.ap_aws_temporary_cleanup where operation_id='85000000-0000-4000-8000-00000000aa02'),
  'production cleanup did not bind the exact account and environment bucket');
do $$ begin
  perform public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa01','production');
  raise exception 'operation-was-rebound-to-another-environment';
exception when raise_exception then if sqlerrm<>'aws_temporary_cleanup_operation_conflict' then raise; end if; end $$;
update public.ap_commerce_configuration set canonical_site_url='https://applypack-staging-staging.up.railway.app' where singleton;

-- Direct owner inserts test database constraints independently of RPC checks.
do $$ declare bad record; begin
  for bad in select * from (values
    ('applypack-111111111111-staging-document-worker-temp','ephemeral/85000000-0000-4000-8000-00000000aa03'),
    ('applypack-838445019912-production-document-worker-temp','ephemeral/85000000-0000-4000-8000-00000000aa03'),
    ('applypack-838445019912-unknown-document-worker-temp','ephemeral/85000000-0000-4000-8000-00000000aa03'),
    ('applypack-838445019912-staging-document-worker-temp','private/85000000-0000-4000-8000-00000000aa03'),
    ('applypack-838445019912-staging-document-worker-temp','ephemeral/../85000000-0000-4000-8000-00000000aa03'),
    ('applypack-838445019912-staging-document-worker-temp','ephemeral/85000000-0000-4000-8000-00000000aa03.page-3.png'),
    ('applypack-838445019912-staging-document-worker-temp','ephemeral/85000000-0000-4000-8000-00000000aa03.render.pdf/extra'),
    ('applypack-838445019912-staging-document-worker-temp','ephemeral/85000000-0000-4000-8000-00000000AA03'),
    ('applypack-838445019912-staging-document-worker-temp','ephemeral/85000000-0000-4000-8000-00000000aa04')
  ) invalid(bucket,path) loop
    begin
      insert into public.ap_aws_temporary_cleanup(operation_id,deployment_environment,bucket,storage_path)
      values('85000000-0000-4000-8000-00000000aa03','staging',bad.bucket,bad.path);
      raise exception 'invalid-aws-cleanup-scope-or-key-accepted';
    exception when check_violation then null; end;
  end loop;
end $$;
select pg_temp.assert_true(not exists(select 1 from public.ap_aws_temporary_cleanup
  where operation_id='85000000-0000-4000-8000-00000000aa03'), 'rejected cleanup constraints left orphan rows');

insert into public.ap_aws_temporary_cleanup(operation_id,deployment_environment,bucket,storage_path)
values('85000000-0000-4000-8000-00000000aa04','staging',
  'applypack-838445019912-staging-document-worker-temp','ephemeral/85000000-0000-4000-8000-00000000aa04');
do $$ begin
  perform public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa04','staging');
  raise exception 'partial-cleanup-group-was-silently-repaired';
exception when raise_exception then if sqlerrm<>'aws_temporary_cleanup_operation_conflict' then raise; end if; end $$;
do $$ begin
  update public.ap_aws_temporary_cleanup set not_before=not_before+interval '1 minute'
    where operation_id='85000000-0000-4000-8000-00000000aa01';
  raise exception 'cleanup-lease-was-extended';
exception when raise_exception then if sqlerrm<>'aws_temporary_cleanup_identity_immutable' then raise; end if; end $$;
do $$ begin
  delete from public.ap_aws_temporary_cleanup where operation_id='85000000-0000-4000-8000-00000000aa01';
  raise exception 'cleanup-history-was-erased';
exception when raise_exception then if sqlerrm<>'aws_temporary_cleanup_identity_immutable' then raise; end if; end $$;

set local role service_role;
update public.ap_aws_temporary_cleanup set attempts=20,last_error='aws_temporary_remove_failed',last_attempt_at=clock_timestamp()
  where operation_id='85000000-0000-4000-8000-00000000aa01' and storage_path='ephemeral/85000000-0000-4000-8000-00000000aa01';
update public.ap_aws_temporary_cleanup set completed_at=clock_timestamp()
  where operation_id='85000000-0000-4000-8000-00000000aa01' and storage_path like '%.page-%.png';
reset role;
select pg_temp.assert_true((select count(*)=1 from public.ap_aws_temporary_cleanup
    where operation_id='85000000-0000-4000-8000-00000000aa01' and completed_at is null and attempts>=20)
  and (select count(*)=1 from public.ap_aws_temporary_cleanup
    where operation_id='85000000-0000-4000-8000-00000000aa01' and completed_at is null and attempts<20)
  and (select public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa01','staging')
    =jsonb_set(result,'{completed}','true') from aws_cleanup_receipt),
  'completion or dead-letter handling reset the lease or hid a pending cleanup obligation');
do $$ begin
  update public.ap_aws_temporary_cleanup set attempts=0 where attempts=20;
  raise exception 'cleanup-retry-progress-regressed';
exception when raise_exception then if sqlerrm<>'aws_temporary_cleanup_progress_regression' then raise; end if; end $$;
do $$ begin
  update public.ap_aws_temporary_cleanup set completed_at=null where completed_at is not null;
  raise exception 'completed-cleanup-was-reopened';
exception when raise_exception then if sqlerrm<>'aws_temporary_cleanup_progress_regression' then raise; end if; end $$;
update public.ap_aws_temporary_cleanup set completed_at=clock_timestamp()
  where operation_id='85000000-0000-4000-8000-00000000aa01' and completed_at is null;
select pg_temp.assert_true(not exists(select 1 from public.ap_aws_temporary_cleanup
  where operation_id='85000000-0000-4000-8000-00000000aa01' and completed_at is null)
  and (select count(*)=4 from public.ap_aws_temporary_cleanup where operation_id='85000000-0000-4000-8000-00000000aa01'),
  'acknowledgment failed to exclude completed rows while retaining operation history');

select pg_temp.assert_true(not has_table_privilege('anon','public.ap_aws_temporary_cleanup','SELECT')
  and not has_table_privilege('authenticated','public.ap_aws_temporary_cleanup','SELECT')
  and not has_table_privilege('service_role','public.ap_aws_temporary_cleanup','INSERT')
  and not has_table_privilege('service_role','public.ap_aws_temporary_cleanup','DELETE')
  and not has_column_privilege('service_role','public.ap_aws_temporary_cleanup','created_at','UPDATE')
  and has_column_privilege('service_role','public.ap_aws_temporary_cleanup','completed_at','UPDATE')
  and has_function_privilege('service_role','public.ap_begin_aws_temporary_cleanup(uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.ap_begin_aws_temporary_cleanup(uuid,text)','EXECUTE'),
  'cleanup table/RPC privilege boundary changed');
set local role anon;
do $$ begin perform 1 from public.ap_aws_temporary_cleanup; raise exception 'anonymous-cleanup-read-accepted';
exception when insufficient_privilege then null; end $$;
do $$ begin perform public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa05','staging');
  raise exception 'anonymous-cleanup-rpc-accepted'; exception when insufficient_privilege then null; end $$;
reset role;
set local role authenticated;
do $$ begin perform public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa05','staging');
  raise exception 'customer-cleanup-rpc-accepted'; exception when insufficient_privilege then null; end $$;
reset role;
select 'AWS_TEMPORARY_CLEANUP_CONTRACT_OK';
rollback;

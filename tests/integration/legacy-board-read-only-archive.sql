begin;

create function pg_temp.assert_true(value boolean,failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%',failure_message; end if; end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('1a000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'legacy-board-owner@example.invalid','',now(),'{}','{}',now(),now());

alter table public.ap_board_subscriptions disable trigger ap_legacy_board_subscription_binding_immutable;
insert into public.ap_board_subscriptions(
  id,customer_id,plan_id,state,provider_customer_id,provider_subscription_id,current_period_starts_at,
  access_ends_at,cancel_at_period_end,last_provider_event_created,last_provider_event_id,refund_state
) values(
  '2a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000001','monthly','CANCEL_AT_PERIOD_END',
  'cus_legacy_fixture','sub_legacy_fixture',now()-interval '1 day',now()+interval '1 day',true,100,'evt_legacy_fixture','NONE'
);
alter table public.ap_board_subscriptions enable trigger ap_legacy_board_subscription_binding_immutable;

select pg_temp.assert_true(
  public.ap_legacy_board_has_access('1a000000-0000-4000-8000-000000000001',now()),
  'provider-confirmed unexpired legacy entitlement was denied'
);
update public.ap_board_subscriptions set refund_state='PARTIAL'
where id='2a000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(
  not public.ap_legacy_board_has_access('1a000000-0000-4000-8000-000000000001',now()),
  'refunded legacy entitlement retained archive access'
);
update public.ap_board_subscriptions set refund_state='NONE',access_ends_at=now()-interval '1 second'
where id='2a000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(
  not public.ap_legacy_board_has_access('1a000000-0000-4000-8000-000000000001',now()),
  'expired legacy entitlement retained archive access'
);

do $$ begin
  insert into public.ap_board_subscriptions(customer_id,plan_id,state,provider_customer_id,provider_subscription_id)
  values('1a000000-0000-4000-8000-000000000001','weekly','PENDING','cus_new_forbidden','sub_new_forbidden');
  raise exception 'new_board_subscription_was_accepted';
exception when raise_exception then
  if sqlerrm='new_board_subscription_was_accepted' then raise; end if;
  if sqlerrm<>'new_board_subscriptions_are_retired' then raise; end if;
end $$;

do $$ begin
  perform public.ap_enqueue_board_job_recompute(gen_random_uuid(),'FIXTURE','FIXTURE');
  raise exception 'retired_board_recompute_was_accepted';
exception when raise_exception then
  if sqlerrm='retired_board_recompute_was_accepted' then raise; end if;
  if sqlerrm<>'legacy_board_recompute_retired' then raise; end if;
end $$;

do $$ begin
  perform public.ap_begin_board_material_checkout(
    gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
    'fixture',repeat('a',64),gen_random_uuid(),null,null,'KEEP_EXISTING_TIMELINE',null,false,true,true
  );
  raise exception 'retired_board_origin_commerce_was_accepted';
exception when raise_exception then
  if sqlerrm='retired_board_origin_commerce_was_accepted' then raise; end if;
  if sqlerrm<>'board_origin_commerce_retired' then raise; end if;
end $$;

select pg_temp.assert_true(
  to_regclass('public.ap_legacy_board_archive_entries') is not null
  and not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ap_legacy_board_archive_entries'
      and column_name in ('source_job_url','application_url','apply_url')
  )
  and exists(select 1 from pg_trigger where tgname='ap_legacy_board_archive_immutable' and not tgisinternal)
  and exists(select 1 from pg_trigger where tgname='ap_legacy_board_admissions_frozen' and not tgisinternal)
  and exists(select 1 from pg_trigger where tgname='ap_legacy_board_recompute_jobs_frozen' and not tgisinternal)
  and not exists(select 1 from pg_trigger where tgname in ('ap_queue_board_snapshot_change_trigger','ap_queue_board_job_change_trigger') and not tgisinternal),
  'legacy archive schema did not remain immutable, URL-free, and recompute-free'
);

select pg_temp.assert_true(
  public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'=(case when to_regprocedure('public.ap_sandbox_activation_schema_installed()') is null then '202610220085' else '202610230086' end)
  and (public.ap_manual_launch_schema_readiness()->'requiredMigrations') ? '202610190083'
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610190083' and checkpoint='LEGACY_BOARD_READ_ONLY_ARCHIVE'),
  'legacy archive migration was not added to schema readiness'
);

rollback;

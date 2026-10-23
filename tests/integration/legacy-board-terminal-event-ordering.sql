begin;

create function pg_temp.assert_true(value boolean,failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%',failure_message; end if; end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('1b000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'legacy-terminal-owner@example.invalid','',now(),'{}','{}',now(),now()),
  ('1b000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'legacy-terminal-other@example.invalid','',now(),'{}','{}',now(),now());

alter table public.ap_board_subscriptions disable trigger ap_legacy_board_subscription_binding_immutable;
insert into public.ap_board_subscriptions(
  id,customer_id,plan_id,state,provider_customer_id,provider_subscription_id,current_period_starts_at,
  access_ends_at,cancel_at_period_end,last_provider_event_created,last_provider_event_id,refund_state,last_reconciled_at
) values(
  '2b000000-0000-4000-8000-000000000001','1b000000-0000-4000-8000-000000000001','monthly','ACTIVE',
  'cus_terminal_fixture','sub_terminal_fixture',now()-interval '1 day',now()+interval '1 day',true,900,'evt_newer_paid','NONE',now()
),(
  '2b000000-0000-4000-8000-000000000002','1b000000-0000-4000-8000-000000000002','monthly','CANCEL_AT_PERIOD_END',
  'cus_cross_tenant_fixture','sub_cross_tenant_fixture',now()-interval '1 day',now()+interval '1 day',true,902,'evt_cross_tenant_paid','NONE',now()
);
alter table public.ap_board_subscriptions enable trigger ap_legacy_board_subscription_binding_immutable;

-- Simulate a receipt written by the pre-084 stale-event branch: the immutable
-- provider facts are correct, but its recorded resulting state never revoked.
insert into public.ap_board_provider_events(
  provider_event_id,provider_subscription_id,event_type,provider_created,
  provider_refund_id,amount_cents,full_amount_cents,resulting_state
) values(
  'evt_delayed_refund','sub_terminal_fixture','refund.updated',100,
  're_terminal_fixture',4499,4499,'ACTIVE'
);

select pg_temp.assert_true(
  (public.ap_apply_legacy_board_terminal_event(
    'sub_terminal_fixture','evt_delayed_refund','refund.updated',100,'REFUNDED','FULL',
    're_terminal_fixture',null,4499,4499
  )->>'accessRevoked')::boolean,
  'delayed terminal refund was not applied'
);
select pg_temp.assert_true(
  exists(
    select 1 from public.ap_board_subscriptions
    where id='2b000000-0000-4000-8000-000000000001'
      and state='REFUNDED' and access_ends_at is null and refund_state='FULL'
      and provider_refund_id='re_terminal_fixture'
      and last_provider_event_created=900 and last_provider_event_id='evt_newer_paid'
  ),
  'delayed refund did not revoke access while preserving newer signed-event ordering'
);
select pg_temp.assert_true(
  (select resulting_state='REFUNDED' from public.ap_board_provider_events where provider_event_id='evt_delayed_refund'),
  'legacy stale receipt was not adopted into the terminal result'
);

select pg_temp.assert_true(
  (public.ap_apply_legacy_board_terminal_event(
    'sub_terminal_fixture','evt_delayed_refund','refund.updated',100,'REFUNDED','FULL',
    're_terminal_fixture',null,4499,4499
  )->>'replayed')::boolean
  and (select count(*)=1 from public.ap_board_provider_events where provider_event_id='evt_delayed_refund'),
  'exact terminal refund replay was not idempotent'
);

do $$ begin
  perform public.ap_apply_legacy_board_terminal_event(
    'sub_terminal_fixture','evt_delayed_refund','refund.updated',100,'REFUNDED','FULL',
    're_terminal_fixture',null,4000,4499
  );
  raise exception 'terminal_event_replay_mismatch_was_accepted';
exception when raise_exception then
  if sqlerrm='terminal_event_replay_mismatch_was_accepted' then raise; end if;
  if sqlerrm<>'legacy_board_terminal_event_replay_mismatch' then raise; end if;
end $$;

update public.ap_board_subscriptions set
  state='ACTIVE',access_ends_at=now()+interval '1 day',refund_state='NONE',
  provider_refund_id=null,provider_dispute_id=null,last_provider_event_created=901,
  last_provider_event_id='evt_even_newer_paid'
where id='2b000000-0000-4000-8000-000000000001';

select pg_temp.assert_true(
  (public.ap_apply_legacy_board_terminal_event(
    'sub_terminal_fixture','evt_delayed_dispute','charge.dispute.created',101,'DISPUTED',null,
    null,'dp_terminal_fixture',4499,4499
  )->>'accessRevoked')::boolean,
  'delayed terminal dispute was not applied'
);
select pg_temp.assert_true(
  exists(
    select 1 from public.ap_board_subscriptions
    where id='2b000000-0000-4000-8000-000000000001'
      and state='DISPUTED' and access_ends_at is null
      and provider_dispute_id='dp_terminal_fixture'
      and last_provider_event_created=901 and last_provider_event_id='evt_even_newer_paid'
  )
  and (select count(*)=1 from public.ap_board_provider_events where provider_event_id='evt_delayed_dispute'),
  'delayed dispute did not revoke access idempotently while preserving newer ordering'
);

select pg_temp.assert_true(
  not has_function_privilege('authenticated','public.ap_legacy_board_has_access(uuid,timestamptz)','EXECUTE')
  and has_function_privilege('service_role','public.ap_legacy_board_has_access(uuid,timestamptz)','EXECUTE')
  and public.ap_legacy_board_has_access('1b000000-0000-4000-8000-000000000002',now()),
  'arbitrary-customer legacy access helper was not restricted to service_role'
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"1b000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.assert_true(
  not public.ap_board_has_access('1b000000-0000-4000-8000-000000000001',now())
  and not public.ap_board_has_access('1b000000-0000-4000-8000-000000000002',now()),
  'terminal revocation or auth.uid cross-tenant binding failed'
);
do $$ begin
  perform public.ap_legacy_board_has_access('1b000000-0000-4000-8000-000000000002',now());
  raise exception 'authenticated_arbitrary_legacy_access_was_accepted';
exception when insufficient_privilege then null;
end $$;
reset role;

select pg_temp.assert_true(
  public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'=(case when to_regprocedure('public.ap_sandbox_activation_schema_installed()') is null then '202610220085' else '202610230086' end)
  and (public.ap_manual_launch_schema_readiness()->'requiredMigrations') ? '202610190084'
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610190084' and checkpoint='LEGACY_BOARD_TERMINAL_EVENT_ORDERING'),
  'terminal-event migration was not added to schema readiness'
);

rollback;

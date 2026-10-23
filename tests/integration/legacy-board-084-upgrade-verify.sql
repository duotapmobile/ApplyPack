begin;

create function pg_temp.assert_true(value boolean,failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%',failure_message; end if; end $$;

select pg_temp.assert_true(
  exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ap_board_subscriptions'
      and column_name='last_reconciled_at' and data_type='timestamp with time zone'
  )
  and exists(
    select 1 from public.ap_board_subscriptions
    where id='4b000000-0000-4000-8000-000000000001'
      and state='REFUNDED' and access_ends_at is null and refund_state='FULL'
      and provider_refund_id='re_upgrade_refund'
      and last_provider_event_created=900 and last_provider_event_id='evt_upgrade_refund_newer'
      and last_reconciled_at is null
  )
  and exists(
    select 1 from public.ap_board_subscriptions
    where id='4b000000-0000-4000-8000-000000000002'
      and state='DISPUTED' and access_ends_at is null
      and provider_dispute_id='dp_upgrade_dispute'
      and last_provider_event_created=901 and last_provider_event_id='evt_upgrade_dispute_newer'
      and last_reconciled_at is null
  ),
  'migration 084 did not revoke stale terminal receipts while preserving provider ordering'
);

select pg_temp.assert_true(
  not public.ap_legacy_board_has_access('3b000000-0000-4000-8000-000000000001',now())
  and not public.ap_legacy_board_has_access('3b000000-0000-4000-8000-000000000002',now()),
  'migration 084 left legacy archive or billing access open'
);

select pg_temp.assert_true(
  public.ap_manual_launch_schema_readiness()->>'ready'='true'
  and public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'=(case when to_regprocedure('public.ap_sandbox_activation_schema_installed()') is null then '202610220085' else '202610230086' end)
  and (public.ap_manual_launch_schema_readiness()->'requiredMigrations') ? '202610190084'
  and exists(
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610190084' and checkpoint='LEGACY_BOARD_TERMINAL_EVENT_ORDERING'
  ),
  'migration 084 did not advance runtime schema readiness'
);

select pg_temp.assert_true(
  (public.ap_apply_legacy_board_terminal_event(
    'sub_upgrade_refund','evt_upgrade_stale_refund','refund.updated',100,'REFUNDED','FULL',
    're_upgrade_refund',null,4499,4499
  )->>'replayed')::boolean,
  'exact migrated refund receipt was not recognized as a replay'
);
select pg_temp.assert_true(
  (public.ap_apply_legacy_board_terminal_event(
    'sub_upgrade_dispute','evt_upgrade_stale_dispute','charge.dispute.created',101,'DISPUTED',null,
    null,'dp_upgrade_dispute',4499,4499
  )->>'replayed')::boolean,
  'exact migrated dispute receipt was not recognized as a replay'
);

-- A second exact replay must remain a no-op with one immutable receipt.
select public.ap_apply_legacy_board_terminal_event(
  'sub_upgrade_refund','evt_upgrade_stale_refund','refund.updated',100,'REFUNDED','FULL',
  're_upgrade_refund',null,4499,4499
);
select public.ap_apply_legacy_board_terminal_event(
  'sub_upgrade_dispute','evt_upgrade_stale_dispute','charge.dispute.created',101,'DISPUTED',null,
  null,'dp_upgrade_dispute',4499,4499
);
select pg_temp.assert_true(
  (select count(*)=1 from public.ap_board_provider_events where provider_event_id='evt_upgrade_stale_refund')
  and (select count(*)=1 from public.ap_board_provider_events where provider_event_id='evt_upgrade_stale_dispute')
  and (select resulting_state='REFUNDED' from public.ap_board_provider_events where provider_event_id='evt_upgrade_stale_refund')
  and (select resulting_state='DISPUTED' from public.ap_board_provider_events where provider_event_id='evt_upgrade_stale_dispute')
  and exists(
    select 1 from public.ap_board_subscriptions
    where id='4b000000-0000-4000-8000-000000000001'
      and access_ends_at is null and last_provider_event_created=900
      and last_provider_event_id='evt_upgrade_refund_newer'
  )
  and exists(
    select 1 from public.ap_board_subscriptions
    where id='4b000000-0000-4000-8000-000000000002'
      and access_ends_at is null and last_provider_event_created=901
      and last_provider_event_id='evt_upgrade_dispute_newer'
  ),
  'terminal receipt replay was not single-receipt, idempotent, and ordering-preserving'
);

do $$ begin
  perform public.ap_apply_legacy_board_terminal_event(
    'sub_upgrade_refund','evt_upgrade_stale_refund','refund.updated',100,'REFUNDED','FULL',
    're_upgrade_refund',null,4000,4499
  );
  raise exception 'migrated_terminal_event_replay_mismatch_was_accepted';
exception when raise_exception then
  if sqlerrm='migrated_terminal_event_replay_mismatch_was_accepted' then raise; end if;
  if sqlerrm<>'legacy_board_terminal_event_replay_mismatch' then raise; end if;
end $$;

rollback;

select 'LEGACY_BOARD_084_UPGRADE_VERIFY_OK';

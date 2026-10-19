begin;

create function pg_temp.assert_true(value boolean,failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%',failure_message; end if; end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('3b000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'legacy-upgrade-refund@example.invalid','',now(),'{}','{}',now(),now()),
  ('3b000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    'legacy-upgrade-dispute@example.invalid','',now(),'{}','{}',now(),now());

-- Migration 083 intentionally forbids new subscriptions. These rows model
-- provider-confirmed historical entitlements that existed before retirement.
alter table public.ap_board_subscriptions disable trigger ap_legacy_board_subscription_binding_immutable;
insert into public.ap_board_subscriptions(
  id,customer_id,plan_id,state,provider_customer_id,provider_subscription_id,current_period_starts_at,
  access_ends_at,cancel_at_period_end,last_provider_event_created,last_provider_event_id,refund_state
) values(
  '4b000000-0000-4000-8000-000000000001','3b000000-0000-4000-8000-000000000001','monthly','ACTIVE',
  'cus_upgrade_refund','sub_upgrade_refund',now()-interval '1 day',now()+interval '1 day',false,
  900,'evt_upgrade_refund_newer','NONE'
),(
  '4b000000-0000-4000-8000-000000000002','3b000000-0000-4000-8000-000000000002','monthly','CANCEL_AT_PERIOD_END',
  'cus_upgrade_dispute','sub_upgrade_dispute',now()-interval '1 day',now()+interval '1 day',true,
  901,'evt_upgrade_dispute_newer','NONE'
);
alter table public.ap_board_subscriptions enable trigger ap_legacy_board_subscription_binding_immutable;

-- These immutable receipts reproduce the pre-084 stale-event failure: the
-- provider facts were stored, but a newer ordering watermark prevented access
-- revocation and left the receipt's resulting state nonterminal.
insert into public.ap_board_provider_events(
  provider_event_id,provider_subscription_id,event_type,provider_created,
  provider_refund_id,provider_dispute_id,amount_cents,full_amount_cents,resulting_state
) values(
  'evt_upgrade_stale_refund','sub_upgrade_refund','refund.updated',100,
  're_upgrade_refund',null,4499,4499,'ACTIVE'
),(
  'evt_upgrade_stale_dispute','sub_upgrade_dispute','charge.dispute.created',101,
  null,'dp_upgrade_dispute',4499,4499,'CANCEL_AT_PERIOD_END'
);

select pg_temp.assert_true(
  public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'='202610190083'
  and not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='ap_board_subscriptions'
      and column_name='last_reconciled_at'
  ),
  'fixture was not seeded against the exact migration-083 schema'
);
select pg_temp.assert_true(
  public.ap_legacy_board_has_access('3b000000-0000-4000-8000-000000000001',now())
  and public.ap_legacy_board_has_access('3b000000-0000-4000-8000-000000000002',now()),
  'pre-084 stale receipts did not preserve the vulnerable active entitlements'
);

commit;

select 'LEGACY_BOARD_083_UPGRADE_SEED_OK';

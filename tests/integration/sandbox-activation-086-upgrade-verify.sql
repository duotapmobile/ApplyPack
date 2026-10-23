create function pg_temp.assert_upgrade(value boolean,message text) returns void language plpgsql as $$
begin if value is not true then raise exception '%',message; end if; end $$;
select pg_temp.assert_upgrade((select (to_jsonb(a)-array['activation_contract_version','sandbox_validation','sandbox_validation_digest'])=(select value from activation_before_086)
  and activation_contract_version='legacy-production-canary-v1' and sandbox_validation is null and sandbox_validation_digest is null
  from public.ap_manual_launch_activations a where id='86ff0000-0000-4000-8000-000000000011'),
  '086 changed historical activation evidence or fabricated a sandbox proof');
select pg_temp.assert_upgrade((select to_jsonb(p)=(select value from payment_before_086) from public.ap_payment_attempts p
  where id='86ff0000-0000-4000-8000-000000000021'),'086 changed original paid transaction');
select pg_temp.assert_upgrade((select to_jsonb(r)=(select value from refund_before_086) from public.ap_refund_operations r
  where id='86ff0000-0000-4000-8000-000000000031'),'086 changed queued historical refund');
select pg_temp.assert_upgrade(public.ap_manual_launch_schema_readiness()->>'ready'='true','086 upgrade not ready');
select pg_temp.assert_upgrade((select mode='LOCKED' from public.ap_checkout_mode_configuration where singleton)
  and (select not checkout_enabled from public.ap_commerce_configuration where singleton),'086 did not lock new checkout');
-- Preserved historical totals cannot authorize this release's new purchases.
savepoint before_historical_activation_reuse;
update public.ap_commerce_configuration set canonical_site_url='https://applypack.work',
  tax_treatment='TAX_INCLUSIVE_NO_ADDED_AMOUNT',tax_inclusive=true,sales_activation_approved=true,
  sales_activation_reference='manual-launch-activation:86ff0000-0000-4000-8000-000000000011',
  launch_activation_id='86ff0000-0000-4000-8000-000000000011',launch_release_sha=repeat('f',40),
  document_worker_network_attestation_sha256=repeat('f',64) where singleton;
do $$ begin
  perform public.ap_set_checkout_mode('PUBLIC',repeat('f',40),'86ff0000-0000-4000-8000-000000000001','historical-evidence-cannot-open-new-sales');
  raise exception 'historical_activation_reused';
exception when others then if sqlerrm<>'checkout_mode_activation_required' then raise; end if; end $$;
rollback to savepoint before_historical_activation_reuse;
set local role service_role;
select public.ap_record_search_refund_result_verified('86ff0000-0000-4000-8000-000000000031','re_Historical086','succeeded',
  'pi_Historical086',1899,'USD','86ff0000-0000-4000-8000-000000000031','evt_Historical086',null,repeat('c',64),clock_timestamp(),'refund.updated');
reset role;
select pg_temp.assert_upgrade((select state='SUCCEEDED' and amount_cents=1899 and reason_code='MANUAL_LAUNCH_CANARY'
  from public.ap_refund_operations where id='86ff0000-0000-4000-8000-000000000031'),
  'existing canary refund could not settle after production canaries retired');
select public.ap_record_search_refund_result_verified('86ff0000-0000-4000-8000-000000000031','re_Historical086','succeeded',
  'pi_Historical086',1899,'USD','86ff0000-0000-4000-8000-000000000031','evt_Historical086',null,repeat('c',64),clock_timestamp(),'refund.updated');
select pg_temp.assert_upgrade((select count(*)=1 from public.ap_outbox_messages where deduplication_key='refund-state:86ff0000-0000-4000-8000-000000000031:SUCCEEDED'),
  'historical refund replay duplicated delivery');
select 'SANDBOX_ACTIVATION_086_UPGRADE_VERIFY_OK';

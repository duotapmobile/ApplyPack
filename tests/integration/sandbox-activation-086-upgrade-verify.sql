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
-- The forward disclosure never rewrites a historical customer's acceptance.
select pg_temp.assert_upgrade((select to_jsonb(receipt)=(select value from legal_receipt_before_086)
  and receipt.privacy_version='privacy-v1'
  from public.ap_snapshot_legal_content_receipts receipt where snapshot_id='86300000-0000-4000-8000-000000000001'),
  '086 changed a previously accepted privacy content receipt');
select pg_temp.assert_upgrade((select privacy_version='privacy-2026-10-23-v2'
  and privacy_content_sha256='9fa809f25bf55a03fab529f991b1d5870849fcc2294c08b324f1d2cf0187ea16'
  from public.ap_commerce_configuration where singleton), '086 current privacy disclosure binding is wrong');
select pg_temp.assert_upgrade(not public.ap_has_current_content_bound_legal_acceptance(
  '86000000-0000-4000-8000-000000000001','86300000-0000-4000-8000-000000000001'),
  'pre-086 acceptance improperly authorizes a new current purchase');
do $$ begin
  perform public.ap_upgrade_completed_intake_legal_acceptance(
    '86000000-0000-4000-8000-000000000001',repeat('a',64),
    'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
    'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
    'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
    'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('9',64));
  raise exception 'old_privacy_accepted_as_current';
exception when others then if sqlerrm<>'current_legal_versions_unavailable' then raise; end if; end $$;

select 'SANDBOX_ACTIVATION_086_UPGRADE_VERIFY_OK';

-- The runner captures every prior074/076/086 episode before applying087.
-- No prior consent is rewritten or silently enrolled in the new service policy.
do $$
declare configuration public.ap_commerce_configuration; before_acceptances integer; before_receipts integer;
begin
  select * into strict configuration from public.ap_commerce_configuration where singleton;
  if configuration.terms_version is distinct from 'manual-launch-terms-2026-10-24-v3'
    or configuration.terms_content_sha256 is distinct from 'bac56f51e78cd099c8676efcfca5616d2fbdaeb9fc40c8aa0d5053ff968a3428'
    or configuration.privacy_version is distinct from 'privacy-2026-10-24-v3'
    or configuration.privacy_content_sha256 is distinct from '2d7a8f194c8246775f1bb9803378596bf8bf60fb2a72cb34bf3c009adaa6e311'
    or (select max(version) from supabase_migrations.schema_migrations) not in ('202610240087','202610250090','202610250091','202610250092','202610250093','202610250094')
    then raise exception 'one_off_legal_binding_missing'; end if;
  if not exists(select 1 from public.retention_legal_upgrade_preservation_fixture)
    or exists(select 1 from public.retention_legal_upgrade_preservation_fixture fixture
      where not exists(
        select 1 from public.ap_snapshot_legal_acceptances r where fixture.kind='acceptance' and to_jsonb(r)=fixture.immutable_record
        union all select 1 from public.ap_snapshot_legal_content_receipts r where fixture.kind='receipt' and to_jsonb(r)=fixture.immutable_record
        union all select 1 from public.ap_legal_receipt_acceptance_reconciliations r where fixture.kind='reconciliation' and to_jsonb(r)=fixture.immutable_record
      )) then raise exception 'one_off_prior_legal_history_changed'; end if;
  if exists(select 1 from public.ap_retention_checkout_contracts) or exists(select 1 from public.ap_order_retention_contracts)
    then raise exception 'one_off_policy_backfilled'; end if;

  if not exists(select 1 from public.ap_snapshot_legal_content_receipts where snapshot_id='f5300000-0000-4000-8000-000000000001'
      and acceptance_sha256=repeat('e',64))
    and public.ap_has_current_content_bound_legal_acceptance('f5000000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001')
    then raise exception 'previous_contract_wrongly_current'; end if;
  begin
    perform public.ap_upgrade_completed_intake_legal_acceptance('f5000000-0000-4000-8000-000000000001',repeat('c',64),
      'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
      'privacy-2026-10-23-v2','9fa809f25bf55a03fab529f991b1d5870849fcc2294c08b324f1d2cf0187ea16',
      configuration.legal_acceptance_copy_version,configuration.legal_acceptance_copy_sha256,
      configuration.legal_content_canonicalization_version,configuration.legal_receipt_schema_version,repeat('f',64));
    raise exception 'previous_contract_accepted_for_new_checkout';
  exception when others then if sqlerrm<>'current_legal_versions_unavailable' then raise; end if; end;

  select count(*) into before_acceptances from public.ap_snapshot_legal_acceptances where snapshot_id='f5300000-0000-4000-8000-000000000001';
  select count(*) into before_receipts from public.ap_snapshot_legal_content_receipts where snapshot_id='f5300000-0000-4000-8000-000000000001';
  perform public.ap_upgrade_completed_intake_legal_acceptance('f5000000-0000-4000-8000-000000000001',repeat('c',64),
    configuration.terms_version,configuration.terms_content_sha256,configuration.privacy_version,configuration.privacy_content_sha256,
    configuration.legal_acceptance_copy_version,configuration.legal_acceptance_copy_sha256,
    configuration.legal_content_canonicalization_version,configuration.legal_receipt_schema_version,repeat('e',64));
  perform public.ap_upgrade_completed_intake_legal_acceptance('f5000000-0000-4000-8000-000000000001',repeat('c',64),
    configuration.terms_version,configuration.terms_content_sha256,configuration.privacy_version,configuration.privacy_content_sha256,
    configuration.legal_acceptance_copy_version,configuration.legal_acceptance_copy_sha256,
    configuration.legal_content_canonicalization_version,configuration.legal_receipt_schema_version,repeat('e',64));
  if not public.ap_has_current_content_bound_legal_acceptance('f5000000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001')
    or (select count(*) from public.ap_snapshot_legal_content_receipts where snapshot_id='f5300000-0000-4000-8000-000000000001' and acceptance_sha256=repeat('e',64))<>1
    or (select count(*) from public.ap_snapshot_legal_acceptances where snapshot_id='f5300000-0000-4000-8000-000000000001' and acceptance_sha256=repeat('e',64))<>1
    or (select count(*) from public.ap_snapshot_legal_acceptances where snapshot_id='f5300000-0000-4000-8000-000000000001') not between before_acceptances and before_acceptances+1
    or (select count(*) from public.ap_snapshot_legal_content_receipts where snapshot_id='f5300000-0000-4000-8000-000000000001') not between before_receipts and before_receipts+1
    then raise exception 'one_off_consent_not_idempotent'; end if;
end $$;
select 'LEGAL_ACCEPTANCE_087_UPGRADE_OK';

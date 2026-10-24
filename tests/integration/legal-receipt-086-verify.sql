-- The historical074/076 fixtures remain unchanged. This separate phase proves
-- their immutable history survives the current privacy amendment.
do $$
declare configuration public.ap_commerce_configuration;
begin
  select * into strict configuration from public.ap_commerce_configuration where singleton;
  if configuration.privacy_version is distinct from current_setting('applypack_test.privacy_version')
    or configuration.privacy_content_sha256 is distinct from current_setting('applypack_test.privacy_sha256')
    or configuration.privacy_version='privacy-v1'
    or (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610230086'
  then raise exception 'current_privacy_binding_missing'; end if;

  if (select count(*) from public.legal_upgrade_preservation_fixture)<>4
    or exists(
      select 1 from public.legal_upgrade_preservation_fixture fixture
      where not exists(
        select 1 from public.ap_snapshot_legal_acceptances row
          where fixture.kind='acceptance' and to_jsonb(row)=fixture.immutable_record
        union all select 1 from public.ap_snapshot_legal_content_receipts row
          where fixture.kind='receipt' and to_jsonb(row)=fixture.immutable_record
        union all select 1 from public.ap_legal_receipt_acceptance_reconciliations row
          where fixture.kind='reconciliation' and to_jsonb(row)=fixture.immutable_record
      )
    )
  then raise exception 'historical_legal_rows_changed'; end if;

  if not exists(select 1 from public.ap_snapshot_legal_content_receipts
      where snapshot_id='f5300000-0000-4000-8000-000000000001'
        and acceptance_sha256=repeat('d',64))
    and public.ap_has_current_content_bound_legal_acceptance(
      'f5000000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001')
  then raise exception 'obsolete_privacy_still_current'; end if;

  begin
    perform public.ap_upgrade_completed_intake_legal_acceptance(
      'f5000000-0000-4000-8000-000000000001',repeat('c',64),
      'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
      'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
      'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
      'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('c',64)
    );
    raise exception 'obsolete_privacy_upgrade_accepted';
  exception when others then
    if sqlerrm<>'current_legal_versions_unavailable' then raise; end if;
  end;

  perform public.ap_upgrade_completed_intake_legal_acceptance(
    'f5000000-0000-4000-8000-000000000001',repeat('c',64),
    configuration.terms_version,configuration.terms_content_sha256,
    configuration.privacy_version,configuration.privacy_content_sha256,
    configuration.legal_acceptance_copy_version,configuration.legal_acceptance_copy_sha256,
    configuration.legal_content_canonicalization_version,configuration.legal_receipt_schema_version,repeat('d',64)
  );
  if not public.ap_has_current_content_bound_legal_acceptance(
      'f5000000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001')
    or (select count(*) from public.ap_snapshot_legal_acceptances
      where snapshot_id='f5300000-0000-4000-8000-000000000001')<>3
    or (select count(*) from public.ap_snapshot_legal_content_receipts
      where snapshot_id='f5300000-0000-4000-8000-000000000001')<>2
    or not exists(select 1 from public.ap_snapshot_legal_content_receipts
      where snapshot_id='f5300000-0000-4000-8000-000000000001'
        and acceptance_sha256=repeat('d',64)
        and privacy_version=configuration.privacy_version
        and privacy_content_sha256=configuration.privacy_content_sha256)
  then raise exception 'current_privacy_acceptance_failed'; end if;
end;
$$;

select 'LEGAL_ACCEPTANCE_CURRENT_UPGRADE_OK';

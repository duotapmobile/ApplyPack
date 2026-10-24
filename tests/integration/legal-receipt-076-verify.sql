select public.ap_upgrade_completed_intake_legal_acceptance(
  'f5000000-0000-4000-8000-000000000001',repeat('c',64),
  'manual-launch-terms-2026-10-02-v2','eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c',
  'privacy-v1','9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9',
  'applypack-legal-acceptance-copy-2026-10-04-v1','0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283',
  'applypack-c14n-v1','applypack-legal-content-receipt-v1',repeat('c',64)
);

select case when
  public.ap_has_current_content_bound_legal_acceptance(
    'f5000000-0000-4000-8000-000000000001','f5300000-0000-4000-8000-000000000001')
  and (select count(*)=2 from public.ap_snapshot_legal_acceptances
       where snapshot_id='f5300000-0000-4000-8000-000000000001')
  and (select count(*)=1 from public.ap_snapshot_legal_content_receipts
       where snapshot_id='f5300000-0000-4000-8000-000000000001')
  and exists(
    select 1
    from public.ap_legal_receipt_acceptance_reconciliations reconciliation
    join public.ap_snapshot_legal_content_receipts receipt
      on receipt.id=reconciliation.receipt_id
      and receipt.legal_acceptance_id=reconciliation.original_legal_acceptance_id
    join public.ap_snapshot_legal_acceptances matching
      on matching.id=reconciliation.matching_legal_acceptance_id
      and matching.snapshot_id=receipt.snapshot_id
      and matching.acceptance_sha256=receipt.acceptance_sha256
    where receipt.snapshot_id='f5300000-0000-4000-8000-000000000001'
      and reconciliation.reason='MIGRATION_074_CONTENT_HASH_LINK'
  )
  and exists(
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610040076'
      and checkpoint='LEGACY_LEGAL_ACCEPTANCE_EPISODE_RECONCILIATION'
      and rows_processed=1
  )
then 'LEGAL_ACCEPTANCE_FORWARD_UPGRADE_OK' else 'LEGAL_ACCEPTANCE_FORWARD_UPGRADE_FAILED' end;

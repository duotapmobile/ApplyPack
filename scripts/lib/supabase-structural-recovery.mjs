import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LAUNCH_LEGAL_BINDING } from "../launch-legal-contract.mjs";

function runCommand(command, args, stdin) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: stdin,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

export function runStructuralDatabaseRecovery({ run = runCommand } = {}) {
const sqlPath = fileURLToPath(new URL("../../supabase/rollback/202609040022_corrected_chunk1_foundation.rollback.sql", import.meta.url));
const migrationDirectory = new URL("../../supabase/migrations/", import.meta.url);
const expectedMigrationCount = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).length;
const input = readFileSync(sqlPath, "utf8") + "\nselect case when to_regclass('public.orders') is not null and to_regclass('public.ap_anonymous_drafts') is null then 'ROLLBACK_OK' else 'ROLLBACK_FAILED' end;\n";

const rollback = run("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], input);
const rollbackPassed = !rollback.error && rollback.status === 0 && rollback.stdout.includes("ROLLBACK_OK");

// A rollback test must never leave the shared local development database in the rolled-back state.
const reset = run("supabase", ["db", "reset", "--local"]);
if (reset.error || reset.status !== 0) {
  if (reset.error) console.error(reset.error);
  console.error("Rollback verification could not restore the latest local schema.");
  return reset.status || 1;
}

const restoreSql = `
select case when
  to_regclass('public.ap_anonymous_drafts') is not null
  and exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'ap_create_anonymous_draft'
  )
  and to_regclass('public.ap_snapshot_legal_content_receipts') is not null
  and exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname='ap_upgrade_completed_intake_legal_acceptance'
  )
  and position(
    'ap_finalize_four_step_intake_with_legal_acceptance_v3'
    in pg_get_functiondef('public.ap_finalize_four_step_intake_with_legal_acceptance_v2(uuid,text,bigint,uuid,jsonb,text,uuid,bytea,text,bytea,bytea,bytea,text,text,text,text,jsonb,text,text,text)'::regprocedure)
  ) > 0
  and exists (
    select 1 from public.ap_commerce_configuration
    where singleton
      and terms_version='${LAUNCH_LEGAL_BINDING.termsVersion}'
      and terms_content_sha256='${LAUNCH_LEGAL_BINDING.termsContentSha256}'
      and privacy_version='${LAUNCH_LEGAL_BINDING.privacyVersion}'
      and privacy_content_sha256='${LAUNCH_LEGAL_BINDING.privacyContentSha256}'
      and legal_acceptance_copy_version='${LAUNCH_LEGAL_BINDING.acceptanceCopyVersion}'
      and legal_acceptance_copy_sha256='${LAUNCH_LEGAL_BINDING.acceptanceCopySha256}'
      and legal_content_canonicalization_version='${LAUNCH_LEGAL_BINDING.contentCanonicalizationVersion}'
      and legal_receipt_schema_version='${LAUNCH_LEGAL_BINDING.receiptSchemaVersion}'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid='public.ap_snapshot_legal_acceptances'::regclass
      and conname='ap_snapshot_legal_acceptances_snapshot_hash_key'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid='public.ap_snapshot_legal_content_receipts'::regclass
      and conname='ap_snapshot_legal_content_receipts_snapshot_hash_key'
  )
  and to_regclass('public.ap_legal_receipt_acceptance_reconciliations') is not null
  and exists (
    select 1 from pg_trigger
    where tgrelid='public.ap_legal_receipt_acceptance_reconciliations'::regclass
      and tgname='ap_legal_receipt_acceptance_reconciliations_immutable'
      and not tgisinternal
  )
  and position(
    'on conflict(snapshot_id,acceptance_sha256)'
    in pg_get_functiondef('public.ap_record_snapshot_legal_content_receipt(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text)'::regprocedure)
  ) > 0
  and position(
    'pg_advisory_xact_lock'
    in pg_get_functiondef('public.ap_upgrade_completed_intake_legal_acceptance(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure)
  ) > 0
  and position(
    'array_remove(array[existing.canonical_employer_listing_url,existing.canonical_application_url],null)'
    in pg_get_functiondef('public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb)'::regprocedure)
  ) > 0
  and position(
    'array_remove(array[other.canonical_employer_listing_url,other.canonical_application_url],null)'
    in pg_get_functiondef('public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text)'::regprocedure)
  ) > 0
  and exists (
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610040077'
      and checkpoint='ATOMIC_INVENTORY_IDENTITY_ENFORCEMENT'
  )
  and exists (
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610040078'
      and checkpoint='REQUEUE_IDENTITY_POLICY_FEASIBILITY'
  )
  and exists (
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610040079'
      and checkpoint='RUNTIME_LAUNCH_SCHEMA_READINESS'
  )
  and exists (
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610040080'
      and checkpoint='PERSISTENT_INVENTORY_IDENTITY_GUARD'
  )
  and exists (
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610190081'
      and checkpoint='OPEN_FONT_DOCUMENT_CONTRACT'
  )
  and exists (
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610190082'
      and checkpoint='TAX_ACTIVATION_DECISION'
  )
  and exists (
    select 1 from pg_trigger
    where tgrelid='public.ap_inventory_members'::regclass
      and tgname='ap_guard_inventory_member_identity'
      and tgenabled='O'
      and not tgisinternal
  )
  -- Installed schema controls do not authorize hosted cleanup or purchasing.
  and public.ap_sandbox_activation_schema_installed()
  and public.ap_one_off_retention_schema_installed()
  and public.ap_material_clarification_resume_schema_installed()
  and exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260103' and checkpoint='MATERIAL_CLARIFICATION_RESUME')
  and public.ap_manual_launch_schema_readiness()->>'ready'='true'
  and exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
  and exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610190083' and checkpoint='LEGACY_BOARD_READ_ONLY_ARCHIVE')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610190084' and checkpoint='LEGACY_BOARD_TERMINAL_EVENT_ORDERING')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610220085' and checkpoint='STAGING_REHEARSAL_CHECKOUT_ATTEMPTS')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610230086' and checkpoint='SANDBOX_VALIDATION_LAUNCH_ACTIVATION')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
  and public.ap_material_draft_pair_schema_installed()
  and public.ap_material_rule_revalidation_schema_installed()
  and public.ap_source_aware_document_schema_installed()
  and public.ap_material_draft_stage_claiming_schema_installed()
  and public.ap_reference_aware_draft_schema_installed()
  and public.ap_material_clarification_schema_installed()
  and public.ap_service_repair_case_state_schema_installed()
  and exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250101' and checkpoint='MATERIAL_CLARIFICATION_CONFIRMATION')
  and exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260102' and checkpoint='SERVICE_REPAIR_CASE_STATE_CAS')
  and public.ap_automatic_research_schema_installed()
  and exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250100' and checkpoint='AUTOMATIC_RESEARCH_PREPARATION')
  and exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled)
  and public.ap_service_repair_schema_installed()
  and exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250099' and checkpoint='SCOPED_SERVICE_ERROR_REPAIRS')
  and public.ap_protected_archive_schema_installed()
  and exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
  and exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
  and not exists(select 1 from public.ap_archive_retention_runs where state not in ('COMPLETE','CANCELED'))
  and public.ap_material_draft_change_schema_installed()
  and exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
  and public.ap_service_error_triage_schema_installed()
  and exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
  and exists(select 1 from public.ap_retention_private_tables
    where table_name='ap_material_rule_revalidations' and primary_key='id' and redaction_patch='{}')
  and exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
  and exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
  and not exists(select 1 from public.ap_material_draft_permits)
  and public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'='202610260103'
  and exists (
    select 1 from pg_proc procedure
    join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname='ap_finalize_four_step_intake_with_legal_acceptance_v3'
      and pg_get_functiondef(procedure.oid) like '%acceptance.acceptance_sha256=p_acceptance_sha256%'
  )
  and (select count(*) from supabase_migrations.schema_migrations) = ${expectedMigrationCount}
then 'RESTORE_OK' else 'RESTORE_FAILED' end;
`;
const restore = run("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], restoreSql);
const restorePassed = !restore.error && restore.status === 0 && restore.stdout.includes("RESTORE_OK");

if (!rollbackPassed || !restorePassed) {
  if (rollback.error) console.error(rollback.error);
  if (restore.error) console.error(restore.error);
  return rollback.status || restore.status || 1;
}

console.log(`Isolated structural SQL rollback/reset verified through all ${expectedMigrationCount} migrations; this is not protected application recovery.`);
return 0;
}

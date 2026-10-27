import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Supabase migration up has no target-version option. Historical positive
// fixtures need an unchanged source copy ending at086, before retention087
// deliberately closes readiness while cleanup executors remain unavailable.
export function prepareHistorical086Workspace() {
  const temporaryRoot = resolve(tmpdir());
  const path = mkdtempSync(join(temporaryRoot, "applypack-historical086-upgrade-"));
  const dispose = () => {
    const target = resolve(path);
    if (dirname(target) !== temporaryRoot || !basename(target).startsWith("applypack-historical086-upgrade-")) {
      throw new Error("UNSAFE_HISTORICAL_UPGRADE_CLEANUP_PATH");
    }
    rmSync(target, { recursive: true, force: true });
  };
  try {
    const source = fileURLToPath(new URL("../../supabase/", import.meta.url));
    const target = join(path, "supabase");
    mkdirSync(join(target, "migrations"), { recursive: true });
    mkdirSync(join(target, "templates"));
    copyFileSync(join(source, "config.toml"), join(target, "config.toml"));
    copyFileSync(join(source, "templates", "applypack-code.html"), join(target, "templates", "applypack-code.html"));
    for (const name of readdirSync(join(source, "migrations"))) {
      const version = /^(\d{12})_.+\.sql$/u.exec(name)?.[1];
      if (version && version <= "202610230086") copyFileSync(join(source, "migrations", name), join(target, "migrations", name));
    }
    return { path, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export const historical086PhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610230086'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610230086'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
  then raise exception 'historical_086_upgrade_phase_not_ready'; end if;
end $$;`;

// Schema installation readiness is distinct from checkout or hosted launch approval.
export const current091LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250091'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250091'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_091_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current092LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250092'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250092'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_092_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current093LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250093'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250093'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_093_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current094LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250094'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250094'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_094_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current095LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250095'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250095'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_095_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current096LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250096'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250096'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_096_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current097LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250097'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250097'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_material_draft_change_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
    or exists(select 1 from public.ap_material_draft_change_requests)
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_097_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current098LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250098'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250098'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_protected_archive_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
    or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
    or exists(select 1 from public.ap_archive_writer_runs)
    or exists(select 1 from public.ap_archive_retention_runs)
    or not public.ap_material_draft_change_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
    or exists(select 1 from public.ap_material_draft_change_requests)
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_098_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current099LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250099'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250099'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_service_repair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250099' and checkpoint='SCOPED_SERVICE_ERROR_REPAIRS')
    or exists(select 1 from public.ap_service_repair_jobs)
    or exists(select 1 from public.ap_service_repair_versions)
    or exists(select 1 from public.ap_service_repair_files)
    or exists(select 1 from public.ap_service_repair_releases)
    or exists(select 1 from public.ap_service_repair_case_events)
    or exists(select 1 from public.ap_service_repair_feedback)
    or not public.ap_protected_archive_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
    or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
    or exists(select 1 from public.ap_archive_writer_runs)
    or exists(select 1 from public.ap_archive_retention_runs)
    or not public.ap_material_draft_change_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
    or exists(select 1 from public.ap_material_draft_change_requests)
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_099_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current100LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250100'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250100'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_automatic_research_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250100' and checkpoint='AUTOMATIC_RESEARCH_PREPARATION')
    or not exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled and cardinality(configuration_ids)=0)
    or exists(select 1 from public.ap_research_preparations)
    or exists(select 1 from public.ap_research_preparation_sources)
    or not public.ap_service_repair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250099' and checkpoint='SCOPED_SERVICE_ERROR_REPAIRS')
    or exists(select 1 from public.ap_service_repair_jobs)
    or exists(select 1 from public.ap_service_repair_versions)
    or exists(select 1 from public.ap_service_repair_files)
    or exists(select 1 from public.ap_service_repair_releases)
    or exists(select 1 from public.ap_service_repair_case_events)
    or exists(select 1 from public.ap_service_repair_feedback)
    or not public.ap_protected_archive_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
    or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
    or exists(select 1 from public.ap_archive_writer_runs)
    or exists(select 1 from public.ap_archive_retention_runs)
    or not public.ap_material_draft_change_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
    or exists(select 1 from public.ap_material_draft_change_requests)
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_100_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current101LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610250101'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610250101'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_material_clarification_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250101' and checkpoint='MATERIAL_CLARIFICATION_CONFIRMATION')
    or exists(select 1 from public.ap_intake_clarifications)
    or exists(select 1 from public.ap_intake_inherited_documents)
    or exists(select 1 from public.ap_intake_clarification_answers)
    or not public.ap_automatic_research_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250100' and checkpoint='AUTOMATIC_RESEARCH_PREPARATION')
    or not exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled and cardinality(configuration_ids)=0)
    or exists(select 1 from public.ap_research_preparations)
    or exists(select 1 from public.ap_research_preparation_sources)
    or not public.ap_service_repair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250099' and checkpoint='SCOPED_SERVICE_ERROR_REPAIRS')
    or exists(select 1 from public.ap_service_repair_jobs)
    or exists(select 1 from public.ap_service_repair_versions)
    or exists(select 1 from public.ap_service_repair_files)
    or exists(select 1 from public.ap_service_repair_releases)
    or exists(select 1 from public.ap_service_repair_case_events)
    or exists(select 1 from public.ap_service_repair_feedback)
    or not public.ap_protected_archive_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
    or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
    or exists(select 1 from public.ap_archive_writer_runs)
    or exists(select 1 from public.ap_archive_retention_runs)
    or not public.ap_material_draft_change_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
    or exists(select 1 from public.ap_material_draft_change_requests)
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_101_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current102LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610260102'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610260102'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_service_repair_case_state_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260102' and checkpoint='SERVICE_REPAIR_CASE_STATE_CAS')
    or not public.ap_material_clarification_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250101' and checkpoint='MATERIAL_CLARIFICATION_CONFIRMATION')
    or exists(select 1 from public.ap_intake_clarifications)
    or exists(select 1 from public.ap_intake_inherited_documents)
    or exists(select 1 from public.ap_intake_clarification_answers)
    or not public.ap_automatic_research_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250100' and checkpoint='AUTOMATIC_RESEARCH_PREPARATION')
    or not exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled and cardinality(configuration_ids)=0)
    or exists(select 1 from public.ap_research_preparations)
    or exists(select 1 from public.ap_research_preparation_sources)
    or not public.ap_service_repair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250099' and checkpoint='SCOPED_SERVICE_ERROR_REPAIRS')
    or exists(select 1 from public.ap_service_repair_jobs)
    or exists(select 1 from public.ap_service_repair_versions)
    or exists(select 1 from public.ap_service_repair_files)
    or exists(select 1 from public.ap_service_repair_releases)
    or exists(select 1 from public.ap_service_repair_case_events)
    or exists(select 1 from public.ap_service_repair_feedback)
    or not public.ap_protected_archive_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
    or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
    or exists(select 1 from public.ap_archive_writer_runs)
    or exists(select 1 from public.ap_archive_retention_runs)
    or not public.ap_material_draft_change_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
    or exists(select 1 from public.ap_material_draft_change_requests)
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_102_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current103LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610260103'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610260103'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_material_clarification_resume_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260103' and checkpoint='MATERIAL_CLARIFICATION_RESUME')
    or not public.ap_service_repair_case_state_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260102' and checkpoint='SERVICE_REPAIR_CASE_STATE_CAS')
    or not public.ap_material_clarification_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250101' and checkpoint='MATERIAL_CLARIFICATION_CONFIRMATION')
    or not public.ap_automatic_research_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250100' and checkpoint='AUTOMATIC_RESEARCH_PREPARATION')
    or not exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled and cardinality(configuration_ids)=0)
    or exists(select 1 from public.ap_research_preparations where state<>'STALE' or lease_token is not null or lease_until is not null)
    or exists(select 1 from public.ap_research_preparation_sources)
    or not public.ap_service_repair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250099' and checkpoint='SCOPED_SERVICE_ERROR_REPAIRS')
    or exists(select 1 from public.ap_service_repair_jobs)
    or exists(select 1 from public.ap_service_repair_versions)
    or exists(select 1 from public.ap_service_repair_files)
    or exists(select 1 from public.ap_service_repair_releases)
    or exists(select 1 from public.ap_service_repair_case_events)
    or exists(select 1 from public.ap_service_repair_feedback)
    or not public.ap_protected_archive_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
    or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
    or exists(select 1 from public.ap_archive_writer_runs)
    or exists(select 1 from public.ap_archive_retention_runs)
    or not public.ap_material_draft_change_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
    or exists(select 1 from public.ap_material_draft_change_requests)
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_103_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current104LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610270104'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610270104'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_employer_rule_review_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610270104' and checkpoint='EMPLOYER_RULE_REVIEW_CONFIRMATION')
    or not public.ap_material_clarification_resume_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260103' and checkpoint='MATERIAL_CLARIFICATION_RESUME')
    or not public.ap_service_repair_case_state_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260102' and checkpoint='SERVICE_REPAIR_CASE_STATE_CAS')
    or not public.ap_material_clarification_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250101' and checkpoint='MATERIAL_CLARIFICATION_CONFIRMATION')
    or not public.ap_automatic_research_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250100' and checkpoint='AUTOMATIC_RESEARCH_PREPARATION')
    or not exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled and cardinality(configuration_ids)=0)
    or exists(select 1 from public.ap_research_preparations where state<>'STALE' or lease_token is not null or lease_until is not null)
    or exists(select 1 from public.ap_research_preparation_sources)
    or not public.ap_service_repair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250099' and checkpoint='SCOPED_SERVICE_ERROR_REPAIRS')
    or exists(select 1 from public.ap_service_repair_jobs)
    or exists(select 1 from public.ap_service_repair_versions)
    or exists(select 1 from public.ap_service_repair_files)
    or exists(select 1 from public.ap_service_repair_releases)
    or exists(select 1 from public.ap_service_repair_case_events)
    or exists(select 1 from public.ap_service_repair_feedback)
    or not public.ap_protected_archive_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
    or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
    or exists(select 1 from public.ap_archive_writer_runs)
    or exists(select 1 from public.ap_archive_retention_runs)
    or not public.ap_material_draft_change_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
    or exists(select 1 from public.ap_material_draft_change_requests)
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_104_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

export const current105LockedPhaseSql = `do $$ begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610270105'
    or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610270105'
    or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
    or not public.ap_one_off_retention_schema_installed()
    or to_regprocedure('public.ap_claim_expired_service_retention(integer)') is null
    or to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is null
    or to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is null
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610240087' and checkpoint='ONE_OFF_SERVICE_RETENTION')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250088' and checkpoint='SERVICE_RETENTION_CLEANUP')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250089' and checkpoint='CONFIRMED_INTAKE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250090' and checkpoint='MATCHING_EVIDENCE_COMPLETION')
    or not public.ap_material_draft_pair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
    or not public.ap_material_rule_revalidation_schema_installed()
    or not public.ap_source_aware_document_schema_installed()
    or not public.ap_material_draft_stage_claiming_schema_installed()
    or not public.ap_verified_source_run_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610270105' and checkpoint='VERIFIED_SOURCE_RUN_BINDING')
    or not public.ap_employer_rule_review_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610270104' and checkpoint='EMPLOYER_RULE_REVIEW_CONFIRMATION')
    or not public.ap_material_clarification_resume_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260103' and checkpoint='MATERIAL_CLARIFICATION_RESUME')
    or not public.ap_service_repair_case_state_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260102' and checkpoint='SERVICE_REPAIR_CASE_STATE_CAS')
    or not public.ap_material_clarification_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250101' and checkpoint='MATERIAL_CLARIFICATION_CONFIRMATION')
    or not public.ap_automatic_research_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250100' and checkpoint='AUTOMATIC_RESEARCH_PREPARATION')
    or not exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled and cardinality(configuration_ids)=0)
    or exists(select 1 from public.ap_research_preparations where state<>'STALE' or lease_token is not null or lease_until is not null)
    or exists(select 1 from public.ap_research_preparation_sources)
    or not public.ap_service_repair_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250099' and checkpoint='SCOPED_SERVICE_ERROR_REPAIRS')
    or exists(select 1 from public.ap_service_repair_jobs)
    or exists(select 1 from public.ap_service_repair_versions)
    or exists(select 1 from public.ap_service_repair_files)
    or exists(select 1 from public.ap_service_repair_releases)
    or exists(select 1 from public.ap_service_repair_case_events)
    or exists(select 1 from public.ap_service_repair_feedback)
    or not public.ap_protected_archive_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
    or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
    or exists(select 1 from public.ap_archive_writer_runs)
    or exists(select 1 from public.ap_archive_retention_runs)
    or not public.ap_material_draft_change_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250097' and checkpoint='MATERIAL_DRAFT_CHANGE_REQUESTS')
    or exists(select 1 from public.ap_material_draft_change_requests)
    or not public.ap_service_error_triage_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
    or exists(select 1 from public.ap_service_error_contracts)
    or not public.ap_reference_aware_draft_schema_installed()
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250095' and checkpoint='REFERENCE_AWARE_DRAFT_DELIVERY')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250093' and checkpoint='SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
    or not exists(select 1 from public.ap_migration_checkpoints
      where migration_id='202610250092' and checkpoint='MATERIAL_RULE_REVALIDATION')
    or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
    or exists(select 1 from public.ap_material_draft_permits)
    or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
    or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  then raise exception 'current_105_upgrade_phase_not_installed_and_locked'; end if;
end $$;`;

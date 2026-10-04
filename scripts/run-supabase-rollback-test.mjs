import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  APPROVED_ROLLBACK_LEGAL_CONTRACT,
  verifyRollbackLegalSource,
} from "./rollback-legal-contract.mjs";

const sqlPath = fileURLToPath(new URL("../supabase/rollback/202609040022_corrected_chunk1_foundation.rollback.sql", import.meta.url));
const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const expectedMigrationCount = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).length;
const input = readFileSync(sqlPath, "utf8") + "\nselect case when to_regclass('public.orders') is not null and to_regclass('public.ap_anonymous_drafts') is null then 'ROLLBACK_OK' else 'ROLLBACK_FAILED' end;\n";
const minimumCompatibleApplicationRollbackSha = "5b38407a4e8023e00ebee625f6925c265bdaee1a";
const requestedRollbackTarget = process.env.AP_ROLLBACK_TARGET_SHA?.trim() || "HEAD";

function run(command, args, stdin) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: stdin,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function capture(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const resolvedTargetResult = capture("git", ["rev-parse", "--verify", `${requestedRollbackTarget}^{commit}`]);
if (resolvedTargetResult.error || resolvedTargetResult.status !== 0) {
  if (resolvedTargetResult.stderr) process.stderr.write(resolvedTargetResult.stderr);
  console.error(`Rollback target does not resolve to a commit: ${requestedRollbackTarget}`);
  process.exit(resolvedTargetResult.status || 1);
}
const resolvedRollbackTarget = resolvedTargetResult.stdout.trim();
const ancestry = capture("git", [
  "merge-base",
  "--is-ancestor",
  minimumCompatibleApplicationRollbackSha,
  resolvedRollbackTarget,
]);
if (ancestry.error || ancestry.status !== 0) {
  if (ancestry.stderr) process.stderr.write(ancestry.stderr);
  console.error(
    `Rollback target ${resolvedRollbackTarget} predates the minimum cleanup-compatible application ${minimumCompatibleApplicationRollbackSha}.`,
  );
  process.exit(ancestry.status || 1);
}

const generationAtTarget = capture("git", [
  "show",
  `${resolvedRollbackTarget}:src/app/api/admin/material-lines/[id]/generate/route.ts`,
]);
const requiredCleanupSignals = [
  'storageBucket: "operator-drafts"',
  'storageBucket: "operator-render-previews"',
  'storageBucket: "customer-deliveries"',
  'reason: "material_sensitive_upload_intent"',
  "p_claim_provenance: { ...input.artifact.provenance, editableSource, uploadCleanup }",
];
const materialIntentIndex = generationAtTarget.stdout.indexOf('const cleanupIntent = await input.admin.from("storage_cleanup_queue").upsert');
const materialUploadIndex = generationAtTarget.stdout.indexOf("const sourceUpload = await input.admin.storage");
if (
  generationAtTarget.error
  || generationAtTarget.status !== 0
  || requiredCleanupSignals.some((signal) => !generationAtTarget.stdout.includes(signal))
  || materialIntentIndex < 0
  || materialUploadIndex < 0
  || materialIntentIndex >= materialUploadIndex
) {
  if (generationAtTarget.stderr) process.stderr.write(generationAtTarget.stderr);
  console.error(
    `Rollback target ${resolvedRollbackTarget} does not retain durable cleanup intents for all three sensitive material uploads.`,
  );
  process.exit(generationAtTarget.status || 1);
}

const sourceUploadContracts = [
  {
    path: "src/lib/files/source-upload-cleanup.ts",
    required: ["INTENT_GRACE_MILLISECONDS", "source_upload_cleanup_queue_failed"],
  },
  {
    path: "src/app/api/intake/anonymous-draft/document/route.ts",
    required: ['"anonymous_source_upload_intent"', "removeSourceUploadOrQueue"],
    ordered: ["await createSourceUploadCleanupIntent", '.storage.from("customer-source-documents").upload(path, bytes'],
  },
  {
    path: "src/app/api/intake/draft/document/route.ts",
    required: ['"draft_source_upload_intent"', 'rpc("ap_register_intake_draft_document"', "removeSourceUploadOrQueue"],
    ordered: ["await createSourceUploadCleanupIntent", '.storage.from("customer-source-documents").upload(path, file'],
  },
  {
    path: "src/app/api/intake/route.ts",
    required: ['"intake_source_upload_intent"', "removeSourceUploadOrQueue"],
    ordered: ["await createSourceUploadCleanupIntent", '.storage.from("customer-source-documents").upload(path, file'],
  },
];
for (const contract of sourceUploadContracts) {
  const result = capture("git", ["show", `${resolvedRollbackTarget}:${contract.path}`]);
  const missingSignal = contract.required.find((signal) => !result.stdout.includes(signal));
  const intentIndex = contract.ordered ? result.stdout.indexOf(contract.ordered[0]) : -1;
  const uploadIndex = contract.ordered ? result.stdout.indexOf(contract.ordered[1]) : -1;
  if (
    result.error
    || result.status !== 0
    || missingSignal
    || (contract.ordered && (intentIndex < 0 || uploadIndex < 0 || intentIndex >= uploadIndex))
  ) {
    if (result.stderr) process.stderr.write(result.stderr);
    console.error(
      `Rollback target ${resolvedRollbackTarget} does not retain the ordered cleanup contract in ${contract.path}.`,
    );
    process.exit(result.status || 1);
  }
}

const rollbackWizard = capture("git", [
  "show",
  `${resolvedRollbackTarget}:src/app/get-started/wizard-v3.tsx`,
]);
const rollbackLegalPages = capture("git", [
  "show",
  `${resolvedRollbackTarget}:src/content/public-pages.ts`,
]);
const rollbackPresentation = capture("git", [
  "show",
  `${resolvedRollbackTarget}:src/lib/legal/presentation.ts`,
]);
const legalSourceVerification = verifyRollbackLegalSource({
  publicPagesSource: rollbackLegalPages.stdout,
  wizardSource: rollbackWizard.stdout,
  presentationSource: rollbackPresentation.status === 0 ? rollbackPresentation.stdout : "",
});
if (rollbackWizard.error || rollbackLegalPages.error || rollbackLegalPages.status !== 0 || !legalSourceVerification.ok) {
  if (rollbackWizard.stderr) process.stderr.write(rollbackWizard.stderr);
  if (rollbackLegalPages.stderr) process.stderr.write(rollbackLegalPages.stderr);
  console.error(
    `Rollback target ${resolvedRollbackTarget} does not display the exact approved legal content: ${legalSourceVerification.failures.join(",")}.`,
  );
  process.exit(rollbackWizard.status || rollbackLegalPages.status || 1);
}

console.log(
  `Application rollback target ${resolvedRollbackTarget} satisfies minimum ${minimumCompatibleApplicationRollbackSha}.`,
);

const rollback = run("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], input);
const rollbackPassed = !rollback.error && rollback.status === 0 && rollback.stdout.includes("ROLLBACK_OK");

// A rollback test must never leave the shared local development database in the rolled-back state.
const reset = run("supabase", ["db", "reset", "--local"]);
if (reset.error || reset.status !== 0) {
  if (reset.error) console.error(reset.error);
  console.error("Rollback verification could not restore the latest local schema.");
  process.exit(reset.status || 1);
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
      and terms_version='${APPROVED_ROLLBACK_LEGAL_CONTRACT.termsVersion}'
      and terms_content_sha256='${APPROVED_ROLLBACK_LEGAL_CONTRACT.termsContentSha256}'
      and privacy_version='${APPROVED_ROLLBACK_LEGAL_CONTRACT.privacyVersion}'
      and privacy_content_sha256='${APPROVED_ROLLBACK_LEGAL_CONTRACT.privacyContentSha256}'
      and legal_acceptance_copy_version='${APPROVED_ROLLBACK_LEGAL_CONTRACT.acceptanceCopyVersion}'
      and legal_acceptance_copy_sha256='${APPROVED_ROLLBACK_LEGAL_CONTRACT.acceptanceCopySha256}'
      and legal_content_canonicalization_version='${APPROVED_ROLLBACK_LEGAL_CONTRACT.contentCanonicalizationVersion}'
      and legal_receipt_schema_version='${APPROVED_ROLLBACK_LEGAL_CONTRACT.receiptSchemaVersion}'
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
  process.exit(rollback.status || restore.status || 1);
}

console.log(`Rollback verified and local schema restored through all ${expectedMigrationCount} migrations.`);

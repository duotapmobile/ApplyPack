import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
if (
  generationAtTarget.error
  || generationAtTarget.status !== 0
  || requiredCleanupSignals.some((signal) => !generationAtTarget.stdout.includes(signal))
) {
  if (generationAtTarget.stderr) process.stderr.write(generationAtTarget.stderr);
  console.error(
    `Rollback target ${resolvedRollbackTarget} does not retain durable cleanup intents for all three sensitive material uploads.`,
  );
  process.exit(generationAtTarget.status || 1);
}

const sourceUploadFiles = [
  "src/lib/files/source-upload-cleanup.ts",
  "src/app/api/intake/anonymous-draft/document/route.ts",
  "src/app/api/intake/draft/document/route.ts",
  "src/app/api/intake/route.ts",
];
const sourceUploadAtTarget = sourceUploadFiles.map((path) => ({
  path,
  result: capture("git", ["show", `${resolvedRollbackTarget}:${path}`]),
}));
const failedSourceRead = sourceUploadAtTarget.find(({ result }) => result.error || result.status !== 0);
const sourceUploadContract = sourceUploadAtTarget.map(({ result }) => result.stdout).join("\n");
const requiredSourceUploadSignals = [
  "await createSourceUploadCleanupIntent",
  '"anonymous_source_upload_intent"',
  '"draft_source_upload_intent"',
  '"intake_source_upload_intent"',
  'rpc("ap_register_intake_draft_document"',
  "source_upload_cleanup_queue_failed",
];
if (failedSourceRead || requiredSourceUploadSignals.some((signal) => !sourceUploadContract.includes(signal))) {
  if (failedSourceRead?.result.stderr) process.stderr.write(failedSourceRead.result.stderr);
  console.error(
    `Rollback target ${resolvedRollbackTarget} does not retain durable cleanup intents for every customer source upload path.`,
  );
  process.exit(failedSourceRead?.result.status || 1);
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

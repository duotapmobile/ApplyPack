import { runStructuralDatabaseRecovery } from "./lib/supabase-structural-recovery.mjs";
import { spawnSync } from "node:child_process";
import {
  verifyRollbackLegalSource,
} from "./rollback-legal-contract.mjs";

const minimumCompatibleApplicationRollbackSha = "aeae1dee597e153602febd6adfea5644e4628d20";
const requestedRollbackTarget = process.env.AP_ROLLBACK_TARGET_SHA?.trim();
if (!requestedRollbackTarget || !/^[0-9a-f]{40}$/.test(requestedRollbackTarget)) {
  console.error("AP_ROLLBACK_TARGET_SHA must name the full reviewed committed rollback SHA; a moving HEAD or dirty working directory is not rollback evidence.");
  process.exit(1);
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
const candidate = capture("git", ["rev-parse", "--verify", "HEAD^{commit}"]);
if (candidate.error || candidate.status !== 0 || resolvedRollbackTarget === candidate.stdout.trim()) {
  console.error("Rollback target must be a distinct reviewed committed application, not the current candidate HEAD.");
  process.exit(1);
}
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

const rollbackSchemaBinding = capture("git", [
  "show",
  `${resolvedRollbackTarget}:src/lib/operations/launch-schema.ts`,
]);
const rollbackReadiness = capture("git", [
  "show",
  `${resolvedRollbackTarget}:src/lib/operations/launch-readiness.ts`,
]);
const requiredSchemaBindingSignals = [
  'REQUIRED_LAUNCH_SCHEMA_VERSION = "202610260103"',
  '"202610040077"',
  '"202610040078"',
  '"202610040079"',
  '"202610040080"',
  '"202610190081"',
  '"202610190082"',
  '"202610190083"',
  '"202610190084"',
  '"202610220085"',
  '"202610230086"',
  '"202610240087"',
  '"202610250088"',
  '"202610250089"',
  '"202610250090"',
  '"202610250091"',
  '"202610250092"',
  '"202610250093"',
  '"202610250094"',
  '"202610250095"',
  '"202610250096"',
  '"202610250097"', '"202610250098"', '"202610250099"', '"202610250100"', '"202610250101"', '"202610260102"', '"202610260103"',
  "REQUIRED_LAUNCH_SCHEMA_VERSION",
];
if (
  rollbackSchemaBinding.error
  || rollbackSchemaBinding.status !== 0
  || requiredSchemaBindingSignals.some((signal) => !rollbackSchemaBinding.stdout.includes(signal))
  || rollbackReadiness.error
  || rollbackReadiness.status !== 0
  || !rollbackReadiness.stdout.includes('admin.rpc("ap_manual_launch_schema_readiness")')
  || !rollbackReadiness.stdout.includes("launchSchemaReadinessIsCurrent(schemaReadiness)")
) {
  if (rollbackSchemaBinding.stderr) process.stderr.write(rollbackSchemaBinding.stderr);
  if (rollbackReadiness.stderr) process.stderr.write(rollbackReadiness.stderr);
  console.error(
    `Rollback target ${resolvedRollbackTarget} does not bind runtime health and checkout to schema 202610260103.`,
  );
  process.exit(rollbackSchemaBinding.status || rollbackReadiness.status || 1);
}

const rollbackLegacyBoardUpgradeRunner = capture("git", [
  "show",
  `${resolvedRollbackTarget}:scripts/run-supabase-legacy-board-upgrade-test.mjs`,
]);
const rollbackLegacyBoardUpgradeSeed = capture("git", [
  "show",
  `${resolvedRollbackTarget}:tests/integration/legacy-board-083-upgrade-seed.sql`,
]);
const rollbackLegacyBoardUpgradeVerify = capture("git", [
  "show",
  `${resolvedRollbackTarget}:tests/integration/legacy-board-084-upgrade-verify.sql`,
]);
const rollbackPackage = capture("git", ["show", `${resolvedRollbackTarget}:package.json`]);
const legacyBoardUpgradeSignals = [
  [rollbackLegacyBoardUpgradeRunner, '"--version", "202610190083"'],
  [rollbackLegacyBoardUpgradeRunner, '["migration", "up", "--local"]'],
  [rollbackLegacyBoardUpgradeRunner, "LEGACY_BOARD_083_UPGRADE_SEED_OK"],
  [rollbackLegacyBoardUpgradeRunner, "LEGACY_BOARD_084_UPGRADE_VERIFY_OK"],
  [rollbackLegacyBoardUpgradeSeed, "LEGACY_BOARD_083_UPGRADE_SEED_OK"],
  [rollbackLegacyBoardUpgradeSeed, "pre-084 stale-event failure"],
  [rollbackLegacyBoardUpgradeVerify, "LEGACY_BOARD_084_UPGRADE_VERIFY_OK"],
  [rollbackLegacyBoardUpgradeVerify, "legacy_board_terminal_event_replay_mismatch"],
  [rollbackLegacyBoardUpgradeVerify, "last_provider_event_id='evt_upgrade_refund_newer'"],
  [rollbackPackage, "node scripts/run-supabase-legacy-board-upgrade-test.mjs"],
];
const missingLegacyBoardUpgradeSignal = legacyBoardUpgradeSignals.find(
  ([result, signal]) => result.error || result.status !== 0 || !result.stdout.includes(signal),
);
if (missingLegacyBoardUpgradeSignal) {
  const [result] = missingLegacyBoardUpgradeSignal;
  if (result.stderr) process.stderr.write(result.stderr);
  console.error(
    `Rollback target ${resolvedRollbackTarget} does not retain the executable migration 083-to-084 legacy-board upgrade proof.`,
  );
  process.exit(result.status || 1);
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
  "p_claim_provenance: {",
  "...input.artifact.provenance",
  "documentFontAttestation: {",
  "editableSource",
  "uploadCleanup",
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

process.exitCode = runStructuralDatabaseRecovery();

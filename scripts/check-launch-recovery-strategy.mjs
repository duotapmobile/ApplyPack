import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runStructuralDatabaseRecovery } from "./lib/supabase-structural-recovery.mjs";

const repository = "duotapmobile/ApplyPack";
const canonicalRemotes = new Set([`https://github.com/${repository}`, `https://github.com/${repository}.git`]);
const root = fileURLToPath(new URL("../", import.meta.url));
const fullSha = /^[0-9a-f]{40}$/;
const digest = /^[0-9a-f]{64}$/;
const approvedReference = /^https:\/\/github\.com\/duotapmobile\/ApplyPack\/(?:issues|pull)\/[1-9][0-9]*#(?:issuecomment|pullrequestreview)-[1-9][0-9]*$/;
const allowedRefs = new Set(["refs/heads/main", "refs/heads/codex/manual-launch-hardening-2026-10-02"]);
export const PROTECTED_RECOVERY_CHECKS = Object.freeze([
  "databaseRows", "privateObjectsAndVersions", "applicationEnvelopeKeys", "protectedConfiguration",
  "authenticationDependencies", "ownerAccess", "validDocumentDownload", "wrongUserDenial", "keyAccess",
  "offMachineRecovery", "operatorCredentialLossRecovery", "retentionAndDeletion",
]);
const lockedPlanFlags = ["requiredBeforeHostedMigration", "applicationCheckoutLocked", "outboundMailDisabled",
  "livePaymentsDisabled", "externalCallbacksDisabled", "scheduledWritersDisabled"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const reject = (code) => { throw new Error(code); };

function exactKeys(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) reject(code);
}

function utcTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}

export function collectRecoverySourceIdentity(repoRoot = root, capture = spawnSync) {
  const git = (...args) => {
    const result = capture("git", ["-C", repoRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.error || result.status !== 0) reject("RECOVERY_GIT_IDENTITY_UNAVAILABLE");
    return result.stdout.trim();
  };
  if (resolve(git("rev-parse", "--show-toplevel")) !== resolve(repoRoot)
    || !canonicalRemotes.has(git("remote", "get-url", "origin"))) reject("RECOVERY_WRONG_REPOSITORY");
  const candidateSha = git("rev-parse", "--verify", "HEAD^{commit}");
  if (!fullSha.test(candidateSha)) reject("RECOVERY_FULL_CANDIDATE_REQUIRED");
  if (git("status", "--porcelain=v1", "--untracked-files=all")) reject("RECOVERY_CLEAN_CANDIDATE_REQUIRED");
  const schema = readFileSync(resolve(repoRoot, "src/lib/operations/launch-schema.ts"));
  const schemaVersion = schema.toString("utf8").match(/export const REQUIRED_LAUNCH_SCHEMA_VERSION = "([0-9]{12})";/)?.[1];
  if (schemaVersion !== "202610250090") reject("RECOVERY_SCHEMA_090_REQUIRED");
  const migrationDirectory = resolve(repoRoot, "supabase/migrations");
  const names = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).sort();
  if (!names.length || names.some((name) => !/^[0-9]{12}_[a-z0-9_]+\.sql$/.test(name))
    || !names.some((name) => name.startsWith(`${schemaVersion}_`))) reject("RECOVERY_MIGRATION_SET_INVALID");
  const migrations = names.map((name) => ({ path: `supabase/migrations/${name}`,
    sha256: sha256(readFileSync(resolve(migrationDirectory, name))) }));
  return { candidateSha, schemaVersion, launchSchemaSha256: sha256(schema),
    migrationSetSha256: sha256(JSON.stringify(migrations)) };
}

// Inputs are statements wired from controlled GitHub configuration, not proof of the referenced human or hosted work.
export function validateRecoverySelection({ env, identity, now = Date.now() }) {
  const strategy = env.AP_RECOVERY_STRATEGY || "TESTED_COMPATIBLE_SHA";
  const target = env.AP_ROLLBACK_TARGET_SHA || "";
  const rawPlan = env.AP_FORWARD_RECOVERY_PLAN_JSON || "";
  const planSha256 = env.AP_FORWARD_RECOVERY_PLAN_SHA256 || "";
  if (!["TESTED_COMPATIBLE_SHA", "LOCKED_FORWARD_RECOVERY"].includes(strategy)) reject("RECOVERY_UNKNOWN_STRATEGY");
  if (strategy === "TESTED_COMPATIBLE_SHA") {
    if (rawPlan || planSha256) reject("RECOVERY_CONFLICTING_STRATEGIES");
    if (!fullSha.test(target) || target === identity.candidateSha) reject("RECOVERY_DISTINCT_FULL_ROLLBACK_SHA_REQUIRED");
    return { strategy, rollbackTargetSha: target };
  }
  if (target) reject("RECOVERY_CONFLICTING_STRATEGIES");
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== repository
    || !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)
    || !allowedRefs.has(env.GITHUB_REF)) reject("FORWARD_RECOVERY_REVIEWED_PUSH_OR_MANUAL_CANDIDATE_REQUIRED");
  if (!fullSha.test(identity.candidateSha) || env.GITHUB_SHA !== identity.candidateSha) reject("FORWARD_RECOVERY_TESTED_COMMIT_MISMATCH");
  if (typeof rawPlan !== "string" || Buffer.byteLength(rawPlan, "utf8") > 16384 || !digest.test(planSha256)
    || sha256(rawPlan) !== planSha256) reject("FORWARD_RECOVERY_EXACT_PLAN_HASH_REQUIRED");
  let plan;
  try { plan = JSON.parse(rawPlan); } catch { reject("FORWARD_RECOVERY_PLAN_JSON_INVALID"); }
  // A compact JSON.stringify encoding also rejects duplicate keys and trailing content without guessing intent.
  if (rawPlan !== JSON.stringify(plan)) reject("FORWARD_RECOVERY_COMPACT_UNAMBIGUOUS_JSON_REQUIRED");
  exactKeys(plan, ["version", "strategy", "status", "repository", "ref", "candidateSha", "schemaVersion",
    "launchSchemaSha256", "migrationSetSha256", "reviewedBy", "approvalReference", "reviewedAt", "expiresAt",
    "acceptedRecoveryTimeMinutes", "acceptedDataLossMinutes", "riskAcceptanceReference", "protectedRecoveryPlan"], "FORWARD_RECOVERY_PLAN_FIELDS_INVALID");
  if (plan.version !== 1 || plan.strategy !== strategy || plan.status !== "REVIEWED"
    || plan.repository !== repository || plan.ref !== env.GITHUB_REF
    || plan.candidateSha !== identity.candidateSha || plan.schemaVersion !== "202610250090"
    || plan.schemaVersion !== identity.schemaVersion || !digest.test(plan.launchSchemaSha256)
    || plan.launchSchemaSha256 !== identity.launchSchemaSha256 || !digest.test(plan.migrationSetSha256)
    || plan.migrationSetSha256 !== identity.migrationSetSha256) reject("FORWARD_RECOVERY_CANDIDATE_SCHEMA_BINDING_MISMATCH");
  if (typeof plan.reviewedBy !== "string" || plan.reviewedBy.length > 160
    || !/^[\p{L}][\p{L}.'’-]+(?: [\p{L}][\p{L}.'’-]+)+$/u.test(plan.reviewedBy)
    || /\b(?:assign|later|pending|unknown|todo|tbd|fixture|synthetic|test|example|reviewer|operator|owner|bot)\b/i.test(plan.reviewedBy)
    || !approvedReference.test(plan.approvalReference) || !approvedReference.test(plan.riskAcceptanceReference)) reject("FORWARD_RECOVERY_NAMED_REVIEW_AND_REFERENCES_REQUIRED");
  const reviewedAt = utcTime(plan.reviewedAt);
  const expiresAt = utcTime(plan.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(reviewedAt) || !Number.isFinite(expiresAt)
    || reviewedAt > now || expiresAt <= now || expiresAt <= reviewedAt
    || expiresAt - reviewedAt > 7 * 24 * 60 * 60 * 1000) reject("FORWARD_RECOVERY_REVIEW_TIME_INVALID");
  if (!Number.isSafeInteger(plan.acceptedRecoveryTimeMinutes) || plan.acceptedRecoveryTimeMinutes <= 0 || plan.acceptedRecoveryTimeMinutes > 240
    || !Number.isSafeInteger(plan.acceptedDataLossMinutes) || plan.acceptedDataLossMinutes < 0 || plan.acceptedDataLossMinutes > 15) reject("FORWARD_RECOVERY_NUMERIC_RTO_RPO_REQUIRED");
  exactKeys(plan.protectedRecoveryPlan, ["reference", ...lockedPlanFlags, "checks"], "FORWARD_RECOVERY_PROTECTED_PLAN_FIELDS_INVALID");
  const protectedPlan = plan.protectedRecoveryPlan;
  if (!approvedReference.test(protectedPlan.reference) || lockedPlanFlags.some((key) => protectedPlan[key] !== true)
    || !Array.isArray(protectedPlan.checks) || protectedPlan.checks.length !== PROTECTED_RECOVERY_CHECKS.length
    || PROTECTED_RECOVERY_CHECKS.some((key, index) => protectedPlan.checks[index] !== key)) reject("FORWARD_RECOVERY_PROTECTED_CHECKPOINTS_REQUIRED");
  return { strategy, planSha256, candidateSha: identity.candidateSha, schemaVersion: identity.schemaVersion };
}

export function executeRecoverySelection(selection, { runRollback, runStructural, log = console.log }) {
  if (selection.strategy === "TESTED_COMPATIBLE_SHA") return runRollback(selection.rollbackTargetSha);
  if (selection.strategy !== "LOCKED_FORWARD_RECOVERY") reject("RECOVERY_UNKNOWN_STRATEGY");
  const status = runStructural();
  if (status !== 0) return Number.isInteger(status) && status > 0 ? status : 1;
  log("Reviewed LOCKED_FORWARD_RECOVERY plan binding and isolated structural SQL test passed. Application rollback was not tested. Protected/off-machine/private-object/key/auth recovery remains unproven and mandatory before hosted migration or release.");
  return 0;
}

// CI can prove the disposable SQL mechanism before a final candidate has a
// reviewed hosted recovery receipt. This never approves a hosted migration.
export function executeStructuralCiRecovery({ runStructural, log = console.log }) {
  const status = runStructural();
  if (status !== 0) return Number.isInteger(status) && status > 0 ? status : 1;
  log("CI structural SQL recovery passed. Hosted migration is not authorized. Protected/off-machine/private-object/key/auth recovery and measured RTO <=240 minutes/RPO <=15 minutes remain mandatory before hosted migration or release.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && !["--describe", "--structural-only"].includes(process.argv[2]))) reject("RECOVERY_UNRECOGNIZED_ARGUMENT");
    const identity = collectRecoverySourceIdentity();
    if (process.argv[2] === "--describe") {
      console.log(JSON.stringify({ ...identity, approvalEstablished: false, recoveryEstablished: false }));
    } else if (process.argv[2] === "--structural-only") {
      process.exitCode = executeStructuralCiRecovery({ runStructural: runStructuralDatabaseRecovery });
    } else {
      const selection = validateRecoverySelection({ env: process.env, identity });
      process.exitCode = executeRecoverySelection(selection, {
        runStructural: runStructuralDatabaseRecovery,
        runRollback: (rollbackTargetSha) => {
          const result = spawnSync(process.execPath, [fileURLToPath(new URL("./run-supabase-rollback-test.mjs", import.meta.url))], {
            cwd: root, env: { ...process.env, AP_ROLLBACK_TARGET_SHA: rollbackTargetSha }, stdio: "inherit",
          });
          return result.error || result.status === null ? 1 : result.status;
        },
      });
    }
  } catch (error) {
    // No plan content, arbitrary subprocess text, reviewer details, or environment values enter a failure log.
    console.error(error instanceof Error && /^(?:RECOVERY|FORWARD_RECOVERY)_[A-Z_]+$/.test(error.message)
      ? error.message : "RECOVERY_GATE_FAILED");
    process.exitCode = 1;
  }
}

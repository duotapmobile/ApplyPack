import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { collectRecoverySourceIdentity, executeRecoverySelection, executeStructuralCiRecovery, PROTECTED_RECOVERY_CHECKS,
  validateRecoverySelection } from "./check-launch-recovery-strategy.mjs";
import { runStructuralDatabaseRecovery } from "./lib/supabase-structural-recovery.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const now = Date.parse("2026-10-23T12:00:00.000Z");
const identity = { candidateSha: "a".repeat(40), schemaVersion: "202610250095",
  launchSchemaSha256: "b".repeat(64), migrationSetSha256: "c".repeat(64) };
const reference = "https://github.com/duotapmobile/ApplyPack/issues/123#issuecomment-456";

// Entirely synthetic unit fixtures, never written to repository variables or accepted as operational approval.
function fixture() {
  const plan = { version: 1, strategy: "LOCKED_FORWARD_RECOVERY", status: "REVIEWED",
    repository: "duotapmobile/ApplyPack", ref: "refs/heads/codex/manual-launch-hardening-2026-10-02",
    ...identity, reviewedBy: "Jordan Rivera", approvalReference: reference,
    reviewedAt: "2026-10-23T11:00:00.000Z", expiresAt: "2026-10-24T11:00:00.000Z",
    acceptedRecoveryTimeMinutes: 120, acceptedDataLossMinutes: 0, riskAcceptanceReference: reference,
    protectedRecoveryPlan: { reference, requiredBeforeHostedMigration: true, applicationCheckoutLocked: true,
      outboundMailDisabled: true, livePaymentsDisabled: true, externalCallbacksDisabled: true,
      scheduledWritersDisabled: true, checks: [...PROTECTED_RECOVERY_CHECKS] } };
  return { plan, env: { AP_RECOVERY_STRATEGY: "LOCKED_FORWARD_RECOVERY", GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "duotapmobile/ApplyPack", GITHUB_EVENT_NAME: "push", GITHUB_REF: plan.ref,
    GITHUB_SHA: identity.candidateSha } };
}
function encoded(env, plan) {
  const text = JSON.stringify(plan);
  return { ...env, AP_FORWARD_RECOVERY_PLAN_JSON: text, AP_FORWARD_RECOVERY_PLAN_SHA256: hash(text) };
}
function validate(env, candidate = identity) { return validateRecoverySelection({ env, identity: candidate, now }); }

test("missing strategy retains distinct full rollback SHA contract; it never falls back", () => {
  assert.throws(() => validate({}), /DISTINCT_FULL_ROLLBACK/);
  for (const value of ["HEAD", "short", identity.candidateSha, "d".repeat(39), "D".repeat(40), ` ${"d".repeat(40)}`]) {
    assert.throws(() => validate({ AP_ROLLBACK_TARGET_SHA: value }), /DISTINCT_FULL_ROLLBACK/);
  }
  assert.deepEqual(validate({ AP_ROLLBACK_TARGET_SHA: "d".repeat(40) }), {
    strategy: "TESTED_COMPATIBLE_SHA", rollbackTargetSha: "d".repeat(40),
  });
});

test("unknown, whitespace, and mixed strategies fail closed", () => {
  for (const value of ["skip", "forward", "LOCKED_FORWARD_RECOVERY ", "TESTED_COMPATIBLE_SHA "]) {
    assert.throws(() => validate({ AP_RECOVERY_STRATEGY: value }), /UNKNOWN_STRATEGY/);
  }
  const { env, plan } = fixture();
  assert.throws(() => validate({ ...encoded(env, plan), AP_ROLLBACK_TARGET_SHA: "d".repeat(40) }), /CONFLICTING/);
  for (const value of [{ AP_FORWARD_RECOVERY_PLAN_JSON: "{}" }, { AP_FORWARD_RECOVERY_PLAN_SHA256: "f".repeat(64) }]) {
    assert.throws(() => validate({ AP_ROLLBACK_TARGET_SHA: "d".repeat(40), ...value }), /CONFLICTING/);
  }
});

test("synthetic approved plan fixture validates only its bindings and preserves hosted gates", () => {
  const { env, plan } = fixture();
  const selected = validate(encoded(env, plan));
  let structural = 0;
  const messages = [];
  assert.equal(executeRecoverySelection(selected, { runRollback: () => assert.fail("forward must not claim application rollback"),
    runStructural: () => { structural += 1; return 0; }, log: (message) => messages.push(message) }), 0);
  assert.equal(structural, 1);
  assert.match(messages.join(""), /Application rollback was not tested/);
  assert.match(messages.join(""), /remains unproven and mandatory before hosted migration or release/);
});

test("strict path delegates existing runner and preserves its failure; forward structural failure is fatal", () => {
  const selected = validate({ AP_ROLLBACK_TARGET_SHA: "d".repeat(40) });
  assert.equal(executeRecoverySelection(selected, { runRollback: (target) => {
    assert.equal(target, "d".repeat(40)); return 19;
  }, runStructural: () => assert.fail("strict runner owns the same mandatory structural helper") }), 19);
  for (const status of [1, 7, null, undefined, -1]) {
    assert.notEqual(executeRecoverySelection({ strategy: "LOCKED_FORWARD_RECOVERY" }, {
      runStructural: () => status, log: () => assert.fail("failure must not log acceptance") }), 0);
  }
  assert.throws(() => executeRecoverySelection({ strategy: "skip" }, {}), /UNKNOWN_STRATEGY/);
});

for (const [name, delta] of [
  ["local invocation", { GITHUB_ACTIONS: undefined }], ["wrong repository", { GITHUB_REPOSITORY: "other/ApplyPack" }],
  ["pull request synthetic merge", { GITHUB_EVENT_NAME: "pull_request" }],
  ["pull request target", { GITHUB_EVENT_NAME: "pull_request_target" }],
  ["unreviewed branch", { GITHUB_REF: "refs/heads/unreviewed" }], ["tag", { GITHUB_REF: "refs/tags/release" }],
  ["different tested SHA", { GITHUB_SHA: "d".repeat(40) }],
]) {
  test(`rejects ${name} before any structural operation`, () => {
    const { env, plan } = fixture();
    assert.throws(() => validate({ ...encoded(env, plan), ...delta }), /FORWARD_RECOVERY_/);
  });
}

for (const [name, mutate] of [
  ["unreviewed status", (p) => { p.status = "PROPOSED"; }],
  ["unknown field", (p) => { p.skipStructural = true; }],
  ["missing field", (p) => { delete p.riskAcceptanceReference; }],
  ["different candidate", (p) => { p.candidateSha = "d".repeat(40); }],
  ["different schema", (p) => { p.schemaVersion = "202610190084"; }],
  ["different schema bytes", (p) => { p.launchSchemaSha256 = "d".repeat(64); }],
  ["different migration bytes", (p) => { p.migrationSetSha256 = "d".repeat(64); }],
  ["different ref", (p) => { p.ref = "refs/heads/main"; }],
  ["different repository", (p) => { p.repository = "other/ApplyPack"; }],
  ["wrong plan strategy", (p) => { p.strategy = "TESTED_COMPATIBLE_SHA"; }],
  ["future review", (p) => { p.reviewedAt = "2026-10-23T13:00:00.000Z"; }],
  ["expired approval", (p) => { p.expiresAt = "2026-10-23T12:00:00.000Z"; }],
  ["overlong approval", (p) => { p.expiresAt = "2026-11-01T11:00:00.000Z"; }],
  ["inverted timestamps", (p) => { p.expiresAt = "2026-10-22T11:00:00.000Z"; }],
  ["invalid calendar date", (p) => { p.reviewedAt = "2026-09-31T11:00:00.000Z"; }],
  ["date without UTC milliseconds", (p) => { p.reviewedAt = "2026-10-23T11:00:00Z"; }],
  ["unassigned reviewer", (p) => { p.reviewedBy = "Assign Later"; }],
  ["role as reviewer", (p) => { p.reviewedBy = "Release Owner"; }],
  ["fixture reviewer", (p) => { p.reviewedBy = "Synthetic Reviewer"; }],
  ["unanchored review reference", (p) => { p.approvalReference = "https://github.com/duotapmobile/ApplyPack/issues/123"; }],
  ["fixture risk reference", (p) => { p.riskAcceptanceReference = "fixture:accepted"; }],
  ["cross-repo reference", (p) => { p.approvalReference = "https://github.com/other/ApplyPack/issues/123#issuecomment-456"; }],
  ["RTO above agreed four hours", (p) => { p.acceptedRecoveryTimeMinutes = 241; }],
  ["RPO above agreed fifteen minutes", (p) => { p.acceptedDataLossMinutes = 16; }],
  ["zero RTO", (p) => { p.acceptedRecoveryTimeMinutes = 0; }],
  ["text RTO", (p) => { p.acceptedRecoveryTimeMinutes = "120"; }],
  ["infinite RTO", (p) => { p.acceptedRecoveryTimeMinutes = Infinity; }],
  ["unsafe RTO", (p) => { p.acceptedRecoveryTimeMinutes = Number.MAX_SAFE_INTEGER + 1; }],
  ["negative RPO", (p) => { p.acceptedDataLossMinutes = -1; }],
  ["fractional RPO", (p) => { p.acceptedDataLossMinutes = 0.5; }],
  ["missing protected plan", (p) => { delete p.protectedRecoveryPlan; }],
  ["extra protected claim", (p) => { p.protectedRecoveryPlan.hostedPassed = true; }],
  ["fixture protected reference", (p) => { p.protectedRecoveryPlan.reference = "fixture:recovery"; }],
  ["optional hosted proof", (p) => { p.protectedRecoveryPlan.requiredBeforeHostedMigration = false; }],
  ["unlocked application", (p) => { p.protectedRecoveryPlan.applicationCheckoutLocked = false; }],
  ["outbound mail enabled", (p) => { p.protectedRecoveryPlan.outboundMailDisabled = false; }],
  ["payment enabled", (p) => { p.protectedRecoveryPlan.livePaymentsDisabled = false; }],
  ["callbacks enabled", (p) => { p.protectedRecoveryPlan.externalCallbacksDisabled = false; }],
  ["writers enabled", (p) => { p.protectedRecoveryPlan.scheduledWritersDisabled = false; }],
  ["missing off-machine checkpoint", (p) => { p.protectedRecoveryPlan.checks.splice(9, 1); }],
  ["duplicate checkpoint", (p) => { p.protectedRecoveryPlan.checks[9] = p.protectedRecoveryPlan.checks[0]; }],
]) {
  test(`rejects ${name}`, () => {
    const { env, plan } = fixture();
    mutate(plan);
    assert.throws(() => validate(encoded(env, plan)), /FORWARD_RECOVERY_/);
  });
}

test("received UTF-8 bytes, duplicate keys, oversized JSON, malformed JSON and absent digest fail closed", () => {
  const { env, plan } = fixture();
  const good = encoded(env, plan);
  for (const delta of [{ AP_FORWARD_RECOVERY_PLAN_JSON: "" }, { AP_FORWARD_RECOVERY_PLAN_SHA256: "" },
    { AP_FORWARD_RECOVERY_PLAN_SHA256: "f".repeat(64) },
    { AP_FORWARD_RECOVERY_PLAN_JSON: `${good.AP_FORWARD_RECOVERY_PLAN_JSON}\n` }]) {
    assert.throws(() => validate({ ...good, ...delta }), /EXACT_PLAN_HASH/);
  }
  for (const raw of ["{", `${good.AP_FORWARD_RECOVERY_PLAN_JSON}\n`, " ".repeat(16385),
    good.AP_FORWARD_RECOVERY_PLAN_JSON.replace('"version":1', '"version":0,"version":1')]) {
    assert.throws(() => validate({ ...env, AP_FORWARD_RECOVERY_PLAN_JSON: raw, AP_FORWARD_RECOVERY_PLAN_SHA256: hash(raw) }), /FORWARD_RECOVERY_/);
  }
});

test("manual candidate event accepts exact fixture binding; malformed tested identity does not", () => {
  const { env, plan } = fixture();
  assert.equal(validate({ ...encoded(env, plan), GITHUB_EVENT_NAME: "workflow_dispatch" }).strategy, "LOCKED_FORWARD_RECOVERY");
  assert.throws(() => validate(encoded(env, plan), { ...identity, candidateSha: "HEAD" }), /TESTED_COMMIT_MISMATCH/);
});

test("actual source identity hashes all migrations and refuses dirty, wrong-root, wrong-remote and unresolved checkouts", () => {
  const tempBase = resolve(tmpdir());
  const dir = mkdtempSync(join(tempBase, "applypack-recovery-unit-"));
  try {
    mkdirSync(join(dir, "src/lib/operations"), { recursive: true });
    mkdirSync(join(dir, "supabase/migrations"), { recursive: true });
    writeFileSync(join(dir, "src/lib/operations/launch-schema.ts"), 'export const REQUIRED_LAUNCH_SCHEMA_VERSION = "202610250095";\n');
    const migration = join(dir, "supabase/migrations/202610250095_example.sql");
    writeFileSync(migration, "select 1;\n");
    const fakeGit = (overrides = {}) => (_command, args) => {
      const command = args.slice(2).join(" ");
      const outputs = { "rev-parse --show-toplevel": dir, "remote get-url origin": "https://github.com/duotapmobile/ApplyPack.git",
        "rev-parse --verify HEAD^{commit}": identity.candidateSha, "status --porcelain=v1 --untracked-files=all": "", ...overrides };
      assert.ok(Object.hasOwn(outputs, command));
      return { status: 0, stdout: outputs[command] };
    };
    const before = collectRecoverySourceIdentity(dir, fakeGit());
    assert.deepEqual(collectRecoverySourceIdentity(dir, fakeGit({
      "remote get-url origin": "https://github.com/duotapmobile/ApplyPack",
    })), before);
    writeFileSync(migration, "select 2;\n");
    assert.notEqual(collectRecoverySourceIdentity(dir, fakeGit()).migrationSetSha256, before.migrationSetSha256);
    for (const dirty of [" M src/a.ts", "?? scripts/unknown.mjs"]) {
      assert.throws(() => collectRecoverySourceIdentity(dir, fakeGit({ "status --porcelain=v1 --untracked-files=all": dirty })), /CLEAN_CANDIDATE/);
    }
    for (const remote of ["https://github.com/other/repo.git", "https://github.com.evil.example/duotapmobile/ApplyPack.git",
      "https://user@github.com/duotapmobile/ApplyPack.git", "https://github.com/duotapmobile/ApplyPack.git?x=y",
      "https://github.com/duotapmobile/ApplyPack.git/", "git@github.com:duotapmobile/ApplyPack.git"]) {
      assert.throws(() => collectRecoverySourceIdentity(dir, fakeGit({ "remote get-url origin": remote })), /WRONG_REPOSITORY/);
    }
    assert.throws(() => collectRecoverySourceIdentity(dir, fakeGit({ "rev-parse --show-toplevel": tempBase })), /WRONG_REPOSITORY/);
    assert.throws(() => collectRecoverySourceIdentity(dir, () => ({ status: 1, stdout: "" })), /GIT_IDENTITY_UNAVAILABLE/);
  } finally {
    assert.ok(resolve(dir).startsWith(`${tempBase}${sep}applypack-recovery-unit-`));
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [name, results, expected] of [
  ["success", [{ status: 0, stdout: "ROLLBACK_OK" }, { status: 0 }, { status: 0, stdout: "RESTORE_OK" }], 0],
  ["rollback failure still resets", [{ status: 8, stdout: "" }, { status: 0 }, { status: 0, stdout: "RESTORE_OK" }], 8],
  ["missing rollback sentinel", [{ status: 0, stdout: "ROLLBACK_FAILED" }, { status: 0 }, { status: 0, stdout: "RESTORE_OK" }], 1],
  ["reset failure is fatal", [{ status: 0, stdout: "ROLLBACK_OK" }, { status: 9 }], 9],
  ["restore failure", [{ status: 0, stdout: "ROLLBACK_OK" }, { status: 0 }, { status: 10, stdout: "" }], 10],
  ["missing restore sentinel", [{ status: 0, stdout: "ROLLBACK_OK" }, { status: 0 }, { status: 0, stdout: "RESTORE_FAILED" }], 1],
  ["rollback spawn failure still resets", [{ status: null, error: new Error("synthetic spawn failure"), stdout: "" }, { status: 0 }, { status: 0, stdout: "RESTORE_OK" }], 1],
]) {
  test(`shared structural recovery ${name}`, () => {
    const calls = [];
    const status = runStructuralDatabaseRecovery({ run: (command, args, stdin) => {
      calls.push({ command, args, stdin });
      return results[calls.length - 1];
    } });
    assert.equal(status, expected);
    assert.equal(calls.length, results.length);
    assert.equal(calls[0].command, "docker");
    assert.ok(calls[0].args.includes("supabase_db_applypack"));
    assert.deepEqual(calls[1], { command: "supabase", args: ["db", "reset", "--local"], stdin: undefined });
    if (calls[2]) {
      assert.match(calls[2].stdin, /ap_upgrade_completed_intake_legal_acceptance/);
      assert.match(calls[2].stdin, /requiredSchemaVersion'='202610250095'/);
      assert.match(calls[2].stdin, /STAGING_REHEARSAL_CHECKOUT_ATTEMPTS/);
      assert.match(calls[2].stdin, /SANDBOX_VALIDATION_LAUNCH_ACTIVATION/);
      assert.match(calls[2].stdin, /MATERIAL_DRAFT_PAIR_WORKFLOW/);
      assert.match(calls[2].stdin, /MATERIAL_RULE_REVALIDATION/);
      assert.match(calls[2].stdin, /SOURCE_AWARE_DOCUMENT_ACCEPTANCE/);
      assert.match(calls[2].stdin, /ap_source_aware_document_schema_installed/);
      assert.match(calls[2].stdin, /ap_material_rule_revalidation_schema_installed/);
      assert.match(calls[2].stdin, /ap_material_draft_pair_schema_installed/);
      assert.match(calls[2].stdin, /ap_material_draft_runtime where singleton and not enabled/);
      assert.match(calls[2].stdin, /supabase_migrations.schema_migrations/);
    }
  });
}

test("CI runs mandatory structural recovery without pretending that human hosted recovery was approved", () => {
  const workflow = yaml.load(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
  const gate = workflow.jobs.database.steps.find((step) => step.run === "node scripts/check-launch-recovery-strategy.mjs --structural-only");
  assert.ok(gate);
  assert.equal(gate.if, undefined);
  assert.equal(gate["continue-on-error"], undefined);
  assert.equal(gate.env, undefined);
  const rollback = readFileSync(new URL("./run-supabase-rollback-test.mjs", import.meta.url), "utf8");
  assert.match(rollback, /process\.exitCode = runStructuralDatabaseRecovery\(\)/);
  assert.match(rollback, /Rollback target must be a distinct reviewed committed application/);
  const manifestGuard = readFileSync(new URL("./lib/ProductionDatabaseGuard.ps1", import.meta.url), "utf8");
  assert.match(manifestGuard, /PRODUCTION_RECOVERY_EVIDENCE_REQUIRED/);
  assert.match(manifestGuard, /offMachineRecoveryReference/);
  assert.match(manifestGuard, /acceptedRecoveryTimeMinutes -gt 240/);
  assert.match(manifestGuard, /acceptedDataLossMinutes -gt 15/);
});

test("structural CI success explicitly retains hosted gates and every structural failure fails", () => {
  const logs = [];
  assert.equal(executeStructuralCiRecovery({ runStructural: () => 0, log: (message) => logs.push(message) }), 0);
  assert.match(logs.join(""), /Hosted migration is not authorized/);
  assert.match(logs.join(""), /RTO <=240 minutes\/RPO <=15 minutes remain mandatory/);
  for (const status of [1, 7, null, undefined, -1]) {
    assert.notEqual(executeStructuralCiRecovery({ runStructural: () => status,
      log: () => assert.fail("failed structure must never claim success") }), 0);
  }
});

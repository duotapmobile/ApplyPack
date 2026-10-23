import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const root = process.cwd();
const prefix = "docs/evidence/launch-execution-2026-10-22/";
const base = `${prefix}recovery-ci-continuation/`;
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const read = (name) => JSON.parse(readFileSync(name, "utf8").replace(/^\uFEFF/, ""));
const write = (name, value) => writeFileSync(base + name, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const bind = (file) => ({ path: file, bytes: readFileSync(file).length, sha256: hash(file) });
const verify = ({ path, bytes, sha256 }) => {
  assert.equal(hash(path), sha256, path);
  if (bytes !== undefined) assert.equal(readFileSync(path).length, bytes, path);
};
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 }).trim();
assert.equal(git("rev-parse", "--show-toplevel").replaceAll("\\", "/"), "C:/Users/mskir/Desktop/Apply_Pack/applypack-production-v2");
assert.equal(git("remote", "get-url", "origin"), "https://github.com/duotapmobile/ApplyPack.git");
assert.equal(git("rev-parse", "HEAD"), "a3de4a447d499fb7d416e1a1d167e281372903b2");
execFileSync("git", ["diff", "--check"], { encoding: "utf8", windowsHide: true, stdio: "pipe" });
const baseline = read(prefix + "local-source-final.json");
const before = read(base + "source-before-validation.json");
execFileSync(process.execPath, [prefix + "capture-local-inputs.mjs", base + "source-final-reviewed.json"], { encoding: "utf8", windowsHide: true });
const current = read(base + "source-final-reviewed.json");
assert.deepEqual(current.files, read(base + "source-final.json").files, "source changed since initial collection");
assert.deepEqual(current.files, before.files, "source changed during continuation validation");
assert.equal(current.files.length, 739);
const previous = new Map(baseline.files.map((file) => [file.path, file]));
const now = new Map(current.files.map((file) => [file.path, file]));
const changed = current.files.filter((file) => previous.get(file.path)?.sha256 !== file.sha256)
  .map((file) => ({ path: file.path, before: previous.get(file.path) || null, after: file }));
assert.deepEqual(changed.map((file) => file.path).sort(), [".github/workflows/ci.yml", "docs/runbooks/LAUNCH_DATABASE_OPERATIONS.md",
  "scripts/check-launch-recovery-strategy.mjs", "scripts/check-launch-recovery-strategy.test.mjs",
  "scripts/lib/supabase-structural-recovery.mjs", "scripts/run-supabase-rollback-test.mjs",
  "tests/unit/manual-launch-hardening.test.ts"].sort());
assert.equal(baseline.files.filter((file) => !now.has(file.path)).length, 0);
const protectedFiles = read(prefix + "preexisting-work.json").files;
assert.equal(protectedFiles.length, 22);
protectedFiles.forEach(verify);
read(base + "focused-extraction-equivalence.json").files.forEach(verify);
const promotion = read(base + "focused-evidence-promotion.json");
assert.equal(promotion.status, "PASS_EXACT_FOCUSED_EVIDENCE_PROMOTION");
assert.equal(promotion.files.length, 19);
for (const item of promotion.files) {
  verify({ path: item.source, bytes: item.bytes, sha256: item.sha256 });
  verify({ path: item.destination, bytes: item.bytes, sha256: item.sha256 });
}
const focused = read(base + "focused-final-local-checks.json");
assert.equal(focused.status, "PASS_LOCAL_RECOVERY_STRATEGY_SUPPORT");
assert.deepEqual(focused.nodeTests, { total: 61, passed: 61, failed: 0, skipped: 0, exitCode: 0 });
assert.equal(focused.affectedVitest.passed, 19);
assert.equal(focused.affectedVitest.runnerExitCode, 0);
assert.equal(focused.affectedVitest.requiredResultsValidatorExitCode, 0);
assert.equal(focused.lintExitCode, 0);
assert.equal(focused.typecheckExitCode, 0);
focused.artifacts.forEach(verify);
const nodeLog = readFileSync(base + "focused-node-tests.log", "utf8");
for (const line of ["# tests 61", "# pass 61", "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0"]) assert.ok(nodeLog.includes(line));
const affected = read(base + "focused-manual-hardening-results.json");
assert.equal(affected.numTotalTests, 19);
assert.equal(affected.numPassedTests, 19);
assert.equal(affected.numFailedTests, 0);
assert.equal(affected.numPendingTests, 0);
assert.equal(affected.success, true);
const structural = read(base + "structural-20261023-attempt-01.json");
assert.equal(structural.status, "PASS_LOCAL_STRUCTURAL_SCHEMA_RECOVERY");
assert.equal(structural.process.exitCode, 0);
assert.equal(structural.process.terminal, true);
assert.equal(structural.process.signal, null);
assert.equal(structural.process.errorCode, null);
assert.deepEqual(structural.markers, { rollbackOk: true, restoreOk: true });
assert.equal(structural.sourceUnchanged, true);
assert.deepEqual(structural.sourceBefore, structural.sourceAfter);
structural.sourceAfter.forEach(verify);
for (const item of [structural.stdout, structural.stderr, structural.runner]) verify(item);
const actualOutput = readFileSync(structural.stdout.path, "utf8");
assert.ok(actualOutput.includes("ROLLBACK_OK") && actualOutput.includes("RESTORE_OK"));
assert.equal(structural.afterDatabase.mode, "LOCKED");
assert.equal(structural.afterDatabase.readiness.ready, true);
assert.equal(structural.afterDatabase.readiness.requiredSchemaVersion, "202610220085");
assert.deepEqual(structural.afterDatabase.readiness.requiredMigrations,
  ["202610040077", "202610040078", "202610040079", "202610040080", "202610190081", "202610190082", "202610190083", "202610190084", "202610220085"]);
assert.equal(structural.afterDatabase.migrationCount, 90);
assert.equal(structural.afterDatabase.invalidIndexes, 0);
assert.equal(structural.afterDatabase.activeOtherClientQueries, 0);
assert.ok(Object.values(structural.afterDatabase.data).every((count) => count === 0));
const imagePrefix = base + "image-attempt-02/";
const image = read(imagePrefix + "image-validation.json");
assert.equal(image.status, "PASS_LOCAL");
assert.equal(image.archiveAndScanIdentityVerified, true);
assert.equal(image.sourceInputCount, 379);
assert.equal(image.sourceChanges, 0);
assert.equal(image.smoke.status, "PASS");
assert.equal(image.smoke.teardownVerified, true);
assert.equal(image.scannerTeardownVerified, true);
assert.equal(image.scan.status, "PASS");
assert.equal(image.scan.highCriticalFindings, 0);
assert.equal(image.imagePushed, false);
const imageBefore = read(imagePrefix + "image-inputs-before.json");
const imageFinal = read(imagePrefix + "image-inputs-final.json");
assert.deepEqual(imageBefore.files, imageFinal.files);
imageFinal.files.forEach(verify);
assert.equal(image.sourceInventorySha256, imageFinal.inventorySha256);
const oldImage = read(prefix + "operations/launch-image-source-final.json");
const oldImageMap = new Map(oldImage.files.map((file) => [file.path, file]));
const imageDelta = imageFinal.files.filter((file) => oldImageMap.get(file.path)?.sha256 !== file.sha256);
assert.deepEqual(imageDelta.map((file) => file.path).sort(), ["scripts/check-launch-recovery-strategy.mjs",
  "scripts/check-launch-recovery-strategy.test.mjs", "scripts/lib/supabase-structural-recovery.mjs", "scripts/run-supabase-rollback-test.mjs"].sort());
assert.equal(hash(prefix + "PROVISIONAL_LOCAL_MANIFEST.json"), "5a4559b861a50e5697f50137977a37ddf41c279bf6a3758046c66d3fbbad9838");
assert.equal(hash(prefix + "reviews/post-manifest-independent-verification-2026-10-23.md"), "ae748c9d5256bab2598ef1543b775cb4b7e40ee8bee85921d7a45e55c98adf3e");

const files = [];
function enumerate(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) enumerate(file);
    else files.push(relative(root, file).replaceAll("\\", "/"));
  }
}
enumerate(base);
const rules = [
  ["aws-key-id", /(?:AKIA|ASIA)[A-Z0-9]{16}/g],
  ["stripe-secret", /(?:sk_live|rk_live|whsec)_[A-Za-z0-9]{20,}/g],
  ["github-token", /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ["database-password-url", /postgres(?:ql)?:\/\/[^\s:/]+:[^\s@/]+@/gi],
  ["jwt-shape", /eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g],
];
const findings = [];
const reviewedDispositions = [];
const preservedFixture = base + "focused-manual-hardening-before.ts.txt";
const preservedFixtureSha256 = "6f27e57c0c639cde209c24bb784dc88124be13143dee745ce87a5f30b1dc7615";
for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const [rule, pattern] of rules) {
    const count = [...content.matchAll(pattern)].length;
    if (count) findings.push({ path: file, rule, count });
    if (count && file === preservedFixture && rule === "database-password-url") {
      assert.equal(hash(file), preservedFixtureSha256, "fixture disposition only covers exact preserved bytes");
      const captures = [...content.matchAll(/postgres(?:ql)?:\/\/[^\s:/]+:([^\s@/]+)@/gi)];
      const templates = captures.filter((match) => ["${encodedPassword}", "${password}"].includes(match[1]));
      const literals = captures.filter((match) => !templates.includes(match));
      assert.equal(count, 33);
      assert.equal(templates.length, 31);
      assert.deepEqual(literals.map((match) => content.slice(0, match.index).split("\n").length), [537, 571]);
      for (const match of literals) assert.equal(createHash("sha256").update(match[1]).digest("hex"),
        "49e7fe32454e3248d317d70a771bc95559df96115fe9a01faca5972e0475c1d6");
      reviewedDispositions.push({ path: file, sha256: preservedFixtureSha256, rule, count,
        disposition: "PRESERVED_TEST_SOURCE_TEMPLATES_AND_DUMMY_LITERALS",
        sourceTemplateExpressions: templates.length, dummyLiteralCount: literals.length, dummyLiteralLines: [537, 571],
        rationale: "31 captures contain source interpolation expressions, not resolved credentials. Two explicit fake-password literals occur in tests with stubbed process spawning. Exact original bytes are retained; this disposition applies only to this path, hash, rule and complete 33-match set." });
    }
  }
}
const unresolvedFindings = findings.filter((finding) => !reviewedDispositions.some((item) => item.path === finding.path && item.rule === finding.rule && item.count === finding.count));
assert.equal(reviewedDispositions.length, 1);
write("hygiene-check-reviewed.json", { status: unresolvedFindings.length ? "FAIL" : "PASS_SCOPED_SIGNATURE_SCAN_WITH_REVIEWED_TEST_SOURCE",
  observedAt: new Date().toISOString(), initialFailedScan: bind(base + "hygiene-check.json"), files: files.sort().map(bind), findings,
  reviewedDispositions, unresolvedFindings,
  limitation: "Bounded text credential signatures only, not exhaustive PII/publication approval. This receipt, subsequent handoff/manifest and later independent review are outside the scanned snapshot." });
assert.equal(unresolvedFindings.length, 0, "inspect unresolved scoped hygiene findings without printing matched values");
write("source-delta.json", { status: "PASS_EXPECTED_SEVEN_FILE_DELTA", baseline: bind(prefix + "local-source-final.json"),
  current: bind(base + "source-final-reviewed.json"), changed, removed: [], sourceCount: current.files.length,
  unchangedBaselineFiles: baseline.files.length - changed.filter((file) => file.before).length,
  protectedFiles: protectedFiles.length, protectedFilesUnchanged: true, imageInputDelta: imageDelta,
  reuse: "Earlier application/browser/SQL/font/helper proofs retain their dated scope. No application, migration, dependency, font or renderer source changed. Nineteen affected unit cases were replayed; 61 recovery-gate tests and actual shared structural SQL execution cover the tooling delta. The prior image is superseded by this new exact-image build/smoke/scan." });
const handoff = `# Recovery CI continuation handoff\n\n**NOT READY.** Local implementation remains uncommitted; human assignments remain deferred. No candidate, remote CI run, recovery approval, hosted/provider change, payment or public activation is claimed.\n\nThe continuation closed a concrete gap: CI previously required a rollback SHA even when the launch plan allowed reviewed forward recovery. It now accepts either the strict compatible-commit path or a reviewed forward plan bound to the exact clean candidate, schema and migration bytes. Mandatory local structural SQL recovery remains in both paths. Controlled GitHub configuration carries human statements; the parser does not authenticate people or prove the linked reviews or hosted recovery.\n\nPassed: 61 recovery-gate Node tests, 19 affected existing unit tests, lint/typecheck, unchanged strict/SQL extraction checks, and actual disposable-database rollback/reset with both required markers. The database returned to schema 085, 90 migrations, the exact nine-ID readiness contract and LOCKED state, with empty operational data and no invalid indexes.\n\nThe updated image ${image.imageId} passed isolated nonroot/read-only startup and the exact-archive offline scan with zero HIGH/CRITICAL findings. All ${image.sourceInputCount} image inputs and ${current.files.length} source inputs stayed fixed through validation. The scan uses the separately recorded pinned scanner/database; this is a public-placeholder local build, not a deployed release. The first offline build failed because pinned public source retrieval had no network; it is preserved. The passing build used normal dependency retrieval; runtime and scanner checks used network none.\n\nOnly seven implementation files changed from the earlier local snapshot; all 22 protected user files remain byte-identical. Earlier 801-test/43-replay, 351-browser, integration, schema and rendering evidence remains dated proof under the explicit dependency assessment in source-delta.json. The 19 tests are overlapping replays, not additional unique application tests. The original provisional manifest and handoff remain preserved snapshots; use this continuation manifest for the newer tooling and image.\n\nRelease still requires a committed reviewed candidate, exact-candidate CI, actual recovery-strategy approval and protected object/key/auth/off-machine recovery, named people, scoped provider approvals, hosted journeys, human document/accessibility/device acceptance, and separate production/canary/public authorization. Local structural recovery supplies none of those approvals.\n\nCurrent operating instructions: docs/runbooks/LAUNCH_DATABASE_OPERATIONS.md and docs/runbooks/LAUNCH_OPERATIONS_INDEX.md.\n`;
writeFileSync(base + "LOCAL_HANDOFF.md", handoff, { flag: "wx" });
const records = [...files, base + "hygiene-check-reviewed.json", base + "source-delta.json", base + "LOCAL_HANDOFF.md"].sort().map(bind);
write("CONTINUATION_MANIFEST.json", { schemaVersion: 1, observedAt: new Date().toISOString(), status: "PASS_LOCAL_NOT_READY",
  baselineGitSha: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"), candidateGitSha: null, candidateFrozen: false,
  baselineManifest: bind(prefix + "PROVISIONAL_LOCAL_MANIFEST.json"), baselineReview: bind(prefix + "reviews/post-manifest-independent-verification-2026-10-23.md"),
  sourceInventory: bind(base + "source-final-reviewed.json"), sourceDelta: bind(base + "source-delta.json"), evidence: records,
  localResults: { recoveryGateTests: 61, affectedUnitReplays: 19, structuralSchemaRecovery: "PASS", imageId: image.imageId,
    imageConfigDigest: image.imageConfigDigest, highCriticalImageFindings: 0, sourceInputs: 739, imageInputs: 379, protectedFilesUnchanged: 22 },
  realApprovalOrHostedRecovery: false, cleanCiExecuted: false, deploymentOrPublication: false,
  limitations: ["Exact candidate and human roles/approvals remain unresolved", "CI approval plan binding is not protected recovery proof",
    "Original baseline manifest describes earlier source/image bytes", "Evidence scan is scoped and not publication approval",
    "A later independent review sidecar is intentionally outside this nonrecursive manifest"] });
console.log("PASS_LOCAL_CONTINUATION_MANIFEST_NOT_READY");

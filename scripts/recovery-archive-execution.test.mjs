import assert from "node:assert/strict";
import test from "node:test";
import { canonicalSha256 } from "./lib/protected-recovery-core.mjs";
import { buildAuthenticatedRetentionPlan, createRetentionVersionDeleter, executeProtectedRecoveryRetention } from "./lib/protected-recovery-retention-execute.mjs";

const now = Date.parse("2026-11-04T00:00:00.000Z");
const releaseSha = "a".repeat(40); const runId = "f9800000-0000-4000-8000-000000000001";
const time = (offset) => new Date(now + offset).toISOString();
import { archiveExecutionFixture as fixture } from "./archive-execution-test-fixture.mjs";
async function plan(f) { return buildAuthenticatedRetentionPlan({ ...f, proof: await f.evidenceReader.read({ signal: AbortSignal.timeout(2000) }), releaseSha, now }); }

test("finite expired unpinned versions and their old mapping are proposed together, with the current checkpoint preserved", async () => {
  const f = fixture(); const p = await plan(f);
  assert.deepEqual(p.plan.removals.map((v) => v.versionId).sort(), ["manifest-v1", "object-v1"]);
  assert.equal(p.plan.databaseDeletionAuthorized, false); assert.equal(p.digest, canonicalSha256(p.plan));
  assert(p.plan.retained.some((v) => v.versionId === "current-file-v1"));
});
for (const [name, options] of [
  ["retained database snapshot", { databasePin: true }], ["current checkpoint references", { currentReferencesOld: true }],
  ["young historical manifest", { youngHistory: true }], ["unbounded historical ownership", { unbounded: true }], ["active shared/support hold", { held: true }],
]) test(`${name} retains bytes and does not leave a dangling kept manifest`, async () => {
  const result = await plan(fixture(options)); assert.equal(result.plan.removals.some((v) => v.key.startsWith("objects/")), false);
  // When the current verified manifest keeps the same exact version, an old
  // duplicate mapping can expire without breaking recovery or removing bytes.
  if (!options.currentReferencesOld) assert.equal(result.plan.removals.some((v) => v.versionId === "manifest-v1"), false);
});
test("an imported proof and a changed live graph cannot authorize a proposal", async () => {
  const f = fixture(); const proof = await f.evidenceReader.read({ signal: AbortSignal.timeout(2000) });
  assert.throws(() => buildAuthenticatedRetentionPlan({ ...f, proof: { ...proof }, releaseSha, now }), /AUTHENTICATED_PROOF_REQUIRED/u);
  f.second.inventoryDigest = "f".repeat(64);
  assert.throws(() => buildAuthenticatedRetentionPlan({ ...f, proof, releaseSha, now }));
});
test("different/stale application checkpoint cannot authorize a proposal", async () => {
  for (const mutate of [(f) => { f.checkpoint.manifestVersionId = "other"; }, (f) => { f.run.started_at = time(-300001); },
    (f) => { f.checkpoint.sourceStartedAt = time(-600001); }]) { const f = fixture(); mutate(f); await assert.rejects(plan(f)); }
});

function execution(f, options = {}) {
  const durable = { run: structuredClone(f.run), versions: new Map(), calls: [] }; let inventories = 0;
  const lifecycle = {
    async begin() { durable.calls.push("begin"); if (options.unknownBegin) throw new Error("unknown begin"); return durable.run; },
    async inventory() { return inventories++ ? f.second : f.first; }, async checkpoint() { return f.checkpoint; },
    async plan({ plan: proposal, digest }) { durable.calls.push("plan"); durable.run = { ...durable.run, state: "PLANNED", plan_sha256: digest };
      for (const item of proposal.removals) durable.versions.set(`${item.key}:${item.versionId}`, { run_id: runId, archive_key: item.key,
        version_id: item.versionId, identity_sha256: item.identitySha256, state: "PLANNED" });
      if (options.unknownPlan) throw new Error("unknown plan"); return durable.run; },
    async dispatch({ key, versionId }) { durable.calls.push("dispatch"); if (options.latePayment) throw new Error("payment requires reconciliation");
      const item = durable.versions.get(`${key}:${versionId}`); assert.equal(item.state, "PLANNED"); item.state = "DISPATCHED"; durable.run.state = "DISPATCHING";
      if (options.unknownDispatch) throw new Error("unknown dispatch"); return item; },
    async observe({ key, versionId }) { durable.calls.push("observe"); const item = durable.versions.get(`${key}:${versionId}`); item.state = "ABSENT";
      if (options.unknownObservation) throw new Error("unknown observation"); return item; },
    async finish({ cancel, planSha256 }) { durable.calls.push(cancel ? "cancel" : "finish");
      if (durable.run.plan_sha256 !== undefined && durable.run.plan_sha256 !== planSha256) throw new Error("plan mismatch");
      if ([...durable.versions.values()].some((v) => v.state === "DISPATCHED")) durable.run.state = "RECONCILIATION_REQUIRED";
      else durable.run.state = cancel ? "CANCELED" : "COMPLETE";
      if (options.unknownFinish && !cancel) throw new Error("unknown completion"); return durable.run; },
  };
  return { durable, args: { lifecycle, evidenceReader: f.evidenceReader, deleter: createRetentionVersionDeleter(f.s3), releaseSha, runId, now: () => now } };
}
test("actual SDK exact-version deletion is followed by complete observed absence before durable success", async () => {
  const f = fixture(); const { args, durable } = execution(f); const result = await executeProtectedRecoveryRetention(args);
  assert.equal(result.status, "EXACT_VERSIONS_ABSENT"); assert.equal(result.deletedVersionCount, 2); assert.equal(result.databaseDeletionPerformed, false);
  assert.equal(durable.run.state, "COMPLETE"); assert.equal(durable.calls.filter((v) => v === "observe").length, 2);
  const deletes = f.calls.filter((v) => v.constructor.name === "DeleteObjectCommand");
  assert.equal(deletes.length, 2); assert(deletes.every((v) => v.input.VersionId && !v.input.Key.startsWith("database/") && v.input.ExpectedBucketOwner === "838445019912"));
});
test("lost delete acknowledgement is reconciled by exact absence without issuing another deletion", async () => {
  const f = fixture({ lostDeleteResponse: true }); const { args } = execution(f);
  const result = await executeProtectedRecoveryRetention(args); assert.equal(result.deletedVersionCount, 2);
  assert.equal(f.calls.filter((v) => v.constructor.name === "DeleteObjectCommand").length, 2);
});
for (const [name, options, expectedState] of [
  ["lost dispatch response", { unknownDispatch: true }, "DISPATCHING"],
  ["lost plan response", { unknownPlan: true }, "CANCELED"],
  ["late verified payment", { latePayment: true }, "PLANNED"],
  ["lost observation response", { unknownObservation: true }, "DISPATCHING"],
]) test(`${name} never retries or fabricates successful completion`, async () => {
  const f = fixture(); const { args, durable } = execution(f, options);
  await assert.rejects(executeProtectedRecoveryRetention(args), /RECONCILIATION_REQUIRED/u);
  assert.equal(durable.run.state, expectedState); assert(!durable.calls.includes("finish"));
  assert(durable.calls.filter((v) => v === "dispatch").length <= 1);
  if (options.unknownDispatch || options.latePayment) {
    // A thrown dispatch result cannot distinguish rollback from commit. Leave
    // the exact persisted state fenced for read-only restart reconciliation.
    assert(!durable.calls.includes("cancel"));
    assert.equal(f.calls.filter((v) => v.constructor.name === "DeleteObjectCommand").length, 0);
  }
});
test("delete acknowledgement with version still present keeps the fence locked", async () => {
  const f = fixture({ keepDeleted: true }); const { args, durable } = execution(f);
  await assert.rejects(executeProtectedRecoveryRetention(args)); assert.equal(durable.run.state, "DISPATCHING"); assert(!durable.calls.includes("cancel"));
});
test("deadline during an unconfirmed begin leaves the durable state for reconciliation", async () => {
  const f = fixture(); const { args, durable } = execution(f); args.lifecycle.begin = () => new Promise(() => {});
  await assert.rejects(executeProtectedRecoveryRetention({ ...args, maximumRunMilliseconds: 10 })); assert.deepEqual(durable.calls, []);
});
test("exact-version transport rejects database scope, unversioned and malformed deletion", async () => {
  let calls = 0; const deleter = createRetentionVersionDeleter({ send: async () => { calls++; } });
  for (const [key, versionId] of [[`database/dumps/${"a".repeat(64)}.dump`, "v1"], [`manifests/${"a".repeat(64)}.json`, "null"], ["objects/../private", "v1"]]) {
    await assert.rejects(deleter.remove({ key, versionId, signal: AbortSignal.timeout(1000) }));
  }
  assert.equal(calls, 0);
});

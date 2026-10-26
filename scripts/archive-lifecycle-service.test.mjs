import assert from "node:assert/strict";
import test from "node:test";
import { archiveExecutionFixture } from "./archive-execution-test-fixture.mjs";
import { createArchiveLifecycleService } from "./lib/archive-lifecycle-service.mjs";
import { signRecoveryReceipt } from "./lib/protected-recovery-source.mjs";
import { canonicalSha256 } from "./lib/protected-recovery-core.mjs";
import { createRetentionVersionDeleter } from "./lib/protected-recovery-retention-execute.mjs";
import { runScopedArchiveRetention, reconcileScopedArchiveRetention } from "./lib/scoped-archive-retention.mjs";

const now = Date.parse("2026-11-04T00:00:00Z"); const releaseSha = "a".repeat(40);
const receiptSecret = "r".repeat(64); const runId = "f9800000-0000-4000-8000-000000000001";
function fixture(options = {}) {
  const f = archiveExecutionFixture(options); let inventoryReads = 0;
  f.first.receipt = signRecoveryReceipt(f.first, receiptSecret); f.second.receipt = signRecoveryReceipt(f.second, receiptSecret);
  const state = { run: structuredClone(f.run), versions: [], calls: [], writer: null };
  const store = {
    retentionBegin: async () => state.run,
    retentionStatus: async () => ({ run: structuredClone(state.run), coverageCurrent: true, versions: structuredClone(state.versions) }),
    retentionPlan: async (id, digest, proof, inventory, versions) => { state.calls.push("plan"); state.run = { ...state.run, state: "PLANNED", plan_sha256: digest, proof_sha256: proof, inventory_sha256: inventory };
      state.versions = versions.map((v) => ({ run_id: id, archive_key: v.key, version_id: v.versionId, identity_sha256: v.identitySha256, state: "PLANNED" })); return state.run; },
    retentionDispatch: async (id, key, versionId, digest) => { state.calls.push("dispatch"); assert.equal(digest, state.run.plan_sha256); const member = state.versions.find((v) => v.archive_key === key && v.version_id === versionId);
      assert.equal(member.state, "PLANNED"); member.state = "DISPATCHED"; state.run.state = "DISPATCHING"; return member; },
    retentionObserve: async (id, key, versionId, digest) => { state.calls.push("observe"); const member = state.versions.find((v) => v.archive_key === key && v.version_id === versionId);
      assert.equal(member.state, "DISPATCHED"); member.state = "ABSENT"; member.observation_sha256 = digest; return member; },
    retentionFinish: async (id, digest, cancel, receipt) => { state.calls.push(cancel ? "cancel" : "finish"); assert.equal(id, runId);
      assert.equal(digest, state.run.plan_sha256 ?? null);
      if (cancel) assert.equal(receipt, null);
      else { assert.equal(receipt.schemaVersion, "applypack-protected-recovery-retention-v1"); assert.equal(receipt.deletedVersionCount, state.versions.length);
        assert.equal(receipt.inventoryDigest, f.first.inventoryDigest); assert.equal(receipt.sourceStartedAt, state.run.started_at); state.receipt = receipt; }
      if (state.versions.some((v) => v.state === "DISPATCHED")) state.run.state = "RECONCILIATION_REQUIRED";
      else state.run.state = cancel ? "CANCELED" : "COMPLETE"; return state.run; },
    writerStatus: async () => state.writer,
    writerBegin: async (id, kind, release) => { state.calls.push("writerBegin"); state.writer = { id, kind, release_sha: release, state: "OPEN" }; return state.writer; },
    writerDispatch: async () => { state.calls.push("writerDispatch"); state.writer.provider_dispatched = true; return state.writer; },
    writerFinish: async () => { state.calls.push("writerFinish"); throw new Error("unexpected unverified writer completion"); },
  };
  const config = { enabled: true, releaseSha, schemaVersion: "202610250095", receiptSecret };
  const service = createArchiveLifecycleService({ store, evidenceReader: f.evidenceReader, configuration: config, now: () => now,
    readInventory: async () => structuredClone(inventoryReads++ === 0 ? f.first : f.second), readCheckpoint: async () => f.checkpoint });
  const execute = (action, values = {}, capability = "RETENTION", signal = AbortSignal.timeout(2000)) => service.execute({ action, runId, ...values }, { capability, signal });
  const lifecycle = Object.fromEntries(Object.entries({ begin: "RETENTION_BEGIN", prepare: "RETENTION_PREPARE", status: "RETENTION_STATUS",
    dispatch: "RETENTION_DISPATCH", observe: "RETENTION_OBSERVE", finish: "RETENTION_FINISH" }).map(([name, action]) => [name, ({ signal, runId: requestedRunId, ...rest }) => {
      assert.equal(requestedRunId, runId); return execute(action, rest, "RETENTION", signal);
    }]));
  return { ...f, state, store, service, config, execute, lifecycle };
}

test("server prepares exact authenticated plan and a delete-only worker completes independent absence checks", async () => {
  const f = fixture(); const result = await runScopedArchiveRetention({ lifecycle: f.lifecycle, deleter: createRetentionVersionDeleter(f.s3), runId, releaseSha, now: () => now });
  assert.equal(result.deletedVersionCount, 2); assert.equal(result.databaseDeletionPerformed, false); assert.equal(f.state.run.state, "COMPLETE");
  assert.deepEqual(f.state.calls, ["plan", "dispatch", "observe", "dispatch", "observe", "finish"]);
  const deletes = f.calls.filter((v) => v.constructor.name === "DeleteObjectCommand"); assert.equal(deletes.length, 2);
  assert.equal(f.state.receipt.retainedVersionCount, f.versions.length);
});
test("forged observation digest does not override provider evidence", async () => {
  const f = fixture(); const prepared = await f.execute("RETENTION_PREPARE"); const item = prepared.plan.removals[0];
  await f.execute("RETENTION_DISPATCH", { key: item.key, versionId: item.versionId, planSha256: prepared.digest });
  await assert.rejects(f.execute("RETENTION_OBSERVE", { key: item.key, versionId: item.versionId, observationSha256: "0".repeat(64) }), /ABSENCE_NOT_PROVEN/u);
  assert.equal(f.state.calls.includes("observe"), false); assert.equal(f.state.versions[0].state, "DISPATCHED");
});
test("a changed independent archive graph blocks plan acceptance before a delete permit", async () => {
  const f = fixture(); const prepared = await f.execute("RETENTION_PREPARE");
  f.state.run.state = "FENCED"; f.state.versions = []; f.state.calls = [];
  prepared.plan.removals[0].versionId = "invented-version";
  await assert.rejects(f.execute("RETENTION_PLAN", { firstReceipt: f.first.receipt, secondReceipt: f.second.receipt, plan: prepared.plan, digest: canonicalSha256(prepared.plan) }), /PLAN_NOT_INDEPENDENTLY_VERIFIED/u);
  assert.deepEqual(f.state.calls, []);
});
test("signed source receipts must be distinct, untampered and bound to current graph", async () => {
  for (const altered of ["tampered", "same"]) {
    const f = fixture(); const prepared = await f.execute("RETENTION_PREPARE"); f.state.run.state = "FENCED"; f.state.calls = [];
    await assert.rejects(f.execute("RETENTION_PLAN", { firstReceipt: f.first.receipt, secondReceipt: altered === "same" ? f.first.receipt : `${f.second.receipt}x`,
      plan: prepared.plan, digest: prepared.digest })); assert.deepEqual(f.state.calls, []);
  }
});
test("worker kinds cannot borrow each other's mutations or retention capability", async () => {
  const f = fixture();
  for (const capability of ["FILE_WRITER", "DATABASE_WRITER"]) await assert.rejects(f.execute("RETENTION_BEGIN", {}, capability), /CAPABILITY_FORBIDDEN/u);
  await assert.rejects(f.execute("WRITER_BEGIN", { kind: "DATABASE" }, "FILE_WRITER"), /WRITER_KIND/u);
  await f.execute("WRITER_BEGIN", { kind: "FILE" }, "FILE_WRITER");
  await assert.rejects(f.execute("WRITER_DISPATCH", {}, "DATABASE_WRITER"), /WRITER_KIND/u);
  assert.deepEqual(f.state.calls, ["writerBegin"]);
});
test("unknown fields, database deletion scope and disabled configuration fail before store mutation", async () => {
  const f = fixture();
  await assert.rejects(f.execute("RETENTION_BEGIN", { verified: true }), /REQUEST_INVALID/u);
  await assert.rejects(f.execute("RETENTION_DISPATCH", { key: `database/dumps/${"a".repeat(64)}.dump`, versionId: "v1", planSha256: "b".repeat(64) }), /REQUEST_INVALID/u);
  assert.throws(() => createArchiveLifecycleService({ configuration: { ...f.config, enabled: false } }), /DISABLED/u);
  assert.deepEqual(f.state.calls, []);
});
test("explicit process-restart reconciliation never redispatches a deletion", async () => {
  const f = fixture(); const prepared = await f.execute("RETENTION_PREPARE"); const item = prepared.plan.removals[0];
  await f.execute("RETENTION_DISPATCH", { key: item.key, versionId: item.versionId, planSha256: prepared.digest });
  await createRetentionVersionDeleter(f.s3).remove({ ...item, signal: AbortSignal.timeout(2000) });
  const result = await reconcileScopedArchiveRetention({ lifecycle: f.lifecycle, runId, releaseSha, now: () => now });
  assert.equal(result.status, "CANCELED_AFTER_EXACT_RECONCILIATION");
  assert.equal(f.calls.filter((v) => v.constructor.name === "DeleteObjectCommand").length, 1);
  assert.equal(f.state.calls.filter((v) => v === "dispatch").length, 1);
});
test("restart reconciliation of a still-present unknown version leaves its fence locked", async () => {
  const f = fixture(); const prepared = await f.execute("RETENTION_PREPARE"); const item = prepared.plan.removals[0];
  await f.execute("RETENTION_DISPATCH", { key: item.key, versionId: item.versionId, planSha256: prepared.digest });
  await assert.rejects(reconcileScopedArchiveRetention({ lifecycle: f.lifecycle, runId, releaseSha, now: () => now }), /ABSENCE_NOT_PROVEN/u);
  assert.equal(f.state.run.state, "DISPATCHING"); assert.equal(f.state.calls.includes("cancel"), false);
});

test("interruption after deleting the first mapping cannot strand any retained manifest", async () => {
  const f = fixture(); const dispatch = f.lifecycle.dispatch; let count = 0;
  f.lifecycle.dispatch = async (input) => { if (++count === 2) throw new Error("new verified webhook blocks dispatch"); return dispatch(input); };
  await assert.rejects(runScopedArchiveRetention({ lifecycle: f.lifecycle, deleter: createRetentionVersionDeleter(f.s3), runId, releaseSha, now: () => now }));
  const deleted = f.calls.filter((v) => v.constructor.name === "DeleteObjectCommand");
  assert.equal(deleted.length, 1); assert.ok(deleted[0].input.Key.startsWith("manifests/"));
  await reconcileScopedArchiveRetention({ lifecycle: f.lifecycle, runId, releaseSha, now: () => now });
  assert.equal(f.state.run.state, "CANCELED");
  for (const file of [f.f.file, f.currentFile]) {
    if (!f.versions.some((v) => v.key === file.key && v.versionId === file.versionId)) continue;
    for (const entry of file.manifest.entries) assert.ok(f.versions.some((v) => v.key === entry.archiveKey && v.versionId === entry.archiveVersionId));
  }
  assert.ok(f.versions.some((v) => v.key.startsWith("objects/")), "unmapped bytes stay preserved after partial cancellation");
});

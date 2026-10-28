import assert from "node:assert/strict";
import test from "node:test";
import { runRegisteredArchiveWriter } from "./lib/archive-writer-run.mjs";

const runId = "f9800000-0000-4000-8000-000000000002"; const releaseSha = "a".repeat(40);
function fixture(kind = "FILE") {
  const calls = []; let row; const result = { manifestSha256: "b".repeat(64), manifestVersionId: "exact-v1" };
  const lifecycle = { releaseSha,
    async begin() { calls.push("begin"); row = { id: runId, kind, release_sha: releaseSha, state: "OPEN", provider_dispatched: false }; return structuredClone(row); },
    async dispatch() { calls.push("dispatch"); row.provider_dispatched = true; return structuredClone(row); },
    async complete() { calls.push("complete"); row = { ...row, state: "COMPLETE", result_sha256: "c".repeat(64),
      completion_receipt: { runId, kind, releaseSha, ...result } }; return structuredClone(row); },
    async status() { calls.push("status"); return structuredClone(row); },
    async cancel() { calls.push("cancel"); row.state = "CANCELED"; return structuredClone(row); },
  };
  const execute = async ({ signal, remainingMilliseconds }) => { assert.equal(signal.aborted, false); assert.ok(remainingMilliseconds() > 0); calls.push("execute"); return result; };
  return { lifecycle, execute, calls, result, options: { lifecycle, kind, releaseSha, runId, execute }, row: () => row };
}
for (const kind of ["FILE", "DATABASE"]) test(`${kind} is fenced before source/provider access and succeeds only after exact server completion`, async () => {
  const f = fixture(kind); const result = await runRegisteredArchiveWriter(f.options);
  assert.deepEqual(f.calls, ["begin", "dispatch", "execute", "complete"]); assert.equal(result.completionReceiptSha256, "c".repeat(64));
});
test("lost begin response can cancel only a read-confirmed never-dispatched run", async () => {
  const f = fixture(); const begin = f.lifecycle.begin; f.lifecycle.begin = async () => { await begin(); throw new Error("lost"); };
  await assert.rejects(runRegisteredArchiveWriter(f.options), /lost/u);
  assert.deepEqual(f.calls, ["begin", "status", "cancel"]); assert.equal(f.row().state, "CANCELED");
});
test("lost dispatch response leaves its writer OPEN without cancellation or provider work", async () => {
  const f = fixture(); const dispatch = f.lifecycle.dispatch; f.lifecycle.dispatch = async () => { await dispatch(); throw new Error("lost"); };
  await assert.rejects(runRegisteredArchiveWriter(f.options)); assert.deepEqual(f.calls, ["begin", "dispatch"]);
  assert.equal(f.row().state, "OPEN"); assert.equal(f.row().provider_dispatched, true);
});
test("source/provider failure after dispatch preserves the non-expiring writer fence", async () => {
  const f = fixture(); f.options.execute = async () => { throw new Error("failed upload"); };
  await assert.rejects(runRegisteredArchiveWriter(f.options)); assert.deepEqual(f.calls, ["begin", "dispatch"]); assert.equal(f.row().state, "OPEN");
});
test("lost completion response is reconciled by one exact immutable read without mutation retry", async () => {
  const f = fixture(); const complete = f.lifecycle.complete; f.lifecycle.complete = async () => { await complete(); throw new Error("lost"); };
  await runRegisteredArchiveWriter(f.options); assert.deepEqual(f.calls, ["begin", "dispatch", "execute", "complete", "status"]);
});
test("an uploaded manifest with unconfirmed completion never returns success", async () => {
  const f = fixture(); f.lifecycle.complete = async () => { f.calls.push("complete"); throw new Error("not committed"); };
  await assert.rejects(runRegisteredArchiveWriter(f.options), /COMPLETION_UNCONFIRMED/u);
  assert.equal(f.row().state, "OPEN"); assert.equal(f.calls.includes("cancel"), false);
});
for (const field of ["manifestVersionId", "manifestSha256", "releaseSha", "runId", "kind"]) test(`completion mismatched ${field} is rejected`, async () => {
  const f = fixture(); const complete = f.lifecycle.complete; f.lifecycle.complete = async () => { const row = await complete(); row.completion_receipt[field] = "wrong"; return row; };
  await assert.rejects(runRegisteredArchiveWriter(f.options), /COMPLETION_UNCONFIRMED/u); assert.equal(f.calls.includes("cancel"), false);
});
test("a stalled mutation is bounded and cannot start source work after timeout", async () => {
  const f = fixture(); f.lifecycle.dispatch = async () => new Promise(() => {});
  await assert.rejects(runRegisteredArchiveWriter({ ...f.options, maximumRunMilliseconds: 10 }), /TIMEOUT/u);
  assert.deepEqual(f.calls, ["begin"]); assert.equal(f.row().state, "OPEN");
});

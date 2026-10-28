import assert from "node:assert/strict";
import test from "node:test";
import { createArchiveLifecycleHttpTransport } from "./lib/archive-lifecycle-transport.mjs";
import { archiveRetentionArguments, runArchiveRetention } from "./run-protected-recovery-retention.mjs";
const sha = "a".repeat(40); const id = "f9800000-0000-4000-8000-000000000002";
const env = { APP_ARCHIVE_LIFECYCLE_ENABLED: "true", APP_DEPLOYMENT_ENV: "production", APP_BASE_URL: "https://applypack.work",
  APP_EXPECTED_RELEASE_SHA: sha, RAILWAY_GIT_COMMIT_SHA: sha, APP_RECOVERY_COMPLETION_SECRET: "f".repeat(64),
  APP_DATABASE_BACKUP_LIFECYCLE_SECRET: "d".repeat(64), APP_RECOVERY_RETENTION_SECRET: "r".repeat(64) };
for (const [kind, secret] of [["FILE", "f"], ["DATABASE", "d"], ["RETENTION", "r"]]) test(`${kind} transport pins exact origin and capability with no cookie/redirect/retry`, async () => {
  const calls = []; const transport = createArchiveLifecycleHttpTransport(env, kind, async (url, options) => { calls.push({ url, options }); return Response.json({ id }); });
  const signal = AbortSignal.timeout(1000); await transport.begin({ runId: id, signal });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://applypack.work/api/internal/archive-lifecycle");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${secret.repeat(64)}`);
  assert.equal(calls[0].options.redirect, "error"); assert.equal(calls[0].options.credentials, "omit"); assert.equal(calls[0].options.signal, signal);
  assert.equal(JSON.stringify(JSON.parse(calls[0].options.body)).includes(secret.repeat(64)), false);
});
for (const change of [{ APP_ARCHIVE_LIFECYCLE_ENABLED: "false" }, { APP_DEPLOYMENT_ENV: "staging" }, { APP_BASE_URL: "https://elsewhere.invalid" },
  { APP_EXPECTED_RELEASE_SHA: "b".repeat(40) }, { APP_RECOVERY_RETENTION_SECRET: "short" }]) test(`transport rejects ${Object.keys(change)[0]} before network`, () => {
  assert.throws(() => createArchiveLifecycleHttpTransport({ ...env, ...change }, "RETENTION", () => { throw new Error("network forbidden"); }), /CONFIGURATION/u);
});
test("mutation transport failure makes exactly one call and suppresses private diagnostics", async () => {
  let calls = 0; const transport = createArchiveLifecycleHttpTransport(env, "FILE", async () => { calls++; throw new Error("private secret diagnostics"); });
  await assert.rejects(transport.dispatch({ runId: id, signal: AbortSignal.timeout(1000) }), /^Error: ARCHIVE_LIFECYCLE_HTTP_TRANSPORT$/u); assert.equal(calls, 1);
});
test("execution CLI is separate, default-disabled and rejects injected target arguments", async () => {
  assert.deepEqual(archiveRetentionArguments([]), { reconcileRunId: null });
  assert.deepEqual(archiveRetentionArguments(["--reconcile", id]), { reconcileRunId: id });
  for (const args of [["--bucket", "other"], ["--manifest-evidence", "private.json"], ["--reconcile", "bad"]]) assert.throws(() => archiveRetentionArguments(args));
  await assert.rejects(runArchiveRetention({}, {}, { createLifecycle: () => { throw new Error("must not initialize"); } }), /DISABLED/u);
});
test("explicit reconciliation cannot create an AWS delete client or repeat a mutation", async () => {
  const lifecycle = { releaseSha: sha, status: async () => ({ run: { id, release_sha: sha, state: "CANCELED" }, versions: [] }) };
  const result = await runArchiveRetention({ APP_ARCHIVE_RETENTION_EXECUTION_ENABLED: "true", APP_ARCHIVE_LIFECYCLE_ENABLED: "true" }, { reconcileRunId: id },
    { createLifecycle: () => lifecycle, createDeleter: () => { throw new Error("delete capability forbidden during reconciliation"); } });
  assert.equal(result.status, "CANCELED");
});
test("retention process refuses writer, verifier and database secrets", async () => {
  for (const name of ["APP_RECOVERY_COMPLETION_SECRET", "APP_DATABASE_BACKUP_DB_PASSWORD", "APP_ARCHIVE_VERIFIER_AWS_RA_PRIVATE_KEY_PEM_BASE64"])
    await assert.rejects(runArchiveRetention({ APP_ARCHIVE_RETENTION_EXECUTION_ENABLED: "true", APP_ARCHIVE_LIFECYCLE_ENABLED: "true", [name]: "private" }), /OTHER_CAPABILITY/u);
});

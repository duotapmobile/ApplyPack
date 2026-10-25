import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { createRecoveryHttpTransport, boundedRecoveryJson } from "./lib/protected-recovery-transport.mjs";
import { createBootstrapReadOnlyFetch, createOperatorBootstrapSource } from "./lib/protected-recovery-bootstrap.mjs";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { recoverySourceColumns } from "./lib/protected-recovery-source.mjs";
import { runProtectedRecovery, sanitizedRecoveryFailure } from "./run-protected-recovery.mjs";
import { runBootstrapRecovery, readBootstrapCredential } from "./bootstrap-protected-recovery.mjs";

const SYNTHETIC_PROVIDER_KEY = "SYNTHETIC_PROVIDER_KEY_FOR_OFFLINE_TESTS_ONLY";
const RELEASE = "a".repeat(40);
const PROVIDER = "https://spjaaxndiduhrcleazwb.supabase.co";
const environment = () => ({ APP_DEPLOYMENT_ENV: "production", APP_BASE_URL: "https://applypack.work",
  APP_EXPECTED_RELEASE_SHA: RELEASE, RAILWAY_GIT_COMMIT_SHA: RELEASE,
  APP_RECOVERY_READER_SECRET: "a".repeat(64), APP_RECOVERY_COMPLETION_SECRET: "b".repeat(64) });
const signal = () => new AbortController().signal;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const emptyInventory = () => {
  const value = { schemaVersion: "applypack-protected-recovery-inventory-v2", sourceEnvironment: "production",
    sourceProjectRef: "spjaaxndiduhrcleazwb", releaseSha: RELEASE, startedAt: "2026-10-23T22:00:00.000Z",
    completedAt: "2026-10-23T22:00:00.001Z", buckets: [...RECOVERY_BUCKETS], objects: [], references: [], tombstones: [],
    counts: { objects: 0, references: 0, tombstones: 0, tables: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, 0])) },
    serviceRetention: { schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
      sourceWatermark: "1970-01-01T00:00:00.000Z", orders: [], holds: [], objectTombstones: [], objectPolicies: [] },
    receipt: "r".repeat(128) };
  value.inventoryDigest = recoveryInventoryDigest(value); return value;
};

test("fixed HTTP inventory sends only reader capability to the canonical production endpoint", async () => {
  const calls = [];
  const transport = createRecoveryHttpTransport(environment(), async (...args) => { calls.push(args); return json(emptyInventory()); });
  assert.equal((await transport.source.readInventory({ signal: signal() })).releaseSha, RELEASE);
  const [url, options] = calls[0];
  assert.equal(url, "https://applypack.work/api/internal/protected-recovery/inventory");
  assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
  assert.equal(options.headers.authorization, `Bearer ${environment().APP_RECOVERY_READER_SECRET}`);
  assert.equal(options.headers.cookie, undefined);
});
for (const [name, value] of [["APP_BASE_URL", "https://evil.example"], ["APP_DEPLOYMENT_ENV", "staging"],
  ["RAILWAY_GIT_COMMIT_SHA", "b".repeat(40)], ["APP_EXPECTED_RELEASE_SHA", "abc123"],
  ["APP_RECOVERY_COMPLETION_SECRET", "a".repeat(64)], ["APP_RECOVERY_READER_SECRET", "short"]]) {
  test(`refuses invalid runner binding ${name}`, () => {
    assert.throws(() => createRecoveryHttpTransport({ ...environment(), [name]: value }), /PROTECTED_RECOVERY_RUNNER_/u);
  });
}
for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "supabase_secret_key", "DATABASE_URL", "APP_RECOVERY_RECEIPT_SECRET", "CRON_SECRET"]) {
  test(`copy service refuses broader credential ${name}`, () => {
    assert.throws(() => createRecoveryHttpTransport({ ...environment(), [name]: "synthetic" }), /MASTER_CREDENTIAL_FORBIDDEN/u);
  });
}
test("object request is fixed and binds returned source version, size and SHA", async () => {
  const object = { bucket: RECOVERY_BUCKETS[0], key: "owner/file.docx", sourceVersion: "c".repeat(64), size: 3,
    expectedSha256: "d".repeat(64), retentionExpiresAt: null };
  const calls = [];
  const transport = createRecoveryHttpTransport(environment(), async (...args) => {
    calls.push(args); return new Response(Buffer.from("abc"), { headers: { "content-length": "3",
      "x-recovery-source-version": object.sourceVersion, "x-recovery-sha256": object.expectedSha256 } });
  });
  const opened = await transport.source.openObject({ ...object, signal: signal() });
  assert.equal(opened.sha256, object.expectedSha256);
  const url = new URL(calls[0][0]);
  assert.equal(url.pathname, "/api/internal/protected-recovery/object");
  assert.deepEqual([...url.searchParams.keys()], ["bucket", "key", "sourceVersion"]);
  await assert.rejects(transport.source.openObject({ ...object, key: "../escape", signal: signal() }), /HTTP_OBJECT_REQUEST/u);
});
test("wrong source version header is rejected before returned stream", async () => {
  const transport = createRecoveryHttpTransport(environment(), async () => new Response("abc", { headers: { "content-length": "3",
    "x-recovery-source-version": "f".repeat(64), "x-recovery-sha256": "d".repeat(64) } }));
  await assert.rejects(transport.source.openObject({ bucket: RECOVERY_BUCKETS[0], key: "owner/file", sourceVersion: "c".repeat(64),
    size: 3, expectedSha256: "d".repeat(64), retentionExpiresAt: null, signal: signal() }), /HTTP_OBJECT_IDENTITY/u);
});
test("completion uses separate capability and accepts no arbitrary fields", async () => {
  const calls = [];
  const transport = createRecoveryHttpTransport(environment(), async (...args) => { calls.push(args); return json({ ok: true }); });
  const input = { schemaVersion: "applypack-protected-recovery-completion-v1", firstReceipt: "a".repeat(128), secondReceipt: "b".repeat(128),
    manifestSha256: "c".repeat(64), manifestVersionId: "version-1", objectCount: 0, referenceCount: 0, tombstoneCount: 0 };
  await transport.completion.submit(input, { signal: signal() });
  assert.equal(calls[0][0], "https://applypack.work/api/internal/protected-recovery/complete");
  assert.equal(calls[0][1].headers.authorization, `Bearer ${environment().APP_RECOVERY_COMPLETION_SECRET}`);
  await assert.rejects(transport.completion.submit({ ...input, arbitrarySql: "no" }, { signal: signal() }), /HTTP_COMPLETION_REQUEST/u);
});
test("bounded JSON rejects oversized and invalid UTF-8 bodies", async () => {
  await assert.rejects(boundedRecoveryJson(json({ private: "x".repeat(100) }), 30), /HTTP_BODY_LIMIT/u);
  await assert.rejects(boundedRecoveryJson(new Response(Uint8Array.from([0xff]), { headers: { "content-type": "application/json" } }), 100), /HTTP_JSON/u);
  await assert.rejects(boundedRecoveryJson(json({}, 302), 100), /HTTP_RESPONSE/u);
});
test("transport errors never expose capability or URL contents", async () => {
  const transport = createRecoveryHttpTransport(environment(), async () => { throw new Error("private-secret-and-path"); });
  await assert.rejects(transport.source.readInventory({ signal: signal() }), { message: "PROTECTED_RECOVERY_HTTP_TRANSPORT" });
});

test("operator bootstrap uses installed SDK through the fixed read-only transport and enumerates every table and bucket", async () => {
  const calls = [];
  const source = createOperatorBootstrapSource({ supabaseKey: SYNTHETIC_PROVIDER_KEY, releaseSha: RELEASE,
    fetchImpl: async (url, options) => {
      calls.push([new URL(url), options]);
      if (new URL(url).pathname === "/storage/v1/bucket") return json(RECOVERY_BUCKETS.map((name) => ({ id: name, name, public: false })));
      return json([]);
    } });
  const inventory = await source.readInventory({ signal: signal() });
  assert.equal(inventory.objects.length, 0);
  assert.deepEqual(Object.keys(inventory.counts.tables), RECOVERY_TABLES);
  assert.equal(calls.filter(([url]) => url.pathname.startsWith("/rest/v1/")).length, RECOVERY_TABLES.length);
  assert.equal(calls.filter(([, options]) => options.method === "POST").length, 4);
  assert.ok(calls.every(([url, options]) => url.origin === PROVIDER && options.redirect === "error" && options.credentials === "omit"));
  assert.match(inventory.receipt, /^operator-bootstrap-not-server-attested:/u);
});
for (const [label, url, options] of [
  ["wrong project", "https://other.supabase.co/storage/v1/bucket", {}],
  ["delete", `${PROVIDER}/storage/v1/object/customer-deliveries`, { method: "DELETE" }],
  ["upload", `${PROVIDER}/storage/v1/object/customer-deliveries/file`, { method: "POST", body: "private" }],
  ["RPC", `${PROVIDER}/rest/v1/rpc/mutate`, { method: "POST", body: "{}" }],
  ["arbitrary table", `${PROVIDER}/rest/v1/auth.users`, {}],
  ["arbitrary select", `${PROVIDER}/rest/v1/intakes?select=*&order=id.asc&limit=250`, {}],
  ["unexpected cookie", `${PROVIDER}/storage/v1/bucket`, { headers: { cookie: "session=synthetic" } }],
  ["object list search", `${PROVIDER}/storage/v1/object/list/customer-deliveries`, { method: "POST", body: JSON.stringify({ limit: 100, offset: 0, sortBy: { column: "name", order: "asc" }, prefix: "", search: "hidden" }) }],
  ["list negative offset", `${PROVIDER}/storage/v1/object/list/customer-deliveries`, { method: "POST", body: JSON.stringify({ limit: 100, offset: -1, sortBy: { column: "name", order: "asc" }, prefix: "" }) }],
]) {
  test(`operator transport rejects ${label} before provider call`, async () => {
    let calls = 0; const read = createBootstrapReadOnlyFetch(async () => { calls++; return json([]); });
    await assert.rejects(read(url, options), /PROTECTED_RECOVERY_BOOTSTRAP_/u); assert.equal(calls, 0);
  });
}
test("operator table pagination permits only fixed selected columns, ordering and UUID cursor", async () => {
  const url = new URL(`${PROVIDER}/rest/v1/ap_document_versions`);
  url.searchParams.set("select", recoverySourceColumns.ap_document_versions); url.searchParams.set("order", "id.asc");
  url.searchParams.set("limit", "250"); url.searchParams.set("id", "gt.11111111-1111-4111-8111-111111111111");
  let calls = 0; const read = createBootstrapReadOnlyFetch(async () => { calls++; return json([]); });
  await read(url); assert.equal(calls, 1);
  url.searchParams.set("id", "lt.11111111-1111-4111-8111-111111111111");
  await assert.rejects(read(url), /MUTATION_OR_QUERY_FORBIDDEN/u); assert.equal(calls, 1);
});
test("bootstrap JSON input is bounded and never accepts additional credential fields", async () => {
  assert.equal(await readBootstrapCredential(Readable.from([Buffer.from('{"supabaseKey":"synthetic"}')])), "synthetic");
  await assert.rejects(readBootstrapCredential(Readable.from([Buffer.alloc(8193)])), /INPUT_LIMIT/u);
  await assert.rejects(readBootstrapCredential(Readable.from([Buffer.from('{"supabaseKey":"x","url":"evil"}')])), /INPUT_INVALID/u);
});
test("continuous runner reports only sanitized counters and closes destination", async () => {
  let closed = false;
  const report = await runProtectedRecovery(environment(), { createTransport: () => ({ source: {}, completion: {}, releaseSha: RELEASE }),
    createDestination: () => ({ archive: {}, readPreviousManifest: async () => null, close: () => { closed = true; } }),
    copy: async () => ({ manifest: { watermark: "2026-10-23T22:00:00Z", entries: [{ key: "private/person.docx" }], inventory: { references: [], tombstones: [] } }, manifestDigest: "f".repeat(64) }) });
  assert.equal(report.status, "COMPLETED"); assert.equal(closed, true); assert.equal(JSON.stringify(report).includes("private/person"), false);
});
test("continuous runner closes destination after failure and never reports completed", async () => {
  let closed = false;
  await assert.rejects(runProtectedRecovery(environment(), { createTransport: () => ({ source: {}, completion: {}, releaseSha: RELEASE }),
    createDestination: () => ({ archive: {}, readPreviousManifest: async () => null, close: () => { closed = true; } }),
    copy: async () => { throw new Error("SYNTHETIC_FAILURE"); } }), /SYNTHETIC_FAILURE/u);
  assert.equal(closed, true);
  assert.equal(sanitizedRecoveryFailure(new Error("secret private raw provider message")), "PROTECTED_RECOVERY_RUN_FAILED");
});
test("operator bootstrap archive cannot masquerade as an application completion", async () => {
  const env = { APP_RECOVERY_BOOTSTRAP_WRITERS_LOCKED: "true", APP_RECOVERY_BOOTSTRAP_SOURCE_SHA: RELEASE,
    APP_RECOVERY_BOOTSTRAP_DATABASE_EVIDENCE_SHA256: "e".repeat(64) };
  let sourceKey; let closed = false;
  const report = await runBootstrapRecovery({ environment: env, credentialStream: Readable.from([Buffer.from('{"supabaseKey":"synthetic-operator-key"}')]),
    dependencies: { createSource: ({ supabaseKey }) => { sourceKey = supabaseKey; return {}; },
      createDestination: () => ({ archive: {}, readPreviousManifest: async () => null, close: () => { closed = true; } }),
      archive: async (input) => {
        assert.equal(input.operatorBootstrap, true); assert.equal(input.completion, undefined);
        return { status: "BOOTSTRAP_ARCHIVED_WITHOUT_APPLICATION_CHECKPOINT", manifestDigest: "f".repeat(64), manifestVersionId: "v1",
          manifest: { watermark: "2026-10-23T22:00:00Z", entries: [] } };
      } } });
  assert.equal(sourceKey, "synthetic-operator-key"); assert.equal(report.applicationCheckpointCompleted, false);
  assert.equal(closed, true); assert.equal(JSON.stringify(report).includes(sourceKey), false);
});
test("bootstrap fails before opening credentials or provider adapters without locked-writer/database evidence binding", async () => {
  await assert.rejects(runBootstrapRecovery({ environment: {}, dependencies: { createDestination: () => { throw new Error("SHOULD_NOT_RUN"); } } }), /BOOTSTRAP_PRECONDITIONS/u);
});

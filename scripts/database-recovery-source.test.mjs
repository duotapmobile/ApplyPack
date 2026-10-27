import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { createDatabaseSnapshotSource, validateDatabaseRecoveryConfiguration, DATABASE_RECOVERY_SOURCE } from "./lib/database-recovery-source.mjs";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, RECOVERY_PROJECT, recoveryInventoryDigest, recoveryCanonicalSha256 } from "./lib/protected-recovery-protocol.mjs";

const NOW = Date.parse("2026-10-25T16:00:00.000Z");
const SHA = "a".repeat(40); const HASH = "b".repeat(64);
const runtime = { schemaVersion: "applypack-database-recovery-runtime-v1", postgresMajor: 17, clientVersion: "17.11",
  baseImageDigest: `sha256:${HASH}`, psqlSha256: HASH, pgDumpSha256: HASH };
const target = { id: "production-read-only-export", sourceProjectRef: RECOVERY_PROJECT, host: `db.${RECOVERY_PROJECT}.supabase.co`, port: 5432,
  database: "postgres", user: "applypack_recovery_exporter", caSha256: HASH, schemaVersion: "202610270105", runtimeManifestSha256: recoveryCanonicalSha256(runtime) };
function registration(overrides = {}) {
  const registry = { version: 1, targets: [structuredClone(target)] };
  const environment = { APP_DATABASE_BACKUP_ENABLED: "true", APP_DEPLOYMENT_ENV: "production", APP_EXPECTED_RELEASE_SHA: SHA,
    APP_DATABASE_BACKUP_TARGET_ID: target.id, APP_DATABASE_BACKUP_REGISTRY_SHA256: recoveryCanonicalSha256(registry), ...overrides };
  return { registry, runtime: structuredClone(runtime), environment };
}
const configuration = validateDatabaseRecoveryConfiguration(registration());
const emptyOverlay = () => ({ schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
  sourceWatermark: "1970-01-01T00:00:00Z", orders: [], holds: [], objectTombstones: [], objectPolicies: [] });
function fixture() {
  const calls = []; let closes = 0; let cancels = 0;
  const graph = { schemaVersion: "applypack-protected-recovery-inventory-v2", buckets: [...RECOVERY_BUCKETS], serviceRetention: emptyOverlay(),
    objects: [], references: [], tombstones: [], counts: { objects: 0, references: 0, tombstones: 0, tables: Object.fromEntries(RECOVERY_TABLES.map((name) => [name, 0])) } };
  const inspection = { currentUser: target.user, sessionUser: target.user, database: "postgres", readOnly: "on", isolation: "repeatable read",
    serverVersionNum: 170011, startedAt: new Date(NOW - 1000).toISOString(), snapshotId: "00000003-0000001B-1", schemaVersion: target.schemaVersion,
    schemas: [...DATABASE_RECOVERY_SOURCE.schemas], superuser: false, createRole: false, createDb: false, replication: false, bypassRls: true,
    unreadableTables: 0, unreadableSequences: 0, missingRequiredTables: 0, foreignTables: 0, overlayReadable: true,
    writableTables: 0, writableSequences: 0, writableSchemas: 0, databaseCreate: false, unexpectedRoleMemberships: 0, unexpectedDefinerFunctions: 0 };
  const checkpoint = { task_name: "protected_recovery", last_succeeded_at: new Date(NOW - 2000).toISOString(), summary: {
    schemaVersion: "applypack-protected-recovery-checkpoint-v1", sourceEnvironment: "production", sourceProjectRef: RECOVERY_PROJECT,
    releaseSha: SHA, sourceStartedAt: new Date(NOW - 2000).toISOString(), completedAt: new Date(NOW - 1500).toISOString(),
    inventoryDigest: recoveryInventoryDigest(graph), manifestSha256: HASH, manifestVersionId: "verified-version-1", objectCount: 0, referenceCount: 0, tombstoneCount: 0 } };
  const roles = { roles: [{ oid: 100, name: target.user, superuser: false, inherit: true, createRole: false, createDatabase: false,
    canLogin: true, replication: false, bypassRls: true, connectionLimit: 2, validUntil: null }], memberships: [] };
  const state = { inspection, checkpoint, roles, graph, objectPages: [[]], chunks: [Buffer.from("PGDMP synthetic custom archive")], dumpError: null,
    now: () => NOW, mutate: null, calls, get closes() { return closes; }, get cancels() { return cancels; } };
  const session = { async query(operation, input) {
    calls.push({ operation, input }); await state.mutate?.(operation);
    if (operation === "inspect") return inspection;
    if (operation === "checkpoint") return checkpoint;
    if (operation === "roles") return roles;
    if (operation === "objects") return state.objectPages.shift() ?? [];
    if (operation === "overlay") return graph.serviceRetention;
    if (operation === "buckets") return RECOVERY_BUCKETS.map((id) => ({ id, name: id, public: false }));
    if (operation === "table") return [];
    throw new Error("unexpected operation");
  }, async close() { closes += 1; } };
  const tools = { async openSession() { calls.push({ operation: "openSession" }); return session; },
    async openDump(input) { calls.push({ operation: "openDump", input });
      const completed = state.dumpError ? Promise.reject(state.dumpError) : Promise.resolve(); completed.catch(() => {});
      return { body: Readable.from(state.chunks), completed, cancel: async () => { cancels += 1; } };
    } };
  state.source = createDatabaseSnapshotSource({ configuration, tools, now: () => state.now() });
  state.open = () => state.source.openSnapshot({ releaseSha: SHA, signal: new AbortController().signal });
  return state;
}

test("only a separately registered enabled production read target is accepted", () => {
  assert.equal(configuration.user, "applypack_recovery_exporter");
  const disabled = registration({ APP_DATABASE_BACKUP_ENABLED: undefined });
  assert.throws(() => validateDatabaseRecoveryConfiguration(disabled), /DISABLED/u);
  const empty = registration(); empty.registry.targets = []; empty.environment.APP_DATABASE_BACKUP_REGISTRY_SHA256 = recoveryCanonicalSha256(empty.registry);
  assert.throws(() => validateDatabaseRecoveryConfiguration(empty), /TARGET_UNREGISTERED/u);
});
for (const [field, value] of Object.entries({ sourceProjectRef: "fmugizadzdnqfckujqlw", host: "localhost", port: 6543, user: "postgres", schemaVersion: "202610230086" })) {
  test(`registration rejects a changed ${field}`, () => {
    const valueSet = registration(); valueSet.registry.targets[0][field] = value;
    valueSet.environment.APP_DATABASE_BACKUP_REGISTRY_SHA256 = recoveryCanonicalSha256(valueSet.registry);
    assert.throws(() => validateDatabaseRecoveryConfiguration(valueSet), /TARGET_IDENTITY/u);
  });
}
for (const name of ["PGPASSWORD", "pgservice", "DATABASE_URL", "DIRECT_URL", "SUPABASE_SECRET_KEY", "NODE_TLS_REJECT_UNAUTHORIZED"]) {
  test(`registration rejects ambient ${name}`, () => assert.throws(() => validateDatabaseRecoveryConfiguration(registration({ [name]: "synthetic" })), /AMBIENT_CONNECTION/u));
}

test("official image metadata is accepted without permitting connection overrides", () => {
  assert.doesNotThrow(() => validateDatabaseRecoveryConfiguration(registration({ PG_MAJOR: "17", PG_VERSION: "17.11-1.pgdg13+1", PGDATA: "/var/lib/postgresql/data" })));
  for (const name of ["PGSSLROOTCERT", "PGHOSTADDR", "PGOPTIONS", "PGDATA_OTHER", "pgdata"]) {
    assert.throws(() => validateDatabaseRecoveryConfiguration(registration({ [name]: "synthetic" })), /AMBIENT_CONNECTION/u);
  }
});
test("runtime byte and version bindings cannot be substituted", () => {
  const input = registration(); input.runtime.clientVersion = "18.1";
  assert.throws(() => validateDatabaseRecoveryConfiguration(input), /RUNTIME_MANIFEST/u);
  input.runtime.clientVersion = "17.12";
  assert.throws(() => validateDatabaseRecoveryConfiguration(input), /RUNTIME_MANIFEST/u);
});
test("same snapshot supplies acknowledged checkpoint, private graph, roles and full dump", async () => {
  const f = fixture(); const handle = await f.open();
  assert.equal(handle.snapshot.pgDumpVersion, "17.11");
  assert.equal(handle.snapshot.postgresVersion, "17.11");
  assert.equal(handle.snapshot.coverage.roleDefinitionsIncluded, true);
  assert.equal(handle.snapshot.coverage.rolePasswordsIncluded, false);
  assert.equal(handle.snapshot.coverage.providerConfigurationIncluded, false);
  assert.equal(handle.inventory.receipt, `postgres-exported-snapshot-v1:${recoveryCanonicalSha256(handle.snapshot)}`);
  assert.equal(handle.rolesMetadata.snapshotId, handle.snapshot.snapshotId);
  assert.equal(f.closes, 0);
  const dump = await handle.openDump({ signal: new AbortController().signal });
  const chunks = []; for await (const chunk of dump.body) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  assert.deepEqual(await dump.completed, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  assert.equal(f.calls.find((entry) => entry.operation === "openDump").input.snapshotId, handle.snapshot.snapshotId);
  await handle.close(); await handle.close(); assert.equal(f.closes, 1);
});
for (const [field, value] of Object.entries({ currentUser: "postgres", sessionUser: "postgres", readOnly: "off", isolation: "read committed", superuser: true,
  bypassRls: false, writableTables: 1, writableSequences: 1, writableSchemas: 1, databaseCreate: true, unexpectedRoleMemberships: 1, unexpectedDefinerFunctions: 1,
  unreadableTables: 1, unreadableSequences: 1, missingRequiredTables: 1, foreignTables: 1, overlayReadable: false, schemaVersion: "202610230086", serverVersionNum: 180000 })) {
  test(`snapshot rejects incomplete or unsafe ${field}`, async () => {
    const f = fixture(); f.inspection[field] = value;
    await assert.rejects(f.open(), /READ_ROLE|COVERAGE/u); assert.equal(f.closes, 1);
    assert.equal(f.calls.some((entry) => entry.operation === "openDump"), false);
  });
}
test("an unacknowledged, stale, future, wrong-release or changed graph cannot become a database checkpoint", async () => {
  for (const mutate of [
    (f) => { f.checkpoint.summary = null; },
    (f) => { f.checkpoint.summary.manifestVersionId = "null"; },
    (f) => { f.checkpoint.summary.releaseSha = "c".repeat(40); },
    (f) => { f.checkpoint.summary.completedAt = new Date(NOW).toISOString(); },
    (f) => { f.checkpoint.summary.sourceStartedAt = new Date(NOW - 400000).toISOString(); },
    (f) => { f.checkpoint.summary.inventoryDigest = "c".repeat(64); },
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(f.open(), /ACKNOWLEDGED_CHECKPOINT|SNAPSHOT_FILE_GRAPH_MISMATCH/u); assert.equal(f.closes, 1);
  }
});
test("invalid storage version mapping rejects rather than inventing file identity", async () => {
  const f = fixture(); f.objectPages = [[{ id: "10000000-0000-4000-8000-000000000001", bucket_id: RECOVERY_BUCKETS[0], name: "private.docx", version: null, size: 12 }]];
  await assert.rejects(f.open(), /STORAGE_VERSION_MAPPING/u); assert.equal(f.closes, 1);
});
test("role secrets, unresolved membership and excessive metadata fail closed", async () => {
  for (const mutate of [
    (f) => { f.roles.roles[0].password = "synthetic-must-not-export"; },
    (f) => { f.roles.memberships.push({ roleOid: 100, memberOid: 999, grantorOid: 100, adminOption: false, inheritOption: true, setOption: true }); },
    (f) => { f.roles.roles = Array.from({ length: 4097 }, () => f.roles.roles[0]); },
  ]) { const f = fixture(); mutate(f); await assert.rejects(f.open(), /ROLE/u); assert.equal(f.closes, 1); }
});
test("a failed dump after stdout EOF does not resolve completion", async () => {
  const f = fixture(); f.dumpError = new Error("DATABASE_RECOVERY_PG_PROCESS_FAILED");
  const handle = await f.open(); const dump = await handle.openDump({ signal: new AbortController().signal });
  await assert.rejects(async () => { for await (const chunk of dump.body) assert.ok(chunk.length); }, /PROCESS_FAILED/u);
  await assert.rejects(dump.completed, /PROCESS_FAILED/u); assert.equal(f.cancels, 1); await handle.close();
});
test("partial consumption and closing an unconsumed dump cannot claim success", async () => {
  for (const consumeOne of [false, true]) {
    const f = fixture(); f.chunks = [Buffer.from("first"), Buffer.from("second")];
    const handle = await f.open(); const dump = await handle.openDump({ signal: new AbortController().signal });
    if (consumeOne) for await (const chunk of dump.body) { assert.ok(chunk); break; }
    await handle.close(); await assert.rejects(dump.completed, /DUMP_INCOMPLETE/u);
  }
});
test("source timeout, empty dump, replay and duplicate open remain unsuccessful", async () => {
  const stale = fixture(); const held = await stale.open(); stale.now = () => NOW + 400000;
  await assert.rejects(held.openDump({ signal: new AbortController().signal }), /SNAPSHOT_EXPIRED/u); await held.close();
  const f = fixture(); f.chunks = []; const handle = await f.open(); const dump = await handle.openDump({ signal: new AbortController().signal });
  await assert.rejects(async () => { for await (const chunk of dump.body) assert.ok(chunk); }, /EMPTY_DUMP/u);
  await assert.rejects(dump.completed, /EMPTY_DUMP/u);
  await assert.rejects(handle.openDump({ signal: new AbortController().signal }), /DUMP_STATE/u); await handle.close();
});
test("unexpected provider diagnostics are reduced to a safe source error", async () => {
  const f = fixture(); f.mutate = () => { throw new Error("private customer value must never escape"); };
  await assert.rejects(f.open(), { message: "DATABASE_RECOVERY_SOURCE_SNAPSHOT_READ_FAILED" });
});

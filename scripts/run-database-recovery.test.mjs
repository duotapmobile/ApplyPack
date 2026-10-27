import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { runDatabaseRecovery, sanitizedDatabaseRecoveryFailure } from "./run-database-recovery.mjs";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, RECOVERY_PROJECT, recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { canonicalBytes, canonicalSha256, sha256 } from "./lib/protected-recovery-core.mjs";
import { createDatabaseRecoveryS3Transport } from "./lib/database-recovery-s3.mjs";
import { fictionalArchiveLifecycle } from "./archive-writer-test-fixture.mjs";

const NOW = Date.parse("2026-10-25T16:00:00Z"); const SHA = "a".repeat(40); const HASH = "b".repeat(64);
const runtime = { schemaVersion: "applypack-database-recovery-runtime-v1", postgresMajor: 17, clientVersion: "17.11",
  baseImageDigest: `sha256:${HASH}`, psqlSha256: HASH, pgDumpSha256: HASH };
const target = { id: "synthetic-export", sourceProjectRef: RECOVERY_PROJECT, host: `db.${RECOVERY_PROJECT}.supabase.co`, port: 5432,
  database: "postgres", user: "applypack_recovery_exporter", caSha256: HASH, schemaVersion: "202610270105", runtimeManifestSha256: canonicalSha256(runtime) };
const archive = { bucket: "applypack-production-protected-recovery-838445019912",
  kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111" };
function fixture() {
  const registry = { version: 1, targets: [target] };
  const environment = { APP_DATABASE_BACKUP_ENABLED: "true", APP_DEPLOYMENT_ENV: "production", APP_EXPECTED_RELEASE_SHA: SHA,
    RAILWAY_GIT_COMMIT_SHA: SHA, APP_DATABASE_BACKUP_TARGET_ID: target.id, APP_DATABASE_BACKUP_REGISTRY_SHA256: canonicalSha256(registry),
    APP_DATABASE_BACKUP_DB_PASSWORD: "synthetic-local-password", PG_MAJOR: "17", PG_VERSION: "17.11", PGDATA: "/unused" };
  const stamp = (offset) => new Date(NOW + offset).toISOString();
  const overlay = { schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
    sourceWatermark: "1970-01-01T00:00:00Z", orders: [], holds: [], objectTombstones: [], objectPolicies: [] };
  const inventory = { schemaVersion: "applypack-protected-recovery-inventory-v2", sourceEnvironment: "production",
    sourceProjectRef: RECOVERY_PROJECT, releaseSha: SHA, startedAt: stamp(-2000), completedAt: stamp(-1900),
    buckets: [...RECOVERY_BUCKETS], objects: [], references: [], tombstones: [], serviceRetention: overlay,
    counts: { objects: 0, references: 0, tombstones: 0, tables: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, 0])) },
    receipt: "x".repeat(128) };
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  const manifest = { schemaVersion: "applypack-protected-recovery-manifest-v1", archive, inventory, secondInventoryReceipt: "y".repeat(128),
    watermark: inventory.startedAt, createdAt: stamp(-1800), previousManifestDigest: null, entries: [] };
  const fileDigest = canonicalSha256(manifest); const fileBytes = canonicalBytes(manifest);
  const checkpoint = { task_name: "protected_recovery", last_succeeded_at: stamp(-2000), summary: {
    schemaVersion: "applypack-protected-recovery-checkpoint-v1", sourceEnvironment: "production", sourceProjectRef: RECOVERY_PROJECT,
    releaseSha: SHA, sourceStartedAt: stamp(-2000), completedAt: stamp(-1700), inventoryDigest: inventory.inventoryDigest,
    manifestSha256: fileDigest, manifestVersionId: "file-version", objectCount: 0, referenceCount: 0, tombstoneCount: 0 } };
  const inspection = { currentUser: target.user, sessionUser: target.user, database: "postgres", readOnly: "on", isolation: "repeatable read",
    serverVersionNum: 170011, startedAt: stamp(-1000), snapshotId: "00000003-0000001B-1", schemaVersion: target.schemaVersion,
    schemas: ["public", "auth", "storage", "supabase_migrations"], superuser: false, createRole: false, createDb: false, replication: false,
    bypassRls: true, unreadableTables: 0, unreadableSequences: 0, missingRequiredTables: 0, foreignTables: 0, overlayReadable: true, writableTables: 0,
    writableSequences: 0, writableSchemas: 0, databaseCreate: false, unexpectedRoleMemberships: 0, unexpectedDefinerFunctions: 0 };
  const roles = { roles: [{ oid: 100, name: target.user, superuser: false, inherit: true, createRole: false, createDatabase: false,
    canLogin: true, replication: false, bypassRls: true, connectionLimit: 2, validUntil: null }], memberships: [] };
  const state = { environment, registry, calls: [], writes: [], closed: 0, disposed: 0, destinationClosed: 0, password: null, dumpFails: false };
  const tools = { async openSession() { return { async query(operation) {
    state.calls.push(operation);
    if (operation === "inspect") return inspection;
    if (operation === "checkpoint") return checkpoint;
    if (operation === "roles") return roles;
    if (operation === "overlay") return overlay;
    if (operation === "buckets") return RECOVERY_BUCKETS.map((id) => ({ id, name: id, public: false }));
    if (["objects", "table"].includes(operation)) return [];
    throw new Error("unexpected operation");
  }, async close() { state.closed++; } }; },
  async openDump() { const completed = state.dumpFails ? Promise.reject(new Error("private process diagnostics")) : Promise.resolve(); completed.catch(() => {});
    return { body: Readable.from([Buffer.from("PGDMP synthetic custom archive")]), completed, cancel: async () => {} }; },
  async dispose() { state.disposed++; } };
  const destination = createDatabaseRecoveryS3Transport({ archive, client: { async send(command) {
    state.calls.push(command.constructor.name);
    const bytes = command.constructor.name === "GetObjectCommand" ? fileBytes : Buffer.from(command.input.Body);
    if (command.constructor.name === "PutObjectCommand") state.writes.push({ key: command.input.Key, bytes });
    return { ServerSideEncryption: "aws:kms", SSEKMSKeyId: archive.kmsKeyArn, ChecksumSHA256: Buffer.from(sha256(bytes), "hex").toString("base64"),
      VersionId: command.constructor.name === "GetObjectCommand" ? "file-version" : `stored-${state.writes.length}`,
      ContentLength: bytes.length, Body: Readable.from([bytes]) };
  }, destroy() { state.destinationClosed++; } } });
  state.dependencies = { now: () => NOW, readConfiguration: async (file) => typeof file === "string" ? runtime : registry,
    validateArchive: () => archive, certificateStatus: () => ({}), createTools: ({ password }) => { state.password = password; return tools; },
    createDestination: () => destination, createLifecycle: () => fictionalArchiveLifecycle(SHA, "DATABASE", state.calls) };
  return state;
}

test("runner connects validated snapshot, graph, dump, encrypted versioned destination and safe receipt", async () => {
  const f = fixture(); const receipt = await runDatabaseRecovery(f.environment, f.dependencies);
  assert.equal(receipt.status, "DATABASE_CHECKPOINT_ARCHIVED"); assert.equal(receipt.serviceRecoveryComplete, false);
  assert.equal(receipt.authenticatedCheckpointRecorded, true);
  assert.deepEqual(f.calls.slice(0, 2), ["lifecycle.begin", "lifecycle.dispatch"]);
  assert.equal(f.calls.at(-1), "lifecycle.complete");
  assert.equal(receipt.readinessUpdated, false); assert.equal(f.closed, 1); assert.equal(f.disposed, 1); assert.equal(f.destinationClosed, 1);
  assert.ok(f.password.every((byte) => byte === 0)); assert.equal(f.writes.length, 3);
  assert.ok(f.writes[2].key.startsWith("database/manifests/"));
  assert.equal(f.calls.includes("inspect"), true); assert.equal(f.calls.includes("GetObjectCommand"), true);
  assert.equal(JSON.stringify(receipt).includes("synthetic-local-password"), false);
});

test("database writer cannot open a snapshot or upload after an unconfirmed dispatch", async () => {
  const f = fixture(); const lifecycle = fictionalArchiveLifecycle(SHA, "DATABASE", f.calls);
  lifecycle.dispatch = async () => { throw new Error("fictional lost dispatch response"); };
  f.dependencies.createLifecycle = () => lifecycle;
  await assert.rejects(runDatabaseRecovery(f.environment, f.dependencies));
  assert.equal(f.calls.includes("inspect"), false); assert.equal(f.writes.length, 0); assert.equal(f.calls.includes("lifecycle.cancel"), false);
  assert.equal(f.disposed, 1); assert.equal(f.destinationClosed, 1); assert.ok(f.password.every((byte) => byte === 0));
});
test("disabled and wrong-release runners do not inspect credentials or open a source", async () => {
  for (const extra of [{ APP_DATABASE_BACKUP_ENABLED: "false" }, { APP_DEPLOYMENT_ENV: "staging" },
    { RAILWAY_GIT_COMMIT_SHA: "b".repeat(40) }, { APP_EXPECTED_RELEASE_SHA: "short" }]) {
    const f = fixture(); f.dependencies.readConfiguration = () => { throw new Error("must not read"); };
    await assert.rejects(runDatabaseRecovery({ ...f.environment, ...extra }, f.dependencies), /DISABLED|RELEASE_IDENTITY/u);
    assert.equal(f.password, null); assert.equal(f.calls.length, 0);
  }
});
test("absent registration, invalid archive, or invalid certificate cannot start clients", async () => {
  for (const mode of ["registry", "archive", "certificate"]) {
    const f = fixture();
    if (mode === "registry") { f.registry.targets = []; f.environment.APP_DATABASE_BACKUP_REGISTRY_SHA256 = canonicalSha256(f.registry); }
    else f.dependencies[mode === "archive" ? "validateArchive" : "certificateStatus"] = () => { throw new Error("validation denied"); };
    await assert.rejects(runDatabaseRecovery(f.environment, f.dependencies)); assert.equal(f.password, null); assert.equal(f.calls.length, 0);
  }
});
test("failed dump cannot publish a manifest, retain the held source or leak password bytes", async () => {
  const f = fixture(); f.dumpFails = true;
  await assert.rejects(runDatabaseRecovery(f.environment, f.dependencies));
  assert.equal(f.writes.some((entry) => entry.key.includes("manifests/")), false);
  assert.equal(f.closed, 1); assert.equal(f.disposed, 1); assert.equal(f.destinationClosed, 1);
  assert.ok(f.password.every((byte) => byte === 0));
});
test("destination construction failure still disposes prepared PostgreSQL material", async () => {
  const f = fixture(); f.dependencies.createDestination = () => { throw new Error("private provider diagnostics"); };
  await assert.rejects(runDatabaseRecovery(f.environment, f.dependencies));
  assert.equal(f.disposed, 1); assert.ok(f.password.every((byte) => byte === 0)); assert.equal(f.calls.length, 0);
});
test("only fixed error codes survive executable error reporting", () => {
  for (const message of ["private@example.invalid", "DATABASE_RECOVERY_PG_FAILED\npassword=private", "DATABASE_RECOVERY_'private'"])
    assert.equal(sanitizedDatabaseRecoveryFailure(new Error(message)), "DATABASE_RECOVERY_RUN_FAILED");
  assert.equal(sanitizedDatabaseRecoveryFailure(new Error("DATABASE_RECOVERY_RUN_DISABLED")), "DATABASE_RECOVERY_RUN_DISABLED");
});

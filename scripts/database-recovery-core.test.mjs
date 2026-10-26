import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { canonicalBytes, canonicalSha256, sha256 } from "./lib/protected-recovery-core.mjs";
import { DATABASE_RECOVERY, databaseSnapshotReceipt,
  validateDatabaseManifest, validateDatabaseRolesMetadata } from "./lib/database-recovery-protocol.mjs";
import { createDatabaseCheckpoint } from "./lib/database-recovery-core.mjs";

const NOW = Date.parse("2026-10-25T15:00:00.000Z");
const RELEASE = "a".repeat(40);
const ARCHIVE = { bucket: DATABASE_RECOVERY.archiveBucket,
  kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111" };
const stamp = (offset) => new Date(NOW + offset).toISOString();
const clone = (value) => structuredClone(value);
const uuid = (number) => `11111111-1111-4111-8111-${String(number).padStart(12, "0")}`;
const seal = (inventory) => {
  inventory.counts.objects = inventory.objects.length;
  inventory.counts.references = inventory.references.length;
  inventory.counts.tombstones = inventory.tombstones.length;
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  return inventory;
};
async function collect(body) {
  if (body instanceof Uint8Array) return Buffer.from(body);
  const chunks = []; for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function fixture() {
  const events = []; const writes = []; const fileReads = [];
  const objects = [...RECOVERY_BUCKETS].sort().map((bucket, index) => ({ bucket, key: `synthetic/object-${index}.docx`,
    sourceVersion: sha256(`source-${index}`), size: 7, expectedSha256: sha256(`file-${index}!`), retentionExpiresAt: null }));
  const references = objects.map((object, index) => ({ table: "ap_document_versions", id: uuid(index + 1), field: "storage_path",
    bucket: object.bucket, key: object.key, expectedSha256: object.expectedSha256, retentionExpiresAt: null }));
  const fileInventory = seal({ schemaVersion: "applypack-protected-recovery-inventory-v2", sourceEnvironment: "production",
    sourceProjectRef: DATABASE_RECOVERY.projectRef, releaseSha: RELEASE, startedAt: stamp(-80000), completedAt: stamp(-79000),
    inventoryDigest: "0".repeat(64), buckets: [...RECOVERY_BUCKETS], objects, references, tombstones: [],
    serviceRetention: { schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
      sourceWatermark: "1970-01-01T00:00:00.000Z", orders: [], holds: [], objectTombstones: [], objectPolicies: [] },
    counts: { objects: 0, references: 0, tombstones: 0,
      tables: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, table === "ap_document_versions" ? 4 : 0])) },
    receipt: "synthetic-file-receipt-".padEnd(128, "x") });
  const fileManifest = { schemaVersion: "applypack-protected-recovery-manifest-v1", archive: clone(ARCHIVE), inventory: fileInventory,
    secondInventoryReceipt: "synthetic-second-receipt-".padEnd(128, "y"), watermark: fileInventory.startedAt,
    createdAt: stamp(-78000), previousManifestDigest: null,
    entries: objects.map((object, index) => ({ bucket: object.bucket, key: object.key, sourceVersion: object.sourceVersion,
      sha256: object.expectedSha256, size: object.size, archiveVersionId: `existing-file-version-${index}`,
      archiveKey: `objects/${object.bucket}/${sha256(`${object.bucket}\0${object.key}\0${object.sourceVersion}`)}` })) };
  const fileDigest = canonicalSha256(fileManifest);
  const snapshot = { sourceProjectRef: DATABASE_RECOVERY.projectRef, releaseSha: RELEASE, schemaVersion: "202610250095",
    startedAt: stamp(-60000), postgresVersion: "17.6", pgDumpVersion: "17.11", snapshotId: "00000003-0000001B-1",
    coverage: { schemas: ["public", "auth", "storage", "supabase_migrations"], allTablesReadable: true, rowSecurityBypass: true,
      roleDefinitionsIncluded: true, rolePasswordsIncluded: false, providerConfigurationIncluded: false } };
  const inventory = { ...clone(fileInventory), startedAt: stamp(-59000), completedAt: stamp(-58000), receipt: databaseSnapshotReceipt(snapshot) };
  const fileCheckpoint = { schemaVersion: "applypack-protected-recovery-checkpoint-v1", sourceEnvironment: "production",
    sourceProjectRef: DATABASE_RECOVERY.projectRef, releaseSha: RELEASE, sourceStartedAt: fileInventory.startedAt,
    completedAt: stamp(-77000), inventoryDigest: inventory.inventoryDigest, manifestSha256: fileDigest,
    manifestVersionId: "acknowledged-file-manifest-version", objectCount: 4, referenceCount: 4, tombstoneCount: 0 };
  const rolesMetadata = { schemaVersion: "applypack-database-roles-metadata-v1", sourceProjectRef: DATABASE_RECOVERY.projectRef,
    releaseSha: RELEASE, snapshotId: snapshot.snapshotId,
    roles: [1, 2].map((oid) => ({ oid, name: `synthetic_role_${oid}`, superuser: false, inherit: true, createRole: false,
      createDatabase: false, canLogin: oid === 1, replication: false, bypassRls: oid === 1, connectionLimit: -1, validUntil: null })),
    memberships: [{ roleOid: 2, memberOid: 1, grantorOid: 1, adminOption: false, inheritOption: true, setOption: false }] };
  const context = { events, writes, fileReads, snapshot, inventory, fileCheckpoint, rolesMetadata,
    fileEnvelope: { manifest: fileManifest, digest: fileDigest, versionId: fileCheckpoint.manifestVersionId },
    dumpBytes: Buffer.from("PGDMP\x01synthetic-custom-dump"), releaseSha: RELEASE, now: () => NOW, closed: 0 };
  const store = async (request, kind, extension) => {
    events.push(`${kind}-store`);
    const bytes = await collect(request.body); const digest = sha256(bytes);
    writes.push({ kind, bytes, signal: request.signal });
    if (kind === "manifest") assert.equal(request.digest, digest);
    return { key: `database/${kind === "manifest" ? "manifests" : kind === "dump" ? "dumps" : "roles"}/${digest}.${extension}`,
      versionId: `${kind}-version`, checksumSha256: digest, size: bytes.length, serverSideEncryption: "aws:kms", kmsKeyId: ARCHIVE.kmsKeyArn };
  };
  context.handle = { snapshot, inventory, fileCheckpoint, rolesMetadata,
    async openDump() {
      events.push("dump-open");
      let resolve; const completed = new Promise((done) => { resolve = done; });
      const body = (async function* () {
        yield context.dumpBytes.subarray(0, 2); yield context.dumpBytes.subarray(2);
        events.push("dump-exit"); resolve({ bytes: context.dumpBytes.length, sha256: sha256(context.dumpBytes) });
      })();
      return { body, completed };
    },
    async close() { context.closed++; events.push("close"); },
  };
  context.source = { async openSnapshot(request) { events.push("snapshot"); assert.equal(request.releaseSha, RELEASE); return context.handle; } };
  context.destination = { archive: clone(ARCHIVE),
    async readFileManifest(request) { events.push("file-manifest"); fileReads.push(request); return clone(context.fileEnvelope); },
    putDatabaseDump: (request) => store(request, "dump", "dump"),
    putRolesMetadata: (request) => store(request, "roles", "json"),
    putDatabaseManifest: (request) => store(request, "manifest", "json"),
  };
  return context;
}
async function rejectsUnpublished(context, pattern = /DATABASE_RECOVERY_/u) {
  await assert.rejects(createDatabaseCheckpoint(context), pattern);
  assert.equal(context.events.includes("manifest-store"), false);
  assert.equal(context.closed, 1);
}

test("pairs the acknowledged exact file manifest with the held dump and role snapshot, then publishes last", async () => {
  const context = fixture(); const result = await createDatabaseCheckpoint(context);
  assert.equal(result.status, "DATABASE_CHECKPOINT_ARCHIVED");
  assert.equal(result.serviceRecoveryComplete, false); assert.equal(result.readinessUpdated, false);
  assert.equal(result.manifest.watermark, context.fileCheckpoint.sourceStartedAt);
  assert.equal(result.manifest.snapshot.startedAt, context.snapshot.startedAt);
  assert.deepEqual(context.events.slice(-3), ["roles-store", "close", "manifest-store"]);
  assert.equal(context.fileReads.length, 1);
  assert.equal(context.fileReads[0].versionId, context.fileCheckpoint.manifestVersionId);
  assert.equal(context.fileReads[0].digest, context.fileCheckpoint.manifestSha256);
  assert.deepEqual(context.writes[0].bytes, context.dumpBytes);
  assert.deepEqual(JSON.parse(context.writes[1].bytes.toString("utf8")), context.rolesMetadata);
  assert.equal(context.closed, 1); assert.equal(result.manifestVersionId, "manifest-version");
  assert.equal(validateDatabaseManifest(result.manifest, result.manifestSha256), result.manifest);
  assert.deepEqual(result.manifest.snapshot.coverage, context.snapshot.coverage);
  assert.ok(context.writes.every((write) => write.signal.aborted));
});

for (const [label, mutate] of [
  ["wrong source project", (c) => { c.snapshot.sourceProjectRef = "fmugizadzdnqfckujqlw"; }],
  ["wrong release", (c) => { c.snapshot.releaseSha = "b".repeat(40); }],
  ["old schema", (c) => { c.snapshot.schemaVersion = "202610230086"; }],
  ["new unknown schema", (c) => { c.snapshot.schemaVersion = "202610250088"; }],
  ["unsupported server", (c) => { c.snapshot.postgresVersion = "18.1"; }],
  ["unsupported dump client", (c) => { c.snapshot.pgDumpVersion = "16.6"; }],
  ["unexported snapshot identifier", (c) => { c.snapshot.snapshotId = "caller-selected"; }],
  ["future snapshot", (c) => { c.snapshot.startedAt = stamp(1); }],
  ["stale snapshot", (c) => { c.snapshot.startedAt = stamp(-300001); }],
  ["missing auth coverage", (c) => { c.snapshot.coverage.schemas.splice(1, 1); }],
  ["unreadable relations", (c) => { c.snapshot.coverage.allTablesReadable = false; }],
  ["RLS filtered rows", (c) => { c.snapshot.coverage.rowSecurityBypass = false; }],
  ["missing roles", (c) => { c.snapshot.coverage.roleDefinitionsIncluded = false; }],
  ["password coverage claim", (c) => { c.snapshot.coverage.rolePasswordsIncluded = true; }],
  ["provider configuration completeness claim", (c) => { c.snapshot.coverage.providerConfigurationIncluded = true; }],
  ["unknown authority field", (c) => { c.snapshot.authority = "trusted"; }],
]) test(`rejects ${label} before archive writes`, async () => {
  const context = fixture(); mutate(context);
  await rejectsUnpublished(context); assert.equal(context.writes.length, 0);
});

for (const [label, mutate] of [
  ["unacknowledged newer manifest version", (c) => { c.fileEnvelope.versionId = "newest-unacknowledged-version"; }],
  ["different manifest digest", (c) => { c.fileEnvelope.digest = "f".repeat(64); }],
  ["unversioned manifest", (c) => { c.fileCheckpoint.manifestVersionId = "null"; }],
  ["missing acknowledgement", (c) => { c.handle.fileCheckpoint = null; }],
  ["wrong checkpoint release", (c) => { c.fileCheckpoint.releaseSha = "b".repeat(40); }],
  ["future acknowledgement relative to snapshot", (c) => { c.fileCheckpoint.completedAt = stamp(-59000); }],
  ["stale combined file watermark", (c) => { c.fileCheckpoint.sourceStartedAt = stamp(-300001); }],
  ["backward checkpoint timestamps", (c) => { c.fileCheckpoint.completedAt = stamp(-81000); }],
  ["checkpoint cycle exceeding five minutes", (c) => { c.fileCheckpoint.sourceStartedAt = stamp(-400000); }],
  ["incorrect object count", (c) => { c.fileCheckpoint.objectCount++; }],
  ["incorrect reference count", (c) => { c.fileCheckpoint.referenceCount++; }],
  ["incorrect tombstone count", (c) => { c.fileCheckpoint.tombstoneCount++; }],
  ["HTTP receipt impersonating snapshot authority", (c) => { c.inventory.receipt = "hmac-http-receipt".padEnd(128, "a"); }],
  ["marker from a different snapshot", (c) => { c.inventory.receipt = databaseSnapshotReceipt({ ...c.snapshot, snapshotId: "00000003-0000001C-1" }); }],
  ["graph read before held snapshot", (c) => { c.inventory.startedAt = stamp(-61000); }],
  ["graph read in future", (c) => { c.inventory.completedAt = stamp(1); }],
  ["missing historical graph table", (c) => { delete c.inventory.counts.tables.apply_pack_delivery_revisions; seal(c.inventory); }],
  ["missing empty bucket", (c) => { c.inventory.buckets.pop(); seal(c.inventory); }],
  ["concurrent file replacement", (c) => { c.inventory.objects[0].sourceVersion = "b".repeat(64); seal(c.inventory); }],
  ["concurrent reference removal", (c) => { c.inventory.references.pop(); seal(c.inventory); }],
  ["concurrent retention change", (c) => { c.inventory.serviceRetention.sourceWatermark = stamp(-59000); seal(c.inventory); }],
  ["unknown inventory schema", (c) => { c.inventory.schemaVersion = "future"; }],
]) test(`rejects ${label} without dumping or publishing`, async () => {
  const context = fixture(); mutate(context); await rejectsUnpublished(context);
  assert.equal(context.events.includes("dump-open"), false);
});

test("a self-consistent manifest from another KMS archive cannot substitute for the acknowledged archive", async () => {
  const context = fixture(); context.fileEnvelope.manifest.archive.kmsKeyArn = ARCHIVE.kmsKeyArn.replace("11111111", "22222222");
  context.fileEnvelope.digest = canonicalSha256(context.fileEnvelope.manifest);
  context.fileCheckpoint.manifestSha256 = context.fileEnvelope.digest;
  await rejectsUnpublished(context, /FILE_GRAPH_MISMATCH/u);
});

for (const [label, mutate] of [
  ["missing role snapshot", (r) => { delete r.snapshotId; }],
  ["wrong role snapshot", (r) => { r.snapshotId = "00000003-0000001C-1"; }],
  ["wrong role release", (r) => { r.releaseSha = "b".repeat(40); }],
  ["duplicate role OID", (r) => { r.roles[1].oid = r.roles[0].oid; }],
  ["duplicate role name", (r) => { r.roles[1].name = r.roles[0].name; }],
  ["unknown membership target", (r) => { r.memberships[0].roleOid = 999; }],
  ["unknown membership grantor", (r) => { r.memberships[0].grantorOid = 999; }],
  ["self membership", (r) => { r.memberships[0].roleOid = r.memberships[0].memberOid; }],
  ["duplicate membership", (r) => { r.memberships.push(clone(r.memberships[0])); }],
  ["password hash field", (r) => { r.roles[0].password = "must-never-be-archived"; }],
  ["unreviewed role configuration", (r) => { r.roles[0].config = ["sensitive=hidden"]; }],
  ["extra free SQL", (r) => { r.sql = "SELECT secret"; }],
]) test(`rejects ${label} before any archive write`, async () => {
  const context = fixture(); mutate(context.rolesMetadata); await rejectsUnpublished(context); assert.equal(context.writes.length, 0);
});

test("preserves role expiry sentinels and all membership grant options without password claims", () => {
  const context = fixture(); context.rolesMetadata.roles[0].validUntil = "infinity";
  context.rolesMetadata.roles[1].validUntil = "-infinity";
  context.rolesMetadata.memberships[0] = { ...context.rolesMetadata.memberships[0], adminOption: true, inheritOption: false, setOption: true };
  assert.equal(validateDatabaseRolesMetadata(context.rolesMetadata, context.snapshot), context.rolesMetadata);
});

for (const [label, bytes] of [
  ["plain SQL dump", Buffer.from("CREATE TABLE secret")],
  ["truncated custom header", Buffer.from("PGDM")],
  ["empty dump", Buffer.alloc(0)],
  ["high-bit alias of custom header", Buffer.from([0xd0, 0xc7, 0xc4, 0xcd, 0xd0])],
]) test(`rejects ${label}`, async () => { const context = fixture(); context.dumpBytes = bytes; await rejectsUnpublished(context, /DUMP_FORMAT/u); });

test("a destination which stops consuming cannot turn a partial stream into a checkpoint", async () => {
  const context = fixture(); context.destination.putDatabaseDump = async (request) => {
    await request.body.next(); return {};
  };
  await rejectsUnpublished(context, /DUMP_NOT_CONSUMED/u);
});

test("a fully read stream followed by nonzero pg_dump exit never publishes", async () => {
  const context = fixture(); context.handle.openDump = async () => ({
    body: (async function* () { yield context.dumpBytes; })(), completed: Promise.reject(new Error("private password stderr")),
  });
  await rejectsUnpublished(context, /DATABASE_RECOVERY_CORE_DUMP_EXIT_FAILED$/u);
  assert.equal(context.events.includes("roles-store"), false);
});

for (const [label, summary] of [
  ["wrong completion byte count", { bytes: 999, sha256: "a".repeat(64) }],
  ["wrong completion hash", { bytes: 26, sha256: "f".repeat(64) }],
  ["unverified subprocess result", { bytes: 26, sha256: "f".repeat(64), exitCode: 0 }],
]) test(`rejects ${label}`, async () => {
  const context = fixture(); context.handle.openDump = async () => ({ body: (async function* () { yield context.dumpBytes; })(), completed: Promise.resolve(summary) });
  await rejectsUnpublished(context, /DUMP_COMPLETION_MISMATCH/u);
});

test("an oversized dump is rejected while streaming and is never published", async () => {
  const context = fixture(); context.handle.openDump = async () => ({
    body: (async function* () { yield Buffer.from("PGDMP"); const chunk = Buffer.alloc(1024 * 1024);
      for (let i = 0; i < 128; i++) yield chunk; })(), completed: new Promise(() => {}),
  });
  context.destination.putDatabaseDump = async ({ body }) => { for await (const chunk of body) assert.ok(chunk.length); return {}; };
  await rejectsUnpublished(context, /DUMP_LIMIT/u);
});

for (const operation of ["putDatabaseDump", "putRolesMetadata", "putDatabaseManifest"]) {
  for (const [label, mutate] of [
    ["unversioned", (ack) => { ack.versionId = "null"; }],
    ["wrong checksum", (ack) => { ack.checksumSha256 = "f".repeat(64); }],
    ["wrong size", (ack) => { ack.size++; }],
    ["wrong key", (ack) => { ack.key = "database/dumps/unbound.dump"; }],
    ["missing KMS encryption", (ack) => { ack.serverSideEncryption = "AES256"; }],
    ["wrong KMS key", (ack) => { ack.kmsKeyId = ARCHIVE.kmsKeyArn.replace("11111111", "22222222"); }],
  ]) test(`${operation} rejects ${label} acknowledgement`, async () => {
    const context = fixture(); const original = context.destination[operation];
    context.destination[operation] = async (request) => { const ack = await original(request); mutate(ack); return ack; };
    await assert.rejects(createDatabaseCheckpoint(context), /ARCHIVE_ACKNOWLEDGEMENT/u);
    if (operation !== "putDatabaseManifest") assert.equal(context.events.includes("manifest-store"), false);
    assert.equal(context.closed, 1);
  });
}

for (const operation of ["readFileManifest", "putDatabaseDump", "putRolesMetadata", "putDatabaseManifest"]) {
  test(`redacts provider errors from ${operation}`, async () => {
    const context = fixture(); context.destination[operation] = async () => { throw new Error("password=private user@example.invalid"); };
    await assert.rejects(createDatabaseCheckpoint(context), (error) => {
      assert.match(error.message, /^DATABASE_RECOVERY_CORE_[A-Z_]+$/u);
      assert.doesNotMatch(error.message, /password|private|@/u); return true;
    });
    assert.equal(context.closed, 1);
  });
}

test("failed snapshot close blocks manifest publication", async () => {
  const context = fixture(); context.handle.close = async () => { context.closed++; throw new Error("provider details"); };
  await rejectsUnpublished(context, /SOURCE_CLOSE_FAILED/u);
});

test("expiry during dump storage prevents publication even when the provider acknowledged bytes", async () => {
  const context = fixture(); const original = context.destination.putDatabaseDump;
  let current = NOW; context.now = () => current;
  context.destination.putDatabaseDump = async (request) => { const ack = await original(request); current += 240001; return ack; };
  await rejectsUnpublished(context, /SNAPSHOT_TIME|FILE_CHECKPOINT_TIME/u);
});

test("hung source read has a bounded deadline and closes its held snapshot", async () => {
  const context = fixture(); context.maximumRunMilliseconds = 20;
  context.destination.readFileManifest = async () => new Promise(() => {});
  await rejectsUnpublished(context, /TIMEOUT/u);
});

test("a snapshot that arrives after timeout is closed without dumping or publishing", async () => {
  const context = fixture(); let resolve;
  context.source.openSnapshot = async () => new Promise((done) => { resolve = done; });
  await assert.rejects(createDatabaseCheckpoint({ ...context, maximumRunMilliseconds: 20 }), /TIMEOUT/u);
  resolve(context.handle); await nextTurn();
  assert.equal(context.closed, 1); assert.equal(context.writes.length, 0);
});

test("a dump whose subprocess never exits times out without advertising recovery", async () => {
  const context = fixture(); context.maximumRunMilliseconds = 20;
  context.handle.openDump = async () => ({ body: (async function* () { yield context.dumpBytes; })(), completed: new Promise(() => {}) });
  await rejectsUnpublished(context, /TIMEOUT/u);
});

test("source metadata mutations after capture cannot retarget the published companion", async () => {
  const context = fixture(); const original = context.destination.readFileManifest;
  context.destination.readFileManifest = async (request) => {
    const envelope = await original(request); context.snapshot.releaseSha = "b".repeat(40); context.fileCheckpoint.manifestVersionId = "replaced";
    return envelope;
  };
  const result = await createDatabaseCheckpoint(context);
  assert.equal(result.manifest.snapshot.releaseSha, RELEASE);
  assert.equal(result.manifest.fileManifest.versionId, "acknowledged-file-manifest-version");
});

test("companion manifests cannot claim a complete service restore or update application readiness", async () => {
  const result = await createDatabaseCheckpoint(fixture());
  for (const field of ["serviceRecoveryComplete", "readinessUpdated"]) {
    const manifest = clone(result.manifest); manifest[field] = true;
    assert.throws(() => validateDatabaseManifest(manifest, canonicalSha256(manifest)), /MANIFEST_SHAPE_OR_DIGEST/u);
  }
  for (const mutate of [
    (m) => { m.fileManifest.versionId = "newest"; },
    (m) => { m.inventoryDigest = "f".repeat(64); },
    (m) => { m.dump.key = `database/dumps/${"f".repeat(64)}.dump`; },
    (m) => { m.roles.key = `database/roles/${"f".repeat(64)}.json`; },
    (m) => { m.watermark = m.snapshot.startedAt; },
  ]) {
    const manifest = clone(result.manifest); mutate(manifest);
    assert.throws(() => validateDatabaseManifest(manifest, canonicalSha256(manifest)), /MANIFEST_BINDING/u);
  }
  assert.equal(canonicalSha256(JSON.parse(canonicalBytes(result.manifest))), result.manifestSha256);
});

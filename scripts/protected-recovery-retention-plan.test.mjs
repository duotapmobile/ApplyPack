import assert from "node:assert/strict";
import test from "node:test";
import { createRetentionVersionReader, inspectRecoveryRetention, planRecoveryRetention } from "./lib/protected-recovery-retention-plan.mjs";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { RECOVERY_ARCHIVE_BUCKET } from "./lib/protected-recovery-s3.mjs";
import { canonicalSha256, sha256 } from "./lib/protected-recovery-core.mjs";

const now = Date.parse("2026-10-23T22:00:00.000Z"); const releaseSha = "a".repeat(40);
const time = (offset) => new Date(now + offset).toISOString();
function fixture() {
  const object = { bucket: RECOVERY_BUCKETS[0], key: "owner/resume.docx", sourceVersion: "b".repeat(64), size: 12, expectedSha256: null, retentionExpiresAt: null };
  const inventory = { schemaVersion: "applypack-protected-recovery-inventory-v1", sourceEnvironment: "production", sourceProjectRef: "spjaaxndiduhrcleazwb",
    releaseSha, buckets: [...RECOVERY_BUCKETS], startedAt: time(-4000), completedAt: time(-3000), objects: [object], references: [], tombstones: [],
    counts: { objects: 1, references: 0, tombstones: 0, tables: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, 0])) }, receipt: "synthetic-receipt".padEnd(128, "x") };
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  const currentKey = `objects/${object.bucket}/${sha256(`${object.bucket}\u0000${object.key}\u0000${object.sourceVersion}`)}`;
  const versions = [
    { key: currentKey, versionId: "current1", lastModified: time(-60000), size: 12 },
    { key: `objects/${object.bucket}/${"c".repeat(64)}`, versionId: "obsolete1", lastModified: time(-60000), size: 12 },
    { key: `objects/${object.bucket}/${"d".repeat(64)}`, versionId: "inflight1", lastModified: time(-1000), size: 12 },
    { key: `manifests/${"e".repeat(64)}.json`, versionId: "oldmanifest1", lastModified: time(-8 * 86400000), size: 12 },
    { key: `manifests/${"f".repeat(64)}.json`, versionId: "recentmanifest1", lastModified: time(-86400000), size: 12 },
  ];
  return { inventory, versions, currentKey };
}
function providerVersion(entry) { return { Key: entry.key, VersionId: entry.versionId, LastModified: new Date(entry.lastModified), Size: entry.size, IsLatest: true }; }
function page(prefix, versions = [], extra = {}) { return { Name: RECOVERY_ARCHIVE_BUCKET, Prefix: prefix, Versions: versions.map(providerVersion), IsTruncated: false, ...extra }; }

test("read-only plan preserves every version and separately identifies old manifests needing a verified replacement", () => {
  const f = fixture(); const result = planRecoveryRetention({ ...f, releaseSha, now });
  assert.equal(result.plan.status, "READ_ONLY_NOT_AUTHORIZED_TO_DELETE"); assert.equal(result.plan.providerMutationPerformed, false);
  assert.deepEqual(result.plan.proposedRemovals, []);
  assert.deepEqual(result.plan.retainedVersions.map((entry) => entry.versionId).sort(), ["current1", "inflight1", "obsolete1", "oldmanifest1", "recentmanifest1"]);
  assert.deepEqual(result.plan.expiredManifestCandidates.map((entry) => entry.versionId), ["oldmanifest1"]);
  assert.equal(result.plan.manifestDeletionBasis, "VERIFIED_REPLACEMENT_REQUIRED");
  assert.deepEqual(result.plan.unresolvedObjectVersions.map((entry) => entry.versionId).sort(), ["inflight1", "obsolete1"]);
  assert.equal(result.plan.objectDeletionBasis, "HISTORICAL_MANIFEST_AND_RETENTION_MAPPING_REQUIRED");
  assert.equal(result.digest, canonicalSha256(result.plan));
});

test("the last recovery mapping is retained even when every manifest is past seven days", () => {
  const f = fixture(); f.versions = f.versions.filter((entry) => entry.versionId === "oldmanifest1");
  const result = planRecoveryRetention({ ...f, releaseSha, now }).plan;
  assert.deepEqual(result.proposedRemovals, []);
  assert.equal(result.retainedVersions[0].versionId, "oldmanifest1");
});

test("expired or revoked source identities require historical mapping and are never proposed for removal", () => {
  for (const kind of ["expiry", "REVOKED", "DELETED"]) {
    const f = fixture();
    if (kind === "expiry") f.inventory.objects[0].retentionExpiresAt = time(-1);
    else { f.inventory.tombstones.push({ table: "ap_document_versions", id: "11111111-1111-4111-8111-111111111111", field: "storage_path",
      bucket: f.inventory.objects[0].bucket, key: f.inventory.objects[0].key, kind, effectiveAt: time(-4000) }); f.inventory.counts.tombstones = 1; }
    f.inventory.inventoryDigest = recoveryInventoryDigest(f.inventory);
    const result = planRecoveryRetention({ ...f, releaseSha, now }).plan;
    assert.equal(result.proposedRemovals.some((entry) => entry.versionId === "current1"), false);
    assert.equal(result.retainedVersions.some((entry) => entry.versionId === "current1"), true);
    assert.equal(result.unresolvedObjectVersions.some((entry) => entry.versionId === "current1"), true);
  }
  const held = fixture();
  assert.equal(planRecoveryRetention({ ...held, releaseSha, now }).plan.proposedRemovals.some((entry) => entry.versionId === "current1"), false);
});

test("missing or superseded paid and held source versions remain until historical mapping is supplied", () => {
  for (const condition of ["absent", "superseded", "held"]) {
    const f = fixture();
    if (condition === "absent") { f.inventory.objects = []; f.inventory.counts.objects = 0; }
    if (condition === "superseded") f.inventory.objects[0].sourceVersion = "9".repeat(64);
    f.inventory.inventoryDigest = recoveryInventoryDigest(f.inventory);
    const result = planRecoveryRetention({ ...f, releaseSha, now }).plan;
    assert.equal(result.proposedRemovals.some((entry) => entry.key.startsWith("objects/")), false);
    assert.equal(result.retainedVersions.some((entry) => entry.versionId === "current1"), true);
  }
});

for (const [label, mutate] of [
  ["wrong release", (f) => { f.inventory.releaseSha = "c".repeat(40); }], ["stale inventory", (f) => { f.inventory.startedAt = time(-600001); }],
  ["unsafe key", (f) => { f.versions[0].key = "objects/../other"; }], ["nonversioned object", (f) => { f.versions[0].versionId = "null"; }],
  ["future version", (f) => { f.versions[0].lastModified = time(1); }], ["duplicate version", (f) => { f.versions.push({ ...f.versions[0] }); }],
  ["unknown metadata", (f) => { f.versions[0].privateContent = "never accepted"; }],
]) test(`planning rejects ${label}`, () => {
  const f = fixture(); mutate(f); assert.throws(() => planRecoveryRetention({ ...f, releaseSha, now }));
});

test("provider reader uses only scoped ListObjectVersions and follows both pagination markers", async () => {
  const f = fixture(); const calls = []; let closed = false;
  const client = { async send(command) {
    calls.push(command);
    const prefix = command.input.Prefix;
    if (prefix === "manifests/") return page(prefix, f.versions.slice(3));
    if (command.input.KeyMarker) return page(prefix, f.versions.slice(1, 3));
    return page(prefix, [f.versions[0]], { IsTruncated: true, NextKeyMarker: f.currentKey, NextVersionIdMarker: "current1" });
  }, destroy() { closed = true; } };
  const reader = createRetentionVersionReader(client);
  const result = await reader.listVersions({ signal: new AbortController().signal });
  assert.equal(result.length, 5); assert.equal(calls.length, 3);
  assert(calls.every((command) => command.constructor.name === "ListObjectVersionsCommand"));
  assert(calls.every((command) => command.input.ExpectedBucketOwner === "838445019912" && command.input.Bucket === RECOVERY_ARCHIVE_BUCKET));
  assert.equal(calls[1].input.KeyMarker, f.currentKey); assert.equal(calls[1].input.VersionIdMarker, "current1");
  reader.close(); assert.equal(closed, true);
});

for (const [label, alter] of [
  ["wrong bucket", (value) => { value.Name = "other"; }], ["wrong prefix", (value) => { value.Prefix = "unrestricted/"; }],
  ["delete markers", (value) => { value.DeleteMarkers = [{}]; }], ["unknown truncation", (value) => { delete value.IsTruncated; }],
  ["unsafe object version", (value) => { value.Versions[0].VersionId = "null"; }], ["duplicate version", (value) => { value.Versions.push(value.Versions[0]); }],
  ["missing next marker", (value) => { value.IsTruncated = true; }], ["unexpected final marker", (value) => { value.NextKeyMarker = "extra"; }],
]) test(`provider reader rejects ${label}`, async () => {
  const f = fixture(); const response = page("objects/", [f.versions[0]]); alter(response);
  const reader = createRetentionVersionReader({ send: async () => response, destroy() {} });
  await assert.rejects(reader.listVersions({ signal: new AbortController().signal }));
});

test("read-only inspection requires two identical complete inventories and never accepts a deletion callback", async () => {
  const f = fixture(); let reads = 0; let lists = 0; let mutations = 0;
  const second = { ...f.inventory, startedAt: time(-2000), completedAt: time(-1000) };
  const context = { releaseSha, now: () => now, source: { readInventory: async () => reads++ ? second : f.inventory },
    archive: { listVersions: async () => { lists++; return f.versions; }, deleteVersion: async () => { mutations++; } } };
  const result = await inspectRecoveryRetention(context);
  assert.equal(result.plan.providerMutationPerformed, false); assert.equal(reads, 2); assert.equal(lists, 1); assert.equal(mutations, 0);
  reads = 0; second.inventoryDigest = "0".repeat(64);
  await assert.rejects(inspectRecoveryRetention(context)); assert.equal(mutations, 0);
});

test("stuck read-only provider requests are bounded by a hard run deadline", async () => {
  const f = fixture();
  await assert.rejects(inspectRecoveryRetention({ releaseSha, now: () => now, maximumRunMilliseconds: 10,
    source: { readInventory: async () => f.inventory }, archive: { listVersions: () => new Promise(() => {}) } }), /ABORTED/u);
});

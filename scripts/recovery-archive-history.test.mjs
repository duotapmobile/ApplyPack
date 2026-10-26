import assert from "node:assert/strict";
import test from "node:test";
import { canonicalBytes, canonicalSha256, sha256 } from "./lib/protected-recovery-core.mjs";
import { recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { ARCHIVE_DATABASE_READ_VERSIONS, readHistoricalArchiveManifest,
  validateHistoricalDatabaseManifest, validateHistoricalFileManifest, mapDatabaseArchivePins } from "./lib/recovery-archive-history.mjs";

import { archiveHistoryFixture } from "./recovery-archive-test-fixture.mjs";

for (const schemaVersion of ARCHIVE_DATABASE_READ_VERSIONS) test(`historical database ${schemaVersion} remains readable with original bytes`, () => {
  const { database } = archiveHistoryFixture(schemaVersion); const bytes = canonicalBytes(database.manifest); const original = Buffer.from(bytes);
  const parsed = readHistoricalArchiveManifest({ bytes, key: database.key, versionId: database.versionId, expectedSize: bytes.length, expectedSha256: database.digest });
  assert.equal(parsed.manifest.snapshot.schemaVersion, schemaVersion); assert.equal(parsed.authenticity, "UNVERIFIED");
  assert.deepEqual(bytes, original); assert.equal(canonicalSha256(parsed.manifest), database.digest);
});
test("finite legacy file roster is read without adding current table rows or overlay", () => {
  const { file } = archiveHistoryFixture(); const bytes = canonicalBytes(file.manifest);
  const parsed = readHistoricalArchiveManifest({ bytes, key: file.key, versionId: file.versionId, expectedSize: bytes.length, expectedSha256: file.digest });
  assert.equal(parsed.manifest.inventory.schemaVersion, "applypack-protected-recovery-inventory-v1");
  assert.equal(parsed.manifest.inventory.serviceRetention, undefined); assert.deepEqual(canonicalBytes(parsed.manifest), bytes);
});
for (const value of ["202610240087", "202610250100", "202610250999", "202610250093extra"])
  test(`unknown database read profile ${value} fails closed`, () => {
    const f = archiveHistoryFixture(value); assert.throws(() => validateHistoricalDatabaseManifest(f.database.manifest, f.database.digest), /SHAPE_OR_DIGEST/u);
  });
test("unknown or incomplete table roster does not silently become an empty historical table", () => {
  for (const change of [(i) => { delete i.counts.tables.intakes; }, (i) => { i.counts.tables.new_private_table = 0; }]) {
    const f = archiveHistoryFixture(); change(f.file.manifest.inventory); f.file.manifest.inventory.inventoryDigest = recoveryInventoryDigest(f.file.manifest.inventory);
    assert.throws(() => validateHistoricalFileManifest(f.file.manifest, canonicalSha256(f.file.manifest)), /FILE_SHAPE/u);
  }
});
test("exact bytes cannot be relabelled as canonical metadata", () => {
  const { file } = archiveHistoryFixture(); const bytes = Buffer.from(JSON.stringify(file.manifest, null, 2)); const digest = sha256(bytes);
  assert.throws(() => readHistoricalArchiveManifest({ bytes, key: `manifests/${digest}.json`, versionId: file.versionId,
    expectedSize: bytes.length, expectedSha256: digest }), /NONCANONICAL_BYTES/u);
});
test("each retained database archive pins its exact file manifest and every referenced version", () => {
  const f = archiveHistoryFixture(); const graph = mapDatabaseArchivePins(f);
  assert.equal(graph.databaseDeletionAuthorized, false); assert.equal(graph.authenticity, "UNVERIFIED");
  assert.deepEqual(graph.pins.map((v) => v.versionId).sort(), ["dump-v1", "manifest-v1", "object-v1", "roles-v1"]);
  assert(graph.pins.every((v) => v.databaseManifests[0].versionId === f.database.versionId));
});

test("099 repair-reference manifests retain exact eleven-table bytes and pin the exact repair version", () => {
  const f = archiveHistoryFixture("202610250099"), inventory = f.file.manifest.inventory;
  inventory.schemaVersion = "applypack-protected-recovery-inventory-v2";
  inventory.serviceRetention = { schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
    sourceWatermark: inventory.startedAt, orders: [], holds: [], objectTombstones: [], objectPolicies: [] };
  const object = inventory.objects[0]; object.bucket = "customer-deliveries"; object.key = "private/repair.pdf";
  inventory.references = [{ table: "ap_service_repair_files", id: "11111111-1111-4111-8111-111111111111", field: "storage_path",
    bucket: object.bucket, key: object.key, expectedSha256: object.expectedSha256, retentionExpiresAt: object.retentionExpiresAt }];
  inventory.counts.references = 1; inventory.counts.tables.ap_service_repair_files = 1;
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  Object.assign(f.file.manifest.entries[0], { bucket: object.bucket, key: object.key,
    archiveKey: `objects/${object.bucket}/${sha256(`${object.bucket}\u0000${object.key}\u0000${object.sourceVersion}`)}` });
  f.file.digest = canonicalSha256(f.file.manifest); f.file.key = `manifests/${f.file.digest}.json`;
  Object.assign(f.database.manifest.fileCheckpoint, { inventoryDigest: inventory.inventoryDigest, manifestSha256: f.file.digest, referenceCount: 1 });
  Object.assign(f.database.manifest.fileManifest, { key: f.file.key, sha256: f.file.digest });
  f.database.manifest.inventoryDigest = inventory.inventoryDigest;
  f.database.digest = canonicalSha256(f.database.manifest); f.database.key = `database/manifests/${f.database.digest}.json`;
  f.versions[0] = { key: f.file.key, versionId: f.file.versionId, size: canonicalBytes(f.file.manifest).length };
  f.versions[1] = { key: f.database.key, versionId: f.database.versionId, size: canonicalBytes(f.database.manifest).length };
  f.versions[2] = { key: f.file.manifest.entries[0].archiveKey, versionId: "object-v1", size: object.size };
  const bytes = canonicalBytes(f.file.manifest);
  const parsed = readHistoricalArchiveManifest({ bytes, key: f.file.key, versionId: f.file.versionId, expectedSize: bytes.length, expectedSha256: f.file.digest });
  assert.deepEqual(canonicalBytes(parsed.manifest), bytes);
  assert.equal(parsed.manifest.inventory.references[0].table, "ap_service_repair_files");
  assert(mapDatabaseArchivePins(f).pins.some((pin) => pin.key === f.file.manifest.entries[0].archiveKey && pin.versionId === "object-v1"));
  delete inventory.counts.tables.ap_service_repair_files;
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  assert.throws(() => validateHistoricalFileManifest(f.file.manifest, canonicalSha256(f.file.manifest)), /FILE_SHAPE_OR_DIGEST/u);
});
for (const [label, mutate] of [
  ["missing database history", (f) => { f.databaseManifests = []; }],
  ["missing file manifest", (f) => { f.fileManifests = []; }],
  ["wrong same-key file version", (f) => { f.file.versionId = "other"; }],
  ["missing exact object version", (f) => { f.versions = f.versions.filter((v) => v.versionId !== "object-v1"); }],
  ["wrong object size", (f) => { f.versions.find((v) => v.versionId === "object-v1").size++; }],
  ["missing dump", (f) => { f.versions = f.versions.filter((v) => v.versionId !== "dump-v1"); }],
  ["duplicate listing", (f) => { f.versions.push(f.versions[0]); }],
]) test(`pin graph rejects ${label}`, () => { const f = archiveHistoryFixture(); mutate(f); assert.throws(() => mapDatabaseArchivePins(f)); });

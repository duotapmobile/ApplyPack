import assert from "node:assert/strict";
import test from "node:test";
import { createRetentionVersionReader, inspectRecoveryRetention, parseRetentionManifestEvidence, planRecoveryRetention, RETENTION_EVIDENCE_LIMITS } from "./lib/protected-recovery-retention-plan.mjs";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { RECOVERY_ARCHIVE_BUCKET } from "./lib/protected-recovery-s3.mjs";
import { canonicalBytes, canonicalSha256, sha256 } from "./lib/protected-recovery-core.mjs";
import { readRetentionManifestEvidenceFile, retentionPlanArguments, retentionPlanSummary } from "./plan-protected-recovery-retention.mjs";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function sealInventory(inventory) {
  inventory.counts.objects = inventory.objects.length;
  inventory.counts.references = inventory.references.length;
  inventory.counts.tombstones = inventory.tombstones.length;
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
}
function updateManifest(f, index = 0) {
  const evidence = f.manifestEvidence[index];
  const row = f.versions.find((entry) => entry.versionId === evidence.versionId);
  sealInventory(evidence.manifest.inventory);
  evidence.digest = canonicalSha256(evidence.manifest);
  row.key = `manifests/${evidence.digest}.json`;
  row.size = canonicalBytes(evidence.manifest).byteLength;
}
function mappingFixture() {
  const f = fixture(); const object = f.inventory.objects[0];
  f.inventory.references = [{ table: "ap_document_versions", id: "11111111-1111-4111-8111-111111111111", field: "storage_path",
    bucket: object.bucket, key: object.key, expectedSha256: null, retentionExpiresAt: null }];
  f.inventory.counts.tables.ap_document_versions = 1; sealInventory(f.inventory);
  const historical = structuredClone(f.inventory);
  historical.startedAt = time(-12000); historical.completedAt = time(-11000);
  const manifest = { schemaVersion: "applypack-protected-recovery-manifest-v1",
    archive: { bucket: RECOVERY_ARCHIVE_BUCKET, kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111" },
    inventory: historical, secondInventoryReceipt: "synthetic-second-receipt".padEnd(128, "x"), watermark: historical.startedAt,
    createdAt: time(-9000), previousManifestDigest: null,
    entries: [{ bucket: object.bucket, key: object.key, sourceVersion: object.sourceVersion, size: object.size,
      sha256: sha256(Buffer.alloc(object.size)), archiveKey: f.currentKey, archiveVersionId: "current1" }] };
  f.manifestEvidence = [{ versionId: "manifest-proof1", digest: canonicalSha256(manifest), manifest }];
  f.versions = [f.versions[0], { key: `manifests/${f.manifestEvidence[0].digest}.json`, versionId: "manifest-proof1",
    lastModified: time(-8000), size: canonicalBytes(manifest).byteLength }];
  return f;
}
function mapped(f) { return planRecoveryRetention({ ...f, releaseSha, now }).plan; }

test("complete historical mapping verifies only replacement metadata and retains every exact version", () => {
  const f = mappingFixture(); const plan = mapped(f);
  const mapping = plan.historicalMapping;
  assert.deepEqual(plan.proposedRemovals, []); assert.equal(plan.retainedVersions.length, f.versions.length);
  assert.equal(mapping.manifestCoverage.missing.length, 0);
  assert.equal(mapping.objectVersions[0].historical[0].references[0].currentRelationship, "UNCHANGED_VERSION");
  assert.equal(mapping.objectVersions[0].historical[0].unboundedOrHeldRetention, true);
  assert.deepEqual(mapping.replacementCheckpoint, { status: "METADATA_VERIFIED_ONLY", manifestDigest: f.manifestEvidence[0].digest,
    manifestVersionId: "manifest-proof1", providerBytesVerified: false, applicationCompletionVerified: false, hostedRestoreVerified: false });
  assert.equal(mapping.allVersionsPreserved, true);
});

test("missing historical manifest coverage leaves replacement unresolved, including a held older version", () => {
  const f = mappingFixture();
  f.versions.push({ key: `manifests/${"9".repeat(64)}.json`, versionId: "unimported", lastModified: time(-8 * 86400000), size: 123 });
  const plan = mapped(f);
  assert.equal(plan.historicalMapping.replacementCheckpoint.status, "INCOMPLETE_MANIFEST_EVIDENCE");
  assert.equal(plan.historicalMapping.manifestCoverage.missing[0].versionId, "unimported");
  assert.equal(plan.retainedVersions.length, 3); assert.deepEqual(plan.proposedRemovals, []);
});

test("missing exact blob version prevents a replacement claim even when another version of the same key exists", () => {
  const f = mappingFixture(); f.versions[0].versionId = "different-version";
  const plan = mapped(f);
  assert.deepEqual(plan.historicalMapping.manifests[0].missingArchiveVersions, [{ key: f.currentKey, versionId: "current1" }]);
  assert.equal(plan.historicalMapping.replacementCheckpoint.status, "NO_MATCHING_CURRENT_CHECKPOINT");
  assert.equal(plan.historicalMapping.objectVersions[0].mappingStatus, "UNMAPPED_PRESERVE");
  assert.deepEqual(plan.proposedRemovals, []);
});

test("null historical reference retention remains protected despite finite object expiry", () => {
  const f = mappingFixture();
  f.manifestEvidence[0].manifest.inventory.objects[0].retentionExpiresAt = time(-1);
  updateManifest(f);
  const history = mapped(f).historicalMapping.objectVersions[0].historical[0];
  assert.equal(history.retentionExpiresAt, time(-1));
  assert.equal(history.references[0].retentionExpiresAt, null);
  assert.equal(history.unboundedOrHeldRetention, true);
});

for (const kind of ["current object hold", "new shared paid reference"]) test(`finite historical retention is protected by a ${kind}`, () => {
  const f = mappingFixture(); const historical = f.manifestEvidence[0].manifest.inventory;
  historical.objects[0].retentionExpiresAt = time(60000); historical.references[0].retentionExpiresAt = time(60000); updateManifest(f);
  f.inventory.objects[0].retentionExpiresAt = kind === "current object hold" ? null : time(60000);
  f.inventory.references[0].retentionExpiresAt = time(60000);
  if (kind === "current object hold") f.inventory.references[0].retentionExpiresAt = null;
  else f.inventory.references.push({ ...f.inventory.references[0], table: "apply_pack_delivery_revisions",
    id: "22222222-2222-4222-8222-222222222222", retentionExpiresAt: null });
  sealInventory(f.inventory);
  const row = mapped(f).historicalMapping.objectVersions[0].historical[0];
  assert.equal(row.retentionExpiresAt, time(60000)); assert.equal(row.references[0].retentionExpiresAt, time(60000));
  assert.equal(row.unboundedOrHeldRetention, true); assert.equal(row.currentPathRetention.unboundedReferenceCount, 1);
});

test("same-second S3 publication precision is accepted but an earlier provider second is rejected", () => {
  const f = mappingFixture(); f.manifestEvidence[0].manifest.createdAt = time(-8550);
  f.versions[1].lastModified = time(-9000); updateManifest(f);
  assert.equal(mapped(f).historicalMapping.replacementCheckpoint.status, "METADATA_VERIFIED_ONLY");
  f.versions[1].lastModified = time(-10000);
  assert.throws(() => mapped(f), /MANIFEST_LIST_BINDING/u);
});

test("repeated published manifest versions preserve deterministic mapping independent of import order", () => {
  const f = mappingFixture(); const second = structuredClone(f.manifestEvidence[0]); second.versionId = "manifest-proof2";
  f.manifestEvidence.push(second); f.versions.push({ ...f.versions[1], versionId: second.versionId });
  const first = mapped(f); f.manifestEvidence.reverse(); f.versions.reverse();
  assert.deepEqual(mapped(f), first);
});

test("shared historical file maps a cleared reference and an unchanged paid reference without losing either obligation", () => {
  const f = mappingFixture();
  const paid = { ...f.inventory.references[0], table: "apply_pack_delivery_revisions", id: "22222222-2222-4222-8222-222222222222" };
  f.manifestEvidence[0].manifest.inventory.references.push(paid);
  f.manifestEvidence[0].manifest.inventory.counts.tables.apply_pack_delivery_revisions = 1; updateManifest(f);
  f.inventory.references = [paid]; f.inventory.counts.tables.apply_pack_delivery_revisions = 1; sealInventory(f.inventory);
  const plan = mapped(f); const history = plan.historicalMapping.objectVersions[0].historical[0];
  assert.deepEqual(history.references.map((reference) => reference.currentRelationship), ["ABSENT", "UNCHANGED_VERSION"]);
  assert.equal(history.unboundedOrHeldRetention, true); assert.equal(plan.retainedVersions.length, 2);
  assert.deepEqual(plan.proposedRemovals, []);
});

for (const reason of ["DELETED", "REVOKED"]) test(`${reason} provenance is mapped but never becomes deletion authority`, () => {
  const f = mappingFixture(); const reference = f.inventory.references[0];
  const subject = { ...reference }; delete subject.expectedSha256; delete subject.retentionExpiresAt;
  f.inventory.tombstones.push({ ...subject, kind: reason, effectiveAt: time(-3500) }); sealInventory(f.inventory);
  const plan = mapped(f);
  assert.equal(plan.historicalMapping.objectVersions[0].historical[0].latestRestrictions[0].kind, reason);
  assert.equal(plan.historicalMapping.replacementCheckpoint.status, "NO_MATCHING_CURRENT_CHECKPOINT");
  assert.deepEqual(plan.proposedRemovals, []);
});

for (const [label, mutate] of [
  ["digest mismatch", (f) => { f.manifestEvidence[0].digest = "0".repeat(64); }],
  ["unlisted manifest version", (f) => { f.manifestEvidence[0].versionId = "not-listed"; }],
  ["duplicate evidence", (f) => { f.manifestEvidence.push(structuredClone(f.manifestEvidence[0])); }],
  ["unknown envelope field", (f) => { f.manifestEvidence[0].trusted = true; }],
  ["manifest listed size mismatch", (f) => { f.versions[1].size++; }],
  ["blob listed size mismatch", (f) => { f.versions[0].size++; }],
  ["blob uploaded after manifest", (f) => { f.versions[0].lastModified = time(-7000); }],
  ["manifest created after current scan", (f) => { f.manifestEvidence[0].manifest.createdAt = time(-1000); f.versions[1].lastModified = time(-500); updateManifest(f); }],
  ["wrong source project", (f) => { f.manifestEvidence[0].manifest.inventory.sourceProjectRef = "fmugizadzdnqfckujqlw"; updateManifest(f); }],
  ["missing reference coverage", (f) => { f.manifestEvidence[0].manifest.entries = []; updateManifest(f); }],
]) test(`imported historical metadata rejects ${label}`, () => {
  const f = mappingFixture(); mutate(f); assert.throws(() => mapped(f));
});

for (const [label, mutate, expected] of [
  ["wrong release", (f) => { f.manifestEvidence[0].manifest.inventory.releaseSha = "b".repeat(40); updateManifest(f); }, "RELEASE_MISMATCH"],
  ["stale checkpoint", (f) => { const m = f.manifestEvidence[0].manifest; m.inventory.startedAt = time(-700000); m.watermark = m.inventory.startedAt; updateManifest(f); }, "CHECKPOINT_STALE"],
  ["superseded source version", (f) => { f.inventory.objects[0].sourceVersion = "9".repeat(64); sealInventory(f.inventory); }, "CURRENT_GRAPH_MISMATCH"],
  ["expired retained reference", (f) => { f.inventory.objects[0].retentionExpiresAt = time(-1); f.inventory.references[0].retentionExpiresAt = time(-1); sealInventory(f.inventory); }, "CURRENT_RETENTION_RESTRICTIONS"],
]) test(`replacement metadata is unavailable for ${label}`, () => {
  const f = mappingFixture(); mutate(f); const plan = mapped(f);
  assert(plan.historicalMapping.manifests[0].replacementMetadataReasons.includes(expected));
  assert.equal(plan.historicalMapping.replacementCheckpoint.status, "NO_MATCHING_CURRENT_CHECKPOINT");
  assert.deepEqual(plan.proposedRemovals, []); assert.equal(plan.retainedVersions.length, f.versions.length);
});

test("conflicting manifest claims for one immutable source version fail closed", () => {
  const f = mappingFixture(); const other = structuredClone(f.manifestEvidence[0]); other.versionId = "manifest-proof2";
  other.manifest.entries[0].sha256 = "d".repeat(64);
  f.manifestEvidence.push(other); f.versions.push({ ...f.versions[1], versionId: other.versionId }); updateManifest(f, 1);
  assert.throws(() => mapped(f), /ARCHIVE_VERSION_CONFLICT/u);
});

test("historical evidence cannot mix archive encryption identities", () => {
  const f = mappingFixture(); const other = structuredClone(f.manifestEvidence[0]); other.versionId = "manifest-proof2";
  other.manifest.archive.kmsKeyArn = "arn:aws:kms:us-east-1:838445019912:key/22222222-2222-4222-8222-222222222222";
  f.manifestEvidence.push(other); f.versions.push({ ...f.versions[1], versionId: other.versionId }); updateManifest(f, 1);
  assert.throws(() => mapped(f), /MANIFEST_ARCHIVE_CONFLICT/u);
});

test("private evidence reader and fixed CLI flag accept bounded metadata without adding provider authority", async () => {
  const f = mappingFixture(); const bytes = canonicalBytes(f.manifestEvidence);
  assert.deepEqual(parseRetentionManifestEvidence(bytes), f.manifestEvidence);
  assert.equal(retentionPlanArguments([]), null);
  assert.equal(retentionPlanArguments(["--manifest-evidence", "private.json"]), "private.json");
  for (const args of [["--delete"], ["--manifest-evidence"], ["--manifest-evidence", "x", "--execute"], ["--manifest-evidence", ""]]) assert.throws(() => retentionPlanArguments(args));
  assert.throws(() => parseRetentionManifestEvidence(Buffer.from([0xff])));
  assert.throws(() => parseRetentionManifestEvidence(Buffer.from("{}")));
  assert.throws(() => parseRetentionManifestEvidence(Buffer.from("[{}]")));
  assert.throws(() => parseRetentionManifestEvidence(new Uint8Array(RETENTION_EVIDENCE_LIMITS.bytes + 1)));
  const directory = await mkdtemp(join(tmpdir(), "applypack-retention-evidence-"));
  try {
    const path = join(directory, "manifest-evidence.json"); await writeFile(path, bytes);
    assert.deepEqual(await readRetentionManifestEvidenceFile(path), f.manifestEvidence);
    await writeFile(path, "{}"); await assert.rejects(readRetentionManifestEvidenceFile(path));
    await assert.rejects(readRetentionManifestEvidenceFile(directory));
  } finally { await rm(join(directory, "manifest-evidence.json"), { force: true }); await rmdir(directory); }
});

test("CLI summary never serializes private storage paths, filenames, versions or reference identities", () => {
  const f = mappingFixture();
  const result = planRecoveryRetention({ ...f, releaseSha, now });
  result.plan.historicalMapping.objectVersions[0].historical[0].key = "private/Example Person resume.docx";
  result.plan.historicalMapping.objectVersions[0].historical[0].latestRestrictions = [{ privateNote: "PRIVATE_RESTRICTION_MARKER" }];
  const summary = retentionPlanSummary(result); const serialized = JSON.stringify(summary);
  for (const value of ["owner/resume.docx", "Example Person", "PRIVATE_RESTRICTION_MARKER", "11111111-1111-4111-8111-111111111111",
    f.currentKey, "current1", "manifest-proof1", "references", "latestRestrictions", "historicalMapping"]) assert.equal(serialized.includes(value), false);
  assert.equal(summary.reportDigest, result.digest); assert.equal(summary.retainedVersionCount, 2);
  assert.equal(summary.proposedRemovalCount, 0); assert.equal(summary.allVersionsPreserved, true);
  assert.equal(summary.replacementMetadataStatus, "METADATA_VERIFIED_ONLY");
  assert.equal(summary.providerBytesVerified, false); assert.equal(summary.hostedRestoreVerified, false);
  result.plan.historicalMapping.replacementCheckpoint.status = "PRIVATE_STATUS_MARKER";
  assert.throws(() => retentionPlanSummary(result), /SUMMARY_INVALID/u);
});

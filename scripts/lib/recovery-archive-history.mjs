import { z } from "zod";
import { canonicalBytes, canonicalSha256, sha256 } from "./protected-recovery-core.mjs";
import { RECOVERY_BUCKETS, RECOVERY_LIMITS, RECOVERY_PROJECT, recoveryObjectSchema,
  recoveryReferenceSchema, recoveryTombstoneSchema, serviceRetentionOverlaySchema,
  validateServiceRetentionOverlay, recoveryInventoryDigest } from "./protected-recovery-protocol.mjs";
import { databaseManifestSchema, databaseSnapshotSchema, DATABASE_RECOVERY_LIMITS,
  validateDatabaseFileCheckpoint } from "./database-recovery-protocol.mjs";

// These are read profiles for formats actually published in this repository.
// Never replace an old manifest's schema/roster, rehash it as current, or accept
// arbitrary future versions just because their number sorts after this list.
export const ARCHIVE_DATABASE_READ_VERSIONS = Object.freeze([
  "202610250090", "202610250091", "202610250092", "202610250093", "202610250094", "202610250095",
  "202610250096", "202610250097", "202610250098", "202610250099", "202610250100", "202610250101", "202610260102", "202610260103",
  "202610270104",
]);
export const ARCHIVE_FILE_READ_TABLES = Object.freeze([
  "ap_document_versions", "ap_generated_file_versions", "ap_generated_artifacts", "ap_artifact_quality_reviews",
  "source_documents", "intakes", "intake_drafts", "apply_pack_items", "apply_pack_delivery_revisions", "ap_unpaid_source_cleanup",
]);
export const ARCHIVE_REPAIR_FILE_READ_TABLES = Object.freeze([...ARCHIVE_FILE_READ_TABLES, "ap_service_repair_files"]);
const fail = (code) => { throw new Error(`RECOVERY_ARCHIVE_HISTORY_${code}`); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const hex = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.string().min(1).max(1024).regex(/^[A-Za-z0-9._~+/=:-]+$/u).refine((value) => value !== "null");
const timestamp = z.iso.datetime();
const tables = z.enum(ARCHIVE_FILE_READ_TABLES);
const inventoryBase = z.object({
  schemaVersion: z.literal("applypack-protected-recovery-inventory-v1"), sourceEnvironment: z.literal("production"),
  sourceProjectRef: z.literal(RECOVERY_PROJECT), releaseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  startedAt: timestamp, completedAt: timestamp, inventoryDigest: hex,
  buckets: z.tuple(RECOVERY_BUCKETS.map((name) => z.literal(name))),
  objects: z.array(recoveryObjectSchema).max(RECOVERY_LIMITS.objects),
  references: z.array(recoveryReferenceSchema.extend({ table: tables })).max(RECOVERY_LIMITS.references),
  tombstones: z.array(recoveryTombstoneSchema.extend({ table: tables })).max(RECOVERY_LIMITS.references),
  counts: z.object({ objects: z.number().int().nonnegative(), references: z.number().int().nonnegative(),
    tombstones: z.number().int().nonnegative(), tables: z.object(Object.fromEntries(
      ARCHIVE_FILE_READ_TABLES.map((name) => [name, z.number().int().min(0).max(RECOVERY_LIMITS.references)]))).strict() }).strict(),
  receipt: z.string().min(64).max(4096),
}).strict();
const repairTables = z.enum(ARCHIVE_REPAIR_FILE_READ_TABLES);
const repairInventoryBase = inventoryBase.extend({
  references: z.array(recoveryReferenceSchema.extend({ table: repairTables })).max(RECOVERY_LIMITS.references),
  tombstones: z.array(recoveryTombstoneSchema.extend({ table: repairTables })).max(RECOVERY_LIMITS.references),
  counts: inventoryBase.shape.counts.extend({ tables: inventoryBase.shape.counts.shape.tables.extend({
    ap_service_repair_files: z.number().int().min(0).max(RECOVERY_LIMITS.references),
  }).strict() }).strict(),
}).strict();
// Exact old ten-table and new eleven-table profiles; never insert missing
// counts or rewrite an immutable old manifest into a current one.
const fileInventorySchema = z.union([inventoryBase, repairInventoryBase].map((base) => z.discriminatedUnion("schemaVersion", [base,
  base.extend({ schemaVersion: z.literal("applypack-protected-recovery-inventory-v2"), serviceRetention: serviceRetentionOverlaySchema }).strict()])));
const archiveSchema = databaseManifestSchema.shape.archive;
const fileManifestSchema = z.object({ schemaVersion: z.literal("applypack-protected-recovery-manifest-v1"),
  archive: archiveSchema, inventory: fileInventorySchema, secondInventoryReceipt: z.string().min(1).max(4096),
  watermark: timestamp, createdAt: timestamp, previousManifestDigest: hex.nullable(),
  entries: z.array(z.object({ bucket: z.enum(RECOVERY_BUCKETS), key: recoveryObjectSchema.shape.key,
    sourceVersion: hex, size: z.number().int().min(1).max(RECOVERY_LIMITS.objectBytes), sha256: hex,
    archiveKey: z.string().regex(/^objects\/[a-z-]+\/[a-f0-9]{64}$/u), archiveVersionId: version }).strict()).max(RECOVERY_LIMITS.objects),
}).strict();
const oldDatabaseSchema = databaseManifestSchema.extend({
  snapshot: databaseSnapshotSchema.extend({ schemaVersion: z.enum(ARCHIVE_DATABASE_READ_VERSIONS) }).strict(),
}).strict();
const objectId = (value) => `${value.bucket}\u0000${value.key}`;
export const archiveVersionIdentity = (value) => `${value.key}\u0000${value.versionId}`;
const refId = (value) => `${value.table}\u0000${value.id}\u0000${value.field}`;
const unique = (rows, identify, code) => requireValue(new Set(rows.map(identify)).size === rows.length, code);

export function validateHistoricalFileManifest(manifest, digest) {
  requireValue(fileManifestSchema.safeParse(manifest).success && hex.safeParse(digest).success
    && canonicalSha256(manifest) === digest, "FILE_SHAPE_OR_DIGEST");
  const inventory = manifest.inventory; const created = Date.parse(manifest.createdAt);
  requireValue(Date.parse(inventory.startedAt) <= Date.parse(inventory.completedAt)
    && Date.parse(inventory.completedAt) <= created && manifest.watermark === inventory.startedAt
    && inventory.inventoryDigest === recoveryInventoryDigest(inventory)
    && canonicalBytes(inventory).length <= RECOVERY_LIMITS.inventoryBytes, "FILE_INVENTORY_BINDING");
  requireValue(inventory.counts.objects === inventory.objects.length && inventory.counts.references === inventory.references.length
    && inventory.counts.tombstones === inventory.tombstones.length && manifest.entries.length === inventory.objects.length, "FILE_COVERAGE");
  if (inventory.schemaVersion.endsWith("v2")) validateServiceRetentionOverlay(inventory.serviceRetention, Date.parse(inventory.completedAt));
  unique(inventory.objects, objectId, "FILE_OBJECT_DUPLICATE"); unique(inventory.references, refId, "FILE_REFERENCE_DUPLICATE");
  unique(inventory.tombstones, canonicalSha256, "FILE_TOMBSTONE_DUPLICATE"); unique(manifest.entries, objectId, "FILE_ENTRY_DUPLICATE");
  const objects = new Map(inventory.objects.map((value) => [objectId(value), value]));
  let previous = ""; let total = 0;
  for (const object of inventory.objects) {
    requireValue(objectId(object) > previous, "FILE_OBJECT_ORDER"); previous = objectId(object); total += object.size;
    requireValue(total <= 10 * 1024 * 1024 * 1024, "FILE_TOTAL_LIMIT");
    const policy = inventory.serviceRetention?.objectPolicies.find((value) => value.bucket === object.bucket && value.pathSha256 === sha256(object.key));
    if (policy) requireValue(object.retentionExpiresAt === (policy.protected || policy.retentionExpiresAt === null
      ? null : new Date(policy.retentionExpiresAt).toISOString()), "FILE_POLICY_BINDING");
  }
  for (const reference of inventory.references) {
    const object = objects.get(objectId(reference));
    requireValue(object && (!reference.expectedSha256 || reference.expectedSha256 === object.expectedSha256)
      && (!reference.retentionExpiresAt || reference.retentionExpiresAt === object.retentionExpiresAt), "FILE_REFERENCE_BINDING");
  }
  for (const tombstone of inventory.tombstones) requireValue(Date.parse(tombstone.effectiveAt) <= Date.parse(inventory.completedAt), "FILE_TOMBSTONE_TIME");
  for (const entry of manifest.entries) {
    const object = objects.get(objectId(entry));
    requireValue(object && object.sourceVersion === entry.sourceVersion && object.size === entry.size
      && (!object.expectedSha256 || object.expectedSha256 === entry.sha256)
      && entry.archiveKey === `objects/${entry.bucket}/${sha256(`${objectId(entry)}\u0000${entry.sourceVersion}`)}`, "FILE_ENTRY_BINDING");
  }
  return manifest;
}

export function validateHistoricalDatabaseManifest(manifest, digest) {
  requireValue(oldDatabaseSchema.safeParse(manifest).success && hex.safeParse(digest).success
    && canonicalBytes(manifest).length <= DATABASE_RECOVERY_LIMITS.manifestBytes
    && canonicalSha256(manifest) === digest, "DATABASE_SHAPE_OR_DIGEST");
  const created = Date.parse(manifest.createdAt); const snapshot = manifest.snapshot;
  requireValue(Date.parse(snapshot.startedAt) <= created && created - Date.parse(snapshot.startedAt) <= DATABASE_RECOVERY_LIMITS.runMilliseconds,
    "DATABASE_SNAPSHOT_TIME");
  validateDatabaseFileCheckpoint(manifest.fileCheckpoint, snapshot, created);
  requireValue(manifest.inventoryDigest === manifest.fileCheckpoint.inventoryDigest
    && manifest.fileManifest.sha256 === manifest.fileCheckpoint.manifestSha256
    && manifest.fileManifest.versionId === manifest.fileCheckpoint.manifestVersionId
    && manifest.fileManifest.key === `manifests/${manifest.fileManifest.sha256}.json`
    && manifest.dump.key === `database/dumps/${manifest.dump.sha256}.dump`
    && manifest.roles.key === `database/roles/${manifest.roles.sha256}.json`
    && manifest.watermark === manifest.fileCheckpoint.sourceStartedAt, "DATABASE_BINDING");
  return manifest;
}

/** Exact bytes are retained by the caller; this parser never upgrades or rewrites them.
 * A successful parse proves format/digest only, never provider authenticity. */
export function readHistoricalArchiveManifest({ bytes, key, versionId, expectedSize, expectedSha256 }) {
  const database = /^database\/manifests\/[a-f0-9]{64}\.json$/u.test(key || "");
  requireValue(database || /^manifests\/[a-f0-9]{64}\.json$/u.test(key || ""), "KEY");
  requireValue(version.safeParse(versionId).success && bytes instanceof Uint8Array && bytes.length > 0
    && bytes.length === expectedSize && bytes.length <= (database ? DATABASE_RECOVERY_LIMITS.manifestBytes : 16 * 1024 * 1024), "BYTES");
  const digest = sha256(bytes);
  requireValue(digest === expectedSha256 && key === `${database ? "database/" : ""}manifests/${digest}.json`, "BYTE_DIGEST");
  let manifest;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("JSON"); }
  requireValue(Buffer.from(bytes).equals(canonicalBytes(manifest)), "NONCANONICAL_BYTES");
  (database ? validateHistoricalDatabaseManifest : validateHistoricalFileManifest)(manifest, digest);
  return { kind: database ? "database" : "file", key, versionId, digest, manifest, authenticity: "UNVERIFIED" };
}

/** All retained DB manifests pin exact file manifests and their exact object versions.
 * Missing/unknown history is an error, never an empty set or permission to delete. */
export function mapDatabaseArchivePins({ databaseManifests, fileManifests, versions }) {
  requireValue(Array.isArray(databaseManifests) && Array.isArray(fileManifests) && Array.isArray(versions)
    && databaseManifests.length <= 10000 && fileManifests.length <= 10000 && versions.length <= 50000, "GRAPH_LIMIT");
  unique(versions, archiveVersionIdentity, "LIST_DUPLICATE"); unique(databaseManifests, archiveVersionIdentity, "DATABASE_DUPLICATE");
  unique(fileManifests, archiveVersionIdentity, "FILE_DUPLICATE");
  const listed = new Map(versions.map((value) => [archiveVersionIdentity(value), value]));
  const files = new Map(fileManifests.map((value) => [archiveVersionIdentity(value), value]));
  const dbs = new Map(databaseManifests.map((value) => [archiveVersionIdentity(value), value]));
  for (const item of versions) if (/^database\/manifests\//u.test(item.key)) requireValue(dbs.has(archiveVersionIdentity(item)), "DATABASE_HISTORY_INCOMPLETE");
  const pins = new Map();
  const pin = (value, database) => {
    const id = archiveVersionIdentity(value); const stored = listed.get(id);
    requireValue(stored && (value.size === undefined || stored.size === value.size), "PIN_VERSION_MISSING");
    const prior = pins.get(id) ?? { key: value.key, versionId: value.versionId, databaseManifests: [] };
    prior.databaseManifests.push({ key: database.key, versionId: database.versionId }); pins.set(id, prior);
  };
  for (const database of databaseManifests) {
    validateHistoricalDatabaseManifest(database.manifest, database.digest);
    requireValue(database.key === `database/manifests/${database.digest}.json` && listed.has(archiveVersionIdentity(database)), "DATABASE_LIST_BINDING");
    const manifest = database.manifest; const file = files.get(archiveVersionIdentity(manifest.fileManifest));
    requireValue(file && file.digest === manifest.fileManifest.sha256, "FILE_PIN_MISSING");
    validateHistoricalFileManifest(file.manifest, file.digest);
    requireValue(canonicalSha256(file.manifest.archive) === canonicalSha256(manifest.archive)
      && file.manifest.inventory.inventoryDigest === manifest.inventoryDigest
      && file.manifest.inventory.releaseSha === manifest.snapshot.releaseSha
      && file.manifest.watermark === manifest.fileCheckpoint.sourceStartedAt
      && file.manifest.inventory.counts.objects === manifest.fileCheckpoint.objectCount
      && file.manifest.inventory.counts.references === manifest.fileCheckpoint.referenceCount
      && file.manifest.inventory.counts.tombstones === manifest.fileCheckpoint.tombstoneCount, "FILE_PIN_BINDING");
    pin({ ...manifest.fileManifest, size: canonicalBytes(file.manifest).length }, database);
    for (const entry of file.manifest.entries) pin({ key: entry.archiveKey, versionId: entry.archiveVersionId, size: entry.size }, database);
    pin(manifest.dump, database); pin(manifest.roles, database);
  }
  return { schemaVersion: "applypack-database-file-archive-pins-v1", authenticity: "UNVERIFIED",
    databaseDeletionAuthorized: false, pins: [...pins.values()].sort((a, b) => archiveVersionIdentity(a).localeCompare(archiveVersionIdentity(b))) };
}

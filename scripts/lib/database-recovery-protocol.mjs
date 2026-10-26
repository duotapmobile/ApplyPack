import { z } from "zod";
import { RECOVERY_PROJECT, RECOVERY_LIMITS } from "./protected-recovery-protocol.mjs";
import { canonicalBytes, canonicalSha256 } from "./protected-recovery-core.mjs";

export const DATABASE_RECOVERY_LIMITS = Object.freeze({
  dumpBytes: 128 * 1024 * 1024, rolesBytes: 4 * 1024 * 1024, manifestBytes: 64 * 1024,
  runMilliseconds: 5 * 60 * 1000, roles: 4096, memberships: 16384,
});
export const DATABASE_RECOVERY = Object.freeze({
  projectRef: RECOVERY_PROJECT, schemaVersion: "202610250099", postgresMajor: 17,
  archiveBucket: "applypack-production-protected-recovery-838445019912",
  manifestSchema: "applypack-database-recovery-manifest-v1",
  snapshotAuthority: "postgres-exported-snapshot-v1",
});

/** Only fixed error codes escape this boundary; provider errors and private payloads never do. */
export class DatabaseRecoveryError extends Error {
  constructor(code) { super(`DATABASE_RECOVERY_${code}`); this.name = "DatabaseRecoveryError"; }
}
const requireValue = (value, code) => { if (!value) throw new DatabaseRecoveryError(`PROTOCOL_${code}`); };
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const release = z.string().regex(/^[a-f0-9]{40}$/u);
const timestamp = z.iso.datetime({ offset: true });
const version = z.string().min(1).max(1024).regex(/^[A-Za-z0-9._~+\/=:-]+$/u).refine((value) => value !== "null");
const kms = z.string().regex(/^arn:aws:kms:us-east-1:838445019912:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u);
const postgresVersion = z.string().regex(/^17\.(?:0|[1-9][0-9]{0,3})$/u);
const snapshotId = z.string().regex(/^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{8}-[1-9][0-9]{0,9}$/u);
const oid = z.number().int().min(1).max(4294967295);
const roleName = z.string().min(1).max(63).refine((value) => !/[\x00-\x1f\x7f]/u.test(value) && Buffer.byteLength(value, "utf8") <= 63);

export const databaseArchiveSchema = z.object({ bucket: z.literal(DATABASE_RECOVERY.archiveBucket), kmsKeyArn: kms }).strict();
export const databaseSnapshotSchema = z.object({
  sourceProjectRef: z.literal(RECOVERY_PROJECT), releaseSha: release, schemaVersion: z.literal(DATABASE_RECOVERY.schemaVersion),
  startedAt: timestamp, postgresVersion, pgDumpVersion: postgresVersion, snapshotId,
  coverage: z.object({ schemas: z.tuple([z.literal("public"), z.literal("auth"), z.literal("storage"), z.literal("supabase_migrations")]),
    allTablesReadable: z.literal(true), rowSecurityBypass: z.literal(true), roleDefinitionsIncluded: z.literal(true),
    rolePasswordsIncluded: z.literal(false), providerConfigurationIncluded: z.literal(false) }).strict(),
}).strict();
export const databaseRolesMetadataSchema = z.object({
  schemaVersion: z.literal("applypack-database-roles-metadata-v1"), sourceProjectRef: z.literal(RECOVERY_PROJECT),
  releaseSha: release, snapshotId,
  roles: z.array(z.object({ oid, name: roleName, superuser: z.boolean(), inherit: z.boolean(), createRole: z.boolean(),
    createDatabase: z.boolean(), canLogin: z.boolean(), replication: z.boolean(), bypassRls: z.boolean(),
    connectionLimit: z.number().int().min(-1).max(2147483647),
    validUntil: z.union([timestamp, z.literal("infinity"), z.literal("-infinity")]).nullable() }).strict()).min(1).max(DATABASE_RECOVERY_LIMITS.roles),
  memberships: z.array(z.object({ roleOid: oid, memberOid: oid, grantorOid: oid,
    adminOption: z.boolean(), inheritOption: z.boolean(), setOption: z.boolean() }).strict()).max(DATABASE_RECOVERY_LIMITS.memberships),
}).strict();
export const databaseFileCheckpointSchema = z.object({
  schemaVersion: z.literal("applypack-protected-recovery-checkpoint-v1"), sourceEnvironment: z.literal("production"),
  sourceProjectRef: z.literal(RECOVERY_PROJECT), releaseSha: release, sourceStartedAt: timestamp, completedAt: timestamp,
  inventoryDigest: sha, manifestSha256: sha, manifestVersionId: version,
  objectCount: z.number().int().min(0).max(RECOVERY_LIMITS.objects),
  referenceCount: z.number().int().min(0).max(RECOVERY_LIMITS.references),
  tombstoneCount: z.number().int().min(0).max(RECOVERY_LIMITS.references),
}).strict();
export const databaseStoredObjectSchema = z.object({ key: z.string().min(1).max(128), versionId: version, checksumSha256: sha,
  size: z.number().int().min(1).max(DATABASE_RECOVERY_LIMITS.dumpBytes),
  serverSideEncryption: z.literal("aws:kms"), kmsKeyId: kms }).strict();

const content = { key: z.string().min(1).max(128), versionId: version, sha256: sha, size: z.number().int().positive() };
export const databaseManifestSchema = z.object({
  schemaVersion: z.literal(DATABASE_RECOVERY.manifestSchema), archive: databaseArchiveSchema, snapshot: databaseSnapshotSchema,
  inventoryDigest: sha, fileCheckpoint: databaseFileCheckpointSchema,
  fileManifest: z.object({ key: z.string().regex(/^manifests\/[a-f0-9]{64}\.json$/u), sha256: sha, versionId: version }).strict(),
  dump: z.object({ ...content, size: z.number().int().min(5).max(DATABASE_RECOVERY_LIMITS.dumpBytes),
    format: z.literal("postgresql-custom"), subprocessExitCode: z.literal(0) }).strict(),
  roles: z.object({ ...content, size: z.number().int().positive().max(DATABASE_RECOVERY_LIMITS.rolesBytes),
    roleCount: z.number().int().min(1).max(DATABASE_RECOVERY_LIMITS.roles),
    membershipCount: z.number().int().min(0).max(DATABASE_RECOVERY_LIMITS.memberships), passwordsIncluded: z.literal(false) }).strict(),
  watermark: timestamp, createdAt: timestamp, serviceRecoveryComplete: z.literal(false), readinessUpdated: z.literal(false),
}).strict();

export const databaseSnapshotReceipt = (snapshot) => `${DATABASE_RECOVERY.snapshotAuthority}:${canonicalSha256(snapshot)}`;

export function validateDatabaseSnapshot(snapshot, { releaseSha, now = Date.now() } = {}) {
  requireValue(databaseSnapshotSchema.safeParse(snapshot).success, "SNAPSHOT_SHAPE");
  requireValue(release.safeParse(releaseSha).success && snapshot.releaseSha === releaseSha, "RELEASE_IDENTITY");
  const start = Date.parse(snapshot.startedAt);
  requireValue(Number.isFinite(now) && start <= now && now - start <= DATABASE_RECOVERY_LIMITS.runMilliseconds, "SNAPSHOT_TIME");
  return snapshot;
}

export function validateDatabaseRolesMetadata(value, snapshot) {
  requireValue(databaseRolesMetadataSchema.safeParse(value).success, "ROLES_SHAPE");
  requireValue(canonicalBytes(value).byteLength <= DATABASE_RECOVERY_LIMITS.rolesBytes, "ROLES_LIMIT");
  requireValue(value.sourceProjectRef === snapshot.sourceProjectRef && value.releaseSha === snapshot.releaseSha
    && value.snapshotId === snapshot.snapshotId, "ROLES_SNAPSHOT");
  const ids = new Set(); const names = new Set(); const memberships = new Set();
  for (const role of value.roles) {
    requireValue(!ids.has(role.oid) && !names.has(role.name), "ROLES_DUPLICATE");
    ids.add(role.oid); names.add(role.name);
  }
  for (const member of value.memberships) {
    const identity = `${member.roleOid}:${member.memberOid}:${member.grantorOid}`;
    requireValue(ids.has(member.roleOid) && ids.has(member.memberOid) && ids.has(member.grantorOid)
      && member.roleOid !== member.memberOid && !memberships.has(identity), "ROLE_MEMBERSHIP");
    memberships.add(identity);
  }
  return value;
}

export function validateDatabaseFileCheckpoint(value, snapshot, now = Date.now()) {
  requireValue(databaseFileCheckpointSchema.safeParse(value).success, "FILE_CHECKPOINT_SHAPE");
  requireValue(value.releaseSha === snapshot.releaseSha && value.sourceProjectRef === snapshot.sourceProjectRef, "FILE_CHECKPOINT_IDENTITY");
  const start = Date.parse(value.sourceStartedAt); const end = Date.parse(value.completedAt);
  requireValue(start <= end && end <= Date.parse(snapshot.startedAt)
    && end - start <= DATABASE_RECOVERY_LIMITS.runMilliseconds
    && start <= now && now - start <= DATABASE_RECOVERY_LIMITS.runMilliseconds, "FILE_CHECKPOINT_TIME");
  return value;
}

export function validateDatabaseStoredObject(value, { archive, key, sha256, size }) {
  requireValue(databaseStoredObjectSchema.safeParse(value).success && value.key === key
    && value.kmsKeyId === archive.kmsKeyArn && value.checksumSha256 === sha256 && value.size === size, "ARCHIVE_ACKNOWLEDGEMENT");
  return value;
}

/** Structural validation proves binding, not a hosted restore or independent credential custody. */
export function validateDatabaseManifest(manifest, digest) {
  requireValue(databaseManifestSchema.safeParse(manifest).success && sha.safeParse(digest).success
    && canonicalBytes(manifest).byteLength <= DATABASE_RECOVERY_LIMITS.manifestBytes
    && canonicalSha256(manifest) === digest, "MANIFEST_SHAPE_OR_DIGEST");
  const created = Date.parse(manifest.createdAt);
  validateDatabaseSnapshot(manifest.snapshot, { releaseSha: manifest.snapshot.releaseSha, now: created });
  validateDatabaseFileCheckpoint(manifest.fileCheckpoint, manifest.snapshot, created);
  requireValue(manifest.inventoryDigest === manifest.fileCheckpoint.inventoryDigest
    && manifest.fileManifest.sha256 === manifest.fileCheckpoint.manifestSha256
    && manifest.fileManifest.versionId === manifest.fileCheckpoint.manifestVersionId
    && manifest.fileManifest.key === `manifests/${manifest.fileManifest.sha256}.json`
    && manifest.dump.key === `database/dumps/${manifest.dump.sha256}.dump`
    && manifest.roles.key === `database/roles/${manifest.roles.sha256}.json`
    && manifest.watermark === manifest.fileCheckpoint.sourceStartedAt, "MANIFEST_BINDING");
  return manifest;
}

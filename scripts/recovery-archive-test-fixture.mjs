import { canonicalBytes, canonicalSha256, sha256 } from "./lib/protected-recovery-core.mjs";
import { recoveryInventoryDigest, RECOVERY_BUCKETS } from "./lib/protected-recovery-protocol.mjs";
import { ARCHIVE_FILE_READ_TABLES } from "./lib/recovery-archive-history.mjs";
export function archiveHistoryFixture(schemaVersion = "202610250093") {
  const start = "2026-10-24T00:00:00.000Z"; const end = "2026-10-24T00:00:01.000Z";
  const releaseSha = "a".repeat(40); const hash = "b".repeat(64);
  const archive = { bucket: "applypack-production-protected-recovery-838445019912", kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111" };
  const object = { bucket: RECOVERY_BUCKETS[0], key: "private/source.docx", sourceVersion: hash, size: 12,
    expectedSha256: "c".repeat(64), retentionExpiresAt: "2026-10-25T00:00:00.000Z" };
  const inventory = { schemaVersion: "applypack-protected-recovery-inventory-v1", sourceEnvironment: "production",
    sourceProjectRef: "spjaaxndiduhrcleazwb", releaseSha, startedAt: start, completedAt: end,
    buckets: [...RECOVERY_BUCKETS], objects: [object], references: [], tombstones: [],
    counts: { objects: 1, references: 0, tombstones: 0, tables: Object.fromEntries(ARCHIVE_FILE_READ_TABLES.map((table) => [table, 0])) }, receipt: "r".repeat(128) };
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  const fileManifest = { schemaVersion: "applypack-protected-recovery-manifest-v1", archive, inventory,
    secondInventoryReceipt: "s".repeat(128), watermark: start, createdAt: "2026-10-24T00:00:02.000Z", previousManifestDigest: null,
    entries: [{ bucket: object.bucket, key: object.key, sourceVersion: hash, size: 12, sha256: object.expectedSha256,
      archiveKey: `objects/${object.bucket}/${sha256(`${object.bucket}\u0000${object.key}\u0000${hash}`)}`, archiveVersionId: "object-v1" }] };
  const file = { kind: "file", key: `manifests/${canonicalSha256(fileManifest)}.json`, versionId: "manifest-v1", digest: canonicalSha256(fileManifest), manifest: fileManifest };
  const checkpoint = { schemaVersion: "applypack-protected-recovery-checkpoint-v1", sourceEnvironment: "production", sourceProjectRef: inventory.sourceProjectRef,
    releaseSha, sourceStartedAt: start, completedAt: "2026-10-24T00:00:03.000Z", inventoryDigest: inventory.inventoryDigest,
    manifestSha256: file.digest, manifestVersionId: file.versionId, objectCount: 1, referenceCount: 0, tombstoneCount: 0 };
  const databaseManifest = { schemaVersion: "applypack-database-recovery-manifest-v1", archive,
    snapshot: { sourceProjectRef: inventory.sourceProjectRef, releaseSha, schemaVersion, startedAt: "2026-10-24T00:00:04.000Z",
      postgresVersion: "17.11", pgDumpVersion: "17.11", snapshotId: "00000001-00000002-1",
      coverage: { schemas: ["public", "auth", "storage", "supabase_migrations"], allTablesReadable: true, rowSecurityBypass: true,
        roleDefinitionsIncluded: true, rolePasswordsIncluded: false, providerConfigurationIncluded: false } },
    inventoryDigest: inventory.inventoryDigest, fileCheckpoint: checkpoint,
    fileManifest: { key: file.key, sha256: file.digest, versionId: file.versionId },
    dump: { key: `database/dumps/${hash}.dump`, versionId: "dump-v1", sha256: hash, size: 12, format: "postgresql-custom", subprocessExitCode: 0 },
    roles: { key: `database/roles/${hash}.json`, versionId: "roles-v1", sha256: hash, size: 12, roleCount: 1, membershipCount: 0, passwordsIncluded: false },
    watermark: start, createdAt: "2026-10-24T00:00:05.000Z", serviceRecoveryComplete: false, readinessUpdated: false };
  const database = { kind: "database", key: `database/manifests/${canonicalSha256(databaseManifest)}.json`, versionId: "db-manifest-v1", digest: canonicalSha256(databaseManifest), manifest: databaseManifest };
  const versions = [
    { key: file.key, versionId: file.versionId, size: canonicalBytes(fileManifest).length },
    { key: database.key, versionId: database.versionId, size: canonicalBytes(databaseManifest).length },
    { key: fileManifest.entries[0].archiveKey, versionId: "object-v1", size: 12 },
    { key: databaseManifest.dump.key, versionId: "dump-v1", size: 12 },
    { key: databaseManifest.roles.key, versionId: "roles-v1", size: 12 },
  ];
  return { file, database, versions, databaseManifests: [database], fileManifests: [file] };
}

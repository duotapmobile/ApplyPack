import assert from "node:assert/strict";
import { archiveHistoryFixture } from "./recovery-archive-test-fixture.mjs";
import { canonicalBytes, canonicalSha256 } from "./lib/protected-recovery-core.mjs";
import { recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { createArchiveEvidenceReader } from "./lib/recovery-archive-evidence.mjs";
const now = Date.parse("2026-11-04T00:00:00.000Z");
const releaseSha = "a".repeat(40); const runId = "f9800000-0000-4000-8000-000000000001";
const time = (offset) => new Date(now + offset).toISOString();
export function archiveExecutionFixture(options = {}) {
  const f = archiveHistoryFixture();
  const current = structuredClone(f.file.manifest);
  const inventory = current.inventory;
  inventory.schemaVersion = "applypack-protected-recovery-inventory-v2";
  inventory.startedAt = time(-6000); inventory.completedAt = time(-5500);
  inventory.objects = []; inventory.counts.objects = 0; current.entries = [];
  inventory.serviceRetention = { schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1", sourceWatermark: time(-7000),
    orders: [], holds: [], objectTombstones: [], objectPolicies: [] };
  if (options.held) {
    inventory.serviceRetention.orders.push({ orderId: runId, customerId: runId, legalReceiptId: runId, actionExpiresAt: time(-1), accessExpiresAt: time(-1),
      familyExpiresAt: time(-1), protected: true, state: "ACTIVE", purgedAt: null });
    inventory.serviceRetention.holds.push({ id: runId, orderId: runId, reasonCode: "SUPPORT_REVIEW", createdAt: time(-8000), releasedAt: null });
  }
  if (options.currentReferencesOld) { inventory.objects = structuredClone(f.file.manifest.inventory.objects); inventory.counts.objects = 1; current.entries = structuredClone(f.file.manifest.entries); }
  if (options.unbounded) {
    f.file.manifest.inventory.objects[0].retentionExpiresAt = null;
    f.file.manifest.inventory.inventoryDigest = recoveryInventoryDigest(f.file.manifest.inventory);
    f.file.digest = canonicalSha256(f.file.manifest); f.file.key = `manifests/${f.file.digest}.json`;
  }
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  current.watermark = inventory.startedAt; current.createdAt = time(-5000);
  const currentFile = { kind: "file", manifest: current, digest: canonicalSha256(current), versionId: "current-file-v1" };
  currentFile.key = `manifests/${currentFile.digest}.json`;
  const files = [f.file, currentFile]; const databases = options.databasePin ? [f.database] : [];
  const versions = [
    { key: f.file.key, versionId: f.file.versionId, size: canonicalBytes(f.file.manifest).length, lastModified: options.youngHistory ? time(-86400000) : "2026-10-24T00:00:02.100Z" },
    { key: f.file.manifest.entries[0].archiveKey, versionId: "object-v1", size: 12, lastModified: "2026-10-24T00:00:01.100Z" },
    { key: currentFile.key, versionId: currentFile.versionId, size: canonicalBytes(current).length, lastModified: time(-4900) },
    ...(options.databasePin ? f.versions.filter((v) => v.key.startsWith("database/")).map((v) => ({ ...v, lastModified: "2026-10-24T00:00:05.100Z" })) : []),
  ];
  const calls = []; const changes = options.change ?? (() => {});
  const s3 = { async send(command) {
    calls.push(command); const input = command.input; let result;
    if (command.constructor.name === "DeleteObjectCommand") {
      const at = versions.findIndex((v) => v.key === input.Key && v.versionId === input.VersionId); if (at >= 0 && !options.keepDeleted) versions.splice(at, 1);
      if (options.lostDeleteResponse) throw new Error("fictional lost acknowledgement"); return {};
    }
    if (command.constructor.name === "ListObjectVersionsCommand") result = { Name: current.archive.bucket, Prefix: input.Prefix, IsTruncated: false,
      Versions: versions.filter((v) => v.key.startsWith(input.Prefix)).map((v) => ({ Key: v.key, VersionId: v.versionId, Size: v.size, IsLatest: true, LastModified: new Date(v.lastModified) })) };
    else {
      const stored = versions.find((v) => v.key === input.Key && v.versionId === input.VersionId); assert(stored);
      const source = [...files, ...databases].find((v) => v.key === input.Key && v.versionId === input.VersionId);
      const digest = source?.digest ?? (input.Key.startsWith("objects/") ? f.file.manifest.entries[0].sha256 : f.database.manifest.dump.sha256);
      result = { VersionId: stored.versionId, ContentLength: stored.size, ServerSideEncryption: "aws:kms", SSEKMSKeyId: current.archive.kmsKeyArn,
        ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"), ...(source ? { Body: canonicalBytes(source.manifest) } : {}) };
    }
    changes(command, result); return result;
  } };
  const evidenceReader = createArchiveEvidenceReader({ s3, archive: current.archive, now: () => now,
    sts: { async send() { return { Account: "838445019912", Arn: "arn:aws:sts::838445019912:assumed-role/applypack-production-recovery-reader/test" }; } } });
  const first = { ...inventory, startedAt: time(-3000), completedAt: time(-2500) };
  const second = { ...inventory, startedAt: time(-2000), completedAt: time(-1500), receipt: "s".repeat(128) };
  const checkpoint = { ...f.database.manifest.fileCheckpoint, sourceStartedAt: current.watermark, completedAt: time(-4000),
    inventoryDigest: inventory.inventoryDigest, manifestSha256: currentFile.digest, manifestVersionId: currentFile.versionId, objectCount: inventory.counts.objects };
  const run = { id: runId, state: "FENCED", release_sha: releaseSha, started_at: time(-3500) };
  return { f, run, first, second, checkpoint, evidenceReader, calls, versions, currentFile, s3 };
}

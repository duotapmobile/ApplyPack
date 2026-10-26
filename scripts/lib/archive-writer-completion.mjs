import { z } from "zod";
import { canonicalSha256 } from "./protected-recovery-core.mjs";
import { databaseFileCheckpointSchema } from "./database-recovery-protocol.mjs";
import { authenticatedArchiveEvidence } from "./recovery-archive-evidence.mjs";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const release = z.string().regex(/^[a-f0-9]{40}$/u);
const timestamp = z.iso.datetime({ offset: true });
const version = z.string().min(1).max(1024).regex(/^[A-Za-z0-9._~+/=:-]+$/u).refine((value) => value !== "null");
const schema = z.string().regex(/^2026102500(?:9[0-9])$/u);
const project = z.literal("spjaaxndiduhrcleazwb");
const fail = (code) => { throw new Error(`ARCHIVE_WRITER_COMPLETION_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };

/** Provider verification is done before this receipt exists. It contains no
 * customer names, object paths or private content. SQL stores it immutably. */
export const archiveWriterCompletionSchema = z.object({
  schemaVersion: z.literal("applypack-archive-writer-completion-v1"), runId: z.uuid(), kind: z.enum(["FILE", "DATABASE"]),
  releaseSha: release, sourceProjectRef: project, snapshotSchemaVersion: schema.nullable(),
  sourceWatermark: timestamp, databaseSnapshotAt: timestamp.nullable(), verifiedAt: timestamp, evidenceExpiresAt: timestamp,
  manifestSha256: sha, manifestVersionId: version, inventoryDigest: sha,
  pairedFileManifestSha256: sha, pairedFileManifestVersionId: version,
  applicationCheckpointSha256: sha, providerVerificationSha256: sha,
}).strict();

/** Only the independent SDK reader's opaque proof can create a receipt. The
 * application checkpoint must be read from the application's durable record by
 * the authenticated completion boundary, never accepted from worker JSON. */
export function verifyArchiveWriterCompletion({ proof, run, manifestSha256, manifestVersionId, checkpoint, expectedSchemaVersion, now = Date.now() }) {
  const evidence = authenticatedArchiveEvidence(proof);
  requireValue(run?.state === "OPEN" && run.provider_dispatched === true && z.uuid().safeParse(run.id).success
    && ["FILE", "DATABASE"].includes(run.kind) && release.safeParse(run.release_sha).success, "WRITER_IDENTITY");
  requireValue(databaseFileCheckpointSchema.safeParse(checkpoint).success && checkpoint.releaseSha === run.release_sha, "APPLICATION_CHECKPOINT");
  const start = Date.parse(run.started_at);
  requireValue(Number.isFinite(now) && start <= evidence.startedAt && evidence.completedAt <= now
    && now - evidence.completedAt <= 60000 && now - start <= 300000, "VERIFICATION_TIME");
  const manifest = (run.kind === "DATABASE" ? evidence.databaseManifests : evidence.fileManifests)
    .find((item) => item.digest === manifestSha256 && item.versionId === manifestVersionId);
  requireValue(manifest, "MANIFEST_MISSING");
  const value = manifest.manifest;
  const file = run.kind === "DATABASE" ? evidence.fileManifests.find((item) => item.digest === value.fileManifest.sha256
    && item.versionId === value.fileManifest.versionId) : manifest;
  requireValue(file && file.manifest.inventory.releaseSha === run.release_sha
    && checkpoint.sourceProjectRef === file.manifest.inventory.sourceProjectRef
    && checkpoint.inventoryDigest === file.manifest.inventory.inventoryDigest
    && checkpoint.manifestSha256 === file.digest && checkpoint.manifestVersionId === file.versionId
    && checkpoint.sourceStartedAt === file.manifest.watermark
    && checkpoint.objectCount === file.manifest.inventory.counts.objects
    && checkpoint.referenceCount === file.manifest.inventory.counts.references
    && checkpoint.tombstoneCount === file.manifest.inventory.counts.tombstones, "FILE_CHECKPOINT_BINDING");
  if (run.kind === "DATABASE") requireValue(value.snapshot.releaseSha === run.release_sha
    && value.snapshot.schemaVersion === expectedSchemaVersion && value.snapshot.sourceProjectRef === checkpoint.sourceProjectRef
    && Date.parse(value.snapshot.startedAt) >= start && canonicalSha256(value.fileCheckpoint) === canonicalSha256(checkpoint), "DATABASE_BINDING");
  else requireValue(Date.parse(value.watermark) >= start, "FILE_STARTED_BEFORE_WRITER");
  const watermark = Date.parse(value.watermark);
  requireValue(watermark <= evidence.completedAt && evidence.completedAt - watermark <= 600000
    && Date.parse(value.createdAt) <= evidence.completedAt && Date.parse(checkpoint.completedAt) <= evidence.completedAt, "SOURCE_WATERMARK");
  const receipt = {
    schemaVersion: "applypack-archive-writer-completion-v1", runId: run.id, kind: run.kind, releaseSha: run.release_sha,
    sourceProjectRef: checkpoint.sourceProjectRef, snapshotSchemaVersion: run.kind === "DATABASE" ? value.snapshot.schemaVersion : null,
    sourceWatermark: value.watermark, databaseSnapshotAt: run.kind === "DATABASE" ? value.snapshot.startedAt : null,
    verifiedAt: new Date(evidence.completedAt).toISOString(), evidenceExpiresAt: new Date(watermark + 900000).toISOString(),
    manifestSha256, manifestVersionId, inventoryDigest: checkpoint.inventoryDigest,
    pairedFileManifestSha256: file.digest, pairedFileManifestVersionId: file.versionId,
    applicationCheckpointSha256: canonicalSha256(checkpoint), providerVerificationSha256: proof.digest,
  };
  requireValue(archiveWriterCompletionSchema.safeParse(receipt).success, "RECEIPT_SHAPE");
  return { receipt, sha256: canonicalSha256(receipt) };
}

const unknown = (reason) => ({ schemaVersion: "applypack-database-archive-status-v1", state: "UNKNOWN", reason });
/** The reader passes the latest COMPLETE database row, not a worker upload
 * response. This deliberately does not refresh any heartbeat or timestamp. */
export function inspectDatabaseArchiveCompletion(row, { releaseSha, expectedSchemaVersion, now = Date.now() }) {
  if (!row) return unknown("NO_VERIFIED_COMPLETION");
  const parsed = archiveWriterCompletionSchema.safeParse(row.completion_receipt);
  if (!parsed.success || row.state !== "COMPLETE" || row.kind !== "DATABASE" || row.provider_dispatched !== true
    || parsed.data.kind !== "DATABASE" || parsed.data.runId !== row.id || parsed.data.releaseSha !== row.release_sha
    || row.result_sha256 !== canonicalSha256(parsed.data)) return unknown("INVALID_COMPLETION");
  const receipt = parsed.data;
  if (receipt.releaseSha !== releaseSha || receipt.snapshotSchemaVersion !== expectedSchemaVersion) return unknown("RELEASE_OR_SCHEMA_MISMATCH");
  const times = [row.started_at, receipt.databaseSnapshotAt, receipt.verifiedAt, row.finished_at].map(Date.parse);
  const watermark = Date.parse(receipt.sourceWatermark); const expires = Date.parse(receipt.evidenceExpiresAt);
  if (!Number.isFinite(now) || times.some((time) => !Number.isFinite(time)) || !Number.isFinite(watermark)
    || times[0] > times[1] || times[1] > times[2] || times[2] > times[3] || times[3] > now
    || watermark > times[1] || times[2] - watermark > 600000 || times[3] - times[0] > 300000
    || expires !== watermark + 900000 || now >= expires) return unknown("EXPIRED_OR_INVALID_TIME");
  return { schemaVersion: "applypack-database-archive-status-v1", state: "VERIFIED", reason: null,
    runId: receipt.runId, releaseSha: receipt.releaseSha, sourceProjectRef: receipt.sourceProjectRef,
    schemaVersionOfSnapshot: receipt.snapshotSchemaVersion, sourceWatermark: receipt.sourceWatermark,
    databaseSnapshotAt: receipt.databaseSnapshotAt, verifiedAt: receipt.verifiedAt,
    providerVerificationSha256: receipt.providerVerificationSha256, evidenceExpiresAt: receipt.evidenceExpiresAt };
}

/** A finite read adapter avoids untyped table/RPC casts while generated 098
 * declarations are pending. The caller supplies only the fixed latest-database
 * query. No mutation, provider request, retry or private-data query occurs here. */
export async function readDatabaseArchiveStatus({ readLatestDatabaseCompletion, releaseSha, expectedSchemaVersion,
  now = Date.now, signal, timeoutMilliseconds = 5000 }) {
  if (!release.safeParse(releaseSha).success || !schema.safeParse(expectedSchemaVersion).success
    || !Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 10000) return unknown("CONFIGURATION_MISSING");
  const controller = new AbortController(); const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMilliseconds); signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  let listener;
  try {
    if (controller.signal.aborted) return unknown("READ_UNAVAILABLE");
    const row = await Promise.race([readLatestDatabaseCompletion({ signal: controller.signal }), new Promise((_, reject) => {
      listener = () => reject(new Error("ARCHIVE_STATUS_TIMEOUT")); controller.signal.addEventListener("abort", listener, { once: true });
    })]);
    if (controller.signal.aborted) return unknown("READ_UNAVAILABLE");
    return inspectDatabaseArchiveCompletion(row, { releaseSha, expectedSchemaVersion, now: now() });
  } catch { return unknown("READ_UNAVAILABLE"); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); if (listener) controller.signal.removeEventListener("abort", listener); controller.abort(); }
}

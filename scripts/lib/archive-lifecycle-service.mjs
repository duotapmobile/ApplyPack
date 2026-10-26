import { z } from "zod";
import { canonicalBytes, canonicalSha256, validateInventory } from "./protected-recovery-core.mjs";
import { verifyRecoveryReceipt } from "./protected-recovery-source.mjs";
import { databaseFileCheckpointSchema } from "./database-recovery-protocol.mjs";
import { buildAuthenticatedRetentionPlan } from "./protected-recovery-retention-execute.mjs";
import { verifyArchiveWriterCompletion } from "./archive-writer-completion.mjs";
import { authenticatedArchiveEvidence } from "./recovery-archive-evidence.mjs";

const uuid = z.uuid(); const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.string().min(1).max(1024).regex(/^[A-Za-z0-9._~+/=:-]+$/u).refine((v) => v !== "null");
const key = z.string().regex(/^(?:objects\/(?:customer-source-documents|customer-deliveries|operator-drafts|operator-render-previews)\/[a-f0-9]{64}|manifests\/[a-f0-9]{64}\.json)$/u);
const action = (name, fields = {}) => z.object({ action: z.literal(name), runId: uuid, ...fields }).strict();
const requestSchema = z.discriminatedUnion("action", [
  action("WRITER_BEGIN", { kind: z.enum(["FILE", "DATABASE"]) }), action("WRITER_DISPATCH"), action("WRITER_STATUS"), action("WRITER_CANCEL"),
  action("WRITER_COMPLETE", { manifestSha256: sha, manifestVersionId: version }),
  action("RETENTION_BEGIN"), action("RETENTION_STATUS"), action("RETENTION_PREPARE"), action("RETENTION_INVENTORY"), action("RETENTION_CHECKPOINT"),
  action("RETENTION_PLAN", { firstReceipt: z.string().max(4096), secondReceipt: z.string().max(4096), plan: z.unknown(), digest: sha }),
  action("RETENTION_DISPATCH", { key, versionId: version, planSha256: sha }),
  action("RETENTION_OBSERVE", { key, versionId: version, observationSha256: sha }),
  action("RETENTION_FINISH", { planSha256: sha.nullable(), cancel: z.boolean() }),
]);
const fail = (code) => { throw new Error(`ARCHIVE_LIFECYCLE_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const comparison = (plan) => canonicalSha256(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "providerProofDigest")));

/** Fixed RPC names and arguments only. The service client never accepts caller
 * SQL, a table name or a provider endpoint. Every call receives cancellation. */
export function createArchiveLifecycleStore(admin) {
  const rpc = async (name, args, signal, read = false) => {
    requireValue(signal instanceof AbortSignal && !signal.aborted, "ABORTED");
    const result = await admin.rpc(name, args, read ? { get: true } : undefined).abortSignal(signal);
    requireValue(!signal.aborted && result && !result.error && result.data !== null, "DATABASE_UNAVAILABLE"); return result.data;
  };
  return Object.freeze({
    writerStatus: (id, signal) => rpc("ap_archive_writer_status", { p_id: id }, signal, true),
    writerBegin: (id, kind, releaseSha, signal) => rpc("ap_begin_archive_writer", { p_id: id, p_kind: kind, p_release_sha: releaseSha }, signal),
    writerDispatch: (id, signal) => rpc("ap_dispatch_archive_writer", { p_id: id }, signal),
    writerFinish: (id, digest, cancel, receipt, signal) => rpc("ap_finish_archive_writer", { p_id: id, p_result_sha256: digest, p_cancel: cancel, p_completion_receipt: receipt }, signal),
    retentionStatus: (id, signal) => rpc("ap_archive_retention_status", { p_id: id }, signal, true),
    retentionBegin: (id, releaseSha, signal) => rpc("ap_begin_archive_retention", { p_id: id, p_release_sha: releaseSha }, signal),
    retentionPlan: (id, digest, proofSha, inventorySha, versions, signal) => rpc("ap_plan_archive_retention", { p_id: id, p_plan_sha256: digest,
      p_proof_sha256: proofSha, p_inventory_sha256: inventorySha, p_versions: versions }, signal),
    retentionDispatch: (id, key, versionId, digest, signal) => rpc("ap_dispatch_archive_retention_version", { p_id: id, p_key: key, p_version_id: versionId, p_plan_sha256: digest }, signal),
    retentionObserve: (id, key, versionId, digest, signal) => rpc("ap_observe_archive_retention_absence", { p_id: id, p_key: key, p_version_id: versionId, p_observation_sha256: digest }, signal),
    retentionFinish: (id, digest, cancel, receipt, signal) => rpc("ap_finish_archive_retention", { p_id: id, p_plan_sha256: digest, p_cancel: cancel, p_completion_receipt: receipt }, signal),
  });
}

/** Trusted application boundary. Provider evidence comes from the fixed SDK
 * reader and source state from server-owned reads; worker digests/flags cannot
 * manufacture either. Capability is selected by authenticated HTTP headers,
 * never by the request body. The default configuration does not enable this. */
export function createArchiveLifecycleService({ store, readInventory, readCheckpoint, evidenceReader, configuration, now = Date.now }) {
  requireValue(configuration?.enabled === true && /^[a-f0-9]{40}$/u.test(configuration.releaseSha || "")
    && /^20261025009[0-9]$/u.test(configuration.schemaVersion || "") && typeof configuration.receiptSecret === "string", "DISABLED");
  const releaseSha = configuration.releaseSha;
  const validateRun = (run, id) => requireValue(run?.id === id && run.release_sha === releaseSha, "RUN_IDENTITY");
  const currentRun = async (id, signal) => {
    const status = await store.retentionStatus(id, signal); validateRun(status?.run, id);
    requireValue(status.coverageCurrent === true && !["COMPLETE", "CANCELED"].includes(status.run.state), "FENCE_NOT_CURRENT"); return status;
  };
  const liveInventory = async (signal) => {
    const inventory = await readInventory({ signal }); validateInventory(inventory, { releaseSha, now: now(), requireRetention: true }); return inventory;
  };
  const checkpoint = async (signal) => {
    const value = await readCheckpoint({ signal }); requireValue(databaseFileCheckpointSchema.safeParse(value).success && value.releaseSha === releaseSha, "CHECKPOINT_UNAVAILABLE"); return value;
  };
  const rehydrate = (inventory, raw) => {
    const signed = verifyRecoveryReceipt(raw, configuration.receiptSecret);
    requireValue(signed.releaseSha === releaseSha && signed.sourceProjectRef === inventory.sourceProjectRef
      && signed.inventoryDigest === inventory.inventoryDigest && signed.objectCount === inventory.counts.objects
      && signed.referenceCount === inventory.counts.references && signed.tombstoneCount === inventory.counts.tombstones, "SOURCE_RECEIPT_MISMATCH");
    return { signed, inventory: { ...inventory, startedAt: signed.startedAt, completedAt: signed.completedAt, receipt: raw } };
  };
  return Object.freeze({ async execute(input, { capability, signal }) {
    requireValue(signal instanceof AbortSignal && !signal.aborted, "ABORTED");
    requireValue(canonicalBytes(input).length <= 1024 * 1024, "REQUEST_LIMIT");
    const parsed = requestSchema.safeParse(input); requireValue(parsed.success, "REQUEST_INVALID"); const request = parsed.data;
    const writer = request.action.startsWith("WRITER_");
    requireValue(writer ? ["FILE_WRITER", "DATABASE_WRITER"].includes(capability) : capability === "RETENTION", "CAPABILITY_FORBIDDEN");
    if (writer) {
      const kind = capability === "FILE_WRITER" ? "FILE" : "DATABASE";
      if (request.action === "WRITER_BEGIN") {
        requireValue(request.kind === kind, "WRITER_KIND"); return store.writerBegin(request.runId, kind, releaseSha, signal);
      }
      const run = await store.writerStatus(request.runId, signal); validateRun(run, request.runId); requireValue(run.kind === kind, "WRITER_KIND");
      if (request.action === "WRITER_STATUS") return run;
      if (request.action === "WRITER_DISPATCH") return store.writerDispatch(request.runId, signal);
      if (request.action === "WRITER_CANCEL") return store.writerFinish(request.runId, canonicalSha256({ runId: request.runId, kind, state: "CANCELED" }), true, null, signal);
      requireValue(request.action === "WRITER_COMPLETE", "ACTION_FORBIDDEN");
      if (run.state === "COMPLETE") {
        requireValue(run.completion_receipt?.manifestSha256 === request.manifestSha256 && run.completion_receipt?.manifestVersionId === request.manifestVersionId, "WRITER_REPLAY_MISMATCH");
        return run; // Observed immutable completion; never refresh its time.
      }
      const proof = await evidenceReader.readWriter({ kind, manifestSha256: request.manifestSha256,
        manifestVersionId: request.manifestVersionId, signal });
      const verified = verifyArchiveWriterCompletion({ proof, run, manifestSha256: request.manifestSha256, manifestVersionId: request.manifestVersionId,
        checkpoint: await checkpoint(signal), expectedSchemaVersion: configuration.schemaVersion, now: now() });
      return store.writerFinish(request.runId, verified.sha256, false, verified.receipt, signal);
    }
    if (request.action === "RETENTION_BEGIN") return store.retentionBegin(request.runId, releaseSha, signal);
    if (request.action === "RETENTION_STATUS") { const status = await store.retentionStatus(request.runId, signal); validateRun(status?.run, request.runId); return status; }
    const status = await currentRun(request.runId, signal);
    if (request.action === "RETENTION_INVENTORY") return liveInventory(signal);
    if (request.action === "RETENTION_CHECKPOINT") return checkpoint(signal);
    if (request.action === "RETENTION_PREPARE") {
      requireValue(status.run.state === "FENCED", "PLAN_STATE_OR_DIGEST");
      const first = await liveInventory(signal); const proof = await evidenceReader.read({ signal }); const second = await liveInventory(signal);
      const verified = buildAuthenticatedRetentionPlan({ proof, first, second, checkpoint: await checkpoint(signal), run: status.run, releaseSha, now: now() });
      const accepted = await store.retentionPlan(request.runId, verified.digest, proof.digest, first.inventoryDigest,
        verified.plan.removals.map(({ key, versionId, identitySha256 }) => ({ key, versionId, identitySha256 })), signal);
      return { run: accepted, plan: verified.plan, digest: verified.digest };
    }
    if (request.action === "RETENTION_PLAN") {
      requireValue(status.run.state === "FENCED" && canonicalSha256(request.plan) === request.digest, "PLAN_STATE_OR_DIGEST");
      const inventory = await liveInventory(signal);
      const first = rehydrate(inventory, request.firstReceipt); const second = rehydrate(inventory, request.secondReceipt);
      requireValue(first.signed.nonce !== second.signed.nonce, "REPLAYED_SOURCE_RECEIPT");
      const proof = await evidenceReader.read({ signal });
      const verified = buildAuthenticatedRetentionPlan({ proof, first: first.inventory, second: second.inventory, checkpoint: await checkpoint(signal),
        run: status.run, releaseSha, now: now() });
      requireValue(comparison(verified.plan) === comparison(request.plan), "PLAN_NOT_INDEPENDENTLY_VERIFIED");
      return store.retentionPlan(request.runId, request.digest, proof.digest, inventory.inventoryDigest,
        verified.plan.removals.map(({ key, versionId, identitySha256 }) => ({ key, versionId, identitySha256 })), signal);
    }
    if (request.action === "RETENTION_DISPATCH") return store.retentionDispatch(request.runId, request.key, request.versionId, request.planSha256, signal);
    if (request.action === "RETENTION_OBSERVE") {
      const member = status.versions.find((item) => item.archive_key === request.key && item.version_id === request.versionId);
      requireValue(member && ["DISPATCHED", "ABSENT"].includes(member.state), "OBSERVATION_STATE");
      if (member.state === "ABSENT") return member; // Exact persisted observation, no mutation/re-observation needed.
      const observation = await evidenceReader.observeAbsence({ key: request.key, versionId: request.versionId, signal });
      requireValue(observation?.absent === true && observation.key === request.key && observation.versionId === request.versionId, "ABSENCE_NOT_PROVEN");
      // The worker's asserted observation digest is deliberately not authoritative.
      return store.retentionObserve(request.runId, request.key, request.versionId, canonicalSha256(observation), signal);
    }
    requireValue(request.action === "RETENTION_FINISH", "ACTION_FORBIDDEN");
    let receipt = null;
    if (!request.cancel) {
      requireValue(status.versions.every((item) => item.state === "ABSENT"), "ABSENCE_INCOMPLETE");
      // Re-read every remaining manifest and referenced checksum before unlock;
      // successful individual deletes alone do not prove the kept graph usable.
      const proof = await evidenceReader.read({ signal }); const evidence = authenticatedArchiveEvidence(proof);
      const current = await liveInventory(signal); const acknowledged = await checkpoint(signal);
      requireValue(current.inventoryDigest === status.run.inventory_sha256 && acknowledged.inventoryDigest === current.inventoryDigest
        && evidence.fileManifests.some((file) => file.digest === acknowledged.manifestSha256 && file.versionId === acknowledged.manifestVersionId
          && file.manifest.watermark === acknowledged.sourceStartedAt && file.manifest.inventory.inventoryDigest === current.inventoryDigest
          && file.manifest.inventory.releaseSha === releaseSha)
        && now() - Date.parse(acknowledged.sourceStartedAt) <= 600000 && Date.parse(acknowledged.completedAt) <= now(), "REMAINING_GRAPH_UNVERIFIED");
      receipt = { schemaVersion: "applypack-protected-recovery-retention-v1", sourceEnvironment: "production", sourceProjectRef: current.sourceProjectRef,
        releaseSha, sourceStartedAt: status.run.started_at, completedAt: new Date(now()).toISOString(), inventoryDigest: current.inventoryDigest,
        planSha256: status.run.plan_sha256, providerVerificationSha256: proof.digest,
        deletedVersionCount: status.versions.length, retainedVersionCount: evidence.versions.length };
    }
    return store.retentionFinish(request.runId, request.planSha256, request.cancel, receipt, signal);
  } });
}

import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { canonicalSha256, validateInventory } from "./protected-recovery-core.mjs";
import { databaseFileCheckpointSchema } from "./database-recovery-protocol.mjs";
import { authenticatedArchiveEvidence } from "./recovery-archive-evidence.mjs";
import { archiveVersionIdentity } from "./recovery-archive-history.mjs";
import { createRetentionVersionReader, planRecoveryRetention } from "./protected-recovery-retention-plan.mjs";

const fail = (code) => { throw new Error(`PROTECTED_RECOVERY_RETENTION_EXECUTE_${code}`); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const bucket = "applypack-production-protected-recovery-838445019912";
const permitted = (key) => /^(?:objects\/(?:customer-source-documents|customer-deliveries|operator-drafts|operator-render-previews)\/[a-f0-9]{64}|manifests\/[a-f0-9]{64}\.json)$/u.test(key || "");
const version = (id) => typeof id === "string" && id !== "null" && /^[A-Za-z0-9._~+/=:-]{1,1024}$/u.test(id);
const age = 7 * 86400000;
const expired = (value, now) => value !== null && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now;
const comparable = (proof) => canonicalSha256({ archive: proof.archive, versions: proof.versions,
  fileManifests: proof.fileManifests, databaseManifests: proof.databaseManifests, pins: proof.pins });

/** Pure proposal from an opaque authenticated provider proof. Application receipt
 * verification and durable plan acceptance still occur at the server boundary. */
export function buildAuthenticatedRetentionPlan({ proof, first, second, checkpoint, run, releaseSha, now = Date.now() }) {
  const evidence = authenticatedArchiveEvidence(proof);
  validateInventory(first, { releaseSha, now, requireRetention: true });
  validateInventory(second, { releaseSha, now, requireRetention: true });
  requireValue(run?.state === "FENCED" && /^[0-9a-f-]{36}$/u.test(run.id || "") && run.release_sha === releaseSha
    && Date.parse(run.started_at) <= evidence.startedAt && Date.parse(run.started_at) <= Date.parse(first.startedAt)
    && evidence.completedAt <= now && now - Date.parse(run.started_at) < 300000
    && first.inventoryDigest === second.inventoryDigest && Date.parse(second.startedAt) >= Date.parse(first.completedAt), "FENCE_OR_SOURCE_CHANGED");
  requireValue(databaseFileCheckpointSchema.safeParse(checkpoint).success && checkpoint.releaseSha === releaseSha
    && checkpoint.inventoryDigest === first.inventoryDigest && checkpoint.sourceProjectRef === first.sourceProjectRef
    && checkpoint.objectCount === first.counts.objects && checkpoint.referenceCount === first.counts.references
    && checkpoint.tombstoneCount === first.counts.tombstones && Date.parse(checkpoint.completedAt) <= Date.parse(first.startedAt)
    && now - Date.parse(checkpoint.sourceStartedAt) <= 600000, "APPLICATION_CHECKPOINT");
  const current = evidence.fileManifests.find((value) => value.digest === checkpoint.manifestSha256 && value.versionId === checkpoint.manifestVersionId);
  requireValue(current && current.manifest.inventory.inventoryDigest === first.inventoryDigest
    && current.manifest.watermark === checkpoint.sourceStartedAt && current.manifest.inventory.releaseSha === releaseSha, "CURRENT_MANIFEST");
  const versions = evidence.versions.filter((value) => permitted(value.key));
  const metadata = planRecoveryRetention({ inventory: first, versions, releaseSha, now,
    manifestEvidence: evidence.fileManifests.map(({ digest, versionId, manifest }) => ({ digest, versionId, manifest })) }).plan;
  requireValue(metadata.historicalMapping.manifestCoverage.missing.length === 0, "HISTORY_INCOMPLETE");
  const pins = new Set(evidence.pins.map(archiveVersionIdentity));
  const removals = []; const retained = []; const objectCandidates = new Set();
  // Old manifests do not contain a complete owner mapping after primary aliases
  // are purged. Any current protected order/hold therefore conservatively stops
  // file-byte pruning globally; absence of an alias is never a deletion basis.
  const protectedWork = first.serviceRetention.orders.some((row) => row.protected)
    || first.serviceRetention.holds.some((row) => row.releasedAt === null);
  for (const object of metadata.historicalMapping.objectVersions) {
    const id = archiveVersionIdentity(object);
    const safe = !protectedWork && !pins.has(id) && Date.parse(object.lastModified) < Date.parse(first.startedAt)
      && object.historical.length > 0 && object.historical.every((old) => !old.unboundedOrHeldRetention
        && expired(old.retentionExpiresAt, now) && old.references.every((ref) => expired(ref.retentionExpiresAt, now)
          && (!ref.currentRetention || expired(ref.currentRetention.retentionExpiresAt, now)))
        && (!old.currentPathRetention || expired(old.currentPathRetention.retentionExpiresAt, now)
          && old.currentPathRetention.unboundedReferenceCount === 0));
    if (safe) objectCandidates.add(id);
  }
  const manifestCandidates = evidence.fileManifests.filter((file) => {
    const stored = versions.find((v) => archiveVersionIdentity(v) === archiveVersionIdentity(file));
    return file !== current && stored && Date.parse(stored.lastModified) < Date.parse(first.startedAt)
      && Date.parse(stored.lastModified) <= now - age && !pins.has(archiveVersionIdentity(file));
  });
  // A retained manifest must never become a dangling claim to removed bytes.
  // Solve the small bounded dependency graph to a conservative fixed point:
  // removing one candidate can only remove further candidates, never add them.
  const entryId = (entry) => archiveVersionIdentity({ key: entry.archiveKey, versionId: entry.archiveVersionId });
  let manifestRemovals = new Set(manifestCandidates.map(archiveVersionIdentity));
  for (;;) {
    let changed = false;
    for (const file of evidence.fileManifests.filter((item) => !manifestRemovals.has(archiveVersionIdentity(item)))) {
      for (const entry of file.manifest.entries) if (objectCandidates.delete(entryId(entry))) changed = true;
    }
    const preservedMapping = new Set(evidence.fileManifests.filter((item) => !manifestRemovals.has(archiveVersionIdentity(item)))
      .flatMap((file) => file.manifest.entries.map(entryId)));
    for (const file of manifestCandidates) if (manifestRemovals.has(archiveVersionIdentity(file))
      && !file.manifest.entries.every((entry) => objectCandidates.has(entryId(entry)) || preservedMapping.has(entryId(entry)))) {
      manifestRemovals.delete(archiveVersionIdentity(file)); changed = true;
    }
    if (!changed) break;
  }
  for (const object of metadata.historicalMapping.objectVersions) {
    const id = archiveVersionIdentity(object);
    if (objectCandidates.has(id)) removals.push({ key: object.key, versionId: object.versionId,
      identitySha256: canonicalSha256(object), basis: "ALL_VERIFIED_REFERENCE_RETENTION_EXPIRED" });
    else retained.push({ key: object.key, versionId: object.versionId, reason: pins.has(id) ? "DATABASE_PIN" : "CURRENT_OR_UNRESOLVED_RETENTION" });
  }
  for (const file of evidence.fileManifests) {
    const safe = manifestRemovals.has(archiveVersionIdentity(file));
    if (safe) removals.push({ key: file.key, versionId: file.versionId, identitySha256: canonicalSha256(file), basis: "SEVEN_DAYS_AND_VERIFIED_REPLACEMENT" });
    else retained.push({ key: file.key, versionId: file.versionId, reason: pins.has(archiveVersionIdentity(file)) ? "DATABASE_PIN" : "CURRENT_OR_REQUIRED_HISTORY" });
  }
  // Remove expiring mappings before bytes. If execution is interrupted and the
  // remaining intent is canceled, leftover unmapped bytes are preserved; no
  // kept manifest is ever stranded with a removed required version.
  removals.sort((a, b) => Number(b.key.startsWith("manifests/")) - Number(a.key.startsWith("manifests/"))
    || (archiveVersionIdentity(a) < archiveVersionIdentity(b) ? -1 : archiveVersionIdentity(a) > archiveVersionIdentity(b) ? 1 : 0));
  // Bound each invocation. Retain remaining candidates; never take only half the
  // file/mapping removal plan without recalculating what history is still needed.
  requireValue(removals.length <= 1000, "REMOVAL_LIMIT");
  const plan = { schemaVersion: "applypack-protected-recovery-execution-plan-v1", runId: run.id, releaseSha,
    archive: evidence.archive, sourceStartedAt: first.startedAt, inventoryDigest: first.inventoryDigest, providerProofDigest: proof.digest,
    providerComparisonDigest: comparable(evidence), checkpoint, removals, retained, databaseDeletionAuthorized: false };
  return { plan, digest: canonicalSha256(plan) };
}

/** Exact-version only. The dedicated retention client cannot read private blobs,
 * write an object, remove a key without its version, or target database archives. */
export function createRetentionVersionDeleter(client) {
  const reader = createRetentionVersionReader(client);
  return Object.freeze({
    async remove({ key, versionId, signal }) {
      requireValue(permitted(key) && version(versionId) && signal instanceof AbortSignal && !signal.aborted, "DELETE_IDENTITY");
      await client.send(new DeleteObjectCommand({ Bucket: bucket, ExpectedBucketOwner: "838445019912", Key: key, VersionId: versionId }), { abortSignal: signal });
      // The acknowledgement is not evidence of absence. The executor separately
      // observes a complete version listing, even after a lost delete response.
    },
    async observeAbsence({ key, versionId, signal }) {
      requireValue(permitted(key) && version(versionId), "OBSERVE_IDENTITY");
      const listed = await reader.listVersions({ signal });
      return { key, versionId, absent: !listed.some((v) => v.key === key && v.versionId === versionId),
        observedVersionsSha256: canonicalSha256(listed) };
    },
  });
}

/** Ports are the fixed authenticated lifecycle API, independent evidence reader
 * and dedicated deletion identity. No imported plan or verification flag is
 * accepted. Any unconfirmed dispatch leaves the durable fence in place. */
export async function executeProtectedRecoveryRetention({ lifecycle, evidenceReader, deleter, releaseSha, runId,
  now = Date.now, maximumRunMilliseconds = 300000 }) {
  requireValue(Number.isInteger(maximumRunMilliseconds) && maximumRunMilliseconds > 0 && maximumRunMilliseconds <= 300000, "TIME_LIMIT");
  const controller = new AbortController(); const signal = controller.signal; const timer = setTimeout(() => controller.abort(), maximumRunMilliseconds);
  const deadline = now() + maximumRunMilliseconds; let run; let planned; let dispatched = false;
  const check = () => requireValue(!signal.aborted && now() < deadline, "TIMEOUT");
  const wait = async (operation) => {
    check(); let listener;
    try {
      const result = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        listener = () => reject(new Error("PROTECTED_RECOVERY_RETENTION_EXECUTE_TIMEOUT")); signal.addEventListener("abort", listener, { once: true });
      })]); check(); return result;
    } finally { if (listener) signal.removeEventListener("abort", listener); }
  };
  try {
    run = await wait(() => lifecycle.begin({ runId, releaseSha, signal }));
    requireValue(run?.id === runId && run.release_sha === releaseSha && run.state === "FENCED", "BEGIN_BINDING");
    const first = await wait(() => lifecycle.inventory({ runId, signal }));
    const proof = await wait(() => evidenceReader.read({ signal }));
    const second = await wait(() => lifecycle.inventory({ runId, signal }));
    const checkpoint = await wait(() => lifecycle.checkpoint({ runId, signal }));
    planned = buildAuthenticatedRetentionPlan({ proof, first, second, checkpoint, run, releaseSha, now: now() });
    const confirm = await wait(() => evidenceReader.read({ signal }));
    requireValue(comparable(authenticatedArchiveEvidence(confirm)) === planned.plan.providerComparisonDigest, "ARCHIVE_CHANGED");
    const accepted = await wait(() => lifecycle.plan({ runId, firstReceipt: first.receipt, secondReceipt: second.receipt,
      plan: planned.plan, digest: planned.digest, signal }));
    requireValue(accepted?.id === runId && accepted.state === "PLANNED" && accepted.plan_sha256 === planned.digest, "PLAN_ACKNOWLEDGEMENT");
    for (const item of planned.plan.removals) {
      check();
      dispatched = true;
      const dispatch = await wait(() => lifecycle.dispatch({ runId, key: item.key, versionId: item.versionId, planSha256: planned.digest, signal }));
      requireValue(dispatch?.run_id === runId && dispatch.archive_key === item.key && dispatch.version_id === item.versionId
        && dispatch.identity_sha256 === item.identitySha256 && dispatch.state === "DISPATCHED", "DISPATCH_ACKNOWLEDGEMENT");
      try { await wait(() => deleter.remove({ ...item, signal })); } catch { check(); }
      const observation = await wait(() => deleter.observeAbsence({ ...item, signal }));
      requireValue(observation?.key === item.key && observation.versionId === item.versionId && observation.absent === true
        && /^[a-f0-9]{64}$/u.test(observation.observedVersionsSha256 || ""), "ABSENCE_NOT_PROVEN");
      const saved = await wait(() => lifecycle.observe({ runId, key: item.key, versionId: item.versionId,
        observationSha256: canonicalSha256(observation), signal }));
      requireValue(saved?.run_id === runId && saved.archive_key === item.key && saved.version_id === item.versionId && saved.state === "ABSENT", "OBSERVATION_ACKNOWLEDGEMENT");
      dispatched = false;
    }
    const completed = await wait(() => lifecycle.finish({ runId, planSha256: planned.digest, cancel: false, signal }));
    requireValue(completed?.id === runId && completed.state === "COMPLETE" && completed.plan_sha256 === planned.digest, "COMPLETION_ACKNOWLEDGEMENT");
    return { status: "EXACT_VERSIONS_ABSENT", runId, planSha256: planned.digest,
      deletedVersionCount: planned.plan.removals.length, retainedVersionCount: planned.plan.retained.length, databaseDeletionPerformed: false };
  } catch {
    // Never blind-retry a mutation, automatically release an uncertain fence,
    // or emit a successful completion heartbeat on a partial run.
    if (run && !dispatched && !signal.aborted) {
      try { await wait(() => lifecycle.finish({ runId, planSha256: planned?.digest ?? null, cancel: true, signal })); } catch { /* Durable state remains authoritative. */ }
    }
    fail("RECONCILIATION_REQUIRED");
  } finally { clearTimeout(timer); controller.abort(); }
}

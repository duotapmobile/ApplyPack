import { S3Client, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { awsRetentionWorkloadCredentials, RETENTION_WORKLOAD, validateRetentionRolesAnywhereConfiguration } from "./aws-retention-workload-credentials.mjs";
import { RECOVERY_ARCHIVE_BUCKET } from "./protected-recovery-s3.mjs";
import { RECOVERY_BUCKETS, RECOVERY_LIMITS, recoveryInventorySchema } from "./protected-recovery-protocol.mjs";
import { RECOVERY, canonicalBytes, canonicalSha256, sha256, validateInventory, validateManifest } from "./protected-recovery-core.mjs";
import { boundedRecoveryJson } from "./protected-recovery-transport.mjs";

const objectKey = new RegExp(`^objects/(?:${RECOVERY_BUCKETS.join("|")})/[a-f0-9]{64}$`, "u");
const manifestKey = /^manifests\/[a-f0-9]{64}\.json$/u;
const versionId = (value) => typeof value === "string" && value !== "null" && value.length <= 1024 && /^[A-Za-z0-9._~+/=:-]+$/u.test(value);
const identity = (value) => `${value.key}\u0000${value.versionId}`;
const objectIdentity = (value) => `${value.bucket}\u0000${value.key}`;
const fail = (code) => { throw new Error(`PROTECTED_RECOVERY_RETENTION_PLAN_${code}`); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const maximumVersions = 20000;
const manifestLifetime = 7 * 86400000;
export const RETENTION_EVIDENCE_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, manifests: 10000, entries: 200000 });
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const referenceIdentity = (value) => `${value.table}\u0000${value.id}\u0000${value.field}`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const ordered = (rows) => rows.sort((a, b) => identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0);

/** Private, operator-supplied metadata only; this does not authenticate provider bytes. */
export function parseRetentionManifestEvidence(bytes) {
  requireValue(bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= RETENTION_EVIDENCE_LIMITS.bytes, "EVIDENCE_LIMIT");
  const evidence = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  requireValue(Array.isArray(evidence) && evidence.length <= RETENTION_EVIDENCE_LIMITS.manifests, "EVIDENCE_SHAPE");
  let entries = 0;
  for (const item of evidence) {
    requireValue(exact(item, ["digest", "versionId", "manifest"]) && versionId(item.versionId), "EVIDENCE_SHAPE");
    validateManifest(item.manifest, item.digest);
    entries += item.manifest.entries.length + item.manifest.inventory.references.length;
    requireValue(entries <= RETENTION_EVIDENCE_LIMITS.entries, "EVIDENCE_GRAPH_LIMIT");
  }
  return evidence;
}

function mapHistoricalRetention({ inventory, versions, manifestEvidence, releaseSha, now }) {
  requireValue(Array.isArray(manifestEvidence) && manifestEvidence.length <= RETENTION_EVIDENCE_LIMITS.manifests
    && canonicalBytes(manifestEvidence).byteLength <= RETENTION_EVIDENCE_LIMITS.bytes, "EVIDENCE_LIMIT");
  const listed = new Map(versions.map((entry) => [identity(entry), entry]));
  const currentObjects = new Map(inventory.objects.map((entry) => [objectIdentity(entry), entry]));
  const currentReferences = new Map(inventory.references.map((entry) => [referenceIdentity(entry), entry]));
  const currentReferenceProtection = new Map();
  for (const reference of inventory.references) {
    const id = objectIdentity(reference);
    const protection = currentReferenceProtection.get(id) ?? { referenceCount: 0, unboundedReferenceCount: 0 };
    protection.referenceCount++;
    if (reference.retentionExpiresAt === null) protection.unboundedReferenceCount++;
    currentReferenceProtection.set(id, protection);
  }
  const restrictions = new Map();
  for (const tombstone of inventory.tombstones) {
    const id = objectIdentity(tombstone);
    if (!restrictions.has(id)) restrictions.set(id, []);
    restrictions.get(id).push(tombstone);
  }
  const mapped = new Map(); const claims = new Map(); const seen = new Set(); const manifests = [];
  let archiveDigest; let totalEntries = 0;
  for (const evidence of manifestEvidence) {
    requireValue(exact(evidence, ["digest", "versionId", "manifest"]) && versionId(evidence.versionId), "EVIDENCE_SHAPE");
    const manifest = validateManifest(evidence.manifest, evidence.digest);
    const key = `manifests/${evidence.digest}.json`; const id = identity({ key, versionId: evidence.versionId });
    const stored = listed.get(id);
    requireValue(stored && !seen.has(id) && stored.size === canonicalBytes(manifest).byteLength
      // ListObjectVersions can report whole seconds; do not reject a valid
      // same-second publication solely because the manifest records milliseconds.
      && Math.floor(Date.parse(manifest.createdAt) / 1000) <= Math.floor(Date.parse(stored.lastModified) / 1000)
      && Date.parse(manifest.createdAt) <= Date.parse(inventory.startedAt), "MANIFEST_LIST_BINDING");
    seen.add(id);
    const archive = canonicalSha256(manifest.archive);
    requireValue(!archiveDigest || archiveDigest === archive, "MANIFEST_ARCHIVE_CONFLICT"); archiveDigest = archive;
    totalEntries += manifest.entries.length + manifest.inventory.references.length;
    requireValue(totalEntries <= RETENTION_EVIDENCE_LIMITS.entries, "EVIDENCE_GRAPH_LIMIT");
    const historicalObjects = new Map(manifest.inventory.objects.map((entry) => [objectIdentity(entry), entry]));
    const historicalReferences = new Map();
    for (const reference of manifest.inventory.references) {
      const objectId = objectIdentity(reference);
      if (!historicalReferences.has(objectId)) historicalReferences.set(objectId, []);
      historicalReferences.get(objectId).push(reference);
    }
    const missingArchiveVersions = [];
    for (const entry of manifest.entries) {
      const version = { key: entry.archiveKey, versionId: entry.archiveVersionId };
      const objectId = objectIdentity(entry); const sourceObject = historicalObjects.get(objectId);
      const claim = canonicalSha256({ bucket: entry.bucket, key: entry.key, sourceVersion: entry.sourceVersion, size: entry.size, sha256: entry.sha256 });
      requireValue(!claims.has(entry.archiveKey) || claims.get(entry.archiveKey) === claim, "ARCHIVE_VERSION_CONFLICT");
      claims.set(entry.archiveKey, claim);
      const archived = listed.get(identity(version));
      if (!archived) missingArchiveVersions.push(version);
      else requireValue(archived.size === entry.size && Date.parse(archived.lastModified) <= Date.parse(stored.lastModified), "ARCHIVE_LIST_BINDING");
      const references = (historicalReferences.get(objectId) ?? []).map((reference) => {
        const current = currentReferences.get(referenceIdentity(reference));
        return { table: reference.table, id: reference.id, field: reference.field,
          retentionExpiresAt: reference.retentionExpiresAt,
          currentRetention: current ? { retentionExpiresAt: current.retentionExpiresAt } : null,
          currentRelationship: !current ? "ABSENT" : objectIdentity(current) !== objectId ? "REPLACED_PATH"
            : currentObjects.get(objectId)?.sourceVersion !== entry.sourceVersion ? "REPLACED_VERSION" : "UNCHANGED_VERSION" };
      });
      const historical = { manifestDigest: evidence.digest, manifestVersionId: evidence.versionId,
        bucket: entry.bucket, key: entry.key, sourceVersion: entry.sourceVersion, sha256: entry.sha256,
        retentionExpiresAt: sourceObject.retentionExpiresAt, references,
        latestRestrictions: restrictions.get(objectId) ?? [],
        currentPathRetention: currentObjects.has(objectId) ? {
          sourceVersion: currentObjects.get(objectId).sourceVersion, retentionExpiresAt: currentObjects.get(objectId).retentionExpiresAt,
          ...(currentReferenceProtection.get(objectId) ?? { referenceCount: 0, unboundedReferenceCount: 0 }),
        } : null,
        unboundedOrHeldRetention: sourceObject.retentionExpiresAt === null || references.some((reference) => reference.retentionExpiresAt === null)
          || currentObjects.get(objectId)?.retentionExpiresAt === null
          || (currentReferenceProtection.get(objectId)?.unboundedReferenceCount ?? 0) > 0 };
      if (!mapped.has(identity(version))) mapped.set(identity(version), []);
      mapped.get(identity(version)).push(historical);
    }
    const reasons = [];
    if (manifest.inventory.releaseSha !== releaseSha) reasons.push("RELEASE_MISMATCH");
    if (manifest.inventory.inventoryDigest !== inventory.inventoryDigest) reasons.push("CURRENT_GRAPH_MISMATCH");
    if (now - Date.parse(manifest.watermark) > RECOVERY.maximumCheckpointAgeMilliseconds) reasons.push("CHECKPOINT_STALE");
    if (missingArchiveVersions.length) reasons.push("ARCHIVE_VERSIONS_MISSING");
    if (inventory.objects.some((object) => object.retentionExpiresAt !== null && Date.parse(object.retentionExpiresAt) <= now)
      || inventory.references.some((reference) => reference.retentionExpiresAt !== null && Date.parse(reference.retentionExpiresAt) <= now)
      || inventory.tombstones.some((tombstone) => currentObjects.has(objectIdentity(tombstone)))) reasons.push("CURRENT_RETENTION_RESTRICTIONS");
    manifests.push({ key, versionId: evidence.versionId, digest: evidence.digest, watermark: manifest.watermark,
      sourceReleaseSha: manifest.inventory.releaseSha, referenceCount: manifest.inventory.references.length,
      missingArchiveVersions: ordered(missingArchiveVersions), replacementMetadataReasons: reasons });
  }
  const missingManifests = ordered(versions.filter((entry) => manifestKey.test(entry.key) && !seen.has(identity(entry))));
  const objectVersions = ordered(versions.filter((entry) => objectKey.test(entry.key)).map((entry) => {
    const historical = mapped.get(identity(entry)) ?? [];
    historical.sort((a, b) => compare(`${a.manifestDigest}\u0000${a.manifestVersionId}`, `${b.manifestDigest}\u0000${b.manifestVersionId}`));
    return { ...entry, preservation: "RETAIN", mappingStatus: historical.length ? "HISTORICAL_METADATA_MAPPED" : "UNMAPPED_PRESERVE", historical };
  }));
  const candidates = manifests.filter((entry) => entry.replacementMetadataReasons.length === 0)
    .sort((a, b) => Date.parse(b.watermark) - Date.parse(a.watermark) || compare(identity(a), identity(b)));
  const replacement = missingManifests.length === 0 ? candidates[0] : null;
  return { status: manifestEvidence.length ? "IMPORTED_METADATA_VALIDATED" : "NO_IMPORTED_METADATA",
    manifestCoverage: { listed: versions.filter((entry) => manifestKey.test(entry.key)).length,
      supplied: manifests.length, missing: missingManifests },
    manifests: ordered(manifests), objectVersions,
    replacementCheckpoint: { status: missingManifests.length ? "INCOMPLETE_MANIFEST_EVIDENCE"
      : replacement ? "METADATA_VERIFIED_ONLY" : "NO_MATCHING_CURRENT_CHECKPOINT",
    manifestDigest: replacement?.digest ?? null, manifestVersionId: replacement?.versionId ?? null,
    providerBytesVerified: false, applicationCompletionVerified: false, hostedRestoreVerified: false },
    allVersionsPreserved: true };
}

async function waitFor(promise, signal) {
  requireValue(signal instanceof AbortSignal && !signal.aborted, "ABORTED");
  let listener;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      listener = () => reject(new Error("PROTECTED_RECOVERY_RETENTION_PLAN_ABORTED"));
      signal.addEventListener("abort", listener, { once: true });
    })]);
  } finally { if (listener) signal.removeEventListener("abort", listener); }
}

/** Read-only inventory. This module contains no provider mutation or deletion operation. */
export function createRetentionVersionReader(client) {
  return { async listVersions({ signal }) {
    const versions = []; const seen = new Set();
    for (const prefix of ["objects/", "manifests/"]) {
      let keyMarker; let versionMarker; const markers = new Set();
      for (;;) {
        const response = await waitFor(client.send(new ListObjectVersionsCommand({ Bucket: RECOVERY_ARCHIVE_BUCKET, Prefix: prefix,
          ExpectedBucketOwner: RETENTION_WORKLOAD.account, MaxKeys: 1000,
          ...(keyMarker ? { KeyMarker: keyMarker, VersionIdMarker: versionMarker } : {}) }), { abortSignal: signal }), signal);
        requireValue(response?.Name === RECOVERY_ARCHIVE_BUCKET && response.Prefix === prefix && typeof response.IsTruncated === "boolean"
          && (response.Versions === undefined || Array.isArray(response.Versions))
          && (response.DeleteMarkers === undefined || Array.isArray(response.DeleteMarkers) && response.DeleteMarkers.length === 0), "LIST_SHAPE");
        const page = response.Versions ?? []; requireValue(page.length <= 1000, "LIST_LIMIT");
        for (const item of page) {
          requireValue((prefix === "objects/" ? objectKey : manifestKey).test(item?.Key || "") && versionId(item.VersionId)
            && typeof item.IsLatest === "boolean" && item.LastModified instanceof Date && Number.isFinite(item.LastModified.getTime())
            && Number.isSafeInteger(item.Size) && item.Size > 0 && item.Size <= (prefix === "objects/" ? RECOVERY_LIMITS.objectBytes : 16 * 1024 * 1024), "VERSION_SHAPE");
          const entry = { key: item.Key, versionId: item.VersionId, lastModified: item.LastModified.toISOString(), size: item.Size };
          requireValue(!seen.has(identity(entry)), "VERSION_DUPLICATE"); seen.add(identity(entry)); versions.push(entry);
          requireValue(versions.length <= maximumVersions, "VERSION_LIMIT");
        }
        if (!response.IsTruncated) { requireValue(!response.NextKeyMarker && !response.NextVersionIdMarker, "LIST_MARKER"); break; }
        requireValue(page.length > 0 && typeof response.NextKeyMarker === "string"
          && (prefix === "objects/" ? objectKey : manifestKey).test(response.NextKeyMarker)
          && versionId(response.NextVersionIdMarker), "LIST_MARKER");
        const marker = `${response.NextKeyMarker}\u0000${response.NextVersionIdMarker}`;
        requireValue(!markers.has(marker), "LIST_LOOP"); markers.add(marker);
        keyMarker = response.NextKeyMarker; versionMarker = response.NextVersionIdMarker;
      }
    }
    return versions.sort((a, b) => identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0);
  }, close: () => client.destroy() };
}

export function planRecoveryRetention({ inventory, versions, releaseSha, manifestEvidence = [], now = Date.now() }) {
  validateInventory(inventory, { releaseSha, now });
  requireValue(Array.isArray(versions) && versions.length <= maximumVersions, "VERSION_LIMIT");
  const blocked = new Set(inventory.tombstones.map(objectIdentity));
  const allowed = new Set(inventory.objects.filter((object) => !blocked.has(objectIdentity(object))
    && (object.retentionExpiresAt === null || Date.parse(object.retentionExpiresAt) > now))
    .map((object) => `objects/${object.bucket}/${sha256(`${objectIdentity(object)}\u0000${object.sourceVersion}`)}`));
  const retainedVersions = []; const unresolvedObjectVersions = []; const expiredManifestCandidates = []; const seen = new Set();
  for (const entry of versions) {
    requireValue(entry && Object.keys(entry).sort().join("|") === "key|lastModified|size|versionId"
      && (objectKey.test(entry.key) || manifestKey.test(entry.key)) && versionId(entry.versionId)
      && typeof entry.lastModified === "string" && Number.isFinite(Date.parse(entry.lastModified)) && Date.parse(entry.lastModified) <= now
      && Number.isSafeInteger(entry.size) && entry.size > 0
      && entry.size <= (objectKey.test(entry.key) ? RECOVERY_LIMITS.objectBytes : 16 * 1024 * 1024)
      && !seen.has(identity(entry)), "PLAN_VERSION");
    seen.add(identity(entry));
    // An upload after this complete snapshot began might still be getting its first reference.
    const oldEnough = Date.parse(entry.lastModified) < Date.parse(inventory.startedAt);
    // Absence from the latest inventory does not prove an older paid or held version
    // may be erased. Historical manifest references and a deletion basis are required.
    if (objectKey.test(entry.key) && !allowed.has(entry.key)) unresolvedObjectVersions.push(entry);
    if (oldEnough && manifestKey.test(entry.key) && Date.parse(entry.lastModified) <= now - manifestLifetime) expiredManifestCandidates.push(entry);
    // Listing alone cannot establish that another usable checkpoint remains.
    // Preserve even old manifests until a verified replacement is supplied.
    retainedVersions.push(entry);
  }
  const historicalMapping = mapHistoricalRetention({ inventory, versions, manifestEvidence, releaseSha, now });
  const plan = { schemaVersion: "applypack-protected-recovery-retention-plan-v1", status: "READ_ONLY_NOT_AUTHORIZED_TO_DELETE",
    bucket: RECOVERY_ARCHIVE_BUCKET, releaseSha, sourceStartedAt: inventory.startedAt, inventoryDigest: inventory.inventoryDigest,
    proposedRemovals: [], retainedVersions: ordered(retainedVersions),
    unresolvedObjectVersions: ordered(unresolvedObjectVersions),
    expiredManifestCandidates: ordered(expiredManifestCandidates), historicalMapping,
    objectDeletionBasis: "HISTORICAL_MANIFEST_AND_RETENTION_MAPPING_REQUIRED",
    manifestDeletionBasis: "VERIFIED_REPLACEMENT_REQUIRED", providerMutationPerformed: false };
  return { plan, digest: canonicalSha256(plan) };
}

export async function inspectRecoveryRetention({ source, archive, releaseSha, manifestEvidence = [], now = Date.now,
  maximumRunMilliseconds = RECOVERY_LIMITS.runMilliseconds }) {
  requireValue(Number.isInteger(maximumRunMilliseconds) && maximumRunMilliseconds > 0 && maximumRunMilliseconds <= RECOVERY_LIMITS.runMilliseconds, "TIME_LIMIT");
  const controller = new AbortController(); const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), maximumRunMilliseconds);
  try {
    const first = await waitFor(source.readInventory({ signal }), signal);
    validateInventory(first, { releaseSha, now: now() });
    const versions = await waitFor(archive.listVersions({ signal }), signal);
    const second = await waitFor(source.readInventory({ signal }), signal);
    validateInventory(second, { releaseSha, now: now() });
    requireValue(first.inventoryDigest === second.inventoryDigest && Date.parse(second.startedAt) >= Date.parse(first.completedAt)
      && now() - Date.parse(first.startedAt) <= maximumRunMilliseconds, "SOURCE_CHANGED");
    const result = planRecoveryRetention({ inventory: first, versions, releaseSha, manifestEvidence, now: now() });
    requireValue(!signal.aborted && now() - Date.parse(first.startedAt) <= maximumRunMilliseconds, "SOURCE_CHANGED");
    return result;
  } finally { clearTimeout(timer); controller.abort(); }
}

export function createProtectedRecoveryRetentionPlanReader(environment = process.env, fetchImpl = fetch) {
  validateRetentionRolesAnywhereConfiguration(environment);
  const releaseSha = environment.APP_EXPECTED_RELEASE_SHA; const secret = environment.APP_RECOVERY_RETENTION_SECRET;
  requireValue(environment.APP_BASE_URL === "https://applypack.work" && /^[a-f0-9]{40}$/u.test(releaseSha || "")
    && environment.RAILWAY_GIT_COMMIT_SHA === releaseSha && environment.APP_BACKUP_BUCKET === RECOVERY_ARCHIVE_BUCKET, "IDENTITY");
  requireValue(typeof secret === "string" && /^[A-Za-z0-9_+/=-]{43,256}$/u.test(secret), "CAPABILITY");
  for (const name of ["APP_RECOVERY_READER_SECRET", "APP_RECOVERY_COMPLETION_SECRET", "APP_RECOVERY_RECEIPT_SECRET", "CRON_SECRET"])
    requireValue(!environment[name], "OTHER_CAPABILITY_FORBIDDEN");
  const client = new S3Client({ region: RETENTION_WORKLOAD.region, credentials: awsRetentionWorkloadCredentials(environment),
    endpoint: `https://s3.${RETENTION_WORKLOAD.region}.amazonaws.com`, forcePathStyle: true, maxAttempts: 1 });
  return { releaseSha, archive: createRetentionVersionReader(client), source: { async readInventory({ signal }) {
    const response = await fetchImpl("https://applypack.work/api/internal/protected-recovery/inventory", { method: "GET", signal,
      redirect: "error", cache: "no-store", credentials: "omit", headers: { authorization: `Bearer ${secret}`, accept: "application/json" } });
    return recoveryInventorySchema.parse(await boundedRecoveryJson(response, RECOVERY_LIMITS.inventoryBytes));
  } } };
}

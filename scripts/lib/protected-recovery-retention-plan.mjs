import { S3Client, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { awsRetentionWorkloadCredentials, RETENTION_WORKLOAD, validateRetentionRolesAnywhereConfiguration } from "./aws-retention-workload-credentials.mjs";
import { RECOVERY_ARCHIVE_BUCKET } from "./protected-recovery-s3.mjs";
import { RECOVERY_BUCKETS, RECOVERY_LIMITS, recoveryInventorySchema } from "./protected-recovery-protocol.mjs";
import { canonicalSha256, sha256, validateInventory } from "./protected-recovery-core.mjs";
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

export function planRecoveryRetention({ inventory, versions, releaseSha, now = Date.now() }) {
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
      && Number.isSafeInteger(entry.size) && entry.size > 0 && !seen.has(identity(entry)), "PLAN_VERSION");
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
  const sorted = (rows) => rows.sort((a, b) => identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0);
  const plan = { schemaVersion: "applypack-protected-recovery-retention-plan-v1", status: "READ_ONLY_NOT_AUTHORIZED_TO_DELETE",
    bucket: RECOVERY_ARCHIVE_BUCKET, releaseSha, sourceStartedAt: inventory.startedAt, inventoryDigest: inventory.inventoryDigest,
    proposedRemovals: [], retainedVersions: sorted(retainedVersions),
    unresolvedObjectVersions: sorted(unresolvedObjectVersions),
    expiredManifestCandidates: sorted(expiredManifestCandidates),
    objectDeletionBasis: "HISTORICAL_MANIFEST_AND_RETENTION_MAPPING_REQUIRED",
    manifestDeletionBasis: "VERIFIED_REPLACEMENT_REQUIRED", providerMutationPerformed: false };
  return { plan, digest: canonicalSha256(plan) };
}

export async function inspectRecoveryRetention({ source, archive, releaseSha, now = Date.now,
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
    return planRecoveryRetention({ inventory: first, versions, releaseSha, now: now() });
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

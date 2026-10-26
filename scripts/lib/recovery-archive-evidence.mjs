import { GetObjectCommand, HeadObjectCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { canonicalSha256 } from "./protected-recovery-core.mjs";
import { readHistoricalArchiveManifest, archiveVersionIdentity, mapDatabaseArchivePins } from "./recovery-archive-history.mjs";
import { createRetentionVersionReader } from "./protected-recovery-retention-plan.mjs";

const bucket = "applypack-production-protected-recovery-838445019912";
const account = "838445019912";
const roles = Object.freeze({ operator: `arn:aws:sts::${account}:assumed-role/applypack-production-recovery-reader/`,
  verifier: `arn:aws:sts::${account}:assumed-role/applypack-production-archive-verifier/` });
const scopes = ["objects/", "manifests/", "database/manifests/", "database/dumps/", "database/roles/"];
const version = (value) => typeof value === "string" && value !== "null" && /^[A-Za-z0-9._~+/=:-]{1,1024}$/u.test(value);
const validKey = (key) => /^(?:objects\/(?:customer-source-documents|customer-deliveries|operator-drafts|operator-render-previews)\/[a-f0-9]{64}|(?:database\/)?manifests\/[a-f0-9]{64}\.json|database\/dumps\/[a-f0-9]{64}\.dump|database\/roles\/[a-f0-9]{64}\.json)$/u.test(key || "");
const proofs = new WeakMap();
const fail = (code) => { throw new Error(`RECOVERY_ARCHIVE_EVIDENCE_${code}`); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const active = (signal) => requireValue(signal instanceof AbortSignal && !signal.aborted, "ABORTED");
async function wait(operation, signal) {
  active(signal); let listener;
  try {
    const value = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      listener = () => reject(new Error("RECOVERY_ARCHIVE_EVIDENCE_ABORTED")); signal.addEventListener("abort", listener, { once: true });
    })]); active(signal); return value;
  } finally { if (listener) signal.removeEventListener("abort", listener); }
}
async function collect(response, maximum, signal) {
  requireValue(Number.isSafeInteger(response.ContentLength) && response.ContentLength > 0 && response.ContentLength <= maximum, "BODY_LIMIT");
  const bytes = Buffer.alloc(response.ContentLength); let offset = 0; let iterator;
  try {
    if (response.Body instanceof Uint8Array) { requireValue(response.Body.length === bytes.length, "BODY_LENGTH"); bytes.set(response.Body); offset = bytes.length; }
    else {
      requireValue(response.Body && typeof response.Body[Symbol.asyncIterator] === "function", "BODY_STREAM");
      iterator = response.Body[Symbol.asyncIterator]();
      for (;;) {
        const next = await wait(() => iterator.next(), signal); if (next.done) break;
        requireValue(next.value instanceof Uint8Array && offset + next.value.length <= bytes.length, "BODY_LENGTH");
        bytes.set(next.value, offset); offset += next.value.length;
      }
    }
    active(signal); requireValue(offset === bytes.length, "BODY_LENGTH"); return bytes;
  } catch (error) { bytes.fill(0); throw error; }
  finally { response.Body?.destroy?.(); if (iterator?.return) Promise.resolve(iterator.return()).catch(() => {}); }
}
function assertResponse(response, target, archive, digest) {
  requireValue(response?.VersionId === target.versionId && response.ContentLength === target.size
    && response.ServerSideEncryption === "aws:kms" && response.SSEKMSKeyId === archive.kmsKeyArn && response.BucketKeyEnabled !== true
    && response.DeleteMarker !== true && /^[A-Za-z0-9+/]{43}=$/u.test(response.ChecksumSHA256 || "")
    && Buffer.from(response.ChecksumSHA256, "base64").toString("hex") === digest
    && (response.ChecksumType === undefined || response.ChecksumType === "FULL_OBJECT"), "EXACT_VERSION_CHECKSUM");
}

/** Independent read-role transport, with injected SDK clients for fictional tests.
 * It performs no mutation and returns a process-local capability; imported JSON
 * or a caller-supplied `verified: true` cannot become an authenticated proof. */
export function createArchiveEvidenceReader({ s3, sts, archive, identity = "operator", now = Date.now }) {
  requireValue(archive?.bucket === bucket && /^arn:aws:kms:us-east-1:838445019912:key\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(archive.kmsKeyArn || ""), "ARCHIVE_IDENTITY");
  const bound = Object.freeze({ ...archive });
  requireValue(Object.hasOwn(roles, identity), "READER_MODE"); const role = roles[identity];
  const authenticate = async (signal) => {
    active(signal);
    const identity = await wait(() => sts.send(new GetCallerIdentityCommand({}), { abortSignal: signal }), signal);
    requireValue(identity?.Account === account && identity.Arn?.startsWith(role)
      && /^[A-Za-z0-9+=,.@_-]{1,64}$/u.test(identity.Arn.slice(role.length)), "READER_IDENTITY");
    return identity;
  };
  return Object.freeze({
   async observeAbsence({ key, versionId, signal }) {
    requireValue(/^(?:objects\/(?:customer-source-documents|customer-deliveries|operator-drafts|operator-render-previews)\/[a-f0-9]{64}|manifests\/[a-f0-9]{64}\.json)$/u.test(key || "") && version(versionId), "ABSENCE_SCOPE");
    await authenticate(signal);
    const versions = await createRetentionVersionReader(s3).listVersions({ signal });
    active(signal);
    return { key, versionId, absent: !versions.some((item) => item.key === key && item.versionId === versionId),
      observedVersionsSha256: canonicalSha256(versions) };
   },
   async read({ signal }) {
    active(signal); const startedAt = now(); const identity = await authenticate(signal);
    const versions = []; const seen = new Set();
    for (const prefix of scopes) {
      let keyMarker; let versionMarker; const markers = new Set();
      for (;;) {
        const page = await wait(() => s3.send(new ListObjectVersionsCommand({ Bucket: bucket, ExpectedBucketOwner: account,
          Prefix: prefix, MaxKeys: 1000, ...(keyMarker ? { KeyMarker: keyMarker, VersionIdMarker: versionMarker } : {}) }), { abortSignal: signal }), signal);
        requireValue(page?.Name === bucket && page.Prefix === prefix && typeof page.IsTruncated === "boolean"
          && (page.DeleteMarkers === undefined || Array.isArray(page.DeleteMarkers) && page.DeleteMarkers.length === 0)
          && (page.Versions === undefined || Array.isArray(page.Versions)), "LIST_RESPONSE");
        const values = page.Versions ?? []; requireValue(values.length <= 1000, "LIST_LIMIT");
        for (const value of values) {
          requireValue(validKey(value?.Key) && value.Key.startsWith(prefix) && version(value.VersionId)
            && value.LastModified instanceof Date && Number.isFinite(value.LastModified.getTime()) && value.LastModified.getTime() <= now()
            && typeof value.IsLatest === "boolean" && Number.isSafeInteger(value.Size) && value.Size > 0 && value.Size <= 128 * 1024 * 1024, "LIST_VERSION");
          const item = { key: value.Key, versionId: value.VersionId, size: value.Size, lastModified: value.LastModified.toISOString() };
          requireValue(!seen.has(archiveVersionIdentity(item)) && versions.length < 50000, "LIST_DUPLICATE_OR_LIMIT");
          seen.add(archiveVersionIdentity(item)); versions.push(item);
        }
        if (!page.IsTruncated) { requireValue(!page.NextKeyMarker && !page.NextVersionIdMarker, "LIST_MARKER"); break; }
        requireValue(values.length > 0 && validKey(page.NextKeyMarker) && page.NextKeyMarker.startsWith(prefix)
          && version(page.NextVersionIdMarker), "LIST_MARKER");
        const marker = `${page.NextKeyMarker}\u0000${page.NextVersionIdMarker}`;
        requireValue(!markers.has(marker), "LIST_LOOP"); markers.add(marker); keyMarker = page.NextKeyMarker; versionMarker = page.NextVersionIdMarker;
      }
    }
    const fileManifests = []; const databaseManifests = []; let manifestBytes = 0;
    for (const item of versions.filter((value) => /^(?:database\/)?manifests\//u.test(value.key))) {
      requireValue(fileManifests.length + databaseManifests.length < 10000 && manifestBytes + item.size <= 64 * 1024 * 1024, "HISTORY_LIMIT");
      const digest = item.key.match(/([a-f0-9]{64})\.json$/u)[1]; let bytes;
      const response = await wait(() => s3.send(new GetObjectCommand({ Bucket: bucket, ExpectedBucketOwner: account, Key: item.key,
        VersionId: item.versionId, ChecksumMode: "ENABLED" }), { abortSignal: signal }), signal);
      try {
        assertResponse(response, item, bound, digest); bytes = await collect(response, item.key.startsWith("database/") ? 64 * 1024 : 16 * 1024 * 1024, signal);
        const parsed = readHistoricalArchiveManifest({ bytes, ...item, expectedSize: item.size, expectedSha256: digest });
        requireValue(canonicalSha256(parsed.manifest.archive) === canonicalSha256(bound), "MANIFEST_ARCHIVE");
        manifestBytes += bytes.length; (parsed.kind === "file" ? fileManifests : databaseManifests).push(parsed);
      } finally { bytes?.fill(0); response.Body?.destroy?.(); }
    }
    const claims = new Map();
    for (const file of fileManifests) for (const entry of file.manifest.entries) {
      const target = { key: entry.archiveKey, versionId: entry.archiveVersionId, size: entry.size, sha256: entry.sha256 };
      const id = archiveVersionIdentity(target); const prior = claims.get(id);
      requireValue(!prior || canonicalSha256(prior) === canonicalSha256(target), "VERSION_CONTENT_CONFLICT"); claims.set(id, target);
    }
    for (const database of databaseManifests) for (const entry of [database.manifest.dump, database.manifest.roles]) {
      const target = { key: entry.key, versionId: entry.versionId, size: entry.size, sha256: entry.sha256 };
      const id = archiveVersionIdentity(target); const prior = claims.get(id);
      requireValue(!prior || canonicalSha256(prior) === canonicalSha256(target), "VERSION_CONTENT_CONFLICT"); claims.set(id, target);
    }
    const listed = new Map(versions.map((value) => [archiveVersionIdentity(value), value]));
    for (const target of claims.values()) {
      requireValue(listed.get(archiveVersionIdentity(target))?.size === target.size, "REFERENCE_VERSION_MISSING");
      const response = await wait(() => s3.send(new HeadObjectCommand({ Bucket: bucket, ExpectedBucketOwner: account,
        Key: target.key, VersionId: target.versionId, ChecksumMode: "ENABLED" }), { abortSignal: signal }), signal);
      assertResponse(response, target, bound, target.sha256);
    }
    const graph = mapDatabaseArchivePins({ databaseManifests, fileManifests, versions });
    active(signal);
    const detail = { archive: bound, startedAt, completedAt: now(), versions, fileManifests, databaseManifests, pins: graph.pins,
      readerIdentity: identity.Arn, manifestBytesVerified: true, referencedProviderChecksumsVerified: true,
      privateContentRead: false, applicationCheckpointVerified: false, hostedRestoreVerified: false };
    const token = Object.freeze({ schemaVersion: "applypack-authenticated-archive-evidence-v1", digest: canonicalSha256(detail) });
    proofs.set(token, detail); return token;
  } });
}

export function authenticatedArchiveEvidence(token) {
  const detail = proofs.get(token); requireValue(detail && token.digest === canonicalSha256(detail), "AUTHENTICATED_PROOF_REQUIRED");
  // The consumer receives an isolated copy; mutating it never changes the proof.
  return structuredClone(detail);
}

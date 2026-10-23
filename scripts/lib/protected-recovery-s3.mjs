import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { awsBackupWorkloadCredentials, BACKUP_WORKLOAD, validateBackupRolesAnywhereConfiguration } from "./aws-backup-workload-credentials.mjs";
import { RECOVERY_BUCKETS, RECOVERY_LIMITS } from "./protected-recovery-protocol.mjs";
import { validateManifest } from "./protected-recovery-core.mjs";

export const RECOVERY_ARCHIVE_BUCKET = "applypack-production-protected-recovery-838445019912";
const kmsArn = /^arn:aws:kms:us-east-1:838445019912:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const objectKey = new RegExp(`^objects/(?:${RECOVERY_BUCKETS.join("|")})/[a-f0-9]{64}$`, "u");
const manifestKey = /^manifests\/([a-f0-9]{64})\.json$/u;
const maximumManifestBytes = RECOVERY_LIMITS.inventoryBytes + 8 * 1024 * 1024;
const maximumManifests = 10000;
const fail = (code) => { throw new Error(`PROTECTED_RECOVERY_S3_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const version = (value) => typeof value === "string" && value !== "null" && value.length <= 1024 && /^[A-Za-z0-9._~+/=:-]+$/u.test(value);
const checksum = (value) => typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/u.test(value)
  && Buffer.from(value, "base64").toString("base64") === value;
function assertArchive(archive) {
  requireValue(archive?.bucket === RECOVERY_ARCHIVE_BUCKET && kmsArn.test(archive.kmsKeyArn || ""), "ARCHIVE_IDENTITY");
}
function assertSignal(signal) { requireValue(signal instanceof AbortSignal && !signal.aborted, "ABORTED_OR_MISSING_SIGNAL"); }
function assertEncryption(response, archive) {
  requireValue(response?.ServerSideEncryption === "aws:kms" && response.SSEKMSKeyId === archive.kmsKeyArn
    && response.BucketKeyEnabled !== true, "ENCRYPTION_RESPONSE");
}
async function waitFor(promise, signal) {
  assertSignal(signal);
  let listener;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      listener = () => reject(new Error("PROTECTED_RECOVERY_S3_ABORTED"));
      signal.addEventListener("abort", listener, { once: true });
    })]);
  } finally { if (listener) signal.removeEventListener("abort", listener); }
}
async function collect(body, expectedSize, maximum, signal) {
  assertSignal(signal);
  requireValue(Number.isSafeInteger(expectedSize) && expectedSize > 0 && expectedSize <= maximum, "SIZE");
  let total = 0; let iterator; let complete = false; let bytes;
  try {
    if (body instanceof Uint8Array) {
      requireValue(body.byteLength === expectedSize, "SIZE");
      return Buffer.from(body);
    }
    requireValue(body && typeof body[Symbol.asyncIterator] === "function", "STREAM");
    bytes = Buffer.alloc(expectedSize);
    iterator = body[Symbol.asyncIterator]();
    for (;;) {
      const next = await waitFor(iterator.next(), signal);
      if (next.done) break;
      requireValue(next.value instanceof Uint8Array, "CHUNK");
      total += next.value.byteLength;
      requireValue(total <= expectedSize && total <= maximum, "SIZE");
      bytes.set(next.value, total - next.value.byteLength);
    }
    requireValue(total === expectedSize, "SIZE");
    complete = true;
    return bytes;
  } finally {
    if (!complete) bytes?.fill(0);
    if (!complete && iterator?.return) Promise.resolve(iterator.return()).catch(() => {});
  }
}

export function validateRecoveryArchiveConfiguration(environment = process.env) {
  validateBackupRolesAnywhereConfiguration(environment);
  const archive = { bucket: environment.APP_BACKUP_BUCKET, kmsKeyArn: environment.APP_BACKUP_KMS_KEY_ARN };
  assertArchive(archive);
  return Object.freeze(archive);
}

/** Injectable transport for offline tests; the hosted factory below fixes credentials, region, and endpoint. */
export function createRecoveryS3Transport({ client, archive }) {
  assertArchive(archive);
  const boundArchive = Object.freeze({ bucket: archive.bucket, kmsKeyArn: archive.kmsKeyArn });
  async function write(request, isManifest) {
    let body;
    try {
      assertSignal(request.signal);
      requireValue(request.bucket === boundArchive.bucket && request.kmsKeyId === boundArchive.kmsKeyArn
        && request.serverSideEncryption === "aws:kms" && request.checksumAlgorithm === "SHA256" && request.immutable === true, "WRITE_BINDING");
      requireValue((isManifest ? manifestKey : objectKey).test(request.key || ""), "KEY");
      body = await collect(request.body, request.expectedSize, isManifest ? maximumManifestBytes : RECOVERY_LIMITS.objectBytes, request.signal);
      const digest = sha256(body);
      if (isManifest) {
        requireValue(request.key === `manifests/${digest}.json` && request.checksumSha256 === digest, "MANIFEST_DIGEST");
        validateManifest(JSON.parse(body.toString("utf8")), digest);
      }
      const response = await waitFor(client.send(new PutObjectCommand({ Bucket: boundArchive.bucket, Key: request.key,
        Body: body, ContentLength: body.byteLength, ContentType: isManifest ? "application/json" : "application/octet-stream",
        ExpectedBucketOwner: BACKUP_WORKLOAD.account, ServerSideEncryption: "aws:kms", SSEKMSKeyId: boundArchive.kmsKeyArn,
        BucketKeyEnabled: false, ChecksumAlgorithm: "SHA256", ChecksumSHA256: Buffer.from(digest, "hex").toString("base64") }),
      { abortSignal: request.signal }), request.signal);
      assertEncryption(response, boundArchive);
      requireValue(version(response.VersionId) && checksum(response.ChecksumSHA256)
        && Buffer.from(response.ChecksumSHA256, "base64").toString("hex") === digest
        && (response.ChecksumType === undefined || response.ChecksumType === "FULL_OBJECT"), "WRITE_RECEIPT");
      return { versionId: response.VersionId, checksumSha256: digest, size: body.byteLength };
    } catch { fail("WRITE_FAILED"); }
    finally { body?.fill(0); }
  }

  async function readPreviousManifest({ signal }) {
    let body; let responseBody;
    try {
      assertSignal(signal);
      const seenKeys = new Set(); const seenTokens = new Set();
      let token; let newest;
      for (;;) {
        const page = await waitFor(client.send(new ListObjectsV2Command({ Bucket: boundArchive.bucket, Prefix: "manifests/", MaxKeys: 1000,
          ExpectedBucketOwner: BACKUP_WORKLOAD.account, ...(token ? { ContinuationToken: token } : {}) }), { abortSignal: signal }), signal);
        requireValue(page?.Name === boundArchive.bucket && page.Prefix === "manifests/" && typeof page.IsTruncated === "boolean"
          && Number.isSafeInteger(page.KeyCount) && page.KeyCount >= 0 && page.KeyCount <= 1000
          && (page.Contents === undefined || Array.isArray(page.Contents)), "LIST_RESPONSE");
        const contents = page.Contents ?? [];
        requireValue(page.KeyCount === contents.length, "LIST_COUNT");
        for (const item of contents) {
          requireValue(manifestKey.test(item?.Key || "") && !seenKeys.has(item.Key)
            && item.LastModified instanceof Date && Number.isFinite(item.LastModified.getTime())
            && Number.isSafeInteger(item.Size) && item.Size > 0 && item.Size <= maximumManifestBytes, "LIST_ENTRY");
          seenKeys.add(item.Key);
          requireValue(seenKeys.size <= maximumManifests, "MANIFEST_LIMIT");
          if (!newest || item.LastModified > newest.LastModified || (item.LastModified.getTime() === newest.LastModified.getTime() && item.Key > newest.Key)) newest = item;
        }
        if (!page.IsTruncated) { requireValue(!page.NextContinuationToken, "LIST_TOKEN"); break; }
        requireValue(typeof page.NextContinuationToken === "string" && page.NextContinuationToken.length > 0
          && page.NextContinuationToken.length <= 4096 && !seenTokens.has(page.NextContinuationToken)
          && contents.length > 0 && seenKeys.size < maximumManifests, "LIST_TOKEN");
        token = page.NextContinuationToken; seenTokens.add(token);
      }
      if (!newest) return null;
      const response = await waitFor(client.send(new GetObjectCommand({ Bucket: boundArchive.bucket, Key: newest.Key,
        ExpectedBucketOwner: BACKUP_WORKLOAD.account, ChecksumMode: "ENABLED" }), { abortSignal: signal }), signal);
      responseBody = response.Body;
      assertEncryption(response, boundArchive);
      requireValue(version(response.VersionId) && response.ContentLength === newest.Size && checksum(response.ChecksumSHA256)
        && (response.ChecksumType === undefined || response.ChecksumType === "FULL_OBJECT"), "MANIFEST_RESPONSE");
      body = await collect(responseBody, response.ContentLength, maximumManifestBytes, signal);
      const digest = sha256(body);
      requireValue(newest.Key === `manifests/${digest}.json`
        && Buffer.from(response.ChecksumSHA256, "base64").toString("hex") === digest, "MANIFEST_DIGEST");
      const manifest = JSON.parse(body.toString("utf8"));
      validateManifest(manifest, digest);
      requireValue(manifest.archive.bucket === boundArchive.bucket && manifest.archive.kmsKeyArn === boundArchive.kmsKeyArn, "MANIFEST_ARCHIVE");
      return { manifest, digest };
    } catch { fail("READ_MANIFEST_FAILED"); }
    finally { body?.fill(0); responseBody?.destroy?.(); }
  }
  return Object.freeze({ archive: boundArchive, putObject: (request) => write(request, false),
    publishManifest: (request) => write(request, true), readPreviousManifest, close: () => client.destroy() });
}

export function createProtectedRecoveryDestination(environment = process.env) {
  const archive = validateRecoveryArchiveConfiguration(environment);
  const client = new S3Client({ region: BACKUP_WORKLOAD.region, credentials: awsBackupWorkloadCredentials(environment),
    endpoint: `https://s3.${BACKUP_WORKLOAD.region}.amazonaws.com`, forcePathStyle: true, maxAttempts: 1 });
  return createRecoveryS3Transport({ client, archive });
}

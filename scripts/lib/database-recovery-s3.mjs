import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { awsDatabaseBackupWorkloadCredentials, DATABASE_BACKUP_WORKLOAD, validateDatabaseBackupRolesAnywhereConfiguration } from "./aws-database-backup-workload-credentials.mjs";
import { validateManifest } from "./protected-recovery-core.mjs";
import { DATABASE_RECOVERY_LIMITS, databaseRolesMetadataSchema, validateDatabaseManifest } from "./database-recovery-protocol.mjs";

export const DATABASE_RECOVERY_ARCHIVE_BUCKET = "applypack-production-protected-recovery-838445019912";
const kmsArn = /^arn:aws:kms:us-east-1:838445019912:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const hex = /^[a-f0-9]{64}$/u;
const maximumFileManifestBytes = 16 * 1024 * 1024;
const fail = (code) => { throw new Error(`DATABASE_RECOVERY_S3_${code}`); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const version = (value) => typeof value === "string" && value !== "null" && value.length > 0 && value.length <= 1024
  && /^[A-Za-z0-9._~+/=:-]+$/u.test(value);
const checksum = (value) => typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/u.test(value)
  && Buffer.from(value, "base64").toString("base64") === value;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const parseJson = (bytes) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
function assertArchive(archive) {
  requireValue(archive?.bucket === DATABASE_RECOVERY_ARCHIVE_BUCKET && kmsArn.test(archive.kmsKeyArn || ""), "ARCHIVE_IDENTITY");
}
function assertSignal(signal) { requireValue(signal instanceof AbortSignal && !signal.aborted, "ABORTED_OR_MISSING_SIGNAL"); }
function assertEncryption(response, archive) {
  requireValue(response?.ServerSideEncryption === "aws:kms" && response.SSEKMSKeyId === archive.kmsKeyArn
    && response.BucketKeyEnabled !== true, "ENCRYPTION_RESPONSE");
}
function assertChecksum(response, digest) {
  requireValue(checksum(response?.ChecksumSHA256) && Buffer.from(response.ChecksumSHA256, "base64").toString("hex") === digest
    && (response.ChecksumType === undefined || response.ChecksumType === "FULL_OBJECT"), "CHECKSUM_RESPONSE");
}
async function waitFor(promise, signal) {
  assertSignal(signal);
  let listener;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      listener = () => reject(new Error("DATABASE_RECOVERY_S3_ABORTED"));
      signal.addEventListener("abort", listener, { once: true });
    })]);
  } finally { if (listener) signal.removeEventListener("abort", listener); }
}

// Bounded in-memory collection permits a known checksum and ContentLength before a
// single PutObject. No plaintext dump or multipart state is written to disk.
async function collect(body, maximum, signal, expectedSize) {
  assertSignal(signal);
  requireValue(Number.isSafeInteger(maximum) && maximum > 0, "LIMIT");
  if (expectedSize !== undefined) requireValue(Number.isSafeInteger(expectedSize) && expectedSize > 0 && expectedSize <= maximum, "SIZE");
  if (body instanceof Uint8Array) {
    requireValue(body.byteLength > 0 && body.byteLength <= maximum
      && (expectedSize === undefined || body.byteLength === expectedSize), "SIZE");
    return Buffer.from(body);
  }
  requireValue(body && typeof body[Symbol.asyncIterator] === "function", "STREAM");
  let bytes = Buffer.alloc(Math.min(64 * 1024, maximum));
  let size = 0; let chunks = 0; let complete = false;
  const iterator = body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const item = await waitFor(iterator.next(), signal);
      if (item.done) break;
      requireValue(item.value instanceof Uint8Array && ++chunks <= 262144, "CHUNK");
      requireValue(item.value.byteLength <= maximum - size, "SIZE");
      const nextSize = size + item.value.byteLength;
      if (nextSize > bytes.byteLength) {
        const grown = Buffer.alloc(Math.min(maximum, Math.max(nextSize, bytes.byteLength * 2)));
        bytes.copy(grown, 0, 0, size); bytes.fill(0); bytes = grown;
      }
      bytes.set(item.value, size); size = nextSize;
    }
    requireValue(size > 0 && (expectedSize === undefined || size === expectedSize), "SIZE");
    complete = true;
    return bytes.subarray(0, size);
  } finally {
    if (!complete) bytes.fill(0);
    if (!complete && iterator.return) Promise.resolve(iterator.return()).catch(() => {});
  }
}

export function validateDatabaseRecoveryArchiveConfiguration(environment = process.env) {
  validateDatabaseBackupRolesAnywhereConfiguration(environment);
  const archive = { bucket: environment.APP_DATABASE_BACKUP_BUCKET, kmsKeyArn: environment.APP_DATABASE_BACKUP_KMS_KEY_ARN };
  assertArchive(archive);
  return Object.freeze(archive);
}

/** Offline-injectable transport; the production factory fixes account, credentials and endpoint. */
export function createDatabaseRecoveryS3Transport({ client, archive }) {
  assertArchive(archive);
  const binding = Object.freeze({ bucket: archive.bucket, kmsKeyArn: archive.kmsKeyArn });
  async function write(request, kind) {
    let body;
    try {
      assertSignal(request.signal);
      const maximum = kind === "dump" ? DATABASE_RECOVERY_LIMITS.dumpBytes
        : kind === "roles" ? DATABASE_RECOVERY_LIMITS.rolesBytes : DATABASE_RECOVERY_LIMITS.manifestBytes;
      body = await collect(request.body, maximum, request.signal, request.expectedSize);
      assertSignal(request.signal);
      const digest = sha256(body);
      if (kind === "roles") {
        const roles = databaseRolesMetadataSchema.parse(parseJson(body));
        requireValue(JSON.stringify(canonical(roles)) === body.toString("utf8"), "ROLES_CANONICAL_BYTES");
      }
      if (kind === "manifest") {
        requireValue(hex.test(request.digest || "") && request.digest === digest, "MANIFEST_DIGEST");
        const manifest = parseJson(body);
        validateDatabaseManifest(manifest, digest);
        requireValue(manifest.archive.bucket === binding.bucket && manifest.archive.kmsKeyArn === binding.kmsKeyArn, "MANIFEST_ARCHIVE");
      }
      const key = kind === "dump" ? `database/dumps/${digest}.dump`
        : kind === "roles" ? `database/roles/${digest}.json` : `database/manifests/${digest}.json`;
      assertSignal(request.signal);
      // A repeated content-addressed key creates a new immutable VersionId. No
      // mutable pointer, newest-object lookup, or deletion privilege is used.
      const response = await waitFor(client.send(new PutObjectCommand({ Bucket: binding.bucket, Key: key, Body: body,
        ContentLength: body.byteLength, ContentType: kind === "dump" ? "application/octet-stream" : "application/json",
        ExpectedBucketOwner: DATABASE_BACKUP_WORKLOAD.account, ServerSideEncryption: "aws:kms", SSEKMSKeyId: binding.kmsKeyArn,
        BucketKeyEnabled: false, ChecksumAlgorithm: "SHA256", ChecksumSHA256: Buffer.from(digest, "hex").toString("base64") }),
      { abortSignal: request.signal }), request.signal);
      assertEncryption(response, binding); assertChecksum(response, digest);
      requireValue(version(response.VersionId), "VERSION_RESPONSE");
      return { key, versionId: response.VersionId, checksumSha256: digest, size: body.byteLength,
        serverSideEncryption: "aws:kms", kmsKeyId: binding.kmsKeyArn };
    } catch { fail("WRITE_FAILED"); }
    finally { body?.fill(0); }
  }
  async function readFileManifest({ digest, versionId, signal }) {
    let body; let responseBody;
    try {
      assertSignal(signal);
      requireValue(hex.test(digest || "") && version(versionId), "FILE_MANIFEST_BINDING");
      const response = await waitFor(client.send(new GetObjectCommand({ Bucket: binding.bucket, Key: `manifests/${digest}.json`,
        VersionId: versionId, ExpectedBucketOwner: DATABASE_BACKUP_WORKLOAD.account, ChecksumMode: "ENABLED" }), { abortSignal: signal }), signal);
      responseBody = response.Body;
      assertEncryption(response, binding); assertChecksum(response, digest);
      requireValue(response.VersionId === versionId && Number.isSafeInteger(response.ContentLength)
        && response.ContentLength > 0 && response.ContentLength <= maximumFileManifestBytes, "FILE_MANIFEST_VERSION_OR_SIZE");
      body = await collect(responseBody, maximumFileManifestBytes, signal, response.ContentLength);
      assertSignal(signal);
      requireValue(sha256(body) === digest, "FILE_MANIFEST_DIGEST");
      const manifest = parseJson(body);
      validateManifest(manifest, digest);
      requireValue(manifest.archive.bucket === binding.bucket && manifest.archive.kmsKeyArn === binding.kmsKeyArn, "FILE_MANIFEST_ARCHIVE");
      return { manifest, digest, versionId };
    } catch { fail("READ_FILE_MANIFEST_FAILED"); }
    finally { body?.fill(0); responseBody?.destroy?.(); }
  }
  return Object.freeze({ archive: binding, readFileManifest,
    putDatabaseDump: (request) => write(request, "dump"), putRolesMetadata: (request) => write(request, "roles"),
    putDatabaseManifest: (request) => write(request, "manifest"), close: () => client.destroy() });
}

export function createDatabaseRecoveryDestination(environment = process.env) {
  const archive = validateDatabaseRecoveryArchiveConfiguration(environment);
  const client = new S3Client({ region: DATABASE_BACKUP_WORKLOAD.region, credentials: awsDatabaseBackupWorkloadCredentials(environment),
    endpoint: `https://s3.${DATABASE_BACKUP_WORKLOAD.region}.amazonaws.com`, forcePathStyle: true, maxAttempts: 1 });
  return createDatabaseRecoveryS3Transport({ client, archive });
}

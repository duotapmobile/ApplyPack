import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { createClient } from "@supabase/supabase-js";
import { RECOVERY, RECOVERY_BUCKETS, canonicalBytes, canonicalSha256, sha256 } from "./protected-recovery-core.mjs";
import { validateServiceRetentionOverlay, verifiedRetentionSanitization } from "./protected-recovery-protocol.mjs";

const ROLE = "arn:aws:iam::838445019912:role/applypack/production/applypack-production-recovery-reader";
const PROFILE = "applypack-production-recovery";
const fail = (code) => { throw new Error(`PROTECTED_RECOVERY_RESTORE_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...fields].sort().join("|");
export const RESTORE_LOCKS = Object.freeze(["checkoutLocked", "intakeLocked", "customerAccessLocked", "outboundMailDisabled",
  "livePaymentsDisabled", "callbacksDisabled", "scheduledWritersDisabled"]);

/** The private registration is reviewed provider evidence, not a generated claim of isolation. */
export function validateRecoveryRegistration(value, expectedDigest, now = Date.now()) {
  requireValue(/^[a-f0-9]{64}$/u.test(expectedDigest) && canonicalSha256(value) === expectedDigest
    && exact(value, ["schemaVersion", "targetProjectRef", "targetOrigin", "sourceReleaseSha", "manifestSha256", "manifestVersionId",
      "archive", "registeredAt", "providerEvidenceSha256", "registeredBy", "independentRecoveryRoleArn", "locks"])
    && value.schemaVersion === "applypack-protected-recovery-target-registration-v1", "REGISTRATION");
  requireValue(/^[a-z]{20}$/u.test(value.targetProjectRef)
    && ![RECOVERY.projectRef, "fmugizadzdnqfckujqlw"].includes(value.targetProjectRef)
    && value.targetOrigin === `https://${value.targetProjectRef}.supabase.co`
    && /^[a-f0-9]{40}$/u.test(value.sourceReleaseSha) && /^[a-f0-9]{64}$/u.test(value.manifestSha256)
    && typeof value.manifestVersionId === "string" && /^[A-Za-z0-9._~+/=:-]{1,1024}$/u.test(value.manifestVersionId)
    && value.manifestVersionId !== "null", "TARGET_IDENTITY");
  requireValue(exact(value.archive, ["bucket", "kmsKeyArn"])
    && value.archive.bucket === "applypack-production-protected-recovery-838445019912"
    && /^arn:aws:kms:us-east-1:838445019912:key\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value.archive.kmsKeyArn), "ARCHIVE_IDENTITY");
  const registeredAt = Date.parse(value.registeredAt);
  requireValue(Number.isFinite(registeredAt) && registeredAt <= now && now - registeredAt <= 15 * 60 * 1000
    && /^[a-f0-9]{64}$/u.test(value.providerEvidenceSha256)
    && /^arn:aws:iam::838445019912:user\/[A-Za-z0-9+=,.@_/-]{1,128}$/u.test(value.registeredBy)
    && !value.registeredBy.endsWith("/applypack-staging-operator")
    && value.independentRecoveryRoleArn === ROLE
    && exact(value.locks, RESTORE_LOCKS) && RESTORE_LOCKS.every((name) => value.locks[name] === true), "ISOLATION_EVIDENCE");
  return value;
}

/** Explicit named human profile only. The role trust separately enforces recent MFA. */
export function readIndependentRecoveryCredentials({ environment = process.env, exec = execFileSync, platform = process.platform, now = Date.now() } = {}) {
  requireValue(platform === "win32", "OPERATOR_PLATFORM");
  requireValue(!Object.entries(environment).some(([name, value]) => value && /^(AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|SECURITY_TOKEN|ROLE_ARN|WEB_IDENTITY_TOKEN_FILE|ENDPOINT_URL.*|CONFIG_FILE|SHARED_CREDENTIALS_FILE)|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS)$/iu.test(name)), "ALTERNATE_CREDENTIALS");
  let output;
  try {
    output = exec("C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe", ["configure", "export-credentials", "--profile", PROFILE, "--format", "process"],
      { windowsHide: true, timeout: 30_000, maxBuffer: 32 * 1024, stdio: ["ignore", "pipe", "pipe"], env: environment });
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output));
    requireValue(value.Version === 1 && /^ASIA[A-Z0-9]{16}$/u.test(value.AccessKeyId)
      && typeof value.SecretAccessKey === "string" && value.SecretAccessKey.length >= 32
      && typeof value.SessionToken === "string" && value.SessionToken.length >= 16
      && Number.isFinite(Date.parse(value.Expiration)) && Date.parse(value.Expiration) > now + RECOVERY.maximumRunMilliseconds, "TEMPORARY_CREDENTIALS");
    return { accessKeyId: value.AccessKeyId, secretAccessKey: value.SecretAccessKey, sessionToken: value.SessionToken, expiration: new Date(value.Expiration) };
  } catch { fail("OPERATOR_LOGIN_REQUIRED"); }
  finally { output?.fill?.(0); }
}

export function createIndependentArchiveReader({ registration, credentials, s3, sts }) {
  const s3Client = s3 || new S3Client({ region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com", forcePathStyle: true, credentials, maxAttempts: 1 });
  const stsClient = sts || new STSClient({ region: "us-east-1", endpoint: "https://sts.us-east-1.amazonaws.com", credentials, maxAttempts: 1 });
  let verified = false;
  const credentialIdentity = `aws:${ROLE}`;
  const identity = async ({ signal }) => {
    const value = await stsClient.send(new GetCallerIdentityCommand({}), { abortSignal: signal });
    requireValue(value.Account === "838445019912"
      && /^arn:aws:sts::838445019912:assumed-role\/applypack-production-recovery-reader\/[A-Za-z0-9+=,.@_-]{1,64}$/u.test(value.Arn || ""), "OPERATOR_IDENTITY");
    verified = true; return { credentialIdentity, independentRecovery: true };
  };
  const get = async (key, versionId, signal) => {
    requireValue(verified, "OPERATOR_IDENTITY_REQUIRED");
    const value = await s3Client.send(new GetObjectCommand({ Bucket: registration.archive.bucket, Key: key, VersionId: versionId,
      ExpectedBucketOwner: "838445019912", ChecksumMode: "ENABLED" }), { abortSignal: signal });
    requireValue(value.VersionId === versionId && value.ServerSideEncryption === "aws:kms"
      && value.SSEKMSKeyId === registration.archive.kmsKeyArn && value.BucketKeyEnabled !== true
      && Number.isSafeInteger(value.ContentLength) && value.ContentLength > 0, "ARCHIVE_RESPONSE");
    return { versionId, size: value.ContentLength, body: value.Body };
  };
  return { credentialIdentity, identity,
    async readManifest({ signal }) {
      await identity({ signal });
      const opened = await get(`manifests/${registration.manifestSha256}.json`, registration.manifestVersionId, signal);
      const bytes = await collect(opened.body, opened.size, 16 * 1024 * 1024);
      try {
        requireValue(sha256(bytes) === registration.manifestSha256, "MANIFEST_HASH");
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } finally { bytes.fill(0); }
    },
    async openObject({ bucket, key, versionId, signal }) {
      requireValue(bucket === registration.archive.bucket && /^objects\/(customer-source-documents|customer-deliveries|operator-drafts|operator-render-previews)\/[a-f0-9]{64}$/u.test(key)
        && typeof versionId === "string" && versionId !== "null" && /^[A-Za-z0-9._~+/=:-]{1,1024}$/u.test(versionId), "ARCHIVE_REQUEST");
      return get(key, versionId, signal);
    },
    close() { s3Client.destroy(); stsClient.destroy(); },
  };
}

async function collect(body, expectedSize, maximum) {
  requireValue(Number.isSafeInteger(expectedSize) && expectedSize > 0 && expectedSize <= maximum, "BYTE_LIMIT");
  const bytes = Buffer.alloc(expectedSize); let size = 0;
  try {
    for await (const chunk of body) { requireValue(chunk instanceof Uint8Array && size + chunk.byteLength <= expectedSize, "BYTE_LIMIT"); bytes.set(chunk, size); size += chunk.byteLength; }
    requireValue(size === expectedSize, "BYTE_LIMIT"); return bytes;
  } catch (error) { bytes.fill(0); throw error; }
}

/** Only a fresh, empty, registered recovery project is supported. No overwrite or unlock exists. */
export function createRegisteredRestoreTarget({ registration, supabaseKey, fetchImpl = fetch, now = Date.now }) {
  requireValue(typeof supabaseKey === "string" && supabaseKey.length > 20 && supabaseKey.length <= 4096, "TARGET_CREDENTIAL");
  const safeFetch = (url, options = {}) => {
    const parsed = new URL(String(url));
    requireValue(parsed.origin === registration.targetOrigin && !parsed.username && !parsed.password && !parsed.hash, "TARGET_ORIGIN");
    return fetchImpl(parsed.href, { ...options, redirect: "error", cache: "no-store", credentials: "omit",
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  };
  const admin = createClient(registration.targetOrigin, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: safeFetch } });
  const credentialIdentity = `supabase:${registration.targetProjectRef}:${sha256(supabaseKey)}`;
  let checkedEmpty = false;
  let databaseSanitized = false;
  const assertLocked = async () => {
    validateRecoveryRegistration(registration, canonicalSha256(registration), now());
    const [mode, commerce, buckets] = await Promise.all([
      admin.from("ap_checkout_mode_configuration").select("mode").eq("singleton", true).single(),
      admin.from("ap_commerce_configuration").select("checkout_enabled").eq("singleton", true).single(), admin.storage.listBuckets(),
    ]);
    requireValue(!mode.error && mode.data?.mode === "LOCKED" && !commerce.error && commerce.data?.checkout_enabled === false
      && !buckets.error && Array.isArray(buckets.data) && buckets.data.length === RECOVERY_BUCKETS.length
      && RECOVERY_BUCKETS.every((bucket) => buckets.data.filter((item) => item.id === bucket && item.name === bucket && item.public === false).length === 1), "TARGET_LOCKS");
    if (!checkedEmpty) {
      for (const bucket of RECOVERY_BUCKETS) {
        const files = await admin.storage.from(bucket).list("", { limit: 1 });
        requireValue(!files.error && Array.isArray(files.data) && files.data.length === 0, "TARGET_NOT_EMPTY");
      }
      checkedEmpty = true;
    }
    return { projectRef: registration.targetProjectRef, origin: registration.targetOrigin, credentialIdentity, ...registration.locks };
  };
  async function uploadVerified(bucket, key, bytes, signal) {
    requireValue(checkedEmpty, "TARGET_PREFLIGHT_REQUIRED");
    const uploaded = await admin.storage.from(bucket).upload(key, bytes, { contentType: "application/octet-stream", upsert: false });
    requireValue(!uploaded.error && uploaded.data?.path === key, "TARGET_UPLOAD");
    const response = await safeFetch(`${registration.targetOrigin}/storage/v1/object/authenticated/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
      { headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` }, signal });
    requireValue(response.status === 200 && response.body, "TARGET_VERIFY");
    const restored = await collect(response.body, bytes.length, Math.max(RECOVERY.maximumObjectBytes, 16 * 1024 * 1024));
    try { requireValue(sha256(restored) === sha256(bytes), "TARGET_HASH"); }
    finally { restored.fill(0); }
  }
  return { credentialIdentity, assertLocked,
    async applyTombstones({ tombstones, digest, signal }) {
      const bytes = canonicalBytes({ schemaVersion: "applypack-recovery-exclusion-overlay-v1", manifestSha256: registration.manifestSha256, tombstones, digest });
      try { await uploadVerified("operator-drafts", `recovery-control/${registration.manifestSha256}/exclusions.json`, bytes, signal); }
      finally { bytes.fill(0); }
      return { digest, customerAccessLocked: true };
    },
    async sanitizeDatabase({ overlay, digest, sourceInventoryDigest, signal }) {
      requireValue(checkedEmpty, "TARGET_PREFLIGHT_REQUIRED");
      validateServiceRetentionOverlay(overlay, now());
      requireValue(canonicalSha256(overlay) === digest && /^[a-f0-9]{64}$/u.test(sourceInventoryDigest), "RETENTION_OVERLAY_BINDING");
      const bytes = canonicalBytes(overlay);
      try {
        requireValue(bytes.byteLength <= RECOVERY.maximumInventoryBytes, "RETENTION_OVERLAY_LIMIT");
        const result = await admin.rpc("ap_apply_retention_restore_overlay", {
          p_overlay_json: bytes.toString("utf8"), p_overlay_sha256: digest,
        }).abortSignal(signal);
        requireValue(!result.error && verifiedRetentionSanitization(result.data, digest), "DATABASE_SANITIZATION_FAILED");
        databaseSanitized = true;
        return result.data;
      } finally { bytes.fill(0); }
    },
    async putPrivateObject({ bucket, key, body, expectedSize, expectedSha256, overwrite, signal }) {
      requireValue(databaseSanitized, "DATABASE_SANITIZATION_REQUIRED");
      requireValue(RECOVERY_BUCKETS.includes(bucket) && overwrite === false && !key.startsWith("recovery-control/"), "TARGET_OBJECT");
      const bytes = await collect(body, expectedSize, RECOVERY.maximumObjectBytes);
      try {
        requireValue(sha256(bytes) === expectedSha256, "TARGET_SOURCE_HASH");
        await uploadVerified(bucket, key, bytes, signal);
        return { sha256: expectedSha256, size: bytes.length, private: true, customerAccessLocked: true };
      } finally { bytes.fill(0); }
    },
  };
}

export const recoveryPrivateStream = (bytes) => Readable.from([bytes]);

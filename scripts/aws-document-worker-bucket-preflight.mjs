import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizedIdentity, sha256, writeCanonicalReceipt } from "./lib/canonical-receipt.mjs";

const ACCOUNT = "838445019912";
const REGION = "us-east-1";
const MAX_RECEIPT_AGE_MS = 15 * 60_000;

function validateScope(input) {
  if (!["staging", "production"].includes(input.environment)
    || input.bucket !== `applypack-${ACCOUNT}-${input.environment}-document-worker-temp`
    || !new RegExp(`^arn:aws:lambda:${REGION}:${ACCOUNT}:function:applypack-${input.environment}-document-worker:[1-9]\\d*$`).test(input.functionVersionArn || "")
    || !/^[0-9a-f]{40}$/.test(input.sourceCommitSha || "")
    || !/^[0-9a-f]{64}$/.test(input.imageDigest || "")
    || !/^[0-9a-f]{64}$/.test(input.preflightReceiptSha256 || "")) {
    throw new Error("bucket_preflight_scope_invalid");
  }
}

function versioningDenyMatches(value, bucket) {
  let policy;
  try { policy = JSON.parse(value.Policy); } catch { return false; }
  const statements = policy?.Statement;
  if (!Array.isArray(statements) || statements.length !== 1) return false;
  const statement = statements[0];
  return policy.Version === "2012-10-17" && statement.Sid === "NeverEnableTemporaryBucketVersioning"
    && statement.Effect === "Deny" && statement.Principal === "*"
    && statement.Action === "s3:PutBucketVersioning" && statement.Resource === `arn:aws:s3:::${bucket}`
    && !statement.Condition && !statement.NotPrincipal && !statement.NotAction && !statement.NotResource;
}

export function evaluateBucketVersioningEvidence(input, evidence) {
  validateScope(input);
  const observed = Date.parse(input.checkedAt);
  if (!Number.isFinite(observed) || evidence?.identity?.Account !== ACCOUNT
    || typeof evidence.identity.Arn !== "string"
    || !evidence.identity.Arn.startsWith(`arn:aws:sts::${ACCOUNT}:assumed-role/`)) {
    throw new Error("bucket_preflight_identity_invalid");
  }
  // S3 returns no Status only when versioning has never been enabled. Suspended
  // buckets can retain earlier versions and are not safe for key-only deletion.
  if (!evidence.versioning || typeof evidence.versioning !== "object" || Array.isArray(evidence.versioning)
    || Object.keys(evidence.versioning).length !== 0) throw new Error("temporary_bucket_not_never_versioned");
  if (!versioningDenyMatches(evidence.policy, input.bucket)) throw new Error("temporary_bucket_versioning_deny_missing");
  return {
    schema: "applypack.aws-document-worker-bucket-preflight.v1",
    checkedAt: input.checkedAt,
    environment: input.environment,
    region: REGION,
    sourceCommitSha: input.sourceCommitSha,
    imageDigest: input.imageDigest,
    preflightReceiptSha256: input.preflightReceiptSha256,
    identities: {
      accountIdentitySha256: sanitizedIdentity(ACCOUNT),
      callerIdentitySha256: sanitizedIdentity(evidence.identity.Arn),
      bucketIdentitySha256: sanitizedIdentity(input.bucket),
      functionVersionIdentitySha256: sanitizedIdentity(input.functionVersionArn),
    },
    checks: { temporaryBucketNeverVersioned: true, versioningChangesDenied: true, expectedBucketOwner: true },
  };
}

export function validateBucketVersioningReceipt(bytes, expectedDigest, input, now = Date.now()) {
  validateScope(input);
  if (!Buffer.isBuffer(bytes) || bytes.length > 65_536 || !/^[0-9a-f]{64}$/.test(expectedDigest || "")
    || sha256(bytes) !== expectedDigest) throw new Error("bucket_preflight_receipt_digest_invalid");
  let receipt;
  try { receipt = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("bucket_preflight_receipt_invalid"); }
  const observed = Date.parse(receipt?.checkedAt);
  if (!Number.isFinite(now) || !Number.isFinite(observed) || observed > now + 5_000
    || now - observed >= MAX_RECEIPT_AGE_MS) throw new Error("bucket_preflight_receipt_stale");
  if (receipt.schema !== "applypack.aws-document-worker-bucket-preflight.v1"
    || receipt.environment !== input.environment || receipt.region !== REGION
    || receipt.sourceCommitSha !== input.sourceCommitSha || receipt.imageDigest !== input.imageDigest
    || receipt.preflightReceiptSha256 !== input.preflightReceiptSha256
    || receipt.identities?.accountIdentitySha256 !== sanitizedIdentity(ACCOUNT)
    || receipt.identities?.bucketIdentitySha256 !== sanitizedIdentity(input.bucket)
    || receipt.identities?.functionVersionIdentitySha256 !== sanitizedIdentity(input.functionVersionArn)
    || receipt.checks?.temporaryBucketNeverVersioned !== true || receipt.checks?.versioningChangesDenied !== true
    || receipt.checks?.expectedBucketOwner !== true) throw new Error("bucket_preflight_receipt_binding_invalid");
  return receipt;
}

function awsJson(args, service) {
  const result = spawnSync("aws", [...args, "--region", REGION, "--endpoint-url", `https://${service}.${REGION}.amazonaws.com`,
    "--output", "json", "--no-cli-pager"], { encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
  if (result.status !== 0 || result.error || result.signal) throw new Error(`bucket_preflight_read_failed:${args[1]}`);
  try { return JSON.parse(result.stdout); } catch { throw new Error("bucket_preflight_read_invalid"); }
}

function main() {
  const input = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    if (!name?.startsWith("--") || !process.argv[index + 1]) throw new Error("bucket_preflight_arguments_invalid");
    input[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = process.argv[index + 1];
  }
  validateScope(input);
  if (!input.outputDirectory) throw new Error("bucket_preflight_output_missing");
  const owner = ["--bucket", input.bucket, "--expected-bucket-owner", ACCOUNT];
  const evidence = {
    identity: awsJson(["sts", "get-caller-identity"], "sts"),
    versioning: awsJson(["s3api", "get-bucket-versioning", ...owner], "s3"),
    policy: awsJson(["s3api", "get-bucket-policy", ...owner], "s3"),
  };
  const receipt = evaluateBucketVersioningEvidence({ ...input, checkedAt: new Date().toISOString() }, evidence);
  const written = writeCanonicalReceipt(input.outputDirectory,
    `aws-document-worker-bucket-preflight-${input.environment}`, receipt);
  process.stdout.write(`BUCKET_PREFLIGHT_RECEIPT_SHA256=${written.digest}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "bucket_preflight_failed"}\n`);
    process.exitCode = 1;
  }
}

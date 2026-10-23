import { expectedCrossEnvironmentKmsDenial } from "./aws-document-worker-synthetic-probe.mjs";
import { evaluateBucketVersioningEvidence, validateBucketVersioningReceipt } from "./aws-document-worker-bucket-preflight.mjs";
import { canonicalJson, sha256 } from "./lib/canonical-receipt.mjs";
import assert from "node:assert/strict";

function accepted(code) {
  const result = {
    status: 254,
    signal: null,
    error: undefined,
    stderr: `An error occurred (${code}) when calling the Decrypt operation: denied by the exact context boundary`,
  };
  if (expectedCrossEnvironmentKmsDenial(result) !== code) throw new Error(`expected denial rejected: ${code}`);
}

function rejected(result, label) {
  let didReject = false;
  try { expectedCrossEnvironmentKmsDenial(result); } catch { didReject = true; }
  if (!didReject) throw new Error(`unexpected KMS failure accepted: ${label}`);
}

accepted("AccessDeniedException");
accepted("InvalidCiphertextException");
rejected({ status: 0, signal: null, stderr: "" }, "successful cross-environment decrypt");
rejected({ status: 254, signal: null, stderr: "An error occurred (UnrecognizedClientException) when calling the Decrypt operation: credentials invalid" }, "credential failure");
rejected({ status: 255, signal: null, stderr: "Could not connect to the endpoint URL" }, "network failure");
rejected({ status: 254, signal: null, stderr: "An error occurred (ThrottlingException) when calling the Decrypt operation: retry later" }, "throttle failure");
rejected({ status: 254, signal: null, stderr: "An error occurred (ValidationException) when calling the Decrypt operation: malformed request" }, "malformed request");
rejected({ status: null, signal: "SIGTERM", stderr: "" }, "transient terminated process");
rejected({ status: null, signal: null, stderr: "An error occurred (AccessDeniedException) when calling the Decrypt operation: no exit status" }, "missing CLI exit status");
rejected({ status: null, signal: null, error: new Error("spawn failed"), stderr: "" }, "CLI execution failure");

const bucketNow = Date.parse("2026-10-23T12:00:00.000Z");
const bucketScope = {
  environment: "staging", bucket: "applypack-838445019912-staging-document-worker-temp",
  functionVersionArn: "arn:aws:lambda:us-east-1:838445019912:function:applypack-staging-document-worker:12",
  sourceCommitSha: "a".repeat(40), imageDigest: "b".repeat(64), preflightReceiptSha256: "c".repeat(64),
  checkedAt: new Date(bucketNow).toISOString(),
};
const bucketEvidence = {
  identity: { Account: "838445019912", Arn: "arn:aws:sts::838445019912:assumed-role/bucket-auditor/session" },
  versioning: {},
  policy: { Policy: JSON.stringify({ Version: "2012-10-17", Statement: [{
    Sid: "NeverEnableTemporaryBucketVersioning", Effect: "Deny", Principal: "*", Action: "s3:PutBucketVersioning",
    Resource: `arn:aws:s3:::${bucketScope.bucket}`,
  }] }) },
};
const bucketReceipt = evaluateBucketVersioningEvidence(bucketScope, bucketEvidence);
const bucketBytes = Buffer.from(`${canonicalJson(bucketReceipt)}\n`);
const bucketDigest = sha256(bucketBytes);
assert.equal(validateBucketVersioningReceipt(bucketBytes, bucketDigest, bucketScope, bucketNow).checks.temporaryBucketNeverVersioned, true);
assert.equal(JSON.stringify(bucketReceipt).includes("838445019912"), false);
for (const versioning of [null, [], { Status: "Enabled" }, { Status: "Suspended" }, { MFADelete: "Disabled" }, { unknown: true }]) {
  assert.throws(() => evaluateBucketVersioningEvidence(bucketScope, { ...bucketEvidence, versioning }), /temporary_bucket_not_never_versioned/);
}
assert.throws(() => evaluateBucketVersioningEvidence(bucketScope, { ...bucketEvidence,
  identity: { Account: "123456789012", Arn: "arn:aws:sts::123456789012:assumed-role/other/session" } }), /identity_invalid/);
assert.throws(() => evaluateBucketVersioningEvidence(bucketScope, { ...bucketEvidence, policy: null }), /versioning_deny_missing/);
for (const mutation of [
  (statement) => { statement.Effect = "Allow"; },
  (statement) => { statement.Principal = { AWS: "arn:aws:iam::838445019912:role/limited" }; },
  (statement) => { statement.Resource += "/*"; },
  (statement) => { statement.Condition = { Bool: { "aws:SecureTransport": "false" } }; },
]) {
  const policy = JSON.parse(bucketEvidence.policy.Policy);
  mutation(policy.Statement[0]);
  assert.throws(() => evaluateBucketVersioningEvidence(bucketScope, { ...bucketEvidence, policy: { Policy: JSON.stringify(policy) } }), /versioning_deny_missing/);
}
for (const changedScope of [
  { environment: "production" }, { bucket: "unrelated-bucket" },
  { functionVersionArn: bucketScope.functionVersionArn.replace(":12", ":13") },
  { sourceCommitSha: "d".repeat(40) }, { imageDigest: "d".repeat(64) }, { preflightReceiptSha256: "d".repeat(64) },
]) assert.throws(() => validateBucketVersioningReceipt(bucketBytes, bucketDigest, { ...bucketScope, ...changedScope }, bucketNow));
assert.throws(() => validateBucketVersioningReceipt(bucketBytes, "f".repeat(64), bucketScope, bucketNow), /digest_invalid/);
assert.throws(() => validateBucketVersioningReceipt(Buffer.concat([bucketBytes, Buffer.from(" ")]), bucketDigest, bucketScope, bucketNow), /digest_invalid/);
assert.throws(() => validateBucketVersioningReceipt(bucketBytes, bucketDigest, bucketScope, bucketNow + 15 * 60_000), /receipt_stale/);
assert.throws(() => validateBucketVersioningReceipt(bucketBytes, bucketDigest, bucketScope, bucketNow - 5_001), /receipt_stale/);
assert.throws(() => validateBucketVersioningReceipt(bucketBytes, bucketDigest, bucketScope, NaN), /receipt_stale/);
for (const field of ["temporaryBucketNeverVersioned", "versioningChangesDenied", "expectedBucketOwner"]) {
  const changed = structuredClone(bucketReceipt);
  changed.checks[field] = false;
  const bytes = Buffer.from(canonicalJson(changed));
  assert.throws(() => validateBucketVersioningReceipt(bytes, sha256(bytes), bucketScope, bucketNow), /binding_invalid/);
}

console.log("AWS_DOCUMENT_WORKER_SYNTHETIC_PROBE_FIXTURES_OK");

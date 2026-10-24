import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { createRecoveryS3Transport, RECOVERY_ARCHIVE_BUCKET, validateRecoveryArchiveConfiguration } from "./lib/protected-recovery-s3.mjs";
import { BACKUP_WORKLOAD } from "./lib/aws-backup-workload-credentials.mjs";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, RECOVERY_LIMITS, recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { canonicalBytes, canonicalSha256, sha256 } from "./lib/protected-recovery-core.mjs";

const archive = { bucket: RECOVERY_ARCHIVE_BUCKET, kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111" };
const environment = { APP_DEPLOYMENT_ENV: "production", APP_BACKUP_AWS_RA_DEPLOYMENT_ENV: "production", APP_AWS_ACCOUNT_ID: BACKUP_WORKLOAD.account,
  AWS_REGION: BACKUP_WORKLOAD.region, APP_BACKUP_AWS_RA_ROLE_ARN: BACKUP_WORKLOAD.roleArn,
  APP_BACKUP_AWS_RA_PROFILE_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:profile/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  APP_BACKUP_AWS_RA_TRUST_ANCHOR_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:trust-anchor/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  APP_BACKUP_AWS_RA_HELPER_PATH: BACKUP_WORKLOAD.helperPath, APP_BACKUP_AWS_RA_CERTIFICATE_SHA256: "a".repeat(64),
  APP_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: "b".repeat(64), APP_BACKUP_BUCKET: archive.bucket, APP_BACKUP_KMS_KEY_ARN: archive.kmsKeyArn };
const encode = (hex) => Buffer.from(hex, "hex").toString("base64");
function manifestFixture() {
  const inventory = { schemaVersion: "applypack-protected-recovery-inventory-v1", sourceEnvironment: "production", sourceProjectRef: "spjaaxndiduhrcleazwb",
    releaseSha: "a".repeat(40), buckets: [...RECOVERY_BUCKETS], startedAt: "2026-10-23T22:00:00.000Z", completedAt: "2026-10-23T22:00:01.000Z",
    objects: [], references: [], tombstones: [], counts: { objects: 0, references: 0, tombstones: 0,
      tables: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, 0])) }, receipt: "synthetic-signed-receipt-".padEnd(128, "a") };
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  const manifest = { schemaVersion: "applypack-protected-recovery-manifest-v1", archive, inventory,
    secondInventoryReceipt: "synthetic-second-receipt-".padEnd(128, "b"), watermark: inventory.startedAt,
    createdAt: "2026-10-23T22:00:02.000Z", previousManifestDigest: null, entries: [] };
  return { manifest, digest: canonicalSha256(manifest), bytes: canonicalBytes(manifest) };
}
function fixture() {
  const calls = []; const original = Buffer.from("synthetic private document bytes");
  const request = { bucket: archive.bucket, key: `objects/customer-deliveries/${"a".repeat(64)}`, body: Readable.from([original]),
    expectedSize: original.length, serverSideEncryption: "aws:kms", kmsKeyId: archive.kmsKeyArn, checksumAlgorithm: "SHA256", immutable: true,
    signal: new AbortController().signal };
  const context = { calls, original, request, destroyed: false, response: undefined, handler: undefined };
  const client = { async send(command, options) {
    calls.push({ command, options });
    if (context.handler) return context.handler(command, options);
    return context.response ?? { VersionId: "exact-version-1", ServerSideEncryption: "aws:kms", SSEKMSKeyId: archive.kmsKeyArn,
      BucketKeyEnabled: false, ChecksumType: "FULL_OBJECT", ChecksumSHA256: command.input.ChecksumSHA256 };
  }, destroy() { context.destroyed = true; } };
  context.destination = createRecoveryS3Transport({ client, archive });
  return context;
}
function listPage(contents = [], extra = {}) {
  return { Name: archive.bucket, Prefix: "manifests/", KeyCount: contents.length, Contents: contents, IsTruncated: false, ...extra };
}
function listEntry(item = manifestFixture(), time = "2026-10-23T22:00:03Z") {
  return { Key: `manifests/${item.digest}.json`, Size: item.bytes.length, LastModified: new Date(time) };
}
function getResponse(item = manifestFixture(), extra = {}) {
  return { Body: Readable.from([item.bytes]), ContentLength: item.bytes.length, VersionId: "manifest-version-1", ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: archive.kmsKeyArn, BucketKeyEnabled: false, ChecksumSHA256: encode(item.digest), ChecksumType: "FULL_OBJECT", ...extra };
}

test("archive configuration fixes production account, region, bucket, and KMS key identity", () => {
  assert.deepEqual(validateRecoveryArchiveConfiguration(environment), archive);
  for (const [key, value] of Object.entries({ APP_BACKUP_BUCKET: "attacker-bucket", APP_BACKUP_KMS_KEY_ARN: archive.kmsKeyArn.replace("us-east-1", "us-west-2"),
    APP_DEPLOYMENT_ENV: "staging", AWS_ACCESS_KEY_ID: "synthetic", SUPABASE_SERVICE_ROLE_KEY: "synthetic" })) {
    assert.throws(() => validateRecoveryArchiveConfiguration({ ...environment, [key]: value }));
  }
  for (const key of [archive.kmsKeyArn.replace("838445019912", "123456789012"), archive.kmsKeyArn.replace("key/", "alias/"),
    "arn:aws:kms:us-east-1:838445019912:key/------------------------------------"]) {
    assert.throws(() => validateRecoveryArchiveConfiguration({ ...environment, APP_BACKUP_KMS_KEY_ARN: key }));
  }
});

test("upload binds checksum, encryption, owner, known size and immutable version; private buffer is erased", async () => {
  const context = fixture();
  const expected = sha256(context.original);
  const result = await context.destination.putObject(context.request);
  assert.deepEqual(result, { versionId: "exact-version-1", checksumSha256: expected, size: context.original.length });
  const input = context.calls[0].command.input;
  assert.equal(context.calls[0].command.constructor.name, "PutObjectCommand");
  assert.equal(input.Bucket, archive.bucket); assert.equal(input.ExpectedBucketOwner, BACKUP_WORKLOAD.account);
  assert.equal(input.SSEKMSKeyId, archive.kmsKeyArn); assert.equal(input.ServerSideEncryption, "aws:kms");
  assert.equal(input.BucketKeyEnabled, false); assert.equal(input.ChecksumSHA256, encode(expected));
  assert.equal(input.ContentLength, context.original.length); assert.equal(input.Body.every((byte) => byte === 0), true);
  assert.equal(context.original.toString(), "synthetic private document bytes");
  assert.equal(input.ACL, undefined); assert.equal(input.IfNoneMatch, undefined);
  context.destination.close(); assert.equal(context.destroyed, true);
});

for (const [label, change] of [
  ["wrong bucket", { bucket: "other" }], ["wrong key", { key: "objects/other/abc" }], ["manifest through blob method", { key: `manifests/${"a".repeat(64)}.json` }],
  ["wrong KMS", { kmsKeyId: archive.kmsKeyArn.replace("11111111", "22222222") }], ["plaintext", { serverSideEncryption: undefined }],
  ["wrong checksum algorithm", { checksumAlgorithm: "CRC32" }], ["mutable input", { immutable: false }],
  ["zero length", { expectedSize: 0 }], ["oversized", { expectedSize: RECOVERY_LIMITS.objectBytes + 1 }], ["missing signal", { signal: undefined }],
]) test(`upload rejects ${label} before provider write`, async () => {
  const context = fixture();
  await assert.rejects(context.destination.putObject({ ...context.request, ...change }), /^Error: PROTECTED_RECOVERY_S3_WRITE_FAILED$/u);
  assert.equal(context.calls.length, 0);
});

for (const [label, body] of [
  ["too few bytes", () => Readable.from([Buffer.from("x")])],
  ["too many bytes", () => Readable.from([Buffer.alloc(100)])],
  ["nonbyte chunks", () => Readable.from(["bad chunk"])],
  ["failed source", () => (async function* () { yield Buffer.from("x"); throw new Error("private source error"); })()],
]) test(`upload rejects ${label} without creating partial archive objects`, async () => {
  const context = fixture();
  await assert.rejects(context.destination.putObject({ ...context.request, body: body() }), /^Error: PROTECTED_RECOVERY_S3_WRITE_FAILED$/u);
  assert.equal(context.calls.length, 0);
});

test("aborted or stuck source cannot outlive the supplied run deadline", async () => {
  const context = fixture(); const controller = new AbortController(); let returned = false;
  const body = { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: async () => { returned = true; return { done: true }; } }; } };
  const timer = setTimeout(() => controller.abort(), 10);
  try { await assert.rejects(context.destination.putObject({ ...context.request, body, signal: controller.signal }), /WRITE_FAILED/u); }
  finally { clearTimeout(timer); }
  assert.equal(returned, true); assert.equal(context.calls.length, 0);
});

for (const [label, response] of [
  ["missing version", { VersionId: undefined }], ["unversioned bucket", { VersionId: "null" }], ["unsafe version", { VersionId: "bad\nvalue" }],
  ["wrong checksum", { ChecksumSHA256: encode("0".repeat(64)) }], ["missing checksum", { ChecksumSHA256: undefined }],
  ["composite checksum", { ChecksumType: "COMPOSITE" }], ["wrong key", { SSEKMSKeyId: archive.kmsKeyArn.replace("11111111", "22222222") }],
  ["wrong encryption", { ServerSideEncryption: "AES256" }], ["bucket key context", { BucketKeyEnabled: true }],
]) test(`provider receipt rejects ${label} and erases upload bytes`, async () => {
  const context = fixture();
  context.handler = (command) => ({ VersionId: "version-1", ServerSideEncryption: "aws:kms", SSEKMSKeyId: archive.kmsKeyArn,
    ChecksumSHA256: command.input.ChecksumSHA256, ...response });
  await assert.rejects(context.destination.putObject(context.request), /WRITE_FAILED/u);
  assert.equal(context.calls.length, 1); assert.equal(context.calls[0].command.input.Body.every((byte) => byte === 0), true);
});

test("provider failures are sanitized, never retried by the adapter, and erase bytes", async () => {
  const context = fixture(); context.handler = () => { throw new Error("private path or provider credential must not escape"); };
  await assert.rejects(context.destination.putObject(context.request), /^Error: PROTECTED_RECOVERY_S3_WRITE_FAILED$/u);
  assert.equal(context.calls.length, 1); assert.equal(context.calls[0].command.input.Body.every((byte) => byte === 0), true);
});

test("manifest publication verifies canonical digest and schema before any write", async () => {
  const context = fixture(); const item = manifestFixture();
  const request = { ...context.request, key: `manifests/${item.digest}.json`, body: item.bytes, expectedSize: item.bytes.length, checksumSha256: item.digest };
  const result = await context.destination.publishManifest(request);
  assert.equal(result.checksumSha256, item.digest); assert.equal(context.calls[0].command.input.ContentType, "application/json");
  assert.equal(item.bytes.equals(canonicalBytes(item.manifest)), true);
  const bad = fixture();
  await assert.rejects(bad.destination.publishManifest({ ...request, checksumSha256: "a".repeat(64) }), /WRITE_FAILED/u);
  assert.equal(bad.calls.length, 0);
  const malformed = Buffer.from("{}");
  await assert.rejects(bad.destination.publishManifest({ ...request, body: malformed, key: `manifests/${sha256(malformed)}.json`, expectedSize: malformed.length,
    checksumSha256: sha256(malformed) }), /WRITE_FAILED/u);
  assert.equal(bad.calls.length, 0);
});

test("empty complete manifest inventory returns null with manifests-only scope", async () => {
  const context = fixture(); context.handler = () => listPage();
  assert.equal(await context.destination.readPreviousManifest({ signal: context.request.signal }), null);
  assert.equal(context.calls.length, 1);
  assert.deepEqual(context.calls[0].command.input, { Bucket: archive.bucket, Prefix: "manifests/", MaxKeys: 1000, ExpectedBucketOwner: BACKUP_WORKLOAD.account });
});

test("complete paginated listing chooses latest published manifest and verifies its exact content", async () => {
  const context = fixture(); const item = manifestFixture();
  const older = { ...listEntry(item, "2026-10-23T21:00:00Z"), Key: `manifests/${"b".repeat(64)}.json` };
  context.handler = (command) => command.constructor.name === "ListObjectsV2Command"
    ? command.input.ContinuationToken ? listPage([listEntry(item)]) : listPage([older], { IsTruncated: true, NextContinuationToken: "page2" })
    : getResponse(item);
  assert.deepEqual(await context.destination.readPreviousManifest({ signal: context.request.signal }), { manifest: item.manifest, digest: item.digest });
  assert.equal(context.calls.length, 3); assert.equal(context.calls[1].command.input.ContinuationToken, "page2");
  assert.deepEqual(context.calls[2].command.input, { Bucket: archive.bucket, Key: `manifests/${item.digest}.json`, ExpectedBucketOwner: BACKUP_WORKLOAD.account, ChecksumMode: "ENABLED" });
  assert.equal(context.calls.some(({ command }) => /Delete|HeadObject/u.test(command.constructor.name)), false);
});

for (const [label, page] of [
  ["wrong bucket", () => listPage([], { Name: "other" })], ["unscoped prefix", () => listPage([], { Prefix: "objects/" })],
  ["unknown pagination state", () => listPage([], { IsTruncated: undefined })], ["count mismatch", () => listPage([], { KeyCount: 1 })],
  ["missing continuation token", () => listPage([listEntry()], { IsTruncated: true })], ["empty truncated page", () => listPage([], { IsTruncated: true, NextContinuationToken: "a" })],
  ["unexpected final token", () => listPage([], { NextContinuationToken: "a" })], ["duplicate keys", () => listPage([listEntry(), listEntry()])],
  ["blob key in listing", () => listPage([{ ...listEntry(), Key: `objects/customer-deliveries/${"a".repeat(64)}` }])],
  ["invalid time", () => listPage([{ ...listEntry(), LastModified: "2026-10-23" }])],
  ["invalid size", () => listPage([{ ...listEntry(), Size: 0 }])],
]) test(`previous lookup rejects ${label} before reading any archive content`, async () => {
  const context = fixture(); context.handler = () => page();
  await assert.rejects(context.destination.readPreviousManifest({ signal: context.request.signal }), /^Error: PROTECTED_RECOVERY_S3_READ_MANIFEST_FAILED$/u);
  assert.equal(context.calls.every(({ command }) => command.constructor.name === "ListObjectsV2Command"), true);
});

test("looping pagination and more than ten thousand manifests fail closed", async () => {
  const context = fixture(); let pageNumber = 0;
  context.handler = () => listPage([{ ...listEntry(), Key: `manifests/${String(++pageNumber).padStart(64, "0")}.json` }], { IsTruncated: true, NextContinuationToken: "same" });
  await assert.rejects(context.destination.readPreviousManifest({ signal: context.request.signal }), /READ_MANIFEST_FAILED/u);
  assert.equal(context.calls.length, 2);
  const bounded = fixture(); pageNumber = 0;
  bounded.handler = () => {
    const contents = Array.from({ length: 1000 }, (_, index) => ({ ...listEntry(), Key: `manifests/${String(pageNumber * 1000 + index).padStart(64, "0")}.json` }));
    return listPage(contents, { IsTruncated: true, NextContinuationToken: String(++pageNumber) });
  };
  await assert.rejects(bounded.destination.readPreviousManifest({ signal: bounded.request.signal }), /READ_MANIFEST_FAILED/u);
  assert.equal(bounded.calls.length, 10);
});

for (const [label, extra] of [
  ["missing version", { VersionId: undefined }], ["wrong size", { ContentLength: 1 }], ["wrong checksum", { ChecksumSHA256: encode("0".repeat(64)) }],
  ["wrong key", { SSEKMSKeyId: archive.kmsKeyArn.replace("11111111", "22222222") }], ["plaintext", { ServerSideEncryption: undefined }],
  ["wrong content", { Body: Readable.from([Buffer.from("bad")]) }],
]) test(`previous manifest rejects ${label}`, async () => {
  const context = fixture(); const item = manifestFixture();
  context.handler = (command) => command.constructor.name === "ListObjectsV2Command" ? listPage([listEntry(item)]) : getResponse(item, extra);
  await assert.rejects(context.destination.readPreviousManifest({ signal: context.request.signal }), /READ_MANIFEST_FAILED/u);
});

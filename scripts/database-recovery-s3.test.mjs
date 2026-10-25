import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { createDatabaseRecoveryS3Transport, DATABASE_RECOVERY_ARCHIVE_BUCKET, validateDatabaseRecoveryArchiveConfiguration } from "./lib/database-recovery-s3.mjs";
import { DATABASE_BACKUP_WORKLOAD } from "./lib/aws-database-backup-workload-credentials.mjs";
import { DATABASE_RECOVERY_LIMITS } from "./lib/database-recovery-protocol.mjs";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { canonicalBytes, canonicalSha256, sha256 } from "./lib/protected-recovery-core.mjs";

const archive = { bucket: DATABASE_RECOVERY_ARCHIVE_BUCKET, kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111" };
const releaseSha = "a".repeat(40);
const signal = () => new AbortController().signal;
const encode = (hex) => Buffer.from(hex, "hex").toString("base64");
const environment = { APP_DEPLOYMENT_ENV: "production", APP_DATABASE_BACKUP_AWS_RA_DEPLOYMENT_ENV: "production", APP_AWS_ACCOUNT_ID: DATABASE_BACKUP_WORKLOAD.account,
  AWS_REGION: DATABASE_BACKUP_WORKLOAD.region, APP_DATABASE_BACKUP_AWS_RA_ROLE_ARN: DATABASE_BACKUP_WORKLOAD.roleArn,
  APP_DATABASE_BACKUP_AWS_RA_PROFILE_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:profile/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  APP_DATABASE_BACKUP_AWS_RA_TRUST_ANCHOR_ARN: "arn:aws:rolesanywhere:us-east-1:838445019912:trust-anchor/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  APP_DATABASE_BACKUP_AWS_RA_HELPER_PATH: DATABASE_BACKUP_WORKLOAD.helperPath,
  APP_DATABASE_BACKUP_AWS_RA_CERTIFICATE_SHA256: "a".repeat(64), APP_DATABASE_BACKUP_AWS_RA_CA_CERTIFICATE_SHA256: "b".repeat(64),
  APP_DATABASE_BACKUP_BUCKET: archive.bucket, APP_DATABASE_BACKUP_KMS_KEY_ARN: archive.kmsKeyArn };

function fileManifest() {
  const inventory = { schemaVersion: "applypack-protected-recovery-inventory-v2", sourceEnvironment: "production", sourceProjectRef: "spjaaxndiduhrcleazwb",
    releaseSha, startedAt: "2026-10-25T15:00:00.000Z", completedAt: "2026-10-25T15:00:01.000Z",
    buckets: [...RECOVERY_BUCKETS], objects: [], references: [], tombstones: [], receipt: "r".repeat(128),
    serviceRetention: { schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
      sourceWatermark: "1970-01-01T00:00:00.000Z", orders: [], holds: [], objectTombstones: [], objectPolicies: [] },
    counts: { objects: 0, references: 0, tombstones: 0, tables: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, 0])) } };
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  const manifest = { schemaVersion: "applypack-protected-recovery-manifest-v1", archive, inventory, secondInventoryReceipt: "s".repeat(128),
    watermark: inventory.startedAt, createdAt: "2026-10-25T15:00:02.000Z", previousManifestDigest: null, entries: [] };
  return { manifest, digest: canonicalSha256(manifest), bytes: canonicalBytes(manifest), versionId: "exact-file-manifest-version" };
}
function rolesMetadata() {
  return { schemaVersion: "applypack-database-roles-metadata-v1", sourceProjectRef: "spjaaxndiduhrcleazwb", releaseSha,
    snapshotId: "00000003-0000001B-1", roles: [{ oid: 10, name: "postgres", superuser: false, inherit: true, createRole: false,
      createDatabase: false, canLogin: true, replication: false, bypassRls: true, connectionLimit: -1, validUntil: null }], memberships: [] };
}
function databaseManifest() {
  const file = fileManifest(); const dump = Buffer.from("PGDMP synthetic"); const roles = canonicalBytes(rolesMetadata());
  const snapshot = { sourceProjectRef: "spjaaxndiduhrcleazwb", releaseSha, schemaVersion: "202610250092",
    startedAt: "2026-10-25T15:00:03.000Z", postgresVersion: "17.11", pgDumpVersion: "17.11", snapshotId: rolesMetadata().snapshotId,
    coverage: { schemas: ["public", "auth", "storage", "supabase_migrations"], allTablesReadable: true, rowSecurityBypass: true,
      roleDefinitionsIncluded: true, rolePasswordsIncluded: false, providerConfigurationIncluded: false } };
  const checkpoint = { schemaVersion: "applypack-protected-recovery-checkpoint-v1", sourceEnvironment: "production",
    sourceProjectRef: snapshot.sourceProjectRef, releaseSha, sourceStartedAt: file.manifest.watermark, completedAt: "2026-10-25T15:00:02.000Z",
    inventoryDigest: file.manifest.inventory.inventoryDigest, manifestSha256: file.digest, manifestVersionId: file.versionId,
    objectCount: 0, referenceCount: 0, tombstoneCount: 0 };
  const manifest = { schemaVersion: "applypack-database-recovery-manifest-v1", archive, snapshot,
    inventoryDigest: checkpoint.inventoryDigest, fileCheckpoint: checkpoint,
    fileManifest: { key: `manifests/${file.digest}.json`, sha256: file.digest, versionId: file.versionId },
    dump: { key: `database/dumps/${sha256(dump)}.dump`, versionId: "db-version", sha256: sha256(dump), size: dump.length,
      format: "postgresql-custom", subprocessExitCode: 0 },
    roles: { key: `database/roles/${sha256(roles)}.json`, versionId: "roles-version", sha256: sha256(roles), size: roles.length,
      roleCount: 1, membershipCount: 0, passwordsIncluded: false }, watermark: checkpoint.sourceStartedAt,
    createdAt: "2026-10-25T15:00:04.000Z", serviceRecoveryComplete: false, readinessUpdated: false };
  return { manifest, bytes: canonicalBytes(manifest), digest: canonicalSha256(manifest) };
}
function fixture() {
  const context = { calls: [], closed: false, handler: undefined };
  const client = { send: async (command, options) => {
    context.calls.push({ command, options });
    if (context.handler) return context.handler(command, options);
    return { ServerSideEncryption: "aws:kms", SSEKMSKeyId: archive.kmsKeyArn, VersionId: "immutable-version-1",
      ChecksumSHA256: command.input.ChecksumSHA256, ChecksumType: "FULL_OBJECT" };
  }, destroy: () => { context.closed = true; } };
  context.destination = createDatabaseRecoveryS3Transport({ client, archive });
  return context;
}
function getResponse(item, extra = {}) {
  return { ServerSideEncryption: "aws:kms", SSEKMSKeyId: archive.kmsKeyArn, VersionId: item.versionId,
    ContentLength: item.bytes.length, ChecksumSHA256: encode(item.digest), Body: Readable.from([item.bytes]), ...extra };
}

test("archive configuration binds exact bucket, key account and separate identity", () => {
  assert.deepEqual(validateDatabaseRecoveryArchiveConfiguration(environment), archive);
  assert.equal(Object.isFrozen(validateDatabaseRecoveryArchiveConfiguration(environment)), true);
  for (const extra of [{ APP_DATABASE_BACKUP_BUCKET: "other" }, { APP_DATABASE_BACKUP_KMS_KEY_ARN: archive.kmsKeyArn.replace("838445019912", "123456789012") },
    { APP_DATABASE_BACKUP_KMS_KEY_ARN: "alias/backup" }, { APP_DATABASE_BACKUP_AWS_RA_ROLE_ARN: DATABASE_BACKUP_WORKLOAD.roleArn.replace("database-backup", "recovery") }]) {
    assert.throws(() => validateDatabaseRecoveryArchiveConfiguration({ ...environment, ...extra }));
  }
});

test("bounded dump is fully consumed and checksummed before a fixed encrypted versioned write", async () => {
  const context = fixture(); const input = Buffer.from("PGDMP synthetic dump bytes"); let completed = false;
  const requestSignal = signal();
  async function* body() { yield input.subarray(0, 5); yield input.subarray(5); completed = true; }
  context.handler = (command) => {
    assert.equal(completed, true); assert.ok(command.input.Body.equals(input));
    return { ServerSideEncryption: "aws:kms", SSEKMSKeyId: archive.kmsKeyArn, VersionId: "exact-db-version", ChecksumSHA256: encode(sha256(input)) };
  };
  const result = await context.destination.putDatabaseDump({ body: body(), signal: requestSignal });
  const digest = sha256(input); const key = `database/dumps/${digest}.dump`;
  assert.deepEqual(result, { key, versionId: "exact-db-version", checksumSha256: digest, size: input.length, serverSideEncryption: "aws:kms", kmsKeyId: archive.kmsKeyArn });
  const { command, options } = context.calls[0];
  assert.equal(command.constructor.name, "PutObjectCommand"); assert.equal(command.input.Key, key);
  assert.equal(command.input.ExpectedBucketOwner, "838445019912"); assert.equal(command.input.Bucket, archive.bucket);
  assert.equal(command.input.SSEKMSKeyId, archive.kmsKeyArn); assert.equal(command.input.BucketKeyEnabled, false);
  assert.equal(command.input.ChecksumAlgorithm, "SHA256"); assert.equal(command.input.ChecksumSHA256, encode(digest));
  assert.equal(command.input.ContentLength, input.length); assert.equal(options.abortSignal, requestSignal);
  assert.ok(command.input.Body.every((byte) => byte === 0), "adapter-owned plaintext buffer cleared after acknowledgement");
  assert.equal(input.toString(), "PGDMP synthetic dump bytes", "caller retains ownership of its original buffer");
  assert.deepEqual(Object.keys(context.destination).sort(), ["archive", "close", "putDatabaseDump", "putDatabaseManifest", "putRolesMetadata", "readFileManifest"].sort());
  context.destination.close(); assert.equal(context.closed, true);
});

for (const [label, extra] of [
  ["missing version", { VersionId: undefined }], ["null version", { VersionId: "null" }], ["invalid version", { VersionId: "bad\nprivate" }],
  ["wrong checksum", { ChecksumSHA256: encode("f".repeat(64)) }], ["composite checksum", { ChecksumType: "COMPOSITE" }],
  ["missing checksum", { ChecksumSHA256: undefined }], ["wrong KMS key", { SSEKMSKeyId: archive.kmsKeyArn.replace("11111111", "22222222") }],
  ["plaintext", { ServerSideEncryption: undefined }], ["bucket key", { BucketKeyEnabled: true }],
]) test(`write receipt rejects ${label} and clears owned bytes`, async () => {
  const context = fixture();
  context.handler = (command) => ({ ServerSideEncryption: "aws:kms", SSEKMSKeyId: archive.kmsKeyArn, VersionId: "version",
    ChecksumSHA256: command.input.ChecksumSHA256, ...extra });
  await assert.rejects(context.destination.putDatabaseDump({ body: Buffer.from("private"), signal: signal() }), /^Error: DATABASE_RECOVERY_S3_WRITE_FAILED$/u);
  assert.ok(context.calls[0].command.input.Body.every((byte) => byte === 0));
});

test("empty, excess, malformed and failed streams never reach S3", async () => {
  for (const body of [Buffer.alloc(0), Readable.from(["private-text-not-bytes"]), { async *[Symbol.asyncIterator]() { throw new Error("private-row-value"); } }]) {
    const context = fixture(); await assert.rejects(context.destination.putDatabaseDump({ body, signal: signal() }), /^Error: DATABASE_RECOVERY_S3_WRITE_FAILED$/u);
    assert.equal(context.calls.length, 0);
  }
  const context = fixture(); let returned = false;
  const over = { [Symbol.asyncIterator]() { let sent = 0; return { next: async () => ({ done: false, value: Buffer.alloc(Math.min(1024 * 1024, DATABASE_RECOVERY_LIMITS.dumpBytes + 1 - sent++ * 1024 * 1024), 1) }),
    return: async () => { returned = true; return { done: true }; } }; } };
  await assert.rejects(context.destination.putDatabaseDump({ body: over, signal: signal() }), /WRITE_FAILED/u);
  assert.equal(context.calls.length, 0); assert.equal(returned, true);
});

test("abort bounds stalled streams and provider calls without exposing private errors", async () => {
  const context = fixture(); const controller = new AbortController(); let returned = false;
  const stuck = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: async () => { returned = true; return { done: true }; } }) };
  const pending = context.destination.putDatabaseDump({ body: stuck, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, /^Error: DATABASE_RECOVERY_S3_WRITE_FAILED$/u); assert.equal(returned, true); assert.equal(context.calls.length, 0);
  const provider = fixture(); const second = new AbortController(); provider.handler = () => new Promise(() => {});
  const waiting = provider.destination.putDatabaseDump({ body: Buffer.from("private"), signal: second.signal });
  setImmediate(() => second.abort()); await assert.rejects(waiting, /WRITE_FAILED/u);
  assert.ok(provider.calls[0].command.input.Body.every((byte) => byte === 0));
  const errors = fixture(); errors.handler = () => { throw new Error("private-auth-or-customer-row"); };
  await assert.rejects(errors.destination.putDatabaseDump({ body: Buffer.from("private"), signal: signal() }), /^Error: DATABASE_RECOVERY_S3_WRITE_FAILED$/u);
});

test("roles metadata is canonical, schema bound and cannot contain passwords or arbitrary JSON", async () => {
  const context = fixture(); const bytes = canonicalBytes(rolesMetadata());
  const result = await context.destination.putRolesMetadata({ body: bytes, signal: signal() });
  assert.equal(result.key, `database/roles/${sha256(bytes)}.json`);
  for (const body of [Buffer.from(JSON.stringify(rolesMetadata(), null, 2)), canonicalBytes({ ...rolesMetadata(), password: "private" }), Buffer.from("{}"), Buffer.from([0xff])]) {
    const invalid = fixture(); await assert.rejects(invalid.destination.putRolesMetadata({ body, signal: signal() }), /WRITE_FAILED/u); assert.equal(invalid.calls.length, 0);
  }
});

test("abort at stream EOF or between collection and write never reaches S3", async () => {
  for (const atEof of [false, true]) {
    const context = fixture(); const controller = new AbortController();
    const body = atEof ? (async function* () { yield Buffer.from("PGDMP synthetic"); controller.abort(); })()
      : Buffer.from("PGDMP synthetic");
    const pending = context.destination.putDatabaseDump({ body, signal: controller.signal });
    if (!atEof) controller.abort();
    await assert.rejects(pending, /WRITE_FAILED/u); assert.equal(context.calls.length, 0);
  }
});

test("database manifest rejects incorrect digest or unvalidated body before publication", async () => {
  for (const request of [{ body: Buffer.from("{}"), digest: "a".repeat(64) }, { body: Buffer.from("{}"), digest: sha256(Buffer.from("{}")) },
    { body: Buffer.from([0xff]), digest: sha256(Buffer.from([0xff])) }]) {
    const context = fixture(); await assert.rejects(context.destination.putDatabaseManifest({ ...request, signal: signal() }), /WRITE_FAILED/u); assert.equal(context.calls.length, 0);
  }
});

test("valid database manifest publishes only under its digest and exact bound archive", async () => {
  const context = fixture(); const item = databaseManifest();
  const result = await context.destination.putDatabaseManifest({ body: item.bytes, digest: item.digest, signal: signal() });
  assert.equal(result.key, `database/manifests/${item.digest}.json`); assert.equal(result.checksumSha256, item.digest);
  assert.equal(result.size, item.bytes.length); assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].command.input.ContentType, "application/json");
  assert.ok(context.calls[0].command.input.Body.every((byte) => byte === 0));
  for (const candidate of [
    { ...item.manifest, archive: { ...archive, kmsKeyArn: archive.kmsKeyArn.replace("11111111", "22222222") } },
    { ...item.manifest, fileManifest: { ...item.manifest.fileManifest, versionId: "not-the-acknowledged-file-version" } },
    { ...item.manifest, readinessUpdated: true },
  ]) {
    const invalid = fixture(); await assert.rejects(invalid.destination.putDatabaseManifest({ body: canonicalBytes(candidate),
      digest: canonicalSha256(candidate), signal: signal() }), /WRITE_FAILED/u); assert.equal(invalid.calls.length, 0);
  }
});

test("file manifest GET uses only the acknowledged exact digest and VersionId", async () => {
  const context = fixture(); const item = fileManifest(); context.handler = () => getResponse(item);
  const requestSignal = signal();
  assert.deepEqual(await context.destination.readFileManifest({ digest: item.digest, versionId: item.versionId, signal: requestSignal }),
    { manifest: item.manifest, digest: item.digest, versionId: item.versionId });
  assert.equal(context.calls.length, 1); const { command, options } = context.calls[0];
  assert.equal(command.constructor.name, "GetObjectCommand");
  assert.deepEqual(command.input, { Bucket: archive.bucket, Key: `manifests/${item.digest}.json`, VersionId: item.versionId,
    ExpectedBucketOwner: "838445019912", ChecksumMode: "ENABLED" });
  assert.equal(options.abortSignal, requestSignal);
});

for (const [label, extra] of [
  ["wrong version", { VersionId: "different" }], ["missing version", { VersionId: undefined }], ["missing size", { ContentLength: undefined }],
  ["oversized body", { ContentLength: 16 * 1024 * 1024 + 1 }], ["wrong length", { ContentLength: 1 }],
  ["wrong checksum", { ChecksumSHA256: encode("0".repeat(64)) }], ["composite checksum", { ChecksumType: "COMPOSITE" }],
  ["wrong key", { SSEKMSKeyId: archive.kmsKeyArn.replace("11111111", "22222222") }], ["plaintext", { ServerSideEncryption: undefined }],
  ["bucket key", { BucketKeyEnabled: true }], ["wrong bytes", { Body: Readable.from([Buffer.from("private-invalid")]) }],
]) test(`exact file manifest read rejects ${label}`, async () => {
  const context = fixture(); const item = fileManifest(); context.handler = () => getResponse(item, extra);
  await assert.rejects(context.destination.readFileManifest({ digest: item.digest, versionId: item.versionId, signal: signal() }), /^Error: DATABASE_RECOVERY_S3_READ_FILE_MANIFEST_FAILED$/u);
  assert.equal(context.calls.length, 1); assert.equal(context.calls[0].command.constructor.name, "GetObjectCommand");
});

test("missing or unsafe checkpoint identity makes no archive request", async () => {
  for (const request of [{ digest: "a".repeat(64) }, { digest: "a".repeat(64), versionId: "null" }, { digest: "../private", versionId: "v1" },
    { digest: "a".repeat(64), versionId: "v1", signal: undefined }]) {
    const context = fixture(); await assert.rejects(context.destination.readFileManifest({ signal: signal(), ...request }), /READ_FILE_MANIFEST_FAILED/u); assert.equal(context.calls.length, 0);
  }
});

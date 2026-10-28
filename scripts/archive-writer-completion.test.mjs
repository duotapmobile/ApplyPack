import assert from "node:assert/strict";
import test from "node:test";
import { archiveHistoryFixture } from "./recovery-archive-test-fixture.mjs";
import { canonicalBytes, canonicalSha256 } from "./lib/protected-recovery-core.mjs";
import { createArchiveEvidenceReader } from "./lib/recovery-archive-evidence.mjs";
import { verifyArchiveWriterCompletion, inspectDatabaseArchiveCompletion, readDatabaseArchiveStatus } from "./lib/archive-writer-completion.mjs";

const now = Date.parse("2026-10-24T00:00:06.000Z");
const id = "f9800000-0000-4000-8000-000000000001";
async function fixture(kind = "DATABASE", targeted = false) {
  const f = archiveHistoryFixture();
  const sources = [f.file, f.database];
  const s3 = { async send(command) {
    const input = command.input;
    if (command.constructor.name === "ListObjectVersionsCommand") return { Name: f.file.manifest.archive.bucket, Prefix: input.Prefix, IsTruncated: false,
      Versions: f.versions.filter((v) => v.key.startsWith(input.Prefix)).map((v) => ({ Key: v.key, VersionId: v.versionId, Size: v.size, IsLatest: true, LastModified: new Date(now - 500) })) };
    const stored = f.versions.find((v) => v.key === input.Key && v.versionId === input.VersionId); assert(stored);
    const source = sources.find((v) => v.key === input.Key && v.versionId === input.VersionId);
    const digest = source?.digest ?? (input.Key.startsWith("objects/") ? f.file.manifest.entries[0].sha256 : f.database.manifest.dump.sha256);
    return { VersionId: stored.versionId, ContentLength: stored.size, LastModified: new Date(now - 500), ServerSideEncryption: "aws:kms", SSEKMSKeyId: f.file.manifest.archive.kmsKeyArn,
      ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"), ChecksumType: "FULL_OBJECT", ...(source ? { Body: canonicalBytes(source.manifest) } : {}) };
  } };
  const reader = createArchiveEvidenceReader({ s3, archive: f.file.manifest.archive, now: () => now,
    sts: { async send() { return { Account: "838445019912", Arn: "arn:aws:sts::838445019912:assumed-role/applypack-production-recovery-reader/fixture" }; } } });
  const source = kind === "DATABASE" ? f.database : f.file;
  const proof = targeted ? await reader.readWriter({ kind, manifestSha256: source.digest, manifestVersionId: source.versionId,
    signal: AbortSignal.timeout(2000) }) : await reader.read({ signal: AbortSignal.timeout(2000) });
  const input = { proof, run: { id, kind, state: "OPEN", provider_dispatched: true, release_sha: "a".repeat(40),
    started_at: kind === "DATABASE" ? "2026-10-24T00:00:03.500Z" : "2026-10-23T23:59:59.000Z" },
    manifestSha256: source.digest, manifestVersionId: source.versionId, checkpoint: f.database.manifest.fileCheckpoint, expectedSchemaVersion: "202610250093", now };
  return input;
}
function completedRow(input) {
  const result = verifyArchiveWriterCompletion(input);
  return { ...input.run, state: "COMPLETE", completion_receipt: result.receipt, result_sha256: result.sha256,
    finished_at: new Date(now + 10).toISOString() };
}
const options = { releaseSha: "a".repeat(40), expectedSchemaVersion: "202610250093", now: now + 1000 };

test("real read-role evidence and exact application checkpoint create a bounded content-free database receipt", async () => {
  const input = await fixture(); const row = completedRow(input);
  const status = inspectDatabaseArchiveCompletion(row, options);
  assert.equal(status.state, "VERIFIED"); assert.equal(status.sourceWatermark, input.checkpoint.sourceStartedAt);
  assert.equal(status.schemaVersionOfSnapshot, "202610250093"); assert.equal(status.verifiedAt, new Date(now).toISOString());
  assert.equal(status.evidenceExpiresAt, "2026-10-24T00:15:00.000Z");
  assert(!JSON.stringify(status).includes("private/source"));
  assert.equal(row.result_sha256, canonicalSha256(row.completion_receipt));
});
test("file completion uses its own source and cannot masquerade as a database checkpoint", async () => {
  const input = await fixture("FILE"); const row = completedRow(input);
  assert.equal(row.completion_receipt.databaseSnapshotAt, null);
  assert.equal(inspectDatabaseArchiveCompletion(row, options).state, "UNKNOWN");
});
for (const kind of ["FILE", "DATABASE"]) test(`${kind} targeted proof creates only its exact completion receipt`, async () => {
  const input = await fixture(kind, true); const row = completedRow(input);
  assert.equal(row.completion_receipt.kind, kind);
  assert.equal(row.completion_receipt.manifestSha256, input.manifestSha256);
  assert.throws(() => verifyArchiveWriterCompletion({ ...input, manifestVersionId: "other" }), /WRITER_PROOF_TARGET/u);
  assert.throws(() => verifyArchiveWriterCompletion({ ...input, run: { ...input.run, kind: kind === "FILE" ? "DATABASE" : "FILE" } }), /WRITER_PROOF_TARGET/u);
});
for (const [name, mutate] of [
  ["imported provider flag", (x) => { x.proof = { ...x.proof, verified: true }; }],
  ["upload not dispatched", (x) => { x.run.provider_dispatched = false; }],
  ["wrong release", (x) => { x.run.release_sha = "b".repeat(40); }],
  ["unknown manifest", (x) => { x.manifestVersionId = "other"; }],
  ["wrong snapshot schema", (x) => { x.expectedSchemaVersion = "202610250094"; }],
  ["different checkpoint", (x) => { x.checkpoint.manifestVersionId = "other"; }],
  ["different watermark", (x) => { x.checkpoint.sourceStartedAt = "2026-10-24T00:00:01.000Z"; }],
  ["different application count", (x) => { x.checkpoint.objectCount++; }],
  ["late provider verification", (x) => { x.now += 61000; }],
  ["snapshot predates writer", (x) => { x.run.started_at = "2026-10-24T00:00:05.000Z"; }],
]) test(`completion rejects ${name}`, async () => {
  const input = await fixture(); mutate(input); assert.throws(() => verifyArchiveWriterCompletion(input));
});
for (const [name, mutate, expected = "INVALID_COMPLETION"] of [
  ["upload-only old row", (x) => { delete x.completion_receipt; }],
  ["opaque digest", (x) => { x.result_sha256 = "b".repeat(64); }],
  ["different run", (x) => { x.id = "f9800000-0000-4000-8000-000000000002"; }],
  ["open writer", (x) => { x.state = "OPEN"; }],
  ["future completion", (x) => { x.finished_at = "2026-10-25T00:00:00Z"; }, "EXPIRED_OR_INVALID_TIME"],
  ["incorrect fifteen-minute evidence", (x) => { x.completion_receipt.evidenceExpiresAt = "2026-10-24T00:16:00Z"; x.result_sha256 = canonicalSha256(x.completion_receipt); }, "EXPIRED_OR_INVALID_TIME"],
]) test(`monitor remains unknown for ${name}`, async () => {
  const row = completedRow(await fixture()); mutate(row); const status = inspectDatabaseArchiveCompletion(row, options);
  assert.deepEqual(status, { schemaVersion: "applypack-database-archive-status-v1", state: "UNKNOWN", reason: expected });
});
test("monitor fails a different current release/schema and expired evidence without refreshing its time", async () => {
  const row = completedRow(await fixture());
  assert.equal(inspectDatabaseArchiveCompletion(row, { ...options, releaseSha: "b".repeat(40) }).reason, "RELEASE_OR_SCHEMA_MISMATCH");
  assert.equal(inspectDatabaseArchiveCompletion(row, { ...options, expectedSchemaVersion: "202610250094" }).reason, "RELEASE_OR_SCHEMA_MISMATCH");
  assert.equal(inspectDatabaseArchiveCompletion(row, { ...options, now: Date.parse("2026-10-24T00:15:00Z") }).reason, "EXPIRED_OR_INVALID_TIME");
});
test("bounded read does one exact read and returns verified metadata", async () => {
  const row = completedRow(await fixture()); let count = 0;
  const result = await readDatabaseArchiveStatus({ ...options, now: () => options.now,
    readLatestDatabaseCompletion: async ({ signal }) => { count++; assert(signal instanceof AbortSignal); return row; } });
  assert.equal(count, 1); assert.equal(result.state, "VERIFIED");
});
test("missing, thrown and hung reads remain unknown, with cancellation and no retries", async () => {
  for (const read of [async () => null, async () => { throw new Error("secret provider error"); }, () => new Promise(() => {})]) {
    let count = 0; let signal;
    const result = await readDatabaseArchiveStatus({ ...options, now: () => options.now, timeoutMilliseconds: 10,
      readLatestDatabaseCompletion: (input) => { count++; signal = input.signal; return read(); } });
    assert.equal(result.state, "UNKNOWN"); assert.equal(count, 1); assert.equal(signal.aborted, true);
    assert(!JSON.stringify(result).includes("secret"));
  }
});

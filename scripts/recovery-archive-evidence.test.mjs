import assert from "node:assert/strict";
import test from "node:test";
import { archiveHistoryFixture } from "./recovery-archive-test-fixture.mjs";
import { canonicalBytes } from "./lib/protected-recovery-core.mjs";
import { authenticatedArchiveEvidence, createArchiveEvidenceReader } from "./lib/recovery-archive-evidence.mjs";

const now = Date.parse("2026-10-25T00:00:00Z");
function transport(change = () => {}) {
  const f = archiveHistoryFixture(); const calls = [];
  const manifests = new Map([f.file, f.database].map((value) => [`${value.key}\u0000${value.versionId}`, value]));
  const claims = new Map([
    ...f.file.manifest.entries.map((entry) => [`${entry.archiveKey}\u0000${entry.archiveVersionId}`, entry.sha256]),
    ...[f.database.manifest.dump, f.database.manifest.roles].map((entry) => [`${entry.key}\u0000${entry.versionId}`, entry.sha256]),
  ]);
  const sts = { async send(command) { calls.push(command); const value = { Account: "838445019912", Arn: "arn:aws:sts::838445019912:assumed-role/applypack-production-recovery-reader/test" }; change(command, value); return value; } };
  const s3 = { async send(command) {
    calls.push(command); let value;
    if (command.constructor.name === "ListObjectVersionsCommand") value = { Name: f.file.manifest.archive.bucket, Prefix: command.input.Prefix, IsTruncated: false,
      Versions: f.versions.filter((v) => v.key.startsWith(command.input.Prefix)).map((v) => ({ Key: v.key, VersionId: v.versionId, Size: v.size,
        IsLatest: true, LastModified: new Date(now - 86400000 + 10000) })) };
    else {
      const id = `${command.input.Key}\u0000${command.input.VersionId}`; const m = manifests.get(id); const listed = f.versions.find((v) => v.key === command.input.Key && v.versionId === command.input.VersionId);
      const digest = m?.digest ?? claims.get(id);
      assert(listed && digest);
      value = { VersionId: listed.versionId, ContentLength: listed.size, ServerSideEncryption: "aws:kms", SSEKMSKeyId: f.file.manifest.archive.kmsKeyArn,
        ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"), ChecksumType: "FULL_OBJECT", ...(m ? { Body: canonicalBytes(m.manifest) } : {}) };
    }
    change(command, value); return value;
  } };
  return { f, calls, reader: createArchiveEvidenceReader({ s3, sts, archive: f.file.manifest.archive, now: () => now }) };
}
test("only exact SDK read-role responses produce a process-local authenticated proof", async () => {
  const { reader, calls } = transport(); const proof = await reader.read({ signal: AbortSignal.timeout(2000) });
  const detail = authenticatedArchiveEvidence(proof);
  assert.equal(detail.fileManifests.length, 1); assert.equal(detail.databaseManifests.length, 1); assert.equal(detail.pins.length, 4);
  assert.equal(detail.privateContentRead, false); assert.equal(detail.hostedRestoreVerified, false); assert.equal(detail.applicationCheckpointVerified, false);
  assert(calls.every((v) => !/Put|Delete|Create|Update/u.test(v.constructor.name)));
  assert(calls.filter((v) => v.constructor.name === "GetObjectCommand").every((v) => /manifests\//u.test(v.input.Key) && v.input.VersionId));
  assert(calls.filter((v) => v.constructor.name === "HeadObjectCommand").every((v) => v.input.ChecksumMode === "ENABLED" && v.input.VersionId));
  detail.versions.splice(0); assert(authenticatedArchiveEvidence(proof).versions.length > 0);
  assert.throws(() => authenticatedArchiveEvidence(structuredClone(proof)), /AUTHENTICATED_PROOF_REQUIRED/u);
});
for (const [name, change] of [
  ["wrong reader role", (c, r) => { if(c.constructor.name === "GetCallerIdentityCommand") r.Arn = "arn:aws:sts::838445019912:assumed-role/applypack-production-recovery-retention/test"; }],
  ["wrong account", (c, r) => { if(c.constructor.name === "GetCallerIdentityCommand") r.Account = "000000000000"; }],
  ["delete marker", (c, r) => { if(c.constructor.name === "ListObjectVersionsCommand") r.DeleteMarkers = [{}]; }],
  ["unversioned archive", (c, r) => { if(c.constructor.name === "ListObjectVersionsCommand" && r.Versions.length) r.Versions[0].VersionId = "null"; }],
  ["truncated missing cursor", (c, r) => { if(c.constructor.name === "ListObjectVersionsCommand") r.IsTruncated = true; }],
  ["wrong manifest version", (c, r) => { if(c.constructor.name === "GetObjectCommand") r.VersionId = "other"; }],
  ["wrong encryption key", (c, r) => { if(c.constructor.name === "GetObjectCommand") r.SSEKMSKeyId = "wrong"; }],
  ["tampered manifest bytes", (c, r) => { if(c.constructor.name === "GetObjectCommand") r.Body[0] = 32; }],
  ["wrong referenced checksum", (c, r) => { if(c.constructor.name === "HeadObjectCommand") r.ChecksumSHA256 = Buffer.alloc(32).toString("base64"); }],
  ["wrong referenced size", (c, r) => { if(c.constructor.name === "HeadObjectCommand") r.ContentLength++; }],
  ["composite checksum", (c, r) => { if(c.constructor.name === "HeadObjectCommand") r.ChecksumType = "COMPOSITE"; }],
]) test(`provider proof rejects ${name}`, async () => {
  const { reader } = transport(change); await assert.rejects(reader.read({ signal: AbortSignal.timeout(2000) }));
});
test("imported metadata cannot manufacture authenticated evidence", () => {
  const f = archiveHistoryFixture(); assert.throws(() => authenticatedArchiveEvidence({ ...f, verified: true }), /AUTHENTICATED_PROOF_REQUIRED/u);
});
test("a stalled provider read respects the caller hard deadline", async () => {
  const { f } = transport(); const reader = createArchiveEvidenceReader({ archive: f.file.manifest.archive, s3: {}, sts: { send: () => new Promise(() => {}) } });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20);
  try { await assert.rejects(reader.read({ signal: controller.signal }), /ABORTED/u); } finally { clearTimeout(timer); }
});

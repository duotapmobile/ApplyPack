import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { canonicalSha256, RECOVERY_BUCKETS, sha256 } from "./lib/protected-recovery-core.mjs";
import { validateRecoveryRegistration, readIndependentRecoveryCredentials, createIndependentArchiveReader,
  createRegisteredRestoreTarget, RESTORE_LOCKS } from "./lib/protected-recovery-restore.mjs";

const SYNTHETIC_TARGET_KEY = "SYNTHETIC_RECOVERY_TARGET_KEY_FOR_OFFLINE_TESTS_ONLY";
const NOW = Date.parse("2026-10-23T23:00:00Z");
const role = "arn:aws:iam::838445019912:role/applypack/production/applypack-production-recovery-reader";
function registration() {
  return { schemaVersion: "applypack-protected-recovery-target-registration-v1", targetProjectRef: "abcdefghijklmnopqrst",
    targetOrigin: "https://abcdefghijklmnopqrst.supabase.co", sourceReleaseSha: "a".repeat(40), manifestSha256: "b".repeat(64),
    manifestVersionId: "exact-manifest-version", archive: { bucket: "applypack-production-protected-recovery-838445019912",
      kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111" },
    registeredAt: new Date(NOW - 1000).toISOString(), providerEvidenceSha256: "c".repeat(64),
    registeredBy: "arn:aws:iam::838445019912:user/independent-recovery-owner", independentRecoveryRoleArn: role,
    locks: Object.fromEntries(RESTORE_LOCKS.map((key) => [key, true])) };
}
test("accepts only exact digest-bound fresh recovery-target registration", () => {
  const value = registration(); assert.equal(validateRecoveryRegistration(value, canonicalSha256(value), NOW), value);
  assert.throws(() => validateRecoveryRegistration(value, "d".repeat(64), NOW), /REGISTRATION/u);
});
for (const [label, mutate] of [
  ["production", (r) => { r.targetProjectRef = "spjaaxndiduhrcleazwb"; r.targetOrigin = "https://spjaaxndiduhrcleazwb.supabase.co"; }],
  ["staging", (r) => { r.targetProjectRef = "fmugizadzdnqfckujqlw"; r.targetOrigin = "https://fmugizadzdnqfckujqlw.supabase.co"; }],
  ["different origin", (r) => { r.targetOrigin = "https://evil.example"; }],
  ["unversioned archive", (r) => { r.manifestVersionId = "null"; }],
  ["stale evidence", (r) => { r.registeredAt = new Date(NOW - 900001).toISOString(); }],
  ["future evidence", (r) => { r.registeredAt = new Date(NOW + 1).toISOString(); }],
  ["original staging operator", (r) => { r.registeredBy = "arn:aws:iam::838445019912:user/applypack-staging-operator"; }],
  ["wrong role", (r) => { r.independentRecoveryRoleArn = "arn:aws:iam::838445019912:role/web"; }],
  ["unlocked customers", (r) => { r.locks.customerAccessLocked = false; }],
  ["unknown lock claim", (r) => { r.locks.extra = true; }],
]) test(`rejects recovery registration ${label}`, () => {
  const value = registration(); mutate(value); assert.throws(() => validateRecoveryRegistration(value, canonicalSha256(value), NOW), /PROTECTED_RECOVERY_RESTORE_/u);
});
test("independent credentials use exact installed CLI/profile with pipe output and no shell", () => {
  let args; let output;
  const credentials = readIndependentRecoveryCredentials({ environment: {}, platform: "win32", now: NOW,
    exec: (...received) => { args = received; output = Buffer.from(JSON.stringify({ Version: 1, AccessKeyId: `ASIA${"A".repeat(16)}`,
      SecretAccessKey: "s".repeat(40), SessionToken: "t".repeat(100), Expiration: new Date(NOW + 3600000).toISOString() })); return output; } });
  assert.equal(args[0], "C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe");
  assert.deepEqual(args[1], ["configure", "export-credentials", "--profile", "applypack-production-recovery", "--format", "process"]);
  assert.deepEqual(args[2].stdio, ["ignore", "pipe", "pipe"]); assert.equal(args[2].shell, undefined);
  assert.equal(credentials.accessKeyId.startsWith("ASIA"), true); assert.ok(output.every((byte) => byte === 0));
});
for (const name of ["AWS_ACCESS_KEY_ID", "AWS_ENDPOINT_URL_STS", "AWS_SHARED_CREDENTIALS_FILE", "NODE_TLS_REJECT_UNAUTHORIZED"]) {
  test(`independent credentials reject inherited override ${name}`, () => {
    assert.throws(() => readIndependentRecoveryCredentials({ environment: { [name]: "synthetic" }, platform: "win32", now: NOW }), /ALTERNATE_CREDENTIALS/u);
  });
}
test("wrong AWS role fails before archive reads", async () => {
  let reads = 0;
  const reader = createIndependentArchiveReader({ registration: registration(), credentials: {},
    s3: { send: async () => { reads++; }, destroy() {} },
    sts: { send: async () => ({ Account: "838445019912", Arn: "arn:aws:iam::838445019912:user/applypack-staging-operator" }), destroy() {} } });
  await assert.rejects(reader.readManifest({ signal: new AbortController().signal }), /OPERATOR_IDENTITY/u);
  assert.equal(reads, 0);
});
test("archive exactVersion read binds owner/key/encryption and validates manifest bytes", async () => {
  const value = registration(); const bytes = Buffer.from('{"synthetic":true}'); value.manifestSha256 = sha256(bytes);
  let request;
  const reader = createIndependentArchiveReader({ registration: value, credentials: {},
    sts: { send: async () => ({ Account: "838445019912", Arn: "arn:aws:sts::838445019912:assumed-role/applypack-production-recovery-reader/human-session" }), destroy() {} },
    s3: { send: async (command) => { request = command.input; return { VersionId: value.manifestVersionId, ContentLength: bytes.length,
      ServerSideEncryption: "aws:kms", SSEKMSKeyId: value.archive.kmsKeyArn, Body: Readable.from([bytes]) }; }, destroy() {} } });
  assert.deepEqual(await reader.readManifest({ signal: new AbortController().signal }), { synthetic: true });
  assert.equal(request.VersionId, value.manifestVersionId); assert.equal(request.ExpectedBucketOwner, "838445019912");
  assert.equal(request.Key, `manifests/${value.manifestSha256}.json`);
});
function targetFixture({ unlocked = false, existing = false } = {}) {
  const calls = []; const stored = new Map(); const value = registration();
  const target = createRegisteredRestoreTarget({ registration: value, supabaseKey: SYNTHETIC_TARGET_KEY, now: () => NOW,
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url); calls.push([parsed.pathname, options.method || "GET"]);
      const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
      if (parsed.pathname === "/rest/v1/ap_checkout_mode_configuration") return json({ mode: unlocked ? "PUBLIC" : "LOCKED" });
      if (parsed.pathname === "/rest/v1/ap_commerce_configuration") return json({ checkout_enabled: false });
      if (parsed.pathname === "/storage/v1/bucket") return json(RECOVERY_BUCKETS.map((name) => ({ id: name, name, public: false })));
      if (parsed.pathname.startsWith("/storage/v1/object/list/")) return json(existing ? [{ name: "private-existing" }] : []);
      if (parsed.pathname.startsWith("/storage/v1/object/authenticated/")) {
        return new Response(stored.get(parsed.pathname.replace("/authenticated", "")));
      }
      if (options.method === "POST" && parsed.pathname.startsWith("/storage/v1/object/")) {
        stored.set(parsed.pathname, Buffer.from(options.body));
        return json({ Key: parsed.pathname.replace("/storage/v1/object/", ""), Id: "11111111-1111-4111-8111-111111111111" });
      }
      throw new Error("UNEXPECTED_SYNTHETIC_REQUEST");
    } });
  return { target, calls, stored };
}
for (const options of [{ unlocked: true }, { existing: true }]) {
  test(`target preflight refuses ${Object.keys(options)[0]} project before uploads`, async () => {
    const { target, stored } = targetFixture(options);
    await assert.rejects(target.assertLocked(), /TARGET_LOCKS|TARGET_NOT_EMPTY/u); assert.equal(stored.size, 0);
  });
}
test("target persists private exclusion overlay first then verifies restored bytes without overwrite", async () => {
  const { target, stored } = targetFixture();
  assert.equal((await target.assertLocked()).customerAccessLocked, true);
  const controller = new AbortController(); const tombstones = [];
  const overlay = await target.applyTombstones({ tombstones, digest: canonicalSha256(tombstones), signal: controller.signal });
  assert.equal(overlay.customerAccessLocked, true); assert.equal(stored.size, 1);
  const bytes = Buffer.from("synthetic private document");
  const result = await target.putPrivateObject({ bucket: "customer-deliveries", key: "owner/reviewed.docx", body: Readable.from([bytes]),
    expectedSize: bytes.length, expectedSha256: sha256(bytes), overwrite: false, signal: controller.signal });
  assert.equal(result.private, true); assert.equal(result.customerAccessLocked, true); assert.equal(stored.size, 2);
  assert.equal((await target.assertLocked()).customerAccessLocked, true);
});
test("target never uploads corrupt archive content or permits overwrite", async () => {
  const { target, stored } = targetFixture(); await target.assertLocked();
  const input = { bucket: "customer-deliveries", key: "owner/file", body: Readable.from([Buffer.from("abc")]), expectedSize: 3,
    expectedSha256: "f".repeat(64), overwrite: false, signal: new AbortController().signal };
  await assert.rejects(target.putPrivateObject(input), /TARGET_SOURCE_HASH/u);
  await assert.rejects(target.putPrivateObject({ ...input, overwrite: true }), /TARGET_OBJECT/u);
  assert.equal(stored.size, 0);
});

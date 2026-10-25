import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { RECOVERY_TABLES } from "./lib/protected-recovery-protocol.mjs";
import { RECOVERY, RECOVERY_BUCKETS, canonicalSha256, copyCheckpoint, createBootstrapArchive, inventoryDigest,
  restoreCheckpoint, sha256, validateInventory, validateManifest } from "./lib/protected-recovery-core.mjs";

const NOW = Date.parse("2026-10-23T22:00:00.000Z");
const RELEASE = "a".repeat(40);
const ARCHIVE = { bucket: "applypack-production-protected-recovery-838445019912", kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111" };
const time = (offset) => new Date(NOW + offset).toISOString();
const clone = (value) => structuredClone(value);
function seal(inventory) {
  inventory.counts.objects = inventory.objects.length;
  inventory.counts.references = inventory.references.length;
  inventory.counts.tombstones = inventory.tombstones.length;
  inventory.inventoryDigest = inventoryDigest(inventory);
  return inventory;
}
function fixture() {
  const bytes = new Map();
  const objects = [...RECOVERY_BUCKETS].sort().map((bucket, index) => {
    const body = Buffer.from(`private synthetic bytes ${index}`);
    const key = `owner/document-${index}.docx`;
    bytes.set(`${bucket}/${key}`, body);
    return { bucket, key, sourceVersion: sha256(`version-${index}`), size: body.length,
      expectedSha256: sha256(body), retentionExpiresAt: null };
  });
  const references = objects.map((object, index) => ({ table: "ap_document_versions",
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`, field: "storage_path",
    bucket: object.bucket, key: object.key, expectedSha256: object.expectedSha256, retentionExpiresAt: null }));
  const first = seal({ schemaVersion: RECOVERY.inventorySchema, sourceEnvironment: "production", sourceProjectRef: RECOVERY.projectRef,
    serviceRetention: { schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
      sourceWatermark: "1970-01-01T00:00:00.000Z", orders: [], holds: [], objectTombstones: [], objectPolicies: [] },
    releaseSha: RELEASE, buckets: [...RECOVERY_BUCKETS], startedAt: time(-4000), completedAt: time(-3000),
    inventoryDigest: "0".repeat(64), objects, references, tombstones: [],
    counts: { objects: 0, references: 0, tombstones: 0, tables: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, table === "ap_document_versions" ? 4 : 0])) },
    receipt: "first-signed-receipt-".padEnd(128, "a") });
  const second = { ...clone(first), startedAt: time(-2000), completedAt: time(-1000), receipt: "second-signed-receipt-".padEnd(128, "b") };
  const events = [];
  const archives = new Map();
  let readCount = 0;
  let version = 0;
  const context = { first, second, bytes, events, archives, now: () => NOW, archive: ARCHIVE, releaseSha: RELEASE,
    source: {
      async readInventory() { events.push("inventory"); return clone(readCount++ % 2 === 0 ? context.first : context.second); },
      async openObject(object) { events.push("source-object"); return { sourceVersion: object.sourceVersion, size: object.size,
        body: Readable.from([bytes.get(`${object.bucket}/${object.key}`)]) }; },
    },
    destination: {
      async putObject(request) {
        events.push("archive-object");
        assert.equal(request.serverSideEncryption, "aws:kms");
        assert.equal(request.kmsKeyId, ARCHIVE.kmsKeyArn);
        assert.equal(request.immutable, true);
        const chunks = [];
        for await (const chunk of request.body) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const versionId = `version-${++version}`;
        archives.set(`${request.key}/${versionId}`, body);
        return { versionId, checksumSha256: sha256(body), size: body.length };
      },
      async publishManifest(request) {
        events.push("manifest");
        assert.equal(request.serverSideEncryption, "aws:kms");
        assert.equal(request.immutable, true);
        const versionId = `manifest-${++version}`;
        archives.set(`${request.key}/${versionId}`, request.body);
        return { versionId, checksumSha256: sha256(request.body), size: request.body.length };
      },
    },
    completion: { async submit(request) { events.push("completion"); return { ok: true,
      sourceStartedAt: context.first.startedAt, manifestSha256: request.manifestSha256 }; } },
  };
  return context;
}
async function failsBeforeCompletion(context, expected) {
  await assert.rejects(copyCheckpoint(context), expected);
  assert.equal(context.events.includes("completion"), false);
}

test("copies all four buckets, verifies bytes and exact versions, publishes manifest last, then acknowledges", async () => {
  const context = fixture();
  const result = await copyCheckpoint(context);
  assert.equal(result.manifest.entries.length, 4);
  assert.deepEqual(context.events.slice(-3), ["inventory", "manifest", "completion"]);
  assert.equal(result.manifest.watermark, context.first.startedAt);
  assert.equal(result.manifest.inventory.buckets.length, 4);
  validateManifest(result.manifest, result.manifestDigest);
  for (const entry of result.manifest.entries) assert.equal(sha256(context.archives.get(`${entry.archiveKey}/${entry.archiveVersionId}`)), entry.sha256);
});

for (const [label, mutate] of [
  ["unknown inventory schema", (i) => { i.schemaVersion = "unknown-v2"; }],
  ["historical inventory without current retention evidence", (i) => { i.schemaVersion = "applypack-protected-recovery-inventory-v1"; delete i.serviceRetention; }],
  ["object expiry contradicts authoritative policy", (i) => { i.serviceRetention.objectPolicies.push({ bucket: i.objects[0].bucket,
    pathSha256: sha256(i.objects[0].key), protected: false, retentionExpiresAt: time(3600000) }); }],
  ["wrong production project", (i) => { i.sourceProjectRef = "fmugizadzdnqfckujqlw"; }],
  ["wrong release", (i) => { i.releaseSha = "b".repeat(40); }],
  ["missing empty-bucket coverage", (i) => { i.buckets.pop(); }],
  ["unknown reference table", (i) => { i.references[0].table = "unknown_history"; }],
  ["omitted historical table count", (i) => { delete i.counts.tables.apply_pack_delivery_revisions; }],
  ["unresolved historical reference", (i) => { i.references[0].table = "apply_pack_delivery_revisions"; i.references[0].key = "owner/missing.docx"; }],
  ["incorrect expected reference hash", (i) => { i.references[0].expectedSha256 = "f".repeat(64); }],
  ["duplicate object", (i) => { i.objects.push(clone(i.objects[0])); }],
  ["duplicate reference field", (i) => { i.references.push(clone(i.references[0])); }],
  ["unknown private bucket", (i) => { i.objects[0].bucket = "new-private-bucket"; }],
  ["oversized object", (i) => { i.objects[0].size = RECOVERY.maximumObjectBytes + 1; }],
  ["path traversal", (i) => { i.objects[0].key = "owner/../secret"; }],
  ["non-versioned source", (i) => { i.objects[0].sourceVersion = "null"; }],
  ["future inventory", (i) => { i.completedAt = time(1); }],
  ["stale inventory", (i) => { i.startedAt = time(-600001); }],
]) {
  test(`fails closed before copying: ${label}`, async () => {
    const context = fixture(); mutate(context.first); seal(context.first);
    await failsBeforeCompletion(context, /PROTECTED_RECOVERY_/u);
    assert.equal(context.events.includes("archive-object"), false);
  });
}

test("historical pre-migration bootstrap archives remain readable without claiming application completion", async () => {
  const context = fixture();
  for (const inventory of [context.first, context.second]) {
    inventory.schemaVersion = "applypack-protected-recovery-inventory-v1"; delete inventory.serviceRetention; seal(inventory);
  }
  const result = await createBootstrapArchive({ ...context, completion: undefined, operatorBootstrap: true });
  assert.equal(result.status, "BOOTSTRAP_ARCHIVED_WITHOUT_APPLICATION_CHECKPOINT");
  assert.equal(result.applicationCheckpointCompleted, false);
  assert.equal(context.events.includes("completion"), false);
  assert.equal(validateManifest(result.manifest, result.manifestDigest), result.manifest);
});

test("counts and canonical inventory digest cannot be supplied independently", () => {
  const context = fixture();
  context.first.counts.objects++;
  context.first.inventoryDigest = inventoryDigest(context.first);
  assert.throws(() => validateInventory(context.first, { now: NOW }), /INVENTORY_COUNTS/u);
  seal(context.first); context.first.inventoryDigest = "f".repeat(64);
  assert.throws(() => validateInventory(context.first, { now: NOW }), /INVENTORY_DIGEST/u);
});

for (const [label, mutate] of [
  ["concurrent replacement", (i) => { i.objects[0].sourceVersion = "f".repeat(64); }],
  ["concurrent new file", (i) => { const object = clone(i.objects.at(-1)); object.key = "owner/z-new.docx"; i.objects.push(object); }],
  ["concurrent deletion", (i) => { i.objects.pop(); i.references.pop(); }],
  ["concurrent revocation", (i) => { const reference = { ...i.references[0] }; delete reference.expectedSha256; delete reference.retentionExpiresAt; i.tombstones.push({ ...reference, kind: "REVOKED", effectiveAt: time(-1500) }); }],
]) {
  test(`${label} prevents manifest and completion despite successful partial archive`, async () => {
    const context = fixture(); mutate(context.second); seal(context.second);
    await failsBeforeCompletion(context, /INVENTORY_CHANGED/u);
    assert.equal(context.events.includes("archive-object"), true);
    assert.equal(context.events.includes("manifest"), false);
  });
}

test("source version precondition mismatch rejects copying changed bytes", async () => {
  const context = fixture();
  context.source.openObject = async (object) => ({ sourceVersion: "f".repeat(64), size: object.size, body: Readable.from([]) });
  await failsBeforeCompletion(context, /SOURCE_VERSION_CHANGED/u);
});
for (const [label, getBody, error] of [
  ["same-size corruption", (original) => Buffer.alloc(original.length, 42), /SOURCE_HASH_MISMATCH/u],
  ["truncated object", (original) => original.subarray(1), /STREAM_SIZE/u],
  ["oversized stream", (original) => Buffer.concat([original, Buffer.from("x")]), /STREAM_SIZE/u],
]) {
  test(`${label} never publishes a completed checkpoint`, async () => {
    const context = fixture();
    const key = `${context.first.objects[0].bucket}/${context.first.objects[0].key}`;
    context.bytes.set(key, getBody(context.bytes.get(key)));
    await failsBeforeCompletion(context, error);
    assert.equal(context.events.includes("manifest"), false);
  });
}
for (const bad of [{ versionId: "null" }, { checksumSha256: "f".repeat(64) }, { size: 0 }]) {
  test(`destination acknowledgement rejects ${Object.keys(bad)[0]} mismatch`, async () => {
    const context = fixture(); const put = context.destination.putObject;
    context.destination.putObject = async (request) => ({ ...await put(request), ...bad });
    await failsBeforeCompletion(context, /DESTINATION_VERIFICATION/u);
  });
}
test("destination that does not consume source bytes cannot claim upload success", async () => {
  const context = fixture();
  context.destination.putObject = async () => ({ versionId: "v", size: 0, checksumSha256: "a".repeat(64) });
  await failsBeforeCompletion(context, /STREAM_NOT_CONSUMED/u);
});
test("lost upload response leaves no checkpoint and a subsequent versioned retry succeeds", async () => {
  const context = fixture(); const put = context.destination.putObject;
  let failed = false;
  context.destination.putObject = async (request) => {
    const response = await put(request);
    if (!failed) { failed = true; throw new Error("SYNTHETIC_LOST_RESPONSE"); }
    return response;
  };
  await failsBeforeCompletion(context, /SYNTHETIC_LOST_RESPONSE/u);
  // The next run starts new bounded inventory scans; orphaned versions are not manifests.
  const retry = fixture(); retry.destination = context.destination;
  const result = await copyCheckpoint(retry);
  assert.equal(result.manifest.entries.length, 4);
  assert.equal(context.archives.size, 6);
});
test("lost completion response and replay cannot manufacture a local successful acknowledgement", async () => {
  const context = fixture();
  context.completion.submit = async () => { throw new Error("SYNTHETIC_LOST_COMPLETION_RESPONSE"); };
  await assert.rejects(copyCheckpoint(context), /SYNTHETIC_LOST_COMPLETION_RESPONSE/u);
  assert.equal(context.events.includes("manifest"), true);
  const replay = fixture();
  replay.completion.submit = async () => ({ ok: false, conflict: "REPLAY" });
  await assert.rejects(copyCheckpoint(replay), /COMPLETION_NOT_ACKNOWLEDGED/u);
});
test("manifest checksum mismatch never calls completion", async () => {
  const context = fixture(); const publish = context.destination.publishManifest;
  context.destination.publishManifest = async (request) => ({ ...await publish(request), checksumSha256: "f".repeat(64) });
  await failsBeforeCompletion(context, /DESTINATION_VERIFICATION/u);
});
test("expired source version fails before archive and before completion", async () => {
  const context = fixture();
  context.first.objects[0].retentionExpiresAt = time(-1);
  context.first.references[0].retentionExpiresAt = time(-1); seal(context.first);
  await failsBeforeCompletion(context, /SOURCE_VERSION_EXPIRED/u);
});
test("expiration reached during copying also prevents publication", async () => {
  const context = fixture();
  for (const i of [context.first, context.second]) {
    i.objects[0].retentionExpiresAt = time(1000); i.references[0].retentionExpiresAt = time(1000); seal(i);
  }
  let current = NOW;
  context.now = () => current;
  const read = context.source.readInventory;
  context.source.readInventory = async () => { const value = await read(); if (context.events.length > 1) current += 1001; return value; };
  await failsBeforeCompletion(context, /SOURCE_VERSION_EXPIRED/u);
});
test("stuck source operation is bounded and cannot complete later", async () => {
  const context = fixture();
  context.maximumRunMilliseconds = 15;
  context.source.openObject = async () => new Promise(() => {});
  await failsBeforeCompletion(context, /TIMEOUT/u);
});
test("verified prior manifest reuses immutable matching versions and still takes two complete scans", async () => {
  const context = fixture(); const prior = await copyCheckpoint(context);
  const next = fixture(); next.previous = { manifest: prior.manifest, digest: prior.manifestDigest };
  const result = await copyCheckpoint(next);
  assert.deepEqual(next.events, ["inventory", "inventory", "manifest", "completion"]);
  assert.deepEqual(result.manifest.entries, prior.manifest.entries);
  assert.equal(result.manifest.previousManifestDigest, prior.manifestDigest);
});
test("unverified prior manifest never permits reuse", async () => {
  const context = fixture(); const prior = await copyCheckpoint(context);
  const next = fixture(); next.previous = { manifest: clone(prior.manifest), digest: prior.manifestDigest };
  next.previous.manifest.entries[0].archiveVersionId = "attacker-version";
  await failsBeforeCompletion(next, /MANIFEST_INVALID/u);
});

async function restoreFixture() {
  const context = fixture(); const checkpoint = await copyCheckpoint(context);
  const events = [];
  const projectRef = "abcdefghijklmnopqrst";
  const policy = { schemaVersion: "applypack-protected-recovery-restore-policy-v1", targetProjectRef: projectRef,
    targetOrigin: `https://${projectRef}.supabase.co`, allowedTargets: [{ projectRef, origin: `https://${projectRef}.supabase.co`, environment: "recovery" }],
    archiveCredentialIdentity: "independent-human-recovery", targetCredentialIdentity: "isolated-recovery-db", sourceCredentialIdentity: "production-workload",
    expectedManifestDigest: checkpoint.manifestDigest };
  const locks = { projectRef, origin: policy.targetOrigin, credentialIdentity: policy.targetCredentialIdentity,
    checkoutLocked: true, intakeLocked: true, customerAccessLocked: true, outboundMailDisabled: true,
    livePaymentsDisabled: true, callbacksDisabled: true, scheduledWritersDisabled: true };
  return { ...checkpoint, latestInventory: context.second, policy, now: () => NOW, events, context, locks,
    archiveReader: {
      async identity() { return { credentialIdentity: policy.archiveCredentialIdentity, independentRecovery: true }; },
      async openObject(request) { events.push("archive-read"); const body = context.archives.get(`${request.key}/${request.versionId}`);
        return { versionId: request.versionId, size: body.length, body: Readable.from([body]) }; },
    },
    target: {
      async assertLocked() { events.push("locks"); return locks; },
      async applyTombstones(request) { events.push("tombstones"); return { digest: request.digest, customerAccessLocked: true }; },
      async sanitizeDatabase(request) { events.push("sanitize-database");
        assert.match(request.sourceInventoryDigest, /^[a-f0-9]{64}$/u);
        return { policyVersion: "one_off_30d_v1", overlayDigest: request.digest, ordersExamined: 0, ordersSanitized: 0,
          objectsRevoked: 0, expiredPrivateRecordsRemaining: 0, accessLocked: true }; },
      async putPrivateObject(request) { events.push("restore-object"); assert.equal(request.overwrite, false);
        const chunks = []; for await (const chunk of request.body) chunks.push(chunk);
        const body = Buffer.concat(chunks); return { sha256: sha256(body), size: body.length, private: true, customerAccessLocked: true }; },
    },
  };
}
test("restore verifies exact archived versions with independent identity and remains locked", async () => {
  const context = await restoreFixture(); const result = await restoreCheckpoint(context);
  assert.equal(result.status, "FILES_RESTORED_ACCESS_LOCKED");
  assert.equal(result.restoredObjects, 4);
  assert.deepEqual(context.events.slice(0, 4), ["locks", "tombstones", "sanitize-database", "archive-read"]);
  assert.equal(result.databaseSanitized, true);
  assert.equal(context.events.filter((event) => event === "sanitize-database").length, 2);
  assert.equal(context.events.at(-1), "locks");
});
function expiringRestoreObject(context, index = 0) {
  context.latestInventory.objects[index].retentionExpiresAt = time(100);
  context.latestInventory.references[index].retentionExpiresAt = time(100);
  seal(context.latestInventory);
}
function expiringRestoreFamily(context, protectedOrder = false) {
  context.latestInventory.serviceRetention.orders.push({ orderId: "11111111-1111-4111-8111-111111111111",
    customerId: "22222222-2222-4222-8222-222222222222", legalReceiptId: "33333333-3333-4333-8333-333333333333",
    actionExpiresAt: time(100), accessExpiresAt: time(100), familyExpiresAt: time(100),
    protected: protectedOrder, state: "ACTIVE", purgedAt: null });
  seal(context.latestInventory);
}
for (const phase of ["initial sanitization", "archive read"]) {
  test(`restore refuses an object expiring during ${phase} before uploading it`, async () => {
    const context = await restoreFixture(); expiringRestoreObject(context);
    let currentTime = NOW; context.now = () => currentTime;
    const adapter = phase === "initial sanitization" ? context.target : context.archiveReader;
    const method = phase === "initial sanitization" ? "sanitizeDatabase" : "openObject";
    const original = adapter[method];
    adapter[method] = async (request) => { const result = await original(request); currentTime += 100; return result; };
    await assert.rejects(restoreCheckpoint(context), /RESTORE_OBJECT_EXPIRED_RECONCILIATION_REQUIRED/u);
    assert.equal(context.events.includes("restore-object"), false);
    assert.equal(context.locks.customerAccessLocked, true);
  });
}
for (const uploadNumber of [1, 2]) {
  test(`restore remains incomplete when an uploaded object expires during upload ${uploadNumber}`, async () => {
    const context = await restoreFixture(); expiringRestoreObject(context);
    let currentTime = NOW; let uploads = 0; context.now = () => currentTime;
    const put = context.target.putPrivateObject;
    context.target.putPrivateObject = async (request) => {
      const result = await put(request); if (++uploads === uploadNumber) currentTime += 100; return result;
    };
    await assert.rejects(restoreCheckpoint(context), /RESTORE_UPLOADED_OBJECT_EXPIRED_RECONCILIATION_REQUIRED/u);
    assert.equal(uploads, uploadNumber);
    assert.equal(context.events.filter((event) => event === "sanitize-database").length, 1);
    assert.equal(context.locks.customerAccessLocked, true);
  });
}
for (const phase of ["final sanitization", "final lock check"]) {
  test(`restore rechecks uploaded-object expiry after ${phase}`, async () => {
    const context = await restoreFixture(); expiringRestoreObject(context);
    let currentTime = NOW; let calls = 0; context.now = () => currentTime;
    const method = phase === "final sanitization" ? "sanitizeDatabase" : "assertLocked";
    const original = context.target[method];
    context.target[method] = async (request) => {
      const result = await original(request); if (++calls === 2) currentTime += 100; return result;
    };
    await assert.rejects(restoreCheckpoint(context), /RESTORE_UPLOADED_OBJECT_EXPIRED_RECONCILIATION_REQUIRED/u);
    assert.equal(context.locks.customerAccessLocked, true);
  });
}
for (const phase of ["initial", "final"]) {
  test(`a family expiring during ${phase} sanitization cannot reuse an earlier digest receipt`, async () => {
    const context = await restoreFixture(); expiringRestoreFamily(context);
    let currentTime = NOW; let calls = 0; context.now = () => currentTime;
    const sanitize = context.target.sanitizeDatabase;
    context.target.sanitizeDatabase = async (request) => {
      const result = await sanitize(request); if (++calls === (phase === "initial" ? 1 : 2)) currentTime += 100; return result;
    };
    await assert.rejects(restoreCheckpoint(context), /RESTORE_DATABASE_EXPIRY_RECONCILIATION_REQUIRED/u);
    if (phase === "initial") assert.equal(context.events.includes("archive-read"), false);
    assert.equal(context.locks.customerAccessLocked, true);
  });
}
test("a protected family does not lose its hold when the nominal deadline crosses during restore", async () => {
  const context = await restoreFixture(); expiringRestoreFamily(context, true);
  let currentTime = NOW; context.now = () => currentTime;
  const put = context.target.putPrivateObject;
  context.target.putPrivateObject = async (request) => { const result = await put(request); currentTime += 100; return result; };
  assert.equal((await restoreCheckpoint(context)).status, "FILES_RESTORED_ACCESS_LOCKED");
});
test("final sanitization failure cannot produce a completed restore after files were copied", async () => {
  const context = await restoreFixture(); let calls = 0;
  const sanitize = context.target.sanitizeDatabase;
  context.target.sanitizeDatabase = async (request) => {
    const result = await sanitize(request); return ++calls === 2 ? { ...result, expiredPrivateRecordsRemaining: 1 } : result;
  };
  await assert.rejects(restoreCheckpoint(context), /RESTORE_DATABASE_SANITIZATION_UNVERIFIED/u);
  assert.equal(context.events.filter((event) => event === "restore-object").length, 4);
  assert.equal(context.locks.customerAccessLocked, true);
});
for (const target of [RECOVERY.projectRef, "fmugizadzdnqfckujqlw", "unregisteredtargetxx"]) {
  test(`restore refuses production, staging or unregistered target ${target}`, async () => {
    const context = await restoreFixture(); context.policy.targetProjectRef = target;
    context.policy.targetOrigin = `https://${target}.supabase.co`;
    await assert.rejects(restoreCheckpoint(context), /RESTORE_POLICY/u);
    assert.deepEqual(context.events, []);
  });
}
for (const flag of ["checkoutLocked", "intakeLocked", "customerAccessLocked", "outboundMailDisabled", "livePaymentsDisabled", "callbacksDisabled", "scheduledWritersDisabled"]) {
  test(`restore refuses missing lock ${flag} before reading archive or writing`, async () => {
    const context = await restoreFixture(); context.locks[flag] = false;
    await assert.rejects(restoreCheckpoint(context), /RESTORE_TARGET_UNLOCKED/u);
    assert.deepEqual(context.events, ["locks"]);
  });
}
test("restore rejects reuse of original workload credentials", async () => {
  const context = await restoreFixture(); context.policy.archiveCredentialIdentity = context.policy.sourceCredentialIdentity;
  await assert.rejects(restoreCheckpoint(context), /RESTORE_POLICY/u);
});
test("latest revocation tombstone is applied before object restore and excludes revoked bytes", async () => {
  const context = await restoreFixture();
  const reference = { ...context.latestInventory.references[0] }; delete reference.expectedSha256; delete reference.retentionExpiresAt;
  context.latestInventory.tombstones.push({ ...reference, kind: "REVOKED", effectiveAt: time(-1500) }); seal(context.latestInventory);
  const result = await restoreCheckpoint(context);
  assert.equal(result.excludedObjects, 1); assert.equal(result.restoredObjects, 3);
  assert.ok(context.events.indexOf("tombstones") < context.events.indexOf("archive-read"));
});
test("current source expiry overrides older checkpoint retention", async () => {
  const context = await restoreFixture();
  context.latestInventory.objects[0].retentionExpiresAt = time(-1);
  context.latestInventory.references[0].retentionExpiresAt = time(-1); seal(context.latestInventory);
  const result = await restoreCheckpoint(context);
  assert.equal(result.excludedObjects, 1);
});
for (const [label, currentExpiry] of [["current hold", null], ["current support extension", time(86400000)]]) {
  test(`${label} protects an unchanged version from the old checkpoint expiry`, async () => {
    const context = await restoreFixture();
    context.manifest.inventory.objects[0].retentionExpiresAt = time(-1);
    context.manifest.inventory.references[0].retentionExpiresAt = time(-1);
    seal(context.manifest.inventory);
    context.manifestDigest = canonicalSha256(context.manifest);
    context.policy.expectedManifestDigest = context.manifestDigest;
    context.latestInventory.objects[0].retentionExpiresAt = currentExpiry;
    context.latestInventory.references[0].retentionExpiresAt = currentExpiry;
    seal(context.latestInventory);
    const result = await restoreCheckpoint(context);
    assert.equal(result.excludedObjects, 0);
    assert.equal(result.restoredObjects, 4);
  });
}
test("a current hold cannot undo a durable deletion recorded in the checkpoint", async () => {
  const context = await restoreFixture();
  const reference = { ...context.manifest.inventory.references[0] };
  delete reference.expectedSha256; delete reference.retentionExpiresAt;
  context.manifest.inventory.tombstones.push({ ...reference, kind: "DELETED", effectiveAt: time(-3500) });
  seal(context.manifest.inventory);
  context.manifestDigest = canonicalSha256(context.manifest);
  context.policy.expectedManifestDigest = context.manifestDigest;
  const result = await restoreCheckpoint(context);
  assert.equal(result.excludedObjects, 1);
});
test("legacy deleted object without a durable tombstone is excluded using the current complete inventory", async () => {
  const context = await restoreFixture();
  context.latestInventory.objects.shift(); context.latestInventory.references.shift(); seal(context.latestInventory);
  const result = await restoreCheckpoint(context);
  assert.equal(result.excludedObjects, 1);
});
test("cleared legacy reference cannot resurrect a still-present old private object", async () => {
  const context = await restoreFixture();
  context.latestInventory.references.shift(); seal(context.latestInventory);
  const result = await restoreCheckpoint(context);
  assert.equal(result.excludedObjects, 1);
});
test("source replacement at the same path excludes the superseded archived bytes", async () => {
  const context = await restoreFixture();
  context.latestInventory.objects[0].sourceVersion = "f".repeat(64); seal(context.latestInventory);
  const result = await restoreCheckpoint(context);
  assert.equal(result.excludedObjects, 1);
});
test("cleared draft alias does not remove bytes still held by an unchanged paid reference", async () => {
  const context = fixture();
  const alias = { ...context.first.references[0], table: "intake_drafts", field: "resume_document" };
  context.first.references.push(alias); context.second.references.push(clone(alias)); seal(context.first); seal(context.second);
  const checkpoint = await copyCheckpoint(context);
  const restore = await restoreFixture();
  restore.manifest = checkpoint.manifest; restore.manifestDigest = checkpoint.manifestDigest;
  restore.policy.expectedManifestDigest = checkpoint.manifestDigest;
  restore.latestInventory = context.second; restore.latestInventory.references.pop(); seal(restore.latestInventory);
  const result = await restoreCheckpoint(restore);
  assert.equal(result.excludedObjects, 0);
});
test("unacknowledged tombstone overlay blocks every restored object", async () => {
  const context = await restoreFixture();
  context.target.applyTombstones = async () => ({ digest: "f".repeat(64), customerAccessLocked: true });
  await assert.rejects(restoreCheckpoint(context), /RESTORE_TOMBSTONES_UNAPPLIED/u);
  assert.equal(context.events.includes("archive-read"), false);
});
for (const [label, mutation] of [
  ["missing sanitizer", (context) => { delete context.target.sanitizeDatabase; }],
  ["wrong digest", (context) => { context.target.sanitizeDatabase = async () => ({ policyVersion: "one_off_30d_v1", overlayDigest: "f".repeat(64), ordersExamined: 0, ordersSanitized: 0, objectsRevoked: 0, expiredPrivateRecordsRemaining: 0, accessLocked: true }); }],
  ["remaining private records", (context) => { const original = context.target.sanitizeDatabase; context.target.sanitizeDatabase = async (request) => ({ ...await original(request), expiredPrivateRecordsRemaining: 1 }); }],
  ["unlocked database", (context) => { const original = context.target.sanitizeDatabase; context.target.sanitizeDatabase = async (request) => ({ ...await original(request), accessLocked: false }); }],
]) test(`restore blocks archive reads when ${label}`, async () => {
  const context = await restoreFixture(); mutation(context);
  await assert.rejects(restoreCheckpoint(context), /RESTORE_DATABASE_SANITIZATION_/u);
  assert.equal(context.events.includes("archive-read"), false);
});
test("historical inventory is decodable but cannot stand in for the current retention overlay", async () => {
  const context = await restoreFixture();
  context.latestInventory.schemaVersion = "applypack-protected-recovery-inventory-v1";
  delete context.latestInventory.serviceRetention; seal(context.latestInventory);
  validateInventory(context.latestInventory, { now: NOW });
  await assert.rejects(restoreCheckpoint(context), /CURRENT_RETENTION_OVERLAY_REQUIRED/u);
  assert.deepEqual(context.events, []);
});
test("durable hashed-path tombstone excludes old bytes even if an old relational alias survives", async () => {
  const context = await restoreFixture(); const object = context.latestInventory.objects[0];
  context.latestInventory.serviceRetention.sourceWatermark = time(-1500);
  context.latestInventory.serviceRetention.objectTombstones.push({ bucket: object.bucket, pathSha256: sha256(object.key), deletedAt: time(-1500) });
  seal(context.latestInventory);
  const result = await restoreCheckpoint(context);
  assert.equal(result.excludedObjects, 1);
});
test("archive byte corruption is rejected while target remains locked", async () => {
  const context = await restoreFixture(); const entry = context.manifest.entries[0];
  context.context.archives.set(`${entry.archiveKey}/${entry.archiveVersionId}`, Buffer.alloc(entry.size, 42));
  await assert.rejects(restoreCheckpoint(context), /SOURCE_HASH_MISMATCH/u);
  assert.equal(context.locks.customerAccessLocked, true);
});
test("archive version substitution is rejected before target write", async () => {
  const context = await restoreFixture(); const open = context.archiveReader.openObject;
  context.archiveReader.openObject = async (request) => ({ ...await open(request), versionId: "substituted" });
  await assert.rejects(restoreCheckpoint(context), /RESTORE_ARCHIVE_VERSION/u);
  assert.equal(context.events.includes("restore-object"), false);
});
test("restore refuses stale overlay instead of resurrecting previously deleted data", async () => {
  const context = await restoreFixture(); context.latestInventory.startedAt = time(-600001);
  await assert.rejects(restoreCheckpoint(context), /INVENTORY_TIME/u);
});
test("manifest entries cannot hide omitted or substituted historical objects", async () => {
  const context = fixture(); const checkpoint = await copyCheckpoint(context);
  checkpoint.manifest.entries.pop();
  assert.throws(() => validateManifest(checkpoint.manifest, canonicalSha256(checkpoint.manifest)), /MANIFEST_COVERAGE/u);
});

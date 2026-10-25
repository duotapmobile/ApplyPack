import assert from "node:assert/strict";
import test from "node:test";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, recoveryInventoryDigest, recoverySha256, validateServiceRetentionOverlay } from "./lib/protected-recovery-protocol.mjs";
import { authorizeRecoveryRequest, boundedRecoveryOperation, buildRecoveryInventory, createSupabaseRecoveryReader, normalizeRecoveryObjectInfo,
  persistRecoveryCompletion, readRecoveryObject, recoverySourceConfiguration, recoverySourceColumns,
  signRecoveryReceipt, validateRecoveryCompletion, validateRecoveryRetentionCompletion, verifyRecoveryReceipt } from "./lib/protected-recovery-source.mjs";

const start = Date.parse("2026-10-23T12:00:00.000Z");
const sha = "a".repeat(40); const hash = "b".repeat(64); const secret = "r".repeat(43);
const id = "00000000-0000-4000-8000-000000000001";
const env = () => ({ APP_DEPLOYMENT_ENV: "production", NEXT_PUBLIC_APP_URL: "https://applypack.work",
  NEXT_PUBLIC_SUPABASE_URL: "https://spjaaxndiduhrcleazwb.supabase.co", APP_RELEASE_SHA: sha, APP_EXPECTED_RELEASE_SHA: sha,
  APP_RECOVERY_READER_SECRET: "a".repeat(43), APP_RECOVERY_COMPLETION_SECRET: "b".repeat(43), APP_RECOVERY_RECEIPT_SECRET: secret,
  APP_RECOVERY_RETENTION_SECRET: "t".repeat(43) });
const info = (key = "resume.docx", version = "provider-version-1") => ({ id, name: key, bucketId: RECOVERY_BUCKETS[0], version, size: 4 });
const okay = (data) => ({ data, error: null });
function fixture() {
  const tables = Object.fromEntries(RECOVERY_TABLES.map((name) => [name, []]));
  tables.ap_document_versions.push({ id, storage_bucket: RECOVERY_BUCKETS[0], storage_path: "resume.docx", sha256: hash,
    size_bytes: 4, retention_due_at: null, retention_state: "ACTIVE", updated_at: new Date(start - 1000).toISOString() });
  const reader = {
    retentionOverlay: async () => okay({ schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
      sourceWatermark: "1970-01-01T00:00:00.000Z", orders: [], holds: [], objectTombstones: [], objectPolicies: [] }),
    listBuckets: async () => okay(RECOVERY_BUCKETS.map((name) => ({ id: name, name, public: false }))),
    tablePage: async (name) => okay(tables[name]),
    listObjects: async (bucket) => okay(bucket === RECOVERY_BUCKETS[0] ? [{ name: "resume.docx", id, metadata: { size: 4 } }] : []),
    objectInfo: async (_bucket, key) => okay(info(key)),
  };
  return { tables, reader };
}
const build = (reader, now = () => start) => buildRecoveryInventory({ reader, releaseSha: sha, now, signReceipt: (value) => signRecoveryReceipt(value, secret) });

const retentionOverlay = () => ({ schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
  sourceWatermark: new Date(start - 1000).toISOString(),
  orders: [{ orderId: id, customerId: id, legalReceiptId: id, actionExpiresAt: null, accessExpiresAt: null,
    familyExpiresAt: null, protected: true, state: "ACTIVE", purgedAt: null }],
  holds: [{ id, orderId: id, reasonCode: "UNFULFILLED_WORK", createdAt: new Date(start - 2000).toISOString(), releasedAt: null }],
  objectTombstones: [], objectPolicies: [] });
test("current retention overlay permits a durable active hold with no access extension", () => {
  const overlay = retentionOverlay();
  overlay.orders[0].accessExpiresAt = new Date(start - 3000).toISOString();
  assert.equal(validateServiceRetentionOverlay(overlay, start), overlay);
});
for (const [label, mutate] of [
  ["unexpected customer content", (v) => { v.orders[0].resume = "private"; }],
  ["future watermark", (v) => { v.sourceWatermark = new Date(start + 1).toISOString(); }],
  ["duplicate order", (v) => { v.orders.push({ ...v.orders[0] }); }],
  ["unknown hold family", (v) => { v.holds[0].orderId = "11111111-1111-4111-8111-111111111111"; }],
  ["reversed hold release", (v) => { v.holds[0].releasedAt = new Date(start - 3000).toISOString(); }],
  ["missing purge timestamp", (v) => { v.orders[0].state = "PURGED"; }],
  ["future purge", (v) => { v.orders[0].state = "PURGED"; v.orders[0].purgedAt = new Date(start).toISOString(); }],
  ["untracked mutation", (v) => { v.holds[0].createdAt = new Date(start).toISOString(); }],
]) test(`current retention evidence rejects ${label}`, () => {
  const overlay = retentionOverlay(); mutate(overlay);
  assert.throws(() => validateServiceRetentionOverlay(overlay, start), /RETENTION_OVERLAY_INVALID/u);
});
test("current source refuses missing retention evidence before reading private metadata", async () => {
  const { reader } = fixture(); delete reader.retentionOverlay;
  reader.tablePage = () => { throw new Error("PRIVATE_METADATA_MUST_NOT_BE_READ"); };
  await assert.rejects(build(reader), (error) => !error.message.includes("PRIVATE_METADATA_MUST_NOT_BE_READ"));
});
test("policy change during source scan invalidates the complete inventory", async () => {
  const { reader } = fixture(); let reads = 0; let receipts = 0;
  reader.retentionOverlay = async () => { const value = retentionOverlay(); if (reads++) value.orders[0].protected = false; return okay(value); };
  await assert.rejects(buildRecoveryInventory({ reader, releaseSha: sha, now: () => start,
    signReceipt: () => { receipts++; return "x".repeat(64); } }), /RETENTION_OVERLAY_CHANGED/u);
  assert.equal(receipts, 0);
});
test("current policy evidence is authenticated by the inventory digest", async () => {
  const { reader } = fixture(); reader.retentionOverlay = async () => okay(retentionOverlay());
  const inventory = await build(reader); const changed = structuredClone(inventory);
  changed.serviceRetention.orders[0].protected = false;
  assert.notEqual(recoveryInventoryDigest(changed), verifyRecoveryReceipt(inventory.receipt, secret).inventoryDigest);
});
function withObjectPolicy(reader, policy) {
  const overlay = retentionOverlay();
  overlay.objectPolicies.push({ bucket: RECOVERY_BUCKETS[0], pathSha256: recoverySha256("resume.docx"), ...policy });
  reader.retentionOverlay = async () => okay(overlay);
  return overlay;
}
test("current authoritative hold preserves paid source beyond older document and intake expiry", async () => {
  const { reader, tables } = fixture();
  tables.ap_document_versions[0].retention_due_at = new Date(start - 100).toISOString();
  tables.intakes.push({ id, resume_path: "resume.docx", cover_letter_path: null,
    source_deleted_at: null, source_retention_due_at: new Date(start - 100).toISOString() });
  withObjectPolicy(reader, { protected: true, retentionExpiresAt: null });
  const inventory = await build(reader);
  assert.equal(inventory.objects.length, 1); assert.equal(inventory.references.length, 2);
  assert.equal(inventory.tombstones.length, 0); assert.equal(inventory.objects[0].retentionExpiresAt, null);
});

test("guided intake without uploaded documents preserves the row count without inventing file references", async () => {
  const { reader, tables } = fixture();
  tables.intakes.push({ id, resume_path: null, cover_letter_path: null,
    source_deleted_at: null, source_retention_due_at: null });
  const inventory = await build(reader);
  assert.equal(inventory.counts.tables.intakes, 1);
  assert.equal(inventory.references.some((reference) => reference.table === "intakes"), false);
  assert.equal(inventory.objects.length, 1);
  assert.equal(inventory.references[0].table, "ap_document_versions");
});
test("current approved extension replaces old expiry without persisting any source mutation", async () => {
  const { reader, tables } = fixture(); const oldExpiry = new Date(start - 100).toISOString();
  tables.ap_document_versions[0].retention_due_at = oldExpiry;
  withObjectPolicy(reader, { protected: false, retentionExpiresAt: "2026-10-24T12:00:00+00:00" });
  const inventory = await build(reader);
  assert.equal(inventory.objects[0].retentionExpiresAt, "2026-10-24T12:00:00.000Z");
  assert.equal(tables.ap_document_versions[0].retention_due_at, oldExpiry);
});
test("expired prospective policy covers every shared alias even if legacy metadata has no expiry", async () => {
  const { reader, tables } = fixture();
  tables.source_documents.push({ id, storage_path: "resume.docx", sha256: hash, size_bytes: 4, deleted_at: null });
  withObjectPolicy(reader, { protected: false, retentionExpiresAt: new Date(start - 100).toISOString() });
  reader.objectInfo = () => { throw new Error("EXPIRED_BYTES_MUST_NOT_BE_OPENED"); };
  const inventory = await build(reader);
  assert.equal(inventory.objects.length, 0); assert.equal(inventory.references.length, 0); assert.equal(inventory.tombstones.length, 2);
});
test("expired policy also excludes a retained storage object with no remaining reference", async () => {
  const { reader, tables } = fixture(); tables.ap_document_versions = [];
  withObjectPolicy(reader, { protected: false, retentionExpiresAt: new Date(start - 100).toISOString() });
  reader.objectInfo = () => { throw new Error("EXPIRED_BYTES_MUST_NOT_BE_OPENED"); };
  assert.equal((await build(reader)).objects.length, 0);
});
test("terminal tombstone remains stronger than current hold metadata", async () => {
  const { reader } = fixture();
  const overlay = withObjectPolicy(reader, { protected: true, retentionExpiresAt: null });
  overlay.objectTombstones.push({ bucket: RECOVERY_BUCKETS[0], pathSha256: recoverySha256("resume.docx"), deletedAt: new Date(start - 1000).toISOString() });
  reader.objectInfo = () => { throw new Error("DELETED_BYTES_MUST_NOT_BE_OPENED"); };
  const inventory = await build(reader); assert.equal(inventory.objects.length, 0); assert.equal(inventory.tombstones[0].kind, "DELETED");
});
test("conflicting effective policy cannot silently shorten an explicit existing legal hold", async () => {
  const { reader, tables } = fixture(); tables.ap_document_versions[0].retention_state = "LEGAL_HOLD";
  withObjectPolicy(reader, { protected: false, retentionExpiresAt: new Date(start - 100).toISOString() });
  await assert.rejects(build(reader), /RETENTION_POLICY_HOLD_CONFLICT/u);
});
test("duplicate hashed object policy is rejected", () => {
  const { reader } = fixture(); const overlay = withObjectPolicy(reader, { protected: true, retentionExpiresAt: null });
  overlay.objectPolicies.push({ ...overlay.objectPolicies[0] });
  assert.throws(() => validateServiceRetentionOverlay(overlay, start), /RETENTION_OVERLAY_INVALID/u);
});

test("complete inventory includes empty buckets, historical reference counts, exact version and no selected customer fields", async () => {
  const { reader, tables } = fixture();
  tables.source_documents.push({ id, storage_path: "resume.docx", sha256: hash, size_bytes: 4, deleted_at: null });
  const inventory = await build(reader);
  assert.deepEqual(inventory.buckets, RECOVERY_BUCKETS);
  assert.equal(inventory.objects.length, 1); assert.equal(inventory.references.length, 2);
  assert.equal(inventory.counts.tables.source_documents, 1);
  assert.equal(inventory.objects[0].sourceVersion, normalizeRecoveryObjectInfo(info(), RECOVERY_BUCKETS[0], "resume.docx").sourceVersion);
  assert.equal(inventory.inventoryDigest, recoveryInventoryDigest(inventory));
  assert.equal(verifyRecoveryReceipt(inventory.receipt, secret).inventoryDigest, inventory.inventoryDigest);
  assert.equal(inventory.schemaVersion, "applypack-protected-recovery-inventory-v2");
  assert.equal(inventory.serviceRetention.policyVersion, "one_off_30d_v1");
  assert.doesNotMatch(Object.values(recoverySourceColumns).join(","), /email|answers|customer_id|claim_provenance|review_note|private_key/);
});
for (const [name, change] of [
  ["missing bucket", (f) => { f.reader.listBuckets = async () => okay([]); }],
  ["unknown bucket", (f) => { f.reader.listBuckets = async () => okay([...RECOVERY_BUCKETS, "unknown"].map((name) => ({ id: name, name, public: false }))); }],
  ["public bucket", (f) => { f.reader.listBuckets = async () => okay(RECOVERY_BUCKETS.map((name) => ({ id: name, name, public: true }))); }],
  ["missing table", (f) => { f.reader.tablePage = async () => ({ error: { message: "private detail" }, data: null }); }],
  ["missing reference object", (f) => { f.reader.listObjects = async () => okay([]); }],
  ["unsafe reference path", (f) => { f.tables.ap_document_versions[0].storage_path = "../secret"; }],
  ["unexpected PII field", (f) => { f.tables.ap_document_versions[0].email = "private@example.test"; }],
  ["unknown retention state", (f) => { f.tables.ap_document_versions[0].retention_state = "MAYBE"; }],
  ["malformed object metadata", (f) => { f.reader.objectInfo = async () => okay({ ...info(), version: null }); }],
  ["foreign object identity", (f) => { f.reader.objectInfo = async () => okay({ ...info(), bucketId: "other" }); }],
  ["oversized object", (f) => { f.reader.objectInfo = async () => okay({ ...info(), size: 33554433 }); }],
  ["duplicate object", (f) => { f.reader.listObjects = async () => okay([{ name: "x", id, metadata: {} }, { name: "x", id, metadata: {} }]); }],
  ["malformed folder", (f) => { f.reader.listObjects = async () => okay([{ name: "x", id: null, metadata: {} }]); }],
  ["duplicate row", (f) => { f.tables.ap_document_versions.push({ ...f.tables.ap_document_versions[0] }); }],
  ["unresolved generated artifact", (f) => { f.tables.ap_generated_file_versions.push({ id, artifact_id: id, storage_bucket: RECOVERY_BUCKETS[0], storage_path: "resume.docx", checksum_sha256: hash, size_bytes: 4, downloads_revoked_at: null }); }],
]) test(`source fails closed: ${name}`, async () => { const f = fixture(); change(f); await assert.rejects(build(f.reader)); });

test("deleted and expired source identities are tombstones and their bytes are not copied", async () => {
  for (const state of ["DELETED", "CRYPTO_SHREDDED", "expired"]) {
    const { tables, reader } = fixture();
    if (state === "expired") tables.ap_document_versions[0].retention_due_at = new Date(start - 100).toISOString();
    else tables.ap_document_versions[0].retention_state = state;
    reader.objectInfo = async () => { throw new Error("must not open deleted content"); };
    const result = await build(reader);
    assert.equal(result.objects.length, 0); assert.equal(result.references.length, 0); assert.equal(result.tombstones[0].kind, "DELETED");
  }
});
test("legal hold keeps its object beyond the normal expiration", async () => {
  const { tables, reader } = fixture(); tables.ap_document_versions[0].retention_state = "LEGAL_HOLD";
  tables.ap_document_versions[0].retention_due_at = new Date(start - 1000).toISOString();
  const result = await build(reader); assert.equal(result.objects[0].retentionExpiresAt, null); assert.equal(result.tombstones.length, 0);
});
test("a deleted or expired alias cannot remove an active shared paid reference", async () => {
  const { tables, reader } = fixture();
  tables.intake_drafts.push({ id, resume_document: { path: "resume.docx" }, cover_letter_document: null, expires_at: new Date(start - 1000).toISOString() });
  await assert.rejects(build(reader), /DELETION_REFERENCE_CONFLICT/);
});
test("render previews follow the exact historical file version and artifact expiry", async () => {
  const { tables, reader } = fixture();
  tables.ap_generated_artifacts.push({ id, retention_due_at: new Date(start - 1000).toISOString(), retention_state: "ACTIVE" });
  tables.ap_generated_file_versions.push({ id, artifact_id: id, storage_bucket: "customer-deliveries", storage_path: "delivered.docx",
    checksum_sha256: hash, size_bytes: 4, downloads_revoked_at: null });
  tables.ap_artifact_quality_reviews.push({ id, file_version_id: id, render_preview_bucket: "operator-render-previews",
    render_preview_path: "preview.pdf", render_preview_sha256: hash, invalidated_at: null });
  const result = await build(reader);
  assert(result.tombstones.some((value) => value.table === "ap_artifact_quality_reviews" && value.key === "preview.pdf" && value.kind === "DELETED"));
  assert.equal(result.counts.tables.ap_artifact_quality_reviews, 1);
  tables.ap_artifact_quality_reviews[0].file_version_id = "00000000-0000-4000-8000-000000000002";
  await assert.rejects(build(reader), /PREVIEW_VERSION_UNRESOLVED/);
});
test("provider pagination follows every recursive prefix and exact table cursor", async () => {
  const { tables, reader } = fixture(); tables.ap_document_versions = [];
  const calls = [];
  reader.listObjects = async (bucket, prefix, offset) => {
    calls.push({ bucket, prefix, offset });
    if (bucket !== RECOVERY_BUCKETS[0]) return okay([]);
    if (prefix === "") return okay([{ name: "nested", id: null, metadata: null }]);
    return okay([{ name: "resume.docx", id, metadata: {} }]);
  };
  const result = await build(reader); assert.equal(result.objects[0].key, "nested/resume.docx");
  assert(calls.some((value) => value.prefix === "nested"));
  let selected;
  const query = { select(value) { selected = value; return this; }, order() { return this; }, limit() { return this; }, gt(column, cursor) { assert.equal(column, "id"); assert.equal(cursor, id); return this; } };
  createSupabaseRecoveryReader({ from(name) { assert.equal(name, "ap_document_versions"); return query; } }).tablePage("ap_document_versions", id);
  assert.equal(selected, recoverySourceColumns.ap_document_versions);
  assert.throws(() => createSupabaseRecoveryReader({}).tablePage("auth.users", null), /TABLE_FORBIDDEN/);
});
test("full table and storage pages require subsequent pages before claiming completeness", async () => {
  const { tables, reader } = fixture();
  const base = tables.ap_document_versions[0];
  tables.ap_document_versions = Array.from({ length: 251 }, (_, index) => ({ ...base,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
  const tableCursors = [];
  reader.tablePage = async (table, cursor) => {
    if (table === "ap_document_versions") tableCursors.push(cursor);
    return okay(tables[table].filter((value) => !cursor || (value.id ?? value.document_id) > cursor).slice(0, 250));
  };
  const files = [...Array.from({ length: 101 }, (_, index) => `file-${String(index).padStart(3, "0")}.docx`), "resume.docx"];
  const offsets = [];
  reader.listObjects = async (bucket, _prefix, offset) => {
    if (bucket !== RECOVERY_BUCKETS[0]) return okay([]);
    offsets.push(offset);
    return okay(files.slice(offset, offset + 100).map((name) => ({ name, id, metadata: {} })));
  };
  const inventory = await build(reader);
  assert.equal(inventory.counts.tables.ap_document_versions, 251);
  assert.equal(inventory.objects.length, 102);
  assert.deepEqual(tableCursors, [null, "00000000-0000-4000-8000-000000000250"]);
  assert.deepEqual(offsets, [0, 100]);
});
for (const [name, value] of [["APP_DEPLOYMENT_ENV", "staging"], ["NEXT_PUBLIC_SUPABASE_URL", "https://other.supabase.co"],
  ["NEXT_PUBLIC_APP_URL", "https://other.test"], ["APP_EXPECTED_RELEASE_SHA", "f".repeat(40)], ["APP_RECOVERY_RECEIPT_SECRET", "short"],
  ["APP_RECOVERY_COMPLETION_SECRET", "a".repeat(43)]]) test(`configuration rejects ${name} mismatch`, () => assert.throws(() => recoverySourceConfiguration({ ...env(), [name]: value })));
test("reader and completion capabilities are distinct, cookies and duplicated bearer are rejected", () => {
  const configuration = recoverySourceConfiguration(env());
  authorizeRecoveryRequest(new Request("https://applypack.work", { headers: { authorization: `Bearer ${configuration.readerSecret}` } }), configuration.readerSecret);
  for (const headers of [{}, { authorization: `Bearer ${configuration.completionSecret}` },
    { authorization: `Bearer ${configuration.readerSecret}, Bearer ${configuration.readerSecret}` },
    { authorization: `Bearer ${configuration.readerSecret}`, cookie: "session=customer" }])
    assert.throws(() => authorizeRecoveryRequest(new Request("https://applypack.work", { headers }), configuration.readerSecret));
});
test("retention capability reads inventory only, never object bytes or completion", () => {
  const config = recoverySourceConfiguration(env());
  const request = new Request("https://applypack.work", { headers: { authorization: `Bearer ${config.retentionSecret}` } });
  authorizeRecoveryRequest(request, [config.readerSecret, config.retentionSecret]);
  assert.throws(() => authorizeRecoveryRequest(request, config.readerSecret));
  assert.throws(() => authorizeRecoveryRequest(request, config.completionSecret));
});
test("a stalled source operation terminates within its bound", async () => {
  await assert.rejects(boundedRecoveryOperation(() => new Promise(() => {}), 5), /SOURCE_TIMEOUT/);
});
async function completionFixture() {
  const { reader } = fixture();
  const first = await build(reader); const second = await build(reader, () => start + 1000);
  return { configuration: recoverySourceConfiguration(env()), input: { schemaVersion: "applypack-protected-recovery-completion-v1",
    firstReceipt: first.receipt, secondReceipt: second.receipt, manifestSha256: hash, manifestVersionId: "provider-version",
    objectCount: 1, referenceCount: 1, tombstoneCount: 0 }, first, second };
}
test("completion persists source-start watermark and exact release, never copy-finish freshness", async () => {
  const { input, configuration } = await completionFixture();
  const summary = validateRecoveryCompletion(input, configuration, start + 2000);
  assert.equal(summary.sourceStartedAt, new Date(start).toISOString()); assert.equal(summary.completedAt, new Date(start + 2000).toISOString());
  assert.equal(summary.releaseSha, sha); assert.equal(summary.manifestSha256, hash);
});
test("retention completion is separately typed, receipt-bound and cannot claim a future or stale cycle", async () => {
  const { input, configuration } = await completionFixture();
  const retention = { schemaVersion: "applypack-protected-recovery-retention-completion-v1", firstReceipt: input.firstReceipt,
    secondReceipt: input.secondReceipt, planSha256: hash, providerVerificationSha256: "c".repeat(64), deletedVersionCount: 2, retainedVersionCount: 7 };
  const summary = validateRecoveryRetentionCompletion(retention, configuration, start + 2000);
  assert.equal(summary.schemaVersion, "applypack-protected-recovery-retention-v1");
  assert.equal(summary.sourceStartedAt, new Date(start).toISOString()); assert.equal(summary.deletedVersionCount, 2);
  assert.throws(() => validateRecoveryCompletion(retention, configuration, start + 2000));
  assert.throws(() => validateRecoveryRetentionCompletion(input, configuration, start + 2000));
  assert.throws(() => validateRecoveryRetentionCompletion(retention, configuration, start + 300001));
  assert.throws(() => validateRecoveryRetentionCompletion({ ...retention, deletedVersionCount: -1 }, configuration, start + 2000));
  assert.throws(() => validateRecoveryRetentionCompletion({ ...retention, secondReceipt: input.firstReceipt }, configuration, start + 2000));
});
for (const name of ["forged", "same receipt", "wrong release", "stale", "future", "counts", "null version", "changed inventory"]) test(`completion rejects ${name}`, async () => {
  const { input, configuration, second } = await completionFixture(); let now = start + 2000;
  if (name === "forged") input.firstReceipt = input.firstReceipt.replace(/^./u, "z");
  if (name === "same receipt") input.secondReceipt = input.firstReceipt;
  if (name === "wrong release") configuration.releaseSha = "f".repeat(40);
  if (name === "stale") now = start + 300001;
  if (name === "future") now = start - 1;
  if (name === "counts") input.objectCount = 0;
  if (name === "null version") input.manifestVersionId = "null";
  if (name === "changed inventory") input.secondReceipt = signRecoveryReceipt({ ...second, inventoryDigest: "c".repeat(64) }, secret);
  assert.throws(() => validateRecoveryCompletion(input, configuration, now));
});
test("object transport uses only pinned authenticated GET and validates versions before and after bytes", async () => {
  const { reader } = fixture(); const version = normalizeRecoveryObjectInfo(info(), RECOVERY_BUCKETS[0], "resume.docx").sourceVersion;
  const result = await readRecoveryObject({ reader, bucket: RECOVERY_BUCKETS[0], key: "resume.docx", sourceVersion: version,
    environment: { ...env(), SUPABASE_SECRET_KEY: "sealed-value-not-logged" }, fetchImpl: async (url, options) => {
      assert.equal(url, "https://spjaaxndiduhrcleazwb.supabase.co/storage/v1/object/authenticated/customer-source-documents/resume.docx");
      assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store"); return new Response("test");
    } });
  assert.equal(result.bytes.toString(), "test"); assert.equal(result.size, 4);
});
for (const kind of ["wrong bucket", "traversal", "changed before", "changed after", "oversize", "short", "failed response"]) test(`object transport rejects ${kind}`, async () => {
  const { reader } = fixture(); let calls = 0; const version = normalizeRecoveryObjectInfo(info(), RECOVERY_BUCKETS[0], "resume.docx").sourceVersion;
  if (kind.startsWith("changed")) reader.objectInfo = async () => okay(info("resume.docx", ++calls > (kind === "changed before" ? 0 : 1) ? "changed" : "provider-version-1"));
  await assert.rejects(readRecoveryObject({ reader, bucket: kind === "wrong bucket" ? "unknown" : RECOVERY_BUCKETS[0],
    key: kind === "traversal" ? "../x" : "resume.docx", sourceVersion: version, environment: { ...env(), SUPABASE_SECRET_KEY: "sealed-value-not-logged" },
    fetchImpl: async () => new Response(kind === "oversize" ? "12345" : kind === "short" ? "1" : "test", { status: kind === "failed response" ? 500 : 200 }) }));
});
function heartbeatStore() {
  let saved = null;
  return { saved: () => saved, from(table) {
    assert.equal(table, "operational_heartbeats"); let operation; let record; let before;
    return { update(value) { operation = "update"; record = value; return this; }, eq() { return this; }, lt(_column, value) { before = value; return this; },
      select() { return this; }, async maybeSingle() {
        if (operation === "update") { if (saved && saved.last_succeeded_at < before) { saved = record; return okay({ task_name: saved.task_name }); } return okay(null); }
        return okay(saved ? { last_succeeded_at: saved.last_succeeded_at } : null);
      }, async insert(value) { if (saved) return { error: { code: "23505" } }; saved = value; return okay(null); } };
  } };
}
test("concurrent completion accepts once, replay and old completion never freshen heartbeat", async () => {
  const { input, configuration } = await completionFixture(); const store = heartbeatStore();
  const summary = validateRecoveryCompletion(input, configuration, start + 2000);
  const results = await Promise.allSettled([persistRecoveryCompletion(store, summary), persistRecoveryCompletion(store, summary)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(store.saved().last_succeeded_at, summary.sourceStartedAt);
  await assert.rejects(persistRecoveryCompletion(store, summary), /COMPLETION_REPLAY/);
  await assert.rejects(persistRecoveryCompletion(store, { ...summary, sourceStartedAt: new Date(start - 1000).toISOString() }), /COMPLETION_REPLAY/);
  await persistRecoveryCompletion(store, { ...summary, sourceStartedAt: new Date(start + 1000).toISOString() });
  assert.equal(store.saved().last_succeeded_at, new Date(start + 1000).toISOString());
});

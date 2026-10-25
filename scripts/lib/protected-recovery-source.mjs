import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { RECOVERY_PROJECT, RECOVERY_BUCKETS, RECOVERY_TABLES, RECOVERY_LIMITS, recoveryKeySchema, recoveryObjectSchema,
  recoveryReferenceSchema, recoveryTombstoneSchema, recoveryInventorySchema, recoveryInventoryDigest, recoveryCanonicalSha256,
  recoveryCompletionSchema, recoveryRetentionCompletionSchema, recoverySha256, validateServiceRetentionOverlay } from "./protected-recovery-protocol.mjs";

const denied = (code) => { throw new Error(`PROTECTED_RECOVERY_${code}`); };
const requireValue = (value, code) => { if (!value) denied(code); };
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString());
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const nullablePath = recoveryKeySchema.nullable();
const retentionState = z.enum(["ACTIVE", "EXPIRY_PENDING", "DELETE_PENDING", "DELETED", "CRYPTO_SHREDDED", "LEGAL_HOLD"]);
const row = (fields) => z.object({ id: z.uuid(), ...fields }).strict();
const TABLES = {
  ap_document_versions: row({ storage_bucket: z.enum(RECOVERY_BUCKETS), storage_path: recoveryKeySchema, sha256: hash,
    size_bytes: z.number().int().positive(), retention_due_at: timestamp.nullable(), retention_state: retentionState, updated_at: timestamp }),
  ap_generated_file_versions: row({ artifact_id: z.uuid(), storage_bucket: z.enum(RECOVERY_BUCKETS), storage_path: recoveryKeySchema,
    checksum_sha256: hash, size_bytes: z.number().int().positive(), downloads_revoked_at: timestamp.nullable() }),
  ap_generated_artifacts: row({ retention_due_at: timestamp.nullable(), retention_state: retentionState }),
  ap_artifact_quality_reviews: row({ file_version_id: z.uuid(), render_preview_bucket: z.literal("operator-render-previews"),
    render_preview_path: recoveryKeySchema, render_preview_sha256: hash, invalidated_at: timestamp.nullable() }),
  source_documents: row({ storage_path: recoveryKeySchema, sha256: hash, size_bytes: z.number().int().positive(), deleted_at: timestamp.nullable() }),
  intakes: row({ resume_path: nullablePath, cover_letter_path: nullablePath,
    source_deleted_at: timestamp.nullable(), source_retention_due_at: timestamp.nullable() }),
  // JSON is inspected locally and never included in the backup graph or logs.
  intake_drafts: row({ resume_document: z.unknown(), cover_letter_document: z.unknown(), expires_at: timestamp }),
  apply_pack_items: row({ resume_path: nullablePath, cover_letter_path: nullablePath, draft_resume_path: nullablePath, draft_cover_letter_path: nullablePath }),
  apply_pack_delivery_revisions: row({ resume_path: recoveryKeySchema, cover_letter_path: recoveryKeySchema }),
  ap_unpaid_source_cleanup: z.object({ document_id: z.uuid(), deleted_at: timestamp.nullable(), state: z.string() }).strict(),
};
export const recoverySourceColumns = Object.freeze(Object.fromEntries(Object.entries(TABLES)
  .map(([table, schema]) => [table, Object.keys(schema.shape).join(",")])));
const objectId = (value) => `${value.bucket}\u0000${value.key}`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** No caller-controlled tables, selected columns, SQL, URLs, or mutation operations. */
export function createSupabaseRecoveryReader(admin) {
  return {
    retentionOverlay: () => admin.rpc("ap_export_service_retention_overlay", {}, { get: true }),
    listBuckets: () => admin.storage.listBuckets(),
    listObjects: (bucket, prefix, offset) => admin.storage.from(bucket).list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
    objectInfo: (bucket, key) => admin.storage.from(bucket).info(key),
    tablePage: (table, cursor) => {
      requireValue(RECOVERY_TABLES.includes(table), "TABLE_FORBIDDEN");
      const key = table === "ap_unpaid_source_cleanup" ? "document_id" : "id";
      let query = admin.from(table).select(recoverySourceColumns[table]).order(key, { ascending: true }).limit(250);
      if (cursor) query = query.gt(key, cursor);
      return query;
    },
  };
}

function dataOf(result) {
  requireValue(result && !result.error && result.data !== null && result.data !== undefined, "SOURCE_READ_FAILED");
  return result.data;
}

export async function boundedRecoveryOperation(operation, timeout = 30000) {
  requireValue(Number.isFinite(timeout) && timeout > 0 && timeout <= 30000, "TIMEOUT_CONFIGURATION");
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("PROTECTED_RECOVERY_SOURCE_TIMEOUT")), timeout);
    })]);
  } finally { clearTimeout(timer); }
}

/** Bind a real provider version, never assume an ETag is a content SHA256. */
export function normalizeRecoveryObjectInfo(info, bucket, key) {
  requireValue(info && typeof info === "object" && typeof info.id === "string" && info.id.length > 0
    && typeof info.version === "string" && info.version.length > 0 && info.version.length <= 256
    && info.name === key && (info.bucketId ?? info.bucket_id) === bucket
    && Number.isSafeInteger(info.size) && info.size > 0 && info.size <= RECOVERY_LIMITS.objectBytes, "OBJECT_METADATA_INVALID");
  return { bucket, key, sourceVersion: recoveryCanonicalSha256({ id: info.id, version: info.version, bucket, key, size: info.size }),
    size: info.size, expectedSha256: null, retentionExpiresAt: null };
}

/** Complete bounded metadata enumeration. A second identical scan is required before publication. */
export async function buildRecoveryInventory({ reader, releaseSha, signReceipt, now = Date.now, historicalBootstrap = false }) {
  const startedAt = new Date(now()).toISOString();
  requireValue(/^[a-f0-9]{40}$/u.test(releaseSha), "RELEASE_INVALID");
  const deadline = Date.parse(startedAt) + RECOVERY_LIMITS.runMilliseconds;
  let requests = 0;
  const call = async (operation) => {
    requireValue(now() < deadline && ++requests <= 50000, "ENUMERATION_LIMIT");
    const result = await boundedRecoveryOperation(operation, Math.min(30000, deadline - now()));
    requireValue(now() < deadline, "ENUMERATION_TIMEOUT");
    return dataOf(result);
  };
  // The explicit pre-migration operator bootstrap preserves old archives only;
  // it cannot acknowledge an application checkpoint or authorize restoration.
  const serviceRetention = historicalBootstrap ? null
    : validateServiceRetentionOverlay(await call(() => reader.retentionOverlay()), now());
  const policyIdentity = (bucket, key) => `${bucket}\u0000${recoverySha256(key)}`;
  const policies = new Map(serviceRetention?.objectPolicies.map((value) => [`${value.bucket}\u0000${value.pathSha256}`, value]) || []);
  const terminal = new Map(serviceRetention?.objectTombstones.map((value) => [`${value.bucket}\u0000${value.pathSha256}`, new Date(value.deletedAt).toISOString()]) || []);
  const effectiveExpiry = (bucket, key, previous) => {
    const policy = policies.get(policyIdentity(bucket, key));
    return policy ? policy.protected || policy.retentionExpiresAt === null ? null : new Date(policy.retentionExpiresAt).toISOString() : previous;
  };
  const buckets = await call(() => reader.listBuckets());
  requireValue(Array.isArray(buckets) && buckets.length === RECOVERY_BUCKETS.length, "BUCKETS_INVALID");
  for (const bucket of RECOVERY_BUCKETS) {
    const found = buckets.filter((entry) => entry?.id === bucket && entry.name === bucket);
    requireValue(found.length === 1 && found[0].public === false, "BUCKET_UNVERIFIED");
  }
  const tables = {};
  for (const table of RECOVERY_TABLES) {
    const records = []; let cursor = null;
    for (;;) {
      const page = await call(() => reader.tablePage(table, cursor));
      requireValue(Array.isArray(page) && page.length <= 250, "TABLE_PAGE_INVALID");
      for (const raw of page) {
        const parsed = TABLES[table].safeParse(raw);
        requireValue(parsed.success, "TABLE_ROW_INVALID");
        const value = parsed.data; const id = value.id ?? value.document_id;
        requireValue(cursor === null || id > cursor, "TABLE_ORDER_INVALID");
        cursor = id; records.push(value);
        requireValue(records.length <= RECOVERY_LIMITS.references, "TABLE_LIMIT");
      }
      if (page.length < 250) break;
    }
    tables[table] = records;
  }
  const references = []; const tombstones = [];
  function add(table, record, field, bucket, key, checksum = null, expires = null, deletion = null, revoked = null, held = false) {
    if (key === null || key === undefined) return;
    const identity = { table, id: record.id, field, bucket, key };
    const policy = policies.get(policyIdentity(bucket, key));
    requireValue(!held || !policy || policy.protected || policy.retentionExpiresAt === null, "RETENTION_POLICY_HOLD_CONFLICT");
    expires = effectiveExpiry(bucket, key, expires);
    deletion ||= terminal.get(policyIdentity(bucket, key)) ?? null;
    if (deletion || (expires && Date.parse(expires) <= Date.parse(startedAt))) {
      tombstones.push(recoveryTombstoneSchema.parse({ ...identity, kind: "DELETED", effectiveAt: deletion || expires }));
      return;
    }
    references.push(recoveryReferenceSchema.parse({ ...identity, expectedSha256: checksum, retentionExpiresAt: expires }));
    if (revoked) tombstones.push(recoveryTombstoneSchema.parse({ ...identity, kind: "REVOKED", effectiveAt: revoked }));
  }
  const cleanup = new Map(tables.ap_unpaid_source_cleanup.map((entry) => [entry.document_id, entry]));
  for (const value of tables.ap_document_versions) {
    const deleted = ["DELETED", "CRYPTO_SHREDDED"].includes(value.retention_state) ? value.updated_at : cleanup.get(value.id)?.deleted_at;
    add("ap_document_versions", value, "storage_path", value.storage_bucket, value.storage_path, value.sha256,
      value.retention_state === "LEGAL_HOLD" ? null : value.retention_due_at, deleted, null, value.retention_state === "LEGAL_HOLD");
  }
  const artifacts = new Map(tables.ap_generated_artifacts.map((value) => [value.id, value]));
  for (const value of tables.ap_generated_file_versions) {
    const artifact = artifacts.get(value.artifact_id); requireValue(artifact, "ARTIFACT_UNRESOLVED");
    const deleted = ["DELETED", "CRYPTO_SHREDDED"].includes(artifact.retention_state);
    requireValue(!deleted || artifact.retention_due_at && Date.parse(artifact.retention_due_at) <= Date.parse(startedAt), "ARTIFACT_DELETION_TIME_UNVERIFIED");
    add("ap_generated_file_versions", value, "storage_path", value.storage_bucket, value.storage_path, value.checksum_sha256,
      artifact.retention_state === "LEGAL_HOLD" ? null : artifact.retention_due_at,
      deleted ? artifact.retention_due_at : null, value.downloads_revoked_at, artifact.retention_state === "LEGAL_HOLD");
  }
  const fileVersions = new Map(tables.ap_generated_file_versions.map((value) => [value.id, value]));
  for (const value of tables.ap_artifact_quality_reviews) {
    const version = fileVersions.get(value.file_version_id); requireValue(version, "PREVIEW_VERSION_UNRESOLVED");
    const artifact = artifacts.get(version.artifact_id); requireValue(artifact, "ARTIFACT_UNRESOLVED");
    const deleted = ["DELETED", "CRYPTO_SHREDDED"].includes(artifact.retention_state);
    requireValue(!deleted || artifact.retention_due_at && Date.parse(artifact.retention_due_at) <= Date.parse(startedAt), "ARTIFACT_DELETION_TIME_UNVERIFIED");
    add("ap_artifact_quality_reviews", value, "render_preview_path", value.render_preview_bucket, value.render_preview_path, value.render_preview_sha256,
      artifact.retention_state === "LEGAL_HOLD" ? null : artifact.retention_due_at,
      deleted ? artifact.retention_due_at : null, value.invalidated_at || version.downloads_revoked_at, artifact.retention_state === "LEGAL_HOLD");
  }
  for (const value of tables.source_documents) add("source_documents", value, "storage_path", RECOVERY_BUCKETS[0], value.storage_path, value.sha256, null, value.deleted_at);
  for (const value of tables.intakes) for (const field of ["resume_path", "cover_letter_path"])
    add("intakes", value, field, RECOVERY_BUCKETS[0], value[field], null, value.source_retention_due_at, value.source_deleted_at);
  for (const value of tables.intake_drafts) for (const field of ["resume_document", "cover_letter_document"]) {
    const document = value[field];
    if (document === null) continue;
    requireValue(document && typeof document === "object" && !Array.isArray(document) && typeof document.path === "string", "DRAFT_METADATA_INVALID");
    add("intake_drafts", value, field, RECOVERY_BUCKETS[0], document.path, document.sha256 ?? null, value.expires_at);
  }
  for (const value of tables.apply_pack_items) for (const field of ["resume_path", "cover_letter_path", "draft_resume_path", "draft_cover_letter_path"])
    add("apply_pack_items", value, field, field.startsWith("draft_") ? RECOVERY_BUCKETS[2] : RECOVERY_BUCKETS[1], value[field]);
  for (const value of tables.apply_pack_delivery_revisions) for (const field of ["resume_path", "cover_letter_path"])
    add("apply_pack_delivery_revisions", value, field, RECOVERY_BUCKETS[1], value[field]);

  const deletedPaths = new Set(tombstones.filter((value) => value.kind === "DELETED").map(objectId));
  // Ambiguous shared paths must never authorize deleting a paid or legally held file.
  requireValue(!references.some((value) => deletedPaths.has(objectId(value))), "DELETION_REFERENCE_CONFLICT");
  const retainedReferences = references;
  const referencesByPath = new Map();
  for (const reference of retainedReferences) {
    const id = objectId(reference); const previous = referencesByPath.get(id);
    requireValue(!previous || !previous.expectedSha256 || !reference.expectedSha256 || previous.expectedSha256 === reference.expectedSha256, "REFERENCE_HASH_CONFLICT");
    // One retained legal hold/null policy keeps the shared bytes; restore still applies each explicit tombstone.
    referencesByPath.set(id, { expectedSha256: previous?.expectedSha256 || reference.expectedSha256,
      retentionExpiresAt: previous ? previous.retentionExpiresAt === null || reference.retentionExpiresAt === null ? null
        : new Date(Math.max(Date.parse(previous.retentionExpiresAt), Date.parse(reference.retentionExpiresAt))).toISOString() : reference.retentionExpiresAt });
  }
  const objects = []; const seenPaths = new Set();
  for (const bucket of RECOVERY_BUCKETS) {
    const prefixes = [""]; const seenPrefixes = new Set(prefixes);
    for (let index = 0; index < prefixes.length; index++) {
      const prefix = prefixes[index]; let offset = 0; let previousName = "";
      for (;;) {
        const page = await call(() => reader.listObjects(bucket, prefix, offset));
        requireValue(Array.isArray(page) && page.length <= 100, "OBJECT_PAGE_INVALID");
        for (const item of page) {
          requireValue(item && typeof item.name === "string" && !item.name.includes("/") && item.name > previousName, "OBJECT_ORDER_INVALID");
          previousName = item.name;
          const key = recoveryKeySchema.parse(prefix ? `${prefix}/${item.name}` : item.name);
          if (item.id === null && item.metadata === null) {
            requireValue(key.split("/").length <= 20 && !seenPrefixes.has(key) && prefixes.length < RECOVERY_LIMITS.objects, "PREFIX_INVALID");
            seenPrefixes.add(key); prefixes.push(key); continue;
          }
          requireValue(typeof item.id === "string" && item.id.length > 0 && item.metadata && typeof item.metadata === "object", "OBJECT_LIST_INVALID");
          const id = objectId({ bucket, key }); requireValue(!seenPaths.has(id), "OBJECT_DUPLICATE"); seenPaths.add(id);
          const policyExpiry = effectiveExpiry(bucket, key, null);
          if (deletedPaths.has(id) || terminal.has(policyIdentity(bucket, key))
            || (policyExpiry !== null && Date.parse(policyExpiry) <= Date.parse(startedAt))) continue;
          const object = normalizeRecoveryObjectInfo(await call(() => reader.objectInfo(bucket, key)), bucket, key);
          Object.assign(object, referencesByPath.get(id) || {});
          object.retentionExpiresAt = effectiveExpiry(bucket, key, object.retentionExpiresAt);
          objects.push(recoveryObjectSchema.parse(object));
          requireValue(objects.length <= RECOVERY_LIMITS.objects, "OBJECT_LIMIT");
        }
        offset += page.length;
        if (page.length < 100) break;
      }
    }
  }
  const objectMap = new Map(objects.map((value) => [objectId(value), value]));
  for (const reference of retainedReferences) {
    const object = objectMap.get(objectId(reference)); requireValue(object, "REFERENCE_UNRESOLVED");
    reference.expectedSha256 = object.expectedSha256;
    reference.retentionExpiresAt = object.retentionExpiresAt;
  }
  objects.sort((a, b) => compare(objectId(a), objectId(b)));
  const referenceSort = (value) => `${value.table}\u0000${value.id}\u0000${value.field}`;
  retainedReferences.sort((a, b) => compare(referenceSort(a), referenceSort(b)));
  tombstones.sort((a, b) => compare(`${referenceSort(a)}\u0000${a.kind}`, `${referenceSort(b)}\u0000${b.kind}`));
  if (!historicalBootstrap) {
    const after = validateServiceRetentionOverlay(await call(() => reader.retentionOverlay()), now());
    requireValue(recoveryCanonicalSha256(after) === recoveryCanonicalSha256(serviceRetention), "RETENTION_OVERLAY_CHANGED");
  }
  const inventory = { schemaVersion: historicalBootstrap ? "applypack-protected-recovery-inventory-v1" : "applypack-protected-recovery-inventory-v2",
    ...(serviceRetention ? { serviceRetention } : {}), sourceEnvironment: "production", sourceProjectRef: RECOVERY_PROJECT,
    releaseSha, startedAt, completedAt: new Date(now()).toISOString(), buckets: [...RECOVERY_BUCKETS], objects, references: retainedReferences, tombstones,
    counts: { objects: objects.length, references: retainedReferences.length, tombstones: tombstones.length,
      tables: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, tables[table].length])) } };
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  inventory.receipt = await signReceipt(inventory);
  requireValue(Buffer.byteLength(JSON.stringify(inventory)) <= RECOVERY_LIMITS.inventoryBytes, "INVENTORY_LIMIT");
  return recoveryInventorySchema.parse(inventory);
}

const secretValid = (value) => typeof value === "string" && /^[A-Za-z0-9_+/=-]{43,256}$/u.test(value);
export function recoverySourceConfiguration(environment = process.env) {
  const releaseSha = environment.RAILWAY_GIT_COMMIT_SHA || environment.APP_RELEASE_SHA;
  requireValue(environment.APP_DEPLOYMENT_ENV === "production" && environment.NEXT_PUBLIC_APP_URL === "https://applypack.work"
    && environment.NEXT_PUBLIC_SUPABASE_URL === `https://${RECOVERY_PROJECT}.supabase.co`
    && /^[a-f0-9]{40}$/u.test(releaseSha || "") && environment.APP_EXPECTED_RELEASE_SHA === releaseSha, "SOURCE_IDENTITY");
  const secrets = [environment.APP_RECOVERY_READER_SECRET, environment.APP_RECOVERY_COMPLETION_SECRET, environment.APP_RECOVERY_RECEIPT_SECRET,
    environment.APP_RECOVERY_RETENTION_SECRET];
  requireValue(secrets.every(secretValid) && new Set(secrets).size === 4 && !secrets.includes(environment.CRON_SECRET), "CAPABILITY_CONFIGURATION");
  return { releaseSha, readerSecret: secrets[0], completionSecret: secrets[1], receiptSecret: secrets[2], retentionSecret: secrets[3] };
}
export function authorizeRecoveryRequest(request, expected) {
  const supplied = request.headers.get("authorization");
  const allowed = Array.isArray(expected) ? expected : [expected];
  const received = Buffer.from(supplied || "");
  const matches = allowed.map((secret) => {
    const wanted = Buffer.from(`Bearer ${secret}`);
    return secretValid(secret) && wanted.length === received.length && timingSafeEqual(wanted, received);
  });
  requireValue(matches.some(Boolean), "UNAUTHORIZED");
  requireValue(!request.headers.has("cookie"), "COOKIE_FORBIDDEN");
}
const receiptSchema = z.object({ schemaVersion: z.literal("applypack-protected-recovery-receipt-v1"), nonce: z.uuid(),
  sourceProjectRef: z.literal(RECOVERY_PROJECT), releaseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  startedAt: timestamp, completedAt: timestamp, inventoryDigest: hash,
  objectCount: z.number().int().nonnegative(), referenceCount: z.number().int().nonnegative(), tombstoneCount: z.number().int().nonnegative() }).strict();
export function signRecoveryReceipt(inventory, secret) {
  requireValue(secretValid(secret), "RECEIPT_CONFIGURATION");
  const payload = receiptSchema.parse({ schemaVersion: "applypack-protected-recovery-receipt-v1", nonce: randomUUID(),
    sourceProjectRef: inventory.sourceProjectRef, releaseSha: inventory.releaseSha, startedAt: inventory.startedAt,
    completedAt: inventory.completedAt, inventoryDigest: inventory.inventoryDigest,
    objectCount: inventory.counts.objects, referenceCount: inventory.counts.references, tombstoneCount: inventory.counts.tombstones });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}
export function verifyRecoveryReceipt(value, secret) {
  requireValue(secretValid(secret) && typeof value === "string" && value.length <= 4096, "RECEIPT_INVALID");
  const parts = value.split("."); requireValue(parts.length === 2 && parts.every((part) => /^[A-Za-z0-9_-]+$/u.test(part)), "RECEIPT_INVALID");
  const expected = createHmac("sha256", secret).update(parts[0]).digest(); const supplied = Buffer.from(parts[1], "base64url");
  requireValue(supplied.length === expected.length && timingSafeEqual(supplied, expected), "RECEIPT_INVALID");
  try { return receiptSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))); } catch { denied("RECEIPT_INVALID"); }
}
function verifyReceiptPair(value, configuration, now) {
  const first = verifyRecoveryReceipt(value.firstReceipt, configuration.receiptSecret);
  const second = verifyRecoveryReceipt(value.secondReceipt, configuration.receiptSecret);
  const start = Date.parse(first.startedAt);
  requireValue(first.nonce !== second.nonce && first.releaseSha === configuration.releaseSha && second.releaseSha === first.releaseSha
    && first.inventoryDigest === second.inventoryDigest && Date.parse(first.completedAt) >= start
    && Date.parse(second.startedAt) >= Date.parse(first.completedAt) && Date.parse(second.completedAt) >= Date.parse(second.startedAt)
    && Date.parse(second.completedAt) <= now && start <= now && now - start <= RECOVERY_LIMITS.runMilliseconds, "COMPLETION_INVALID");
  for (const name of ["objectCount", "referenceCount", "tombstoneCount"])
    requireValue(first[name] === second[name], "COMPLETION_COUNTS");
  return first;
}
export function validateRecoveryCompletion(input, configuration, now = Date.now()) {
  const value = recoveryCompletionSchema.parse(input);
  const first = verifyReceiptPair(value, configuration, now);
  requireValue(value.manifestVersionId !== "null", "COMPLETION_INVALID");
  for (const name of ["objectCount", "referenceCount", "tombstoneCount"])
    requireValue(value[name] === first[name], "COMPLETION_COUNTS");
  return { schemaVersion: "applypack-protected-recovery-checkpoint-v1", sourceEnvironment: "production", sourceProjectRef: RECOVERY_PROJECT,
    releaseSha: first.releaseSha, sourceStartedAt: first.startedAt, completedAt: new Date(now).toISOString(), inventoryDigest: first.inventoryDigest,
    manifestSha256: value.manifestSha256, manifestVersionId: value.manifestVersionId,
    objectCount: first.objectCount, referenceCount: first.referenceCount, tombstoneCount: first.tombstoneCount };
}
export function validateRecoveryRetentionCompletion(input, configuration, now = Date.now()) {
  const value = recoveryRetentionCompletionSchema.parse(input);
  const first = verifyReceiptPair(value, configuration, now);
  return { schemaVersion: "applypack-protected-recovery-retention-v1", sourceEnvironment: "production", sourceProjectRef: RECOVERY_PROJECT,
    releaseSha: first.releaseSha, sourceStartedAt: first.startedAt, completedAt: new Date(now).toISOString(), inventoryDigest: first.inventoryDigest,
    planSha256: value.planSha256, providerVerificationSha256: value.providerVerificationSha256,
    deletedVersionCount: value.deletedVersionCount, retainedVersionCount: value.retainedVersionCount };
}

/** Monotonic compare-and-set prevents stale/concurrent publishers from refreshing an older watermark. */
export async function persistRecoveryCompletion(admin, summary, taskName = "protected_recovery") {
  requireValue(["protected_recovery", "protected_recovery_retention"].includes(taskName), "HEARTBEAT_INVALID");
  const record = { task_name: taskName, last_succeeded_at: summary.sourceStartedAt,
    summary, updated_at: summary.completedAt };
  for (let attempt = 0; attempt < 2; attempt++) {
    const updated = await admin.from("operational_heartbeats").update(record).eq("task_name", record.task_name)
      .lt("last_succeeded_at", summary.sourceStartedAt).select("task_name").maybeSingle();
    requireValue(!updated.error, "COMPLETION_WRITE_FAILED");
    if (updated.data) return;
    const existing = await admin.from("operational_heartbeats").select("last_succeeded_at").eq("task_name", record.task_name).maybeSingle();
    requireValue(!existing.error, "COMPLETION_WRITE_FAILED");
    if (existing.data) denied("COMPLETION_REPLAY");
    const inserted = await admin.from("operational_heartbeats").insert(record);
    if (!inserted.error) return;
    requireValue(inserted.error.code === "23505", "COMPLETION_WRITE_FAILED");
  }
  denied("COMPLETION_REPLAY");
}

/** Fixed private GET only; bytes stay in bounded memory, never a plaintext temporary file. */
export async function readRecoveryObject({ reader, bucket, key, sourceVersion, environment = process.env, fetchImpl = fetch }) {
  requireValue(RECOVERY_BUCKETS.includes(bucket) && recoveryKeySchema.safeParse(key).success && /^[a-f0-9]{64}$/u.test(sourceVersion), "OBJECT_REQUEST_INVALID");
  const origin = `https://${RECOVERY_PROJECT}.supabase.co`;
  requireValue(environment.NEXT_PUBLIC_SUPABASE_URL === origin, "SOURCE_IDENTITY");
  const credential = environment.SUPABASE_SECRET_KEY || environment.SUPABASE_SERVICE_ROLE_KEY;
  requireValue(typeof credential === "string" && credential.length > 20, "SOURCE_CREDENTIAL_MISSING");
  const before = normalizeRecoveryObjectInfo(dataOf(await boundedRecoveryOperation(() => reader.objectInfo(bucket, key))), bucket, key);
  requireValue(before.sourceVersion === sourceVersion, "OBJECT_CHANGED");
  const response = await fetchImpl(`${origin}/storage/v1/object/authenticated/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
    { headers: { apikey: credential, authorization: `Bearer ${credential}` }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000) });
  requireValue(response.ok && response.body, "OBJECT_READ_FAILED");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength; requireValue(size <= before.size && size <= RECOVERY_LIMITS.objectBytes, "OBJECT_SIZE_INVALID"); chunks.push(chunk);
  }
  requireValue(size === before.size, "OBJECT_SIZE_INVALID");
  const after = normalizeRecoveryObjectInfo(dataOf(await boundedRecoveryOperation(() => reader.objectInfo(bucket, key))), bucket, key);
  requireValue(after.sourceVersion === sourceVersion, "OBJECT_CHANGED");
  const bytes = Buffer.concat(chunks, size);
  return { bytes, sourceVersion, size, sha256: recoverySha256(bytes) };
}

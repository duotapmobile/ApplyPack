import { createHash } from "node:crypto";
import { RECOVERY_BUCKETS, RECOVERY_LIMITS, RECOVERY_PROJECT, recoveryInventorySchema, recoveryInventoryDigest, recoveryCompletionSchema } from "./protected-recovery-protocol.mjs";
export { RECOVERY_BUCKETS } from "./protected-recovery-protocol.mjs";

export const RECOVERY = Object.freeze({
  projectRef: RECOVERY_PROJECT,
  sourceOrigin: "https://applypack.work",
  inventorySchema: "applypack-protected-recovery-inventory-v1",
  manifestSchema: "applypack-protected-recovery-manifest-v1",
  maximumInventoryBytes: RECOVERY_LIMITS.inventoryBytes,
  maximumObjects: RECOVERY_LIMITS.objects,
  maximumObjectBytes: RECOVERY_LIMITS.objectBytes,
  maximumTotalBytes: 10 * 1024 * 1024 * 1024,
  maximumRunMilliseconds: RECOVERY_LIMITS.runMilliseconds,
  maximumCheckpointAgeMilliseconds: 10 * 60 * 1000,
});
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const canonicalBytes = (value) => Buffer.from(JSON.stringify(canonical(value)), "utf8");
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const canonicalSha256 = (value) => sha256(canonicalBytes(value));
const fail = (code) => { throw new Error(`PROTECTED_RECOVERY_${code}`); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, fields) => record(value) && Object.keys(value).sort().join("|") === [...fields].sort().join("|");
const hex = (value, length = 64) => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value);
const opaque = (value, maximum = 256) => typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
const timestamp = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value));
const identity = (value) => `${value.bucket}\u0000${value.key}`;
const versionIdentity = (value) => `${identity(value)}\u0000${value.sourceVersion}`;
const validPath = (value) => opaque(value, 1024) && !value.startsWith("/") && !value.includes("\\")
  && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
const validLocation = (value) => RECOVERY_BUCKETS.includes(value.bucket) && validPath(value.key);

export const inventoryDigest = recoveryInventoryDigest;

export function validateInventory(inventory, { releaseSha, now = Date.now(), requireFresh = true } = {}) {
  requireValue(recoveryInventorySchema.safeParse(inventory).success, "INVENTORY_SHAPE");
  requireValue(canonicalBytes(inventory).byteLength <= RECOVERY.maximumInventoryBytes, "INVENTORY_LIMIT");
  requireValue(!releaseSha || inventory.releaseSha === releaseSha, "RELEASE_IDENTITY");
  requireValue(inventory.buckets.join("|") === RECOVERY_BUCKETS.join("|"), "BUCKET_COVERAGE");
  requireValue(Date.parse(inventory.startedAt) <= Date.parse(inventory.completedAt)
    && Date.parse(inventory.completedAt) <= now
    && (!requireFresh || now - Date.parse(inventory.startedAt) <= RECOVERY.maximumCheckpointAgeMilliseconds), "INVENTORY_TIME");
  requireValue(inventory.counts.objects === inventory.objects.length
    && inventory.counts.references === inventory.references.length
    && inventory.counts.tombstones === inventory.tombstones.length
    && Object.values(inventory.counts.tables).every((count) => count <= RECOVERY_LIMITS.references), "INVENTORY_COUNTS");
  const objects = new Map();
  let totalBytes = 0;
  let previousIdentity = "";
  for (const object of inventory.objects) {
    requireValue(exact(object, ["bucket", "key", "sourceVersion", "size", "expectedSha256", "retentionExpiresAt"])
      && validLocation(object) && opaque(object.sourceVersion)
      && Number.isSafeInteger(object.size) && object.size >= 0 && object.size <= RECOVERY.maximumObjectBytes
      && (object.expectedSha256 === null || hex(object.expectedSha256))
      && (object.retentionExpiresAt === null || timestamp(object.retentionExpiresAt)), "OBJECT_INVALID");
    const id = identity(object);
    requireValue(id > previousIdentity && !objects.has(id), "OBJECT_ORDER_OR_DUPLICATE");
    previousIdentity = id;
    totalBytes += object.size;
    requireValue(totalBytes <= RECOVERY.maximumTotalBytes, "TOTAL_BYTES_LIMIT");
    objects.set(id, object);
  }
  const referenceIds = new Set();
  for (const reference of inventory.references) {
    const refId = `${reference.table}\u0000${reference.id}\u0000${reference.field}`;
    requireValue(!referenceIds.has(refId), "REFERENCE_DUPLICATE");
    referenceIds.add(refId);
    const object = objects.get(identity(reference));
    requireValue(object && (!reference.expectedSha256 || object.expectedSha256 === reference.expectedSha256)
      && (!reference.retentionExpiresAt || object.retentionExpiresAt === reference.retentionExpiresAt), "REFERENCE_UNRESOLVED");
  }
  const tombstoneIds = new Set();
  for (const tombstone of inventory.tombstones) {
    requireValue(Date.parse(tombstone.effectiveAt) <= Date.parse(inventory.completedAt), "TOMBSTONE_INVALID");
    const id = canonicalSha256(tombstone);
    requireValue(!tombstoneIds.has(id), "TOMBSTONE_DUPLICATE");
    tombstoneIds.add(id);
  }
  requireValue(hex(inventory.inventoryDigest) && inventoryDigest(inventory) === inventory.inventoryDigest, "INVENTORY_DIGEST");
  return { objects, totalBytes };
}

function validateArchive(archive) {
  requireValue(exact(archive, ["bucket", "kmsKeyArn"])
    && archive.bucket === "applypack-production-protected-recovery-838445019912"
    && /^arn:aws:kms:us-east-1:838445019912:key\/[a-f0-9-]{36}$/u.test(archive.kmsKeyArn), "ARCHIVE_CONFIGURATION");
}

function deadline(now, maximumRunMilliseconds) {
  requireValue(Number.isInteger(maximumRunMilliseconds) && maximumRunMilliseconds > 0
    && maximumRunMilliseconds <= RECOVERY.maximumRunMilliseconds, "RUN_LIMIT");
  const controller = new AbortController();
  const end = now() + maximumRunMilliseconds;
  const timer = setTimeout(() => controller.abort(), maximumRunMilliseconds);
  const check = () => requireValue(!controller.signal.aborted && now() < end, "TIMEOUT");
  const wait = async (promise) => {
    check();
    let listener;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        listener = () => reject(new Error("PROTECTED_RECOVERY_TIMEOUT"));
        controller.signal.addEventListener("abort", listener, { once: true });
      })]);
    } finally {
      if (listener) controller.signal.removeEventListener("abort", listener);
      check();
    }
  };
  return { check, wait, signal: controller.signal, close: () => { clearTimeout(timer); controller.abort(); } };
}

function checkedStream(body, expectedSize, expectedSha256, clock) {
  requireValue(body && typeof body[Symbol.asyncIterator] === "function", "STREAM_REQUIRED");
  let size = 0;
  let digest = null;
  let finished = false;
  const iterator = body[Symbol.asyncIterator]();
  async function* stream() {
    const hash = createHash("sha256");
    try {
      for (;;) {
        const next = await clock.wait(iterator.next());
        if (next.done) break;
        requireValue(next.value instanceof Uint8Array, "STREAM_CHUNK_INVALID");
        size += next.value.byteLength;
        requireValue(size <= expectedSize && size <= RECOVERY.maximumObjectBytes, "STREAM_SIZE");
        hash.update(next.value);
        yield next.value;
      }
      requireValue(size === expectedSize, "STREAM_SIZE");
      digest = hash.digest("hex");
      requireValue(!expectedSha256 || expectedSha256 === digest, "SOURCE_HASH_MISMATCH");
      finished = true;
    } finally {
      if (!finished && typeof iterator.return === "function") {
        // A stuck transport must not extend the bounded run during cleanup.
        Promise.resolve(iterator.return()).catch(() => {});
      }
    }
  }
  return { body: stream(), result: () => {
    requireValue(finished && digest !== null, "STREAM_NOT_CONSUMED");
    return { size, sha256: digest };
  } };
}

const encryption = (archive) => ({ bucket: archive.bucket, serverSideEncryption: "aws:kms", kmsKeyId: archive.kmsKeyArn, checksumAlgorithm: "SHA256", immutable: true });
function validateStored(stored, content) {
  requireValue(exact(stored, ["versionId", "checksumSha256", "size"])
    && opaque(stored.versionId, 1024) && stored.versionId !== "null"
    && stored.checksumSha256 === content.sha256 && stored.size === content.size, "DESTINATION_VERIFICATION");
}

export function validateManifest(manifest, digest) {
  requireValue(exact(manifest, ["schemaVersion", "archive", "inventory", "secondInventoryReceipt", "watermark", "createdAt", "previousManifestDigest", "entries"])
    && manifest.schemaVersion === RECOVERY.manifestSchema && hex(digest)
    && canonicalSha256(manifest) === digest, "MANIFEST_INVALID");
  validateArchive(manifest.archive);
  const { objects } = validateInventory(manifest.inventory, { now: Date.parse(manifest.createdAt), requireFresh: false });
  requireValue(timestamp(manifest.createdAt) && manifest.watermark === manifest.inventory.startedAt
    && Date.parse(manifest.createdAt) >= Date.parse(manifest.inventory.completedAt)
    && opaque(manifest.secondInventoryReceipt, 4096)
    && (manifest.previousManifestDigest === null || hex(manifest.previousManifestDigest))
    && Array.isArray(manifest.entries) && manifest.entries.length === objects.size, "MANIFEST_COVERAGE");
  const seen = new Set();
  for (const entry of manifest.entries) {
    requireValue(exact(entry, ["bucket", "key", "sourceVersion", "size", "sha256", "archiveKey", "archiveVersionId"])
      && validLocation(entry) && opaque(entry.sourceVersion) && hex(entry.sha256)
      && entry.archiveKey === `objects/${entry.bucket}/${sha256(versionIdentity(entry))}`
      && opaque(entry.archiveVersionId, 1024) && entry.archiveVersionId !== "null", "MANIFEST_ENTRY");
    const object = objects.get(identity(entry));
    requireValue(object && object.sourceVersion === entry.sourceVersion && object.size === entry.size
      && (!object.expectedSha256 || object.expectedSha256 === entry.sha256)
      && !seen.has(identity(entry)), "MANIFEST_ENTRY_BINDING");
    seen.add(identity(entry));
  }
  return manifest;
}

/** All adapters are fixed-purpose: none accepts caller-selected URLs or source queries. */
async function writeCheckpoint({ source, destination, completion, archive, releaseSha, previous = null,
  now = Date.now, maximumRunMilliseconds = RECOVERY.maximumRunMilliseconds }) {
  validateArchive(archive);
  requireValue(hex(releaseSha, 40), "RELEASE_IDENTITY");
  const clock = deadline(now, maximumRunMilliseconds);
  try {
    const first = await clock.wait(source.readInventory({ signal: clock.signal }));
    validateInventory(first, { releaseSha, now: now() });
    const deletedObjects = new Set(first.tombstones.filter((item) => item.kind === "DELETED").map(identity));
    const reused = new Map();
    if (previous !== null) {
      validateManifest(previous.manifest, previous.digest);
      requireValue(canonicalSha256(previous.manifest.archive) === canonicalSha256(archive), "PREVIOUS_ARCHIVE");
      for (const entry of previous.manifest.entries) reused.set(versionIdentity(entry), entry);
    }
    const entries = [];
    for (const object of first.objects) {
      clock.check();
      requireValue(object.retentionExpiresAt === null || Date.parse(object.retentionExpiresAt) > now(), "SOURCE_VERSION_EXPIRED");
      requireValue(!deletedObjects.has(identity(object)), "SOURCE_VERSION_DELETED");
      const prior = reused.get(versionIdentity(object));
      if (prior) {
        requireValue(prior.size === object.size && (!object.expectedSha256 || prior.sha256 === object.expectedSha256), "PREVIOUS_ENTRY_MISMATCH");
        entries.push(prior);
        continue;
      }
      const opened = await clock.wait(source.openObject({ ...object, signal: clock.signal }));
      requireValue(record(opened) && opened.sourceVersion === object.sourceVersion && opened.size === object.size
        && (opened.sha256 === undefined || hex(opened.sha256))
        && (object.expectedSha256 !== null || hex(opened.sha256))
        && (!object.expectedSha256 || !opened.sha256 || object.expectedSha256 === opened.sha256), "SOURCE_VERSION_CHANGED");
      const checked = checkedStream(opened.body, object.size, object.expectedSha256 ?? opened.sha256, clock);
      const archiveKey = `objects/${object.bucket}/${sha256(versionIdentity(object))}`;
      const stored = await clock.wait(destination.putObject({ ...encryption(archive), key: archiveKey,
        body: checked.body, expectedSize: object.size, signal: clock.signal }));
      const content = checked.result();
      validateStored(stored, content);
      entries.push({ bucket: object.bucket, key: object.key, sourceVersion: object.sourceVersion, size: content.size,
        sha256: content.sha256, archiveKey, archiveVersionId: stored.versionId });
    }
    const second = await clock.wait(source.readInventory({ signal: clock.signal }));
    validateInventory(second, { releaseSha, now: now() });
    requireValue(second.inventoryDigest === first.inventoryDigest && Date.parse(second.startedAt) >= Date.parse(first.completedAt), "INVENTORY_CHANGED");
    requireValue(now() - Date.parse(first.startedAt) <= RECOVERY.maximumCheckpointAgeMilliseconds, "CHECKPOINT_EXPIRED");
    requireValue(first.objects.every((object) => object.retentionExpiresAt === null || Date.parse(object.retentionExpiresAt) > now()), "SOURCE_VERSION_EXPIRED");
    const manifest = { schemaVersion: RECOVERY.manifestSchema, archive, inventory: first,
      secondInventoryReceipt: second.receipt, watermark: first.startedAt, createdAt: new Date(now()).toISOString(),
      previousManifestDigest: previous?.digest ?? null, entries };
    const manifestDigest = canonicalSha256(manifest);
    validateManifest(manifest, manifestDigest);
    const bytes = canonicalBytes(manifest);
    const stored = await clock.wait(destination.publishManifest({ ...encryption(archive),
      key: `manifests/${manifestDigest}.json`, body: bytes, expectedSize: bytes.byteLength,
      checksumSha256: manifestDigest, signal: clock.signal }));
    validateStored(stored, { size: bytes.byteLength, sha256: manifestDigest });
    if (completion === null) {
      return { status: "BOOTSTRAP_ARCHIVED_WITHOUT_APPLICATION_CHECKPOINT", manifest, manifestDigest,
        manifestVersionId: stored.versionId, applicationCheckpointCompleted: false };
    }
    // Publishing an archive is not a completed application checkpoint. Only the
    // authenticated, monotonic server acknowledgement makes it one.
    const request = recoveryCompletionSchema.parse({ schemaVersion: "applypack-protected-recovery-completion-v1",
      firstReceipt: first.receipt, secondReceipt: second.receipt, manifestSha256: manifestDigest,
      manifestVersionId: stored.versionId, objectCount: entries.length,
      referenceCount: first.references.length, tombstoneCount: first.tombstones.length });
    const acknowledged = await clock.wait(completion.submit(request, { signal: clock.signal }));
    requireValue(record(acknowledged) && acknowledged.ok === true
      && acknowledged.manifestSha256 === manifestDigest && acknowledged.sourceStartedAt === first.startedAt,
    "COMPLETION_NOT_ACKNOWLEDGED");
    return { manifest, manifestDigest, manifestVersionId: stored.versionId, acknowledgement: acknowledged };
  } finally { clock.close(); }
}

export async function copyCheckpoint(options) {
  requireValue(typeof options.completion?.submit === "function", "COMPLETION_REQUIRED");
  return writeCheckpoint(options);
}

/** Pre-deployment operator archive only: cannot update or impersonate a heartbeat. */
export async function createBootstrapArchive(options) {
  requireValue(options.operatorBootstrap === true && !options.completion, "BOOTSTRAP_MODE");
  return writeCheckpoint({ ...options, completion: null });
}

const LOCKS = ["checkoutLocked", "intakeLocked", "customerAccessLocked", "outboundMailDisabled", "livePaymentsDisabled", "callbacksDisabled", "scheduledWritersDisabled"];
function validateRestorePolicy(policy, digest) {
  requireValue(exact(policy, ["schemaVersion", "targetProjectRef", "targetOrigin", "allowedTargets", "archiveCredentialIdentity", "targetCredentialIdentity", "sourceCredentialIdentity", "expectedManifestDigest"])
    && policy.schemaVersion === "applypack-protected-recovery-restore-policy-v1"
    && /^[a-z]{20}$/u.test(policy.targetProjectRef)
    && ![RECOVERY.projectRef, "fmugizadzdnqfckujqlw"].includes(policy.targetProjectRef)
    && policy.targetOrigin === `https://${policy.targetProjectRef}.supabase.co`
    && Array.isArray(policy.allowedTargets) && policy.allowedTargets.length > 0
    && policy.allowedTargets.every((target) => exact(target, ["projectRef", "origin", "environment"])
      && target.environment === "recovery" && /^[a-z]{20}$/u.test(target.projectRef)
      && ![RECOVERY.projectRef, "fmugizadzdnqfckujqlw"].includes(target.projectRef)
      && target.origin === `https://${target.projectRef}.supabase.co`)
    && policy.allowedTargets.some((target) => target.projectRef === policy.targetProjectRef && target.origin === policy.targetOrigin)
    && opaque(policy.archiveCredentialIdentity) && opaque(policy.targetCredentialIdentity) && opaque(policy.sourceCredentialIdentity)
    && policy.archiveCredentialIdentity !== policy.sourceCredentialIdentity
    && policy.targetCredentialIdentity !== policy.sourceCredentialIdentity
    && policy.archiveCredentialIdentity !== policy.targetCredentialIdentity
    && policy.expectedManifestDigest === digest, "RESTORE_POLICY");
}

/** Restores only into an explicitly registered isolated recovery project; never unlocks it. */
export async function restoreCheckpoint({ manifest, manifestDigest, latestInventory, policy, archiveReader, target,
  now = Date.now, maximumRunMilliseconds = RECOVERY.maximumRunMilliseconds }) {
  validateManifest(manifest, manifestDigest);
  validateRestorePolicy(policy, manifestDigest);
  validateInventory(latestInventory, { now: now() });
  requireValue(Date.parse(latestInventory.startedAt) >= Date.parse(manifest.watermark), "RESTORE_OVERLAY_OLDER");
  const clock = deadline(now, maximumRunMilliseconds);
  try {
    const locked = await clock.wait(target.assertLocked({ signal: clock.signal }));
    requireValue(record(locked) && locked.projectRef === policy.targetProjectRef && locked.origin === policy.targetOrigin
      && locked.credentialIdentity === policy.targetCredentialIdentity && LOCKS.every((name) => locked[name] === true), "RESTORE_TARGET_UNLOCKED");
    const reader = await clock.wait(archiveReader.identity({ signal: clock.signal }));
    requireValue(record(reader) && reader.credentialIdentity === policy.archiveCredentialIdentity
      && reader.independentRecovery === true, "RESTORE_CREDENTIAL");
    const overlay = [...manifest.inventory.tombstones, ...latestInventory.tombstones];
    const latestObjects = new Map(latestInventory.objects.map((object) => [identity(object), object]));
    const latestReferences = new Set(latestInventory.references.map((reference) => `${reference.table}\u0000${reference.id}\u0000${reference.field}\u0000${identity(reference)}`));
    const priorReferencedObjects = new Set(manifest.inventory.references.map(identity));
    const survivingReferenceObjects = new Set(manifest.inventory.references
      .filter((reference) => latestReferences.has(`${reference.table}\u0000${reference.id}\u0000${reference.field}\u0000${identity(reference)}`)).map(identity));
    // Some historical deletions removed a path without writing a tombstone.
    // A current complete inventory is also an allowlist: older references alone
    // can never authorize restoring a now-absent or replaced private object.
    for (const object of manifest.inventory.objects) {
      const current = latestObjects.get(identity(object));
      if (!current || current.sourceVersion !== object.sourceVersion
        || (priorReferencedObjects.has(identity(object)) && !survivingReferenceObjects.has(identity(object)))) {
        overlay.push({ table: "recovery_current_inventory", id: sha256(identity(object)), bucket: object.bucket,
          key: object.key, kind: "DELETED", effectiveAt: latestInventory.completedAt });
      }
    }
    for (const object of [...manifest.inventory.objects, ...latestInventory.objects]) {
      if (object.retentionExpiresAt !== null && Date.parse(object.retentionExpiresAt) <= now()) {
        overlay.push({ table: "recovery_retention", id: sha256(identity(object)), bucket: object.bucket,
          key: object.key, kind: "DELETED", effectiveAt: object.retentionExpiresAt });
      }
    }
    const unique = [...new Map(overlay.map((item) => [canonicalSha256(item), item])).values()]
      .sort((a, b) => canonicalSha256(a).localeCompare(canonicalSha256(b), "en"));
    const overlayDigest = canonicalSha256(unique);
    const applied = await clock.wait(target.applyTombstones({ tombstones: unique, digest: overlayDigest, signal: clock.signal }));
    requireValue(record(applied) && applied.digest === overlayDigest && applied.customerAccessLocked === true, "RESTORE_TOMBSTONES_UNAPPLIED");
    const blocked = new Set(unique.map(identity));
    let restored = 0;
    for (const entry of manifest.entries) {
      if (blocked.has(identity(entry))) continue;
      const opened = await clock.wait(archiveReader.openObject({ bucket: manifest.archive.bucket, key: entry.archiveKey,
        versionId: entry.archiveVersionId, signal: clock.signal }));
      requireValue(record(opened) && opened.versionId === entry.archiveVersionId && opened.size === entry.size, "RESTORE_ARCHIVE_VERSION");
      const checked = checkedStream(opened.body, entry.size, entry.sha256, clock);
      const stored = await clock.wait(target.putPrivateObject({ bucket: entry.bucket, key: entry.key, body: checked.body,
        expectedSize: entry.size, expectedSha256: entry.sha256, overwrite: false, signal: clock.signal }));
      const content = checked.result();
      requireValue(record(stored) && stored.sha256 === content.sha256 && stored.size === content.size
        && stored.private === true && stored.customerAccessLocked === true, "RESTORE_OBJECT_VERIFICATION");
      restored++;
    }
    const finalLocks = await clock.wait(target.assertLocked({ signal: clock.signal }));
    requireValue(record(finalLocks) && finalLocks.projectRef === policy.targetProjectRef
      && finalLocks.credentialIdentity === policy.targetCredentialIdentity && LOCKS.every((name) => finalLocks[name] === true), "RESTORE_TARGET_UNLOCKED");
    return { status: "FILES_RESTORED_ACCESS_LOCKED", manifestDigest, overlayDigest, restoredObjects: restored,
      excludedObjects: manifest.entries.length - restored, customerAccessLocked: true };
  } finally { clock.close(); }
}

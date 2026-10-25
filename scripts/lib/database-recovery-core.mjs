import { createHash } from "node:crypto";
import { canonicalBytes, canonicalSha256, sha256, validateInventory, validateManifest } from "./protected-recovery-core.mjs";
import { DATABASE_RECOVERY, DATABASE_RECOVERY_LIMITS, DatabaseRecoveryError, databaseArchiveSchema,
  databaseSnapshotReceipt, validateDatabaseSnapshot, validateDatabaseRolesMetadata, validateDatabaseFileCheckpoint,
  validateDatabaseStoredObject, validateDatabaseManifest } from "./database-recovery-protocol.mjs";

const fail = (code) => { throw new DatabaseRecoveryError(`CORE_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");

function deadline(now, maximumRunMilliseconds) {
  requireValue(Number.isInteger(maximumRunMilliseconds) && maximumRunMilliseconds > 0
    && maximumRunMilliseconds <= DATABASE_RECOVERY_LIMITS.runMilliseconds && Number.isFinite(now()), "RUN_LIMIT");
  const controller = new AbortController();
  const end = now() + maximumRunMilliseconds;
  const timer = setTimeout(() => controller.abort(), maximumRunMilliseconds);
  const check = () => requireValue(!controller.signal.aborted && Number.isFinite(now()) && now() < end, "TIMEOUT");
  const wait = async (operation, code) => {
    check(); let listener;
    try {
      const result = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        listener = () => reject(new DatabaseRecoveryError("CORE_TIMEOUT"));
        controller.signal.addEventListener("abort", listener, { once: true });
      })]);
      check(); return result;
    } catch (error) {
      if (error instanceof DatabaseRecoveryError) throw error;
      fail(code);
    } finally { if (listener) controller.signal.removeEventListener("abort", listener); }
  };
  return { signal: controller.signal, check, wait, close: () => { clearTimeout(timer); controller.abort(); } };
}

function checkedDump(body, clock) {
  requireValue(body && typeof body[Symbol.asyncIterator] === "function", "DUMP_STREAM");
  let size = 0; let digest; let finished = false; let chunks = 0;
  const iterator = body[Symbol.asyncIterator]();
  const stream = (async function* () {
    const hash = createHash("sha256"); let prefix = Buffer.alloc(0);
    try {
      for (;;) {
        const next = await clock.wait(() => iterator.next(), "DUMP_READ_FAILED");
        if (next.done) break;
        requireValue(next.value instanceof Uint8Array && ++chunks <= 262144, "DUMP_CHUNK");
        size += next.value.byteLength;
        requireValue(size <= DATABASE_RECOVERY_LIMITS.dumpBytes, "DUMP_LIMIT");
        if (prefix.length < 5) {
          prefix = Buffer.concat([prefix, Buffer.from(next.value.subarray(0, 5 - prefix.length))]);
          if (prefix.length === 5) requireValue(prefix.equals(Buffer.from("PGDMP")), "DUMP_FORMAT");
        }
        hash.update(next.value); yield next.value;
      }
      requireValue(size >= 5 && prefix.equals(Buffer.from("PGDMP")), "DUMP_FORMAT");
      digest = hash.digest("hex"); finished = true;
    } finally {
      if (!finished && typeof iterator.return === "function") Promise.resolve(iterator.return()).catch(() => {});
    }
  })();
  return { body: stream, cancel: () => { Promise.resolve(stream.return()).catch(() => {}); }, result: () => {
    requireValue(finished && digest, "DUMP_NOT_CONSUMED"); return { size, sha256: digest };
  } };
}

function validateFileBinding({ inventory, fileCheckpoint, snapshot, envelope, archive, now }) {
  requireValue(exact(envelope, ["manifest", "digest", "versionId"])
    && envelope.digest === fileCheckpoint.manifestSha256 && envelope.versionId === fileCheckpoint.manifestVersionId, "FILE_MANIFEST_IDENTITY");
  try {
    validateInventory(inventory, { releaseSha: snapshot.releaseSha, now, requireRetention: true });
    validateManifest(envelope.manifest, envelope.digest);
  } catch { fail("FILE_GRAPH_INVALID"); }
  const manifest = envelope.manifest;
  requireValue(canonicalSha256(manifest.archive) === canonicalSha256(archive)
    && manifest.inventory.releaseSha === snapshot.releaseSha
    && manifest.inventory.sourceProjectRef === snapshot.sourceProjectRef
    && manifest.inventory.schemaVersion === "applypack-protected-recovery-inventory-v2"
    && inventory.receipt === databaseSnapshotReceipt(snapshot)
    && Date.parse(inventory.startedAt) >= Date.parse(snapshot.startedAt)
    && Date.parse(manifest.createdAt) <= Date.parse(fileCheckpoint.completedAt)
    && manifest.watermark === fileCheckpoint.sourceStartedAt
    && manifest.inventory.inventoryDigest === fileCheckpoint.inventoryDigest
    && inventory.inventoryDigest === fileCheckpoint.inventoryDigest
    && inventory.objects.length === fileCheckpoint.objectCount
    && inventory.references.length === fileCheckpoint.referenceCount
    && inventory.tombstones.length === fileCheckpoint.tombstoneCount, "FILE_GRAPH_MISMATCH");
}

/** Publishes a companion archive only. It has no application heartbeat, readiness, or restore API. */
export async function createDatabaseCheckpoint({ source, destination, releaseSha, now = Date.now,
  maximumRunMilliseconds = DATABASE_RECOVERY_LIMITS.runMilliseconds }) {
  requireValue(typeof source?.openSnapshot === "function" && typeof destination?.readFileManifest === "function"
    && typeof destination?.putDatabaseDump === "function" && typeof destination?.putRolesMetadata === "function"
    && typeof destination?.putDatabaseManifest === "function", "ADAPTERS_REQUIRED");
  requireValue(databaseArchiveSchema.safeParse(destination.archive).success && /^[a-f0-9]{40}$/u.test(releaseSha || ""), "CONFIGURATION");
  const archive = structuredClone(destination.archive);
  const clock = deadline(now, maximumRunMilliseconds);
  let handle; let dumpStream; let closed = false;
  const close = async () => { if (!closed && typeof handle?.close === "function") { closed = true; await handle.close(); } };
  try {
    const opening = Promise.resolve().then(() => source.openSnapshot({ releaseSha, signal: clock.signal }));
    // If a transport resolves after the deadline, do not leave its transaction open.
    opening.then((late) => { handle = late; if (clock.signal.aborted) Promise.resolve(close()).catch(() => {}); }, () => {});
    handle = await clock.wait(() => opening, "SOURCE_OPEN_FAILED");
    requireValue(exact(handle, ["snapshot", "inventory", "fileCheckpoint", "rolesMetadata", "openDump", "close"])
      && typeof handle.openDump === "function" && typeof handle.close === "function", "SNAPSHOT_HANDLE");
    const snapshot = structuredClone(handle.snapshot);
    const inventory = structuredClone(handle.inventory);
    const fileCheckpoint = structuredClone(handle.fileCheckpoint);
    const rolesMetadata = structuredClone(handle.rolesMetadata);
    validateDatabaseSnapshot(snapshot, { releaseSha, now: now() });
    validateDatabaseFileCheckpoint(fileCheckpoint, snapshot, now());
    validateDatabaseRolesMetadata(rolesMetadata, snapshot);
    const envelope = await clock.wait(() => destination.readFileManifest({ digest: fileCheckpoint.manifestSha256,
      versionId: fileCheckpoint.manifestVersionId, signal: clock.signal }), "FILE_MANIFEST_READ_FAILED");
    validateFileBinding({ snapshot, inventory, fileCheckpoint, envelope, archive, now: now() });

    const opened = await clock.wait(() => handle.openDump({ signal: clock.signal }), "DUMP_OPEN_FAILED");
    const completed = Promise.resolve(opened?.completed);
    completed.catch(() => {});
    requireValue(exact(opened, ["body", "completed"]) && typeof opened.completed?.then === "function", "DUMP_HANDLE");
    const checked = checkedDump(opened.body, clock);
    dumpStream = checked;
    const dumpStored = await clock.wait(() => destination.putDatabaseDump({ body: checked.body, signal: clock.signal }), "DUMP_ARCHIVE_FAILED");
    const content = checked.result();
    const exited = await clock.wait(() => completed, "DUMP_EXIT_FAILED");
    requireValue(exact(exited, ["bytes", "sha256"]) && exited.bytes === content.size && exited.sha256 === content.sha256, "DUMP_COMPLETION_MISMATCH");
    validateDatabaseStoredObject(dumpStored, { archive, key: `database/dumps/${content.sha256}.dump`, ...content });

    const rolesBytes = canonicalBytes(rolesMetadata);
    let rolesStored;
    try {
      rolesStored = await clock.wait(() => destination.putRolesMetadata({ body: rolesBytes, signal: clock.signal }), "ROLES_ARCHIVE_FAILED");
      validateDatabaseStoredObject(rolesStored, { archive, key: `database/roles/${sha256(rolesBytes)}.json`,
        sha256: sha256(rolesBytes), size: rolesBytes.byteLength });
    } finally { rolesBytes.fill(0); }

    // Closing the held transaction must succeed before a manifest can advertise the archive.
    await clock.wait(close, "SOURCE_CLOSE_FAILED");
    validateDatabaseSnapshot(snapshot, { releaseSha, now: now() });
    validateDatabaseFileCheckpoint(fileCheckpoint, snapshot, now());
    const manifest = { schemaVersion: DATABASE_RECOVERY.manifestSchema, archive, snapshot,
      inventoryDigest: inventory.inventoryDigest, fileCheckpoint,
      fileManifest: { key: `manifests/${fileCheckpoint.manifestSha256}.json`, sha256: fileCheckpoint.manifestSha256, versionId: fileCheckpoint.manifestVersionId },
      dump: { key: dumpStored.key, versionId: dumpStored.versionId, sha256: content.sha256, size: content.size,
        format: "postgresql-custom", subprocessExitCode: 0 },
      roles: { key: rolesStored.key, versionId: rolesStored.versionId, sha256: rolesStored.checksumSha256, size: rolesStored.size,
        roleCount: rolesMetadata.roles.length, membershipCount: rolesMetadata.memberships.length, passwordsIncluded: false },
      watermark: fileCheckpoint.sourceStartedAt, createdAt: new Date(now()).toISOString(),
      serviceRecoveryComplete: false, readinessUpdated: false };
    const digest = canonicalSha256(manifest);
    validateDatabaseManifest(manifest, digest);
    const bytes = canonicalBytes(manifest);
    const stored = await clock.wait(() => destination.putDatabaseManifest({ body: bytes, digest, signal: clock.signal }), "MANIFEST_PUBLISH_FAILED");
    validateDatabaseStoredObject(stored, { archive, key: `database/manifests/${digest}.json`, sha256: digest, size: bytes.byteLength });
    validateDatabaseSnapshot(snapshot, { releaseSha, now: now() });
    validateDatabaseFileCheckpoint(fileCheckpoint, snapshot, now());
    return { status: "DATABASE_CHECKPOINT_ARCHIVED", manifest, manifestSha256: digest, manifestVersionId: stored.versionId,
      serviceRecoveryComplete: false, readinessUpdated: false };
  } catch (error) {
    if (error instanceof DatabaseRecoveryError) throw error;
    fail("FAILED");
  } finally {
    clock.close();
    dumpStream?.cancel();
    // Abort propagates to every adapter. Cleanup cannot extend the run indefinitely.
    if (!closed && typeof handle?.close === "function") Promise.resolve(close()).catch(() => {});
  }
}

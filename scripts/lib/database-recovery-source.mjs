import { createHash } from "node:crypto";
import { buildRecoveryInventory } from "./protected-recovery-source.mjs";
import { RECOVERY_BUCKETS, RECOVERY_PROJECT, RECOVERY_LIMITS, recoveryKeySchema, recoveryCanonicalSha256 } from "./protected-recovery-protocol.mjs";

// Database-only workflow records have no storage paths. Check their existence
// separately from the file-reference graph; pg_dump still covers all tables.
export const DATABASE_RECOVERY_REQUIRED_TABLES = Object.freeze([
  "ap_material_draft_jobs", "ap_material_draft_versions", "ap_material_draft_policies", "ap_material_draft_runtime",
  "ap_material_draft_attempts", "ap_material_draft_members", "ap_material_draft_permits",
  "ap_material_draft_reconciliations", "ap_material_draft_observations", "ap_material_rule_revalidations",
]);
export const DATABASE_RECOVERY_SOURCE = Object.freeze({
  projectRef: RECOVERY_PROJECT, schemaVersion: "202610250094", user: "applypack_recovery_exporter",
  schemas: ["public", "auth", "storage", "supabase_migrations"], maximumDumpBytes: 128 * 1024 * 1024,
  maximumRoles: 4096, maximumMemberships: 16384,
});
const fail = (code) => { throw new Error(`DATABASE_RECOVERY_SOURCE_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const iso = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u.test(value) && Number.isFinite(Date.parse(value));
const oid = (value) => Number.isSafeInteger(value) && value > 0 && value <= 4294967295;
const safeName = (value) => typeof value === "string" && value.length > 0 && value.length <= 63 && !/[\x00-\x1f\x7f]/u.test(value);
const snapshotId = (value) => typeof value === "string" && /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[1-9][0-9]{0,9}$/u.test(value);
export const databaseSnapshotIdentifierValid = snapshotId;

// Official image metadata is not a libpq connection input. None of these values
// is copied into the minimal child environment used by the pinned clients.
export const databaseImageMetadata = (name) => ["PG_MAJOR", "PG_VERSION", "PGDATA"].includes(name);

/** A separate recurring registration. Migration-target approval is deliberately not accepted. */
export function validateDatabaseRecoveryConfiguration({ registry, runtime, environment = process.env }) {
  requireValue(environment.APP_DATABASE_BACKUP_ENABLED === "true" && environment.APP_DEPLOYMENT_ENV === "production", "DISABLED");
  requireValue(exact(registry, ["version", "targets"]) && registry.version === 1 && Array.isArray(registry.targets)
    && registry.targets.length <= 10 && hash(environment.APP_DATABASE_BACKUP_REGISTRY_SHA256)
    && recoveryCanonicalSha256(registry) === environment.APP_DATABASE_BACKUP_REGISTRY_SHA256, "REGISTRY");
  const matches = registry.targets.filter((entry) => entry?.id === environment.APP_DATABASE_BACKUP_TARGET_ID);
  requireValue(matches.length === 1, "TARGET_UNREGISTERED");
  const target = matches[0];
  requireValue(exact(target, ["id", "sourceProjectRef", "host", "port", "database", "user", "caSha256", "schemaVersion", "runtimeManifestSha256"])
    && /^[a-z][a-z0-9-]{1,63}$/u.test(target.id) && target.sourceProjectRef === RECOVERY_PROJECT
    && target.host === `db.${RECOVERY_PROJECT}.supabase.co` && target.port === 5432 && target.database === "postgres"
    && target.user === DATABASE_RECOVERY_SOURCE.user && target.schemaVersion === DATABASE_RECOVERY_SOURCE.schemaVersion
    && hash(target.caSha256) && hash(target.runtimeManifestSha256), "TARGET_IDENTITY");
  requireValue(exact(runtime, ["schemaVersion", "postgresMajor", "clientVersion", "baseImageDigest", "psqlSha256", "pgDumpSha256"])
    && runtime.schemaVersion === "applypack-database-recovery-runtime-v1" && runtime.postgresMajor === 17
    && /^17\.[1-9][0-9]*$/u.test(runtime.clientVersion) && /^sha256:[a-f0-9]{64}$/u.test(runtime.baseImageDigest)
    && hash(runtime.psqlSha256) && hash(runtime.pgDumpSha256)
    && recoveryCanonicalSha256(runtime) === target.runtimeManifestSha256, "RUNTIME_MANIFEST");
  requireValue(/^[a-f0-9]{40}$/u.test(environment.APP_EXPECTED_RELEASE_SHA || ""), "RELEASE");
  for (const [name, value] of Object.entries(environment)) if (value) {
    requireValue((databaseImageMetadata(name) || !/^(?:PG[A-Z_]*|DATABASE_URL|DIRECT_URL|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS)$/iu.test(name))
      && !/^(?:NEXT_PUBLIC_)?SUPABASE_.*(?:KEY|SECRET|PASSWORD|TOKEN|DATABASE|CONNECTION)/iu.test(name), "AMBIENT_CONNECTION");
  }
  return Object.freeze({ ...target, runtime: Object.freeze({ ...runtime }), releaseSha: environment.APP_EXPECTED_RELEASE_SHA,
    registrySha256: environment.APP_DATABASE_BACKUP_REGISTRY_SHA256 });
}

function inspectSource(value, configuration, now) {
  requireValue(exact(value, ["currentUser", "sessionUser", "database", "readOnly", "isolation", "serverVersionNum", "startedAt", "snapshotId",
    "schemaVersion", "schemas", "superuser", "createRole", "createDb", "replication", "bypassRls", "unreadableTables", "unreadableSequences",
    "foreignTables", "missingRequiredTables", "overlayReadable", "writableTables", "writableSequences", "writableSchemas", "databaseCreate", "unexpectedRoleMemberships", "unexpectedDefinerFunctions"]), "INSPECTION");
  requireValue(value.currentUser === configuration.user && value.sessionUser === configuration.user && value.database === configuration.database
    && value.readOnly === "on" && value.isolation === "repeatable read" && value.superuser === false && value.createRole === false
    && value.createDb === false && value.replication === false && value.bypassRls === true
    && value.writableTables === 0 && value.writableSequences === 0 && value.writableSchemas === 0 && value.databaseCreate === false
    && value.unexpectedRoleMemberships === 0 && value.unexpectedDefinerFunctions === 0, "READ_ROLE");
  requireValue(Number.isInteger(value.serverVersionNum) && value.serverVersionNum >= 170000 && value.serverVersionNum < 180000
    && value.schemaVersion === configuration.schemaVersion && Array.isArray(value.schemas)
    && [...value.schemas].sort().join("|") === [...DATABASE_RECOVERY_SOURCE.schemas].sort().join("|")
    && value.missingRequiredTables === 0 && value.unreadableTables === 0 && value.unreadableSequences === 0 && value.foreignTables === 0 && value.overlayReadable === true, "COVERAGE");
  requireValue(snapshotId(value.snapshotId) && iso(value.startedAt) && Date.parse(value.startedAt) <= now
    && now - Date.parse(value.startedAt) <= RECOVERY_LIMITS.runMilliseconds, "SNAPSHOT");
  return { sourceProjectRef: RECOVERY_PROJECT, releaseSha: configuration.releaseSha, schemaVersion: configuration.schemaVersion,
    startedAt: value.startedAt, postgresVersion: `17.${value.serverVersionNum % 10000}`, pgDumpVersion: configuration.runtime.clientVersion,
    snapshotId: value.snapshotId, coverage: { schemas: [...DATABASE_RECOVERY_SOURCE.schemas], allTablesReadable: true, rowSecurityBypass: true,
      roleDefinitionsIncluded: true, rolePasswordsIncluded: false, providerConfigurationIncluded: false } };
}

function inspectCheckpoint(record, snapshot) {
  const value = record?.summary;
  requireValue(exact(record, ["task_name", "last_succeeded_at", "summary"]) && record.task_name === "protected_recovery"
    && exact(value, ["schemaVersion", "sourceEnvironment", "sourceProjectRef", "releaseSha", "sourceStartedAt", "completedAt", "inventoryDigest",
      "manifestSha256", "manifestVersionId", "objectCount", "referenceCount", "tombstoneCount"])
    && value.schemaVersion === "applypack-protected-recovery-checkpoint-v1" && value.sourceEnvironment === "production"
    && value.sourceProjectRef === RECOVERY_PROJECT && value.releaseSha === snapshot.releaseSha
    && iso(value.sourceStartedAt) && iso(value.completedAt) && Date.parse(record.last_succeeded_at) === Date.parse(value.sourceStartedAt)
    && Date.parse(value.sourceStartedAt) <= Date.parse(value.completedAt) && Date.parse(value.completedAt) <= Date.parse(snapshot.startedAt)
    && Date.parse(snapshot.startedAt) - Date.parse(value.sourceStartedAt) <= RECOVERY_LIMITS.runMilliseconds
    && hash(value.inventoryDigest) && hash(value.manifestSha256) && typeof value.manifestVersionId === "string"
    && /^[A-Za-z0-9._~+/=:-]{1,1024}$/u.test(value.manifestVersionId) && value.manifestVersionId !== "null"
    && [value.objectCount, value.referenceCount, value.tombstoneCount].every((count) => Number.isSafeInteger(count) && count >= 0 && count <= RECOVERY_LIMITS.references), "ACKNOWLEDGED_CHECKPOINT");
  return value;
}

function inspectRoles(value, snapshot) {
  requireValue(exact(value, ["roles", "memberships"]) && Array.isArray(value.roles) && value.roles.length > 0
    && value.roles.length <= DATABASE_RECOVERY_SOURCE.maximumRoles && Array.isArray(value.memberships)
    && value.memberships.length <= DATABASE_RECOVERY_SOURCE.maximumMemberships, "ROLES");
  const seen = new Set(); const names = new Set();
  for (const role of value.roles) {
    requireValue(exact(role, ["oid", "name", "superuser", "inherit", "createRole", "createDatabase", "canLogin", "replication", "bypassRls", "connectionLimit", "validUntil"])
      && oid(role.oid) && safeName(role.name) && !seen.has(role.oid) && !names.has(role.name)
      && [role.superuser, role.inherit, role.createRole, role.createDatabase, role.canLogin, role.replication, role.bypassRls].every((entry) => typeof entry === "boolean")
      && Number.isInteger(role.connectionLimit) && role.connectionLimit >= -1
      && (role.validUntil === null || ["infinity", "-infinity"].includes(role.validUntil) || iso(role.validUntil)), "ROLE_DEFINITION");
    seen.add(role.oid); names.add(role.name);
  }
  const memberships = new Set();
  for (const entry of value.memberships) {
    const key = `${entry.roleOid}:${entry.memberOid}:${entry.grantorOid}`;
    requireValue(exact(entry, ["roleOid", "memberOid", "grantorOid", "adminOption", "inheritOption", "setOption"])
      && [entry.roleOid, entry.memberOid, entry.grantorOid].every((id) => oid(id) && seen.has(id))
      && [entry.adminOption, entry.inheritOption, entry.setOption].every((item) => typeof item === "boolean")
      && !memberships.has(key), "ROLE_MEMBERSHIP");
    memberships.add(key);
  }
  return { schemaVersion: "applypack-database-roles-metadata-v1", sourceProjectRef: RECOVERY_PROJECT,
    releaseSha: snapshot.releaseSha, snapshotId: snapshot.snapshotId, ...value };
}

async function snapshotReader(session, signal) {
  const objects = new Map(); let cursor = null;
  for (;;) {
    const page = await session.query("objects", { cursor }, signal);
    requireValue(Array.isArray(page) && page.length <= 250, "STORAGE_PAGE");
    for (const entry of page) {
      requireValue(exact(entry, ["id", "bucket_id", "name", "version", "size"]) && typeof entry.id === "string"
        && /^[a-f0-9-]{36}$/u.test(entry.id) && RECOVERY_BUCKETS.includes(entry.bucket_id) && recoveryKeySchema.safeParse(entry.name).success
        && typeof entry.version === "string" && entry.version.length > 0 && entry.version.length <= 256
        && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= RECOVERY_LIMITS.objectBytes, "STORAGE_VERSION_MAPPING");
      const key = `${entry.bucket_id}\u0000${entry.name}`;
      requireValue(!objects.has(key) && (cursor === null || Buffer.compare(Buffer.from(key), Buffer.from(`${cursor.bucket}\u0000${cursor.key}`)) > 0), "STORAGE_ORDER");
      objects.set(key, entry); cursor = { bucket: entry.bucket_id, key: entry.name };
      requireValue(objects.size <= RECOVERY_LIMITS.objects, "STORAGE_LIMIT");
    }
    if (page.length < 250) break;
  }
  return {
    retentionOverlay: async () => ({ data: await session.query("overlay", {}, signal) }),
    listBuckets: async () => ({ data: await session.query("buckets", {}, signal) }),
    tablePage: async (table, cursor) => ({ data: await session.query("table", { table, cursor }, signal) }),
    listObjects: async (bucket, prefix, offset) => {
      const list = new Map(); const base = prefix ? `${prefix}/` : "";
      for (const entry of objects.values()) {
        if (entry.bucket_id !== bucket || !entry.name.startsWith(base)) continue;
        const remainder = entry.name.slice(base.length); const slash = remainder.indexOf("/");
        const name = slash < 0 ? remainder : remainder.slice(0, slash);
        const value = slash < 0 ? { name, id: entry.id, metadata: { size: entry.size } } : { name, id: null, metadata: null };
        requireValue(!list.has(name) || list.get(name).id === value.id, "STORAGE_PREFIX_COLLISION");
        list.set(name, value);
      }
      return { data: [...list.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).slice(offset, offset + 100) };
    },
    objectInfo: async (bucket, key) => {
      const entry = objects.get(`${bucket}\u0000${key}`); requireValue(entry, "STORAGE_OBJECT_MISSING");
      return { data: { id: entry.id, bucketId: bucket, name: key, version: entry.version, size: entry.size } };
    },
  };
}

/** Holds one transaction until both the finite graph and dump have consumed its exported snapshot. */
export function createDatabaseSnapshotSource({ configuration, tools, now = Date.now }) {
  requireValue(configuration?.sourceProjectRef === RECOVERY_PROJECT && configuration.user === DATABASE_RECOVERY_SOURCE.user
    && configuration.host === `db.${RECOVERY_PROJECT}.supabase.co` && configuration.database === "postgres" && configuration.port === 5432
    && configuration.schemaVersion === DATABASE_RECOVERY_SOURCE.schemaVersion && /^17\.[1-9][0-9]*$/u.test(configuration.runtime?.clientVersion), "CONFIGURATION");
  return Object.freeze({ async openSnapshot({ releaseSha, signal }) {
    requireValue(releaseSha === configuration.releaseSha && signal instanceof AbortSignal && !signal.aborted, "OPEN_REQUEST");
    let session; let dump; let closed = false; let dumpOpened = false; let rejectDump;
    const close = async () => {
      if (closed) return; closed = true;
      rejectDump?.(new Error("DATABASE_RECOVERY_SOURCE_DUMP_INCOMPLETE"));
      try { await dump?.cancel?.(); } finally { await session?.close?.(); }
    };
    try {
      session = await tools.openSession({ signal });
      const snapshot = inspectSource(await session.query("inspect", {}, signal), configuration, now());
      const fileCheckpoint = inspectCheckpoint(await session.query("checkpoint", {}, signal), snapshot);
      const rolesMetadata = inspectRoles(await session.query("roles", {}, signal), snapshot);
      const reader = await snapshotReader(session, signal);
      const inventory = await buildRecoveryInventory({ reader, releaseSha, now,
        signReceipt: () => `postgres-exported-snapshot-v1:${recoveryCanonicalSha256(snapshot)}` });
      requireValue(inventory.inventoryDigest === fileCheckpoint.inventoryDigest && inventory.counts.objects === fileCheckpoint.objectCount
        && inventory.counts.references === fileCheckpoint.referenceCount && inventory.counts.tombstones === fileCheckpoint.tombstoneCount, "SNAPSHOT_FILE_GRAPH_MISMATCH");
      requireValue(now() - Date.parse(snapshot.startedAt) <= RECOVERY_LIMITS.runMilliseconds, "SNAPSHOT_EXPIRED");
      return Object.freeze({ snapshot, inventory, rolesMetadata, fileCheckpoint, close,
        async openDump({ signal: dumpSignal }) {
          requireValue(!closed && !dumpOpened && dumpSignal instanceof AbortSignal && !dumpSignal.aborted, "DUMP_STATE");
          requireValue(now() - Date.parse(snapshot.startedAt) <= RECOVERY_LIMITS.runMilliseconds, "SNAPSHOT_EXPIRED");
          dumpOpened = true; dump = await tools.openDump({ snapshotId: snapshot.snapshotId, signal: dumpSignal });
          requireValue(dump?.body && typeof dump.body[Symbol.asyncIterator] === "function" && dump.completed instanceof Promise, "DUMP_ADAPTER");
          let resolve; let reject; let finished = false;
          const completed = new Promise((yes, no) => { resolve = yes; reject = no; }); completed.catch(() => {});
          rejectDump = reject; dump.completed.catch(() => {});
          const body = (async function* () {
            const digest = createHash("sha256"); let bytes = 0;
            try {
              for await (const chunk of dump.body) {
                requireValue(!closed && !dumpSignal.aborted && now() - Date.parse(snapshot.startedAt) <= RECOVERY_LIMITS.runMilliseconds, "DUMP_EXPIRED");
                requireValue(chunk instanceof Uint8Array && chunk.byteLength > 0, "DUMP_BYTES");
                bytes += chunk.byteLength; requireValue(bytes <= DATABASE_RECOVERY_SOURCE.maximumDumpBytes, "DUMP_LIMIT");
                digest.update(chunk); yield chunk;
              }
              requireValue(bytes > 0, "EMPTY_DUMP"); await dump.completed; finished = true; rejectDump = null;
              resolve({ bytes, sha256: digest.digest("hex") });
            } catch (error) { reject(error); throw error; }
            finally { if (!finished) { reject(new Error("DATABASE_RECOVERY_SOURCE_DUMP_INCOMPLETE")); await dump.cancel?.(); } }
          })();
          return { body, completed };
        },
      });
    } catch (error) {
      await close();
      if (/^(?:DATABASE_RECOVERY_SOURCE|DATABASE_RECOVERY_PG|PROTECTED_RECOVERY)_[A-Z_]+$/u.test(error?.message || "")) throw error;
      fail("SNAPSHOT_READ_FAILED");
    }
  } });
}

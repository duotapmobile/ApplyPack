// Executed only by test-database-recovery-image.mjs inside its disposable,
// network-none container. No production entrypoint imports this fixture.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { runDatabaseRecovery } from "./run-database-recovery.mjs";
import { createPinnedPostgresTools } from "./lib/database-recovery-pg-tools.mjs";
import { createDatabaseRecoveryS3Transport } from "./lib/database-recovery-s3.mjs";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, RECOVERY_PROJECT, recoveryInventoryDigest } from "./lib/protected-recovery-protocol.mjs";
import { DATABASE_RECOVERY_REQUIRED_TABLES } from "./lib/database-recovery-source.mjs";
import { recoverySourceColumns } from "./lib/protected-recovery-source.mjs";
import { canonicalBytes, canonicalSha256, sha256 } from "./lib/protected-recovery-core.mjs";
import { validateDatabaseManifest } from "./lib/database-recovery-protocol.mjs";

assert.equal(process.platform, "linux"); assert.equal(process.getuid(), 65534);
assert.equal(process.env.AP_DATABASE_RECOVERY_OFFLINE_SMOKE, "synthetic-network-none");
for (const [name, value] of Object.entries(process.env)) if (value) {
  assert(!/^(?:AWS_|SUPABASE_|APP_DATABASE_BACKUP_(?!ENABLED$)|PGPASSWORD|DATABASE_URL)/u.test(name), "provider credentials forbidden");
}
const runtime = JSON.parse(await readFile("/opt/applypack/database-recovery-runtime.json", "utf8"));
const bin = "/usr/lib/postgresql/17/bin/";
const root = await mkdtemp("/tmp/applypack-database-image-");
const data = `${root}/data`; const socket = root;
const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: "/tmp", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" };
const execute = (name, args, input) => execFileSync(`${bin}${name}`, args,
  { env, input, stdio: ["pipe", "pipe", "pipe"], timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
const sql = (statement, database = "postgres") => execute("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
  "-h", socket, "-U", "fixture_admin", "-d", database], statement).toString("utf8").trim();
const releaseSha = "a".repeat(40);
const ca = Buffer.from("-----BEGIN CERTIFICATE-----\nU1lOVEhFVElDLVRFU1QtQ0E=\n-----END CERTIFICATE-----\n");
const archive = { bucket: "applypack-production-protected-recovery-838445019912",
  kmsKeyArn: "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111" };
let started = false; let destinationClosed = 0; let dump; let receipt;
try {
  execute("initdb", ["-D", data, "-U", "fixture_admin", "--auth-local=trust", "--auth-host=reject", "--encoding=UTF8", "--no-locale"]);
  execute("pg_ctl", ["-D", data, "-l", `${root}/postgres.log`, "-w", "start", "-o",
    `-k ${socket} -h '' -c max_connections=12 -c shared_buffers=16MB -c unix_socket_permissions=0700`]);
  started = true;
  const overlay = { schemaVersion: "applypack-service-retention-overlay-v1", policyVersion: "one_off_30d_v1",
    sourceWatermark: "1970-01-01T00:00:00Z", orders: [], holds: [], objectTombstones: [], objectPolicies: [] };
  const inventory = { schemaVersion: "applypack-protected-recovery-inventory-v2", sourceEnvironment: "production",
    sourceProjectRef: RECOVERY_PROJECT, releaseSha, startedAt: new Date(Date.now() - 1000).toISOString(),
    completedAt: new Date(Date.now() - 900).toISOString(), buckets: [...RECOVERY_BUCKETS], objects: [], references: [], tombstones: [],
    serviceRetention: overlay, counts: { objects: 0, references: 0, tombstones: 0,
      tables: Object.fromEntries(RECOVERY_TABLES.map((table) => [table, table === "intakes" ? 1 : 0])) }, receipt: "x".repeat(128) };
  inventory.inventoryDigest = recoveryInventoryDigest(inventory);
  const fileManifest = { schemaVersion: "applypack-protected-recovery-manifest-v1", archive, inventory, secondInventoryReceipt: "y".repeat(128),
    watermark: inventory.startedAt, createdAt: new Date(Date.now() - 800).toISOString(), previousManifestDigest: null, entries: [] };
  const fileBytes = canonicalBytes(fileManifest); const fileDigest = sha256(fileBytes);
  const checkpoint = { schemaVersion: "applypack-protected-recovery-checkpoint-v1", sourceEnvironment: "production",
    sourceProjectRef: RECOVERY_PROJECT, releaseSha, sourceStartedAt: inventory.startedAt, completedAt: new Date(Date.now() - 700).toISOString(),
    inventoryDigest: inventory.inventoryDigest, manifestSha256: fileDigest, manifestVersionId: "synthetic-file-version",
    objectCount: 0, referenceCount: 0, tombstoneCount: 0 };
  const statements = [
    "CREATE ROLE applypack_recovery_exporter LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;",
    "GRANT pg_read_all_data TO applypack_recovery_exporter; REVOKE CREATE ON SCHEMA public FROM PUBLIC;",
    "CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA supabase_migrations;",
    "CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY); INSERT INTO supabase_migrations.schema_migrations VALUES('202610250095');",
    "CREATE TABLE storage.buckets(id text,name text,public boolean); CREATE TABLE storage.objects(id uuid,bucket_id text,name text,version text,metadata jsonb);",
    ...RECOVERY_BUCKETS.map((bucket) => `INSERT INTO storage.buckets VALUES('${bucket}','${bucket}',false);`),
    ...RECOVERY_TABLES.map((table) => `CREATE TABLE public.${table}(${recoverySourceColumns[table].split(",").map((column) => `${column} text`).join(",")});`),
    ...DATABASE_RECOVERY_REQUIRED_TABLES.map((table) => `CREATE TABLE public.${table}(id uuid PRIMARY KEY,receipt_sha256 text);`),
    "INSERT INTO public.ap_material_rule_revalidations VALUES('22222222-2222-4222-8222-222222222222',repeat('b',64));",
    "INSERT INTO public.intakes(id,resume_path,cover_letter_path,source_deleted_at,source_retention_due_at) VALUES('11111111-1111-4111-8111-111111111111',null,null,null,null);",
    "CREATE TABLE public.operational_heartbeats(task_name text,last_succeeded_at timestamptz,summary jsonb);",
    `INSERT INTO public.operational_heartbeats VALUES('protected_recovery','${inventory.startedAt}','${JSON.stringify(checkpoint)}');`,
    `CREATE FUNCTION public.ap_export_service_retention_overlay() RETURNS jsonb LANGUAGE sql AS $$ SELECT '${JSON.stringify(overlay)}'::jsonb $$;`,
    "CREATE TABLE public.synthetic_private(id integer PRIMARY KEY,body text); ALTER TABLE public.synthetic_private ENABLE ROW LEVEL SECURITY; ALTER TABLE public.synthetic_private FORCE ROW LEVEL SECURITY;",
    "INSERT INTO public.synthetic_private VALUES(1,'fictional private fixture');",
    "CREATE TABLE auth.synthetic_identity(id integer PRIMARY KEY,body text); INSERT INTO auth.synthetic_identity VALUES(1,'fictional auth fixture');",
  ];
  sql(statements.join("\n"));
  const target = { id: "synthetic-image-export", sourceProjectRef: RECOVERY_PROJECT, host: `db.${RECOVERY_PROJECT}.supabase.co`,
    port: 5432, database: "postgres", user: "applypack_recovery_exporter", caSha256: sha256(ca), schemaVersion: "202610250095",
    runtimeManifestSha256: canonicalSha256(runtime) };
  const registry = { version: 1, targets: [target] };
  const environment = { APP_DATABASE_BACKUP_ENABLED: "true", APP_DEPLOYMENT_ENV: "production", APP_EXPECTED_RELEASE_SHA: releaseSha,
    RAILWAY_GIT_COMMIT_SHA: releaseSha, APP_DATABASE_BACKUP_TARGET_ID: target.id, APP_DATABASE_BACKUP_REGISTRY_SHA256: canonicalSha256(registry),
    APP_DATABASE_BACKUP_DB_PASSWORD: "synthetic-fixture-password", APP_DATABASE_BACKUP_DB_CA_PEM_BASE64: ca.toString("base64"),
    PG_MAJOR: process.env.PG_MAJOR, PG_VERSION: process.env.PG_VERSION, PGDATA: process.env.PGDATA };
  const writes = [];
  const destination = createDatabaseRecoveryS3Transport({ archive, client: {
    async send(command) {
      const reading = command.constructor.name === "GetObjectCommand";
      const bytes = reading ? fileBytes : Buffer.from(command.input.Body);
      if (!reading) writes.push({ key: command.input.Key, bytes });
      return { Body: Readable.from([bytes]), ContentLength: bytes.length, ServerSideEncryption: "aws:kms", SSEKMSKeyId: archive.kmsKeyArn,
        ChecksumSHA256: Buffer.from(sha256(bytes), "hex").toString("base64"), VersionId: reading ? "synthetic-file-version" : `synthetic-${writes.length}` };
    }, destroy() { destinationClosed++; },
  } });
  receipt = await runDatabaseRecovery(environment, { readConfiguration: async (file) => typeof file === "string" ? runtime : registry,
    validateArchive: () => archive, certificateStatus: () => ({}), createDestination: () => destination,
    createTools(input) {
      // The fixed production clients, framing and SQL run unchanged. This test-only
      // process adapter replaces the fixed host with the disposable Unix socket.
      const tools = createPinnedPostgresTools({ ...input, spawnImpl(binary, args, options) {
        const local = [...args]; const host = local.indexOf("--host");
        if (host >= 0) { assert.equal(local[host + 1], target.host); local[host + 1] = socket; }
        return spawn(binary, local, { ...options, env: { ...options.env, PGSSLMODE: "disable" } });
      } });
      return { ...tools, async openDump(input) {
        sql("INSERT INTO public.synthetic_private VALUES(2,'concurrent fictional change');");
        return tools.openDump(input);
      } };
    },
  });
  assert.equal(receipt.status, "DATABASE_CHECKPOINT_ARCHIVED"); assert.equal(destinationClosed, 1);
  assert.equal(writes.length, 3); dump = writes[0].bytes;
  assert.equal(dump.subarray(0, 5).toString(), "PGDMP");
  const manifest = JSON.parse(writes[2].bytes); validateDatabaseManifest(manifest, receipt.manifestSha256);
  assert.equal(manifest.dump.sha256, sha256(dump));
  assert.equal(manifest.roles.sha256, sha256(writes[1].bytes));
  assert.equal(JSON.parse(writes[1].bytes).roles.some((role) => role.name === "applypack_recovery_exporter"), true);
  assert.equal(sql("SELECT count(*) FROM public.synthetic_private;"), "2");
  sql("CREATE DATABASE recovered;");
  execute("pg_restore", ["--exit-on-error", "--single-transaction", "-h", socket, "-U", "fixture_admin", "-d", "recovered"], dump);
  assert.equal(sql("SELECT count(*) FROM public.synthetic_private;", "recovered"), "1");
  assert.equal(sql("SELECT body FROM public.synthetic_private WHERE id=1;", "recovered"), "fictional private fixture");
  assert.equal(sql("SELECT body FROM auth.synthetic_identity WHERE id=1;", "recovered"), "fictional auth fixture");
  assert.equal(sql("SELECT receipt_sha256 FROM public.ap_material_rule_revalidations;", "recovered"), "b".repeat(64));
  assert.equal(sql("SELECT count(*) FROM storage.buckets;", "recovered"), String(RECOVERY_BUCKETS.length));
  assert.equal(sql("SELECT count(*) FROM public.intakes WHERE resume_path IS NULL AND cover_letter_path IS NULL;", "recovered"), "1");
  assert.equal(sql("SELECT max(version) FROM supabase_migrations.schema_migrations;", "recovered"), "202610250095");
  assert.equal(sql("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.synthetic_private'::regclass;", "recovered"), "t");
  assert.equal(sql("SELECT count(*) FROM pg_stat_activity WHERE usename='applypack_recovery_exporter';"), "0");
} finally {
  dump?.fill(0); ca.fill(0);
  if (started) execute("pg_ctl", ["-D", data, "-w", "stop", "-m", "immediate"]);
}
console.log(JSON.stringify({ status: "PASS", scope: "synthetic-real-postgres-snapshot-round-trip", clientVersion: runtime.clientVersion,
  sameSnapshotUnderConcurrentWrite: true, rlsRowsPreserved: true, authAndStorageAndLedgerPreserved: true,
  archiveManifestBound: true, heldSessionsClosed: true, providerCalls: 0, hostedRestoreProven: false,
  serviceRecoveryComplete: false, readinessUpdated: false }));

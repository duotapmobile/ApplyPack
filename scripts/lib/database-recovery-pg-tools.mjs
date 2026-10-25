import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile, mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { recoverySourceColumns } from "./protected-recovery-source.mjs";
import { RECOVERY_BUCKETS, RECOVERY_TABLES, recoveryKeySchema } from "./protected-recovery-protocol.mjs";
import { DATABASE_RECOVERY_SOURCE, databaseSnapshotIdentifierValid } from "./database-recovery-source.mjs";

export const DATABASE_POSTGRES_PATHS = Object.freeze({ psql: "/usr/lib/postgresql/17/bin/psql", pgDump: "/usr/lib/postgresql/17/bin/pg_dump" });
const fail = (code) => { throw new Error(`DATABASE_RECOVERY_PG_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
const timestamp = (column) => `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const orderedJson = (query) => `select coalesce(json_agg(q),'[]'::json) from (${query}) q;`;
const applicationRelations = "from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'";

/** Only these finite metadata operations exist. No caller-provided SQL or identifier is executed. */
export function databaseSnapshotQuery(operation, input = {}) {
  if (operation === "inspect") return `select json_build_object(
    'currentUser',current_user,'sessionUser',session_user,'database',current_database(),
    'readOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),
    'serverVersionNum',current_setting('server_version_num')::integer,'startedAt',${timestamp("transaction_timestamp()")},
    'snapshotId',pg_export_snapshot(),'schemaVersion',(select max(version) from supabase_migrations.schema_migrations),
    'schemas',(select coalesce(json_agg(nspname order by nspname),'[]'::json) from pg_namespace where nspname in ('public','auth','storage','supabase_migrations')),
    'superuser',r.rolsuper,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'replication',r.rolreplication,'bypassRls',r.rolbypassrls,
    'unreadableTables',(select count(*) ${applicationRelations} and c.relkind in ('r','p','m') and not has_table_privilege(current_user,c.oid,'SELECT')),
    'unreadableSequences',(select count(*) ${applicationRelations} and c.relkind='S' and not has_sequence_privilege(current_user,c.oid,'SELECT')),
    'writableTables',(select count(*) ${applicationRelations} and c.relkind in ('r','p','m','v') and has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
    'writableSequences',(select count(*) ${applicationRelations} and c.relkind='S' and has_sequence_privilege(current_user,c.oid,'UPDATE')),
    'writableSchemas',(select count(*) from pg_namespace n where n.nspname not like 'pg_%' and n.nspname <> 'information_schema' and has_schema_privilege(current_user,n.oid,'CREATE')),
    'databaseCreate',has_database_privilege(current_user,current_database(),'CREATE'),
    'unexpectedRoleMemberships',(select count(*) from pg_roles x where x.rolname not in (current_user,'pg_read_all_data') and pg_has_role(current_user,x.oid,'MEMBER')),
    'unexpectedDefinerFunctions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.prosecdef and has_function_privilege(current_user,p.oid,'EXECUTE')
      and p.oid <> 'public.ap_export_service_retention_overlay()'::regprocedure),
    'foreignTables',(select count(*) ${applicationRelations} and c.relkind='f'),
    'overlayReadable',has_function_privilege(current_user,'public.ap_export_service_retention_overlay()','EXECUTE'))
    from pg_roles r where r.rolname=current_user;`;
  if (operation === "checkpoint") return `select row_to_json(q) from (
    select task_name,last_succeeded_at,summary from public.operational_heartbeats where task_name='protected_recovery') q;`;
  if (operation === "roles") return `select json_build_object('roles',(
    select coalesce(json_agg(q),'[]'::json) from (select oid::bigint as oid,rolname as name,rolsuper as superuser,rolinherit as inherit,
      rolcreaterole as "createRole",rolcreatedb as "createDatabase",rolcanlogin as "canLogin",rolreplication as replication,
      rolbypassrls as "bypassRls",rolconnlimit as "connectionLimit",
      case when rolvaliduntil is null then null when rolvaliduntil::text in ('infinity','-infinity') then rolvaliduntil::text
        else ${timestamp("rolvaliduntil")} end as "validUntil" from pg_roles order by oid limit 4097) q),
    'memberships',(select coalesce(json_agg(q),'[]'::json) from (select roleid::bigint as "roleOid",member::bigint as "memberOid",
      grantor::bigint as "grantorOid",admin_option as "adminOption",inherit_option as "inheritOption",set_option as "setOption"
      from pg_auth_members order by roleid,member,grantor limit 16385) q));`;
  if (operation === "overlay") return "select public.ap_export_service_retention_overlay();";
  if (operation === "buckets") return orderedJson("select id,name,public from storage.buckets order by id limit 5");
  if (operation === "objects") {
    let where = "";
    if (input.cursor !== null) {
      requireValue(input.cursor && RECOVERY_BUCKETS.includes(input.cursor.bucket) && recoveryKeySchema.safeParse(input.cursor.key).success, "OBJECT_CURSOR");
      where = `where (bucket_id collate "C",name collate "C") > (${literal(input.cursor.bucket)},${literal(input.cursor.key)})`;
    }
    return orderedJson(`select id::text,bucket_id,name,version::text,(metadata->>'size')::bigint as size from storage.objects ${where}
      order by bucket_id collate "C",name collate "C" limit 250`);
  }
  if (operation === "table") {
    requireValue(RECOVERY_TABLES.includes(input.table) && (input.cursor === null || uuid(input.cursor)), "TABLE_REQUEST");
    const key = input.table === "ap_unpaid_source_cleanup" ? "document_id" : "id";
    return orderedJson(`select ${recoverySourceColumns[input.table]} from public.${input.table}
      ${input.cursor === null ? "" : `where ${key} > ${literal(input.cursor)}::uuid`} order by ${key} limit 250`);
  }
  fail("OPERATION_FORBIDDEN");
}

const clientArguments = (configuration) => ["--no-password", "--host", configuration.host, "--port", String(configuration.port),
  "--username", configuration.user, "--dbname", configuration.database];
const minimalEnvironment = (configuration, password, caPath) => ({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
  TZ: "UTC", HOME: "/nonexistent", PGPASSWORD: password.toString("utf8"), PGSSLMODE: "verify-full", PGSSLROOTCERT: caPath,
  PGCONNECT_TIMEOUT: "10", PGAPPNAME: "applypack-database-recovery", PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000 -c TimeZone=UTC -c DateStyle=ISO,YMD" });

function observeExit(child) {
  const completion = new Promise((resolve, reject) => {
    child.once("error", () => reject(new Error("DATABASE_RECOVERY_PG_PROCESS_START")));
    child.once("close", (code, signal) => code === 0 && signal === null ? resolve() : reject(new Error("DATABASE_RECOVERY_PG_PROCESS_FAILED")));
  });
  completion.catch(() => {}); return completion;
}

async function endProcess(child, completion) {
  if (!child || child.exitCode !== null || child.signalCode) { await completion?.catch(() => {}); return; }
  child.kill("SIGTERM");
  let timer;
  try { await Promise.race([completion.catch(() => {}), new Promise((resolve) => { timer = setTimeout(resolve, 1000); })]); }
  finally { clearTimeout(timer); }
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
  let finalTimer;
  try {
    await Promise.race([completion.catch(() => {}), new Promise((_, reject) => {
      finalTimer = setTimeout(() => reject(new Error("DATABASE_RECOVERY_PG_PROCESS_CLEANUP_TIMEOUT")), 3000);
    })]);
  } finally { clearTimeout(finalTimer); }
}

/** Root-owned pinned clients only. Certificates are public and stored in a private, narrowly owned temporary directory. */
export function createPinnedPostgresTools({ configuration, password, caPemBase64, spawnImpl = spawn,
  filesystem = { lstat, readFile, mkdtemp, writeFile, chmod, rm }, temporaryRoot = tmpdir(), platform = process.platform }) {
  requireValue(platform === "linux", "PLATFORM");
  requireValue(configuration?.host === `db.${DATABASE_RECOVERY_SOURCE.projectRef}.supabase.co` && configuration.port === 5432
    && configuration.database === "postgres" && configuration.user === DATABASE_RECOVERY_SOURCE.user, "TARGET_IDENTITY");
  requireValue(Buffer.isBuffer(password) && password.length >= 16 && password.length <= 1024
    && !/[\x00\r\n]/u.test(password.toString("utf8")), "PASSWORD_INPUT");
  requireValue(typeof caPemBase64 === "string" && caPemBase64.length <= 65536 && /^[A-Za-z0-9+/]+={0,2}$/u.test(caPemBase64), "CA_INPUT");
  const certificate = Buffer.from(caPemBase64, "base64");
  requireValue(certificate.toString("base64") === caPemBase64 && sha256(certificate) === configuration.caSha256
    && /^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\r?\n?$/u.test(certificate.toString("ascii")), "CA_BINDING");
  let used = false; let directory; let caPath; let activeDump; let disposed = false; let cleanupPromise;
  const active = new Set();
  const cleanup = () => {
    disposed = true;
    cleanupPromise ||= (async () => {
    for (const entry of [...active]) await endProcess(entry.child, entry.completed);
    active.clear();
    if (directory) {
      const root = path.resolve(temporaryRoot); const resolved = path.resolve(directory);
      requireValue(path.dirname(resolved) === root && path.basename(resolved).startsWith("applypack-db-recovery-"), "CLEANUP_SCOPE");
      const info = await filesystem.lstat(resolved); requireValue(info.isDirectory() && !info.isSymbolicLink(), "CLEANUP_SCOPE");
      await filesystem.rm(resolved, { recursive: true, force: false }); directory = null;
    }
    certificate.fill(0);
    })();
    return cleanupPromise;
  };
  const start = (binary, args, signal) => {
    requireValue(!disposed && signal instanceof AbortSignal && !signal.aborted, "ABORTED");
    const env = minimalEnvironment(configuration, password, caPath);
    if (args.length === 1 && args[0] === "--version") delete env.PGPASSWORD;
    let child;
    try { child = spawnImpl(binary, args, { env, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); }
    finally { delete env.PGPASSWORD; }
    const completed = observeExit(child); const entry = { child, completed }; active.add(entry);
    const abort = () => { child.kill("SIGTERM"); };
    signal.addEventListener("abort", abort, { once: true });
    completed.finally(() => { active.delete(entry); signal.removeEventListener("abort", abort); }).catch(() => {});
    // Discard diagnostics: pg_dump/psql failures can contain private SQL and record values.
    let errors = 0;
    child.stderr.on("data", (bytes) => { errors += bytes.length; if (errors > 64 * 1024) child.kill("SIGTERM"); });
    return entry;
  };
  const verifyBinary = async (binary, digest, signal) => {
    const info = await filesystem.lstat(binary);
    requireValue(info.isFile() && !info.isSymbolicLink() && info.uid === 0 && (info.mode & 0o022) === 0 && info.size > 0 && info.size <= 32 * 1024 * 1024, "CLIENT_FILE");
    const bytes = await filesystem.readFile(binary); requireValue(sha256(bytes) === digest, "CLIENT_DIGEST");
    const { child, completed } = start(binary, ["--version"], signal); child.stdin.end();
    let output = "";
    for await (const chunk of child.stdout) { output += chunk.toString("utf8"); requireValue(output.length <= 512, "CLIENT_VERSION"); }
    await completed;
    const name = binary === DATABASE_POSTGRES_PATHS.psql ? "psql" : "pg_dump";
    const match = new RegExp(`^${name} \\(PostgreSQL\\) (17\\.[0-9]+)(?: \\([^\\r\\n]*\\))?\\r?\\n?$`, "u").exec(output);
    requireValue(match && match[1] === configuration.runtime.clientVersion, "CLIENT_VERSION");
  };
  return Object.freeze({
    dispose: cleanup,
    async openSession({ signal }) {
      requireValue(!used && !disposed, "SESSION_REUSE"); used = true;
      try {
        directory = await filesystem.mkdtemp(path.join(path.resolve(temporaryRoot), "applypack-db-recovery-"));
        await filesystem.chmod(directory, 0o700); caPath = path.join(directory, "ca.pem");
        await filesystem.writeFile(caPath, certificate, { mode: 0o600, flag: "wx" });
        await verifyBinary(DATABASE_POSTGRES_PATHS.psql, configuration.runtime.psqlSha256, signal);
        await verifyBinary(DATABASE_POSTGRES_PATHS.pgDump, configuration.runtime.pgDumpSha256, signal);
        const entry = start(DATABASE_POSTGRES_PATHS.psql, ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", ...clientArguments(configuration)], signal);
        const child = entry.child; let pending = null; let partial = ""; let ended = false; const decoder = new StringDecoder("utf8");
        const rejectPending = () => { if (pending) { clearTimeout(pending.timer); pending.reject(new Error("DATABASE_RECOVERY_PG_QUERY_FAILED")); pending = null; } };
        child.stdout.on("data", (chunk) => {
          partial += decoder.write(chunk);
          if (Buffer.byteLength(partial) > 16 * 1024 * 1024) { rejectPending(); child.kill("SIGTERM"); return; }
          for (;;) {
            const newline = partial.indexOf("\n"); if (newline < 0) break;
            const line = partial.slice(0, newline).replace(/\r$/u, ""); partial = partial.slice(newline + 1);
            if (!pending) { child.kill("SIGTERM"); return; }
            if (line === pending.marker) {
              const request = pending; pending = null; clearTimeout(request.timer);
              try { request.resolve(JSON.parse(request.lines.length === 0 ? "null" : request.lines.join("\n"))); }
              catch { request.reject(new Error("DATABASE_RECOVERY_PG_QUERY_RESPONSE")); }
            } else {
              pending.bytes += Buffer.byteLength(line); pending.lines.push(line);
              if (pending.bytes > 16 * 1024 * 1024) { rejectPending(); child.kill("SIGTERM"); return; }
            }
          }
        });
        entry.completed.finally(() => { ended = true; rejectPending(); }).catch(() => {});
        child.stdin.on("error", rejectPending);
        const query = async (operation, input, querySignal) => {
          requireValue(!ended && !pending && querySignal === signal && !signal.aborted, "QUERY_STATE");
          const sql = databaseSnapshotQuery(operation, input); const marker = `APDB_${randomBytes(24).toString("hex")}`;
          const answer = new Promise((resolve, reject) => {
            pending = { marker, resolve, reject, lines: [], bytes: 0, timer: setTimeout(() => { rejectPending(); child.kill("SIGTERM"); }, 30000) };
          });
          child.stdin.write(`${sql}\n\\echo ${marker}\n`, (error) => { if (error) rejectPending(); });
          return answer;
        };
        child.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL idle_in_transaction_session_timeout='300000ms';\n");
        return { query, async close() {
          if (!ended && !pending && !signal.aborted) child.stdin.end("ROLLBACK;\n\\quit\n");
          await cleanup();
        } };
      } catch { await cleanup(); fail("SESSION_FAILED"); }
    },
    async openDump({ snapshotId, signal }) {
      requireValue(used && directory && !activeDump && databaseSnapshotIdentifierValid(snapshotId), "DUMP_STATE");
      activeDump = start(DATABASE_POSTGRES_PATHS.pgDump, ["--format=custom", "--snapshot", snapshotId, ...clientArguments(configuration)], signal);
      activeDump.child.stdin.end();
      return { body: activeDump.child.stdout, completed: activeDump.completed,
        cancel: () => endProcess(activeDump.child, activeDump.completed) };
    },
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createHash } from "node:crypto";
import path from "node:path";
import { createPinnedPostgresTools, databaseSnapshotQuery, DATABASE_POSTGRES_PATHS } from "./lib/database-recovery-pg-tools.mjs";
import { RECOVERY_PROJECT } from "./lib/protected-recovery-protocol.mjs";
import { DATABASE_RECOVERY_REQUIRED_TABLES } from "./lib/database-recovery-source.mjs";

test("snapshot inspection requires the database-only workflow tables separately from file aliases", () => {
  const sql = databaseSnapshotQuery("inspect");
  assert.equal(DATABASE_RECOVERY_REQUIRED_TABLES.length, 10);
  assert.equal(new Set(DATABASE_RECOVERY_REQUIRED_TABLES).size, 10);
  for (const table of DATABASE_RECOVERY_REQUIRED_TABLES) assert(sql.includes(`'${table}'`));
  assert.match(sql, /'missingRequiredTables'/u);
  assert.match(sql, /n\.nspname='public' and c\.relname=name and c\.relkind in \('r','p'\)/u);
});

const hash = (value) => createHash("sha256").update(value).digest("hex");
const certificate = Buffer.from("-----BEGIN CERTIFICATE-----\nU1lOVEhFVElDLVRFU1QtQ0E=\n-----END CERTIFICATE-----\n");
const binaries = { [DATABASE_POSTGRES_PATHS.psql]: Buffer.from("synthetic-psql-binary"), [DATABASE_POSTGRES_PATHS.pgDump]: Buffer.from("synthetic-pgdump-binary") };
function fixture(options = {}) {
  const calls = []; const removed = []; const writes = []; const children = [];
  const configuration = { host: `db.${RECOVERY_PROJECT}.supabase.co`, port: 5432, database: "postgres", user: "applypack_recovery_exporter",
    caSha256: hash(certificate), runtime: { clientVersion: "17.11", psqlSha256: hash(binaries[DATABASE_POSTGRES_PATHS.psql]), pgDumpSha256: hash(binaries[DATABASE_POSTGRES_PATHS.pgDump]) } };
  const filesystem = {
    async lstat(name) { return { isFile: () => Boolean(binaries[name]), isSymbolicLink: () => options.symlink === name,
      isDirectory: () => !binaries[name], uid: options.wrongOwner ? 1000 : 0, mode: options.writable ? 0o777 : 0o755, size: binaries[name]?.length || 4096 }; },
    async readFile(name) { return options.changedBinary ? Buffer.from("substituted") : binaries[name]; },
    async mkdtemp(prefix) { return `${prefix}synthetic`; },
    async writeFile(name, body, flags) { writes.push({ name, body: Buffer.from(body), flags }); },
    async chmod(name, mode) { calls.push({ chmod: name, mode }); },
    async rm(name, flags) { removed.push({ name, flags }); },
  };
  function spawnImpl(binary, args, input) {
    const call = { binary, args: [...args], env: { ...input.env }, shell: input.shell, commands: [] }; calls.push(call);
    const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const finish = (code = 0, signal = null) => {
      if (child.exitCode !== null || child.signalCode) return;
      child.exitCode = code; child.signalCode = signal; child.stdout.end(); child.stderr.end(); child.emit("close", code, signal);
    };
    child.kill = (signal) => { call.killed = signal; finish(null, signal); return true; };
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      const command = chunk.toString("utf8"); call.commands.push(command); callback();
      const marker = /\\echo (APDB_[a-f0-9]{48})/u.exec(command)?.[1];
      if (marker) queueMicrotask(() => {
        if (options.queryFails) { child.stderr.write("private row and SQL diagnostics must not escape"); finish(1); return; }
        const payload = options.queryResponse ?? { name: "Zoë 😀", okay: true };
        const bytes = Buffer.from(`${options.invalidJson ? "not-json-private" : JSON.stringify(payload)}\n${marker}\n`);
        if (options.splitUtf8) {
          const split = bytes.indexOf(Buffer.from("ë")) + 1; child.stdout.write(bytes.subarray(0, split)); child.stdout.write(bytes.subarray(split));
        } else child.stdout.write(bytes);
      });
    } });
    child.stdin.on("finish", () => {
      if (args.includes("--version")) return;
      if (binary === DATABASE_POSTGRES_PATHS.pgDump) queueMicrotask(() => {
        child.stdout.write(Buffer.from("PGDMP synthetic archive"));
        if (options.dumpFails) child.stderr.write("private constraint data");
        finish(options.dumpFails ? 1 : 0);
      });
      else finish();
    });
    if (args.includes("--version")) queueMicrotask(() => {
      const name = binary === DATABASE_POSTGRES_PATHS.psql ? "psql" : "pg_dump";
      child.stdout.write(`${name} (PostgreSQL) ${options.version || "17.11"} (Debian 17.11-1.pgdg13+1)\n`); finish();
    });
    children.push(child); return child;
  }
  const password = Buffer.from("synthetic-local-only-password");
  const tools = () => createPinnedPostgresTools({ configuration, password, caPemBase64: certificate.toString("base64"),
    spawnImpl, filesystem, temporaryRoot: path.resolve("synthetic-tmp"), platform: "linux" });
  return { configuration, calls, children, writes, removed, password, tools };
}

test("held psql session and dump use the fixed target, dedicated child secret and exact snapshot", async () => {
  const f = fixture(); const tools = f.tools(); const signal = new AbortController().signal;
  const session = await tools.openSession({ signal });
  assert.deepEqual(await session.query("roles", {}, signal), { name: "Zoë 😀", okay: true });
  const dump = await tools.openDump({ snapshotId: "00000003-0000001B-1", signal });
  const chunks = []; for await (const chunk of dump.body) chunks.push(chunk); await dump.completed;
  assert.match(Buffer.concat(chunks).toString("utf8"), /^PGDMP/u);
  const clients = f.calls.filter((entry) => entry.binary);
  assert.equal(clients.length, 4);
  for (const call of clients) {
    assert.equal(call.shell, false); assert.equal(call.env.PGSSLMODE, "verify-full");
    assert.equal(call.env.DATABASE_URL, undefined); assert.equal(call.env.AWS_SECRET_ACCESS_KEY, undefined);
    if (call.args.includes("--version")) assert.equal(call.env.PGPASSWORD, undefined);
    else assert.equal(call.env.PGPASSWORD, f.password.toString("utf8"));
    assert.equal(call.args.includes(f.password.toString("utf8")), false);
  }
  const reader = clients[2]; assert.ok(reader.args.includes("--no-psqlrc"));
  assert.match(reader.commands[0], /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  const exporter = clients[3];
  assert.deepEqual(exporter.args.slice(0, 3), ["--format=custom", "--snapshot", "00000003-0000001B-1"]);
  assert.equal(exporter.args.some((arg) => /schema|table|exclude/u.test(arg)), false);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].flags.mode, 0o600); assert.deepEqual(f.writes[0].body, certificate);
  await session.close(); assert.equal(f.removed.length, 1); assert.equal(f.removed[0].flags.recursive, true);
  assert.ok(f.children.every((child) => child.exitCode !== null || child.signalCode));
});
test("framed responses preserve UTF8 characters across arbitrary stdout chunks", async () => {
  const f = fixture({ splitUtf8: true }); const tools = f.tools(); const signal = new AbortController().signal;
  const session = await tools.openSession({ signal });
  assert.deepEqual(await session.query("roles", {}, signal), { name: "Zoë 😀", okay: true }); await session.close();
});
for (const [name, options] of Object.entries({ changedBinary: { changedBinary: true }, writableBinary: { writable: true }, wrongOwner: { wrongOwner: true },
  symlink: { symlink: DATABASE_POSTGRES_PATHS.psql }, wrongVersion: { version: "17.12" } })) {
  test(`client pin rejects ${name} before querying a source`, async () => {
    const f = fixture(options); await assert.rejects(f.tools().openSession({ signal: new AbortController().signal }), /SESSION_FAILED/u);
    assert.equal(f.calls.some((entry) => entry.args?.includes("--no-psqlrc")), false); assert.equal(f.removed.length, 1);
  });
}
test("source role, certificate binding and password channel cannot be substituted", () => {
  const f = fixture(); f.configuration.user = "postgres"; assert.throws(f.tools, /TARGET_IDENTITY/u);
  const g = fixture(); g.configuration.caSha256 = "a".repeat(64); assert.throws(g.tools, /CA_BINDING/u);
  const h = fixture(); h.password.fill(10); assert.throws(h.tools, /PASSWORD_INPUT/u);
});
test("private psql errors and malformed JSON become safe error codes", async () => {
  for (const options of [{ queryFails: true }, { invalidJson: true }]) {
    const f = fixture(options); const tools = f.tools(); const signal = new AbortController().signal;
    const session = await tools.openSession({ signal });
    await assert.rejects(session.query("roles", {}, signal), /^Error: DATABASE_RECOVERY_PG_QUERY_(FAILED|RESPONSE)$/u);
    await session.close(); assert.equal(f.removed.length, 1);
  }
});
test("pg_dump EOF with nonzero status rejects without exposing diagnostics", async () => {
  const f = fixture({ dumpFails: true }); const tools = f.tools(); const signal = new AbortController().signal;
  const session = await tools.openSession({ signal }); const dump = await tools.openDump({ snapshotId: "00000003-0000001B-1", signal });
  for await (const chunk of dump.body) assert.ok(chunk.length);
  await assert.rejects(dump.completed, { message: "DATABASE_RECOVERY_PG_PROCESS_FAILED" }); await session.close();
});
test("abort closes the actual held session and leaves no temp credential file", async () => {
  const f = fixture(); const tools = f.tools(); const controller = new AbortController();
  const session = await tools.openSession({ signal: controller.signal }); controller.abort();
  await assert.rejects(session.query("roles", {}, controller.signal), /QUERY_STATE/u); await session.close();
  assert.ok(f.children.every((child) => child.exitCode !== null || child.signalCode));
  assert.equal(f.writes.length, 1); assert.match(f.writes[0].name, /ca\.pem$/u);
});
test("unknown operations and untrusted identifiers cannot execute SQL", () => {
  for (const operation of ["delete", "vacuum", "select * from auth.users"]) assert.throws(() => databaseSnapshotQuery(operation), /OPERATION_FORBIDDEN/u);
  for (const table of ["auth.users", "ap_document_versions;drop table x", "pg_authid"]) assert.throws(() => databaseSnapshotQuery("table", { table, cursor: null }), /TABLE_REQUEST/u);
  assert.throws(() => databaseSnapshotQuery("table", { table: "intakes", cursor: "' OR TRUE;--" }), /TABLE_REQUEST/u);
  assert.throws(() => databaseSnapshotQuery("objects", { cursor: { bucket: "other", key: "file" } }), /OBJECT_CURSOR/u);
  const query = databaseSnapshotQuery("objects", { cursor: { bucket: "operator-drafts", key: "customer's draft.docx" } });
  assert.ok(query.includes("'customer''s draft.docx'"));
});
test("roles query excludes secrets and preserves the PG17 membership grant options", () => {
  const sql = databaseSnapshotQuery("roles");
  assert.match(sql, /pg_roles/u); assert.match(sql, /pg_auth_members/u);
  assert.match(sql, /admin_option/u); assert.match(sql, /inherit_option/u); assert.match(sql, /set_option/u);
  assert.doesNotMatch(sql, /rolpassword|rolconfig|pg_authid/u);
  assert.match(sql, /limit 4097/u); assert.match(sql, /limit 16385/u);
});
test("a snapshot cannot be swapped or a second dump started", async () => {
  const f = fixture(); const tools = f.tools(); const signal = new AbortController().signal;
  const session = await tools.openSession({ signal });
  await assert.rejects(tools.openDump({ snapshotId: "' injected", signal }), /DUMP_STATE/u);
  const dump = await tools.openDump({ snapshotId: "00000003-0000001B-1", signal });
  for await (const chunk of dump.body) assert.ok(chunk.length); await dump.completed;
  await assert.rejects(tools.openDump({ snapshotId: "00000003-0000001B-2", signal }), /DUMP_STATE/u);
  await session.close();
});

test("concurrent session close and runner disposal perform one scoped cleanup", async () => {
  const f = fixture(); const tools = f.tools(); const signal = new AbortController().signal;
  const session = await tools.openSession({ signal });
  await Promise.all([session.close(), tools.dispose(), tools.dispose()]);
  assert.equal(f.removed.length, 1);
  assert.ok(f.children.every((child) => child.exitCode !== null || child.signalCode));
  await assert.rejects(tools.openSession({ signal }), /SESSION_REUSE/u);
});

test("disposing prepared clients before session creation does not start any process", async () => {
  const f = fixture(); const tools = f.tools(); await tools.dispose();
  assert.equal(f.children.length, 0); assert.equal(f.removed.length, 0);
  await assert.rejects(tools.openSession({ signal: new AbortController().signal }), /SESSION_REUSE/u);
});

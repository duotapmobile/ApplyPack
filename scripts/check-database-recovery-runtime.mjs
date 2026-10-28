import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POSTGRES_SHARED_LIBRARIES = Object.freeze(["libpq.so.5", "libssl.so.3", "libcrypto.so.3",
  "libz.so.1", "libm.so.6", "libc.so.6", "ld-linux-x86-64.so.2"]);
const bin = "/usr/lib/postgresql/17/bin/";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function checkDatabaseRecoveryRuntime({ read = readFileSync, stat = lstatSync, exists = existsSync,
  execute = execFileSync, fixture = false } = {}) {
  const runtime = JSON.parse(read("/opt/applypack/database-recovery-runtime.json", "utf8"));
  assert.equal(runtime.schemaVersion, "applypack-database-recovery-runtime-v1");
  assert.equal(runtime.postgresMajor, 17); assert.equal(runtime.clientVersion, "17.11");
  assert.equal(runtime.baseImageDigest, "sha256:eed5cbf9fcdb7f97de1fb39adde1972efa57df1085c0c76a5ea17c7c27ff8f6c");
  const clients = {};
  for (const [name, key] of [["psql", "psqlSha256"], ["pg_dump", "pgDumpSha256"], ["pg_restore", null]]) {
    const file = bin + name; const info = stat(file);
    assert(info.isFile() && !info.isSymbolicLink() && info.uid === 0 && (info.mode & 0o022) === 0, "root-owned immutable client required");
    clients[name] = sha256(read(file));
    if (key) assert.equal(clients[name], runtime[key]);
    assert.equal(execute(file, ["--version"], { encoding: "utf8", timeout: 10000, maxBuffer: 1024,
      env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C", LC_ALL: "C" } }).trim(), name + " (PostgreSQL) 17.11");
  }
  const needed = read("/usr/share/applypack/postgresql/elf-needed.txt", "utf8").trim().split(/\r?\n/u);
  assert(needed.length > 0 && needed.every((name) => POSTGRES_SHARED_LIBRARIES.includes(name)), "untracked shared dependency");
  for (const required of ["libpq.so.5", "libssl.so.3", "libcrypto.so.3", "libz.so.1", "libc.so.6"]) assert(needed.includes(required));
  const features = JSON.parse(read("/usr/share/applypack/postgresql/features.json", "utf8"));
  assert.deepEqual(features, { openssl: true, zlib: true, readline: false, icu: false });
  if (!fixture) {
    for (const name of ["postgres", "initdb", "pg_ctl"]) assert(!exists(bin + name), "server tools forbidden in shipping worker");
    for (const file of ["/usr/local/bin/gosu", "/bin/sh", "/usr/bin/perl"]) assert(!exists(file), "general-purpose runtime tool forbidden");
    for (const name of ["postgresql-client-17", "libpq5"]) {
      const record = read("/var/lib/dpkg/status.d/" + name, "utf8");
      for (const [field, value] of Object.entries({ Package: name,
        Source: "postgresql-17 (17.11-0+deb13u1)", Version: "17.11-0+deb13u1+applypack1",
        Status: "install ok installed" })) {
        const entries = record.split(/\r?\n/u).filter((line) => line.startsWith(field + ":"));
        assert.deepEqual(entries, [field + ": " + value], "incorrect or ambiguous package provenance: " + field);
      }
    }
  }
  return { status: "PASS", runtime, clients, libpqSha256: sha256(read("/opt/applypack/postgresql/lib/libpq.so.5")), sharedLibraries: needed, features, clientOnly: !fixture };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, "runtime check takes no target or bypass arguments");
  console.log(JSON.stringify(checkDatabaseRecoveryRuntime()));
}

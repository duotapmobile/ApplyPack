import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { checkDatabaseRecoveryRuntime } from "./check-database-recovery-runtime.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture() {
  const bin = "/usr/lib/postgresql/17/bin/";
  const files = Object.fromEntries(["psql", "pg_dump", "pg_restore"].map((name) => [bin + name, Buffer.from(name)]));
  files["/opt/applypack/postgresql/lib/libpq.so.5"] = Buffer.from("libpq");
  const runtime = { schemaVersion: "applypack-database-recovery-runtime-v1", postgresMajor: 17, clientVersion: "17.11",
    baseImageDigest: "sha256:eed5cbf9fcdb7f97de1fb39adde1972efa57df1085c0c76a5ea17c7c27ff8f6c",
    psqlSha256: hash("psql"), pgDumpSha256: hash("pg_dump") };
  files["/opt/applypack/database-recovery-runtime.json"] = JSON.stringify(runtime);
  files["/usr/share/applypack/postgresql/elf-needed.txt"] = "libpq.so.5\nlibssl.so.3\nlibcrypto.so.3\nlibz.so.1\nlibc.so.6\n";
  files["/usr/share/applypack/postgresql/features.json"] = JSON.stringify({ openssl: true, zlib: true, readline: false, icu: false });
  for (const name of ["postgresql-client-17", "libpq5"]) files["/var/lib/dpkg/status.d/" + name]
    = "Package: " + name + "\nSource: postgresql-17\nVersion: 17.11-0applypack1\nStatus: install ok installed\n";
  const calls = [];
  const dependencies = { read: (path) => { assert(path in files, path); return files[path]; },
    stat: () => ({ isFile: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o755 }), exists: (path) => path in files,
    execute: (path, args, options) => { calls.push({ path, args, options }); return path.slice(bin.length) + " (PostgreSQL) 17.11\n"; } };
  return { files, calls, run: (overrides = {}) => checkDatabaseRecoveryRuntime({ ...dependencies, ...overrides }) };
}
test("verifies hashes, actual client startup and TLS/compression with package coverage", () => {
  const f = fixture(); assert.equal(f.run().clientOnly, true); assert.equal(f.calls.length, 3);
  assert(f.calls.every(({ args, options }) => args[0] === "--version" && !("PGPASSWORD" in options.env)));
});
for (const client of ["psql", "pg_dump"]) test("rejects changed " + client + " bytes", () => {
  const f = fixture(); f.files["/usr/lib/postgresql/17/bin/" + client] = Buffer.from("changed"); assert.throws(() => f.run());
});
for (const path of ["/usr/lib/postgresql/17/bin/postgres", "/usr/lib/postgresql/17/bin/initdb", "/usr/lib/postgresql/17/bin/pg_ctl",
  "/usr/local/bin/gosu", "/bin/sh", "/usr/bin/perl"]) test("shipping image rejects " + path, () => {
  const f = fixture(); f.files[path] = ""; assert.throws(() => f.run()); assert.equal(f.run({ fixture: true }).clientOnly, false);
});
for (const feature of ["openssl", "zlib", "readline", "icu"]) test("rejects wrong compiled feature " + feature, () => {
  const f = fixture(); const path = "/usr/share/applypack/postgresql/features.json";
  const features = JSON.parse(f.files[path]); features[feature] = !features[feature]; f.files[path] = JSON.stringify(features); assert.throws(() => f.run());
});
test("rejects absent inventory, added shared library, writable binary or different client version", () => {
  for (const name of ["postgresql-client-17", "libpq5"]) {
    const f = fixture(); delete f.files["/var/lib/dpkg/status.d/" + name]; assert.throws(() => f.run());
  }
  const f = fixture(); f.files["/usr/share/applypack/postgresql/elf-needed.txt"] += "libncurses.so.6\n"; assert.throws(() => f.run());
  assert.throws(() => fixture().run({ stat: () => ({ isFile: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o777 }) }));
  assert.throws(() => fixture().run({ execute: () => "psql (PostgreSQL) 17.6" }));
});
test("the default Docker output and declared build inputs agree on immutable client-only runtime", () => {
  const docker = readFileSync(new URL("../Dockerfile.database-recovery", import.meta.url), "utf8");
  const inputs = Object.fromEntries(readFileSync(new URL("../infra/database-recovery/client-build-inputs.env", import.meta.url), "utf8").trim().split("\n").map((line) => {
    const separator = line.indexOf("="); return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  assert(docker.includes("FROM " + inputs.RUNTIME_IMAGE + " AS recovery-runtime"));
  assert(docker.includes("FROM " + inputs.BUILDER_IMAGE + " AS postgres-client-build"));
  assert(docker.includes("FROM " + inputs.FIXTURE_IMAGE + " AS database-recovery-fixture"));
  assert.equal(docker.match(/^FROM .+$/gmu).at(-1), "FROM recovery-runtime AS database-recovery");
  assert.equal(inputs.POSTGRES_VERSION, "17.11"); assert.match(inputs.POSTGRES_SOURCE_SHA256, /^[a-f0-9]{64}$/u);
});

test("preserves complete bundled license comment blocks", async () => {
  const { sourceNotices } = await import("../infra/database-recovery/collect-notices.mjs");
  const legal = "/* Copyright Example. Redistribution permitted. NO WARRANTY. */";
  assert.deepEqual(sourceNotices("/* implementation note */\n" + legal + "\nint sample;"), [legal]);
});

function builderToolCheck(unavailable = []) {
  assert(unavailable.every((name) => /^[a-z0-9-]+$/u.test(name)));
  const helper = readFileSync(new URL("../infra/database-recovery/check-build-tools.sh", import.meta.url), "utf8");
  // Simulate the pinned builder's command inventory without installing software
  // on the host. Execute the same dependency check sourced by both build phases.
  const inventory = unavailable.length ? `case "$2" in ${unavailable.join("|")}) return 1;; esac;` : "";
  return spawnSync(process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash",
    ["--noprofile", "--norc", "-c", helper + `\ncommand() { ${inventory} return 0; }\ncheck_postgres_build_tools`],
    { encoding: "utf8", timeout: 5_000, windowsHide: true });
}

test("builder rejects missing bzip2 before extracting the verified archive", () => {
  const result = builderToolCheck(["bzip2"]);
  assert.equal(result.error, undefined); assert.equal(result.status, 1);
  assert.match(result.stderr, /postgres_client_build_tools_missing:bzip2/u);
  const build = readFileSync(new URL("../infra/database-recovery/build-clients.sh", import.meta.url), "utf8");
  const prepare = build.slice(build.indexOf("prepare)"), build.indexOf("compile)"));
  assert(prepare.indexOf("apt-get install") < prepare.indexOf("check_postgres_build_tools"));
  assert(prepare.indexOf("check_postgres_build_tools") < prepare.indexOf("tar -tjf"));
  assert.match(prepare, /apt-get install[^;]*\bbzip2\b/u);
});

test("builder reports all missing compiler, parser, packaging and inspection tools together", () => {
  const result = builderToolCheck(["bison", "dpkg-deb", "flex", "gcc", "perl", "readelf"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "postgres_client_build_tools_missing:bison dpkg-deb flex gcc perl readelf");
});

test("complete tool inventory passes without an install or network fallback", () => {
  const result = builderToolCheck(); assert.equal(result.status, 0); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
});

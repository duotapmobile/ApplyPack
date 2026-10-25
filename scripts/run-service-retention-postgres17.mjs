import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Test-only server image. Never import this image into a deployed worker: its
// server/tooling packages have a separate vulnerability profile from runtime.
export const RETENTION_POSTGRES_IMAGE = "postgres:17-trixie@sha256:3518071376d0b6156b02e1db2747a78511b5b9dc3763cc79c506ebe2dc2ee71c";
const schema = "202610250090";
const version = "17.11";
const fixtureLabel = "service-retention-postgres17";
const bin = "/usr/lib/postgresql/17/bin/";
const directory = "/tmp/applypack-retention";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fixtureNames = Object.freeze(["one-off-service-retention.sql", "service-retention-cleanup.sql", "confirmed-intake.sql", "reviewed-commute.sql", "service-retention-races.sql"]);
const fixtureMarkers = Object.freeze(fixtureNames.map((_, index) => `RETENTION_PG17_FIXTURE_${index + 1}_COMPLETE`));

export function loadRetentionPostgresInputs() {
  const root = new URL("../", import.meta.url);
  const inputs = [];
  const add = (kind, name, location) => {
    const bytes = readFileSync(new URL(location, root));
    const text = bytes.toString("utf8"); assert(Buffer.from(text, "utf8").equals(bytes), "RETENTION_FIXTURE_INVALID_UTF8");
    const source = text.replace(/^\uFEFF/u, "");
    assert(source.length > 0 && source.length < 2 * 1024 * 1024, "RETENTION_FIXTURE_INPUT_BOUND");
    assert(!/^\s*\\/mu.test(source), "RETENTION_FIXTURE_META_COMMAND_FORBIDDEN");
    inputs.push({ kind, name, sha256: sha256(bytes), executedSha256: sha256(source), source });
  };
  add("bootstrap", "retention-postgres17-bootstrap.sql", "tests/integration/retention-postgres17-bootstrap.sql");
  const migrations = readdirSync(new URL("supabase/migrations/", root)).filter((name) => name.endsWith(".sql")).sort();
  assert(migrations.length > 0 && migrations.every((name) => /^\d{12}_[a-z0-9_]+\.sql$/u.test(name)), "RETENTION_FIXTURE_MIGRATION_NAME");
  assert.equal(new Set(migrations.map((name) => name.slice(0, 12))).size, migrations.length, "RETENTION_FIXTURE_DUPLICATE_MIGRATION");
  assert.equal(migrations.at(-1).slice(0, 12), schema, "RETENTION_FIXTURE_SCHEMA_CHANGED");
  for (const name of migrations) add("migration", name, `supabase/migrations/${name}`);
  for (const name of fixtureNames) add("fixture", name, `tests/integration/${name}`);
  const statements = inputs.map(({ kind, name, source }) => {
    if (kind === "fixture") return `${source}\nselect '${fixtureMarkers[fixtureNames.indexOf(name)]}';`;
    if (kind !== "migration") return source;
    const id = name.slice(0, 12); const migrationName = name.slice(13, -4); const delimiter = `$retention_source_${id}$`;
    assert(!source.includes(delimiter), "RETENTION_FIXTURE_DELIMITER_COLLISION");
    return `${source}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${id}','${migrationName}',array[${delimiter}${source}${delimiter}]);`;
  });
  const sql = `do $$ begin
    if current_setting('server_version') not like '${version}%' or current_setting('listen_addresses')<>'127.0.0.1'
      or current_database()<>'postgres' or inet_server_addr()<>'127.0.0.1'::inet then raise exception 'isolated_postgres17_required'; end if;
    end $$;\n${statements.join("\n")}\n`;
  assert(Buffer.byteLength(sql) < 16 * 1024 * 1024, "RETENTION_FIXTURE_BATCH_BOUND");
  return { sql, hashes: inputs.map(({ kind, name, sha256, executedSha256 }) => ({ kind, name, sha256, executedSha256 })), migrationCount: migrations.length };
}

function validateImage(metadata) {
  assert(metadata && /^sha256:[a-f0-9]{64}$/u.test(metadata.Id), "RETENTION_FIXTURE_IMAGE_ID");
  assert.equal(metadata.Os, "linux"); assert.equal(metadata.Architecture, "amd64");
  assert(metadata.RepoDigests?.some((ref) => ref === RETENTION_POSTGRES_IMAGE.replace(":17-trixie", "")), "RETENTION_FIXTURE_IMAGE_DIGEST");
  assert(metadata.Config.Env?.includes(`PG_MAJOR=17`) && metadata.Config.Env.some((entry) => entry.startsWith(`PG_VERSION=${version}-`)), "RETENTION_FIXTURE_IMAGE_VERSION");
  const volumes = Object.keys(metadata.Config.Volumes || {});
  assert(volumes.every((volume) => /^\/var\/lib\/postgresql(?:\/data)?$/u.test(volume)), "RETENTION_FIXTURE_IMAGE_VOLUME");
  return volumes;
}

function validateOwnedContainer(state, name, runId) {
  assert.equal(state.Name, `/${name}`, "RETENTION_FIXTURE_CONTAINER_IDENTITY");
  assert.equal(state.Config?.Labels?.["io.applypack.fixture"], fixtureLabel, "RETENTION_FIXTURE_CONTAINER_IDENTITY");
  assert.equal(state.Config?.Labels?.["io.applypack.fixture-run"], runId, "RETENTION_FIXTURE_CONTAINER_IDENTITY");
}

function validateContainerIsolation(state, imageId) {
  assert.equal(state.Image, imageId);
  assert.equal(state.Config.User, "65534:65534");
  assert.equal(state.HostConfig.NetworkMode, "none"); assert.equal(state.HostConfig.ReadonlyRootfs, true);
  assert.equal(state.HostConfig.Privileged, false);
  assert.equal(Object.keys(state.HostConfig.PortBindings || {}).length, 0);
  assert.equal((state.Mounts || []).some((mount) => mount.Type !== "tmpfs"), false);
  assert.equal((state.HostConfig.Binds || []).length, 0);
  assert(state.HostConfig.CapDrop?.includes("ALL"));
  assert(state.HostConfig.SecurityOpt?.includes("no-new-privileges"));
}

/** Fixed local Docker socket, immutable image and repository-only fictional inputs. */
export function runRetentionPostgres17(args = [], { execute = execFileSync, environment = process.env, platform = process.platform, uuid = randomUUID, inputs = loadRetentionPostgresInputs } = {}) {
  assert.deepEqual(args, [], "RETENTION_FIXTURE_ARGUMENTS_FORBIDDEN");
  for (const [name, value] of Object.entries(environment)) {
    if (value && /^(?:DOCKER_|CONTAINER_HOST$|PGHOST$|PGPORT$|PGUSER$|PGDATABASE$|PGPASSWORD$|PGPASSFILE$|PGSERVICE|PGOPTIONS$|DATABASE_URL$)/iu.test(name)) {
      throw new Error("RETENTION_FIXTURE_EXTERNAL_ENVIRONMENT_FORBIDDEN");
    }
  }
  const childEnvironment = Object.fromEntries(Object.entries(environment).filter(([name]) => /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/iu.test(name)));
  const host = platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";
  const docker = (parameters, input, timeout = 30000) => execute("docker", ["--host", host, ...parameters], {
    input, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: childEnvironment,
  });
  const { sql, hashes, migrationCount } = inputs();
  const metadata = JSON.parse(docker(["image", "inspect", RETENTION_POSTGRES_IMAGE]))[0];
  const volumes = validateImage(metadata);
  const runId = uuid(); assert(/^[a-f0-9-]{36}$/u.test(runId), "RETENTION_FIXTURE_RUN_ID");
  const name = `applypack-retention-pg17-${runId}`;
  const isolation = ["--pull", "never", "--network", "none", "--read-only", "--user", "65534:65534",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=512m", "--shm-size", "32m", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--memory", "768m", "--pids-limit", "64", "--cpus", "2"];
  for (const volume of volumes) isolation.push("--tmpfs", `${volume}:rw,noexec,nosuid,nodev,size=16m`);
  const executeLocal = (binary, parameters, input, timeout) => docker(["exec", "-i", name, "/usr/bin/env", "-i",
    `PATH=${bin}:/usr/bin:/bin`, "HOME=/tmp", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TZ=UTC",
    "PGOPTIONS=-c statement_timeout=60000 -c lock_timeout=10000", binary, ...parameters], input, timeout);
  let attemptedCreate = false; let started = false; let result; let primaryError;
  try {
    attemptedCreate = true;
    docker(["create", "--name", name, "--label", `io.applypack.fixture=${fixtureLabel}`, "--label", `io.applypack.fixture-run=${runId}`,
      ...isolation, "--entrypoint", "/bin/sleep", metadata.Id, "900"]);
    const state = JSON.parse(docker(["inspect", name]))[0];
    validateOwnedContainer(state, name, runId); validateContainerIsolation(state, metadata.Id);
    docker(["start", name]);
    executeLocal("/bin/mkdir", ["-m", "0700", directory]);
    executeLocal(`${bin}initdb`, ["-D", `${directory}/data`, "-U", "postgres", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--no-locale"]);
    executeLocal(`${bin}pg_ctl`, ["-D", `${directory}/data`, "-l", `${directory}/postgres.log`, "-w", "-t", "30", "start", "-o",
      `-h 127.0.0.1 -p 5432 -k ${directory} -c max_connections=12 -c shared_buffers=16MB -c unix_socket_permissions=0700`], undefined, 45000);
    started = true;
    const output = executeLocal(`${bin}psql`, ["-X", "-q", "-h", "127.0.0.1", "-p", "5432", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], sql, 600000);
    for (const marker of fixtureMarkers) assert(output.split(/\r?\n/u).some((line) => line.trim() === marker), `RETENTION_FIXTURE_MARKER_MISSING:${marker}`);
    result = { status: "PASS", scope: "fictional-postgres17-retention-concurrency", postgresVersion: version, schemaVersion: schema,
      imageId: metadata.Id, imageDigest: RETENTION_POSTGRES_IMAGE.split("@")[1], migrationCount, fixtureCount: fixtureNames.length,
      inputHashes: hashes, sqlSha256: sha256(sql), actualIndependentConnections: true, networkMode: "none", publishedPorts: 0,
      providerCalls: 0, hostedProof: false };
  } catch (error) { primaryError = error; }
  finally {
    if (attemptedCreate) {
      try {
        const present = docker(["ps", "--all", "--quiet", "--filter", `name=^/${name}$`]).trim();
        if (present) {
          const state = JSON.parse(docker(["inspect", name]))[0]; validateOwnedContainer(state, name, runId);
          try { if (started) executeLocal(`${bin}pg_ctl`, ["-D", `${directory}/data`, "-w", "-t", "30", "-m", "immediate", "stop"], undefined, 45000); }
          finally { docker(["rm", "--force", "--volumes", name]); }
        }
        assert.equal(docker(["ps", "--all", "--quiet", "--filter", `name=^/${name}$`]).trim(), "", "RETENTION_FIXTURE_TEARDOWN_INCOMPLETE");
      } catch (cleanupError) { throw new AggregateError([...(primaryError ? [primaryError] : []), cleanupError], "RETENTION_FIXTURE_CLEANUP_FAILED"); }
    }
  }
  if (primaryError) throw primaryError;
  return { ...result, teardownVerified: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runRetentionPostgres17(process.argv.slice(2)))); }
  catch (error) {
    console.error("RETENTION_POSTGRES17_FIXTURE_FAILED");
    // The subprocess receives only repository fictional SQL and no provider
    // credentials. Keep bounded diagnostics for CI while never dumping its env.
    if (error?.stderr) console.error(String(error.stderr).slice(-12000));
    else console.error(error?.message || "unknown local fixture error");
    process.exitCode = 1;
  }
}

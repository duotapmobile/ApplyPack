import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadRetentionPostgresInputs, RETENTION_POSTGRES_IMAGE, runRetentionPostgres17 } from "./run-service-retention-postgres17.mjs";

const runId = "11111111-2222-4333-8444-555555555555";
const imageId = `sha256:${"a".repeat(64)}`;
const name = `applypack-retention-pg17-${runId}`;
function fixture({ failAt, alterState, missingMarker, ambiguousCreate, invalidImage, cleanupFailure } = {}) {
  const calls = []; let exists = false; let deleted = false;
  const state = { Name: `/${name}`, Image: imageId,
    Config: { User: "65534:65534", Labels: { "io.applypack.fixture": "service-retention-postgres17", "io.applypack.fixture-run": runId } },
    HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, Privileged: false, PortBindings: {}, Binds: [], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"] },
    Mounts: [{ Type: "tmpfs" }] };
  const metadata = { Id: imageId, Os: "linux", Architecture: "amd64", RepoDigests: [RETENTION_POSTGRES_IMAGE.replace(":17-trixie", "")],
    Config: { Env: ["PG_MAJOR=17", "PG_VERSION=17.11-1.pgdg13+1"], Volumes: { "/var/lib/postgresql/data": {} } } };
  if (invalidImage) invalidImage(metadata);
  const execute = (binary, args, options) => {
    calls.push({ binary, args, options });
    assert.equal(binary, "docker"); assert.deepEqual(args.slice(0, 2), ["--host", "unix:///var/run/docker.sock"]);
    const operation = args[2];
    if (operation === "image") return JSON.stringify([metadata]);
    if (operation === "create") { exists = true; if (ambiguousCreate) throw new Error("create response lost"); return "fictional-container-id"; }
    if (operation === "inspect") { const value = structuredClone(state); if (alterState) alterState(value); return JSON.stringify([value]); }
    if (operation === "ps") return exists ? "fictional-container-id\n" : "";
    if (operation === "rm") { if (cleanupFailure) throw new Error("cleanup unavailable"); exists = false; deleted = true; return name; }
    if (operation === failAt || (operation === "exec" && args.some((value) => value.endsWith(`/${failAt}`)))) throw new Error("fictional process failed");
    if (args.includes("/usr/lib/postgresql/17/bin/psql")) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].filter((index) => index !== missingMarker).map((index) => ` RETENTION_PG17_FIXTURE_${index}_COMPLETE \n`).join("");
    return "";
  };
  const run = (args = [], environment = {}) => runRetentionPostgres17(args, { execute, environment, platform: "linux", uuid: () => runId,
    inputs: () => ({ sql: "fictional SQL", hashes: [{ kind: "fixture", name: "fictional.sql", sha256: "b".repeat(64) }], migrationCount: 104 }) });
  return { calls, run, deleted: () => deleted };
}

test("builds all current migrations with exact source hashes and unchanged independent-connection fixture", () => {
  const inputs = loadRetentionPostgresInputs();
  assert.equal(inputs.migrationCount, 104);
  assert.equal(inputs.hashes.filter((entry) => entry.kind === "fixture").length, 16);
  assert(inputs.hashes.every((entry) => /^[a-f0-9]{64}$/u.test(entry.sha256)));
  assert.match(inputs.sql, /native_loopback_fixture_required/u);
  assert.match(inputs.sql, /dblink_send_query/u);
  assert.match(inputs.sql, /RETENTION_PG17_FIXTURE_16_COMPLETE/u);
  assert.match(inputs.sql, /PROTECTED_ARCHIVE_NON_OWNER_BOUNDARY_OK/u);
  assert.match(inputs.sql, /set local role ap_archive_fixture_non_owner/u);
  assert.match(inputs.sql, /'202610250090','matching_evidence_completion'/u);
  assert.match(inputs.sql, /'202610250091','material_draft_pair_workflow'/u);
  assert.match(inputs.sql, /'202610250092','material_rule_revalidation'/u);
  assert.match(inputs.sql, /'202610250093','source_aware_document_acceptance'/u);
  assert.match(inputs.sql, /'202610250094','material_draft_stage_claiming'/u);
  assert.match(inputs.sql, /'202610250095','reference_aware_draft_delivery'/u);
  assert.match(inputs.sql, /MATERIAL_DRAFT_STAGE_CONCURRENCY_OK/u);
  const native = readFileSync(new URL("./test-database-native.ps1", import.meta.url), "utf8").match(/\$bootstrap = @'\r?\n([\s\S]*?)\r?\n'@/u)?.[1];
  const bootstrap = readFileSync(new URL("../tests/integration/retention-postgres17-bootstrap.sql", import.meta.url), "utf8");
  const normalize = (text) => text.split(/\r?\n/u).filter((line) => line.trim() && !line.trim().startsWith("--")).join("\n");
  assert.equal(normalize(bootstrap), normalize(native));
  assert.equal(RETENTION_POSTGRES_IMAGE, "postgres:17-trixie@sha256:3518071376d0b6156b02e1db2747a78511b5b9dc3763cc79c506ebe2dc2ee71c");
});

test("uses only an immutable image and isolated tmpfs container, actual local SQL commands, and verified teardown", () => {
  const f = fixture(); const receipt = f.run([], { PATH: "/bin", AWS_SECRET_ACCESS_KEY: "SYNTHETIC", SUPABASE_SECRET_KEY: "SYNTHETIC", HOME: "/private" });
  assert.equal(receipt.status, "PASS"); assert.equal(receipt.teardownVerified, true); assert(f.deleted());
  assert(f.calls.every(({ options }) => options.env.AWS_SECRET_ACCESS_KEY === undefined && options.env.SUPABASE_SECRET_KEY === undefined && options.env.HOME === undefined));
  const creation = f.calls.find(({ args }) => args[2] === "create").args;
  for (const value of ["none", "--read-only", "65534:65534", "--tmpfs", "--cap-drop", "--security-opt", "--memory", "--pids-limit", imageId]) assert(creation.includes(value));
  assert(!creation.some((value) => ["-v", "--volume", "--mount", "--publish", "-p", "--privileged"].includes(value)));
  const execution = f.calls.find(({ args }) => args.includes(`${"/usr/lib/postgresql/17/bin/"}psql`));
  assert.equal(execution.options.input, "fictional SQL"); assert(execution.args.includes("127.0.0.1"));
  assert(f.calls.some(({ args }) => args.includes("--auth-host=trust")));
  assert(f.calls.some(({ args }) => args.includes("-h 127.0.0.1 -p 5432 -k /tmp/applypack-retention -c max_connections=12 -c shared_buffers=16MB -c unix_socket_permissions=0700")));
});

for (const args of [["postgres://external/db"], ["--image", "latest"], ["--skip-cleanup"]]) test("rejects caller-supplied targets/options before process execution", () => {
  const f = fixture(); assert.throws(() => f.run(args), /RETENTION_FIXTURE_ARGUMENTS_FORBIDDEN/u); assert.equal(f.calls.length, 0);
});
for (const variable of ["DOCKER_HOST", "docker_context", "PGHOST", "PGPASSWORD", "PGSERVICEFILE", "DATABASE_URL"]) test(`rejects ${variable} before any process`, () => {
  const f = fixture(); assert.throws(() => f.run([], { [variable]: "SYNTHETIC" }), /RETENTION_FIXTURE_EXTERNAL_ENVIRONMENT_FORBIDDEN/u); assert.equal(f.calls.length, 0);
});
for (const failAt of ["start", "initdb", "pg_ctl", "psql"]) test(`cleans its own container after ${failAt} failure`, () => {
  const f = fixture({ failAt }); assert.throws(() => f.run()); assert(f.deleted());
});
test("removes a created container even when the create response was lost", () => {
  const f = fixture({ ambiguousCreate: true }); assert.throws(() => f.run(), /response lost/u); assert(f.deleted());
});
test("missing real-fixture completion marker fails and cleans up", () => {
  const f = fixture({ missingMarker: 5 }); assert.throws(() => f.run(), /RETENTION_FIXTURE_MARKER_MISSING/u); assert(f.deleted());
});
for (const alterState of [
  (state) => { state.HostConfig.NetworkMode = "host"; },
  (state) => { state.HostConfig.ReadonlyRootfs = false; },
  (state) => { state.Mounts = [{ Type: "bind" }]; },
  (state) => { state.HostConfig.PortBindings = { "5432/tcp": [{}] }; },
]) test("rejects isolation drift before starting PostgreSQL and removes only its own container", () => {
  const f = fixture({ alterState }); assert.throws(() => f.run()); assert(f.deleted());
  assert(!f.calls.some(({ args }) => args[2] === "start"));
});
test("identity mismatch prevents destructive cleanup of an unrelated container", () => {
  const f = fixture({ alterState: (state) => { state.Config.Labels["io.applypack.fixture-run"] = "other"; } });
  assert.throws(() => f.run(), /RETENTION_FIXTURE_CLEANUP_FAILED/u); assert(!f.deleted());
});
test("cleanup failure never yields a PASS receipt", () => {
  const f = fixture({ cleanupFailure: true }); assert.throws(() => f.run(), /RETENTION_FIXTURE_CLEANUP_FAILED/u);
});
for (const invalidImage of [
  (image) => { image.RepoDigests = []; },
  (image) => { image.Config.Env = ["PG_MAJOR=18", "PG_VERSION=18.0-1"]; },
  (image) => { image.Config.Volumes = { "/host-data": {} }; },
]) test("rejects unpinned, wrong-major or unexpected-volume image before create", () => {
  const f = fixture({ invalidImage }); assert.throws(() => f.run()); assert(!f.calls.some(({ args }) => args[2] === "create"));
});

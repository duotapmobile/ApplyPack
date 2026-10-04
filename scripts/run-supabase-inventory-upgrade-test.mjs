import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("../tests/integration/atomic-inventory-077-fixture.sql", import.meta.url));
const cutoverBase = fileURLToPath(new URL("../tests/integration/atomic-inventory-cutover-base.sql", import.meta.url));
const cutoverConflict = fileURLToPath(new URL("../tests/integration/atomic-inventory-cutover-conflict.sql", import.meta.url));
const verify = fileURLToPath(new URL("../tests/integration/atomic-inventory-078-verify.sql", import.meta.url));
const migration077 = fileURLToPath(new URL("../supabase/migrations/202610040077_atomic_inventory_identity_enforcement.sql", import.meta.url));
const psqlArgs = ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];

function execute(command, args, input, echo = true) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(), encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 120_000,
  });
  if (echo && result.stdout) process.stdout.write(result.stdout);
  if (echo && result.stderr) process.stderr.write(result.stderr);
  return result;
}

function run(command, args, input, echo = true) {
  const result = execute(command, args, input, echo);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`);
  return result.stdout;
}

function sqlText(input, echo = true) {
  return run("docker", psqlArgs, input, echo);
}

function sql(path, echo = true) {
  return sqlText(readFileSync(path, "utf8"), echo);
}

function spawnCaptured(command, args, input) {
  const child = spawn(command, args, { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(input);
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  return { child, completion, output: () => stdout + stderr };
}

async function waitForOutput(process, marker, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (!process.output().includes(marker)) {
    if (process.child.exitCode !== null) throw new Error(`process exited before ${marker}: ${process.output()}`);
    if (Date.now() - startedAt > timeoutMs) throw new Error(`timed out waiting for ${marker}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const conflictRollbackVerification = `
select case when
  not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610040077')
  and position(
    'array_remove(array[existing.canonical_employer_listing_url,existing.canonical_application_url],null)'
    in pg_catalog.pg_get_functiondef('public.ap_persist_parsed_inventory_job(uuid,uuid,text,jsonb,jsonb)'::regprocedure)
  )=0
  and (select invalidated_at is null from public.ap_feasibility_assessments where id='f6600000-0000-4000-8000-000000000001')
  and (select invalidated_at is null from public.ap_quotes where id='f6c00000-0000-4000-8000-000000000001')
then 'MIGRATION_077_CONFLICT_ROLLBACK_OK' else 'MIGRATION_077_CONFLICT_ROLLBACK_FAILED' end;
`;

const raceRollbackVerification = `
select case when
  public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'='202610040079'
  and to_regprocedure('public.ap_guard_inventory_member_identity()') is null
  and not exists(select 1 from public.ap_migration_checkpoints where migration_id='202610040080')
then 'MIGRATION_080_RACE_ROLLBACK_OK' else 'MIGRATION_080_RACE_ROLLBACK_FAILED' end;
`;

let failure;
try {
  // A historical conflict must abort migration 077 atomically, including its
  // function rewrites and feasibility invalidations.
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610040076"], undefined, false);
  sql(fixture, false);
  sql(cutoverBase, false);
  sql(cutoverConflict, false);
  const rejected077 = execute("docker", psqlArgs, readFileSync(migration077, "utf8"), false);
  const rejected077Output = `${rejected077.stdout || ""}${rejected077.stderr || ""}`;
  if (rejected077.status === 0 || !rejected077Output.includes("selected_inventory_identity_conflict_requires_successor_inventory")) {
    throw new Error(`migration 077 did not reject the seeded historical conflict: ${rejected077Output}`);
  }
  if (!sqlText(conflictRollbackVerification, false).includes("MIGRATION_077_CONFLICT_ROLLBACK_OK")) {
    throw new Error("migration 077 conflict did not roll back atomically");
  }
  console.log("Migration 077 rejects a historical cross-field conflict and rolls back atomically.");

  // Reproduce the old-build interleaving that migration 079 could miss: the
  // writer performs its duplicate SELECT (ACCESS SHARE), pauses, then inserts.
  // Migration 080 must wait for that transaction, rescan its committed row,
  // and roll back without publishing the persistent guard checkpoint.
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610040079"], undefined, false);
  sql(fixture, false);
  sql(cutoverBase, false);
  const writerSql = `begin;
select count(*) from public.ap_inventory_members
where inventory_version_id='f6300000-0000-4000-8000-000000000001';
select 'CUTOVER_PRECHECK_READY';
select pg_sleep(6);
${readFileSync(cutoverConflict, "utf8")}
commit;
`;
  const writer = spawnCaptured("docker", psqlArgs, writerSql);
  await waitForOutput(writer, "CUTOVER_PRECHECK_READY");
  const migration = spawnCaptured("supabase", ["migration", "up", "--local"], undefined);
  await new Promise((resolve) => setTimeout(resolve, 750));
  if (migration.child.exitCode !== null) throw new Error("migration 080 did not wait for the prechecked inventory writer");
  const writerResult = await writer.completion;
  if (writerResult.status !== 0) throw new Error(`cutover writer failed: ${writerResult.stdout}${writerResult.stderr}`);
  const migrationResult = await migration.completion;
  const migrationOutput = `${migrationResult.stdout}${migrationResult.stderr}`;
  if (migrationResult.status === 0 || !migrationOutput.includes("selected_inventory_identity_conflict_requires_successor_inventory")) {
    throw new Error(`migration 080 did not refuse the committed prechecked conflict: ${migrationOutput}`);
  }
  if (!sqlText(raceRollbackVerification, false).includes("MIGRATION_080_RACE_ROLLBACK_OK")) {
    throw new Error("migration 080 race refusal did not roll back atomically");
  }
  console.log("Migration 080 drains a prechecked old writer, rescans, and refuses its conflict atomically.");

  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610040076"], undefined, false);
  sql(fixture, false);
  sql(cutoverBase, false);
  run("supabase", ["migration", "up", "--local"], undefined, false);
  if (!sql(verify).includes("ATOMIC_INVENTORY_080_RECOVERY_OK")) {
    throw new Error("identity-policy recovery verification marker missing");
  }
  const persistentGuard = execute(
    "docker",
    psqlArgs,
    `begin;\n${readFileSync(cutoverConflict, "utf8")}\nrollback;\n`,
    false,
  );
  const persistentGuardOutput = `${persistentGuard.stdout || ""}${persistentGuard.stderr || ""}`;
  if (persistentGuard.status === 0 || !persistentGuardOutput.includes("duplicate_inventory_job")) {
    throw new Error(`persistent inventory identity guard accepted a cross-field duplicate: ${persistentGuardOutput}`);
  }
  console.log("Migration 080 permanently rejects cross-field duplicates after cutover.");
} catch (error) {
  failure = error;
} finally {
  try { run("supabase", ["db", "reset", "--local", "--no-seed"], undefined, false); }
  catch (restoreError) { if (!failure) failure = restoreError; }
}
if (failure) throw failure;

console.log("Migrations 077-080 reject unsafe cutovers, persist the identity guard, and permit clean recovery.");

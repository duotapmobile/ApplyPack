import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sqlPath = fileURLToPath(new URL("../supabase/rollback/202609040022_corrected_chunk1_foundation.rollback.sql", import.meta.url));
const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const expectedMigrationCount = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).length;
const input = readFileSync(sqlPath, "utf8") + "\nselect case when to_regclass('public.orders') is not null and to_regclass('public.ap_anonymous_drafts') is null then 'ROLLBACK_OK' else 'ROLLBACK_FAILED' end;\n";

function run(command, args, stdin) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input: stdin,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

const rollback = run("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], input);
const rollbackPassed = !rollback.error && rollback.status === 0 && rollback.stdout.includes("ROLLBACK_OK");

// A rollback test must never leave the shared local development database in the rolled-back state.
const reset = run("supabase", ["db", "reset", "--local"]);
if (reset.error || reset.status !== 0) {
  if (reset.error) console.error(reset.error);
  console.error("Rollback verification could not restore the latest local schema.");
  process.exit(reset.status || 1);
}

const restoreSql = `
select case when
  to_regclass('public.ap_anonymous_drafts') is not null
  and exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'ap_create_anonymous_draft'
  )
  and (select count(*) from supabase_migrations.schema_migrations) = ${expectedMigrationCount}
then 'RESTORE_OK' else 'RESTORE_FAILED' end;
`;
const restore = run("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], restoreSql);
const restorePassed = !restore.error && restore.status === 0 && restore.stdout.includes("RESTORE_OK");

if (!rollbackPassed || !restorePassed) {
  if (rollback.error) console.error(rollback.error);
  if (restore.error) console.error(restore.error);
  process.exit(rollback.status || restore.status || 1);
}

console.log(`Rollback verified and local schema restored through all ${expectedMigrationCount} migrations.`);

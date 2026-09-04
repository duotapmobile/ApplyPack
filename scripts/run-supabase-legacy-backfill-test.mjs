import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("../tests/integration/chunk1-legacy-fixture.sql", import.meta.url));
const verify = fileURLToPath(new URL("../tests/integration/chunk1-legacy-verify.sql", import.meta.url));
function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`);
  return result.stdout;
}
function sql(path) {
  return run("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], readFileSync(path, "utf8"));
}

let failure;
try {
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202609030021"]);
  sql(fixture);
  run("supabase", ["migration", "up", "--local"]);
  if (!sql(verify).includes("LEGACY_BACKFILL_OK")) throw new Error("legacy backfill verification marker missing");
  run("supabase", ["migration", "up", "--local"]);
  if (!sql(verify).includes("LEGACY_BACKFILL_OK")) throw new Error("idempotent legacy backfill verification marker missing");
} catch (error) {
  failure = error;
} finally {
  try { run("supabase", ["db", "reset", "--local", "--no-seed"]); }
  catch (restoreError) { if (!failure) failure = restoreError; }
}
if (failure) throw failure;

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("../tests/integration/atomic-inventory-077-fixture.sql", import.meta.url));
const verify = fileURLToPath(new URL("../tests/integration/atomic-inventory-078-verify.sql", import.meta.url));

function run(command, args, input, echo = true) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(), encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 120_000,
  });
  if (echo && result.stdout) process.stdout.write(result.stdout);
  if (echo && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`);
  return result.stdout;
}

function sql(path) {
  return run(
    "docker",
    ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    readFileSync(path, "utf8"),
  );
}

let failure;
try {
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610040076"], undefined, false);
  if (!sql(fixture).includes("ATOMIC_INVENTORY_077_FIXTURE_OK")) {
    throw new Error("migration 077 inventory-upgrade fixture marker missing");
  }
  run("supabase", ["migration", "up", "--local"], undefined, false);
  if (!sql(verify).includes("ATOMIC_INVENTORY_078_RECOVERY_OK")) {
    throw new Error("migration 078 inventory recovery verification marker missing");
  }
} catch (error) {
  failure = error;
} finally {
  try { run("supabase", ["db", "reset", "--local", "--no-seed"], undefined, false); }
  catch (restoreError) { if (!failure) failure = restoreError; }
}
if (failure) throw failure;

console.log("Migration 077 invalidation recovers through migration 078 and permits a fresh invitation.");

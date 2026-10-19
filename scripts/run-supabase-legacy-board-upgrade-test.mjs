import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const seed = fileURLToPath(new URL("../tests/integration/legacy-board-083-upgrade-seed.sql", import.meta.url));
const verify = fileURLToPath(new URL("../tests/integration/legacy-board-084-upgrade-verify.sql", import.meta.url));

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
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610190083"], undefined, false);
  if (!sql(seed).includes("LEGACY_BOARD_083_UPGRADE_SEED_OK")) {
    throw new Error("migration 083 legacy-board upgrade seed marker missing");
  }
  run("supabase", ["migration", "up", "--local"], undefined, false);
  if (!sql(verify).includes("LEGACY_BOARD_084_UPGRADE_VERIFY_OK")) {
    throw new Error("migration 084 legacy-board upgrade verification marker missing");
  }
} catch (error) {
  failure = error;
} finally {
  try { run("supabase", ["db", "reset", "--local", "--no-seed"], undefined, false); }
  catch (restoreError) { if (!failure) failure = restoreError; }
}
if (failure) throw failure;

console.log("Migration 083 legacy board entitlements upgrade safely through migration 084 with terminal replay integrity.");

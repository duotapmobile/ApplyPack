import { spawnSync } from "node:child_process";

// Only the disposable local stack is selected. Positive historical activation
// remains tested at086;087 refuses incomplete cleanup support and099 installs
// the reviewed local schema while preserving the purchasing lock.
function run(command, args, expected) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) throw result.error ?? new Error("RETENTION_LOCAL_UPGRADE_PROCESS_FAILED");
  if (expected && !result.stdout.includes(expected)) throw new Error("RETENTION_LOCAL_UPGRADE_PROOF_MISSING");
}
let failure;
try {
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610230086"]);
  run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-086"], "Database contract fixtures passed: 19. Schema phase: 202610230086.");
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610240087"]);
  run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-087"], "Database contract fixtures passed: 1. Schema phase: 202610240087.");
  run("supabase", ["migration", "up", "--local"]);
  run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs"], "Database contract fixtures passed: 15. Schema phase: 202610250100.");
} catch (error) { failure = error; }
finally {
  try { run("supabase", ["db", "reset", "--local", "--no-seed"]); }
  catch (error) { if (!failure) failure = error; }
}
if (failure) throw failure;
console.log("All 19 historical086 contract fixtures, historical087 missing-executor guard and fourteen current099 fixtures passed; latest disposable local schema restored.");

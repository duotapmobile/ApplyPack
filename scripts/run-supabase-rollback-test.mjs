import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sqlPath = fileURLToPath(new URL("../supabase/rollback/202609040022_corrected_chunk1_foundation.rollback.sql", import.meta.url));
const input = readFileSync(sqlPath, "utf8") + "\nselect case when to_regclass('public.orders') is not null and to_regclass('public.ap_anonymous_drafts') is null then 'ROLLBACK_OK' else 'ROLLBACK_FAILED' end;\n";
const result = spawnSync("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
  encoding: "utf8",
  input,
  stdio: ["pipe", "pipe", "pipe"],
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0 || !result.stdout.includes("ROLLBACK_OK")) process.exit(result.status || 1);

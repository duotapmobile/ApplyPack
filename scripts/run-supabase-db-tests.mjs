import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sqlPath = fileURLToPath(new URL("../tests/integration/chunk1-foundation.sql", import.meta.url));
const result = spawnSync("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
  encoding: "utf8",
  input: readFileSync(sqlPath, "utf8"),
  stdio: ["pipe", "pipe", "pipe"],
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exit(result.status ?? 1);

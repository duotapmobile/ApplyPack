import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const expectedPath = fileURLToPath(new URL("../src/lib/database.types.ts", import.meta.url));
const result = spawnSync("supabase", ["gen", "types", "typescript", "--local"], { encoding: "utf8" });
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const normalize = (value) => value.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").trimEnd() + "\n";
if (normalize(result.stdout) !== normalize(readFileSync(expectedPath, "utf8"))) {
  console.error("Generated database types are stale. Run: supabase gen types typescript --local");
  process.exit(1);
}
console.log("Generated database types match the local migrated schema.");

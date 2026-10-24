import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Upgrade this together with the CI pin and reviewed generated types.
export const SUPABASE_CLI_VERSION = "2.116.0";
const expectedPath = fileURLToPath(new URL("../src/lib/database.types.ts", import.meta.url));
const normalize = (value) => value.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").trimEnd() + "\n";

export function checkDatabaseTypes({
  run = spawnSync,
  readExpected = () => readFileSync(expectedPath, "utf8"),
  writeStderr = (value) => process.stderr.write(value),
  log = console.log,
} = {}) {
  const command = (args) => {
    const result = run("supabase", args, { encoding: "utf8" });
    if (result.stderr) writeStderr(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Supabase ${args.join(" ")} failed (exit ${result.status ?? "unknown"}).`);
    }
    return result.stdout;
  };
  const version = command(["--version"]).trim();
  if (version !== SUPABASE_CLI_VERSION) {
    throw new Error(`Supabase CLI ${SUPABASE_CLI_VERSION} is required for database type generation; found ${version || "no version"}. Install the pinned version before checking or regenerating types.`);
  }
  log(`Checking database types with Supabase CLI ${version}.`);
  const generated = normalize(command(["gen", "types", "typescript", "--local"]));
  const expected = normalize(readExpected());
  if (generated !== expected) {
    const generatedLines = generated.split("\n");
    const expectedLines = expected.split("\n");
    const lineCount = Math.max(generatedLines.length, expectedLines.length);
    let firstDifference = 0;
    while (firstDifference < lineCount && generatedLines[firstDifference] === expectedLines[firstDifference]) firstDifference += 1;
    throw new Error(`Generated database types are stale (first difference at line ${firstDifference + 1}, Supabase CLI ${version}). Review the schema difference, then run: supabase gen types typescript --local`);
  }
  log("Generated database types match the local migrated schema.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkDatabaseTypes();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database type check failed.");
    process.exitCode = 1;
  }
}

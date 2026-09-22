import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixtures = [
  "../tests/integration/unpaid-source-retention.sql",
  "../tests/integration/chunk1-foundation.sql",
  "../tests/integration/chunk2-four-step.sql",
  "../tests/integration/chunk3-matching-engine.sql",
  "../tests/integration/chunk4-commerce-release.sql",
  "../tests/integration/chunk5-materials-delivery.sql",
  "../tests/integration/chunk6-final-integration.sql",
  "../tests/integration/employer-first-aggregation.sql",
  "../tests/integration/matching-fulfillment.sql",
];
for (const fixture of fixtures) {
  const sqlPath = fileURLToPath(new URL(fixture, import.meta.url));
  // stdin-fed psql cannot resolve repository-relative includes inside Docker.
  // Expand this single reviewed, local helper; no arbitrary include paths.
  const sql = readFileSync(sqlPath, "utf8").replace(/^\\ir reviewed-source-fixture\.sql\r?$/gm,
    () => readFileSync(fileURLToPath(new URL("../tests/integration/reviewed-source-fixture.sql", import.meta.url)), "utf8"));
  const result = spawnSync("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    encoding: "utf8", input: sql, stdio: ["pipe", "pipe", "pipe"], timeout: 60_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Database contract fixtures passed: ${fixtures.length}.`);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLaunchImageScan } from "./assert-launch-image-scan.mjs";

export function assertDatabaseRecoveryImageScan(report) {
  const result = assertLaunchImageScan(report);
  const packages = report.Results.filter((entry) => entry.Class === "os-pkgs").flatMap((entry) => entry.Packages || []);
  assert(packages.some((entry) => entry.Name === "postgresql-client-17" && /^17\.11(?:-|$)/u.test(entry.Version)),
    "the pinned PostgreSQL client must be included in OS vulnerability coverage");
  return { ...result, postgresClient: "17.11", purpose: "database-recovery" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("DATABASE_RECOVERY_SCAN_ARGUMENTS");
  console.log(JSON.stringify(assertDatabaseRecoveryImageScan(JSON.parse(readFileSync(process.argv[2], "utf8")))));
}

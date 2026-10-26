import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { current097LockedPhaseSql, current098LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";
import { DATABASE_RECOVERY } from "./lib/database-recovery-protocol.mjs";
import { DATABASE_RECOVERY_REQUIRED_TABLES, DATABASE_RECOVERY_SOURCE } from "./lib/database-recovery-source.mjs";
import { RECOVERY_TABLES } from "./lib/protected-recovery-protocol.mjs";
import { loadRetentionPostgresInputs } from "./run-service-retention-postgres17.mjs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
test("098 is a disabled, locked new phase without rewriting097", () => {
  assert(current097LockedPhaseSql.includes("distinct from '202610250097'"));
  assert(!current097LockedPhaseSql.includes("202610250098"));
  for (const part of ["distinct from '202610250098'", "ap_protected_archive_schema_installed()",
    "PROTECTED_ARCHIVE_LIFECYCLE", "ap_archive_lifecycle_configuration where singleton and not enabled",
    "exists(select 1 from public.ap_archive_writer_runs)", "exists(select 1 from public.ap_archive_retention_runs)",
    "not enabled and policy_id is null", "mode='LOCKED'", "not checkout_enabled"])
    assert(current098LockedPhaseSql.includes(part), part);
});

test("database recovery covers all six operational archive tables without inventing storage aliases", () => {
  assert.equal(DATABASE_RECOVERY.schemaVersion, "202610250098");
  assert.equal(DATABASE_RECOVERY_SOURCE.schemaVersion, "202610250098");
  assert.equal(DATABASE_RECOVERY_REQUIRED_TABLES.length, 21);
  for (const name of ["ap_archive_lifecycle_configuration", "ap_archive_writer_runs", "ap_archive_retention_runs",
    "ap_archive_retention_versions", "ap_archive_fence_relations", "ap_archive_fence_function_contracts"]) {
    assert(DATABASE_RECOVERY_REQUIRED_TABLES.includes(name), name);
    assert(!RECOVERY_TABLES.includes(name), name);
  }
});

test("current PG17 proof executes actual archive races before subsequent retained customer races", () => {
  const input = loadRetentionPostgresInputs();
  assert.equal(input.migrationCount, 103);
  const fixtures = input.hashes.filter((item) => item.kind === "fixture").map((item) => item.name);
  assert.equal(fixtures.length, 15);
  for (const name of ["protected-archive-limited-role.sql", "protected-archive-lifecycle.sql", "protected-archive-races.sql", "service-retention-races.sql"])
    assert(fixtures.includes(name), name);
  assert(fixtures.indexOf("protected-archive-lifecycle.sql") < fixtures.indexOf("protected-archive-races.sql"));
  assert(fixtures.indexOf("protected-archive-races.sql") < fixtures.indexOf("service-retention-races.sql"));
  assert(input.sql.includes("ap_archive_fence_coverage_current()"));
  assert(input.sql.includes("dblink_send_query"));
});

test("the upgrade preserves exact097 before applying098 and keeps the former proof", () => {
  const runner = read("./run-supabase-rehearsal-upgrade-test.mjs");
  for (const part of ['prepareHistoricalWorkspace("202610250097")', 'prepareHistoricalWorkspace("202610250098")',
    '"--historical-097"', "Database contract fixtures passed: 12. Schema phase: 202610250097.",
    "Database contract fixtures passed: 13. Schema phase: 202610250098.", "All eighteen launch upgrade predecessors passed"])
    assert(runner.includes(part), part);
  assert(runner.indexOf("ARCHIVE_LIFECYCLE_098_UPGRADE_PRESERVED") > runner.indexOf("DRAFT_CHANGE_097_UPGRADE_PRESERVED"));
  const verify = read("../tests/integration/archive-lifecycle-upgrade-verify.sql");
  assert(verify.includes("ARCHIVE_LIFECYCLE_098_UPGRADE_PRESERVED"));
  assert(verify.includes("extensions.digest"));
  assert(verify.includes("ap_archive_lifecycle_configuration"));
  const guard = read("./test-production-database-guard.ps1");
  assert(guard.includes("GUARD_097_ONLY_SUFFIX_FIXTURE_INVALID"));
  assert(guard.includes("GUARD_098_ONLY_SUFFIX_FIXTURE_INVALID"));
  assert(read("./run-supabase-rollback-test.mjs").includes('REQUIRED_LAUNCH_SCHEMA_VERSION = "202610250098"'));
});

test("required CI covers098 and the independent monitor without replacing097", () => {
  const ci = read("../.github/workflows/ci.yml"), scripts = JSON.parse(read("../package.json")).scripts;
  assert(ci.includes("npm run test:draft-change-migration"));
  assert(ci.includes("npm run test:archive-lifecycle-migration"));
  assert(ci.includes("npm run test:archive-lifecycle"));
  assert(ci.includes("scripts/operations-monitor.test.mjs"));
  assert.equal(scripts["test:archive-lifecycle-migration"], "node scripts/run-windows-release-self-test.mjs rehearsal-098");
  assert(scripts["test:archive-lifecycle"].includes("scripts/archive-lifecycle-integration.test.mjs"));
  const env = read("../.env.example");
  for (const name of ["APP_ARCHIVE_LIFECYCLE_ENABLED", "APP_ARCHIVE_RETENTION_EXECUTION_ENABLED", "APP_ARCHIVE_VERIFICATION_ENABLED"])
    assert(env.includes(`${name}=false`), name);
});

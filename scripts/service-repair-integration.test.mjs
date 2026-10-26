import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { current098LockedPhaseSql, current099LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";
import { DATABASE_RECOVERY } from "./lib/database-recovery-protocol.mjs";
import { DATABASE_RECOVERY_REQUIRED_TABLES, DATABASE_RECOVERY_SOURCE } from "./lib/database-recovery-source.mjs";
import { RECOVERY_TABLES } from "./lib/protected-recovery-protocol.mjs";
import { recoverySourceColumns } from "./lib/protected-recovery-source.mjs";
import { loadRetentionPostgresInputs } from "./run-service-retention-postgres17.mjs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const tables = ["ap_service_repair_jobs", "ap_service_repair_versions", "ap_service_repair_files",
  "ap_service_repair_releases", "ap_service_repair_case_events", "ap_service_repair_feedback"];

test("099 appends its own locked phase without rewriting the historical098 check", () => {
  assert(current098LockedPhaseSql.includes("distinct from '202610250098'"));
  assert(!current098LockedPhaseSql.includes("202610250099"));
  for (const part of ["distinct from '202610250099'", "ap_service_repair_schema_installed()", "SCOPED_SERVICE_ERROR_REPAIRS",
    "PROTECTED_ARCHIVE_LIFECYCLE", "MATERIAL_DRAFT_CHANGE_REQUESTS", "SERVICE_ERROR_CONTRACT_AND_TRIAGE",
    "not enabled and policy_id is null", "mode='LOCKED'", "not checkout_enabled",
    "ap_archive_lifecycle_configuration where singleton and not enabled"])
    assert(current099LockedPhaseSql.includes(part), part);
  for (const table of tables) assert(current099LockedPhaseSql.includes(`exists(select 1 from public.${table})`), table);
});

test("current database export includes all six repair tables and file enumeration reads only finite metadata", () => {
  assert.equal(DATABASE_RECOVERY.schemaVersion, "202610250099");
  assert.equal(DATABASE_RECOVERY_SOURCE.schemaVersion, "202610250099");
  assert.equal(DATABASE_RECOVERY_REQUIRED_TABLES.length, 27);
  assert.equal(new Set(DATABASE_RECOVERY_REQUIRED_TABLES).size, 27);
  for (const table of tables) assert(DATABASE_RECOVERY_REQUIRED_TABLES.includes(table), table);
  assert(RECOVERY_TABLES.includes("ap_service_repair_files"));
  assert.deepEqual(recoverySourceColumns.ap_service_repair_files.split(","), ["id", "artifact_id", "storage_bucket", "storage_path",
    "checksum_sha256", "preview_bucket", "preview_path", "preview_sha256", "editable_bucket", "editable_path", "editable_sha256"]);
  for (const table of tables.filter((name) => name !== "ap_service_repair_files")) assert(!RECOVERY_TABLES.includes(table));
});

test("the actual pinned PG17 input contains099 plus the existing restricted-role and race proofs", () => {
  const input = loadRetentionPostgresInputs(); assert.equal(input.migrationCount, 104);
  const fixtures = input.hashes.filter((value) => value.kind === "fixture").map((value) => value.name);
  assert.equal(fixtures.length, 16);
  for (const name of ["scoped-service-error-repairs.sql", "protected-archive-limited-role.sql", "protected-archive-races.sql", "service-retention-races.sql"])
    assert(fixtures.includes(name), name);
  assert(input.sql.includes("SCOPED_SERVICE_ERROR_REPAIRS_OK"));
  assert(input.sql.includes("dblink_send_query"));
});

test("upgrade rehearsal preserves exact098 before099, with the full nineteen-predecessor path", () => {
  const source = read("./run-supabase-rehearsal-upgrade-test.mjs");
  for (const text of ['prepareHistoricalWorkspace("202610250098")', 'prepareHistoricalWorkspace("202610250099")',
    '"--historical-098"', "Database contract fixtures passed: 13. Schema phase: 202610250098.",
    "Database contract fixtures passed: 14. Schema phase: 202610250099.", "All nineteen launch upgrade predecessors passed"])
    assert(source.includes(text), text);
  assert(source.indexOf("SERVICE_REPAIR_099_UPGRADE_PRESERVED") > source.indexOf("ARCHIVE_LIFECYCLE_098_UPGRADE_PRESERVED"));
  assert(read("../tests/integration/service-repair-upgrade-seed.sql").includes("202610250098"));
  assert(read("../tests/integration/service-repair-upgrade-verify.sql").includes("SERVICE_REPAIR_099_UPGRADE_PRESERVED"));
  for (const phase of ["097", "098", "099"]) assert(read("./test-production-database-guard.ps1").includes(`GUARD_${phase}_ONLY_SUFFIX_FIXTURE_INVALID`));
});

test("required CI adds099 checks without dropping historical release controls", () => {
  const ci = read("../.github/workflows/ci.yml"), scripts = JSON.parse(read("../package.json")).scripts;
  for (const name of ["test:service-repair-migration", "test:service-repair-integration", "test:archive-lifecycle-migration", "test:draft-change-migration"])
    assert(ci.includes(`npm run ${name}`), name);
  assert.equal(scripts["test:service-repair-migration"], "node scripts/run-windows-release-self-test.mjs rehearsal-099");
  assert.equal(scripts["test:service-repair-integration"], "node --test scripts/service-repair-integration.test.mjs");
  assert(read("./run-supabase-rollback-test.mjs").includes('REQUIRED_LAUNCH_SCHEMA_VERSION = "202610250099"'));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { current100LockedPhaseSql, current101LockedPhaseSql, current102LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";
import { DATABASE_RECOVERY } from "./lib/database-recovery-protocol.mjs";
import { DATABASE_RECOVERY_SOURCE, DATABASE_RECOVERY_REQUIRED_TABLES } from "./lib/database-recovery-source.mjs";
import { RECOVERY_TABLES } from "./lib/protected-recovery-protocol.mjs";
import { ARCHIVE_DATABASE_READ_VERSIONS } from "./lib/recovery-archive-history.mjs";
import { REHEARSAL_PREDECESSORS, REHEARSAL_TARGET_VERSION } from "./lib/rehearsal-upgrade-selection.mjs";
import { loadRetentionPostgresInputs } from "./run-service-retention-postgres17.mjs";
const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const tables = ["ap_intake_clarifications", "ap_intake_inherited_documents", "ap_intake_clarification_answers"];

test("100 remains exact;101 and102 require their own guarded capabilities while launch stays locked", () => {
  assert(current100LockedPhaseSql.includes("distinct from '202610250100'"));
  assert(!current100LockedPhaseSql.includes("202610250101") && !current100LockedPhaseSql.includes("202610260102"));
  assert(current101LockedPhaseSql.includes("distinct from '202610250101'"));
  assert(!current101LockedPhaseSql.includes("202610260102"));
  for (const source of [current101LockedPhaseSql, current102LockedPhaseSql]) {
    for (const text of ["ap_material_clarification_schema_installed()", "MATERIAL_CLARIFICATION_CONFIRMATION", "AUTOMATIC_RESEARCH_PREPARATION",
      "not enabled and policy_id is null", "not enabled and cardinality(configuration_ids)=0", "mode='LOCKED'", "not checkout_enabled"])
      assert(source.includes(text), text);
  }
  for (const text of ["distinct from '202610260102'", "ap_service_repair_case_state_schema_installed()", "SERVICE_REPAIR_CASE_STATE_CAS"])
    assert(current102LockedPhaseSql.includes(text), text);
});

test("all101 database metadata is required for recovery without inventing duplicate storage aliases", () => {
  assert.equal(DATABASE_RECOVERY.schemaVersion, "202610260102");
  assert.equal(DATABASE_RECOVERY_SOURCE.schemaVersion, "202610260102");
  assert.equal(DATABASE_RECOVERY_REQUIRED_TABLES.length, 33);
  assert.equal(new Set(DATABASE_RECOVERY_REQUIRED_TABLES).size, 33);
  assert.equal(RECOVERY_TABLES.length, 11);
  for (const table of tables) { assert(DATABASE_RECOVERY_REQUIRED_TABLES.includes(table)); assert(!RECOVERY_TABLES.includes(table)); }
  for (const version of ["202610250100", "202610250101", "202610260102"]) assert(ARCHIVE_DATABASE_READ_VERSIONS.includes(version));
  assert(!ARCHIVE_DATABASE_READ_VERSIONS.includes("202610260103"));
  const migration = read("../supabase/migrations/202610250101_material_clarification_confirmation.sql");
  for (const table of tables) assert(migration.includes(table));
  assert(migration.includes("ap_retention_snapshot_customers_before_101"));
  assert(!/drop\s+(?:index|constraint)[^;]*storage_path/iu.test(migration));
});

test("actual PG17 input retains every prior fixture and adds real101 and102 races with finite nested helpers", () => {
  const input = loadRetentionPostgresInputs(); assert.equal(input.migrationCount, 107);
  const fixtures = input.hashes.filter(item => item.kind === "fixture").map(item => item.name);
  assert.equal(fixtures.length, 21); assert.equal(new Set(fixtures).size, 21);
  for (const name of ["material-clarification-confirmation.sql", "material-clarification-races.sql", "service-repair-case-state.sql",
    "service-repair-case-state-races.sql", "service-retention-races.sql", "protected-archive-limited-role.sql", "protected-archive-races.sql", "material-draft-stage-claiming.sql"])
    assert(fixtures.includes(name), name);
  assert(input.hashes.some(item => item.kind === "helper" && item.name === "service-repair-case-state-fixture.sql"));
  assert(!/^\s*\\ir /mu.test(input.sql));
  assert(input.sql.includes("dblink_send_query"));
  assert(input.sql.includes("SERVICE_REPAIR_CASE_STATE_CAS"));
});

test("all22 predecessors preserve the exact100-to101-to102 sequence before the current contract group", () => {
  assert.equal(REHEARSAL_TARGET_VERSION, "202610260102"); assert.equal(REHEARSAL_PREDECESSORS.length, 22);
  assert.deepEqual(REHEARSAL_PREDECESSORS.slice(-2), ["202610250100", "202610250101"]);
  const runner = read("./run-supabase-rehearsal-upgrade-test.mjs");
  for (const text of ['prepareHistoricalWorkspace("202610250100")', 'prepareHistoricalWorkspace("202610250101")', 'prepareHistoricalWorkspace("202610260102")',
    '"--historical-100"', '"--historical-101"', "Database contract fixtures passed: 15. Schema phase: 202610250100.",
    "Database contract fixtures passed: 16. Schema phase: 202610250101.", "Database contract fixtures passed: 17. Schema phase: 202610260102."])
    assert(runner.includes(text), text);
  const points = ["AUTOMATIC_RESEARCH_100_UPGRADE_PRESERVED", "MATERIAL_CLARIFICATION_101_UPGRADE_PRESERVED", "SERVICE_REPAIR_CASE_STATE_102_UPGRADE_PRESERVED"].map(text => runner.indexOf(text));
  assert(points.every((point, index) => point > 0 && (index === 0 || point > points[index - 1])));
  assert(read("../tests/integration/service-repair-case-state-upgrade-seed.sql").includes("case_state_upgrade_exact_101_required"));
  assert(read("../tests/integration/service-repair-case-state-upgrade-verify.sql").includes("case_state_upgrade_modified_existing"));
});

test("controlled Windows and actual committed route harness require exact final schema without enabling providers", () => {
  const stage = read("./apply-staging-rehearsal-migration.ps1"), guard = read("./test-production-database-guard.ps1");
  for (const name of ["ExpectedMaterialClarificationMigrationSha256", "ExpectedRepairCaseStateMigrationSha256"])
    assert(stage.includes(`$${name}`) && stage.includes(`'${name}'`));
  for (const phase of ["099", "100", "101", "102"]) assert(guard.includes(`GUARD_${phase}_ONLY_SUFFIX_FIXTURE_INVALID`));
  const ci = read("../.github/workflows/ci.yml");
  for (const name of ["material-clarification-migration", "repair-case-state-migration", "material-clarification-integration"]) assert(ci.includes(`npm run test:${name}`));
  const route = read("./run-research-postgres17.mjs");
  assert(route.includes("schema='202610260102'"));
  assert(route.includes("for(const scenario of ['QUALIFIED','LIMITED'])"));
  assert(route.includes("RESEARCH_GIT_BYTES_CHANGED"));
  assert(ci.includes("needs: [database-core, database-upgrade, research-route-journey]"));
});

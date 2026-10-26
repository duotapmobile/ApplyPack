import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { current099LockedPhaseSql, current100LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";
import { DATABASE_RECOVERY } from "./lib/database-recovery-protocol.mjs";
import { DATABASE_RECOVERY_REQUIRED_TABLES, DATABASE_RECOVERY_SOURCE } from "./lib/database-recovery-source.mjs";
import { RECOVERY_TABLES } from "./lib/protected-recovery-protocol.mjs";
import { ARCHIVE_DATABASE_READ_VERSIONS } from "./lib/recovery-archive-history.mjs";
import { loadRetentionPostgresInputs } from "./run-service-retention-postgres17.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const tables=["ap_research_preparation_configuration","ap_research_preparations","ap_research_preparation_sources"];

test("100 adds an inactive research phase and preserves the exact099 contract",()=>{
  assert(current099LockedPhaseSql.includes("distinct from '202610250099'"));
  assert(!current099LockedPhaseSql.includes("202610250100"));
  for(const value of ["distinct from '202610250100'","ap_automatic_research_schema_installed()","AUTOMATIC_RESEARCH_PREPARATION",
    "SCOPED_SERVICE_ERROR_REPAIRS","not enabled and cardinality(configuration_ids)=0","mode='LOCKED'","not checkout_enabled"])
    assert(current100LockedPhaseSql.includes(value),value);
});
test("database recovery includes all three metadata tables without inventing file paths",()=>{
  assert.equal(DATABASE_RECOVERY.schemaVersion,"202610260102");assert.equal(DATABASE_RECOVERY_SOURCE.schemaVersion,"202610260102");
  assert.equal(DATABASE_RECOVERY_REQUIRED_TABLES.length,33);assert.equal(new Set(DATABASE_RECOVERY_REQUIRED_TABLES).size,33);
  for(const table of tables){assert(DATABASE_RECOVERY_REQUIRED_TABLES.includes(table));assert(!RECOVERY_TABLES.includes(table));}
  assert(ARCHIVE_DATABASE_READ_VERSIONS.includes("202610250099"));assert(ARCHIVE_DATABASE_READ_VERSIONS.includes("202610250100"));assert(!ARCHIVE_DATABASE_READ_VERSIONS.includes("202610260199"));
});
test("pinned PG17 receives the actual research controls and all historical race fixtures",()=>{
  const input=loadRetentionPostgresInputs();assert.equal(input.migrationCount,107);
  const fixtures=input.hashes.filter(x=>x.kind==="fixture").map(x=>x.name);assert.equal(fixtures.length,21);
  for(const name of ["automatic-research-preparation.sql","scoped-service-error-repairs.sql","protected-archive-limited-role.sql","protected-archive-races.sql","service-retention-races.sql"])assert(fixtures.includes(name));
  assert(input.sql.includes("research_retention_locked"));assert(input.sql.includes("for i in 1..51 loop"));
});
test("exact099 history precedes100 with all20 upgrade boundaries",()=>{
  const source=read("./run-supabase-rehearsal-upgrade-test.mjs");
  for(const value of ['prepareHistoricalWorkspace("202610250100")','"--historical-099"',"Database contract fixtures passed: 14. Schema phase: 202610250099.","Database contract fixtures passed: 15. Schema phase: 202610250100.","All twenty-two launch upgrade predecessors passed"])assert(source.includes(value),value);
  assert(source.indexOf("AUTOMATIC_RESEARCH_100_UPGRADE_PRESERVED")>source.indexOf("SERVICE_REPAIR_099_UPGRADE_PRESERVED"));
  for(const phase of ["098","099","100"])assert(read("./test-production-database-guard.ps1").includes(`GUARD_${phase}_ONLY_SUFFIX_FIXTURE_INVALID`));
  const seed=read("../tests/integration/research-preparation-upgrade-seed.sql");assert(seed.includes("202610250099"));assert(!seed.includes("then continue;"));
});
test("controlled100 Windows execution binds its exact file hash and stays separate from enabling research",()=>{
  const stage=read("./apply-staging-rehearsal-migration.ps1"),ci=read("../.github/workflows/ci.yml"),pkg=JSON.parse(read("../package.json"));
  assert(stage.includes("$ExpectedAutomaticResearchMigrationSha256"));assert(stage.includes("'ExpectedAutomaticResearchMigrationSha256'"));
  for(const name of ["test:automatic-research-migration","test:automatic-research-integration","test:service-repair-migration","test:service-repair-integration"])assert(ci.includes(`npm run ${name}`));
  assert.equal(pkg.scripts["test:automatic-research-migration"],"node scripts/run-windows-release-self-test.mjs rehearsal-100");
  assert(read("./run-supabase-rollback-test.mjs").includes('REQUIRED_LAUNCH_SCHEMA_VERSION = "202610260102"'));
});

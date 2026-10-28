import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { current096LockedPhaseSql, current097LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";
import { DATABASE_RECOVERY } from "./lib/database-recovery-protocol.mjs";
import { DATABASE_RECOVERY_REQUIRED_TABLES, DATABASE_RECOVERY_SOURCE } from "./lib/database-recovery-source.mjs";
import { RECOVERY_TABLES } from "./lib/protected-recovery-protocol.mjs";
import { loadRetentionPostgresInputs } from "./run-service-retention-postgres17.mjs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
test("097 is separately locked and096 remains an exact historical phase", () => {
  assert(current096LockedPhaseSql.includes("distinct from '202610250096'"));
  assert(!current096LockedPhaseSql.includes("202610250097"));
  for (const fragment of ["distinct from '202610250097'", "ap_material_draft_change_schema_installed()",
    "MATERIAL_DRAFT_CHANGE_REQUESTS", "SERVICE_ERROR_CONTRACT_AND_TRIAGE", "ap_service_error_triage_schema_installed()",
    "exists(select 1 from public.ap_material_draft_change_requests)", "not enabled and policy_id is null", "mode='LOCKED'", "not checkout_enabled"])
    assert(current097LockedPhaseSql.includes(fragment), fragment);
});
test("the encrypted request metadata is covered by whole database recovery without inventing a file alias", () => {
  assert.equal(DATABASE_RECOVERY.schemaVersion, "202610280106");
  assert.equal(DATABASE_RECOVERY_SOURCE.schemaVersion, "202610280106");
  assert(DATABASE_RECOVERY_REQUIRED_TABLES.includes("ap_material_draft_owner_notices"));
  assert(!RECOVERY_TABLES.includes("ap_material_draft_owner_notices"));
  assert(DATABASE_RECOVERY_REQUIRED_TABLES.includes("ap_material_draft_change_requests"));
  assert(!RECOVERY_TABLES.includes("ap_material_draft_change_requests"));
  const migration = read("../supabase/migrations/202610250097_material_draft_change_requests.sql");
  assert(migration.includes("values('ap_material_draft_change_requests','id','{}')"));
  assert(migration.includes("execute function public.ap_guard_service_retention_write()"));
});
test("current PG17 inputs include the request fixture before independently connected races", () => {
  const input = loadRetentionPostgresInputs();
  assert.equal(input.migrationCount, 111);
  const fixtures = input.hashes.filter((entry) => entry.kind === "fixture").map((entry) => entry.name);
  assert.equal(fixtures.length, 29);
  for (const name of ["owner-draft-notices.sql", "owner-draft-notices-races.sql"]) assert(fixtures.includes(name), name);
  assert(fixtures.includes("protected-archive-limited-role.sql"));
  assert(fixtures.includes("material-draft-change-requests.sql"));
  assert(fixtures.indexOf("material-draft-change-requests.sql") < fixtures.indexOf("service-retention-races.sql"));
  assert(input.sql.includes("exhausted configured policy invalidated the approved current version"));
  assert(input.sql.includes("dblink_send_query"));
});
test("the upgrade runner proves096 before applying097 and preserves original rows and budget body", () => {
  const runner = read("./run-supabase-rehearsal-upgrade-test.mjs");
  for (const value of ['prepareHistoricalWorkspace("202610250096")', 'prepareHistoricalWorkspace("202610250097")',
    '"--historical-096"', "Database contract fixtures passed: 11. Schema phase: 202610250096.",
    "Database contract fixtures passed: 12. Schema phase: 202610250097."]) assert(runner.includes(value), value);
  assert(runner.indexOf("DRAFT_CHANGE_097_UPGRADE_PRESERVED") > runner.indexOf("SERVICE_ERROR_096_UPGRADE_PRESERVED"));
  const verify = read("../tests/integration/draft-change-upgrade-verify.sql");
  assert(verify.includes("draft_change_upgrade_modified_existing"));
  assert(verify.includes("ap_begin_material_draft_request_before097"));
  assert(verify.includes("extensions.digest(p.prosrc,'sha256')"));
  assert(!/do \$(?!\$) begin/u.test(runner));
});
test("required CI and Windows self-test controls include097 without replacing096", () => {
  const ci = read("../.github/workflows/ci.yml"), scripts = JSON.parse(read("../package.json")).scripts;
  assert(ci.includes("scripts/draft-change-integration.test.mjs"));
  assert(ci.includes("npm run test:service-error-migration"));
  assert(ci.includes("npm run test:draft-change-migration"));
  assert.equal(scripts["test:draft-change-migration"], "node scripts/run-windows-release-self-test.mjs rehearsal-097");
  const rollback = read("./run-supabase-rollback-test.mjs");
  for (const id of ["202610250095", "202610250096", "202610250097"]) assert(rollback.includes(`'"${id}"'`));
});

test("all final upgrade assertions require106 after the unchanged historical proofs", () => {
  for (const file of ["run-supabase-legal-upgrade-test.mjs", "run-supabase-inventory-upgrade-test.mjs", "run-supabase-legacy-board-upgrade-test.mjs"]) {
    const source = read(`./${file}`);
    assert(source.includes("current106LockedPhaseSql"), file);
    assert(!source.includes("current095LockedPhaseSql"), file);
    assert(source.includes("202610230086" ) || source.includes("historical086PhaseSql"), file);
  }
});

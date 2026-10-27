import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { current095LockedPhaseSql, current096LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";
import { DATABASE_RECOVERY_REQUIRED_TABLES, DATABASE_RECOVERY_SOURCE } from "./lib/database-recovery-source.mjs";
import { RECOVERY_TABLES } from "./lib/protected-recovery-protocol.mjs";

test("096 is a distinct inactive reporting checkpoint and095 stays exact", () => {
  assert(current095LockedPhaseSql.includes("distinct from '202610250095'")); assert(!current095LockedPhaseSql.includes("202610250096"));
  assert(current096LockedPhaseSql.includes("distinct from '202610250096'")); assert(current096LockedPhaseSql.includes("ap_service_error_triage_schema_installed()"));
  assert(current096LockedPhaseSql.includes("SERVICE_ERROR_CONTRACT_AND_TRIAGE")); assert(current096LockedPhaseSql.includes("exists(select 1 from public.ap_service_error_contracts)"));
  assert(current096LockedPhaseSql.includes("not enabled and policy_id is null")); assert(current096LockedPhaseSql.includes("not checkout_enabled"));
});
test("the four private metadata tables are database coverage, not fabricated file aliases", () => {
  assert.equal(DATABASE_RECOVERY_SOURCE.schemaVersion, "202610270105");
  for (const table of ["ap_service_error_contracts", "ap_service_error_reports", "ap_service_error_decisions", "ap_service_error_affected_members"]) {
    assert(DATABASE_RECOVERY_REQUIRED_TABLES.includes(table)); assert(!RECOVERY_TABLES.includes(table));
  }
});
test("historical095 proof precedes a distinct096 preservation proof", () => {
  const source = readFileSync(new URL("./run-supabase-rehearsal-upgrade-test.mjs", import.meta.url), "utf8");
  assert(source.includes('prepareHistoricalWorkspace("202610250095")')); assert(source.includes('"--historical-095"'));
  assert(source.indexOf("SERVICE_ERROR_096_UPGRADE_PRESERVED") > source.indexOf("REFERENCE_DRAFT_095_UPGRADE_PRESERVED"));
  assert(source.includes("Database contract fixtures passed: 12. Schema phase: 202610250097."));
  assert(!/do \$(?!\$) begin/u.test(source));
  const verify = readFileSync(new URL("../tests/integration/service-error-upgrade-verify.sql", import.meta.url), "utf8");
  assert(verify.includes("service_error_upgrade_modified_existing")); assert(verify.includes("ap_retention_private_tables"));
});

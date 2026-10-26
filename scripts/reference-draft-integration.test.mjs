import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { current094LockedPhaseSql, current095LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";
import { loadRetentionPostgresInputs } from "./run-service-retention-postgres17.mjs";

test("095 has a distinct locked capability without rewriting the094 phase", () => {
  assert(current094LockedPhaseSql.includes("distinct from '202610250094'"));
  assert(!current094LockedPhaseSql.includes("202610250095"));
  assert(current095LockedPhaseSql.includes("distinct from '202610250095'"));
  assert(current095LockedPhaseSql.includes("ap_reference_aware_draft_schema_installed()"));
  assert(current095LockedPhaseSql.includes("REFERENCE_AWARE_DRAFT_DELIVERY"));
  assert(current095LockedPhaseSql.includes("not enabled and policy_id is null"));
  assert(current095LockedPhaseSql.includes("not checkout_enabled"));
});
test("the actual PG17 input includes the reference proof before committed race fixtures", () => {
  const input = loadRetentionPostgresInputs();
  const fixtures = input.hashes.filter((row) => row.kind === "fixture").map((row) => row.name);
  assert.equal(input.migrationCount, 102);
  assert(fixtures.indexOf("reference-aware-draft-delivery.sql") < fixtures.indexOf("service-retention-races.sql"));
  assert(input.sql.includes("REFERENCE_AWARE_DRAFT_DELIVERY_OK"));
  assert(input.sql.includes("actual paid deadline has not passed"));
  assert(input.sql.includes("MATERIAL_DRAFT_STAGE_CONCURRENCY_OK"));
});
test("the real upgrade runner retains capped094 preservation before095", () => {
  const runner = readFileSync(new URL("./run-supabase-rehearsal-upgrade-test.mjs", import.meta.url), "utf8");
  const stage = runner.indexOf("DRAFT_STAGE_094_UPGRADE_PRESERVED");
  const reference = runner.indexOf("REFERENCE_DRAFT_095_UPGRADE_PRESERVED");
  assert(stage > 0 && reference > stage);
  assert(runner.includes('prepareHistoricalWorkspace("202610250094")'));
  assert(runner.includes('"--historical-094"'));
  assert(runner.includes("Database contract fixtures passed: 10. Schema phase: 202610250095."));
});

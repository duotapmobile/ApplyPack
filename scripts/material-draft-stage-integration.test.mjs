import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { materialDraftStageContractFixture } from "./lib/material-draft-stage-fixture.mjs";
import { current093LockedPhaseSql, current094LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";

const source = readFileSync(new URL("../tests/integration/material-draft-stage-claiming.sql", import.meta.url), "utf8");
test("generic contract fixtures preserve all stage checks and roll back before isolated races", () => {
  const contract = materialDraftStageContractFixture(source);
  assert(contract.includes("25 exhausted predecessors starved eligible job"));
  assert(contract.includes("expired dispatch not fenced"));
  assert(contract.includes("MATERIAL_DRAFT_STAGE_FILTERS_OK"));
  assert(!contract.includes("commit;")); assert(!contract.includes("dblink_connect"));
  assert(contract.endsWith("rollback;\n"));
  assert(source.includes("MATERIAL_DRAFT_STAGE_CONCURRENCY_OK"));
});
test("changed or ambiguous contract/race boundaries are rejected", () => {
  for (const broken of ["", source.replace("-- BEGIN ISOLATED POSTGRES STAGE RACES", "-- removed"),
    source + "\n-- BEGIN ISOLATED POSTGRES STAGE RACES", source.replace("loopback_stage_fixture_required", "unbounded")]) {
    assert.throws(() => materialDraftStageContractFixture(broken));
  }
});
test("094 is distinct from the unchanged093 phase and keeps provider/commerce disabled", () => {
  assert(!current093LockedPhaseSql.includes("202610250094"));
  assert(current094LockedPhaseSql.includes("distinct from '202610250094'"));
  assert(current094LockedPhaseSql.includes("ap_material_draft_stage_claiming_schema_installed"));
  assert(current094LockedPhaseSql.includes("MATERIAL_DRAFT_STAGE_CLAIMING"));
  assert(current094LockedPhaseSql.includes("not enabled and policy_id is null"));
  assert(current094LockedPhaseSql.includes("not checkout_enabled"));
});

import assert from "node:assert/strict";

// The contract runner rolls fictional records back. Independent-connection
// races need committed rows and run only in the isolated PG17/native harness.
export function materialDraftStageContractFixture(source) {
  const marker = "-- BEGIN ISOLATED POSTGRES STAGE RACES";
  assert(typeof source === "string" && source.split(marker).length === 2, "STAGE_FIXTURE_BOUNDARY_INVALID");
  const [contract, races] = source.split(marker);
  assert(/^begin;\r?\n/u.test(contract) && contract.includes("'MATERIAL_DRAFT_STAGE_FILTERS_OK'"), "STAGE_FIXTURE_CONTRACT_INVALID");
  assert(races.includes("commit;") && races.includes("'MATERIAL_DRAFT_STAGE_CONCURRENCY_OK'")
    && races.includes("loopback_stage_fixture_required"), "STAGE_FIXTURE_RACES_INVALID");
  return `${contract}\nrollback;\n`;
}

import assert from "node:assert/strict";

// The generic Supabase runner executes only the rollback contract section.
// Committed multi-connection races remain mandatory in the isolated PG17 runner.
export function verifiedIntakeOwnershipContractFixture(source) {
  const marker = "-- Independent connections require committed fictional setup.";
  assert(typeof source === "string" && source.split(marker).length === 2, "OWNERSHIP_FIXTURE_BOUNDARY_INVALID");
  const [contract, races] = source.split(marker);
  assert(/^(?:--[^\r\n]*\r?\n)*begin;\r?\n/u.test(contract)
    && /rollback;\r?\nselect 'VERIFIED_INTAKE_OWNERSHIP_OK';\s*$/u.test(contract)
    && !/\bcommit\s*;|\bdblink_/iu.test(contract), "OWNERSHIP_FIXTURE_CONTRACT_INVALID");
  assert(races.includes("current_setting('listen_addresses')<>'127.0.0.1'")
    && races.includes("owned_intake_loopback_fixture_required")
    && races.includes("VERIFIED_INTAKE_OWNERSHIP_REAL_CONNECTION_RACES_OK")
    && races.includes("VERIFIED_CLAIMED_DELIVERY_PIN_CONTENTION_RETRY_OK")
    && [1, 2, 3, 4, 5, 6].every(scenario => races.includes(`select public.owned_intake_race(${scenario})`)), "OWNERSHIP_FIXTURE_RACES_INVALID");
  return contract;
}

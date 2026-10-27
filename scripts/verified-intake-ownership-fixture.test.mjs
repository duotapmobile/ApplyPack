import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifiedIntakeOwnershipContractFixture } from "./lib/verified-intake-ownership-fixture.mjs";
import { loadRetentionPostgresInputs } from "./run-service-retention-postgres17.mjs";

const source = readFileSync(new URL("../tests/integration/verified-intake-ownership.sql", import.meta.url), "utf8");
const marker = "-- Independent connections require committed fictional setup.";

test("generic Supabase executes the complete unchanged rollback ownership contract", () => {
  const contract = verifiedIntakeOwnershipContractFixture(source);
  assert.equal(contract, source.slice(0, source.indexOf(marker)));
  assert.match(contract, /owned_intake_paid_or_checkout/u);
  assert.match(contract, /expired unpaid claim still authorized private question reads/u);
  assert.doesNotMatch(contract, /dblink_|create extension|owned_intake_race\(/u);
  assert.match(contract, /rollback;\r?\nselect 'VERIFIED_INTAKE_OWNERSHIP_OK';\s*$/u);
});

test("ambiguous, truncated or weakened ownership fixture boundaries fail closed", () => {
  for (const broken of ["", source.replace(marker, "-- removed"), source + marker,
    source.replace("begin;", "select 1;"), source.replace(marker, `commit;\n${marker}`),
    source.replace("rollback;\nselect 'VERIFIED_INTAKE_OWNERSHIP_OK';", "commit;\nselect 'VERIFIED_INTAKE_OWNERSHIP_OK';").replace("rollback;\r\nselect 'VERIFIED_INTAKE_OWNERSHIP_OK';", "commit;\r\nselect 'VERIFIED_INTAKE_OWNERSHIP_OK';"),
    source.replace("owned_intake_loopback_fixture_required", "removed"),
    source.replace("current_setting('listen_addresses')<>'127.0.0.1'", "false"),
    source.replace("select public.owned_intake_race(6)", "select 'omitted'"),
    source.replace("VERIFIED_CLAIMED_DELIVERY_PIN_CONTENTION_RETRY_OK", "removed"),
    source.replace("VERIFIED_INTAKE_OWNERSHIP_REAL_CONNECTION_RACES_OK", "removed")]) {
    assert.throws(() => verifiedIntakeOwnershipContractFixture(broken));
  }
});

test("the mandatory isolated PG17 input retains the full guarded six-connection proof", () => {
  const inputs = loadRetentionPostgresInputs();
  assert(inputs.sql.includes(source));
  assert.equal(inputs.hashes.filter(entry => entry.kind === "fixture" && entry.name === "verified-intake-ownership.sql").length, 1);
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /node scripts\/run-service-retention-postgres17\.mjs/u);
  const runner = readFileSync(new URL("./run-supabase-db-tests-v2.mjs", import.meta.url), "utf8");
  assert(runner.includes('fixture.endsWith("/verified-intake-ownership.sql")'));
  assert(runner.includes("sql = verifiedIntakeOwnershipContractFixture(sql)"));
});

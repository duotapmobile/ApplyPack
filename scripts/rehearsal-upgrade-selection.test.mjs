import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { REHEARSAL_PREDECESSORS, REHEARSAL_TARGET_VERSION, selectRehearsalPredecessors } from "./lib/rehearsal-upgrade-selection.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const workflow = read("../.github/workflows/ci.yml");
function job(name) {
  const found = workflow.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`, "m"));
  assert(found, `missing ${name} job`); return found[1];
}

test("default rehearsal still covers every available predecessor through the current target", () => {
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).map(name => /^(\d{12})_/.exec(name)?.[1])
    .filter(version => version >= "202610040080" && version < REHEARSAL_TARGET_VERSION).sort();
  assert.deepEqual(selectRehearsalPredecessors([]), migrations);
  const selected = selectRehearsalPredecessors([]); selected.pop();
  assert.deepEqual(selectRehearsalPredecessors([]), migrations);
  assert(Object.isFrozen(REHEARSAL_PREDECESSORS));
});

for (const predecessor of REHEARSAL_PREDECESSORS) test(`exact ${predecessor} partition changes no other predecessor`, () => {
  assert.deepEqual(selectRehearsalPredecessors(["--predecessor", predecessor]), [predecessor]);
});

for (const args of [null, "202610250099", ["--predecessor"], ["202610250099"], ["--predecessor", "099"],
  ["--predecessor", REHEARSAL_TARGET_VERSION], ["--predecessor", "202610250101"], ["--predecessor", "202610250099 "],
  ["--predecessor", "202610250099", "--skip"], ["--predecessor", "202610250099", "--predecessor", "202610250098"],
  ["--predecessor", "https://database.invalid"], ["--predecessor", "202610250099;echo"], ["--database-url", "postgres://localhost"]]) {
  test(`invalid selector fails closed: ${JSON.stringify(args)}`, () => assert.throws(() => selectRehearsalPredecessors(args), /REHEARSAL_UPGRADE_SELECTION_INVALID/));
}

test("CI partitions are the exact complete roster, with bounded independent failures", () => {
  const source = job("database-upgrade");
  const matrix = source.match(/        predecessor:\r?\n([\s\S]*?)    steps:/)?.[1]; assert(matrix);
  const versions = [...matrix.matchAll(/^          - '(\d{12})'\r?$/gm)].map(match => match[1]);
  assert.deepEqual(versions, REHEARSAL_PREDECESSORS); assert.equal(new Set(versions).size, versions.length);
  assert(source.includes("timeout-minutes: 45")); assert(source.includes("fail-fast: false")); assert(source.includes("max-parallel: 4"));
  assert(source.includes('node scripts/run-supabase-rehearsal-upgrade-test.mjs --predecessor "$APPLYPACK_UPGRADE_PREDECESSOR"'));
  assert(source.includes("set -euo pipefail")); assert(source.includes("git rev-parse HEAD"));
  assert(source.includes("if: always()")); assert(source.includes("database-upgrade-${{ matrix.predecessor }}"));
});

test("core retains every non-rehearsal database gate and actual current-schema fixtures", () => {
  const core = job("database-core"); assert(core.includes("timeout-minutes: 45"));
  for (const script of ["run-supabase-retention-upgrade-test.mjs", "run-supabase-legal-upgrade-test.mjs",
    "run-supabase-inventory-upgrade-test.mjs", "run-supabase-legacy-board-upgrade-test.mjs", "run-supabase-db-tests-v2.mjs",
    "run-service-retention-postgres17.mjs", "check-launch-recovery-strategy.mjs --structural-only"])
    assert(core.includes(`node scripts/${script}`), script);
  for (const text of ["supabase gen types typescript --local", "migrated-database-types", "npm run types:database:check",
    "checkout-concurrency.sql", "security-financial-invariants.sql", "intake-delivery-invariants.sql",
    "historical-preservation-fixture.sql", "historical-preservation-assertions.sql"]) assert(core.includes(text), text);
  assert(!core.includes("npm run test:database\n"));
  assert(!core.includes("run-supabase-rehearsal-upgrade-test.mjs"));
});

test("the existing database required check cannot succeed without every partition", () => {
  const gate = job("database");
  assert(gate.includes("if: always()")); assert(gate.includes("needs: [database-core, database-upgrade, research-route-journey]"));
  assert(gate.includes("CORE_RESULT: ${{ needs.database-core.result }}"));
  assert(gate.includes("UPGRADE_RESULT: ${{ needs.database-upgrade.result }}"));
  assert(gate.includes("RESEARCH_RESULT: ${{ needs.research-route-journey.result }}"));
  assert(gate.includes('test "$CORE_RESULT" = success && test "$UPGRADE_RESULT" = success'));
  assert(gate.includes('&& test "$RESEARCH_RESULT" = success'));
});

test("selection stays outside upgrade assertions and all local cleanup and concurrency checks remain", () => {
  const source = read("./run-supabase-rehearsal-upgrade-test.mjs");
  assert(source.indexOf("selectRehearsalPredecessors(process.argv.slice(2))") < source.indexOf("let failure;"));
  assert(source.includes("for (const predecessor of predecessors)"));
  assert(source.includes("await proveRehearsalCheckoutConcurrency()"));
  assert(source.includes('run("supabase", ["db", "reset", "--local", "--no-seed"])'));
  assert(source.includes('if (failure) throw failure;'));
  assert(source.includes("All twenty launch upgrade predecessors passed"));
  assert(source.includes("Selected launch upgrade predecessor ${predecessors[0]} passed"));
  const scripts = JSON.parse(read("../package.json")).scripts;
  assert(scripts["test:database"].endsWith("node scripts/run-supabase-rehearsal-upgrade-test.mjs"));
});

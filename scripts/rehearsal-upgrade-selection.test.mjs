import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";
import { REHEARSAL_PREDECESSORS, REHEARSAL_TARGET_VERSION, selectRehearsalPredecessors } from "./lib/rehearsal-upgrade-selection.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const workflow = read("../.github/workflows/ci.yml");
function job(name) {
  const found = workflow.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`, "m"));
  assert(found, `missing ${name} job`); return found[1];
}

test("new commits supersede only the same workflow, event and ref without cancelling push or PR counterparts", () => {
  const files = ["../.github/workflows/ci.yml", "../.github/workflows/launch-image.yml"];
  const groups = new Set();
  for (const file of files) {
    const parsed = yaml.load(read(file));
    assert.equal(parsed.concurrency["cancel-in-progress"], true);
    assert.deepEqual(Object.keys(parsed.concurrency).sort(), ["cancel-in-progress", "group"]);
    const expression = parsed.concurrency.group;
    const keys = [...expression.matchAll(/\$\{\{\s*github\.([a-z_]+)\s*\}\}/gu)].map(match => match[1]);
    assert.deepEqual(keys.sort(), ["event_name", "ref", "workflow"]);
    const resolve = context => expression.replace(/\$\{\{\s*github\.([a-z_]+)\s*\}\}/gu, (_, key) => context[key]);
    for (const event_name of ["push", "pull_request", "workflow_dispatch"]) {
      for (const ref of ["refs/heads/main", "refs/heads/codex/manual-launch-hardening-2026-10-02", "refs/pull/6/merge", "refs/pull/7/merge"]) {
        const context = { workflow: parsed.name, event_name, ref, sha: "a".repeat(40), run_id: "123" };
        const group = resolve(context).toLowerCase();
        assert(group.length > 0 && !group.includes("${{"));
        assert(!groups.has(group), `another workflow, event or ref shares ${group}`); groups.add(group);
        assert.equal(resolve({ ...context, sha: "b".repeat(40), run_id: "456" }).toLowerCase(), group);
      }
    }
  }
  assert.equal(groups.size, 24);
});

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
  ["--predecessor", REHEARSAL_TARGET_VERSION], ["--predecessor", "202610260199"], ["--predecessor", "202610250099 "],
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

test("the actual research journey is isolated from generic integration and remains a required CI gate", () => {
  const generic = read("../vitest.integration.config.mts");
  assert.match(generic, /exclude:\s*\[\s*\/\/[^\n]*\n\s*"tests\/integration\/research-preparation-journey\.test\.ts",/u);
  for (const path of ["../vitest.research-container.config.mjs", "../vitest.research-native.config.mts"]) {
    const isolated = read(path).replace(/\s+/gu, "").replaceAll('"', "'");
    assert(isolated.includes("include:[process.env.AP_RESEARCH_JOURNEY_STAGE==='PAID_SEARCH'?'tests/integration/verified-paid-search-native-journey.test.ts':process.env.AP_RESEARCH_JOURNEY_STAGE==='NOTIFICATION'?'tests/integration/intake-notification-native-journey.test.ts':process.env.AP_RESEARCH_JOURNEY_STAGE==='CLARIFICATION'?'tests/integration/material-clarification-route-journey.test.ts':'tests/integration/research-preparation-journey.test.ts']"), path);
  }
  for (const fixture of ["material-clarification-route-journey.test.ts", "intake-notification-native-journey.test.ts", "verified-paid-search-native-journey.test.ts"])
    assert(generic.includes(`"tests/integration/${fixture}"`));
  const stages = read("./run-research-native-journey.mjs");
  assert(stages.includes("scenario === 'LIMITED' ? ['RESEARCH', 'CLARIFICATION', 'NOTIFICATION'] : ['RESEARCH']"));
  assert(stages.includes("scenario === 'PAID_SEARCH' ? ['PAID_SEARCH']"));
  assert(stages.includes("if (result.error || result.status !== 0) { process.exitCode = 1; break; }"));
  assert(stages.includes("if (!process.exitCode && scenario === 'LIMITED') console.log('RESEARCH_CLARIFICATION_NOTIFICATION_JOURNEYS_OK')"));
  const research = job("research-route-journey");
  assert(research.includes("node scripts/run-research-postgres17.mjs"));
  assert(!research.includes("continue-on-error") && !/^    if:/mu.test(research));
  const runner = read("./run-research-postgres17.mjs");
  assert(runner.includes("for(const scenario of ['QUALIFIED','LIMITED','PAID_SEARCH'])"));
});

test("selection stays outside upgrade assertions and all local cleanup and concurrency checks remain", () => {
  const source = read("./run-supabase-rehearsal-upgrade-test.mjs");
  assert(source.indexOf("selectRehearsalPredecessors(process.argv.slice(2))") < source.indexOf("let failure;"));
  assert(source.includes("for (const predecessor of predecessors)"));
  assert(source.includes("await proveRehearsalCheckoutConcurrency()"));
  assert(source.includes('run("supabase", ["db", "reset", "--local", "--no-seed"])'));
  assert(source.includes('if (failure) throw failure;'));
  assert(source.includes("All twenty-three launch upgrade predecessors passed"));
  assert(source.includes("Selected launch upgrade predecessor ${predecessors[0]} passed"));
  const scripts = JSON.parse(read("../package.json")).scripts;
  assert(scripts["test:database"].endsWith("node scripts/run-supabase-rehearsal-upgrade-test.mjs"));
});


test("103 migration self-test remains mandatory alongside every earlier Windows gate", () => {
  assert(workflow.includes("npm run test:material-clarification-resume-migration"));
  assert(workflow.includes("npm run test:repair-case-state-migration"));
  assert.equal(REHEARSAL_TARGET_VERSION, "202610260103");
  assert.equal(REHEARSAL_PREDECESSORS.at(-1), "202610260102");
});

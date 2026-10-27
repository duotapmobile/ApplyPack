import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { materialDraftStageContractFixture } from "./lib/material-draft-stage-fixture.mjs";
import { verifiedIntakeOwnershipContractFixture } from "./lib/verified-intake-ownership-fixture.mjs";
import { verifiedSourceRunSeedFixture } from "./lib/verified-source-run-fixture.mjs";
import { current091LockedPhaseSql, current092LockedPhaseSql, current093LockedPhaseSql, current103LockedPhaseSql, current104LockedPhaseSql, current105LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";

for (const [flag, version, count, containsRule, containsSource] of [
  ["--historical-091", "202610250091", 6, false, false],
  ["--historical-092", "202610250092", 7, true, false],
  ["--historical-093", "202610250093", 8, true, true],
  ["--historical-094", "202610250094", 9, true, true],
  ["--historical-095", "202610250095", 10, true, true],
  ["--historical-096", "202610250096", 11, true, true],
  ["--historical-097", "202610250097", 12, true, true],
  ["--historical-098", "202610250098", 13, true, true],
  ["--historical-099", "202610250099", 14, true, true],
  ["--historical-100", "202610250100", 15, true, true],
  ["--historical-101", "202610250101", 16, true, true],
  ["--historical-102", "202610260102", 17, true, true],
  ["--historical-103", "202610260103", 20, true, true],
  ["--historical-104", "202610270104", 21, true, true],
  [null, "202610270105", 22, true, true],
]) {
  test(`the real fixture selector executes only its exact ${version} phase`, () => {
    const source = readFileSync(new URL("./run-supabase-db-tests-v2.mjs", import.meta.url), "utf8")
      .replace(/^import .*;\r?\n/gmu, "").replaceAll("import.meta.url", JSON.stringify(import.meta.url));
    const inputs = [], logs = [];
    runInNewContext(source, {
      URL, fileURLToPath, materialDraftStageContractFixture, verifiedIntakeOwnershipContractFixture,
      readFileSync: (path) => ["material-draft-stage-claiming.sql", "verified-intake-ownership.sql"].some(name => String(path).endsWith(name))
        ? readFileSync(path, "utf8") : `-- fictional fixture ${path}`,
      spawnSync: (command, args, options) => {
        assert.equal(command, "docker"); assert(args.includes("supabase_db_applypack"));
        inputs.push(options.input); return { status: 0, stdout: "", stderr: "" };
      },
      process: { argv: ["node", "runner", ...(flag ? [flag] : [])], stdout: { write() {} }, stderr: { write() {} }, exit: () => assert.fail("unexpected exit") },
      console: { log: (message) => logs.push(message) },
    });
    assert.equal(inputs.length, count + 1);
    assert.match(inputs[0], new RegExp(`distinct from '${version}'`, "u"));
    assert.equal(inputs.some((sql) => sql.includes("material-rule-revalidation.sql")), containsRule);
    assert.equal(inputs.some((sql) => sql.includes("source-aware-document-acceptance.sql")), containsSource);
    assert(inputs.some((sql) => sql.includes("chunk5-materials-delivery.sql")));
    assert.equal(inputs.some((sql) => sql.includes("VERIFIED_INTAKE_OWNERSHIP_OK")), version >= "202610260103");
    assert.equal(inputs.some((sql) => sql.includes("employer-rule-review-confirmation.sql")), version >= "202610270104");
    assert.equal(inputs.some((sql) => sql.includes("verified-source-run-binding.sql")), version >= "202610270105");
    assert(!inputs.some((sql) => sql.includes("VERIFIED_INTAKE_OWNERSHIP_REAL_CONNECTION_RACES_OK")));
    assert.equal(logs.at(-1), `Database contract fixtures passed: ${count}. Schema phase: ${version}.`);
  });
}

test("historical phase checks stay exact and093 requires its own guarded capability", () => {
  assert.match(current091LockedPhaseSql, /distinct from '202610250091'/u);
  assert(!current091LockedPhaseSql.includes("202610250092"));
  assert.match(current092LockedPhaseSql, /distinct from '202610250092'/u);
  assert(!current092LockedPhaseSql.includes("202610250093"));
  for (const phase of [current091LockedPhaseSql, current092LockedPhaseSql, current093LockedPhaseSql]) {
    assert.match(phase, /not enabled and policy_id is null/u);
    assert.match(phase, /mode='LOCKED'/u);
    assert.match(phase, /not checkout_enabled/u);
  }
  assert.match(current093LockedPhaseSql, /ap_source_aware_document_schema_installed/u);
  assert.match(current093LockedPhaseSql, /SOURCE_AWARE_DOCUMENT_ACCEPTANCE/u);
});

test("104 requires its own instruction-review capability without weakening the historical103 locked phase", () => {
  assert.match(current103LockedPhaseSql, /distinct from '202610260103'/u);
  assert(!current103LockedPhaseSql.includes("202610270104"));
  assert.match(current104LockedPhaseSql, /distinct from '202610270104'/u);
  assert.match(current104LockedPhaseSql, /ap_employer_rule_review_schema_installed/u);
  assert.match(current104LockedPhaseSql, /EMPLOYER_RULE_REVIEW_CONFIRMATION/u);
  for (const phase of [current103LockedPhaseSql, current104LockedPhaseSql]) {
    assert.match(phase, /mode='LOCKED'/u);
    assert.match(phase, /not checkout_enabled/u);
    assert.match(phase, /not enabled and policy_id is null/u);
    assert.match(phase, /ap_material_clarification_resume_schema_installed/u);
  }
});


test("105 appends source-run binding while the explicit104 phase remains historical", () => {
  assert(!current104LockedPhaseSql.includes("202610270105"));
  assert.match(current105LockedPhaseSql, /distinct from '202610270105'/u);
  for (const invariant of ["ap_verified_source_run_schema_installed()", "VERIFIED_SOURCE_RUN_BINDING", "ap_employer_rule_review_schema_installed()", "mode='LOCKED'", "not checkout_enabled", "not enabled and policy_id is null"])
    assert(current105LockedPhaseSql.includes(invariant), invariant);
});

test("105 seed framing retains only the explicit exact104 branch and rejects ambiguous boundaries", () => {
  const original = "-- fictional framing input\nbegin;\n-- applypack.fixture_source_run_binding_seed\n-- verified_source_run_upgrade_exact104_required 202610270104\nselect 'retained';\nrollback;\n";
  const framed = verifiedSourceRunSeedFixture(original);
  assert.equal(framed, "do $$ begin if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610270104'"
    + " or to_regprocedure('public.ap_verified_source_run_schema_installed()') is not null"
    + " then raise exception 'verified_source_run_seed_exact104_required'; end if; end $$;\n"
    + "set applypack.fixture_source_run_binding_seed='true';\n"
    + original.replace(/\nrollback;\n$/u, "\ncommit;\n")
    + "reset applypack.fixture_source_run_binding_seed;\n");
  assert(original.endsWith("rollback;\n"));
  for (const invalid of [null, original.replace("begin;", ""), original + "rollback;\n",
    original.replace("rollback;", "commit;"), original + "select 1;\n", original.replace("select 'retained';", "commit;"),
    original.replace("202610270104", "202610270103"),
    original.replace("verified_source_run_upgrade_exact104_required", "different_guard"),
    original.replace("applypack.fixture_source_run_binding_seed", "different_mode")])
    assert.throws(() => verifiedSourceRunSeedFixture(invalid), /SOURCE_RUN_SEED_FIXTURE_BOUNDARY_INVALID/u);
});

test("105 runners demand the actual seed, preservation and paid-context fixture markers", () => {
  const fixture = readFileSync(new URL("../tests/integration/verified-source-run-binding.sql", import.meta.url), "utf8");
  const historical = readFileSync(new URL("./run-supabase-rehearsal-upgrade-test.mjs", import.meta.url), "utf8");
  const native = readFileSync(new URL("./test-database-native.ps1", import.meta.url), "utf8");
  for (const marker of ["VERIFIED_SOURCE_RUN_BINDING_104_SEEDED", "VERIFIED_SOURCE_RUN_BINDING_105_UPGRADE_PRESERVED"]) {
    assert(fixture.includes(`'${marker}'`), marker);
    assert(historical.includes(`"${marker}"`), marker);
    assert(native.includes(`'${marker}'`), marker);
  }
  for (const marker of ["VERIFIED_SOURCE_RUN_BINDING_PAID_CONTEXT_PRESERVED", "VERIFIED_SOURCE_RUN_BINDING_OK"]) {
    assert(fixture.includes(`'${marker}'`), marker);
    assert(native.includes(`'${marker}'`), marker);
  }
  const seed = verifiedSourceRunSeedFixture(fixture);
  assert(seed.startsWith("do $$ begin if (select max(version)"));
  assert.equal((seed.match(/^commit;$/gmu) || []).length, 1);
  assert.equal((seed.match(/^rollback;\r?$/gmu) || []).length, 0);
});

test("native105 keeps its retained core in one session and resets before each optional current fixture", () => {
  const native = readFileSync(new URL("./test-database-native.ps1", import.meta.url), "utf8");
  const block = native.slice(native.indexOf("  # Retain the actual paid103 context"), native.indexOf("if ($LegalReceiptUpgrade) {\n  $bindingPath"));
  assert(block.includes('"\\connect postgres`n"'));
  assert.match(block, /foreach \(\$currentInput in \$optionalCurrentInputs\)\s*\{\s*\[pscustomobject\]@\{Kind='fixture'; Name='native-source105-current-session.sql'; Path=\$sessionResetPath\}\s*\$currentInput/u);
  const order = ["$inputs = @($inputs | Where-Object Kind -eq 'bootstrap')", "Name -eq 'employer-rule-review-upgrade-seed.sql'",
    "-eq '202610270104'", "Name -eq 'employer-rule-review-upgrade-preservation.sql'", "Name='native-verified-source-run-104-seed.sql'",
    "-eq '202610270105'", "Name -eq 'verified-source-run-binding.sql'", "$currentInputsWithSessions", "Name='native-current105-locked-phase.sql'"];
  let cursor = 0;
  for (const step of order) {
    const position = block.indexOf(step, cursor);
    assert(position >= cursor, step);
    cursor = position + step.length;
  }
  assert(!block.slice(block.indexOf(order[0]), block.indexOf("    $currentInputsWithSessions", block.indexOf(order[0]))).includes("Name='native-source105-current-session.sql'"));
});

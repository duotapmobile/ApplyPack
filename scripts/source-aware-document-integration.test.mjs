import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { materialDraftStageContractFixture } from "./lib/material-draft-stage-fixture.mjs";
import { current091LockedPhaseSql, current092LockedPhaseSql, current093LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";

for (const [flag, version, count, containsRule, containsSource] of [
  ["--historical-091", "202610250091", 6, false, false],
  ["--historical-092", "202610250092", 7, true, false],
  ["--historical-093", "202610250093", 8, true, true],
  ["--historical-094", "202610250094", 9, true, true],
  ["--historical-095", "202610250095", 10, true, true],
  [null, "202610250096", 11, true, true],
]) {
  test(`the real fixture selector executes only its exact ${version} phase`, () => {
    const source = readFileSync(new URL("./run-supabase-db-tests-v2.mjs", import.meta.url), "utf8")
      .replace(/^import .*;\r?\n/gmu, "").replaceAll("import.meta.url", JSON.stringify(import.meta.url));
    const inputs = [], logs = [];
    runInNewContext(source, {
      URL, fileURLToPath, materialDraftStageContractFixture,
      readFileSync: (path) => String(path).endsWith("material-draft-stage-claiming.sql") ? readFileSync(path, "utf8") : `-- fictional fixture ${path}`,
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

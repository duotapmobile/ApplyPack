import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkDatabaseTypes, SUPABASE_CLI_VERSION } from "./check-database-types.mjs";

const source = 'export type Database = { public: { id: string; amount_cents: number } }\n';

function fixture({ version = SUPABASE_CLI_VERSION, generated = source, expected = source, generation = {}, versionResult = {} } = {}) {
  const calls = [];
  const messages = [];
  const stderr = [];
  return {
    calls, messages, stderr,
    check: () => checkDatabaseTypes({
      run: (command, args) => {
        calls.push({ command, args });
        return args[0] === "--version"
          ? { status: 0, stdout: `${version}\n`, ...versionResult }
          : { status: 0, stdout: generated, ...generation };
      },
      readExpected: () => expected,
      log: (value) => messages.push(value),
      writeStderr: (value) => stderr.push(value),
    }),
  };
}

test("the pinned CLI checks the complete generated schema", () => {
  const proof = fixture();
  proof.check();
  assert.deepEqual(proof.calls, [
    { command: "supabase", args: ["--version"] },
    { command: "supabase", args: ["gen", "types", "typescript", "--local"] },
  ]);
  assert.match(proof.messages.at(-1), /match the local migrated schema/);
});

for (const version of ["2.122.0", "2.115.0", "", "2.116.0-beta.1"]) {
  test(`rejects unexpected CLI version ${version || "(empty)"} before generation`, () => {
    const proof = fixture({ version });
    assert.throws(proof.check, /2\.116\.0 is required/);
    assert.equal(proof.calls.length, 1);
  });
}

test("preserves the existing BOM and line-ending normalization", () => {
  fixture({ generated: `\uFEFF${source.replace(/\n/gu, "\r\n")}\r\n`, expected: source }).check();
});

for (const generated of [
  source.replace("id: string", "id: number"),
  source.replace("amount_cents: number", "amount_cents: number | null"),
  source.replace("; amount_cents: number", ""),
  `${source}export type NewTable = { id: string }\n`,
  source.replace("public:", " public:"),
]) {
  test(`rejects complete-output drift: ${generated.trim()}`, () => {
    assert.throws(fixture({ generated }).check, /Generated database types are stale \(first difference at line \d+, Supabase CLI 2\.116\.0\)/);
  });
}

test("failed generation cannot pass even when stdout matches", () => {
  assert.throws(fixture({ generation: { status: 1, stderr: "database is unavailable" } }).check, /gen types typescript --local failed/);
});

test("missing CLI fails without generation", () => {
  const proof = fixture({ versionResult: { error: new Error("spawn supabase ENOENT") } });
  assert.throws(proof.check, /ENOENT/);
  assert.equal(proof.calls.length, 1);
});

test("failed version probe cannot pass even when stdout matches", () => {
  const proof = fixture({ versionResult: { status: 1 } });
  assert.throws(proof.check, /--version failed/);
  assert.equal(proof.calls.length, 1);
});

test("CI installs the same exact generator version", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const setup = workflow.match(/uses: supabase\/setup-cli@[^\r\n]+\r?\n\s+with:\r?\n\s+version: ["']?([^\s"']+)/u);
  assert.equal(setup?.[1], SUPABASE_CLI_VERSION);
});

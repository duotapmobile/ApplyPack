import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanSelfTestEnvironment, runWindowsReleaseSelfTest } from "./run-windows-release-self-test.mjs";

const forbiddenNames = [
  "PGPASSWORD", "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE", "DATABASE_URL",
  "AP_PREMIGRATION_DATABASE_URL", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
];
const approvedCommands = [
  ["launch-operations", "test-production-database-guard.ps1", []],
  ["rehearsal-085", "apply-staging-rehearsal-migration.ps1", ["-Mode", "SelfTest"]],
  ["rehearsal-086", "apply-staging-rehearsal-migration.ps1", ["-Mode", "SelfTest", "-TargetSchemaVersion", "202610230086"]],
  ["rehearsal-087", "apply-staging-rehearsal-migration.ps1", ["-Mode", "SelfTest", "-TargetSchemaVersion", "202610240087"]],
  ["rehearsal-088", "apply-staging-rehearsal-migration.ps1", ["-Mode", "SelfTest", "-TargetSchemaVersion", "202610250088"]],
  ["rehearsal-089", "apply-staging-rehearsal-migration.ps1", ["-Mode", "SelfTest", "-TargetSchemaVersion", "202610250089"]],
  ["rehearsal-090", "apply-staging-rehearsal-migration.ps1", ["-Mode", "SelfTest", "-TargetSchemaVersion", "202610250090"]],
  ["staging-084-backup", "staging-schema084-database-safeguard.ps1", ["-Mode", "SelfTest"]],
  ["production-migration", "apply-production-forward-migrations.ps1", ["-Mode", "SelfTest"]],
  ["production-backup", "production-database-safeguard.ps1", ["-Mode", "SelfTest"]],
];

function contaminatedEnvironment(value = "SYNTHETIC_INHERITED_VALUE") {
  return {
    Path: "synthetic-path", TEMP: "synthetic-temp", NODE_ENV: "test",
    ...Object.fromEntries(forbiddenNames.flatMap((name) => [[name, value], [name.toLowerCase(), value]])),
  };
}

for (const value of ["SYNTHETIC_INHERITED_VALUE", "", " ", undefined]) {
  test(`removes all forbidden names case-insensitively without modifying the parent (${String(value)})`, () => {
    const parent = contaminatedEnvironment(value);
    const original = { ...parent };
    assert.deepEqual(cleanSelfTestEnvironment(parent), { Path: "synthetic-path", TEMP: "synthetic-temp", NODE_ENV: "test" });
    assert.deepEqual(parent, original);
  });
}

for (const [name, filename, testArguments] of approvedCommands) {
  test(`launches only the exact networkless ${name} command with a clean child environment`, () => {
    let calls = 0;
    const parent = contaminatedEnvironment();
    assert.equal(runWindowsReleaseSelfTest([name], {
      environment: parent,
      run: (executable, args, options) => {
        calls += 1;
        assert.equal(executable, process.platform === "win32" ? "pwsh.exe" : "pwsh");
        assert.deepEqual(args.slice(0, 4), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File"]);
        assert.equal(basename(args[4]), filename);
        assert.deepEqual(args.slice(5), testArguments);
        assert.deepEqual(options.env, { Path: "synthetic-path", TEMP: "synthetic-temp", NODE_ENV: "test" });
        assert.equal(options.shell, false);
        assert.equal(options.windowsHide, true);
        assert.equal(options.stdio, "inherit");
        assert.equal(options.timeout, 180_000);
        assert.equal(basename(options.cwd), basename(new URL("../", import.meta.url).pathname.replace(/\/$/u, "")));
        return { status: 0 };
      },
    }), 0);
    assert.equal(calls, 1);
    assert.equal(parent.PGPASSWORD, "SYNTHETIC_INHERITED_VALUE");
  });
}

for (const args of [[], ["unknown"], ["__proto__"], ["constructor"], ["../apply-production-forward-migrations.ps1"], ["production-migration", "-Mode", "Apply"], ["production-backup", "-Mode", "Restore"], ["rehearsal-085", "--anything"]]) {
  test(`rejects unapproved name or extra arguments: ${args.join(" ") || "(empty)"}`, () => {
    let called = false;
    assert.throws(() => runWindowsReleaseSelfTest(args, { run: () => { called = true; } }), /WINDOWS_RELEASE_SELF_TEST_NAME_INVALID/u);
    assert.equal(called, false);
  });
}

test("propagates a failing SelfTest exit status", () => {
  assert.equal(runWindowsReleaseSelfTest(["rehearsal-086"], { run: () => ({ status: 7 }) }), 7);
});

for (const result of [{ error: new Error("sensitive process detail") }, { signal: "SIGTERM", status: null }, { status: null }, { status: -1 }]) {
  test("fails closed with a fixed error when the process cannot complete", () => {
    assert.throws(() => runWindowsReleaseSelfTest(["rehearsal-086"], { run: () => result }), /^Error: WINDOWS_RELEASE_SELF_TEST_PROCESS_FAILED$/u);
  });
}

// Native coverage runs in the required Windows safeguard job. Invoking these
// runners directly must still reject contaminated environments before SelfTest.
if (process.platform === "win32") {
  for (const filename of ["apply-staging-rehearsal-migration.ps1", "apply-production-forward-migrations.ps1"]) {
    for (const [name, code] of [["PGPASSWORD", "FORBIDDEN_CONNECTION_ENVIRONMENT"], ["DOCKER_HOST", "FORBIDDEN_DOCKER_ENVIRONMENT"]]) {
      test(`direct ${filename} still rejects ${name} before running`, { timeout: 20_000 }, () => {
        const marker = "SYNTHETIC_FORBIDDEN_VALUE_DO_NOT_LOG_72193";
        const result = spawnSync("pwsh.exe", [
          "-NoLogo", "-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL(filename, import.meta.url)), "-Mode", "SelfTest",
        ], {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          env: { ...cleanSelfTestEnvironment(process.env), [name]: marker },
          encoding: "utf8", shell: false, windowsHide: true, timeout: 15_000,
        });
        assert.equal(result.status, 1);
        assert.equal(`${result.stdout}${result.stderr}`.includes(code), true);
        assert.equal(`${result.stdout}${result.stderr}`.includes(marker), false);
      });
    }
  }
}

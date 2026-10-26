import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const forbiddenEnvironmentNames = new Set([
  "PGPASSWORD", "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE", "DATABASE_URL",
  "AP_PREMIGRATION_DATABASE_URL", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH",
]);
const commands = Object.freeze({
  "launch-operations": ["test-production-database-guard.ps1"],
  "rehearsal-085": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest"],
  "rehearsal-086": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610230086"],
  "rehearsal-087": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610240087"],
  "rehearsal-088": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250088"],
  "rehearsal-089": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250089"],
  "rehearsal-090": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250090"],
  "rehearsal-091": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250091"],
  "rehearsal-092": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250092"],
  "rehearsal-093": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250093"],
  "rehearsal-094": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250094"],
  "rehearsal-095": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250095"],
  "rehearsal-096": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250096"],
  "rehearsal-097": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250097"],
  "rehearsal-098": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250098"],
  "rehearsal-099": ["apply-staging-rehearsal-migration.ps1", "-Mode", "SelfTest", "-TargetSchemaVersion", "202610250099"],
  "staging-084-backup": ["staging-schema084-database-safeguard.ps1", "-Mode", "SelfTest"],
  "production-migration": ["apply-production-forward-migrations.ps1", "-Mode", "SelfTest"],
  "production-backup": ["production-database-safeguard.ps1", "-Mode", "SelfTest"],
});

// Only these networkless test commands receive a clean child environment.
// Real Apply/Backup/Restore entrypoints keep their inherited-environment guards.
export function cleanSelfTestEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !forbiddenEnvironmentNames.has(name.toUpperCase())));
}

export function runWindowsReleaseSelfTest(args, { environment = process.env, run = spawnSync } = {}) {
  if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== "string"
    || !Object.hasOwn(commands, args[0])) {
    throw new Error("WINDOWS_RELEASE_SELF_TEST_NAME_INVALID");
  }
  const [filename, ...testArguments] = commands[args[0]];
  const result = run(process.platform === "win32" ? "pwsh.exe" : "pwsh", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-File", join(repositoryRoot, "scripts", filename), ...testArguments,
  ], {
    cwd: repositoryRoot,
    env: cleanSelfTestEnvironment(environment),
    shell: false,
    windowsHide: true,
    stdio: "inherit",
    timeout: 180_000,
  });
  if (result.error || result.signal || !Number.isInteger(result.status) || result.status < 0) {
    throw new Error("WINDOWS_RELEASE_SELF_TEST_PROCESS_FAILED");
  }
  return result.status;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = runWindowsReleaseSelfTest(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(error?.message === "WINDOWS_RELEASE_SELF_TEST_NAME_INVALID"
      ? "WINDOWS_RELEASE_SELF_TEST_NAME_INVALID\n" : "WINDOWS_RELEASE_SELF_TEST_PROCESS_FAILED\n");
    process.exitCode = 1;
  }
}

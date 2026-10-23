// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const runnerPath = path.join(
  repoRoot,
  "scripts",
  "apply-staging-manual-launch-migrations.ps1",
);
const runner = readFileSync(runnerPath, "utf8");
const preflight = readFileSync(
  path.join(repoRoot, "scripts", "preflight-inventory-identity-conflicts.sql"),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

const migrations = [
  "202610190081_open_font_document_contract.sql",
  "202610190082_tax_activation_decision.sql",
  "202610190083_legacy_board_read_only_archive.sql",
  "202610190084_legacy_board_terminal_event_ordering.sql",
] as const;

const predecessorLedger = [
  [
    "202610040077",
    "atomic_inventory_identity_enforcement",
    12,
    "a905fd140c31aeeef0261be33b9e2330c17cedc8195a1f7427a449e8febfa754",
  ],
  [
    "202610040078",
    "requeue_identity_policy_feasibility",
    3,
    "1e45eca04b7335e162826e2b200a778873c4d25585102deb1575919492c06da5",
  ],
  [
    "202610040079",
    "runtime_launch_schema_readiness",
    8,
    "2fb8c49604344702c185ad66cb0857d329741164faab40f9e00789c768abe2a7",
  ],
  [
    "202610040080",
    "persistent_inventory_identity_guard",
    12,
    "e7287f02ba7af66dfec6885545514127e24b81db770f064171f4360ef284d2bb",
  ],
] as const;

const forbiddenEnvironment = [
  ["PGPASSWORD", "FORBIDDEN_CONNECTION_ENVIRONMENT"],
  ["PGPASSFILE", "FORBIDDEN_CONNECTION_ENVIRONMENT"],
  ["PGSERVICE", "FORBIDDEN_CONNECTION_ENVIRONMENT"],
  ["PGSERVICEFILE", "FORBIDDEN_CONNECTION_ENVIRONMENT"],
  ["DATABASE_URL", "FORBIDDEN_CONNECTION_ENVIRONMENT"],
  ["AP_PREMIGRATION_DATABASE_URL", "FORBIDDEN_CONNECTION_ENVIRONMENT"],
  ["DOCKER_HOST", "FORBIDDEN_DOCKER_ENVIRONMENT"],
  ["DOCKER_CONTEXT", "FORBIDDEN_DOCKER_ENVIRONMENT"],
  ["DOCKER_TLS_VERIFY", "FORBIDDEN_DOCKER_ENVIRONMENT"],
  ["DOCKER_CERT_PATH", "FORBIDDEN_DOCKER_ENVIRONMENT"],
] as const;

function cleanTestChildEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const forbiddenNames = new Set<string>(forbiddenEnvironment.map(([name]) => name));
  return Object.fromEntries(Object.entries(environment)
    .filter(([name]) => !forbiddenNames.has(name.toUpperCase())));
}

function resolvePowerShell(): string | undefined {
  const explicit = process.env.PWSH_EXE;
  if (explicit && existsSync(explicit)) return explicit;
  const located = spawnSync("where.exe", ["pwsh.exe"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (located.status !== 0) return undefined;
  return located.stdout
    .split(/\r?\n/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0 && existsSync(candidate));
}

describe("credential-safe staging migrations 081 through 084", () => {
  it("pins the only permitted staging identity, TLS CA, client image, and schema range", () => {
    expect(runner).toContain("$script:ProjectRef = 'fmugizadzdnqfckujqlw'");
    expect(runner).toContain(
      "$script:DatabaseHost = 'aws-0-us-west-2.pooler.supabase.com'",
    );
    expect(runner).toContain("$script:DatabasePort = '5432'");
    expect(runner).toContain("$script:DatabaseName = 'postgres'");
    expect(runner).toContain(
      "$script:LoginUser = 'postgres.fmugizadzdnqfckujqlw'",
    );
    expect(runner).toContain("$script:CurrentUser = 'postgres'");
    expect(runner).toContain("$script:PreSchemaVersion = '202610040080'");
    expect(runner).toContain("$script:PostSchemaVersion = '202610190084'");
    expect(runner).toContain(
      "700723581420DD1AC98FD7E9AC529F0EF210EADCAF87FC868A3AD7D114C2F3B7",
    );
    expect(runner).toContain(
      "public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86",
    );
    expect(runner).toContain("--network', 'none', '--pull', 'never'");
    expect(runner).toContain("^psql \\(PostgreSQL\\) 17\\.6");
    expect(runner).not.toContain("sslmode=require");
    expect(runner).not.toContain("--pull', 'always'");
  });

  it("uses the reviewed Credential Manager target and a password-first shell handoff", () => {
    expect(runner).toContain(
      "[ApplyPack.Security.WindowsCredentialStore]::ReadStagingDatabase()",
    );
    expect(runner).toContain(
      "$Credential.WriteUtf8LineTo($process.StandardInput.BaseStream)",
    );
    expect(runner).toContain(
      "$process.StandardInput.BaseStream.Write($payloadBytes, 0, $payloadBytes.Length)",
    );
    expect(runner).toContain(
      "$script:PsqlPasswordHandoffShell = 'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGSSLMODE=verify-full; export PGSSLROOTCERT=/certs/root.crt; export PGCONNECT_TIMEOUT=15; exec \"$@\"'",
    );
    const argumentsStart = runner.indexOf("function Get-PsqlDockerArguments");
    const argumentsEnd = runner.indexOf(
      "function Get-BoundedSqlPayload",
      argumentsStart,
    );
    const argumentsBody = runner.slice(argumentsStart, argumentsEnd);
    expect(argumentsBody).toContain(
      "'--entrypoint', 'sh', $script:PostgresImageDigest",
    );
    expect(argumentsBody).toContain(
      "'-ec', $script:PsqlPasswordHandoffShell, '--', 'psql'",
    );
    expect(argumentsBody).not.toContain("'--env'");
    expect(runner).not.toContain("'--password'");
    expect(runner).toContain("'--file', '-'");
    expect(runner).not.toMatch(/'--env',\s*'PGPASSWORD=/u);
    expect(runner).not.toContain("new StreamWriter");
  });

  it("preserves SQL after the password line and controls zero or scalar marker output", () => {
    expect(runner).toContain(
      '$syntheticSql = "\\echo SELF_TEST_SQL_STDIN_REMAINS`n"',
    );
    expect(runner).toContain(
      "$piped.Substring($passwordDelimiter + 1), $syntheticSql",
    );
    expect(runner).toContain("[AllowEmptyCollection()][string[]]$Actual");
    expect(runner).toContain("$zeroMarkerLines = @(Get-OutputLines -Text '')");
    expect(runner).toContain(
      '$oneMarkerLines = @(Get-OutputLines -Text "EXPECTED`n")',
    );
    expect(runner).not.toContain("-Actual (Get-OutputLines");
    expect(runner).toContain(
      "$rawLines = @(Get-OutputLines -Text $result.stdout)",
    );
    expect(runner).toContain(
      "$rawGuardLines = @(Get-OutputLines $guardResult.stdout)",
    );
    expect(runner).toContain(
      "$rawResultLines = @(Get-OutputLines $result.stdout)",
    );
    expect(runner).toContain(
      "$lines = @(Assert-ClientTlsAndGetMarkers -Actual $rawLines)",
    );
  });

  it("rejects inherited connection and Docker routing variables before children and scrubs every child", () => {
    for (const [name, code] of forbiddenEnvironment) {
      expect(runner).toContain(`'${name}'`);
      expect(runner).toContain(code);
    }
    expect(runner).toContain("Assert-CleanInheritedEnvironment");
    expect(runner).toContain("$start.Environment.Remove($name)");
    const apply = runner.indexOf("function Invoke-Apply");
    const rejection = runner.indexOf("Assert-CleanInheritedEnvironment", apply);
    const firstReservation = runner.indexOf("New-ReceiptReservation", apply);
    expect(rejection).toBeGreaterThan(apply);
    expect(firstReservation).toBeGreaterThan(rejection);
  });

  it("binds the exact reviewed sources and applies no migration outside 081 through 084", () => {
    let previous = -1;
    for (const migration of migrations) {
      const index = runner.indexOf(migration);
      expect(index).toBeGreaterThan(previous);
      previous = index;
      const migrationText = readFileSync(
        path.join(repoRoot, "supabase", "migrations", migration),
        "utf8",
      );
      expect(migrationText).toMatch(/^\s*(?:--[^\n]*\n)*\s*begin;/u);
      expect(migrationText).toMatch(/\ncommit;\s*$/u);
    }
    expect(runner).toContain("$script:PreflightRelativePath");
    expect(runner).toContain("$script:CredentialHelperRelativePath");
    expect(runner).toContain("'diff', '--quiet', 'HEAD'");
    expect(runner).toContain("MIGRATION_SOURCE_NOT_AT_RELEASE_SHA");
    expect(runner).toContain("MIGRATION_SOURCE_HASH_DRIFT");
    expect(runner).toContain("AP_PREMIGRATION_EXPECTED_RELEASE_SHA");
    expect(runner).not.toMatch(/20261019008[5-9]/u);
  });

  it("executes the authoritative conflict query before any migration and fails closed", () => {
    expect(preflight).toContain("INVENTORY_IDENTITY_PREFLIGHT_CONFLICT");
    expect(preflight).toContain("INVENTORY_IDENTITY_PREFLIGHT_CLEAN");
    expect(runner).toContain(
      "Read-Utf8TextWithExpectedSha256 -Path $script:PreflightPath",
    );
    expect(runner).toContain("Read-Utf8TextWithExpectedSha256");
    expect(runner).toContain(
      "[Security.Cryptography.SHA256]::HashData($bytes)",
    );
    expect(runner).toContain(
      "-ExpectedPreflightHash ([string]$release.hashes[$script:PreflightRelativePath])",
    );
    const call = runner.indexOf("Invoke-InventoryAndSchemaPreflight");
    const loop = runner.indexOf("foreach ($migration in $script:MigrationPlan)", call);
    expect(call).toBeGreaterThan(-1);
    expect(loop).toBeGreaterThan(call);
    expect(runner).toContain("INVENTORY_IDENTITY_PREFLIGHT_CONFLICT");
    expect(runner).toContain("UNEXPECTED_DATABASE_OUTPUT");
    expect(runner).toContain("STAGING_MIGRATION_CONNECTION_ATTESTED");
    expect(runner).toContain("APPLYPACK_MIGRATION_CONNINFO_BEGIN");
    expect(runner).toContain("APPLYPACK_MIGRATION_CONNINFO_END");
    expect(runner).toContain("\\conninfo");
    expect(runner).toContain("CLIENT_TLS_ATTESTATION_FAILED");
    expect(runner).toContain("$script:ClientTlsLinePattern");
    expect(runner).toContain("clientTlsVerified = $true");
    expect(runner).not.toContain("pg_catalog.pg_stat_ssl");
  });

  it("requires the exact pre-state and post-state without selecting customer data", () => {
    expect(runner).toContain(
      "max(version) from supabase_migrations.schema_migrations",
    );
    expect(runner).toContain(
      "migration_id='202610040080' and checkpoint='PERSISTENT_INVENTORY_IDENTITY_GUARD'",
    );
    expect(runner).toContain(
      "readiness->>'requiredSchemaVersion' is distinct from '202610040080'",
    );
    expect(runner).toContain(
      "readiness->>'requiredSchemaVersion' is distinct from '202610190084'",
    );
    expect(runner).toContain(
      "readiness->>'requiredSchemaVersion' is distinct from '$predecessor'",
    );
    expect(runner).toContain(
      "migration_id='$predecessor' and checkpoint='$predecessorCheckpoint'",
    );
    expect(runner).toContain("not index_row.indisvalid");
    expect(runner).toContain("STAGING_MIGRATION_PRESTATE_VERIFIED");
    expect(runner).toContain("STAGING_MIGRATION_POSTSTATE_VERIFIED");
    expect(runner).not.toContain("tableRowCounts");
    expect(runner).not.toMatch(/select\s+\*\s+from\s+public\./iu);
  });

  it("binds the exact predecessor ledger names, statement counts, and reviewed statement-array digests", () => {
    for (const [version, name, statementCount, digest] of predecessorLedger) {
      expect(runner).toContain(`version = '${version}'`);
      expect(runner).toContain(`name = '${name}'`);
      expect(runner).toContain(`statementCount = ${statementCount}`);
      expect(runner).toContain(`statementsDigest = '${digest}'`);
      expect(runner).toContain(
        `where version='$version')<>1`,
      );
    }
    expect(runner).toContain("Get-PredecessorLedgerChecksSql");
    expect(runner).toContain("pg_catalog.array_to_json(statements)::text");
    expect(runner).toContain("pg_catalog.sha256(pg_catalog.convert_to(");
    expect(runner).toContain("$predecessorLedgerChecks");
  });

  it("makes each reviewed migration and its exact ledger tuple one transaction", () => {
    expect(runner).toContain("Assert-MigrationTransactionBoundary");
    expect(runner).toContain("$commitMatches.Count -ne 1");
    expect(runner).toContain("$finalCommit.Index -ne $commitMatches[0].Index");
    expect(runner).toContain(
      "insert into supabase_migrations.schema_migrations(version,name,statements)",
    );
    expect(runner).toContain("statements[1]=$sourceTag$SourceText$sourceTag");
    expect(runner).toContain("$prefix = $SourceText.Substring(0, $finalCommit.Index)");
    expect(runner).toMatch(/commit;\r?\n\\echo \$marker/u);
    expect(runner).not.toContain("supabase db push");
    expect(runner).not.toContain("supabase migration repair");
    expect(runner).not.toContain("supabase db pull");
  });

  it("keeps both checkout gates false and rejects production independently", () => {
    expect(runner).toContain("PRODUCTION_ENVIRONMENT_REJECTED");
    expect(runner).toContain("AP_DEPLOYMENT_ENV = 'staging'");
    expect(runner).toContain("APP_CHECKOUT_ENABLED");
    expect(runner).toContain("APP_CANARY_CHECKOUT_ENABLED");
    expect(runner).toContain("CHECKOUT_FLAG_NOT_FALSE");
    expect(runner).toContain("[StringComparison]::Ordinal");
  });

  it("uses named no-port containers, bounded processes, cleanup, and redacted stderr", () => {
    expect(runner).toContain("applypack-staging-migrate-");
    expect(runner).toContain("$Process.Kill($true)");
    expect(runner).toContain("CopyToAsync([IO.Stream]::Null)");
    expect(runner).toContain("PSQL_PROCESS_TIMEOUT");
    expect(runner).toContain("Ensure-ContainerAbsent");
    expect(runner).toContain("Assert-AllContainersAbsent");
    expect(runner).toContain("Assert-NoResidualRunnerContainers");
    expect(runner).toContain(
      "'ps', '--all', '--filter', 'name=applypack-staging-migrate-'",
    );
    expect(runner).toContain("'rm', '--force'");
    expect(runner).toContain(
      "$script:DockerCliReviewedPath = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'",
    );
    expect(runner).toContain(
      "$script:DockerEndpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'",
    );
    expect(runner).toContain("Assert-DockerDesktopEndpoint");
    expect(runner).toContain("return @('--host', $script:DockerEndpoint) + $Arguments");
    expect(runner).toContain("set lock_timeout='30s';");
    expect(runner).toContain("set statement_timeout='240s';");
    expect(runner).toContain("-TimeoutMilliseconds 300000");
    expect(runner).not.toMatch(/'--publish'|'-p'/u);
    expect(runner).not.toContain("$DockerExecutable");
    const inspectStart = runner.indexOf("function Test-ContainerExists");
    const inspectEnd = runner.indexOf("function Ensure-ContainerAbsent", inspectStart);
    const inspectBody = runner.slice(inspectStart, inspectEnd);
    expect(inspectBody).toContain("-RedirectOutput $true");
    expect(inspectBody).toContain(
      "$process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)",
    );
    expect(inspectBody).toContain("-StandardOutputTask $stdoutTask");
  });

  it("writes only one new atomic sanitized receipt outside repositories and reparse paths", () => {
    expect(runner).toContain("[IO.FileMode]::CreateNew");
    expect(runner).toContain("[IO.FileOptions]::WriteThrough");
    expect(runner).toContain("$stream.Flush($true)");
    expect(runner).toContain("function New-ReceiptReservation");
    expect(runner).toContain("function Assert-ReceiptReservation");
    expect(runner).toContain("function Publish-ReceiptReservation");
    expect(runner).toContain("function Close-ReceiptReservation");
    expect(runner).toContain(
      "[IO.File]::Move([string]$Reservation.PartialPath, [string]$Reservation.FinalPath)",
    );
    expect(runner).toContain("OpenRegularFileForDeletion($pathToRemove)");
    expect(runner).toContain("OUTPUT_INSIDE_GIT_WORKTREE");
    expect(runner).toContain("OUTPUT_REPARSE_PATH_REJECTED");
    expect(runner).toContain("STAGING_DATABASE_ADVANCEMENT_REQUIRES_INSPECTION");
    expect(runner).toContain("$script:MutationMayHaveCommitted = $true");
    expect(runner).toContain("teardownVerified = $true");
    expect(runner).toContain("residualNamedContainers = 0");
    expect(runner).not.toContain("tableRowCountSha256");
  });

  it("exposes a canonical focused test command", () => {
    expect(packageJson.scripts["test:staging-manual-launch-migrations"]).toBe(
      "vitest run tests/unit/staging-manual-launch-migration-runner.test.ts",
    );
  });

  it("isolates test child environments from case-insensitive inherited connection settings", () => {
    const inherited = {
      Path: "synthetic-path",
      TEMP: "synthetic-temp",
      ...Object.fromEntries(forbiddenEnvironment.flatMap(([name]) => [
        [name, "synthetic-forbidden"], [name.toLowerCase(), "synthetic-forbidden"],
      ])),
    };
    expect(cleanTestChildEnvironment(inherited)).toEqual({ Path: "synthetic-path", TEMP: "synthetic-temp" });
    expect(inherited).toHaveProperty("PGPASSWORD", "synthetic-forbidden");
    expect(inherited).toHaveProperty("pgpassword", "synthetic-forbidden");
  });

  // These native checks are required in the Windows CI job.
  if (process.platform === "win32") {
  it(
    "passes the networkless, credential-free dynamic SelfTest",
    () => {
      const pwsh = resolvePowerShell();
      expect(pwsh, "PowerShell 7 is required for the Windows SelfTest").toBeTruthy();
      const result = spawnSync(
        pwsh!,
        ["-NoLogo", "-NoProfile", "-File", runnerPath, "-Mode", "SelfTest"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          windowsHide: true,
          env: cleanTestChildEnvironment(),
          timeout: 60_000,
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        "SELF_TEST_SECRET_DO_NOT_LOG_92841",
      );
      const report = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      expect(report.status).toBe(
        "STAGING_MANUAL_LAUNCH_MIGRATION_SELF_TEST_OK",
      );
      expect(report.productionBindingRejected).toBe(true);
      expect(report.transactionAndLedgerAtomicityVerified).toBe(true);
      expect(report.exactLedgerTupleVerified).toBe(true);
      expect(report.predecessorLedgerIdentityAndDigestVerified).toBe(true);
      expect(report.passwordFirstShellHandoffVerified).toBe(true);
      expect(report.remainingSqlStdinVerified).toBe(true);
      expect(report.zeroAndOneMarkerHandlingVerified).toBe(true);
      expect(report.clientTlsConninfoVerified).toBe(true);
      expect(report.noSecretArgumentsEnvironmentOrFilesVerified).toBe(true);
      expect(report.forbiddenEnvironmentRejectionVerified).toBe(true);
      expect(report.childEnvironmentScrubbingVerified).toBe(true);
      expect(report.dockerDesktopNamedPipeBindingVerified).toBe(true);
      expect(report.serverTimeoutBoundsVerified).toBe(true);
      expect(report.atomicReceiptVerified).toBe(true);
      expect(report.longLivedReceiptReservationVerified).toBe(true);
      expect(report.failedReceiptReservationCleanupVerified).toBe(true);
    },
    65_000,
  );

  it(
    "rejects every forbidden inherited variable without echoing its value",
    () => {
      const pwsh = resolvePowerShell();
      expect(pwsh, "PowerShell 7 is required for the Windows SelfTest").toBeTruthy();
      for (const [name, expectedCode] of forbiddenEnvironment) {
        const marker = `DO_NOT_LOG_${name}_VALUE_92841`;
        const env = { ...cleanTestChildEnvironment(), [name]: marker };
        const result = spawnSync(
          pwsh!,
          ["-NoLogo", "-NoProfile", "-File", runnerPath, "-Mode", "SelfTest"],
          {
            cwd: repoRoot,
            encoding: "utf8",
            env,
            windowsHide: true,
            timeout: 15_000,
          },
        );
        expect(result.status, `${name}: ${result.stderr}`).toBe(1);
        expect(result.stdout.trim()).toBe("");
        expect(result.stderr.trim()).toBe(expectedCode);
        expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
      }
    },
    // Ten separate PowerShell startups each retain their 15-second deadline.
    // The aggregate bound must allow those native deadlines on Windows.
    forbiddenEnvironment.length * 15_000 + 20_000,
  );
  }
});

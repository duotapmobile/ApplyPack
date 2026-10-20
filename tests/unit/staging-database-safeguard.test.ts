import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const scriptPath = path.join(repoRoot, "scripts", "staging-database-safeguard.ps1");
const helperPath = path.join(
  repoRoot,
  "scripts",
  "lib",
  "ApplyPackStagingBackupEnvelope.cs",
);
const script = readFileSync(scriptPath, "utf8");
const helper = readFileSync(helperPath, "utf8");
const ciWorkflow = readFileSync(
  path.join(repoRoot, ".github", "workflows", "ci.yml"),
  "utf8",
);

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

describe("Windows staging database safeguard", () => {
  it("binds credential access to one exact Generic Credential Manager target", () => {
    expect(script).toContain(
      "[ApplyPack.Security.WindowsCredentialStore]::ReadStagingDatabase()",
    );
    expect(helper).toContain(
      'private const string StagingDatabaseTarget = "ApplyPack/Supabase/Staging/Database"',
    );
    expect(helper).not.toContain("ReadExactGeneric(string target)");
    expect(helper).toContain('EntryPoint = "CredReadW"');
    expect(helper).not.toContain("CredEnumerate");
    expect(helper).toContain("WriteUtf8LineTo(Stream stream)");
    expect(helper).not.toContain("WriteLineTo(TextWriter writer)");
    expect(helper).not.toContain("new StreamWriter");
  });

  it("uses a DPAPI CurrentUser envelope with encrypt-then-MAC streaming", () => {
    expect(helper).toContain('DllImport("crypt32.dll"');
    expect(helper).toContain("CryptProtectData");
    expect(helper).not.toContain("CryptProtectLocalMachine");
    expect(helper).toContain("HMACSHA256");
    expect(helper).toContain("CryptoStreamMode.Write");
    expect(helper).toContain("Authenticate(input, parsed)");
    expect(script).toContain(
      "[ApplyPack.Security.StagingBackupEnvelope]::Encrypt($process.StandardOutput.BaseStream, $Destination, $MetadataJson)",
    );
    expect(script).toContain("Complete-RedirectedProcess");
    expect(script).toContain("$Process.Kill($true)");
    expect(script).toContain("Ensure-ContainerAbsent");
  });

  it("fails closed on staging identity, TLS, image, and checkout bindings", () => {
    expect(script).toContain("AP_DEPLOYMENT_ENV = 'staging'");
    expect(script).toContain(
      "AP_PREMIGRATION_EXPECTED_PROJECT_REF = $script:ProjectRef",
    );
    expect(script).toContain("AP_PREMIGRATION_EXPECTED_RELEASE_SHA");
    expect(script).toContain("SAFEGUARD_SOURCE_NOT_AT_RELEASE_SHA");
    expect(script).toContain("Assert-EnvelopeReleaseBinding -Metadata $metadata");
    expect(script).toContain("sourceReleaseSha = $releaseSha");
    expect(script).toContain("ENVELOPE_RELEASE_SHA_MISMATCH");
    expect(script).toContain("PGSSLMODE=verify-full");
    expect(script).toContain(
      "public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86",
    );
    expect(script).toContain("CHECKOUT_FLAG_NOT_FALSE");
    expect(script).not.toContain("sslmode=require");
  });

  it("rejects Git/reparse outputs and keeps restore isolated", () => {
    expect(script).toContain("OUTPUT_INSIDE_GIT_WORKTREE");
    expect(script).toContain("OUTPUT_REPARSE_PATH_REJECTED");
    expect(script).toContain("OutputDirectoryGuard]::Capture");
    expect(script).toContain("Assert-GuardedOutputDirectory");
    expect(script).toContain("DirectoryIdentityToken = $guard.IdentityToken");
    expect(helper).toContain("public void AssertIdentity(");
    expect(script).toContain("OpenRegularFileForDeletion");
    expect(script).toContain("MarkDeleteOnClose");
    expect(script).toContain("[IO.FileShare]::None");
    expect(script).toContain("AuthenticateAndReadMetadata($envelopeStream)");
    expect(script).toContain("DecryptAuthenticated($EnvelopeStream");
    expect(script).toContain("'--network', 'none'");
    expect(script).toContain("publishedPorts = 0");
    expect(script).not.toMatch(/'--publish'|'-p'/u);
  });

  it("runs the dynamic DPAPI safeguard on a dedicated Windows CI job", () => {
    expect(ciWorkflow).toMatch(/staging-database-safeguard:\s*\n\s*runs-on: windows-latest/u);
    expect(ciWorkflow).toContain("npm run test:staging-database-safeguard");
    expect(ciWorkflow).not.toMatch(
      /staging-database-safeguard:[\s\S]*?secrets\./u,
    );
  });

  it("preserves primary failures and compares privacy-safe row-count evidence", () => {
    expect(script).toContain("Resolve-OperationFailures");
    expect(script).toContain("ApplyPackCleanupCode");
    expect(script).toContain("RESTORE_CONTAINER_TEARDOWN_FAILED");
    expect(script).toContain("tableRowCounts");
    expect(script).toContain("tableRowCountSha256");
    expect(script).toContain("jsonb_object_agg(table_name, row_count order by table_name)");
    expect(script).not.toContain("select * from %I.%I");
  });

  it.runIf(process.platform === "win32")(
    "passes the DPAPI/tamper/truncation/cleanup/no-secret self-test",
    () => {
      const pwsh = resolvePowerShell();
      expect(pwsh, "PowerShell 7 is required for the Windows self-test").toBeTruthy();
      const result = spawnSync(
        pwsh!,
        ["-NoLogo", "-NoProfile", "-File", scriptPath, "-Mode", "SelfTest"],
        { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 60_000 },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("STAGING_DATABASE_SAFEGUARD_SELF_TEST_OK");
      const report = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      expect(report.envelopeHandlePinned).toBe(true);
      expect(report.outputPathRaceRejected).toBe(true);
      expect(report.preCaptureSwapRejected).toBe(true);
      expect(report.releaseBindingVerified).toBe(true);
      expect(report.processFailureCleanupVerified).toBe(true);
      expect(report.credentialBufferCleared).toBe(true);
      expect(report.restoreFailurePrecedenceVerified).toBe(true);
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        "SELF_TEST_SECRET_DO_NOT_LOG_76291",
      );
    },
    65_000,
  );
});

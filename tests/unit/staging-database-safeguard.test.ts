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
  });

  it("uses a DPAPI CurrentUser envelope with encrypt-then-MAC streaming", () => {
    expect(helper).toContain('DllImport("crypt32.dll"');
    expect(helper).toContain("CryptProtectData");
    expect(helper).not.toContain("CryptProtectLocalMachine");
    expect(helper).toContain("HMACSHA256");
    expect(helper).toContain("CryptoStreamMode.Write");
    expect(helper).toContain("Authenticate(input, parsed)");
    expect(script).toContain(
      "[ApplyPack.Security.StagingBackupEnvelope]::Encrypt($process.StandardOutput.BaseStream, $output, $metadataJson)",
    );
  });

  it("fails closed on staging identity, TLS, image, and checkout bindings", () => {
    expect(script).toContain("AP_DEPLOYMENT_ENV = 'staging'");
    expect(script).toContain(
      "AP_PREMIGRATION_EXPECTED_PROJECT_REF = $script:ProjectRef",
    );
    expect(script).toContain("AP_PREMIGRATION_EXPECTED_RELEASE_SHA");
    expect(script).toContain("SAFEGUARD_SOURCE_NOT_AT_RELEASE_SHA");
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
    expect(script).toContain("Remove-Item -LiteralPath $temporaryPath");
    expect(script).toContain("AuthenticateAndReadMetadata($resolvedBackup)");
    expect(script).toContain("'--network', 'none'");
    expect(script).toContain("publishedPorts = 0");
    expect(script).not.toMatch(/'--publish'|'-p'/u);
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
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        "SELF_TEST_SECRET_DO_NOT_LOG_76291",
      );
    },
    65_000,
  );
});

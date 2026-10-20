// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const validator = resolve(process.cwd(), "scripts/validate-aws-staging-foundation-template.mjs");
const template = resolve(process.cwd(), "infra/aws/staging-foundation/template.yaml");
const runbook = resolve(process.cwd(), "docs/runbooks/AWS_STAGING_FOUNDATION.md");
const canonicalOrigin = "https://github.com/duotapmobile/ApplyPack.git";

function git(cwd: string, args: string[], encoding: BufferEncoding | null = "utf8") {
  return execFileSync("git", args, {
    cwd,
    encoding,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function validationFails(path: string, runbookPath = runbook) {
  try {
    execFileSync(process.execPath, [validator, "--template", path, "--runbook", runbookPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: "pipe",
    });
    return false;
  } catch {
    return true;
  }
}

describe("AWS staging foundation template", () => {
  it("passes the deterministic staging-only security guard", () => {
    const output = execFileSync(process.execPath, [validator], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(output.trim()).toBe("AWS_STAGING_FOUNDATION_TEMPLATE_OK");
  });

  it("extracts the exact reviewed Git blob atomically with real Git on this platform", () => {
    const work = mkdtempSync(join(tmpdir(), "applypack-staging-foundation-extract-"));
    const fixture = join(work, "fixture-repo");
    const output = join(work, "reviewed-template.yaml");
    const dirtyOutput = join(work, "dirty-template.yaml");
    const stagedOutput = join(work, "staged-template.yaml");
    const wrongBlobOutput = join(work, "wrong-blob-template.yaml");
    const wrongCommitOutput = join(work, "wrong-commit-template.yaml");
    const wrongTreeOutput = join(work, "wrong-tree-template.yaml");
    const insideRepoOutput = join(fixture, "reviewed-template.yaml");
    const fixturePaths = [
      ".github/workflows/ci.yml",
      "docs/runbooks/AWS_STAGING_FOUNDATION.md",
      "infra/aws/staging-foundation/template.yaml",
      "scripts/test-aws-staging-foundation-controls.ps1",
      "scripts/validate-aws-staging-foundation-template.mjs",
      "tests/unit/aws-staging-foundation-template.test.ts",
    ];

    try {
      mkdirSync(fixture);
      git(fixture, ["init", "--quiet"]);
      git(fixture, ["remote", "add", "origin", canonicalOrigin]);
      for (const fixturePath of fixturePaths) {
        const destination = join(fixture, fixturePath);
        mkdirSync(resolve(destination, ".."), { recursive: true });
        if (fixturePath.includes("template.yaml")) {
          writeFileSync(destination, readFileSync(template));
        } else {
          writeFileSync(destination, `fixture:${fixturePath}\r\n`, "utf8");
        }
      }
      git(fixture, ["add", "--", ...fixturePaths]);
      git(fixture, [
        "-c", "user.name=ApplyPack Foundation Test",
        "-c", "user.email=foundation-test@applypack.invalid",
        "-c", "commit.gpgsign=false",
        "commit", "--quiet", "-m", "fixture",
      ]);
      const commit = String(git(fixture, ["rev-parse", "HEAD"])).trim();
      const tree = String(git(fixture, ["rev-parse", "HEAD^{tree}"])).trim();
      const blob = String(git(fixture, ["rev-parse", "HEAD:infra/aws/staging-foundation/template.yaml"])).trim();
      const committedBytes = git(fixture, ["cat-file", "blob", blob], null) as Buffer;

      const extraction = execFileSync(process.execPath, [
        validator,
        "--extract-reviewed-template",
        "--repo", fixture,
        "--approved-commit", commit,
        "--approved-tree", tree,
        "--approved-blob", blob,
        "--output", output,
      ], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
      expect(extraction).toBe(`AWS_STAGING_FOUNDATION_REVIEWED_TEMPLATE_EXTRACTED=${blob}`);
      expect(readFileSync(output).equals(committedBytes)).toBe(true);
      expect(String(git(fixture, ["hash-object", "--no-filters", output])).trim()).toBe(blob);
      expect(statSync(output).mode & 0o222).toBe(0);
      expect(readdirSync(work).some((name) => name.includes(".partial-"))).toBe(false);

      expect(() => execFileSync(process.execPath, [
        validator, "--extract-reviewed-template", "--repo", fixture,
        "--approved-commit", commit, "--approved-tree", tree,
        "--approved-blob", "0".repeat(40), "--output", wrongBlobOutput,
      ], { cwd: process.cwd(), stdio: "pipe", windowsHide: true })).toThrow();
      expect(() => execFileSync(process.execPath, [
        validator, "--extract-reviewed-template", "--repo", fixture,
        "--approved-commit", "1".repeat(40), "--approved-tree", tree,
        "--approved-blob", blob, "--output", wrongCommitOutput,
      ], { cwd: process.cwd(), stdio: "pipe", windowsHide: true })).toThrow();
      expect(() => execFileSync(process.execPath, [
        validator, "--extract-reviewed-template", "--repo", fixture,
        "--approved-commit", commit, "--approved-tree", "2".repeat(40),
        "--approved-blob", blob, "--output", wrongTreeOutput,
      ], { cwd: process.cwd(), stdio: "pipe", windowsHide: true })).toThrow();
      expect(() => execFileSync(process.execPath, [
        validator, "--extract-reviewed-template", "--repo", fixture,
        "--approved-commit", commit, "--approved-tree", tree,
        "--approved-blob", blob, "--output", insideRepoOutput,
      ], { cwd: process.cwd(), stdio: "pipe", windowsHide: true })).toThrow();

      writeFileSync(join(fixture, fixturePaths[0]), "dirty\n", "utf8");
      expect(() => execFileSync(process.execPath, [
        validator, "--extract-reviewed-template", "--repo", fixture,
        "--approved-commit", commit, "--approved-tree", tree,
        "--approved-blob", blob, "--output", dirtyOutput,
      ], { cwd: process.cwd(), stdio: "pipe", windowsHide: true })).toThrow();

      git(fixture, ["add", "--", fixturePaths[0]]);
      expect(() => execFileSync(process.execPath, [
        validator, "--extract-reviewed-template", "--repo", fixture,
        "--approved-commit", commit, "--approved-tree", tree,
        "--approved-blob", blob, "--output", stagedOutput,
      ], { cwd: process.cwd(), stdio: "pipe", windowsHide: true })).toThrow();
      expect([
        wrongBlobOutput, wrongCommitOutput, wrongTreeOutput, insideRepoOutput, dirtyOutput, stagedOutput,
      ].some(existsSync)).toBe(false);
    } finally {
      for (const file of [
        output, dirtyOutput, stagedOutput, wrongBlobOutput, wrongCommitOutput, wrongTreeOutput, insideRepoOutput,
      ]) {
        if (existsSync(file)) chmodSync(file, 0o600);
      }
      rmSync(work, { recursive: true, force: true });
    }
  }, 240_000);

  it("rejects public, routed, cross-account, unrotated, and weak-deletion mutations", () => {
    const original = readFileSync(template, "utf8");
    const work = mkdtempSync(join(tmpdir(), "applypack-staging-foundation-negative-"));
    const mutations = [
      ["public-ip", "MapPublicIpOnLaunch: false", "MapPublicIpOnLaunch: true"],
      ["same-az", "          - 1\n          - Fn::GetAZs: \"\"", "          - 0\n          - Fn::GetAZs: \"\""],
      ["rotation-off", "EnableKeyRotation: true", "EnableKeyRotation: false"],
      ["retain-on-create", "DeletionPolicy: RetainExceptOnCreate", "DeletionPolicy: Retain"],
      ["short-deletion", "PendingWindowInDays: 30", "PendingWindowInDays: 7"],
      ["wrong-alias", "alias/applypack-staging-sensitive-payloads", "alias/applypack-sensitive-payloads"],
      ["wrong-account", '"838445019912"', '"000000000000"'],
      ["public-principal", 'AWS: !Sub "arn:${AWS::Partition}:iam::${AWS::AccountId}:root"', 'AWS: "*"'],
      ["wrong-context", "kms:EncryptionContext:deployment: staging", "kms:EncryptionContext:deployment: production"],
      ["missing-tag", "        - { Key: ManagedBy, Value: CloudFormation }", ""],
    ] as const;

    try {
      for (const [name, before, after] of mutations) {
        const changed = original.replace(before, after);
        expect(changed).not.toBe(original);
        const path = join(work, `${name}.yaml`);
        writeFileSync(path, changed, "utf8");
        expect(validationFails(path)).toBe(true);
      }

      const routedPath = join(work, "default-route.yaml");
      const routed = original.replace(
        "  StagingSensitivePayloadKey:\n",
        "  PublicDefaultRoute:\n    Type: AWS::EC2::Route\n    Properties:\n      RouteTableId: !Ref PrivateRouteTableA\n      DestinationCidrBlock: 0.0.0.0/0\n      GatewayId: igw-unapproved\n\n  StagingSensitivePayloadKey:\n",
      );
      expect(routed).not.toBe(original);
      writeFileSync(routedPath, routed, "utf8");
      expect(validationFails(routedPath)).toBe(true);

      const iamPath = join(work, "iam-resource.yaml");
      const withIam = original.replace(
        "  StagingSensitivePayloadKey:\n",
        "  UnapprovedRole:\n    Type: AWS::IAM::Role\n    Properties: {}\n\n  StagingSensitivePayloadKey:\n",
      );
      expect(withIam).not.toBe(original);
      writeFileSync(iamPath, withIam, "utf8");
      expect(validationFails(iamPath)).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 60_000);

  it("produces a stable normalized template hash and rejects a runbook missing provenance controls", () => {
    const originalHash = execFileSync(process.execPath, [validator, "--print-template-sha256"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    expect(originalHash).toMatch(/^AWS_STAGING_FOUNDATION_TEMPLATE_SHA256=[a-f0-9]{64}$/);

    const work = mkdtempSync(join(tmpdir(), "applypack-staging-foundation-receipt-"));
    try {
      const commentedTemplate = join(work, "commented-template.yaml");
      writeFileSync(commentedTemplate, `# formatting-only provider comment\n${readFileSync(template, "utf8")}`, "utf8");
      const commentedHash = execFileSync(process.execPath, [validator, "--template", commentedTemplate, "--print-template-sha256"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }).trim();
      expect(commentedHash).toBe(originalHash);

      const originalRunbook = readFileSync(runbook, "utf8");
      const runbookMutations = [
        ["provenance", "diff --quiet HEAD -- $apOwnedPaths", "diff --name-only HEAD -- $apOwnedPaths"],
        ["staged-provenance", "diff --cached --quiet HEAD -- $apOwnedPaths", "diff --cached --name-only HEAD -- $apOwnedPaths"],
        ["origin-provenance", "remote get-url origin", "remote show origin"],
        ["head-provenance", "rev-parse 'HEAD^{commit}'", "rev-parse HEAD"],
        ["tree-provenance", "rev-parse \"$apApprovedSha^{tree}\"", "rev-parse HEAD^{tree}"],
        ["template-blob-provenance", "rev-parse \"${apApprovedSha}:infra/aws/staging-foundation/template.yaml\"", "rev-parse HEAD:infra/aws/staging-foundation/template.yaml"],
        ["binary-extraction", "--extract-reviewed-template", "--inspect-reviewed-template"],
        ["blob-verification", "hash-object --no-filters $apReviewedTemplatePath", "hash-object $apReviewedTemplatePath"],
        ["alias-preflight", "kms list-aliases", "kms list-unreviewed-aliases"],
        ["rollback-state", "PendingDeletion", "PendingRemoval"],
        ["provider-receipt", "cloudformation get-template", "cloudformation describe-template"],
        ["provider-body-hash", "$apProviderTemplateBodySha256 -ne $apReviewedTemplateBodySha256", "$false"],
        ["change-set-create", "'cloudformation', 'create-change-set'", "'cloudformation', 'prepare-change-set'"],
        ["governed-create-action", "apiAction = 'CreateChangeSet'", "apiAction = 'UpdateStack'"],
        ["governed-create-type", "changeSetType = 'CREATE'", "changeSetType = 'UPDATE'"],
        ["governed-create-failure-policy", "onStackFailure = 'ROLLBACK'", "onStackFailure = 'DO_NOTHING'"],
        ["governed-create-hash", "$apCurrentCreateRequestSha256 -ne $apGovernedCreateRequestSha256", "$apCurrentCreateRequestSha256 -eq $apGovernedCreateRequestSha256"],
        ["explicit-no-nested", "--no-include-nested-stacks", "--include-nested-stacks"],
        ["explicit-no-import", "--no-import-existing-resources", "--import-existing-resources"],
        ["change-set-execute", "cloudformation execute-change-set", "cloudformation run-change-set"],
        ["change-set-cleanup", "cloudformation delete-change-set", "cloudformation discard-change-set"],
        ["stack-id-return", "$apCreateChangeSet.StackId", "$apCreateChangeSet.StackName"],
        ["stack-id-receipt", "stackId = $apStackId", "stackNameOnly = $apStackName"],
        ["change-set-id-receipt", "changeSetId = $apChangeSetId", "changeSetNameOnly = $apChangeSetName"],
        ["empty-placeholder", "cloudformation list-stack-resources", "cloudformation describe-stack-resources"],
        ["review-in-progress", "REVIEW_IN_PROGRESS", "CREATE_IN_PROGRESS"],
        ["early-termination-protection", "--enable-termination-protection", "--no-enable-termination-protection"],
        ["final-termination-protection", "$apCreatedStack.EnableTerminationProtection -ne $true", "$apCreatedStack.EnableTerminationProtection -eq $true"],
        ["first-approval", "$apSupervisorOneApprovedChangeSetReceiptSha256", "$apReviewerOneReceipt"],
        ["second-approval", "$apSupervisorTwoApprovedChangeSetReceiptSha256", "$apReviewerTwoReceipt"],
        ["exact-resource-count", "$ChangeSet.Changes.Count -ne 9", "$ChangeSet.Changes.Count -lt 1"],
        ["exact-logical-id-set", "Compare-Object -ReferenceObject $apExpectedLogicalIds -DifferenceObject $apActualLogicalIds", "Compare-Object -ReferenceObject $apExpectedLogicalIds -DifferenceObject @()"],
        ["add-only", "$apResource.Action -ne 'Add'", "$apResource.Action -ne 'Modify'"],
        ["resource-only", "$_.Type -ne 'Resource'", "$_.Type -ne 'Unsupported'"],
        ["no-replacement", "$null -ne $apResource.Replacement", "$false"],
        ["no-capabilities", "@($ChangeSet.Capabilities).Count -ne 0", "@($ChangeSet.Capabilities).Count -gt 99"],
        ["null-safe-parameters", "$apParameterCount -ne 0", "$apParameterCount -lt 0"],
        ["safe-provider-deployment-config", "Assert-FoundationSafeDeploymentConfig", "Accept-AnyFoundationDeploymentConfig"],
        ["powershell-seven", "if ($PSVersionTable.PSVersion.Major -lt 7)", "if ($PSVersionTable.PSVersion.Major -lt 5)"],
        ["no-import", "$apImportExistingResources -eq $true", "$apImportExistingResources -eq $false"],
        ["receipt-recompute", "$apExecuteReceiptJson -cne $apChangeSetReceiptJson", "$apExecuteReceiptJson -ceq $apChangeSetReceiptJson"],
        ["stored-receipt-binding", "$apStoredReceiptJson -cne $apExecuteReceiptJson", "$apStoredReceiptJson -ceq $apExecuteReceiptJson"],
        ["placeholder-unprotect", "--no-enable-termination-protection", "--enable-termination-protection"],
        ["placeholder-delete", "cloudformation delete-stack", "cloudformation retain-stack"],
        ["placeholder-delete-wait", "stack-delete-complete", "stack-delete-started"],
        ["immutable-template", "'--template-body', $apGovernedCreateRequest.templateUri", "'--template-body', 'file://infra/aws/staging-foundation/template.yaml'"],
        ["exact-change-set-id", "--change-set-name $apChangeSetId", "--change-set-name $apChangeSetName"],
      ] as const;
      for (const [name, before, after] of runbookMutations) {
        const weakenedRunbook = join(work, `${name}-runbook.md`);
        const changed = originalRunbook.replaceAll(before, after);
        expect(changed).not.toBe(originalRunbook);
        writeFileSync(weakenedRunbook, changed, "utf8");
        expect(validationFails(template, weakenedRunbook)).toBe(true);
      }

      for (const directCommand of ["cloudformation create-stack", "cloudformation deploy"]) {
        const directRunbook = join(work, `${directCommand.replaceAll(" ", "-")}-runbook.md`);
        writeFileSync(directRunbook, `${originalRunbook}\n\`\`\`powershell\n& $apAws ${directCommand} --stack-name $apStackName\n\`\`\`\n`, "utf8");
        expect(validationFails(template, directRunbook)).toBe(true);
      }

      const brokenExtractionRunbook = join(work, "git-show-output-runbook.md");
      writeFileSync(brokenExtractionRunbook,
        `${originalRunbook}\n\`\`\`powershell\ngit show --no-color --output=$apReviewedTemplatePath $apApprovedSha:infra/aws/staging-foundation/template.yaml\n\`\`\`\n`,
        "utf8");
      expect(validationFails(template, brokenExtractionRunbook)).toBe(true);

      const capabilityRunbook = join(work, "iam-capability-runbook.md");
      writeFileSync(capabilityRunbook, originalRunbook.replace(
        "'--change-set-type', $apGovernedCreateRequest.changeSetType,",
        "'--change-set-type', $apGovernedCreateRequest.changeSetType,\n    '--capabilities', 'CAPABILITY_NAMED_IAM',",
      ), "utf8");
      expect(validationFails(template, capabilityRunbook)).toBe(true);

      const fabricatedProviderTypeRunbook = join(work, "fabricated-provider-change-set-type-runbook.md");
      writeFileSync(fabricatedProviderTypeRunbook,
        `${originalRunbook}\n\`\`\`powershell\nif ($ChangeSet.ChangeSetType -ne 'CREATE') { throw 'unavailable provider field' }\n\`\`\`\n`,
        "utf8");
      expect(validationFails(template, fabricatedProviderTypeRunbook)).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 300_000);
});

// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const validator = resolve(process.cwd(), "scripts/validate-aws-staging-foundation-template.mjs");
const template = resolve(process.cwd(), "infra/aws/staging-foundation/template.yaml");
const runbook = resolve(process.cwd(), "docs/runbooks/AWS_STAGING_FOUNDATION.md");

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
        ["provenance", "git diff --quiet HEAD --", "git diff --name-only HEAD --"],
        ["alias-preflight", "kms list-aliases", "kms list-unreviewed-aliases"],
        ["rollback-state", "PendingDeletion", "PendingRemoval"],
        ["provider-receipt", "cloudformation get-template", "cloudformation describe-template"],
        ["change-set-create", "cloudformation create-change-set", "cloudformation prepare-change-set"],
        ["change-set-execute", "cloudformation execute-change-set", "cloudformation run-change-set"],
        ["change-set-cleanup", "cloudformation delete-change-set", "cloudformation discard-change-set"],
        ["termination-protection", "update-termination-protection", "describe-termination-protection"],
        ["first-approval", "$apSupervisorOneApprovedChangeSetReceiptSha256", "$apReviewerOneReceipt"],
        ["second-approval", "$apSupervisorTwoApprovedChangeSetReceiptSha256", "$apReviewerTwoReceipt"],
        ["exact-resource-count", "$apChangeSet.Changes.Count -ne 9", "$apChangeSet.Changes.Count -lt 1"],
        ["exact-logical-id-set", "Compare-Object -ReferenceObject $apExpectedLogicalIds -DifferenceObject $apActualLogicalIds", "Compare-Object -ReferenceObject $apExpectedLogicalIds -DifferenceObject @()"],
        ["add-only", "$apResource.Action -ne 'Add'", "$apResource.Action -ne 'Modify'"],
        ["no-replacement", "$null -ne $apResource.Replacement", "$false"],
        ["no-capabilities", "$apChangeSet.Capabilities.Count -ne 0", "$apChangeSet.Capabilities.Count -gt 99"],
        ["immutable-template", "--template-body $apReviewedTemplateUri", "--template-body file://infra/aws/staging-foundation/template.yaml"],
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

      const capabilityRunbook = join(work, "iam-capability-runbook.md");
      writeFileSync(capabilityRunbook, originalRunbook.replace(
        "--change-set-type CREATE `",
        "--change-set-type CREATE `\n  --capabilities CAPABILITY_NAMED_IAM `",
      ), "utf8");
      expect(validationFails(template, capabilityRunbook)).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);
});

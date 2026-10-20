// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const validator = resolve(process.cwd(), "scripts/validate-aws-staging-foundation-template.mjs");
const template = resolve(process.cwd(), "infra/aws/staging-foundation/template.yaml");

function validationFails(path: string) {
  try {
    execFileSync(process.execPath, [validator, "--template", path], {
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
  }, 30_000);
});

// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const validator = resolve(process.cwd(), "scripts/validate-aws-document-worker-template.mjs");
const mainTemplate = resolve(process.cwd(), "infra/aws/document-worker/template.yaml");
const deploymentTemplate = resolve(process.cwd(), "infra/aws/document-worker/deployment-role-template.yaml");

function validationFails(args: string[]) {
  try {
    execFileSync(process.execPath, [validator, ...args], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" });
    return false;
  } catch { return true; }
}

describe("AWS document worker source template", () => {
  it("passes the offline CloudFormation and Docker security guard", () => {
    const output = execFileSync(process.execPath, [validator], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(output.trim()).toBe("AWS_DOCUMENT_WORKER_TEMPLATE_OK");
  });

  it("rejects permissive template mutations", () => {
    const work = mkdtempSync(join(tmpdir(), "applypack-aws-template-negative-"));
    const original = readFileSync(mainTemplate, "utf8");
    const mutations = [
      ["public-access", "BlockPublicPolicy: true", "BlockPublicPolicy: false"],
      ["endpoint-action", "Action: [s3:GetObject, s3:PutObject, s3:DeleteObject]", "Action: [s3:GetObject, s3:PutObject, s3:DeleteObject, s3:ListBucket]"],
      ["worker-action", '        - PolicyName: WorkerTemporaryObjectOnly\n          PolicyDocument:\n            Version: "2012-10-17"\n            Statement:\n              - Effect: Allow\n                Action: [s3:GetObject, s3:PutObject, s3:DeleteObject]', '        - PolicyName: WorkerTemporaryObjectOnly\n          PolicyDocument:\n            Version: "2012-10-17"\n            Statement:\n              - Effect: Allow\n                Action: s3:*'],
      ["unversioned-invoke", "Resource: !Ref WorkerVersion", "Resource: !Ref Worker"],
      ["wrong-trust", "Principal: { Service: lambda.amazonaws.com }", "Principal: { Service: ec2.amazonaws.com }"],
    ] as const;
    try {
      for (const [name, before, after] of mutations) {
        const path = join(work, `${name}.yaml`);
        const changed = original.replace(before, after);
        expect(changed).not.toBe(original);
        writeFileSync(path, changed, "utf8");
        expect(validationFails(["--template", path])).toBe(true);
      }
      const deploymentPath = join(work, "wildcard-pass-role.yaml");
      const changedDeployment = readFileSync(deploymentTemplate, "utf8").replace(
        '          - Sid: ConstrainedPassRole\n            Effect: Allow\n            Action: iam:PassRole\n            Resource: !Sub "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/applypack/${DeploymentEnvironment}/applypack-${DeploymentEnvironment}-document-worker-execution"',
        '          - Sid: ConstrainedPassRole\n            Effect: Allow\n            Action: iam:PassRole\n            Resource: "*"',
      );
      expect(changedDeployment).not.toBe(readFileSync(deploymentTemplate, "utf8"));
      writeFileSync(deploymentPath, changedDeployment, "utf8");
      expect(validationFails(["--deployment-template", deploymentPath])).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 30_000);

  it("passes provider-evidence fixtures and rejects unsafe route and ECR mutations", () => {
    const output = execFileSync(process.execPath, [resolve(process.cwd(), "scripts/test-aws-document-worker-preflight.mjs")], {
      cwd: process.cwd(), encoding: "utf8",
    });
    expect(output.trim()).toBe("AWS_DOCUMENT_WORKER_PREFLIGHT_FIXTURES_OK");
  });
});

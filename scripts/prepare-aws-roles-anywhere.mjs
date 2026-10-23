import { createHash, X509Certificate } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertSinglePem } from "./lib/aws-roles-anywhere.mjs";

export function prepareRolesAnywhere(manifest, caPem) {
  const deployment = manifest?.deploymentEnvironment;
  const account = "838445019912";
  if (!["staging", "production"].includes(deployment) || manifest.accountId !== account || manifest.region !== "us-east-1"
    || !new RegExp(`^arn:aws:lambda:us-east-1:${account}:function:applypack-${deployment}-document-worker:[1-9][0-9]*$`).test(manifest.workerVersionArn || "")
    || !new RegExp(`^arn:aws:kms:us-east-1:${account}:key/[a-f0-9-]{36}$`).test(manifest.kmsKeyArn || "")
    || !/^[A-Za-z0-9._:-]{1,64}$/.test(manifest.kmsKeyVersion || "")
    || manifest.temporaryBucket !== `applypack-${account}-${deployment}-document-worker-temp`
    || manifest.temporaryPrefix !== "ephemeral/") throw new Error("roles_anywhere_change_set_identity_invalid");
  let ca;
  try { assertSinglePem(Buffer.from(caPem), "certificate"); ca = new X509Certificate(caPem); } catch { throw new Error("roles_anywhere_public_ca_invalid"); }
  if (!ca.ca || createHash("sha256").update(ca.raw).digest("hex") !== manifest.caCertificateSha256
    || /PRIVATE KEY/.test(caPem) || Date.parse(ca.validTo) <= Date.now() || Date.parse(ca.validFrom) > Date.now()) {
    throw new Error("roles_anywhere_public_ca_invalid");
  }
  const template = JSON.parse(readFileSync(new URL("../infra/aws/roles-anywhere/template.json", import.meta.url), "utf8"));
  template.Parameters.DeploymentEnvironment.AllowedValues = [deployment];
  template.Parameters.DeploymentEnvironment.Default = deployment;
  template.Parameters.OfflineCaCertificatePem.Default = caPem;
  template.Parameters.WorkerRuntimePolicyArn.Default = `arn:aws:iam::${account}:policy/applypack/${deployment}/applypack-${deployment}-document-worker-runtime`;
  delete template.Parameters.CallerPermissionsBoundaryArn;
  for (const rule of Object.values(template.Rules)) {
    rule.Assertions = rule.Assertions.filter((assertion) => !JSON.stringify(assertion).includes("CallerPermissionsBoundaryArn"));
  }
  template.Resources.CallerBoundary = { Type: "AWS::IAM::ManagedPolicy", Properties: {
    ManagedPolicyName: `applypack-${deployment}-railway-caller-boundary`, Path: `/applypack/${deployment}/`,
    PolicyDocument: { Version: "2012-10-17", Statement: [
      { Effect: "Allow", Action: "lambda:InvokeFunction", Resource: manifest.workerVersionArn },
      { Effect: "Allow", Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        Resource: `arn:aws:s3:::${manifest.temporaryBucket}/ephemeral/*`, Condition: { Bool: { "aws:SecureTransport": "true" } } },
      { Effect: "Allow", Action: ["kms:Encrypt", "kms:Decrypt"], Resource: manifest.kmsKeyArn,
        Condition: { StringEquals: { "kms:EncryptionContext:application": "ApplyPack",
          "kms:EncryptionContext:deployment": deployment, "kms:EncryptionContext:keyVersion": manifest.kmsKeyVersion } } },
      { Effect: "Allow", Action: "kms:DescribeKey", Resource: manifest.kmsKeyArn }
    ] }
  } };
  template.Resources.CallerRole.Properties.PermissionsBoundary = { Ref: "CallerBoundary" };
  return { template, review: { deploymentEnvironment: deployment, accountId: account, region: "us-east-1",
    caCertificateSha256: manifest.caCertificateSha256, workerVersionArn: manifest.workerVersionArn,
    callerRoleName: `applypack-${deployment}-railway-caller`,
    providerVerified: false, provisioned: false, mutationAuthorized: false,
    owners: { certificateIssuance: "UNASSIGNED", rotation: "UNASSIGNED", revocation: "UNASSIGNED",
      expiryAlerts: "UNASSIGNED", provisioning: "UNASSIGNED", recovery: "UNASSIGNED" },
    hourlySessionLimitSeconds: 3600, maximumLeafLifetimeDays: 30, rotationAlertDays: 7,
    remainingApprovals: ["exact target verification", "separate environment CA and leaf custody", "named owners",
      "scoped provisioning change set and cost", "leaf secret entry", "actual refresh and revocation proof"] } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [manifestPath, publicCaPath, outputDirectory] = process.argv.slice(2);
  if (![manifestPath, publicCaPath, outputDirectory].every((path) => path && isAbsolute(path))) {
    throw new Error("usage_absolute_manifest_public_ca_output_directory_required");
  }
  const result = prepareRolesAnywhere(JSON.parse(readFileSync(manifestPath, "utf8")), readFileSync(publicCaPath, "utf8"));
  mkdirSync(outputDirectory, { recursive: true });
  for (const [name, value] of Object.entries({ "roles-anywhere.template.json": result.template, "review.json": result.review })) {
    writeFileSync(join(outputDirectory, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  }
  console.log("ROLES_ANYWHERE_REVIEW_ARTIFACTS_PREPARED_NO_PROVIDER_CALLS");
}

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ARCHIVE_VERIFIER, validateArchiveVerifierConfiguration, awsArchiveVerifierCredentials } from "./lib/aws-archive-verifier-credentials.mjs";
const prefix = "APP_ARCHIVE_VERIFIER_AWS_RA_";
const environment = () => ({ APP_ARCHIVE_VERIFICATION_ENABLED: "true", APP_DEPLOYMENT_ENV: "production", APP_AWS_ACCOUNT_ID: "838445019912", AWS_REGION: "us-east-1",
  [`${prefix}DEPLOYMENT_ENV`]: "production", [`${prefix}ROLE_ARN`]: ARCHIVE_VERIFIER.roleArn, [`${prefix}HELPER_PATH`]: ARCHIVE_VERIFIER.helperPath,
  [`${prefix}TRUST_ANCHOR_ARN`]: "arn:aws:rolesanywhere:us-east-1:838445019912:trust-anchor/11111111-1111-4111-8111-111111111111",
  [`${prefix}PROFILE_ARN`]: "arn:aws:rolesanywhere:us-east-1:838445019912:profile/22222222-2222-4222-8222-222222222222",
  [`${prefix}CERTIFICATE_SHA256`]: "a".repeat(64), [`${prefix}CA_CERTIFICATE_SHA256`]: "b".repeat(64) });
test("verifier selects its exact temporary identity independently of web identity", () => {
  const result = validateArchiveVerifierConfiguration({ ...environment(), APP_AWS_RA_ROLE_ARN: "unrelated-web-role" });
  assert.equal(result.roleArn, ARCHIVE_VERIFIER.roleArn); assert.equal(result.certificateSubject, "CN=applypack-production-archive-verifier");
});
for (const name of ["AWS_ACCESS_KEY_ID", "AWS_PROFILE", "AWS_ENDPOINT_URL_S3", "AWS_WEB_IDENTITY_TOKEN_FILE", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS"])
  test(`verifier rejects ${name} fallback`, () => assert.throws(() => validateArchiveVerifierConfiguration({ ...environment(), [name]: "wrong" }), /FALLBACK_FORBIDDEN/u));
for (const [name, value] of [["APP_ARCHIVE_VERIFICATION_ENABLED", "false"], ["APP_DEPLOYMENT_ENV", "staging"], ["APP_AWS_ACCOUNT_ID", "000000000000"],
  [`${prefix}ROLE_ARN`, "arn:aws:iam::838445019912:role/applypack/production/applypack-production-recovery-reader"], [`${prefix}HELPER_PATH`, "/tmp/untrusted"],
  [`${prefix}TRUST_ANCHOR_ARN`, "arn:aws:rolesanywhere:us-west-2:838445019912:trust-anchor/11111111-1111-4111-8111-111111111111"]])
  test(`verifier rejects wrong ${name}`, () => assert.throws(() => validateArchiveVerifierConfiguration({ ...environment(), [name]: value })));
test("absent verifier certificate never falls back to web or operator credentials", async () => {
  const provider = awsArchiveVerifierCredentials({ ...environment(), APP_AWS_RA_CERTIFICATE_PEM_BASE64: "private-web-material" });
  // The shared credential boundary deliberately sanitizes certificate failures.
  await assert.rejects(provider(), /^Error: aws_roles_anywhere_refresh_failed$/u);
});
test("configuration changes invalidate the prepared credential provider", async () => {
  const env = environment(); const provider = awsArchiveVerifierCredentials(env); env[`${prefix}CERTIFICATE_SHA256`] = "c".repeat(64);
  await assert.rejects(provider(), /CONFIGURATION_CHANGED/u);
});
test("unprovisioned verifier template is finite, default-disabled and has no writer/delete/paid infrastructure", () => {
  const template = JSON.parse(readFileSync(new URL("../infra/aws/archive-verifier/template.json", import.meta.url)));
  assert.deepEqual(Object.values(template.Resources).map((r) => r.Type).sort(), ["AWS::IAM::ManagedPolicy", "AWS::IAM::Role", "AWS::RolesAnywhere::Profile"]);
  assert.equal(template.Parameters.EnableArchiveVerifier.Default, "false");
  const policy = template.Resources.ArchiveVerifierBoundary.Properties.PolicyDocument.Statement;
  assert.deepEqual(policy.flatMap((s) => s.Action).sort(), ["kms:Decrypt", "s3:GetObjectVersion", "s3:ListBucketVersions"]);
  const read = policy.find((s) => s.Action.includes("s3:GetObjectVersion")); assert.equal(read.Resource.length, 8);
  assert.ok(read.Resource.every((r) => r.startsWith("arn:aws:s3:::applypack-production-protected-recovery-838445019912/")));
  const kms = policy.find((s) => s.Action.includes("kms:Decrypt")); assert.deepEqual(kms.Resource, { Ref: "ArchiveKeyArn" });
  assert.equal(kms.Condition.StringEquals["kms:ViaService"], "s3.us-east-1.amazonaws.com");
  assert.deepEqual(kms.Condition.StringLike["kms:EncryptionContext:aws:s3:arn"], read.Resource);
  const role = template.Resources.ArchiveVerifierRole.Properties;
  assert.deepEqual(role.PermissionsBoundary, { Ref: "ArchiveVerifierBoundary" });
  assert.equal(role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals["aws:PrincipalTag/x509Subject/CN"], ARCHIVE_VERIFIER.roleName);
  assert.equal(template.Resources.ArchiveVerifierProfile.Properties.DurationSeconds, 3600);
});

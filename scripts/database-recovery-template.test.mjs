import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = JSON.parse(readFileSync(new URL("../infra/aws/database-recovery-writer/template.json", import.meta.url), "utf8"));
const resources = template.Resources;
const statements = resources.DatabaseWriterBoundary.Properties.PolicyDocument.Statement;
const archive = "arn:aws:s3:::applypack-production-protected-recovery-838445019912";
const keyArn = "arn:aws:kms:us-east-1:838445019912:key/11111111-1111-4111-8111-111111111111";
const resolveValue = (value) => value?.Ref === "ArchiveKeyArn" ? keyArn : value;
const matches = (pattern, value) => pattern.endsWith("*") ? value.startsWith(pattern.slice(0, -1)) : value === pattern;
function allowed(action, resource, context = {}) {
  return statements.some((statement) => statement.Effect === "Allow" && statement.Action.includes(action)
    && matches(resolveValue(statement.Resource), resource)
    && Object.entries(statement.Condition || {}).every(([operator, conditions]) => Object.entries(conditions)
      .every(([name, value]) => operator === "StringEquals" ? context[name] === resolveValue(value)
        : operator === "StringLike" && matches(resolveValue(value), context[name] || ""))));
}

test("database identity can write only its encrypted prefix and read exact file-manifest versions", () => {
  const encryption = { "s3:x-amz-server-side-encryption": "aws:kms", "s3:x-amz-server-side-encryption-aws-kms-key-id": keyArn };
  assert(allowed("s3:PutObject", `${archive}/database/dumps/example`, encryption));
  assert(allowed("s3:GetObjectVersion", `${archive}/manifests/example.json`));
  for (const prefix of ["objects/", "manifests/", "other/"]) assert(!allowed("s3:PutObject", `${archive}/${prefix}example`, encryption));
  for (const action of ["s3:GetObject", "s3:ListBucket", "s3:ListBucketVersions", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutBucketPolicy"])
    assert(!allowed(action, `${archive}/database/dumps/example`, encryption));
  assert(!allowed("s3:GetObjectVersion", `${archive}/database/dumps/example`));
  assert(!allowed("s3:PutObject", `${archive}/database/dumps/example`, {}));
  assert(!allowed("s3:PutObject", `${archive}/database/dumps/example`, { ...encryption, "s3:x-amz-server-side-encryption-aws-kms-key-id": "wrong-key" }));
  assert(!allowed("s3:PutObject", "arn:aws:s3:::another-bucket/database/dumps/example", encryption));
});

test("KMS permissions cannot decrypt database exports or bypass the fixed S3 context", () => {
  const context = { "kms:ViaService": "s3.us-east-1.amazonaws.com", "kms:CallerAccount": "838445019912",
    "kms:EncryptionContext:aws:s3:arn": `${archive}/database/dumps/example` };
  assert(allowed("kms:GenerateDataKey", keyArn, context));
  assert(!allowed("kms:Decrypt", keyArn, context));
  const manifestContext = { ...context, "kms:EncryptionContext:aws:s3:arn": `${archive}/manifests/example.json` };
  assert(allowed("kms:Decrypt", keyArn, manifestContext));
  assert(!allowed("kms:GenerateDataKey", keyArn, manifestContext));
  for (const changed of [{ "kms:ViaService": "kms.us-east-1.amazonaws.com" }, { "kms:CallerAccount": "000000000000" },
    { "kms:EncryptionContext:aws:s3:arn": "arn:aws:s3:::another-bucket/database/dumps/example" }])
    assert(!allowed("kms:GenerateDataKey", keyArn, { ...context, ...changed }));
});

test("companion template adds only a bounded disabled writer identity", () => {
  assert.deepEqual(Object.keys(resources).sort(), ["DatabaseWriterBoundary", "DatabaseWriterProfile", "DatabaseWriterRole"]);
  assert.equal(template.Parameters.EnableDatabaseWriter.Default, "false");
  const role = resources.DatabaseWriterRole.Properties;
  assert.deepEqual(role.PermissionsBoundary, { Ref: "DatabaseWriterBoundary" });
  assert.deepEqual(role.ManagedPolicyArns, [{ Ref: "DatabaseWriterBoundary" }]);
  const trust = role.AssumeRolePolicyDocument.Statement[0];
  assert.equal(trust.Condition.StringEquals["aws:SourceAccount"], "838445019912");
  assert.equal(trust.Condition.StringEquals["aws:PrincipalTag/x509Subject/CN"], "applypack-production-database-backup-writer");
  assert.deepEqual(trust.Condition.ArnEquals["aws:SourceArn"], { Ref: "ProductionTrustAnchorArn" });
  assert.equal(resources.DatabaseWriterProfile.Properties.AcceptRoleSessionName, false);
  assert.deepEqual(resources.DatabaseWriterProfile.Properties.Enabled, { "Fn::If": ["DatabaseWriterEnabled", true, false] });
  assert.doesNotMatch(JSON.stringify(template), /AWS::EC2|AWS::ACMPCA|AWS::S3::Bucket|AWS::KMS::Key|DeleteObject|s3:\*|kms:\*/u);
});

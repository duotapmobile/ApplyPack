import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
const template = JSON.parse(fs.readFileSync(new URL("../infra/aws/protected-recovery/template.json", import.meta.url), "utf8"));
const resources = template.Resources;
const statements = (name) => resources[name].Properties.PolicyDocument.Statement;
const actions = (name) => statements(name).flatMap((statement) => [].concat(statement.Action));
test("recovery archive is separate, versioned, retained, private and requires exact encryption", () => {
  const bucket = resources.ArchiveBucket;
  assert.equal(bucket.Properties.BucketName, "applypack-production-protected-recovery-838445019912");
  assert.equal(bucket.DeletionPolicy, "Retain"); assert.equal(bucket.UpdateReplacePolicy, "Retain");
  assert.equal(bucket.Properties.VersioningConfiguration.Status, "Enabled");
  assert(Object.values(bucket.Properties.PublicAccessBlockConfiguration).every((value) => value === true));
  assert.equal(bucket.Properties.OwnershipControls.Rules[0].ObjectOwnership, "BucketOwnerEnforced");
  assert.equal(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].BucketKeyEnabled, false);
  assert.deepEqual(bucket.Properties.LifecycleConfiguration.Rules.map((value) => Object.keys(value).sort()), [["AbortIncompleteMultipartUpload", "Id", "Status"]]);
  const denies = resources.ArchiveBucketPolicy.Properties.PolicyDocument.Statement;
  assert.equal(denies.length, 3); assert(denies.every((value) => value.Effect === "Deny"));
  assert.equal(resources.ArchiveKey.DeletionPolicy, "Retain"); assert.equal(resources.ArchiveKey.Properties.EnableKeyRotation, true);
});
test("writer can append exact archives and read manifest metadata but cannot delete or read customer bytes", () => {
  assert.deepEqual(actions("WriterBoundary").sort(), ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket", "kms:GenerateDataKey", "kms:Decrypt"].sort());
  for (const statement of statements("WriterBoundary").filter((value) => value.Action.includes("s3:GetObject")))
    assert.deepEqual(statement.Resource, { "Fn::Sub": "${ArchiveBucket.Arn}/manifests/*" });
  const decrypt = statements("WriterBoundary").find((value) => value.Action.includes("kms:Decrypt"));
  assert.deepEqual(decrypt.Condition.StringLike["kms:EncryptionContext:aws:s3:arn"], { "Fn::Sub": "${ArchiveBucket.Arn}/manifests/*" });
  assert.equal(decrypt.Condition.StringEquals["kms:ViaService"], "s3.us-east-1.amazonaws.com");
});
test("retention identity only lists versions and deletes exact versions", () => {
  assert.deepEqual(actions("RetentionBoundary").sort(), ["s3:ListBucketVersions", "s3:DeleteObjectVersion"].sort());
  const list = statements("RetentionBoundary")[0];
  assert.deepEqual(list.Condition.StringLike["s3:prefix"], ["objects/*", "manifests/*"]);
  assert.equal(resources.RetentionRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals["aws:PrincipalTag/x509Subject/CN"], "applypack-production-recovery-retention");
  assert.equal(resources.RetentionProfile.Properties.AcceptRoleSessionName, false);
});
test("independent recovery requires explicit owner identity and fresh MFA, not writer credentials", () => {
  const trust = resources.RecoveryRole.Properties.AssumeRolePolicyDocument.Statement[0];
  assert.deepEqual(trust.Principal, { AWS: { Ref: "IndependentRecoveryPrincipalArn" } });
  assert.equal(trust.Condition.Bool["aws:MultiFactorAuthPresent"], "true");
  assert.equal(trust.Condition.NumericLessThanEquals["aws:MultiFactorAuthAge"], "900");
  assert.deepEqual(actions("RecoveryBoundary").sort(), ["s3:ListBucket", "s3:ListBucketVersions", "s3:GetBucketVersioning", "s3:GetEncryptionConfiguration", "s3:GetObject", "s3:GetObjectVersion", "kms:Decrypt"].sort());
});
test("all workload roles use distinct exact permissions boundaries and disabled profiles", () => {
  for (const name of ["Writer", "Recovery", "Retention"]) {
    assert.deepEqual(resources[`${name}Role`].Properties.PermissionsBoundary, { Ref: `${name}Boundary` });
    assert.deepEqual(resources[`${name}Role`].Properties.ManagedPolicyArns, [{ Ref: `${name}Boundary` }]);
    assert.equal(resources[`${name}Role`].Properties.Path, "/applypack/production/");
  }
  assert.equal(template.Parameters.EnableWriter.Default, "false"); assert.equal(template.Parameters.EnableRetention.Default, "false");
  assert.equal(resources.WriterRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals["aws:PrincipalTag/x509Subject/CN"], "applypack-production-recovery-writer");
  assert.equal(resources.WriterProfile.Properties.AcceptRoleSessionName, false);
});
test("archive template has no networking, paid CA, temporary worker bucket or broad data role", () => {
  assert.equal(Object.keys(resources).length, 12);
  assert(Object.values(resources).every((value) => ["AWS::KMS::Key", "AWS::KMS::Alias", "AWS::S3::Bucket", "AWS::S3::BucketPolicy",
    "AWS::IAM::ManagedPolicy", "AWS::IAM::Role", "AWS::RolesAnywhere::Profile"].includes(value.Type)));
  assert.doesNotMatch(JSON.stringify(template), /AWS::EC2|AWS::ACMPCA|document-worker-temp|service_role|supabase.*key/iu);
});

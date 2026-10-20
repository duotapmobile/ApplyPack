import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import yaml from "js-yaml";

const expectedOrigin = "https://github.com/duotapmobile/ApplyPack.git";
const templateRelativePath = "infra/aws/staging-foundation/template.yaml";
const ownedPaths = [
  ".github/workflows/ci.yml",
  "docs/runbooks/AWS_STAGING_FOUNDATION.md",
  templateRelativePath,
  "scripts/test-aws-staging-foundation-controls.ps1",
  "scripts/validate-aws-staging-foundation-template.mjs",
  "tests/unit/aws-staging-foundation-template.test.ts",
];

function fail(message) {
  throw new Error(`AWS staging foundation validation failed: ${message}`);
}
function assert(condition, message) {
  if (!condition) fail(message);
}

function rawArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1]) fail(`missing ${name} value`);
  return process.argv[index + 1];
}

const root = resolve(rawArgument("--repo", process.cwd()));

function argument(name, fallback) {
  return resolve(root, rawArgument(name, fallback));
}

function git(repo, args, options = {}) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: options.binary ? null : "utf8",
    input: options.input,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail(options.failure || "Git provenance command failed");
  return options.binary ? result.stdout : result.stdout.trim();
}

function gitStatus(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: "ignore",
  });
  if (result.error || ![0, 1].includes(result.status)) fail("Git cleanliness check failed");
  return result.status;
}

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function pathIsWithin(candidate, parent) {
  const relation = relative(resolve(parent), resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function hashGitBlob(repo, bytes) {
  return git(repo, ["hash-object", "--no-filters", "--stdin"], {
    input: bytes,
    failure: "Extracted template blob hash failed",
  });
}

function extractReviewedTemplate() {
  const approvedCommit = rawArgument("--approved-commit");
  const approvedTree = rawArgument("--approved-tree");
  const approvedBlob = rawArgument("--approved-blob");
  const outputValue = rawArgument("--output");
  for (const [label, value] of [["commit", approvedCommit], ["tree", approvedTree], ["blob", approvedBlob]]) {
    assert(/^[0-9a-f]{40}$/u.test(value || ""), `approved ${label} must be a full lowercase Git object ID`);
  }
  assert(outputValue && isAbsolute(outputValue), "reviewed template output must be an absolute path");

  const repoRoot = git(root, ["rev-parse", "--show-toplevel"], { failure: "Repository root is unavailable" });
  assert(samePath(repoRoot, root), "--repo must be the Git worktree root");
  assert(git(root, ["remote", "get-url", "origin"], { failure: "Repository origin is unavailable" }) === expectedOrigin,
    "repository origin is not the canonical ApplyPack remote");
  assert(git(root, ["rev-parse", "HEAD^{commit}"], { failure: "HEAD commit is unavailable" }) === approvedCommit,
    "current HEAD does not equal the approved commit");
  assert(git(root, ["rev-parse", `${approvedCommit}^{tree}`], { failure: "Approved tree is unavailable" }) === approvedTree,
    "approved tree does not match the approved commit");
  assert(git(root, ["rev-parse", `${approvedCommit}:${templateRelativePath}`], { failure: "Approved template blob is unavailable" }) === approvedBlob,
    "approved template blob does not match the approved commit");
  assert(git(root, ["cat-file", "-t", approvedBlob], { failure: "Approved template object is unavailable" }) === "blob",
    "approved template object is not a blob");
  assert(gitStatus(root, ["diff", "--quiet", "HEAD", "--", ...ownedPaths]) === 0,
    "a task-owned foundation file differs from approved HEAD");
  assert(gitStatus(root, ["diff", "--cached", "--quiet", "HEAD", "--", ...ownedPaths]) === 0,
    "a staged task-owned foundation change exists");

  const outputPath = resolve(outputValue);
  assert(!pathIsWithin(outputPath, root), "reviewed template output must be outside the repository");
  assert(!existsSync(outputPath), "reviewed template output already exists");
  const outputParent = dirname(outputPath);
  const parentInfo = lstatSync(outputParent);
  assert(parentInfo.isDirectory() && !parentInfo.isSymbolicLink(), "reviewed template output parent must be an ordinary directory");
  const realRepoRoot = realpathSync(root);
  const realOutputParent = realpathSync(outputParent);
  assert(samePath(outputParent, realOutputParent), "reviewed template output parent must not traverse a link or junction");
  assert(!pathIsWithin(realOutputParent, realRepoRoot), "reviewed template output parent resolves inside the repository");

  const blobBytes = git(root, ["cat-file", "blob", approvedBlob], {
    binary: true,
    failure: "Approved template blob extraction failed",
  });
  assert(Buffer.isBuffer(blobBytes) && blobBytes.length > 0, "approved template blob is empty");
  assert(hashGitBlob(root, blobBytes) === approvedBlob, "cat-file bytes do not match the approved blob");

  const temporaryPath = resolve(outputParent, `.${basename(outputPath)}.partial-${process.pid}-${randomUUID()}`);
  let descriptor;
  let published = false;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, blobBytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    assert(hashGitBlob(root, readFileSync(temporaryPath)) === approvedBlob,
      "temporary extracted file does not match the approved blob");
    renameSync(temporaryPath, outputPath);
    published = true;
    assert(hashGitBlob(root, readFileSync(outputPath)) === approvedBlob,
      "published extracted file does not match the approved blob");
    chmodSync(outputPath, 0o444);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    if (published && existsSync(outputPath)) {
      chmodSync(outputPath, 0o600);
      rmSync(outputPath, { force: true });
    }
    throw error;
  }
  console.log(`AWS_STAGING_FOUNDATION_REVIEWED_TEMPLATE_EXTRACTED=${approvedBlob}`);
}

if (process.argv.includes("--extract-reviewed-template")) {
  extractReviewedTemplate();
  process.exit(0);
}

const templatePath = argument("--template", "infra/aws/staging-foundation/template.yaml");
const runbookPath = argument("--runbook", "docs/runbooks/AWS_STAGING_FOUNDATION.md");
const controlSelfTestPath = argument("--control-self-test", "scripts/test-aws-staging-foundation-controls.ps1");
const ciPath = argument("--ci", ".github/workflows/ci.yml");
const foundationTestPath = argument("--foundation-test", "tests/unit/aws-staging-foundation-template.test.ts");
const intrinsic = (name, kind) => new yaml.Type(`!${name}`, {
  kind,
  construct: (value) => ({ [`Fn::${name}`]: value }),
});
const schema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type("!Ref", { kind: "scalar", construct: (value) => ({ Ref: value }) }),
  new yaml.Type("!GetAtt", { kind: "scalar", construct: (value) => ({ "Fn::GetAtt": value }) }),
  intrinsic("Sub", "scalar"),
  intrinsic("Equals", "sequence"),
  intrinsic("Join", "sequence"),
]);

const source = readFileSync(templatePath, "utf8");
const runbook = readFileSync(runbookPath, "utf8");
const controlSelfTest = readFileSync(controlSelfTestPath, "utf8");
const ci = readFileSync(ciPath, "utf8");
const foundationTest = readFileSync(foundationTestPath, "utf8");
const template = yaml.load(source, { schema, filename: templatePath });

function json(value) {
  return JSON.stringify(value);
}
function exactKeys(value, expected) {
  return json(Object.keys(value || {}).sort()) === json([...expected].sort());
}
function actions(statement) {
  return (Array.isArray(statement?.Action) ? statement.Action : [statement?.Action]).filter(Boolean).sort();
}
function exactActions(statement, expected) {
  return json(actions(statement)) === json([...expected].sort());
}
function ref(value) {
  return value?.Ref;
}
function sub(value) {
  return value?.["Fn::Sub"];
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function normalizedSha256(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}

assert(template?.AWSTemplateFormatVersion === "2010-09-09", "template version must be fixed");
assert(!template.Parameters || Object.keys(template.Parameters).length === 0, "foundation must not accept caller-controlled parameters");
const accountAssertion = template?.Rules?.AccountMustBeApprovedStaging?.Assertions?.[0];
const regionAssertion = template?.Rules?.RegionMustBeUsEast1?.Assertions?.[0];
assert(json(accountAssertion?.Assert?.["Fn::Equals"]) === json([{ Ref: "AWS::AccountId" }, "838445019912"]),
  "template must bind the approved staging account");
assert(json(regionAssertion?.Assert?.["Fn::Equals"]) === json([{ Ref: "AWS::Region" }, "us-east-1"]),
  "template must bind us-east-1");

const resources = template?.Resources || {};
assert(exactKeys(resources, [
  "StagingVpc",
  "PrivateSubnetA",
  "PrivateSubnetB",
  "PrivateRouteTableA",
  "PrivateRouteTableB",
  "PrivateSubnetRouteTableAssociationA",
  "PrivateSubnetRouteTableAssociationB",
  "StagingSensitivePayloadKey",
  "StagingSensitivePayloadAlias",
]), "foundation must contain only the reviewed nine resources");

const allowedTypes = new Set([
  "AWS::EC2::VPC",
  "AWS::EC2::Subnet",
  "AWS::EC2::RouteTable",
  "AWS::EC2::SubnetRouteTableAssociation",
  "AWS::KMS::Key",
  "AWS::KMS::Alias",
]);
assert(Object.values(resources).every((resource) => allowedTypes.has(resource?.Type)),
  "foundation contains an unapproved resource type");
assert(!Object.values(resources).some((resource) => [
  "AWS::EC2::Route",
  "AWS::EC2::InternetGateway",
  "AWS::EC2::NatGateway",
  "AWS::EC2::EIP",
  "AWS::EC2::VPCEndpoint",
  "AWS::EC2::Instance",
  "AWS::RDS::DBInstance",
  "AWS::IAM::Role",
  "AWS::IAM::ManagedPolicy",
  "AWS::Budgets::Budget",
].includes(resource?.Type)), "foundation must not create routes, gateways, endpoints, compute, databases, IAM, EIPs, or budgets");

const expectedTags = [
  { Key: "Application", Value: "ApplyPack" },
  { Key: "Environment", Value: "staging" },
  { Key: "ManagedBy", Value: "CloudFormation" },
];
for (const name of ["StagingVpc", "PrivateSubnetA", "PrivateSubnetB", "PrivateRouteTableA", "PrivateRouteTableB", "StagingSensitivePayloadKey"]) {
  assert(json(resources[name]?.Properties?.Tags) === json(expectedTags), `${name} must have the exact required tags`);
}

const vpc = resources.StagingVpc?.Properties || {};
assert(vpc.CidrBlock === "10.84.0.0/16" && vpc.EnableDnsHostnames === true && vpc.EnableDnsSupport === true
  && vpc.InstanceTenancy === "default", "VPC controls must be exact");
const subnetA = resources.PrivateSubnetA?.Properties || {};
const subnetB = resources.PrivateSubnetB?.Properties || {};
assert(subnetA.CidrBlock === "10.84.0.0/24" && subnetB.CidrBlock === "10.84.1.0/24",
  "private subnet CIDRs must be exact and non-overlapping");
assert(subnetA.MapPublicIpOnLaunch === false && subnetB.MapPublicIpOnLaunch === false,
  "private subnets must disable public IPv4 assignment");
assert(ref(subnetA.VpcId) === "StagingVpc" && ref(subnetB.VpcId) === "StagingVpc",
  "private subnets must belong to the staging VPC");
assert(json(subnetA.AvailabilityZone?.["Fn::Select"]) === json([0, { "Fn::GetAZs": "" }])
  && json(subnetB.AvailabilityZone?.["Fn::Select"]) === json([1, { "Fn::GetAZs": "" }]),
"private subnets must select two distinct regional availability zones");

for (const name of ["PrivateRouteTableA", "PrivateRouteTableB"]) {
  assert(ref(resources[name]?.Properties?.VpcId) === "StagingVpc", `${name} must belong to the staging VPC`);
}
assert(ref(resources.PrivateSubnetRouteTableAssociationA?.Properties?.RouteTableId) === "PrivateRouteTableA"
  && ref(resources.PrivateSubnetRouteTableAssociationA?.Properties?.SubnetId) === "PrivateSubnetA",
"first subnet association must be exact");
assert(ref(resources.PrivateSubnetRouteTableAssociationB?.Properties?.RouteTableId) === "PrivateRouteTableB"
  && ref(resources.PrivateSubnetRouteTableAssociationB?.Properties?.SubnetId) === "PrivateSubnetB",
"second subnet association must be exact");

const keyResource = resources.StagingSensitivePayloadKey || {};
const key = keyResource.Properties || {};
assert(keyResource.DeletionPolicy === "RetainExceptOnCreate" && keyResource.UpdateReplacePolicy === "Retain",
  "KMS key must roll back on failed initial create and survive later replacement or stack deletion");
assert(key.Enabled === true && key.EnableKeyRotation === true && key.KeySpec === "SYMMETRIC_DEFAULT"
  && key.KeyUsage === "ENCRYPT_DECRYPT" && key.MultiRegion === false && key.Origin === "AWS_KMS"
  && key.PendingWindowInDays === 30, "KMS lifecycle and cryptographic controls must be exact");
const statements = key.KeyPolicy?.Statement || [];
assert(statements.length === 3 && statements.every((statement) => statement.Effect === "Allow"),
  "KMS policy must contain only the three reviewed allow statements");
const expectedPrincipal = "arn:${AWS::Partition}:iam::${AWS::AccountId}:root";
assert(statements.every((statement) => sub(statement.Principal?.AWS) === expectedPrincipal),
  "KMS delegation must remain inside the current account");
assert(statements.every((statement) => !actions(statement).some((action) => action === "*" || action.endsWith(":*"))),
  "KMS policy must not contain wildcard actions");
const administration = statements.find((statement) => statement.Sid === "DelegateKeyAdministrationWithinAccount");
assert(exactActions(administration, [
  "kms:CancelKeyDeletion", "kms:CreateAlias", "kms:DeleteAlias", "kms:DescribeKey", "kms:DisableKey",
  "kms:DisableKeyRotation", "kms:EnableKey", "kms:EnableKeyRotation", "kms:GetKeyPolicy",
  "kms:GetKeyRotationStatus", "kms:ListResourceTags", "kms:PutKeyPolicy", "kms:ScheduleKeyDeletion",
  "kms:TagResource", "kms:UntagResource", "kms:UpdateAlias", "kms:UpdateKeyDescription",
]), "KMS delegated administration action set must be exact");
const use = statements.find((statement) => statement.Sid === "DelegateStagingPayloadUseWithinAccount");
assert(exactActions(use, ["kms:Decrypt", "kms:Encrypt"])
  && use.Condition?.StringEquals?.["kms:EncryptionContext:application"] === "ApplyPack"
  && use.Condition?.StringEquals?.["kms:EncryptionContext:deployment"] === "staging",
"KMS payload use must require the ApplyPack staging encryption context");
const describe = statements.find((statement) => statement.Sid === "DelegateKeyDescriptionWithinAccount");
assert(exactActions(describe, ["kms:DescribeKey"]), "KMS description delegation must remain read-only");
assert(statements.every((statement) => statement.Resource === "*"),
  "KMS key-policy statements must use the required key-policy resource form");
assert(resources.StagingSensitivePayloadAlias?.Properties?.AliasName === "alias/applypack-staging-sensitive-payloads"
  && ref(resources.StagingSensitivePayloadAlias?.Properties?.TargetKeyId) === "StagingSensitivePayloadKey",
"KMS alias must bind the exact staging key");

const outputs = template?.Outputs || {};
assert(exactKeys(outputs, [
  "AwsRegion", "DeploymentEnvironment", "VpcId", "PrivateSubnetAId", "PrivateSubnetBId", "PrivateSubnetIds",
  "PrivateRouteTableAId", "PrivateRouteTableBId", "PrivateRouteTableIds", "KmsKeyArn", "KmsKeyId", "KmsAliasName",
]), "foundation outputs must be the exact worker-input set");
assert(ref(outputs.VpcId?.Value) === "StagingVpc" && ref(outputs.KmsKeyId?.Value) === "StagingSensitivePayloadKey"
  && outputs.KmsKeyArn?.Value?.["Fn::GetAtt"] === "StagingSensitivePayloadKey.Arn",
"foundation identity outputs must bind exact resources");
assert(json(outputs.PrivateSubnetIds?.Value?.["Fn::Join"]) === json([",", [{ Ref: "PrivateSubnetA" }, { Ref: "PrivateSubnetB" }]])
  && json(outputs.PrivateRouteTableIds?.Value?.["Fn::Join"]) === json([",", [{ Ref: "PrivateRouteTableA" }, { Ref: "PrivateRouteTableB" }]]),
"worker list outputs must preserve deterministic ordering");

for (const required of [
  "applypack-staging-foundation",
  "--enable-termination-protection",
  "applypack-staging-operator",
  "cloudformation validate-template",
  "MapPublicIpOnLaunch",
  "describe-internet-gateways",
  "describe-nat-gateways",
  "describe-route-tables",
  "get-key-rotation-status",
  "approximately $1/month",
  "evidence only",
  "RetainExceptOnCreate",
  "PendingDeletion",
  "list-aliases",
  "list-keys",
  "list-stacks",
  "diff --quiet HEAD -- $apOwnedPaths",
  "diff --cached --quiet HEAD -- $apOwnedPaths",
  "remote get-url origin",
  "rev-parse 'HEAD^{commit}'",
  "rev-parse \"$apApprovedSha^{tree}\"",
  "rev-parse \"${apApprovedSha}:infra/aws/staging-foundation/template.yaml\"",
  "--extract-reviewed-template",
  "--approved-commit $apApprovedSha",
  "--approved-tree $apApprovedTree",
  "--approved-blob $apApprovedTemplateBlob",
  "AWS_STAGING_FOUNDATION_REVIEWED_TEMPLATE_EXTRACTED=",
  "hash-object --no-filters $apReviewedTemplatePath",
  "--template $apReviewedTemplatePath",
  "--template-body $apReviewedTemplateUri",
  "cloudformation get-template",
  "reviewedTemplateBodySha256",
  "providerNormalizedTemplateSha256",
  "$apProviderTemplateBodySha256 -ne $apReviewedTemplateBodySha256",
  "'cloudformation', 'create-change-set'",
  "$apCreateChangeSetArguments = Get-GovernedFoundationCreateChangeSetArguments",
  "& $apAws @apCreateChangeSetArguments",
  "changeSetType = 'CREATE'",
  "apiAction = 'CreateChangeSet'",
  "profile = $apProfile",
  "region = $apRegion",
  "expectedAccount = $apExpectedAccount",
  "expectedArn = $apExpectedArn",
  "reviewedTemplatePath = $apReviewedTemplatePath",
  "templateUri = $apReviewedTemplateUri",
  "clientToken = \"applypack-foundation-$($apApprovedSha.Substring(0, 32))\"",
  "onStackFailure = 'ROLLBACK'",
  "includeNestedStacks = $false",
  "importExistingResources = $false",
  "resourcesToImport = @()",
  "deploymentMode = $null",
  "deploymentConfig = $null",
  "Key=Application,Value=ApplyPack",
  "Key=Environment,Value=staging",
  "Key=ManagedBy,Value=CloudFormation",
  "'--stack-name', $apGovernedCreateRequest.stackName",
  "'--change-set-name', $apGovernedCreateRequest.changeSetName",
  "'--change-set-type', $apGovernedCreateRequest.changeSetType",
  "'--template-body', $apGovernedCreateRequest.templateUri",
  "'--no-include-nested-stacks', '--no-import-existing-resources'",
  "aws-staging-foundation-create-request.json",
  "$apGovernedCreateRequestSha256",
  "$apCurrentCreateRequestSha256 -ne $apGovernedCreateRequestSha256",
  "Assert-GovernedFoundationCreateRequest",
  "Confirm-GovernedFoundationIdentityAndTemplate",
  "sts get-caller-identity --profile $apGovernedCreateRequest.profile",
  "$apFreshBodySha256 -ne $apGovernedCreateRequest.reviewedTemplateBodySha256",
  "change-set-create-complete",
  "cloudformation describe-change-set",
  "$apCreateChangeSet.StackId",
  "$ChangeSet.ChangeSetId -ne $apChangeSetId",
  "$ChangeSet.StackId -ne $apStackId",
  "$ChangeSet.Description -ne $apGovernedCreateRequest.description",
  "$ChangeSet.OnStackFailure -ne $apGovernedCreateRequest.onStackFailure",
  "$ChangeSet.Status -ne 'CREATE_COMPLETE'",
  "$ChangeSet.ExecutionStatus -ne 'AVAILABLE'",
  "$ChangeSet.Changes.Count -ne 9",
  "Compare-Object -ReferenceObject $apExpectedLogicalIds -DifferenceObject $apActualLogicalIds",
  "$apResource.Action -ne 'Add'",
  "$apResource.Replacement",
  "@($ChangeSet.Capabilities).Count -ne 0",
  "$apImportExistingResources -eq $true",
  "$apParentChangeSetId = Get-OptionalProviderPropertyValue",
  "$null -ne $apParentChangeSetId",
  "$null -ne $apRootChangeSetId",
  "$null -ne $apDeploymentMode",
  "$null -ne $apDeploymentConfig",
  "Compare-Object -ReferenceObject $apExpectedTags -DifferenceObject $apProviderTags",
  "Get-FoundationProviderTemplateReceipt",
  "--change-set-name $ChangeSetId --template-stage Original",
  "$_.Type -ne 'Resource'",
  "changeSetId = $apChangeSetId",
  "stackId = $apStackId",
  "terminationProtectionEnabled = $TerminationProtectionEnabled",
  "parameters = @($ChangeSet.Parameters)",
  "includeNestedStacks = $apIncludeNestedStacks",
  "importExistingResources = $apImportExistingResources",
  "deploymentConfig = $null",
  "tags = $apProviderTags",
  "aws-staging-foundation-change-set-receipt.json",
  "$apSupervisorOneApprovedChangeSetReceiptSha256",
  "$apSupervisorTwoApprovedChangeSetReceiptSha256",
  "$apExecuteReceiptJson -cne $apChangeSetReceiptJson",
  "$apStoredReceiptJson -cne $apExecuteReceiptJson",
  "$apExecuteReceiptSha256",
  "REVIEW_IN_PROGRESS",
  "cloudformation list-stack-resources",
  "cloudformation delete-change-set",
  "Assert-NoRemainingFoundationChangeSets",
  "@($apInitialChangeSets).Count -ne 1",
  "--no-enable-termination-protection",
  "cloudformation delete-stack",
  "stack-delete-complete",
  "cloudformation execute-change-set",
  "update-termination-protection",
  "$apCreatedStack.EnableTerminationProtection -ne $true",
  "scripts/test-aws-staging-foundation-controls.ps1",
  "arn:aws:cloudformation:us-east-1:838445019912:changeSet/applypack-staging-foundation-create-8754e1ec334c/89fd9205-daca-4779-a235-1c8d06092ae8",
  "arn:aws:cloudformation:us-east-1:838445019912:stack/applypack-staging-foundation/56601160-cc81-11f1-8a7c-12ffddd7e50d",
  "iam list-mfa-devices",
  "iam list-access-keys",
  "configure list --profile $Profile",
  "configure get login_session --profile $Profile",
  "configure get region --profile $Profile",
  "Resolved AWS credential type is not exactly login.",
  "Assert-FoundationBrowserLoginCredentialPosture",
  "Get-ExactFoundationBrowserLoginCredentialPosture",
  "AWS_IGNORE_CONFIGURED_ENDPOINT_URLS",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  "AWS_ENDPOINT_URL_CLOUDFORMATION",
  "AWS_ENDPOINT_URL_IAM",
  "AWS_ENDPOINT_URL_STS",
  "AWS_CA_BUNDLE",
  "AWS_DATA_PATH",
  "credential_process",
  "source_profile",
  "credential_source",
  "web_identity_token_file",
  "sso_session",
  "sso_start_url",
  "sso_account_id",
  "sso_role_name",
  "endpoint_url','services','ca_bundle",
  "credentialSource=$apLegacyCredentialPosture.credentialSource",
  "resolvedCredentialType=$apLegacyCredentialPosture.resolvedCredentialType",
  "forbiddenProfileMechanismCount=$apLegacyCredentialPosture.forbiddenProfileMechanismCount",
  "processCredentialOverrideCount=$apLegacyCredentialPosture.processCredentialOverrideCount",
  "configuredEndpointsIgnored=$apLegacyCredentialPosture.configuredEndpointsIgnored",
  "accessKeyInventory=$apLegacyAccessKeyInventoryStatus",
  "@($apLegacyMfa).Count -ne 1",
  "Remove-ExactLegacyFoundationPlaceholder",
  "$apLegacySupervisorOneApprovedReceiptSha256",
  "$apLegacySupervisorTwoApprovedReceiptSha256",
  "$apLegacyStack.EnableTerminationProtection -ne $false",
  "@($apLegacySummaries).Count -ne 1",
]) assert(runbook.includes(required), `runbook is missing required control: ${required}`);
assert(controlSelfTest.includes("AWS_STAGING_FOUNDATION_CONTROLS_OK")
  && controlSelfTest.includes("Assert-Throws -Label 'request tag tamper'")
  && controlSelfTest.includes("Assert-Throws -Label 'fresh template raw hash divergence'")
  && controlSelfTest.includes("Assert-Throws -Label 'provider tag divergence'")
  && controlSelfTest.includes("Assert-Throws -Label 'non-Add provider plan'")
  && controlSelfTest.includes("Assert-Throws -Label 'non-null deployment configuration'")
  && controlSelfTest.includes("Assert-Throws -Label 'wrong browser login_session identity'")
  && controlSelfTest.includes("Assert-Throws -Label 'resolved credential TYPE non-login'")
  && controlSelfTest.includes("Assert-Throws -Label 'alternate profile credential mechanism'")
  && controlSelfTest.includes("Assert-Throws -Label 'process credential override'")
  && controlSelfTest.includes("Label='mock normal cleanup foreign ID'")
  && controlSelfTest.includes("Label='mock normal cleanup zero after'")
  && controlSelfTest.includes("Label='mock normal cleanup provider template mismatch'")
  && controlSelfTest.includes("Label='mock legacy cleanup foreign ID'")
  && controlSelfTest.includes("Label='mock legacy cleanup exactly one before'")
  && controlSelfTest.includes("Label='mock legacy cleanup populated stack'")
  && controlSelfTest.includes("Label='mock legacy cleanup executed plan'")
  && controlSelfTest.includes("Label='mock legacy cleanup unavailable plan'")
  && controlSelfTest.includes("Label='mock legacy cleanup credential TYPE non-login'")
  && controlSelfTest.includes("Label='mock legacy cleanup alternate profile source'")
  && controlSelfTest.includes("Label='mock legacy cleanup MFA count'")
  && controlSelfTest.includes("Label='mock legacy cleanup provider template mismatch'")
  && controlSelfTest.includes("-Scenario access-key-denied")
  && controlSelfTest.includes("accessKeyInventory -ne 'not-authorized'")
  && controlSelfTest.includes("Assert-Throws -Label 'mock legacy cleanup zero after'")
  && controlSelfTest.includes("Assert-Throws -Label 'remaining change set before placeholder deletion'"),
"PowerShell control self-test must execute every required fail-closed negative case");
assert(ci.includes("Run AWS staging foundation control self-test")
  && ci.includes(".\\scripts\\test-aws-staging-foundation-controls.ps1"),
"Windows CI must execute the AWS foundation PowerShell control self-test");
assert(runbook.includes("No command in this runbook targets production"), "runbook must state the production boundary");
assert(!/cloudformation\s+(?:create-stack|deploy)\b/.test(runbook),
  "runbook must not contain a direct create-stack or deploy command");
assert(!/--capabilities\b/.test(runbook), "foundation change set must not request IAM capabilities");
assert(!/--no-verify-ssl\b/.test(runbook), "foundation provider commands must not disable TLS verification");
assert(!/\$[A-Za-z][A-Za-z0-9]*\.ChangeSetType\b/.test(runbook),
  "runbook must not trust a ChangeSetType field that DescribeChangeSet does not return");
assert(!/git\s+show\b[^\r\n]*--output/u.test(runbook),
  "runbook must not use git show --output for reviewed template extraction");
assert(foundationTest.includes("}, 240_000);") && foundationTest.includes("}, 300_000);"),
  "real extraction and mutation tests must retain measured Windows-safe internal timeouts");

const changeSetCreateIndex = runbook.indexOf("$apCreateChangeSet = (& $apAws @apCreateChangeSetArguments");
const changeSetDescribeIndex = runbook.indexOf("cloudformation describe-change-set", changeSetCreateIndex);
const terminationProtectionIndex = runbook.indexOf("--enable-termination-protection", changeSetDescribeIndex);
const initialReceiptIndex = runbook.indexOf("$apChangeSetReceipt =", terminationProtectionIndex);
const approvalIndex = runbook.indexOf("$apSupervisorOneApprovedChangeSetReceiptSha256", initialReceiptIndex);
const executeDescribeIndex = runbook.indexOf("$apExecuteState =", approvalIndex);
const executeReceiptIndex = runbook.indexOf("$apExecuteReceipt =", executeDescribeIndex);
const changeSetExecuteIndex = runbook.indexOf("cloudformation execute-change-set", executeReceiptIndex);
const finalProtectionIndex = runbook.indexOf("$apCreatedStack.EnableTerminationProtection -ne $true", changeSetExecuteIndex);
const providerReceiptIndex = runbook.indexOf("cloudformation get-template", finalProtectionIndex);
assert(changeSetCreateIndex >= 0 && changeSetDescribeIndex > changeSetCreateIndex
  && terminationProtectionIndex > changeSetDescribeIndex && initialReceiptIndex > terminationProtectionIndex
  && approvalIndex > initialReceiptIndex && executeDescribeIndex > approvalIndex
  && executeReceiptIndex > executeDescribeIndex && changeSetExecuteIndex > executeReceiptIndex
  && finalProtectionIndex > changeSetExecuteIndex && providerReceiptIndex > finalProtectionIndex,
"runbook must review the CREATE change set, protect its empty stack, bind approvals to a fresh receipt, execute its exact ID, and verify the provider template");
assert(runbook.includes("'--template-body', $apGovernedCreateRequest.templateUri"),
  "change set must use only the immutable URI in the governed request");
assert(runbook.includes("--change-set-name $apChangeSetId"),
  "change-set describe, delete, and execution steps must remain bound to the exact returned ID");

if (process.argv.includes("--print-template-sha256")) {
  console.log(`AWS_STAGING_FOUNDATION_TEMPLATE_SHA256=${normalizedSha256(template)}`);
} else {
  console.log("AWS_STAGING_FOUNDATION_TEMPLATE_OK");
}

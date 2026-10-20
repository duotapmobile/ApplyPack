import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

const root = process.cwd();

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return resolve(root, fallback);
  if (!process.argv[index + 1]) throw new Error(`missing ${name} value`);
  return resolve(process.argv[index + 1]);
}

const templatePath = argument("--template", "infra/aws/staging-foundation/template.yaml");
const runbookPath = argument("--runbook", "docs/runbooks/AWS_STAGING_FOUNDATION.md");
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
const template = yaml.load(source, { schema, filename: templatePath });

function fail(message) {
  throw new Error(`AWS staging foundation validation failed: ${message}`);
}
function assert(condition, message) {
  if (!condition) fail(message);
}
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
assert(keyResource.DeletionPolicy === "Retain" && keyResource.UpdateReplacePolicy === "Retain",
  "KMS key must survive stack deletion and replacement");
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
]) assert(runbook.includes(required), `runbook is missing required control: ${required}`);
assert(runbook.includes("No command in this runbook targets production"), "runbook must state the production boundary");

console.log("AWS_STAGING_FOUNDATION_TEMPLATE_OK");

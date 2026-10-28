import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FOUNDATION, RESOURCE_TYPES, sha256, canonicalSha256, validateTemplate,
  validateApproval, validateIdentity, validateInventory, buildCreateRequest, validatePlan,
} from "./lib/production-aws-foundation.mjs";
import { parseArguments } from "./production-aws-foundation.mjs";

const template = JSON.parse(readFileSync(new URL("../infra/aws/production-foundation/template.json", import.meta.url), "utf8"));
const now = Date.parse("2026-10-23T20:00:00.000Z");
const quoteBytes = Buffer.from("TEST ONLY: itemized production foundation quote and recovery allowance.\n", "utf8");
const quoteSha256 = sha256(quoteBytes);
const copy = (value) => structuredClone(value);
const manifestFixture = () => ({
  schemaVersion: "applypack-production-foundation-approval-v1", environment: "production",
  accountId: "838445019912", region: "us-east-1", profile: "test-production",
  operatorArn: "arn:aws:iam::838445019912:user/test-production-operator",
  stackName: "applypack-production-foundation", releaseSha: "a".repeat(40),
  templateSha256: FOUNDATION.templateSha256, quoteSha256,
  quoteApproval: { approvedBy: "Owner fixture", approvedAt: "2026-10-23T19:00:00.000Z", approvalReference: "test-only-reviewed-quote" },
});
const approval = (manifest, overrides = {}) => validateApproval({ manifest, manifestSha256: canonicalSha256(manifest), quoteBytes, quoteSha256, now, ...overrides });
const identityFixture = (manifest) => ({ Account: "838445019912", Arn: manifest.operatorArn });
function inventoryFixture(manifest) {
  return {
    identity: identityFixture(manifest),
    stacks: [{ StackName: "applypack-staging-foundation", StackId: "arn:aws:cloudformation:us-east-1:838445019912:stack/applypack-staging-foundation/11111111-1111-4111-8111-111111111111", StackStatus: "CREATE_COMPLETE" }],
    aliases: [{ AliasName: "alias/applypack-staging-sensitive-payloads", TargetKeyId: "11111111-1111-4111-8111-111111111111" }],
    vpcs: [{ VpcId: "vpc-00000000000000001", CidrBlock: "10.84.0.0/16", CidrBlockAssociationSet: [{ CidrBlock: "10.84.0.0/16", CidrBlockState: { State: "associated" } }] }],
    routeTables: [{ RouteTableId: "rtb-00000000000000001", VpcId: "vpc-00000000000000001", Routes: [{ DestinationCidrBlock: "10.84.0.0/16", GatewayId: "local", State: "active" }] }],
  };
}
function planFixture(manifest = manifestFixture()) {
  const request = buildCreateRequest(manifest, template);
  const changeSetId = `arn:aws:cloudformation:us-east-1:838445019912:changeSet/${request.ChangeSetName}/11111111-1111-4111-8111-111111111111`;
  const stackId = "arn:aws:cloudformation:us-east-1:838445019912:stack/applypack-production-foundation/22222222-2222-4222-8222-222222222222";
  return {
    manifest, request, providerTemplate: copy(template),
    plan: {
      ChangeSetId: changeSetId, StackId: stackId, ChangeSetType: "CREATE",
      StackName: request.StackName, ChangeSetName: request.ChangeSetName, Description: request.Description,
      OnStackFailure: "ROLLBACK", Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE",
      Capabilities: [], Parameters: [], ResourcesToImport: [], IncludeNestedStacks: false, ImportExistingResources: false,
      Tags: copy(request.Tags),
      Changes: Object.entries(RESOURCE_TYPES).map(([LogicalResourceId, ResourceType]) => ({ Type: "Resource", ResourceChange: { LogicalResourceId, ResourceType, Action: "Add", Replacement: null, Scope: [] } })),
    },
    stack: { StackId: stackId, StackName: request.StackName, StackStatus: "REVIEW_IN_PROGRESS", EnableTerminationProtection: true },
    stackResources: [], changeSets: [{ ChangeSetId: changeSetId }],
  };
}

// Independent semantic assertions ensure a newly pinned template still obeys
// the approved environment, isolation, encryption and excluded-cost boundaries.
test("production template contains only an isolated production network and retained encryption key", () => {
  assert.equal(validateTemplate(template), template);
  assert.equal(canonicalSha256(template), FOUNDATION.templateSha256);
  assert.deepEqual(Object.keys(template.Resources).sort(), Object.keys(RESOURCE_TYPES).sort());
  assert.deepEqual(template.Rules.AccountMustBeApprovedProduction.Assertions[0].Assert["Fn::Equals"], [{ Ref: "AWS::AccountId" }, "838445019912"]);
  assert.deepEqual(template.Rules.RegionMustBeUsEast1.Assertions[0].Assert["Fn::Equals"], [{ Ref: "AWS::Region" }, "us-east-1"]);
  assert.equal(template.Parameters, undefined);
  assert.equal(template.Resources.ProductionVpc.Properties.CidrBlock, "10.85.0.0/16");
  for (const name of ["PrivateSubnetA", "PrivateSubnetB"]) {
    assert.equal(template.Resources[name].Properties.MapPublicIpOnLaunch, false);
    assert.deepEqual(template.Resources[name].Properties.VpcId, { Ref: "ProductionVpc" });
  }
  for (const resource of Object.values(template.Resources)) {
    assert.equal(/NatGateway|InternetGateway|AWS::EC2::Route$|AWS::ACMPCA|AWS::IAM/u.test(resource.Type), false);
    if (resource.Properties.Tags) assert.equal(resource.Properties.Tags.find((tag) => tag.Key === "Environment")?.Value, "production");
  }
  const key = template.Resources.ProductionSensitivePayloadKey;
  assert.equal(key.DeletionPolicy, "RetainExceptOnCreate");
  assert.equal(key.UpdateReplacePolicy, "Retain");
  assert.equal(key.Properties.EnableKeyRotation, true);
  assert.equal(key.Properties.MultiRegion, false);
  assert.equal(key.Properties.PendingWindowInDays, 30);
  const statements = key.Properties.KeyPolicy.Statement;
  assert.equal(statements.length, 3);
  for (const statement of statements) {
    assert.deepEqual(statement.Principal, { AWS: { "Fn::Sub": "arn:${AWS::Partition}:iam::${AWS::AccountId}:root" } });
    assert.equal([statement.Action].flat().some((action) => action === "kms:*" || action === "*"), false);
  }
  const use = statements.find((statement) => statement.Sid === "DelegateProductionPayloadUseWithinAccount");
  assert.deepEqual(use.Action, ["kms:Decrypt", "kms:Encrypt"]);
  assert.deepEqual(use.Condition.StringEquals, { "kms:EncryptionContext:application": "ApplyPack", "kms:EncryptionContext:deployment": "production" });
  assert.equal(template.Resources.ProductionSensitivePayloadAlias.Properties.AliasName, "alias/applypack-production-sensitive-payloads");
  assert.equal(template.Outputs.DeploymentEnvironment.Value, "production");
});

for (const [name, mutate] of [
  ["extra NAT resource", (t) => { t.Resources.Nat = { Type: "AWS::EC2::NatGateway" }; }],
  ["extra paid CA resource", (t) => { t.Resources.Ca = { Type: "AWS::ACMPCA::CertificateAuthority" }; }],
  ["caller parameters", (t) => { t.Parameters = { Network: { Type: "String" } }; }],
  ["public subnet", (t) => { t.Resources.PrivateSubnetA.Properties.MapPublicIpOnLaunch = true; }],
  ["staging alias", (t) => { t.Resources.ProductionSensitivePayloadAlias.Properties.AliasName = "alias/applypack-staging-sensitive-payloads"; }],
  ["staging key context", (t) => { t.Resources.ProductionSensitivePayloadKey.Properties.KeyPolicy.Statement[1].Condition.StringEquals["kms:EncryptionContext:deployment"] = "staging"; }],
  ["broad key grant", (t) => { t.Resources.ProductionSensitivePayloadKey.Properties.KeyPolicy.Statement[1].Action = "kms:*"; }],
  ["lost retention", (t) => { t.Resources.ProductionSensitivePayloadKey.UpdateReplacePolicy = "Delete"; }],
  ["unknown property", (t) => { t.Resources.ProductionVpc.Properties.Unknown = true; }],
]) {
  test(`rejects template drift: ${name}`, () => { const changed = copy(template); mutate(changed); assert.throws(() => validateTemplate(changed), /TEMPLATE_INVALID/u); });
}

test("approval binds exact quote bytes and manifest with the current 24-hour review contract", () => {
  const manifest = manifestFixture();
  assert.equal(approval(manifest), manifest);
  manifest.quoteApproval.approvedAt = "2026-10-22T20:00:00.000Z";
  assert.equal(approval(manifest), manifest);
  manifest.quoteApproval.approvedAt = "2026-10-22T19:59:59.999Z";
  assert.throws(() => approval(manifest), /QUOTE_APPROVAL_INVALID/u);
  assert.equal(canonicalSha256({ b: 1, a: 2 }), canonicalSha256({ a: 2, b: 1 }));
});
for (const [name, mutate] of [
  ["extra field", (m) => { m.approved = true; }], ["missing approval", (m) => { delete m.quoteApproval; }],
  ["wrong schema", (m) => { m.schemaVersion = "v1"; }], ["staging environment", (m) => { m.environment = "staging"; }],
  ["wrong account", (m) => { m.accountId = "111111111111"; }], ["wrong region", (m) => { m.region = "us-west-2"; }],
  ["staging stack", (m) => { m.stackName = "applypack-staging-foundation"; }], ["wrong template digest", (m) => { m.templateSha256 = "b".repeat(64); }],
  ["empty profile", (m) => { m.profile = ""; }], ["argument profile", (m) => { m.profile = "--endpoint-url=foreign"; }],
  ["root principal", (m) => { m.operatorArn = "arn:aws:iam::838445019912:root"; }],
  ["foreign principal", (m) => { m.operatorArn = "arn:aws:iam::111111111111:user/test"; }],
  ["unapproved assumed role", (m) => { m.operatorArn = "arn:aws:sts::838445019912:assumed-role/Admin/test"; }],
  ["branch release", (m) => { m.releaseSha = "main"; }], ["uppercase release", (m) => { m.releaseSha = "A".repeat(40); }],
  ["wrong quote digest", (m) => { m.quoteSha256 = "b".repeat(64); }],
  ["missing approver", (m) => { m.quoteApproval.approvedBy = " "; }], ["missing approval reference", (m) => { m.quoteApproval.approvalReference = ""; }],
  ["future approval", (m) => { m.quoteApproval.approvedAt = "2026-10-23T20:00:00.001Z"; }],
  ["invalid approval date", (m) => { m.quoteApproval.approvedAt = "not-a-date"; }], ["extra approval field", (m) => { m.quoteApproval.bypass = true; }],
]) {
  test(`rejects approval: ${name}`, () => { const manifest = manifestFixture(); mutate(manifest); assert.throws(() => approval(manifest), /PRODUCTION_FOUNDATION_/u); });
}
for (const [name, overrides] of [
  ["manifest digest", { manifestSha256: "b".repeat(64) }], ["quote digest", { quoteSha256: "b".repeat(64) }],
  ["changed quote bytes", { quoteBytes: Buffer.from("different quote") }], ["empty quote", { quoteBytes: Buffer.alloc(0) }], ["invalid clock", { now: NaN }],
]) test(`rejects external binding drift: ${name}`, () => assert.throws(() => approval(manifestFixture(), overrides), /PRODUCTION_FOUNDATION_/u));

test("inventory accepts existing disjoint staging resources without granting production identity", () => {
  const manifest = manifestFixture();
  validateInventory(inventoryFixture(manifest), manifest);
  assert.throws(() => validateIdentity({ Account: FOUNDATION.accountId, Arn: "arn:aws:iam::838445019912:user/applypack-staging-operator" }, manifest), /IDENTITY_INVALID/u);
});
for (const field of ["stacks", "aliases", "vpcs", "routeTables"]) {
  for (const value of [null, {}, "unknown"]) test(`rejects unverified ${field} collection ${JSON.stringify(value)}`, () => {
    const manifest = manifestFixture(); const inventory = inventoryFixture(manifest); inventory[field] = value;
    assert.throws(() => validateInventory(inventory, manifest), /INVENTORY_UNVERIFIED/u);
  });
}
for (const [name, mutate] of [
  ["malformed stack", (i) => { i.stacks = [{}]; }], ["malformed alias", (i) => { i.aliases = [{}]; }],
  ["malformed VPC", (i) => { i.vpcs = [{}]; }], ["missing CIDR associations", (i) => { delete i.vpcs[0].CidrBlockAssociationSet; }],
  ["malformed route", (i) => { i.routeTables[0].Routes = [{}]; }], ["malformed route table", (i) => { i.routeTables = [{}]; }],
  ["existing production stack", (i) => { i.stacks[0].StackName = FOUNDATION.stackName; }],
  ["existing production alias", (i) => { i.aliases[0].AliasName = FOUNDATION.aliasName; }],
  ["same CIDR", (i) => { i.vpcs[0].CidrBlock = FOUNDATION.cidr; }],
  ["enclosing CIDR", (i) => { i.vpcs[0].CidrBlock = "10.0.0.0/8"; }],
  ["overlapping secondary CIDR", (i) => { i.vpcs[0].CidrBlockAssociationSet.push({ CidrBlock: "10.85.1.0/24", CidrBlockState: { State: "associated" } }); }],
  ["overlapping peer route", (i) => { i.routeTables[0].Routes.push({ DestinationCidrBlock: "10.85.42.0/24", VpcPeeringConnectionId: "pcx-fixture" }); }],
  ["unresolved prefix-list route", (i) => { i.routeTables[0].Routes.push({ DestinationPrefixListId: "pl-00000000000000001", TransitGatewayId: "tgw-fixture" }); }],
  ["malformed IPv6 route", (i) => { i.routeTables[0].Routes.push({ DestinationIpv6CidrBlock: "not-ipv6/64" }); }],
  ["invalid IPv6 prefix", (i) => { i.routeTables[0].Routes.push({ DestinationIpv6CidrBlock: "2001:db8::/129" }); }],
  ["ambiguous route destinations", (i) => { i.routeTables[0].Routes[0].DestinationIpv6CidrBlock = "::/0"; }],
  ["invalid octet", (i) => { i.vpcs[0].CidrBlock = "999.85.0.0/16"; }],
  ["invalid prefix", (i) => { i.vpcs[0].CidrBlock = "10.85.0.0/33"; }],
]) test(`rejects unsafe inventory: ${name}`, () => {
  const manifest = manifestFixture(); const inventory = inventoryFixture(manifest); mutate(inventory); assert.throws(() => validateInventory(inventory, manifest));
});
test("unrelated default and IPv6 routes do not allocate overlapping IPv4 space", () => {
  const manifest = manifestFixture(); const inventory = inventoryFixture(manifest);
  inventory.routeTables[0].Routes.push({ DestinationCidrBlock: "0.0.0.0/0", GatewayId: "igw-unrelated" }, { DestinationIpv6CidrBlock: "::/0", GatewayId: "igw-unrelated" });
  inventory.vpcs[0].CidrBlockAssociationSet.push({ CidrBlock: FOUNDATION.cidr, CidrBlockState: { State: "disassociated" } });
  validateInventory(inventory, manifest);
});

test("resolved provider prefix-list CIDRs are checked before accepting a disjoint endpoint route", () => {
  const manifest = manifestFixture(); const inventory = inventoryFixture(manifest);
  inventory.routeTables[0].Routes.push({ DestinationPrefixListId: "pl-00000000000000001", GatewayId: "vpce-fixture" });
  inventory.prefixListEntries = { "pl-00000000000000001": [{ Cidr: "52.216.0.0/15" }, { Cidr: "2001:db8::/32" }] };
  validateInventory(inventory, manifest);
  inventory.prefixListEntries["pl-00000000000000001"].push({ Cidr: "10.85.42.0/24" });
  assert.throws(() => validateInventory(inventory, manifest), /NETWORK_OVERLAP/u);
});
for (const [name, entries] of [
  ["missing list", {}], ["unknown map", null], ["unknown entries", { "pl-00000000000000001": null }],
  ["malformed entry", { "pl-00000000000000001": [{}] }],
  ["malformed IPv6 entry", { "pl-00000000000000001": [{ Cidr: "bad:address/64" }] }],
  ["extra unverified list", { "pl-00000000000000001": [], "pl-00000000000000002": [] }],
]) test(`rejects unresolved or malformed prefix evidence: ${name}`, () => {
  const manifest = manifestFixture(); const inventory = inventoryFixture(manifest);
  inventory.routeTables[0].Routes.push({ DestinationPrefixListId: "pl-00000000000000001", GatewayId: "vpce-fixture" });
  inventory.prefixListEntries = entries;
  assert.throws(() => validateInventory(inventory, manifest));
});
test("only the exact empty review placeholder may be reused after CREATE planning", () => {
  const manifest = manifestFixture(); const inventory = inventoryFixture(manifest); const fixture = planFixture(manifest);
  inventory.stacks.push({ StackName: FOUNDATION.stackName, StackId: fixture.stack.StackId, StackStatus: "REVIEW_IN_PROGRESS" });
  validateInventory(inventory, manifest, fixture.stack.StackId);
  assert.throws(() => validateInventory(inventory, manifest, `${fixture.stack.StackId}wrong`), /STACK_ALREADY_EXISTS/u);
  inventory.stacks.at(-1).StackStatus = "CREATE_COMPLETE";
  assert.throws(() => validateInventory(inventory, manifest, fixture.stack.StackId), /STACK_ALREADY_EXISTS/u);
});

test("builds a deterministic CREATE-only request and binds the exact nine-resource provider plan", () => {
  const fixture = planFixture(); approval(fixture.manifest);
  assert.equal(fixture.request.ChangeSetType, "CREATE");
  assert.equal(fixture.request.OnStackFailure, "ROLLBACK");
  assert.equal(fixture.request.IncludeNestedStacks, false);
  assert.equal(fixture.request.ImportExistingResources, false);
  assert.equal(fixture.request.Parameters, undefined);
  assert.equal(fixture.request.Capabilities, undefined);
  assert.deepEqual(JSON.parse(fixture.request.TemplateBody), template);
  const result = validatePlan(fixture);
  assert.match(result.bindingSha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.changes.length, 9);
  assert.deepEqual(result.changes.map((change) => change.id), Object.keys(RESOURCE_TYPES).sort());
  assert.equal(result.changeSetId, fixture.plan.ChangeSetId);
  fixture.plan.Tags.reverse(); fixture.plan.Changes.reverse();
  assert.equal(validatePlan(fixture).bindingSha256, result.bindingSha256);
});
for (const configuration of [undefined, null, { Mode: "STANDARD", DisableRollback: false }]) test(`accepts documented safe provider deployment config ${JSON.stringify(configuration)}`, () => {
  const fixture = planFixture(); fixture.plan.DeploymentConfig = configuration; validatePlan(fixture);
});
for (const [name, mutate] of [
  ["request UPDATE", (f) => { f.request.ChangeSetType = "UPDATE"; }],
  ["request drift", (f) => { f.request.Tags[0].Value = "Other"; }],
  ["provider template drift", (f) => { f.providerTemplate.Resources.Extra = { Type: "AWS::EC2::NatGateway" }; }],
  ["provider UPDATE", (f) => { f.plan.ChangeSetType = "UPDATE"; }],
  ["wrong account", (f) => { f.plan.ChangeSetId = f.plan.ChangeSetId.replace(FOUNDATION.accountId, "111111111111"); }],
  ["wrong region", (f) => { f.plan.ChangeSetId = f.plan.ChangeSetId.replace("us-east-1", "us-west-2"); }],
  ["missing change-set ID", (f) => { f.plan.ChangeSetId = f.plan.ChangeSetId.replace(/[^/]+$/u, ""); f.changeSets[0].ChangeSetId = f.plan.ChangeSetId; }],
  ["missing stack ID", (f) => { f.plan.StackId = f.plan.StackId.replace(/[^/]+$/u, ""); f.stack.StackId = f.plan.StackId; }],
  ["extra change-set ARN path", (f) => { f.plan.ChangeSetId += "/extra"; f.changeSets[0].ChangeSetId = f.plan.ChangeSetId; }],
  ["extra stack ARN query", (f) => { f.plan.StackId += "?other"; f.stack.StackId = f.plan.StackId; }],
  ["non-UUID change-set suffix", (f) => { f.plan.ChangeSetId = f.plan.ChangeSetId.replace(/[^/]+$/u, "not-an-id"); f.changeSets[0].ChangeSetId = f.plan.ChangeSetId; }],
  ["foreign stack name", (f) => { f.plan.StackName = "applypack-staging-foundation"; }],
  ["failed plan", (f) => { f.plan.Status = "FAILED"; }], ["executed plan", (f) => { f.plan.ExecutionStatus = "EXECUTE_COMPLETE"; }],
  ["wrong description", (f) => { f.plan.Description = "unreviewed"; }], ["no rollback", (f) => { f.plan.OnStackFailure = "DO_NOTHING"; }],
  ["IAM capability", (f) => { f.plan.Capabilities = ["CAPABILITY_IAM"]; }], ["parameter", (f) => { f.plan.Parameters = [{ ParameterKey: "any" }]; }],
  ["malformed capabilities", (f) => { f.plan.Capabilities = {}; }], ["resource import", (f) => { f.plan.ResourcesToImport = [{}]; }],
  ["nested stacks", (f) => { f.plan.IncludeNestedStacks = true; }], ["truthy import", (f) => { f.plan.ImportExistingResources = "false"; }],
  ["parent stack", (f) => { f.plan.ParentChangeSetId = "parent"; }], ["malformed root stack", (f) => { f.plan.RootChangeSetId = []; }],
  ["deployment mode", (f) => { f.plan.DeploymentMode = "EXPRESS"; }],
  ["empty deployment array", (f) => { f.plan.DeploymentConfig = []; }],
  ["deployment array", (f) => { f.plan.DeploymentConfig = [{ Mode: "STANDARD", DisableRollback: false }]; }],
  ["extra deployment property", (f) => { f.plan.DeploymentConfig = { Mode: "STANDARD", DisableRollback: false, Extra: true }; }],
  ["disabled rollback", (f) => { f.plan.DeploymentConfig = { Mode: "STANDARD", DisableRollback: true }; }],
  ["malformed tags", (f) => { f.plan.Tags = {}; }], ["staging tag", (f) => { f.plan.Tags.find((tag) => tag.Key === "Environment").Value = "staging"; }],
  ["quote tag drift", (f) => { f.plan.Tags.find((tag) => tag.Key === "ApprovedQuoteSha256").Value = "b".repeat(64); }],
  ["no termination protection", (f) => { f.stack.EnableTerminationProtection = false; }],
  ["wrong stack status", (f) => { f.stack.StackStatus = "CREATE_COMPLETE"; }],
  ["populated stack", (f) => { f.stackResources = [{}]; }], ["unknown stack resources", (f) => { f.stackResources = null; }],
  ["extra change set", (f) => { f.changeSets.push({ ChangeSetId: "other" }); }], ["wrong change set", (f) => { f.changeSets[0].ChangeSetId = "other"; }],
  ["malformed changes", (f) => { f.plan.Changes = {}; }], ["missing resource", (f) => { f.plan.Changes.pop(); }],
  ["duplicate resource", (f) => { f.plan.Changes[1] = copy(f.plan.Changes[0]); }],
  ["wrong resource type", (f) => { f.plan.Changes[0].ResourceChange.ResourceType = "AWS::EC2::NatGateway"; }],
  ["resource update", (f) => { f.plan.Changes[0].ResourceChange.Action = "Modify"; }],
  ["resource replacement", (f) => { f.plan.Changes[0].ResourceChange.Replacement = "True"; }],
  ["resource scope", (f) => { f.plan.Changes[0].ResourceChange.Scope = ["Properties"]; }],
  ["existing physical resource", (f) => { f.plan.Changes[0].ResourceChange.PhysicalResourceId = "vpc-existing"; }],
  ["nested resource change", (f) => { f.plan.Changes[0].ResourceChange.ChangeSetId = "nested"; }],
]) test(`rejects unsafe provider plan: ${name}`, () => { const fixture = planFixture(); mutate(fixture); assert.throws(() => validatePlan(fixture)); });

function argumentsFixture(mode = "prepare") {
  const args = ["--mode", mode, "--manifest", "C:\\private\\manifest.json", "--manifest-sha256", "a".repeat(64),
    "--quote", "C:\\private\\quote.md", "--quote-sha256", "b".repeat(64), "--output", "C:\\private\\new-evidence.json"];
  if (["inspect-plan", "execute-plan"].includes(mode)) args.push("--change-set", planFixture().plan.ChangeSetId);
  if (mode === "execute-plan") args.push("--plan-binding-sha256", "c".repeat(64));
  return args;
}
for (const mode of ["prepare", "create-plan", "inspect-plan", "execute-plan"]) test(`accepts only the required fixed arguments for ${mode}`, () => {
  const parsed = parseArguments(argumentsFixture(mode));
  assert.equal(parsed["--mode"], mode);
  assert.equal(Object.keys(parsed).length, 6 + Number(["inspect-plan", "execute-plan"].includes(mode)) + Number(mode === "execute-plan"));
});
for (const [name, mode, mutate] of [
  ["unknown mode", "prepare", (args) => { args[1] = "delete"; }],
  ["unknown flag", "prepare", (args) => { args.push("--force", "true"); }],
  ["extra positional argument", "prepare", (args) => { args.push("extra"); }],
  ["duplicate mode", "prepare", (args) => { args.push("--mode", "execute-plan"); }],
  ["missing value", "prepare", (args) => { args.pop(); }],
  ["flag as value", "prepare", (args) => { args[3] = "--quote"; }],
  ["missing quote", "prepare", (args) => { args.splice(6, 2); }],
  ["change set on prepare", "prepare", (args) => { args.push("--change-set", "unapproved"); }],
  ["change set on create", "create-plan", (args) => { args.push("--change-set", "unapproved"); }],
  ["binding on prepare", "prepare", (args) => { args.push("--plan-binding-sha256", "c".repeat(64)); }],
  ["missing inspect change set", "inspect-plan", (args) => { args.splice(12, 2); }],
  ["binding on inspect", "inspect-plan", (args) => { args.push("--plan-binding-sha256", "c".repeat(64)); }],
  ["missing execute change set", "execute-plan", (args) => { args.splice(12, 2); }],
  ["missing execute binding", "execute-plan", (args) => { args.splice(14, 2); }],
]) test(`rejects CLI argument ambiguity: ${name}`, () => {
  const args = argumentsFixture(mode); mutate(args);
  assert.throws(() => parseArguments(args), /PRODUCTION_FOUNDATION_(?:ARGUMENT|MODE)_/u);
});

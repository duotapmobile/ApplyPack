import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const FOUNDATION = Object.freeze({
  accountId: "838445019912", region: "us-east-1", environment: "production",
  stackName: "applypack-production-foundation", aliasName: "alias/applypack-production-sensitive-payloads",
  cidr: "10.85.0.0/16", templatePath: "infra/aws/production-foundation/template.json",
  templateSha256: "5e91bff611706382faf7c040f57c74018757e4fae15e9c492fe8c7e7567c237b",
});
export const RESOURCE_TYPES = Object.freeze({
  ProductionVpc: "AWS::EC2::VPC", PrivateSubnetA: "AWS::EC2::Subnet", PrivateSubnetB: "AWS::EC2::Subnet",
  PrivateRouteTableA: "AWS::EC2::RouteTable", PrivateRouteTableB: "AWS::EC2::RouteTable",
  PrivateSubnetRouteTableAssociationA: "AWS::EC2::SubnetRouteTableAssociation",
  PrivateSubnetRouteTableAssociationB: "AWS::EC2::SubnetRouteTableAssociation",
  ProductionSensitivePayloadKey: "AWS::KMS::Key", ProductionSensitivePayloadAlias: "AWS::KMS::Alias",
});
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const canonicalSha256 = (value) => sha256(JSON.stringify(canonical(value)));
const assert = (condition, code) => { if (!condition) throw new Error(`PRODUCTION_FOUNDATION_${code}`); };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const fresh = (value, now) => typeof value === "string" && Number.isFinite(Date.parse(value))
  && Date.parse(value) <= now && Date.parse(value) >= now - 24 * 60 * 60 * 1000;
const emptyCollection = (value) => value == null || (Array.isArray(value) && value.length === 0);
const expectedTags = (manifest) => [
  { Key: "Application", Value: "ApplyPack" }, { Key: "Environment", Value: "production" },
  { Key: "ManagedBy", Value: "CloudFormation" }, { Key: "ReleaseSha", Value: manifest.releaseSha },
  { Key: "ApprovedQuoteSha256", Value: manifest.quoteSha256 },
];

export function validateTemplate(template) {
  // Pin the entire reviewed object, including unknown properties: adding any
  // resource, route, IAM grant, parameter, or key-policy permission fails closed.
  assert(isObject(template) && canonicalSha256(template) === FOUNDATION.templateSha256, "TEMPLATE_INVALID");
  return template;
}

export function validateApproval({ manifest, manifestSha256, quoteBytes, quoteSha256, now = Date.now() }) {
  assert(exactKeys(manifest, ["schemaVersion", "environment", "accountId", "region", "profile", "operatorArn", "stackName", "releaseSha", "templateSha256", "quoteSha256", "quoteApproval"]), "MANIFEST_INVALID");
  assert(digest(manifestSha256) && canonicalSha256(manifest) === manifestSha256, "MANIFEST_DIGEST_INVALID");
  assert(manifest.schemaVersion === "applypack-production-foundation-approval-v1"
    && manifest.environment === FOUNDATION.environment && manifest.accountId === FOUNDATION.accountId
    && manifest.region === FOUNDATION.region && manifest.stackName === FOUNDATION.stackName
    && manifest.templateSha256 === FOUNDATION.templateSha256, "TARGET_INVALID");
  assert(typeof manifest.profile === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(manifest.profile), "PROFILE_INVALID");
  assert(typeof manifest.operatorArn === "string" && /^arn:aws:iam::838445019912:user\/[A-Za-z0-9+=,.@_\/-]+$/u.test(manifest.operatorArn), "OPERATOR_INVALID");
  assert(typeof manifest.releaseSha === "string" && /^[a-f0-9]{40}$/u.test(manifest.releaseSha), "RELEASE_INVALID");
  assert(digest(quoteSha256) && quoteSha256 === manifest.quoteSha256 && quoteBytes?.length > 0
    && sha256(quoteBytes) === quoteSha256, "QUOTE_DIGEST_INVALID");
  const approval = manifest.quoteApproval;
  assert(exactKeys(approval, ["approvedBy", "approvedAt", "approvalReference"])
    && typeof approval.approvedBy === "string" && approval.approvedBy.trim().length >= 2 && approval.approvedBy.length <= 120
    && typeof approval.approvalReference === "string" && approval.approvalReference.trim().length >= 10 && approval.approvalReference.length <= 1000
    && Number.isFinite(now) && fresh(approval.approvedAt, now), "QUOTE_APPROVAL_INVALID");
  return manifest;
}

export function validateIdentity(identity, manifest) {
  assert(isObject(identity) && identity.Account === FOUNDATION.accountId && identity.Arn === manifest.operatorArn, "IDENTITY_INVALID");
}

function cidrRange(value) {
  assert(typeof value === "string" && /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/u.test(value), "INVENTORY_CIDR_INVALID");
  const [address, prefixText] = value.split("/");
  const octets = address.split(".").map(Number);
  const prefix = Number(prefixText);
  assert(octets.every((part) => part >= 0 && part <= 255) && prefix <= 32, "INVENTORY_CIDR_INVALID");
  const number = octets.reduce((result, part) => result * 256 + part, 0);
  const size = 2 ** (32 - prefix);
  return [number - (number % size), number - (number % size) + size - 1];
}

export function validateInventory({ identity, stacks, aliases, vpcs, routeTables, prefixListEntries = {} }, manifest, allowedStackId = null) {
  validateIdentity(identity, manifest);
  assert([stacks, aliases, vpcs, routeTables].every(Array.isArray), "INVENTORY_UNVERIFIED");
  assert(stacks.every((stack) => isObject(stack) && typeof stack.StackName === "string" && stack.StackName.length > 0
    && typeof stack.StackId === "string" && typeof stack.StackStatus === "string")
    && aliases.every((alias) => isObject(alias) && typeof alias.AliasName === "string" && alias.AliasName.startsWith("alias/")), "INVENTORY_UNVERIFIED");
  const existing = stacks.filter((stack) => stack.StackName === FOUNDATION.stackName);
  assert(allowedStackId ? existing.length === 1 && existing[0].StackId === allowedStackId
    && existing[0].StackStatus === "REVIEW_IN_PROGRESS" : existing.length === 0, "STACK_ALREADY_EXISTS");
  assert(!aliases.some((alias) => alias.AliasName === FOUNDATION.aliasName), "ALIAS_ALREADY_EXISTS");
  const proposed = cidrRange(FOUNDATION.cidr);
  const cidrs = [];
  const prefixLists = new Set();
  const addCidr = (cidr, ipv6 = false) => {
    if (ipv6) {
      const parts = typeof cidr === "string" ? cidr.split("/") : [];
      assert(parts.length === 2 && isIP(parts[0]) === 6 && /^(?:0|[1-9]\d{0,2})$/u.test(parts[1])
        && Number(parts[1]) <= 128, "INVENTORY_CIDR_INVALID");
    } else if (cidr !== "0.0.0.0/0") cidrs.push(cidr);
  };
  for (const vpc of vpcs) {
    assert(isObject(vpc) && typeof vpc.CidrBlock === "string" && Array.isArray(vpc.CidrBlockAssociationSet), "INVENTORY_UNVERIFIED");
    cidrs.push(vpc.CidrBlock);
    for (const association of vpc.CidrBlockAssociationSet) {
      assert(isObject(association) && typeof association.CidrBlock === "string"
        && isObject(association.CidrBlockState) && typeof association.CidrBlockState.State === "string", "INVENTORY_UNVERIFIED");
      if (association.CidrBlockState?.State !== "disassociated") cidrs.push(association.CidrBlock);
    }
  }
  for (const table of routeTables) {
    assert(isObject(table) && Array.isArray(table.Routes), "INVENTORY_UNVERIFIED");
    for (const route of table.Routes) {
      assert(isObject(route) && [route.DestinationCidrBlock, route.DestinationIpv6CidrBlock, route.DestinationPrefixListId]
        .filter((destination) => typeof destination === "string" && destination.length > 0).length === 1, "INVENTORY_UNVERIFIED");
      // Default internet routes elsewhere do not allocate a competing CIDR.
      // Every more-specific IPv4 route, including peered/transit routes, is checked.
      if (route.DestinationCidrBlock !== undefined) addCidr(route.DestinationCidrBlock);
      if (route.DestinationIpv6CidrBlock !== undefined) addCidr(route.DestinationIpv6CidrBlock, true);
      if (route.DestinationPrefixListId !== undefined) {
        assert(typeof route.DestinationPrefixListId === "string" && /^pl-[a-f0-9]+$/u.test(route.DestinationPrefixListId), "INVENTORY_UNVERIFIED");
        prefixLists.add(route.DestinationPrefixListId);
      }
    }
  }
  assert(isObject(prefixListEntries) && Object.keys(prefixListEntries).sort().join("|") === [...prefixLists].sort().join("|"), "INVENTORY_UNVERIFIED");
  for (const id of prefixLists) {
    assert(Array.isArray(prefixListEntries[id]), "INVENTORY_UNVERIFIED");
    for (const entry of prefixListEntries[id]) {
      assert(isObject(entry) && typeof entry.Cidr === "string", "INVENTORY_UNVERIFIED");
      addCidr(entry.Cidr, entry.Cidr.includes(":"));
    }
  }
  assert(cidrs.every((cidr) => { const range = cidrRange(cidr); return proposed[1] < range[0] || range[1] < proposed[0]; }), "NETWORK_OVERLAP");
}

export function buildCreateRequest(manifest, template) {
  validateTemplate(template);
  return {
    StackName: FOUNDATION.stackName,
    ChangeSetName: `applypack-production-foundation-create-${manifest.releaseSha.slice(0, 12)}-${canonicalSha256(manifest).slice(0, 12)}`,
    ChangeSetType: "CREATE", ClientToken: `applypack-production-foundation-${canonicalSha256(manifest)}`,
    Description: `ApplyPack production foundation ${manifest.releaseSha}; approved quote ${manifest.quoteSha256}`,
    TemplateBody: JSON.stringify(template), OnStackFailure: "ROLLBACK", IncludeNestedStacks: false,
    ImportExistingResources: false, Tags: expectedTags(manifest),
  };
}

export function isFoundationResourceArn(value, kind, name) {
  const prefix = `arn:aws:cloudformation:${FOUNDATION.region}:${FOUNDATION.accountId}:${kind}/${name}/`;
  return ["stack", "changeSet"].includes(kind) && typeof value === "string" && value.startsWith(prefix)
    && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value.slice(prefix.length));
}

export function validatePlan({ plan, stack, stackResources, changeSets, providerTemplate, request, manifest }) {
  validateTemplate(providerTemplate);
  assert(canonicalSha256(request) === canonicalSha256(buildCreateRequest(manifest, providerTemplate)), "REQUEST_CHANGED");
  assert(isObject(plan) && isFoundationResourceArn(plan.ChangeSetId, "changeSet", request.ChangeSetName)
    && isFoundationResourceArn(plan.StackId, "stack", FOUNDATION.stackName), "PLAN_IDENTITY_INVALID");
  assert(plan.StackName === request.StackName && plan.ChangeSetName === request.ChangeSetName
    && plan.Description === request.Description && plan.OnStackFailure === "ROLLBACK"
    && plan.Status === "CREATE_COMPLETE" && plan.ExecutionStatus === "AVAILABLE", "PLAN_STATE_INVALID");
  assert(plan.ChangeSetType === undefined || plan.ChangeSetType === "CREATE", "PLAN_FEATURES_INVALID");
  assert(["Capabilities", "Parameters", "ResourcesToImport"].every((key) => emptyCollection(plan[key]))
    && ["ParentChangeSetId", "RootChangeSetId", "DeploymentMode"].every((key) => plan[key] == null)
    && ["IncludeNestedStacks", "ImportExistingResources"].every((key) => plan[key] === undefined || plan[key] === false), "PLAN_FEATURES_INVALID");
  assert(plan.DeploymentConfig === undefined || plan.DeploymentConfig === null
    || (exactKeys(plan.DeploymentConfig, ["Mode", "DisableRollback"])
      && plan.DeploymentConfig.Mode === "STANDARD" && plan.DeploymentConfig.DisableRollback === false), "DEPLOYMENT_CONFIG_INVALID");
  assert(Array.isArray(plan.Tags) && canonicalSha256([...plan.Tags].sort((a, b) => String(a.Key).localeCompare(String(b.Key))))
    === canonicalSha256(expectedTags(manifest).sort((a, b) => a.Key.localeCompare(b.Key))), "PLAN_TAGS_INVALID");
  assert(isObject(stack) && stack.StackId === plan.StackId && stack.StackName === FOUNDATION.stackName
    && stack.StackStatus === "REVIEW_IN_PROGRESS" && stack.EnableTerminationProtection === true
    && Array.isArray(stackResources) && stackResources.length === 0
    && Array.isArray(changeSets) && changeSets.length === 1 && changeSets[0].ChangeSetId === plan.ChangeSetId, "STACK_STATE_INVALID");
  assert(Array.isArray(plan.Changes) && plan.Changes.length === Object.keys(RESOURCE_TYPES).length, "PLAN_RESOURCES_INVALID");
  const seen = new Set();
  const changes = plan.Changes.map((change) => {
    const resource = change?.ResourceChange;
    assert(change?.Type === "Resource" && isObject(resource) && Object.hasOwn(RESOURCE_TYPES, resource.LogicalResourceId)
      && !seen.has(resource.LogicalResourceId) && resource.ResourceType === RESOURCE_TYPES[resource.LogicalResourceId]
      && resource.Action === "Add" && resource.Replacement == null && emptyCollection(resource.Scope)
      && resource.PhysicalResourceId == null && resource.ChangeSetId == null, "PLAN_RESOURCES_INVALID");
    seen.add(resource.LogicalResourceId);
    return { id: resource.LogicalResourceId, type: resource.ResourceType, action: "Add" };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {
    bindingSha256: canonicalSha256({ changeSetId: plan.ChangeSetId, stackId: plan.StackId,
      manifestSha256: canonicalSha256(manifest), quoteSha256: manifest.quoteSha256,
      requestSha256: canonicalSha256(request), templateSha256: FOUNDATION.templateSha256, changes }),
    changeSetId: plan.ChangeSetId, stackId: plan.StackId, changes,
  };
}

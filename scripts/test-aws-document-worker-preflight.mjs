import { evaluatePreflightEvidence } from "./aws-document-worker-preflight.mjs";

const accountId = "123456789012";
const environment = "staging";
const repositoryName = `applypack-${environment}-document-worker`;
const repositoryUri = `${accountId}.dkr.ecr.us-east-1.amazonaws.com/${repositoryName}`;
const imageDigest = `sha256:${"a".repeat(64)}`;
const input = {
  environment,
  region: "us-east-1",
  sourceCommitSha: "b".repeat(40),
  imageTag: "b".repeat(40),
  imageDigest,
  vpcId: "vpc-private",
  subnetIds: ["subnet-a", "subnet-b"],
  routeTableIds: ["rtb-a", "rtb-main"],
  checkedAt: "2026-10-19T00:00:00.000Z",
};
const evidence = {
  identity: { Account: accountId, Arn: `arn:aws:sts::${accountId}:assumed-role/scoped-auditor/session` },
  vpcs: { Vpcs: [{ VpcId: input.vpcId, State: "available" }] },
  prefixLists: { PrefixLists: [{ PrefixListId: "pl-s3", PrefixListName: "com.amazonaws.us-east-1.s3", OwnerId: "AWS", State: "create-complete" }] },
  subnets: { Subnets: [
    { SubnetId: "subnet-a", VpcId: input.vpcId, State: "available", MapPublicIpOnLaunch: false },
    { SubnetId: "subnet-b", VpcId: input.vpcId, State: "available", MapPublicIpOnLaunch: false },
  ] },
  routeTables: { RouteTables: [
    { RouteTableId: "rtb-a", VpcId: input.vpcId, Associations: [{ SubnetId: "subnet-a" }], Routes: [
      { DestinationCidrBlock: "10.0.0.0/16", GatewayId: "local", State: "active" },
      { DestinationPrefixListId: "pl-s3", GatewayId: "vpce-s3", State: "active" },
    ] },
    { RouteTableId: "rtb-main", VpcId: input.vpcId, Associations: [{ Main: true }], Routes: [
      { DestinationCidrBlock: "10.0.0.0/16", GatewayId: "local", State: "active" },
    ] },
  ] },
  repositories: { repositories: [{ repositoryName, registryId: accountId, repositoryUri,
    imageTagMutability: "IMMUTABLE", imageScanningConfiguration: { scanOnPush: true } }] },
  repositoryPolicy: { policyText: JSON.stringify({ Version: "2012-10-17", Statement: [{
    Sid: "EnvironmentLambdaImageRetrieval", Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" },
    Action: ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
    Condition: { ArnLike: { "aws:SourceArn": `arn:aws:lambda:us-east-1:${accountId}:function:applypack-${environment}-document-worker` } },
  }] }) },
  images: { imageDetails: [{ imageDigest, imageTags: [input.imageTag] }] },
  scan: { imageScanStatus: { status: "COMPLETE" }, imageScanFindings: { findingSeverityCounts: { CRITICAL: 0, HIGH: 0 } } },
};

function clone(value) { return structuredClone(value); }
function rejects(mutator, message) {
  const changed = clone(evidence);
  mutator(changed);
  let rejected = false;
  try { evaluatePreflightEvidence(input, changed); } catch { rejected = true; }
  if (!rejected) throw new Error(`negative preflight fixture accepted: ${message}`);
}

const receipt = evaluatePreflightEvidence(input, evidence);
if (!receipt.checks.noUnapprovedOutboundRoute || receipt.identities.routes.length !== 2
  || JSON.stringify(receipt).includes(accountId) || JSON.stringify(receipt).includes("subnet-a")) {
  throw new Error("sanitized positive preflight fixture failed");
}
rejects((changed) => changed.routeTables.RouteTables[0].Routes.push({ DestinationCidrBlock: "0.0.0.0/0", GatewayId: "nat-1", State: "active" }), "NAT default route");
rejects((changed) => changed.routeTables.RouteTables[0].Routes.push({ DestinationIpv6CidrBlock: "::/0", EgressOnlyInternetGatewayId: "eigw-1", State: "active" }), "IPv6 default route");
rejects((changed) => changed.routeTables.RouteTables[0].Routes.push({ DestinationCidrBlock: "10.1.0.0/16", TransitGatewayId: "tgw-1", State: "active" }), "unapproved transit route");
rejects((changed) => { changed.subnets.Subnets[0].MapPublicIpOnLaunch = true; }, "public subnet");
rejects((changed) => { changed.repositories.repositories[0].imageTagMutability = "MUTABLE"; }, "mutable ECR tags");
rejects((changed) => { changed.repositories.repositories[0].imageScanningConfiguration.scanOnPush = false; }, "scan disabled");
rejects((changed) => { changed.repositoryPolicy = { policyText: JSON.stringify({ Statement: [{ Effect: "Allow", Principal: "*", Action: "ecr:*" }] }) }; }, "public repository policy");
rejects((changed) => { changed.scan.imageScanFindings.findingSeverityCounts.HIGH = 1; }, "high scan finding");
console.log("AWS_DOCUMENT_WORKER_PREFLIGHT_FIXTURES_OK");

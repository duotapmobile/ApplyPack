import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sanitizedIdentity, sha256, writeCanonicalReceipt } from "./lib/canonical-receipt.mjs";

const REGION = "us-east-1";
const ENVIRONMENTS = new Set(["staging", "production"]);
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;

function parseArguments(argv) {
  const options = { subnetIds: [], routeTableIds: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("preflight_arguments_invalid");
    if (name === "--subnet-id") options.subnetIds.push(value);
    else if (name === "--route-table-id") options.routeTableIds.push(value);
    else options[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return options;
}

function awsJson(args, allowFailure = false) {
  const result = spawnSync("aws", [...args, "--region", REGION, "--output", "json", "--no-cli-pager"], {
    encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`aws_read_failed:${args[0]}:${args[1]}`);
  }
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`aws_json_invalid:${args[0]}:${args[1]}`); }
}

function sameValues(actual, expected) {
  return canonicalJson([...new Set(actual)].sort()) === canonicalJson([...new Set(expected)].sort());
}

function repositoryPolicyIsPrivate(policy, accountId, environment) {
  if (!policy) return false;
  let document;
  try { document = JSON.parse(policy.policyText); } catch { return false; }
  const statements = Array.isArray(document.Statement) ? document.Statement : [document.Statement];
  if (statements.length !== 1) return false;
  const statement = statements[0];
  const actions = (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).sort();
  return statement.Effect === "Allow" && statement.Sid === "EnvironmentLambdaImageRetrieval"
    && !statement.NotPrincipal && !statement.NotAction
    && statement.Principal?.Service === "lambda.amazonaws.com"
    && JSON.stringify(actions) === JSON.stringify(["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"])
    && statement.Condition?.ArnLike?.["aws:SourceArn"]
      === `arn:aws:lambda:us-east-1:${accountId}:function:applypack-${environment}-document-worker`;
}

export function evaluatePreflightEvidence(input, evidence) {
  if (!ENVIRONMENTS.has(input.environment) || input.region !== REGION || !GIT_SHA.test(input.sourceCommitSha)
    || !GIT_SHA.test(input.imageTag) || input.imageTag !== input.sourceCommitSha
    || !SHA256_DIGEST.test(input.imageDigest)) throw new Error("preflight_input_invalid");
  if (!/^\d{12}$/.test(evidence.identity.Account || "") || typeof evidence.identity.Arn !== "string") {
    throw new Error("aws_identity_invalid");
  }
  const accountId = evidence.identity.Account;
  const repositoryName = `applypack-${input.environment}-document-worker`;
  const expectedRepositoryUri = `${accountId}.dkr.ecr.${REGION}.amazonaws.com/${repositoryName}`;
  const vpc = evidence.vpcs.Vpcs?.find((entry) => entry.VpcId === input.vpcId);
  if (!vpc || vpc.State !== "available") throw new Error("vpc_invalid");
  const prefixLists = evidence.prefixLists.PrefixLists || [];
  if (prefixLists.length !== 1 || prefixLists[0].PrefixListName !== "com.amazonaws.us-east-1.s3"
    || prefixLists[0].OwnerId !== "AWS" || prefixLists[0].State !== "create-complete") {
    throw new Error("s3_prefix_list_invalid");
  }
  const prefixListId = prefixLists[0].PrefixListId;
  const subnets = evidence.subnets.Subnets || [];
  if (subnets.length !== input.subnetIds.length || !sameValues(subnets.map((entry) => entry.SubnetId), input.subnetIds)
    || subnets.some((entry) => entry.VpcId !== input.vpcId || entry.State !== "available" || entry.MapPublicIpOnLaunch !== false)) {
    throw new Error("private_subnet_invalid");
  }
  const routeTables = evidence.routeTables.RouteTables || [];
  const resolved = subnets.map((subnet) => {
    const explicit = routeTables.filter((table) => (table.Associations || []).some((association) => association.SubnetId === subnet.SubnetId));
    const matching = explicit.length ? explicit : routeTables.filter((table) => table.VpcId === input.vpcId
      && (table.Associations || []).some((association) => association.Main === true));
    if (matching.length !== 1) throw new Error("subnet_route_table_ambiguous");
    return { subnetId: subnet.SubnetId, routeTable: matching[0], association: explicit.length ? "explicit" : "main" };
  });
  if (!sameValues(resolved.map((entry) => entry.routeTable.RouteTableId), input.routeTableIds)) {
    throw new Error("selected_route_tables_do_not_match_subnets");
  }
  for (const { routeTable } of resolved) {
    for (const route of routeTable.Routes || []) {
      const local = route.GatewayId === "local" && route.State === "active";
      const s3Endpoint = route.DestinationPrefixListId === prefixListId
        && /^vpce-[a-z0-9]+$/.test(route.GatewayId || "") && route.State === "active";
      if (!local && !s3Endpoint) throw new Error("route_table_has_non_approved_path");
    }
  }
  const repositories = evidence.repositories.repositories || [];
  if (repositories.length !== 1) throw new Error("ecr_repository_missing");
  const repository = repositories[0];
  if (repository.repositoryName !== repositoryName || repository.registryId !== accountId
    || repository.repositoryUri !== expectedRepositoryUri || repository.imageTagMutability !== "IMMUTABLE"
    || repository.imageScanningConfiguration?.scanOnPush !== true) throw new Error("ecr_repository_invalid");
  if (!repositoryPolicyIsPrivate(evidence.repositoryPolicy, accountId, input.environment)) throw new Error("ecr_repository_policy_invalid");
  const image = (evidence.images.imageDetails || []).find((entry) => entry.imageDigest === input.imageDigest);
  if (!image || !(image.imageTags || []).includes(input.imageTag)) throw new Error("ecr_digest_or_immutable_tag_missing");
  const scanStatus = evidence.scan.imageScanStatus?.status;
  const severities = evidence.scan.imageScanFindings?.findingSeverityCounts || {};
  if (scanStatus !== "COMPLETE" || Number(severities.CRITICAL || 0) !== 0 || Number(severities.HIGH || 0) !== 0) {
    throw new Error("ecr_scan_not_clean");
  }
  const routeReceipts = resolved.map((entry) => ({
    association: entry.association,
    routeTableIdentitySha256: sanitizedIdentity(entry.routeTable.RouteTableId),
    subnetIdentitySha256: sanitizedIdentity(entry.subnetId),
  })).sort((left, right) => left.subnetIdentitySha256.localeCompare(right.subnetIdentitySha256));
  return {
    schema: "applypack.aws-document-worker-preflight.v1",
    checkedAt: input.checkedAt,
    environment: input.environment,
    region: REGION,
    sourceCommitSha: input.sourceCommitSha,
    image: { digest: input.imageDigest.slice("sha256:".length), tag: input.imageTag },
    identities: {
      accountIdentitySha256: sanitizedIdentity(accountId),
      callerIdentitySha256: sanitizedIdentity(evidence.identity.Arn),
      prefixListIdentitySha256: sanitizedIdentity(prefixListId),
      repositoryIdentitySha256: sanitizedIdentity(expectedRepositoryUri),
      vpcIdentitySha256: sanitizedIdentity(input.vpcId),
      routes: routeReceipts,
    },
    repository: {
      name: repositoryName,
      policySha256: evidence.repositoryPolicy ? sha256(evidence.repositoryPolicy.policyText) : null,
      policyDisposition: "LAMBDA_ENVIRONMENT_ONLY",
      scanStatus,
      criticalFindings: Number(severities.CRITICAL || 0),
      highFindings: Number(severities.HIGH || 0),
    },
    checks: {
      awsOwnedRegionalS3PrefixList: true,
      exactSubnetRouteTableAssociations: true,
      noUnapprovedOutboundRoute: true,
      currentAccountEnvironmentRepository: true,
      immutableTags: true,
      scanOnPush: true,
      repositoryPolicyPrivate: true,
      digestAndSourceTagExist: true,
      cleanCompletedImageScan: true,
    },
  };
}

function collectEvidence(options, prefixLists) {
  const repository = `applypack-${options.environment}-document-worker`;
  return {
    identity: awsJson(["sts", "get-caller-identity"]),
    vpcs: awsJson(["ec2", "describe-vpcs", "--vpc-ids", options.vpcId]),
    subnets: awsJson(["ec2", "describe-subnets", "--subnet-ids", ...options.subnetIds]),
    prefixLists,
    routeTables: awsJson(["ec2", "describe-route-tables", "--filters", `Name=vpc-id,Values=${options.vpcId}`]),
    repositories: awsJson(["ecr", "describe-repositories", "--repository-names", repository]),
    repositoryPolicy: awsJson(["ecr", "get-repository-policy", "--repository-name", repository], true),
    images: awsJson(["ecr", "describe-images", "--repository-name", repository, "--image-ids", `imageDigest=${options.imageDigest}`]),
    scan: awsJson(["ecr", "describe-image-scan-findings", "--repository-name", repository, "--image-id", `imageDigest=${options.imageDigest}`]),
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.outputDirectory || !options.environment || !options.vpcId || !options.sourceCommitSha
    || !options.imageTag || !options.imageDigest || !options.subnetIds.length || !options.routeTableIds.length) {
    throw new Error("preflight_required_arguments_missing");
  }
  const prefixListDescription = awsJson(["ec2", "describe-managed-prefix-lists", "--filters",
    "Name=prefix-list-name,Values=com.amazonaws.us-east-1.s3"]);
  const evidence = collectEvidence(options, prefixListDescription);
  const receipt = evaluatePreflightEvidence({ ...options, region: REGION, checkedAt: new Date().toISOString() }, evidence);
  const written = writeCanonicalReceipt(options.outputDirectory,
    `aws-document-worker-preflight-${options.environment}`, receipt);
  process.stdout.write(`PREFLIGHT_RECEIPT_SHA256=${written.digest}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

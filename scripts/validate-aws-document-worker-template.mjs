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
const templatePath = argument("--template", "infra/aws/document-worker/template.yaml");
const deploymentTemplatePath = argument("--deployment-template", "infra/aws/document-worker/deployment-role-template.yaml");
const dockerfilePath = resolve(root, "infra/aws/document-worker/Dockerfile");
const handlerPath = resolve(root, "infra/aws/document-worker/handler.py");
const lifecyclePath = resolve(root, "infra/aws/document-worker/ecr-lifecycle-policy.json");
const preflightPath = resolve(root, "scripts/aws-document-worker-preflight.mjs");
const probePath = resolve(root, "scripts/aws-document-worker-synthetic-probe.mjs");

const intrinsic = (name, kind) => new yaml.Type(`!${name}`, {
  kind,
  construct: (value) => ({ [`Fn::${name}`]: value }),
});
const schema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type("!Ref", { kind: "scalar", construct: (value) => ({ Ref: value }) }),
  new yaml.Type("!GetAtt", { kind: "scalar", construct: (value) => ({ "Fn::GetAtt": value }) }),
  intrinsic("Sub", "scalar"),
  intrinsic("Equals", "sequence"),
  intrinsic("If", "sequence"),
]);

const source = readFileSync(templatePath, "utf8");
const deploymentSource = readFileSync(deploymentTemplatePath, "utf8");
const dockerfile = readFileSync(dockerfilePath, "utf8");
const handler = readFileSync(handlerPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");
const probe = readFileSync(probePath, "utf8");
const lifecycle = JSON.parse(readFileSync(lifecyclePath, "utf8"));
const template = yaml.load(source, { schema, filename: templatePath });
const deploymentTemplate = yaml.load(deploymentSource, { schema, filename: deploymentTemplatePath });

function fail(message) {
  throw new Error(`AWS document worker template validation failed: ${message}`);
}
function assert(condition, message) {
  if (!condition) fail(message);
}
function json(value) {
  return JSON.stringify(value);
}
function actions(statement) {
  return (Array.isArray(statement?.Action) ? statement.Action : [statement?.Action]).filter(Boolean).sort();
}
function exactActions(statement, expected) {
  return json(actions(statement)) === json([...expected].sort());
}
function fn(value, name) {
  return value?.[`Fn::${name}`];
}
function exactKeys(object, expected) {
  return json(Object.keys(object || {}).sort()) === json([...expected].sort());
}
function hasWildcardAction(statement) {
  return actions(statement).some((action) => action === "*" || action.endsWith(":*"));
}

const parameters = template?.Parameters || {};
const resources = template?.Resources || {};
const outputs = template?.Outputs || {};
const deployment = parameters.DeploymentEnvironment || {};
assert(json(deployment.AllowedValues) === json(["staging", "production"]), "DeploymentEnvironment must allow only staging and production");
assert(deployment.Default === "production", "DeploymentEnvironment must preserve the production default");
assert(!parameters.WorkerImageUri, "caller-controlled WorkerImageUri must not exist");
assert(parameters.WorkerImageDigest?.AllowedPattern === "^sha256:[0-9a-f]{64}$", "image digest parameter must be exact");
assert(parameters.KmsKeyArn?.AllowedPattern?.startsWith("^arn:aws:kms:us-east-1:"), "KMS must use a us-east-1 key ARN");
assert(parameters.WorkerRolePermissionsBoundaryArn, "worker execution-role permissions boundary is required");
assert(template?.Rules?.RegionMustBeUsEast1, "template must fail outside us-east-1");

const bucket = resources.TemporaryBucket?.Properties || {};
assert(fn(bucket.BucketName, "Sub") === "applypack-${AWS::AccountId}-${DeploymentEnvironment}-document-worker-temp",
  "temporary bucket name must be account and environment scoped");
assert(bucket.BucketEncryption, "temporary bucket encryption is required");
const publicBlock = bucket.PublicAccessBlockConfiguration || {};
assert(exactKeys(publicBlock, ["BlockPublicAcls", "BlockPublicPolicy", "IgnorePublicAcls", "RestrictPublicBuckets"])
  && Object.values(publicBlock).every((value) => value === true), "all four exact S3 public access blocks are required");
assert(bucket.LifecycleConfiguration?.Rules?.length === 1
  && bucket.LifecycleConfiguration.Rules[0].ExpirationInDays === 1, "temporary objects must expire after one day");

const securityGroup = resources.WorkerSecurityGroup?.Properties || {};
const egress = securityGroup.SecurityGroupEgress || [];
assert(egress.length === 1 && egress[0].IpProtocol === "tcp" && egress[0].FromPort === 443 && egress[0].ToPort === 443,
  "worker egress must be a single HTTPS rule");
assert(egress[0].DestinationPrefixListId?.Ref === "S3PrefixListId" && !egress[0].CidrIp && !egress[0].CidrIpv6,
  "worker egress must target only the regional S3 prefix list");
const endpoint = resources.S3GatewayEndpoint?.Properties || {};
assert(endpoint.VpcEndpointType === "Gateway" && endpoint.VpcId?.Ref === "VpcId"
  && endpoint.RouteTableIds?.Ref === "PrivateRouteTableIds", "S3 gateway endpoint binding must be exact");
const endpointStatements = endpoint.PolicyDocument?.Statement || [];
assert(endpointStatements.length === 1 && endpointStatements[0].Effect === "Allow" && endpointStatements[0].Principal === "*"
  && exactActions(endpointStatements[0], ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
  && fn(endpointStatements[0].Resource, "Sub") === "${TemporaryBucket.Arn}/ephemeral/*"
  && endpointStatements[0].Condition?.Bool?.["aws:SecureTransport"] === "true",
"S3 endpoint policy must contain only TLS object access to the ephemeral prefix");
assert(!Object.values(resources).some((resource) => ["AWS::EC2::NatGateway", "AWS::EC2::InternetGateway"].includes(resource?.Type)),
  "template must not create NAT or internet gateways");

const workerRole = resources.WorkerRole?.Properties || {};
assert(fn(workerRole.RoleName, "Sub") === "applypack-${DeploymentEnvironment}-document-worker-execution"
  && fn(workerRole.Path, "Sub") === "/applypack/${DeploymentEnvironment}/"
  && workerRole.PermissionsBoundary?.Ref === "WorkerRolePermissionsBoundaryArn", "worker role identity and boundary must be exact");
const trust = workerRole.AssumeRolePolicyDocument?.Statement || [];
assert(trust.length === 1 && trust[0].Effect === "Allow" && trust[0].Action === "sts:AssumeRole"
  && exactKeys(trust[0].Principal, ["Service"]) && trust[0].Principal.Service === "lambda.amazonaws.com",
"worker trust must allow only the Lambda service");
assert(workerRole.Policies?.length === 1, "worker role must contain exactly one inline policy");
const workerStatements = workerRole.Policies[0].PolicyDocument?.Statement || [];
assert(workerStatements.length === 2, "worker role must contain only S3 and ENI statements");
assert(exactActions(workerStatements[0], ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
  && fn(workerStatements[0].Resource, "Sub") === "${TemporaryBucket.Arn}/ephemeral/*"
  && workerStatements[0].Condition?.Bool?.["aws:SecureTransport"] === "true", "worker S3 permissions must be exact TLS-only access");
assert(exactActions(workerStatements[1], ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets",
  "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"])
  && workerStatements[1].Resource === "*"
  && workerStatements[1].Condition?.StringEquals?.["aws:RequestedRegion"] === "us-east-1", "worker ENI permissions must be the exact regional Lambda VPC set");
assert(!workerStatements.some(hasWildcardAction), "worker role must not contain wildcard actions");

const worker = resources.Worker?.Properties || {};
const exactImageUri = "${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/applypack-${DeploymentEnvironment}-document-worker@${WorkerImageDigest}";
assert(fn(worker.FunctionName, "Sub") === "applypack-${DeploymentEnvironment}-document-worker", "Lambda name must be environment scoped");
assert(worker.MemorySize === 512 && worker.Timeout === 30 && worker.ReservedConcurrentExecutions === 2,
  "Lambda memory, timeout and concurrency bounds must remain fixed");
assert(worker.Environment?.Variables?.APPLYPACK_WORKER_DEPLOYMENT_ENV?.Ref === "DeploymentEnvironment",
  "Lambda must attest the selected environment");
assert(fn(worker.Code?.ImageUri, "Sub") === exactImageUri
  && fn(worker.Environment?.Variables?.APPLYPACK_WORKER_IMAGE_URI, "Sub") === exactImageUri,
"Lambda image must be constructed from the current account and exact environment repository");

const runtimePolicy = resources.WebRuntimePolicy?.Properties || {};
assert(fn(runtimePolicy.ManagedPolicyName, "Sub") === "applypack-${DeploymentEnvironment}-document-worker-runtime"
  && fn(runtimePolicy.Path, "Sub") === "/applypack/${DeploymentEnvironment}/", "runtime policy identity must be environment scoped");
const statements = runtimePolicy.PolicyDocument?.Statement || [];
assert(statements.length === 4 && statements.every((statement) => !hasWildcardAction(statement)),
  "runtime policy must contain only four exact statements and no wildcard actions");
assert(exactActions(statements[0], ["lambda:InvokeFunction"]) && statements[0].Resource?.Ref === "WorkerVersion",
  "runtime may invoke only the numbered Lambda version");
assert(exactActions(statements[1], ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
  && fn(statements[1].Resource, "Sub") === "${TemporaryBucket.Arn}/ephemeral/*"
  && statements[1].Condition?.Bool?.["aws:SecureTransport"] === "true", "runtime S3 access must be TLS and prefix scoped");
const kms = statements[2];
assert(exactActions(kms, ["kms:Encrypt", "kms:Decrypt"]) && kms.Resource?.Ref === "KmsKeyArn", "KMS data permissions must bind the exact key ARN");
assert(kms.Condition?.StringEquals?.["kms:EncryptionContext:deployment"]?.Ref === "DeploymentEnvironment"
  && kms.Condition.StringEquals["kms:EncryptionContext:application"] === "ApplyPack"
  && kms.Condition.StringEquals["kms:EncryptionContext:keyVersion"]?.Ref === "KmsKeyVersion", "KMS context must be exact");
assert(exactActions(statements[3], ["kms:DescribeKey"]) && statements[3].Resource?.Ref === "KmsKeyArn",
  "KMS describe permission must bind the exact key ARN");
assert(!source.includes("kms:EncryptionContext:deployment: production"), "production KMS context must not be hard-coded");
assert(Object.entries(resources).filter(([, resource]) => resource.Type?.startsWith("AWS::IAM::"))
  .every(([name]) => ["WorkerRole", "WebRuntimePolicy"].includes(name)), "main template must not contain extra IAM resources");

const budget = resources.Budget?.Properties?.Budget || {};
assert(budget.BudgetLimit?.Amount === 5 && budget.BudgetLimit?.Unit === "USD" && budget.TimeUnit === "MONTHLY",
  "the monthly AWS cost ceiling must remain USD 5");
assert(budget.BudgetName === "ApplyPack-new-AWS-cost-ceiling", "the account-wide cost ceiling must keep its stable name");
assert(lifecycle.rules?.length === 1 && lifecycle.rules[0]?.selection?.countType === "imageCountMoreThan"
  && lifecycle.rules[0]?.selection?.countNumber === 3 && lifecycle.rules[0]?.action?.type === "expire",
"ECR lifecycle must retain at most three immutable images");
for (const output of ["DeploymentEnvironment", "AwsRegion", "BucketName", "FunctionVersionArn", "WorkerIdentity",
  "WorkerFontSha256", "WorkerFontManifestSha256", "WorkerImageUri", "WorkerImageDigest", "EcrRepositoryName",
  "KmsKeyIdentity", "KmsKeyVersion", "WebRuntimePolicyArn"]) {
  assert(outputs[output], `missing readiness output ${output}`);
}
assert(fn(outputs.WorkerImageUri?.Value, "Sub") === exactImageUri, "image URI output must retain exact account/environment binding");

const deploymentResources = deploymentTemplate?.Resources || {};
assert(deploymentTemplate?.Parameters?.DeploymentEnvironment?.Default === "production"
  && deploymentTemplate?.Rules?.RegionMustBeUsEast1, "deployment-role template must preserve production default and region rule");
assert(exactKeys(deploymentResources, ["WorkerRepository", "WorkerRoleBoundary", "DeploymentRoleBoundary", "DeploymentRole"]),
  "deployment-role template must contain only the repository, two boundaries and service role");
const repository = deploymentResources.WorkerRepository?.Properties || {};
assert(fn(repository.RepositoryName, "Sub") === "applypack-${DeploymentEnvironment}-document-worker"
  && repository.ImageTagMutability === "IMMUTABLE" && repository.ImageScanningConfiguration?.ScanOnPush === true
  && repository.EncryptionConfiguration?.EncryptionType === "AES256", "bootstrap repository controls must be exact");
const repositoryStatements = repository.RepositoryPolicyText?.Statement || [];
assert(repositoryStatements.length === 1 && repositoryStatements[0].Principal?.Service === "lambda.amazonaws.com"
  && exactActions(repositoryStatements[0], ["ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"])
  && fn(repositoryStatements[0].Condition?.ArnLike?.["aws:SourceArn"], "Sub")
    === "arn:${AWS::Partition}:lambda:us-east-1:${AWS::AccountId}:function:applypack-${DeploymentEnvironment}-document-worker",
"repository policy must permit image retrieval only to the exact environment Lambda");
const repositoryLifecycle = JSON.parse(repository.LifecyclePolicy?.LifecyclePolicyText || "{}");
assert(repositoryLifecycle.rules?.length === 1 && repositoryLifecycle.rules[0].selection?.countNumber === 3,
  "bootstrap repository must retain only three images");
const deploymentRole = deploymentResources.DeploymentRole?.Properties || {};
const deploymentTrust = deploymentRole.AssumeRolePolicyDocument?.Statement || [];
assert(deploymentRole.PermissionsBoundary?.Ref === "DeploymentRoleBoundary"
  && json(deploymentRole.ManagedPolicyArns) === json([{ Ref: "DeploymentRoleBoundary" }]), "deployment role must use and attach its boundary");
assert(deploymentTrust.length === 1 && deploymentTrust[0].Action === "sts:AssumeRole"
  && deploymentTrust[0].Principal?.Service === "cloudformation.amazonaws.com", "deployment role trust must be CloudFormation only");
const deploymentStatements = deploymentResources.DeploymentRoleBoundary?.Properties?.PolicyDocument?.Statement || [];
const workerBoundaryStatements = deploymentResources.WorkerRoleBoundary?.Properties?.PolicyDocument?.Statement || [];
assert(workerBoundaryStatements.length === 2
  && exactActions(workerBoundaryStatements[0], ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"])
  && workerBoundaryStatements[0].Condition?.Bool?.["aws:SecureTransport"] === "true"
  && workerBoundaryStatements[1].Condition?.StringEquals?.["aws:RequestedRegion"] === "us-east-1",
"worker permissions boundary must preserve TLS-only S3 and regional ENI ceilings");
assert(deploymentStatements.length === 9 && deploymentStatements.every((statement) => !hasWildcardAction(statement)),
  "deployment boundary statement/action set must remain exact");
const createRole = deploymentStatements.find((statement) => statement.Sid === "CreateExactWorkerRoleWithBoundary");
const manageRole = deploymentStatements.find((statement) => statement.Sid === "ManageExactWorkerRole");
const passRole = deploymentStatements.find((statement) => statement.Sid === "ConstrainedPassRole");
const exactWorkerRoleArn = "arn:${AWS::Partition}:iam::${AWS::AccountId}:role/applypack/${DeploymentEnvironment}/applypack-${DeploymentEnvironment}-document-worker-execution";
assert(exactActions(createRole, ["iam:CreateRole"]) && fn(createRole.Resource, "Sub") === exactWorkerRoleArn
  && createRole.Condition?.StringEquals?.["iam:PermissionsBoundary"]?.Ref === "WorkerRoleBoundary",
  "worker role creation must require the environment boundary");
assert(fn(manageRole.Resource, "Sub") === exactWorkerRoleArn
  && exactActions(manageRole, ["iam:DeleteRole", "iam:GetRole", "iam:TagRole", "iam:UntagRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy"]),
"worker role management must target only the environment execution role");
assert(exactActions(passRole, ["iam:PassRole"]) && passRole.Condition?.StringEquals?.["iam:PassedToService"] === "lambda.amazonaws.com"
  && fn(passRole.Resource, "Sub") === exactWorkerRoleArn,
"PassRole must target only the environment worker role and Lambda service");
assert(!deploymentSource.includes("Action: \"*\""), "deployment role must not contain wildcard IAM actions");

assert((dockerfile.match(/debian:bookworm-slim@sha256:/g) || []).length === 2, "both Docker stages must pin the base-image digest");
assert(dockerfile.includes("ADD --checksum=sha256:"), "font download must be checksum pinned");
for (const hash of [
  "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8",
  "788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173",
  "e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0",
  "698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee",
]) assert(dockerfile.includes(hash), `missing pinned Liberation Sans face ${hash}`);
assert(!/ARIAL|COPY\s+.*\.(ttf|otf)/i.test(dockerfile), "Docker build must not accept proprietary or unpinned local fonts");
assert(handler.includes('deployment_environment not in ("staging", "production")'), "handler must reject an unknown environment");
assert(handler.includes('"deploymentEnvironment": deployment_environment'), "handler must return its environment attestation");
assert(preflight.includes("describe-route-tables") && preflight.includes("describe-managed-prefix-lists")
  && preflight.includes("imageTagMutability") && preflight.includes("describe-image-scan-findings")
  && preflight.includes("route_table_has_non_approved_path"),
"provider preflight must validate routes, AWS prefix list, immutable ECR and scan results");
assert(probe.includes('operation: "extract"') && probe.includes('operation: "probe-document"')
  && probe.includes('operation: "render-docx"') && probe.includes("kmsCrossEnvironmentDenied")
  && probe.includes("cleanupComplete"),
"synthetic harness must cover extraction, render, network, KMS separation and cleanup");

console.log("AWS_DOCUMENT_WORKER_TEMPLATE_OK");

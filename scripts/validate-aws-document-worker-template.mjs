import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

const root = process.cwd();
const templatePath = resolve(root, "infra/aws/document-worker/template.yaml");
const dockerfilePath = resolve(root, "infra/aws/document-worker/Dockerfile");
const handlerPath = resolve(root, "infra/aws/document-worker/handler.py");
const lifecyclePath = resolve(root, "infra/aws/document-worker/ecr-lifecycle-policy.json");

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
const dockerfile = readFileSync(dockerfilePath, "utf8");
const handler = readFileSync(handlerPath, "utf8");
const lifecycle = JSON.parse(readFileSync(lifecyclePath, "utf8"));
const template = yaml.load(source, { schema, filename: templatePath });

function fail(message) {
  throw new Error(`AWS document worker template validation failed: ${message}`);
}
function assert(condition, message) {
  if (!condition) fail(message);
}
function json(value) {
  return JSON.stringify(value);
}

const parameters = template?.Parameters || {};
const resources = template?.Resources || {};
const outputs = template?.Outputs || {};
const deployment = parameters.DeploymentEnvironment || {};
assert(json(deployment.AllowedValues) === json(["staging", "production"]), "DeploymentEnvironment must allow only staging and production");
assert(deployment.Default === "production", "DeploymentEnvironment must preserve the production default");
assert(parameters.WorkerImageUri?.AllowedPattern?.includes("us-east-1"), "image URI must be digest-pinned in us-east-1 ECR");
assert(parameters.WorkerImageUri?.AllowedPattern?.includes("@sha256:[0-9a-f]{64}"), "image URI must require a sha256 digest");
assert(parameters.KmsKeyArn?.AllowedPattern?.includes("arn:aws:kms:us-east-1"), "KMS must use an immutable us-east-1 key ARN");
assert(template?.Rules?.RegionMustBeUsEast1, "template must fail outside us-east-1");

const bucket = resources.TemporaryBucket?.Properties || {};
assert(bucket.BucketEncryption, "temporary bucket encryption is required");
assert(Object.values(bucket.PublicAccessBlockConfiguration || {}).every((value) => value === true), "all S3 public access blocks are required");
assert(bucket.LifecycleConfiguration?.Rules?.[0]?.ExpirationInDays === 1, "temporary objects must expire after one day");

const securityGroup = resources.WorkerSecurityGroup?.Properties || {};
const egress = securityGroup.SecurityGroupEgress || [];
assert(egress.length === 1 && egress[0].IpProtocol === "tcp" && egress[0].FromPort === 443 && egress[0].ToPort === 443,
  "worker egress must be a single HTTPS rule");
assert(egress[0].DestinationPrefixListId?.Ref === "S3PrefixListId" && !egress[0].CidrIp && !egress[0].CidrIpv6,
  "worker egress must target only the regional S3 prefix list");
assert(resources.S3GatewayEndpoint?.Properties?.VpcEndpointType === "Gateway", "S3 must use a gateway endpoint");
assert(!Object.values(resources).some((resource) => ["AWS::EC2::NatGateway", "AWS::EC2::InternetGateway"].includes(resource?.Type)),
  "template must not create NAT or internet gateways");

const worker = resources.Worker?.Properties || {};
assert(worker.FunctionName?.["Fn::Sub"] === "applypack-${DeploymentEnvironment}-document-worker", "Lambda name must be environment scoped");
assert(worker.MemorySize === 512 && worker.Timeout === 30 && worker.ReservedConcurrentExecutions === 2,
  "Lambda memory, timeout and concurrency bounds must remain fixed");
assert(worker.Environment?.Variables?.APPLYPACK_WORKER_DEPLOYMENT_ENV?.Ref === "DeploymentEnvironment",
  "Lambda must attest the selected environment");
assert(worker.Code?.ImageUri?.Ref === "WorkerImageUri", "Lambda must use the immutable image parameter");

const runtimePolicy = resources.WebRuntimePolicy?.Properties || {};
assert(runtimePolicy.ManagedPolicyName?.["Fn::Sub"] === "applypack-${DeploymentEnvironment}-document-worker-runtime",
  "runtime policy name must be environment scoped");
const statements = runtimePolicy.PolicyDocument?.Statement || [];
const kms = statements.find((statement) => json(statement.Action).includes("kms:Encrypt"));
assert(kms?.Resource?.Ref === "KmsKeyArn", "KMS policy must bind the exact key ARN");
assert(kms?.Condition?.StringEquals?.["kms:EncryptionContext:deployment"]?.Ref === "DeploymentEnvironment",
  "KMS policy must bind the selected deployment environment");
assert(kms?.Condition?.StringEquals?.["kms:EncryptionContext:application"] === "ApplyPack",
  "KMS policy must bind the application context");
assert(kms?.Condition?.StringEquals?.["kms:EncryptionContext:keyVersion"]?.Ref === "KmsKeyVersion",
  "KMS policy must bind the key version context");
assert(!source.includes("kms:EncryptionContext:deployment: production"), "production KMS context must not be hard-coded");

const budget = resources.Budget?.Properties?.Budget || {};
assert(budget.BudgetLimit?.Amount === 5 && budget.BudgetLimit?.Unit === "USD" && budget.TimeUnit === "MONTHLY",
  "the monthly AWS cost ceiling must remain USD 5");
assert(budget.BudgetName === "ApplyPack-new-AWS-cost-ceiling", "the account-wide cost ceiling must keep its stable name");
assert(lifecycle.rules?.length === 1 && lifecycle.rules[0]?.selection?.countType === "imageCountMoreThan"
  && lifecycle.rules[0]?.selection?.countNumber === 3 && lifecycle.rules[0]?.action?.type === "expire",
"ECR lifecycle must retain at most three immutable images");
for (const output of ["DeploymentEnvironment", "AwsRegion", "BucketName", "FunctionVersionArn", "WorkerIdentity",
  "WorkerFontSha256", "WorkerFontManifestSha256", "WorkerImageUri", "WorkerImageDigest", "KmsKeyIdentity", "KmsKeyVersion", "WebRuntimePolicyArn"]) {
  assert(outputs[output], `missing readiness output ${output}`);
}

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

console.log("AWS_DOCUMENT_WORKER_TEMPLATE_OK");

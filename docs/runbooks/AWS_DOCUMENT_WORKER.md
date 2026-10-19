# AWS document worker deployment

This runbook deploys the immutable Liberation Sans document worker separately for `staging` and `production`. It never unlocks checkout, approves document generation, or proves customer readiness. Keep `APP_CHECKOUT_ENABLED=false`, `APP_CANARY_CHECKOUT_ENABLED=false`, and `APP_LIVE_PAYMENTS_ENABLED=false` throughout infrastructure setup and probing.

## Safety boundary

- Use only the approved AWS account in `us-east-1`, authenticated with MFA through a temporary non-root role or IAM Identity Center session.
- Never paste access keys, session tokens, account IDs, KMS key ARNs, alert addresses, or customer content into chat, Git, command history, screenshots, or evidence.
- Use one stack, ECR repository, Lambda function, and dedicated runtime policy per environment. Never attach a staging runtime policy to production or a production runtime policy to staging.
- Use an existing reviewed customer-managed symmetric KMS key when available. The runtime policy binds `application=ApplyPack`, the chosen deployment environment, and the exact key version.
- Select private subnets whose route tables have no NAT gateway or internet-gateway default route. The template permits worker egress only to the regional S3 managed prefix list over TCP 443 and creates an S3 gateway endpoint.
- Reserved Lambda concurrency remains `2`, memory `512 MB`, timeout `30 seconds`, temporary S3 objects expire after one day, ECR retains three images, and the account-wide budget remains USD 5 per month.
- Exactly one stack owns the account-wide `ApplyPack-new-AWS-cost-ceiling` budget. Pass `CreateBudget=true` only for that stack and `false` for the other stack.

Stop before deployment when the principal, MFA, account, region, VPC, subnet route tables, prefix list, KMS key, runtime identity, or budget ownership cannot be verified.

## Source validation

From the canonical checkout at the reviewed SHA:

```powershell
$apRepo = 'C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2'
Set-Location -LiteralPath $apRepo
git rev-parse HEAD
npm.cmd run validate:aws-document-worker
npm.cmd test -- --run tests/unit/aws-document-worker-template.test.ts tests/unit/aws-document-worker-environment.test.ts tests/unit/renderer-readiness.test.ts tests/unit/manual-launch-hardening.test.ts
```

The validator parses the CloudFormation YAML with its version-locked parser and verifies the private-network, S3, KMS, IAM, concurrency, budget, immutable-image, and four-face Liberation Sans guards. When AWS CLI access is available, also run provider-side template validation before `deploy`:

```powershell
aws cloudformation validate-template --region us-east-1 --template-body file://infra/aws/document-worker/template.yaml
```

## Build and push an environment image

Set `$apEnvironment` to exactly `staging` or `production`. Do not reuse the other environment's ECR repository.

```powershell
$apRegion = 'us-east-1'
$apEnvironment = 'staging'
$apRepository = "applypack-$apEnvironment-document-worker"
$apImageTag = git rev-parse HEAD
$apAccountId = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0 -or $apAccountId -notmatch '^\d{12}$') { throw 'Scoped AWS identity is unavailable.' }
$apRegistry = "$apAccountId.dkr.ecr.$apRegion.amazonaws.com"

aws ecr describe-repositories --region $apRegion --repository-names $apRepository *> $null
if ($LASTEXITCODE -ne 0) {
  aws ecr create-repository --region $apRegion --repository-name $apRepository --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256 --tags Key=Application,Value=ApplyPack Key=Environment,Value=$apEnvironment
  if ($LASTEXITCODE -ne 0) { throw 'The environment ECR repository could not be created safely.' }
}
aws ecr put-lifecycle-policy --region $apRegion --repository-name $apRepository --lifecycle-policy-text file://infra/aws/document-worker/ecr-lifecycle-policy.json
if ($LASTEXITCODE -ne 0) { throw 'The bounded ECR lifecycle could not be applied.' }

aws ecr get-login-password --region $apRegion | docker login --username AWS --password-stdin $apRegistry
if ($LASTEXITCODE -ne 0) { throw 'ECR login failed.' }
docker buildx build --platform linux/amd64 --provenance=false --load --file infra/aws/document-worker/Dockerfile --tag "${apRepository}:${apImageTag}" infra/aws/document-worker
if ($LASTEXITCODE -ne 0) { throw 'The pinned worker image did not build.' }
docker tag "${apRepository}:${apImageTag}" "$apRegistry/${apRepository}:${apImageTag}"
docker push "$apRegistry/${apRepository}:${apImageTag}"
if ($LASTEXITCODE -ne 0) { throw 'The worker image did not push.' }
$apImageDigest = aws ecr describe-images --region $apRegion --repository-name $apRepository --image-ids imageTag=$apImageTag --query 'imageDetails[0].imageDigest' --output text
if ($apImageDigest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'An immutable image digest was not returned.' }
$apWorkerImageUri = "$apRegistry/$apRepository@$apImageDigest"
```

The image is environment-agnostic source, but each environment receives a distinct repository receipt and immutable digest reference.

## Staging stack

Populate these variables locally from reviewed AWS console selections. Do not record their values in public evidence.

```powershell
$apEnvironment = 'staging'
$apStackName = 'applypack-staging-document-worker'
$apVpcId = '<approved-private-vpc-id>'
$apPrivateSubnetIds = '<private-subnet-a>,<private-subnet-b>'
$apPrivateRouteTableIds = '<private-route-table-a>,<private-route-table-b>'
$apS3PrefixListId = '<us-east-1-s3-prefix-list-id>'
$apKmsKeyArn = '<existing-customer-managed-key-arn>'
$apKmsKeyVersion = '<reviewed-key-version>'
$apPrimaryAlertEmail = '<primary-budget-recipient>'
$apSecondaryAlertEmail = '<secondary-budget-recipient>'

aws cloudformation deploy --region us-east-1 --stack-name $apStackName --template-file infra/aws/document-worker/template.yaml --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --parameter-overrides DeploymentEnvironment=$apEnvironment WorkerImageUri=$apWorkerImageUri VpcId=$apVpcId PrivateSubnetIds=$apPrivateSubnetIds PrivateRouteTableIds=$apPrivateRouteTableIds S3PrefixListId=$apS3PrefixListId KmsKeyArn=$apKmsKeyArn KmsKeyVersion=$apKmsKeyVersion PrimaryAlertEmail=$apPrimaryAlertEmail SecondaryAlertEmail=$apSecondaryAlertEmail CreateBudget=true
if ($LASTEXITCODE -ne 0) { throw 'Staging document-worker stack deployment failed.' }
aws cloudformation describe-stacks --region us-east-1 --stack-name $apStackName --query 'Stacks[0].Outputs'
```

If the stable account-wide budget already belongs to another reviewed stack, use `CreateBudget=false` instead. Attach only this stack's `WebRuntimePolicyArn` output to the dedicated staging workload identity.

After the synthetic extraction, render, font, immutable-version, S3 cleanup, and outbound-network-denial probes pass, configure only the staging service with:

```text
APP_DEPLOYMENT_ENV=staging
APP_DOCUMENT_WORKER_DEPLOYMENT_ENV=staging
AWS_REGION=us-east-1
APP_DOCUMENT_WORKER_FUNCTION_ARN=<staging FunctionVersionArn output>
APP_DOCUMENT_WORKER_BUCKET=<staging BucketName output>
APP_DOCUMENT_WORKER_IDENTITY=<WorkerIdentity output>
APP_DOCUMENT_WORKER_FONT_SHA256=<WorkerFontSha256 output>
APP_DOCUMENT_WORKER_FONT_MANIFEST_SHA256=<WorkerFontManifestSha256 output>
APP_DOCUMENT_WORKER_IMAGE_DIGEST=<WorkerImageDigest output>
APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256=<sha256 of the sanitized staging probe packet>
APP_KMS_PROVIDER=aws
APP_KMS_KEY_IDENTITY=<reviewed staging-permitted key ARN>
APP_KMS_KEY_VERSION=<reviewed key version>
APP_KMS_ENCRYPTION_CONTEXT_VERSION=<reviewed application context version>
APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED=true
```

The network-attestation packet contains only the deployment name, immutable function version ARN, image digest, worker identity, font hashes, `networkIsolationVerified=true`, probe results, and timestamps. It contains no account ID outside the ARN, customer data, object key, bucket name, credentials, or alert address. Store only its SHA-256 in readiness variables and activation records.

## Production stack

Production is a separate change and approval. Do not configure the production application, approve rendering, or unlock checkout merely because this stack deploys.

```powershell
$apEnvironment = 'production'
$apStackName = 'applypack-production-document-worker'
$apRepository = 'applypack-production-document-worker'
$apVpcId = '<approved-production-private-vpc-id>'
$apPrivateSubnetIds = '<production-private-subnet-a>,<production-private-subnet-b>'
$apPrivateRouteTableIds = '<production-private-route-table-a>,<production-private-route-table-b>'
$apS3PrefixListId = '<us-east-1-s3-prefix-list-id>'
$apKmsKeyArn = '<existing-production-permitted-key-arn>'
$apKmsKeyVersion = '<reviewed-production-key-version>'
$apPrimaryAlertEmail = '<primary-budget-recipient>'
$apSecondaryAlertEmail = '<secondary-budget-recipient>'

# Repeat the build/push section with apEnvironment=production so apWorkerImageUri
# resolves to the production ECR repository and an immutable digest.
aws cloudformation deploy --region us-east-1 --stack-name $apStackName --template-file infra/aws/document-worker/template.yaml --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --parameter-overrides DeploymentEnvironment=$apEnvironment WorkerImageUri=$apWorkerImageUri VpcId=$apVpcId PrivateSubnetIds=$apPrivateSubnetIds PrivateRouteTableIds=$apPrivateRouteTableIds S3PrefixListId=$apS3PrefixListId KmsKeyArn=$apKmsKeyArn KmsKeyVersion=$apKmsKeyVersion PrimaryAlertEmail=$apPrimaryAlertEmail SecondaryAlertEmail=$apSecondaryAlertEmail CreateBudget=false
if ($LASTEXITCODE -ne 0) { throw 'Production document-worker stack deployment failed.' }
aws cloudformation describe-stacks --region us-east-1 --stack-name $apStackName --query 'Stacks[0].Outputs'
```

Attach only the production stack's `WebRuntimePolicyArn` to the dedicated production workload identity. Production readiness variables must all come from the production stack and production probe. The application rejects a staging deployment marker, staging function name, mutable Lambda alias, wrong region, wrong digest, wrong font manifest, or mismatched attestation hash.

## Verification and rollback

For each environment independently:

1. Verify the function ARN is a numbered immutable version and the name contains the exact environment.
2. Verify reserved concurrency `2`, memory `512`, timeout `30`, no NAT/default internet route, one S3-only egress rule, a private bucket, one-day object expiry, and the scoped endpoint policy.
3. Run synthetic DOCX extraction and render probes; require exact four-face Liberation Sans hashes and no fallback.
4. Require the outbound connection probe to fail and return `networkIsolationVerified=true`.
5. Verify source and rendered temporary objects are deleted; lifecycle is a backstop, not the primary cleanup path.
6. Run a synthetic KMS encrypt/decrypt round trip with the exact environment context. A staging ciphertext must not decrypt under production context, and vice versa.
7. Confirm both budget recipients accepted the AWS notification emails and test alert delivery without recording their addresses.

On failure, keep application readiness variables unset or disabled, detach only the affected environment policy, and delete the failed stack only after preserving sanitized failure evidence and confirming no temporary objects or obligations remain. Never delete or schedule deletion of a reused KMS key. Never reuse the other environment's stack, policy, function, bucket, probe hash, or readiness variables as a shortcut.

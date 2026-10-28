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
- A `networkIsolationVerified=true` response is not readiness evidence by itself. Each environment requires the canonical preflight receipt digest and the canonical synthetic-probe receipt digest produced by the checked-in harnesses.

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
aws cloudformation validate-template --region us-east-1 --template-body file://infra/aws/document-worker/deployment-role-template.yaml
```

## Define every environment input before use

Choose one environment and define every identity, network, KMS, alert, evidence, and budget input before running any AWS command. The staging values below are placeholders for locally reviewed provider values; never commit the resolved values.

```powershell
$apRegion = 'us-east-1'
$apEnvironment = 'staging'
$apStackName = 'applypack-staging-document-worker'
$apVpcId = '<approved-staging-private-vpc-id>'
$apPrivateSubnetA = '<staging-private-subnet-a>'
$apPrivateSubnetB = '<staging-private-subnet-b>'
$apPrivateRouteTableA = '<staging-effective-route-table-a>'
$apPrivateRouteTableB = '<staging-effective-route-table-b>'
$apPrivateSubnetIds = "$apPrivateSubnetA,$apPrivateSubnetB"
$apPrivateRouteTableIds = "$apPrivateRouteTableA,$apPrivateRouteTableB"
$apKmsKeyArn = '<existing-staging-permitted-key-arn>'
$apKmsKeyVersion = '<reviewed-staging-key-version>'
$apPrimaryAlertEmail = '<primary-budget-recipient>'
$apSecondaryAlertEmail = '<secondary-budget-recipient>'
$apCreateBudget = 'true'
$apSourceSha = git rev-parse HEAD
if ($apSourceSha -notmatch '^[0-9a-f]{40}$') { throw 'Exact source commit SHA is unavailable.' }
$apImageTag = $apSourceSha
$apEvidenceDirectory = Join-Path $env:TEMP "applypack-$apEnvironment-document-worker-evidence"
$apDeploymentRoleStack = "applypack-$apEnvironment-document-worker-deployment-role"
```

The ordered flow is mandatory: bootstrap repository and roles, build and push, preflight, deploy the main stack, run the synthetic probe, then configure only the matching application environment.

## 1. Bootstrap the environment repository and deployment role

An authorized, non-root IAM bootstrap identity creates one service-role stack per environment. The same stack creates the exact `applypack-<environment>-document-worker` repository with immutable tags, scan-on-push, AES-256 encryption, a three-image lifecycle, and a Lambda-only pull policy scoped to the environment function. Do not reuse the staging role, boundaries, or repository for production. This bootstrap is the only step that needs permission to create the named CloudFormation role, boundaries, and repository.

```powershell
aws cloudformation deploy --region $apRegion --stack-name $apDeploymentRoleStack --template-file infra/aws/document-worker/deployment-role-template.yaml --capabilities CAPABILITY_NAMED_IAM --parameter-overrides DeploymentEnvironment=$apEnvironment
if ($LASTEXITCODE -ne 0) { throw 'Environment deployment-role bootstrap failed.' }
$apDeploymentOutputs = aws cloudformation describe-stacks --region $apRegion --stack-name $apDeploymentRoleStack --query 'Stacks[0].Outputs' --output json | ConvertFrom-Json
$apDeploymentRoleArn = ($apDeploymentOutputs | Where-Object OutputKey -eq 'DeploymentRoleArn').OutputValue
$apWorkerRoleBoundaryArn = ($apDeploymentOutputs | Where-Object OutputKey -eq 'WorkerRoleBoundaryArn').OutputValue
$apRepository = ($apDeploymentOutputs | Where-Object OutputKey -eq 'EcrRepositoryName').OutputValue
if (!$apDeploymentRoleArn -or !$apWorkerRoleBoundaryArn -or $apRepository -ne "applypack-$apEnvironment-document-worker") { throw 'Deployment-role bootstrap outputs are incomplete or cross-environment.' }
```

The service role has a permissions boundary attached as both its identity policy and ceiling. `iam:PassRole` is limited to the environment execution role and `lambda.amazonaws.com`; execution-role creation requires the environment worker boundary. Main-stack deployment still declares `CAPABILITY_NAMED_IAM` and passes `--role-arn` so CloudFormation cannot fall back to the operator identity.

## 2. Build and push the exact source image

Set `$apEnvironment` to exactly `staging` or `production`. Do not reuse the other environment's ECR repository.

```powershell
$apAccountId = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0 -or $apAccountId -notmatch '^\d{12}$') { throw 'Scoped AWS identity is unavailable.' }
$apRegistry = "$apAccountId.dkr.ecr.$apRegion.amazonaws.com"

aws ecr describe-repositories --region $apRegion --repository-names $apRepository *> $null
if ($LASTEXITCODE -ne 0) { throw 'The environment ECR repository bootstrap is missing.' }

aws ecr get-login-password --region $apRegion | docker login --username AWS --password-stdin $apRegistry
if ($LASTEXITCODE -ne 0) { throw 'ECR login failed.' }
docker buildx build --platform linux/amd64 --provenance=false --load --file infra/aws/document-worker/Dockerfile --tag "${apRepository}:${apImageTag}" infra/aws/document-worker
if ($LASTEXITCODE -ne 0) { throw 'The pinned worker image did not build.' }
docker tag "${apRepository}:${apImageTag}" "$apRegistry/${apRepository}:${apImageTag}"
docker push "$apRegistry/${apRepository}:${apImageTag}"
if ($LASTEXITCODE -ne 0) { throw 'The worker image did not push.' }
$apImageDigest = aws ecr describe-images --region $apRegion --repository-name $apRepository --image-ids imageTag=$apImageTag --query 'imageDetails[0].imageDigest' --output text
if ($apImageDigest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'An immutable image digest was not returned.' }
```

The image is environment-agnostic source, but each environment receives a distinct repository receipt and immutable digest reference. The main template accepts only `$apImageDigest`; it constructs the URI from the current `AWS::AccountId`, `us-east-1`, and exact `applypack-$apEnvironment-document-worker` repository, so a caller cannot inject a cross-account or cross-environment image URI.

## 3. Create the provider-backed read-only preflight receipt

Before either stack deploy, run the checked-in harness under the scoped MFA-authenticated deployment identity. It uses AWS CLI read APIs only. It resolves the AWS-owned `com.amazonaws.us-east-1.s3` managed prefix list, resolves every subnet's effective route-table association, rejects every route except VPC-local and the exact S3 endpoint prefix-list route, and verifies the exact current-account ECR repository, immutable tags, scan-on-push, private/absent repository policy, requested digest and source tag, and a completed scan with zero critical or high findings.

```powershell
node scripts/aws-document-worker-preflight.mjs --environment $apEnvironment --vpc-id $apVpcId --subnet-id $apPrivateSubnetA --subnet-id $apPrivateSubnetB --route-table-id $apPrivateRouteTableA --route-table-id $apPrivateRouteTableB --source-commit-sha $apSourceSha --image-tag $apImageTag --image-digest $apImageDigest --output-directory $apEvidenceDirectory
if ($LASTEXITCODE -ne 0) { throw 'AWS document-worker provider preflight failed.' }
$apPreflightDigestLine = Get-Content -Raw -LiteralPath (Join-Path $apEvidenceDirectory "aws-document-worker-preflight-$apEnvironment.sha256")
$apPreflightReceiptSha256 = ($apPreflightDigestLine -split '\s+')[0]
if ($apPreflightReceiptSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Canonical preflight receipt digest is missing.' }
$apS3PrefixListId = aws ec2 describe-managed-prefix-lists --region us-east-1 --filters Name=prefix-list-name,Values=com.amazonaws.us-east-1.s3 --query 'PrefixLists[?OwnerId==`AWS` && State==`create-complete`].PrefixListId | [0]' --output text
if ($LASTEXITCODE -ne 0 -or $apS3PrefixListId -notmatch '^pl-[a-z0-9]+$') { throw 'AWS-owned S3 prefix list could not be resolved.' }
```

The JSON receipt contains SHA-256 identities instead of account, principal, VPC, subnet, route-table, or prefix-list IDs. Do not copy the raw CLI inputs into evidence.

## 4. Deploy the main environment stack

Do not proceed unless the preflight receipt is for the same exact environment, source SHA, image tag, digest, VPC, subnets, and route tables defined above.

```powershell
aws cloudformation deploy --region $apRegion --stack-name $apStackName --template-file infra/aws/document-worker/template.yaml --role-arn $apDeploymentRoleArn --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --parameter-overrides DeploymentEnvironment=$apEnvironment WorkerImageDigest=$apImageDigest VpcId=$apVpcId PrivateSubnetIds=$apPrivateSubnetIds PrivateRouteTableIds=$apPrivateRouteTableIds S3PrefixListId=$apS3PrefixListId KmsKeyArn=$apKmsKeyArn KmsKeyVersion=$apKmsKeyVersion WorkerRolePermissionsBoundaryArn=$apWorkerRoleBoundaryArn PrimaryAlertEmail=$apPrimaryAlertEmail SecondaryAlertEmail=$apSecondaryAlertEmail CreateBudget=$apCreateBudget
if ($LASTEXITCODE -ne 0) { throw 'Environment document-worker stack deployment failed.' }
aws cloudformation describe-stacks --region $apRegion --stack-name $apStackName --query 'Stacks[0].Outputs'
```

If the stable account-wide budget already belongs to another reviewed stack, use `CreateBudget=false` instead. Attach only this stack's `WebRuntimePolicyArn` output to the dedicated staging workload identity.

## 5. Run the synthetic worker and KMS probe

After deployment, read the stack outputs locally. First run the bucket-only read preflight under the approved MFA operator session. This occurs after stack creation because the earlier network/image preflight runs before the bucket exists. The operator requires only `s3:GetBucketVersioning` and `s3:GetBucketPolicy` on the exact matching environment bucket ARN for this additional check, plus the existing STS caller-identity read. The CloudFormation-only deployment role is not an operator-assumable role. Do not add these permissions to the application or Lambda runtime roles.

The bucket preflight rejects both `Enabled` and `Suspended`, unreadable state, the wrong owner/environment and a missing or conditional versioning deny. The new bucket has no `VersioningConfiguration`; its bucket policy denies `s3:PutBucketVersioning` to every principal. The CloudFormation service role can manage only this exact environment bucket policy. A previously versioned bucket requires separate reviewed recovery; suspending versioning does not remove old object versions and must not be accepted as cleanup proof.

```powershell
$apStackOutputs = aws cloudformation describe-stacks --region $apRegion --stack-name $apStackName --query 'Stacks[0].Outputs' --output json | ConvertFrom-Json
$apBucket = ($apStackOutputs | Where-Object OutputKey -eq 'BucketName').OutputValue
$apFunctionVersionArn = ($apStackOutputs | Where-Object OutputKey -eq 'FunctionVersionArn').OutputValue
$apImageDigestWithoutPrefix = $apImageDigest -replace '^sha256:', ''
node scripts/aws-document-worker-bucket-preflight.mjs --environment $apEnvironment --bucket $apBucket --function-version-arn $apFunctionVersionArn --image-digest $apImageDigestWithoutPrefix --preflight-receipt-sha256 $apPreflightReceiptSha256 --source-commit-sha $apSourceSha --output-directory $apEvidenceDirectory
if ($LASTEXITCODE -ne 0) { throw 'Temporary bucket versioning/owner/policy preflight failed.' }
$apBucketVersioningReceipt = Join-Path $apEvidenceDirectory "aws-document-worker-bucket-preflight-$apEnvironment.json"
$apBucketDigestLine = Get-Content -Raw -LiteralPath (Join-Path $apEvidenceDirectory "aws-document-worker-bucket-preflight-$apEnvironment.sha256")
$apBucketVersioningReceiptSha256 = ($apBucketDigestLine -split '\s+')[0]
if ($apBucketVersioningReceiptSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Canonical bucket preflight receipt digest is missing.' }
```

Then switch to the dedicated matching-environment runtime identity and run the synthetic probe within 15 minutes. The probe validates the receipt bytes, freshness, exact bucket, immutable function version, source SHA, image digest and network preflight binding before its first S3 upload. It includes the bucket receipt digest in its own canonical receipt. The wrong-environment KMS check counts as proven only when the AWS CLI returns exactly `AccessDeniedException` or `InvalidCiphertextException`; credential, network, throttle, malformed-request, and transient process failures fail the probe.

```powershell
node scripts/aws-document-worker-synthetic-probe.mjs --environment $apEnvironment --bucket $apBucket --function-version-arn $apFunctionVersionArn --kms-key-arn $apKmsKeyArn --kms-key-version $apKmsKeyVersion --image-digest $apImageDigestWithoutPrefix --preflight-receipt-sha256 $apPreflightReceiptSha256 --source-commit-sha $apSourceSha --bucket-versioning-receipt $apBucketVersioningReceipt --bucket-versioning-receipt-sha256 $apBucketVersioningReceiptSha256 --output-directory $apEvidenceDirectory
if ($LASTEXITCODE -ne 0) { throw 'Synthetic worker/KMS probe failed or cleanup was incomplete.' }
$apProbeDigestLine = Get-Content -Raw -LiteralPath (Join-Path $apEvidenceDirectory "aws-document-worker-synthetic-probe-$apEnvironment.sha256")
$apProbeReceiptSha256 = ($apProbeDigestLine -split '\s+')[0]
if ($apProbeReceiptSha256 -notmatch '^[0-9a-f]{64}$') { throw 'Canonical synthetic-probe receipt digest is missing.' }
```

The receipt proves state when observed; it is not a lifetime assertion. Before activation, require a fresh matching bucket/probe receipt and provider confirmation that the deny policy is installed. Repeat the bucket check after bucket, policy, IAM or stack changes, and monitor drift of both versioning and this deny policy during operation. A privileged policy change can remove the deny; the application deliberately lacks bucket-administration reads and cannot detect that drift itself. Any unreadable, stale, missing or changed evidence keeps activation blocked. Use a new evidence directory for a fresh receipt rather than overwriting earlier evidence. Hosted drift detection and alert delivery remain required provider acceptance evidence.

## 6. Configure only the matching application service

For staging, configure only the staging service with the exact staging outputs and receipt digests:

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
APP_DOCUMENT_WORKER_PREFLIGHT_RECEIPT_SHA256=<canonical preflight receipt SHA-256>
APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256=<canonical synthetic-probe receipt SHA-256>
APP_KMS_PROVIDER=aws
APP_KMS_KEY_IDENTITY=<reviewed staging-permitted key ARN>
APP_KMS_KEY_VERSION=<reviewed key version>
APP_KMS_ENCRYPTION_CONTEXT_VERSION=<reviewed application context version>
APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED=true
```

The application uses the AWS worker for staging extraction, probe, readiness, checkout, and generation as soon as this complete exact staging configuration is present. A partial or cross-environment staging configuration fails closed instead of silently falling back to local tools. Production always requires the remote worker. Store only the two receipt SHA-256 values in readiness configuration; the existing activation record stores the synthetic-probe receipt digest.

## Production execution uses the same ordered flow

Production is a separate change and approval. Do not configure the production application, approve rendering, or unlock checkout merely because this stack deploys.

Define all production inputs before their first use:

```powershell
$apRegion = 'us-east-1'
$apEnvironment = 'production'
$apStackName = 'applypack-production-document-worker'
$apVpcId = '<approved-production-private-vpc-id>'
$apPrivateSubnetA = '<production-private-subnet-a>'
$apPrivateSubnetB = '<production-private-subnet-b>'
$apPrivateRouteTableA = '<production-effective-route-table-a>'
$apPrivateRouteTableB = '<production-effective-route-table-b>'
$apPrivateSubnetIds = "$apPrivateSubnetA,$apPrivateSubnetB"
$apPrivateRouteTableIds = "$apPrivateRouteTableA,$apPrivateRouteTableB"
$apKmsKeyArn = '<existing-production-permitted-key-arn>'
$apKmsKeyVersion = '<reviewed-production-key-version>'
$apPrimaryAlertEmail = '<primary-budget-recipient>'
$apSecondaryAlertEmail = '<secondary-budget-recipient>'
$apCreateBudget = 'false'
$apSourceSha = git rev-parse HEAD
if ($apSourceSha -notmatch '^[0-9a-f]{40}$') { throw 'Exact source commit SHA is unavailable.' }
$apImageTag = $apSourceSha
$apEvidenceDirectory = Join-Path $env:TEMP "applypack-$apEnvironment-document-worker-evidence"
$apDeploymentRoleStack = "applypack-$apEnvironment-document-worker-deployment-role"
```

Then execute sections 1 through 6 without reordering: bootstrap the production repository and role, build and push the exact production-tagged source image, create the production preflight receipt, deploy the main production stack, run the production synthetic probe, and finally configure only the production application. Use the same commands above with these production variables; do not skip back to an earlier step or reuse a staging output. Production app configuration uses `APP_DEPLOYMENT_ENV=production` and `APP_DOCUMENT_WORKER_DEPLOYMENT_ENV=production`, with every remaining worker value taken only from the production stack and production receipts.

Attach only the production stack's `WebRuntimePolicyArn` to the dedicated production workload identity. Production readiness variables must all come from the production stack and production probe. The application rejects a staging deployment marker, staging function name, mutable Lambda alias, wrong region, wrong digest, wrong font manifest, or mismatched attestation hash.

## Verification and rollback

For each environment independently:

1. Verify the function ARN is a numbered immutable version and the name contains the exact environment.
2. Verify reserved concurrency `2`, memory `512`, timeout `30`, no NAT/default internet route, one S3-only egress rule, a private bucket, one-day object expiry, and the scoped endpoint policy.
3. Run synthetic DOCX extraction and render probes; require exact four-face Liberation Sans hashes and no fallback.
4. Require the checked-in probe to report outbound denial and bind its canonical receipt to the exact preflight receipt; a boolean `networkIsolationVerified=true` alone is insufficient.
5. Verify source and rendered temporary objects are deleted; lifecycle is a backstop, not the primary cleanup path.
6. Run a synthetic KMS encrypt/decrypt round trip with the exact environment context. A staging ciphertext must not decrypt under production context, and vice versa.
7. Confirm both budget recipients accepted the AWS notification emails and test alert delivery without recording their addresses.

On failure, keep application readiness variables unset or disabled, detach only the affected environment policy, and delete the failed stack only after preserving sanitized failure evidence and confirming no temporary objects or obligations remain. Never delete or schedule deletion of a reused KMS key. Never reuse the other environment's stack, policy, function, bucket, probe hash, or readiness variables as a shortcut.

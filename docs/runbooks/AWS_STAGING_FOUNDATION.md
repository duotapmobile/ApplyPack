# ApplyPack AWS Staging Foundation

Status: source-only, not deployed

This runbook governs only the isolated AWS foundation for the ApplyPack staging document worker in `us-east-1`. No command in this runbook targets production. The template creates no IAM resources, Internet Gateway, NAT Gateway, default route, VPC endpoint, Elastic IP, EC2 instance, RDS database, public IPv4 assignment, or budget.

## Source and fixed scope

- Template: `infra/aws/staging-foundation/template.yaml`
- Deterministic validator: `scripts/validate-aws-staging-foundation-template.mjs`
- Test: `tests/unit/aws-staging-foundation-template.test.ts`
- Stack name: `applypack-staging-foundation`
- Approved account: `838445019912`
- Approved principal: `arn:aws:iam::838445019912:user/applypack-staging-operator`
- Approved region: `us-east-1`
- KMS alias: `alias/applypack-staging-sensitive-payloads`

The template itself binds the approved staging account and region. It creates exactly one isolated VPC, two subnets in distinct Availability Zones, two route tables and their explicit subnet associations, one symmetric customer-managed KMS key, and its staging alias. The route tables receive only the VPC-local route that AWS creates automatically.

Every taggable resource has exactly these ownership tags:

```text
Application=ApplyPack
Environment=staging
ManagedBy=CloudFormation
```

## Cost and budget boundary

The VPC, subnets, and route tables have no fixed hourly charge. The initial fixed cost is approximately $1/month for the customer-managed KMS key, prorated hourly, plus any request charges. AWS currently states that the first and second automatic or on-demand key rotations add another $1/month each; check the [current AWS KMS pricing](https://aws.amazon.com/kms/pricing/) again before deployment.

The existing account-level $5 ApplyPack budget is evidence only. This template does not read, create, update, replace, or delete any budget. A budget is an alert, not a hard spending cap.

## Local validation only

From the canonical repository and reviewed commit:

```powershell
node scripts/validate-aws-staging-foundation-template.mjs
npx.cmd vitest run tests/unit/aws-staging-foundation-template.test.ts
$apAws = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
& $apAws cloudformation validate-template --profile applypack-staging --region us-east-1 --template-body file://infra/aws/staging-foundation/template.yaml
```

`validate-template` is read-only. It does not prove that deployment permissions, account state, quotas, or post-deployment isolation are correct.

## Mandatory identity gate

Deployment is prohibited unless two independent supervisors approve the exact Git SHA and the verified non-root profile resolves to the exact account and IAM user below.

```powershell
$apAws = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
$apProfile = 'applypack-staging'
$apRegion = 'us-east-1'
$apStackName = 'applypack-staging-foundation'
$apExpectedAccount = '838445019912'
$apExpectedArn = 'arn:aws:iam::838445019912:user/applypack-staging-operator'
$apIdentity = (& $apAws sts get-caller-identity --profile $apProfile --region $apRegion --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $apIdentity.Account -ne $apExpectedAccount -or $apIdentity.Arn -ne $apExpectedArn) {
  throw 'Staging AWS identity mismatch. Do not deploy.'
}
if ($apIdentity.Arn -match ':root$|:assumed-role/') { throw 'Root and assumed-role deployment are not approved.' }
```

MFA assignment must be independently verified by an administrator or by granting the user self-scoped `iam:ListMFADevices`; the current staging operator cannot prove that assignment through the CLI. Do not substitute an access key for the temporary `aws login` session.

## Approved deployment command after review

This section is documentation, not current authorization. Before executing it, re-run the identity gate, confirm the exact approved SHA, confirm the stack does not already exist, and obtain the two required supervisor approvals. The initial create enables termination protection atomically.

```powershell
& $apAws cloudformation describe-stacks --profile $apProfile --region $apRegion --stack-name $apStackName *> $null
if ($LASTEXITCODE -eq 0) { throw 'Foundation stack already exists. Use a separately reviewed update plan.' }

& $apAws cloudformation create-stack `
  --profile $apProfile `
  --region $apRegion `
  --stack-name $apStackName `
  --template-body file://infra/aws/staging-foundation/template.yaml `
  --enable-termination-protection `
  --on-failure ROLLBACK `
  --tags Key=Application,Value=ApplyPack Key=Environment,Value=staging Key=ManagedBy,Value=CloudFormation
if ($LASTEXITCODE -ne 0) { throw 'Staging foundation create request failed.' }
& $apAws cloudformation wait stack-create-complete --profile $apProfile --region $apRegion --stack-name $apStackName
if ($LASTEXITCODE -ne 0) { throw 'Staging foundation did not complete safely.' }
```

Do not add `CAPABILITY_IAM` or `CAPABILITY_NAMED_IAM`; this foundation intentionally creates no IAM resource. Do not disable termination protection for an update. Any replacement of the retained KMS key requires a separate ciphertext migration and deletion review.

## Post-deployment outputs

Read the outputs locally and pass only the exact values to the existing worker stack:

```powershell
$apOutputs = (& $apAws cloudformation describe-stacks --profile $apProfile --region $apRegion --stack-name $apStackName --query 'Stacks[0].Outputs' --output json | ConvertFrom-Json)
$apVpcId = ($apOutputs | Where-Object OutputKey -eq 'VpcId').OutputValue
$apPrivateSubnetA = ($apOutputs | Where-Object OutputKey -eq 'PrivateSubnetAId').OutputValue
$apPrivateSubnetB = ($apOutputs | Where-Object OutputKey -eq 'PrivateSubnetBId').OutputValue
$apPrivateRouteTableA = ($apOutputs | Where-Object OutputKey -eq 'PrivateRouteTableAId').OutputValue
$apPrivateRouteTableB = ($apOutputs | Where-Object OutputKey -eq 'PrivateRouteTableBId').OutputValue
$apKmsKeyArn = ($apOutputs | Where-Object OutputKey -eq 'KmsKeyArn').OutputValue
```

The existing worker stack receives these as `VpcId`, `PrivateSubnetIds`, `PrivateRouteTableIds`, and `KmsKeyArn`. Applications must bind the exact `KmsKeyArn`, not the alias. The key policy permits IAM delegation inside this account, but KMS data use also requires the `application=ApplyPack` and `deployment=staging` encryption context. A separate, reviewed identity policy still must grant the runtime only its required `kms:Encrypt`, `kms:Decrypt`, and `kms:DescribeKey` actions.

## Mandatory no-internet and key assertions

Run these assertions immediately after deployment and before creating the document-worker stack:

```powershell
$apStack = (& $apAws cloudformation describe-stacks --profile $apProfile --region $apRegion --stack-name $apStackName --output json | ConvertFrom-Json).Stacks[0]
if ($apStack.EnableTerminationProtection -ne $true) { throw 'Termination protection is not enabled.' }

$apSubnets = (& $apAws ec2 describe-subnets --profile $apProfile --region $apRegion --subnet-ids $apPrivateSubnetA $apPrivateSubnetB --output json | ConvertFrom-Json).Subnets
if ($apSubnets.Count -ne 2 -or ($apSubnets | Where-Object MapPublicIpOnLaunch).Count -ne 0) { throw 'Private subnet public IPv4 control failed.' }
if (($apSubnets.AvailabilityZone | Sort-Object -Unique).Count -ne 2) { throw 'Private subnets are not in distinct Availability Zones.' }

$apRouteTables = (& $apAws ec2 describe-route-tables --profile $apProfile --region $apRegion --route-table-ids $apPrivateRouteTableA $apPrivateRouteTableB --output json | ConvertFrom-Json).RouteTables
foreach ($apRouteTable in $apRouteTables) {
  if ($apRouteTable.Routes.Count -ne 1 -or $apRouteTable.Routes[0].GatewayId -ne 'local' -or $apRouteTable.Routes[0].DestinationCidrBlock -ne '10.84.0.0/16') {
    throw 'A private route table contains a non-local route.'
  }
}

$apInternetGateways = (& $apAws ec2 describe-internet-gateways --profile $apProfile --region $apRegion --filters "Name=attachment.vpc-id,Values=$apVpcId" --output json | ConvertFrom-Json).InternetGateways
if ($apInternetGateways.Count -ne 0) { throw 'Internet Gateway attached to isolated staging VPC.' }
$apNatGateways = (& $apAws ec2 describe-nat-gateways --profile $apProfile --region $apRegion --filter "Name=vpc-id,Values=$apVpcId" --output json | ConvertFrom-Json).NatGateways | Where-Object State -ne 'deleted'
if ($apNatGateways.Count -ne 0) { throw 'NAT Gateway exists in isolated staging VPC.' }
$apEndpoints = (& $apAws ec2 describe-vpc-endpoints --profile $apProfile --region $apRegion --filters "Name=vpc-id,Values=$apVpcId" --output json | ConvertFrom-Json).VpcEndpoints
if ($apEndpoints.Count -ne 0) { throw 'Foundation unexpectedly created a VPC endpoint.' }

$apKmsKeyId = ($apOutputs | Where-Object OutputKey -eq 'KmsKeyId').OutputValue
$apKey = (& $apAws kms describe-key --profile $apProfile --region $apRegion --key-id $apKmsKeyId --output json | ConvertFrom-Json).KeyMetadata
if ($apKey.KeyManager -ne 'CUSTOMER' -or $apKey.KeySpec -ne 'SYMMETRIC_DEFAULT' -or $apKey.KeyUsage -ne 'ENCRYPT_DECRYPT' -or $apKey.MultiRegion -ne $false) { throw 'KMS key shape mismatch.' }
$apRotation = (& $apAws kms get-key-rotation-status --profile $apProfile --region $apRegion --key-id $apKmsKeyId --output json | ConvertFrom-Json)
if ($apRotation.KeyRotationEnabled -ne $true) { throw 'KMS automatic rotation is disabled.' }
```

The later worker stack intentionally adds one free S3 gateway endpoint and its S3 prefix-list routes. Re-run the worker's own provider preflight at that point; do not weaken this foundation's pre-worker local-route-only assertion.

## Rollback and deletion boundary

On create failure, preserve sanitized CloudFormation events for review and do not retry blindly. Termination protection prevents accidental stack deletion after a successful create. The KMS key also has `DeletionPolicy: Retain`, `UpdateReplacePolicy: Retain`, and the maximum 30-day pending-deletion window.

Deleting the stack later does not delete the retained key. Scheduling key deletion requires separate authorization, proof that no staging ciphertext or backup still depends on it, and a reviewed recovery plan. Never repurpose this staging key or network for production.

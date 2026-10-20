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

## Local source validation

From the canonical repository and reviewed commit:

```powershell
node scripts/validate-aws-staging-foundation-template.mjs
npx.cmd vitest run tests/unit/aws-staging-foundation-template.test.ts
$apAws = 'C:\Program Files\Amazon\AWSCLIV2\aws.exe'
& $apAws cloudformation validate-template --profile applypack-staging --region us-east-1 --template-body file://infra/aws/staging-foundation/template.yaml
```

`validate-template` is read-only. It does not prove that deployment permissions, account state, quotas, or post-deployment isolation are correct.

## Mandatory reviewed-source provenance gate

Deployment must use a byte-extracted template from one exact supervisor-approved commit, never the live working-tree path. Both supervisors must record the full commit, tree, and template-blob object IDs. Replace all three placeholders below with those reviewed values. A branch name, abbreviated SHA, current remote tip, or locally modified file is not sufficient.

```powershell
$apApprovedSha = '<exact-40-character-supervisor-approved-commit-sha>'
$apApprovedTree = '<exact-40-character-supervisor-reviewed-tree-oid>'
$apApprovedTemplateBlob = '<exact-40-character-supervisor-reviewed-template-blob-oid>'
$apOwnedPaths = @(
  'docs/runbooks/AWS_STAGING_FOUNDATION.md',
  'infra/aws/staging-foundation/template.yaml',
  'scripts/validate-aws-staging-foundation-template.mjs',
  'tests/unit/aws-staging-foundation-template.test.ts'
)
if ($apApprovedSha -notmatch '^[0-9a-f]{40}$' -or $apApprovedTree -notmatch '^[0-9a-f]{40}$' -or $apApprovedTemplateBlob -notmatch '^[0-9a-f]{40}$') {
  throw 'Full reviewed Git identities are required.'
}

$apRepo = (git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or $apRepo -ne 'C:/Users/mskir/Desktop/Apply_Pack/applypack-production-v2') {
  throw 'Canonical repository root mismatch.'
}
$apValidatorPath = Join-Path $apRepo 'scripts\validate-aws-staging-foundation-template.mjs'
$apWorkingTemplatePath = Join-Path $apRepo 'infra\aws\staging-foundation\template.yaml'
$apOrigin = (git -C $apRepo remote get-url origin).Trim()
$apHead = (git -C $apRepo rev-parse 'HEAD^{commit}').Trim()
$apResolvedTree = (git -C $apRepo rev-parse "$apApprovedSha^{tree}").Trim()
$apResolvedTemplateBlob = (git -C $apRepo rev-parse "${apApprovedSha}:infra/aws/staging-foundation/template.yaml").Trim()
if ($LASTEXITCODE -ne 0 -or $apOrigin -ne 'https://github.com/duotapmobile/ApplyPack.git' -or
  $apHead -ne $apApprovedSha -or $apResolvedTree -ne $apApprovedTree -or
  $apResolvedTemplateBlob -ne $apApprovedTemplateBlob) {
  throw 'Canonical origin, HEAD, tree, or template blob does not match the reviewed identity.'
}
git -C $apRepo diff --quiet HEAD -- $apOwnedPaths
if ($LASTEXITCODE -ne 0) { throw 'A task-owned foundation file differs from approved HEAD.' }
git -C $apRepo diff --cached --quiet HEAD -- $apOwnedPaths
if ($LASTEXITCODE -ne 0) { throw 'A staged task-owned foundation change exists.' }

$apEvidenceDirectory = Join-Path ([IO.Path]::GetTempPath()) "applypack-staging-foundation-$apApprovedSha"
if (Test-Path -LiteralPath $apEvidenceDirectory) { throw 'Exact-SHA evidence directory already exists; archive it before a new run.' }
New-Item -ItemType Directory -Path $apEvidenceDirectory | Out-Null
$apReviewedTemplatePath = Join-Path $apEvidenceDirectory 'reviewed-template.yaml'
$apExtractionMarker = (& node $apValidatorPath `
  --extract-reviewed-template `
  --repo $apRepo `
  --approved-commit $apApprovedSha `
  --approved-tree $apApprovedTree `
  --approved-blob $apApprovedTemplateBlob `
  --output $apReviewedTemplatePath).Trim()
if ($LASTEXITCODE -ne 0 -or $apExtractionMarker -ne "AWS_STAGING_FOUNDATION_REVIEWED_TEMPLATE_EXTRACTED=$apApprovedTemplateBlob") {
  throw 'Binary-safe exact reviewed template extraction failed.'
}
if (!(Test-Path -LiteralPath $apReviewedTemplatePath -PathType Leaf) -or
  -not ((Get-Item -LiteralPath $apReviewedTemplatePath).Attributes -band [IO.FileAttributes]::ReadOnly)) {
  throw 'Reviewed template is missing or is not read-only.'
}
$apExtractedBlob = (git -C $apRepo hash-object --no-filters $apReviewedTemplatePath).Trim()
if ($LASTEXITCODE -ne 0 -or $apExtractedBlob -ne $apApprovedTemplateBlob) { throw 'Extracted template Git blob mismatch.' }
$apReviewedTemplateBodySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $apReviewedTemplatePath).Hash.ToLowerInvariant()
$apWorkingTemplateBodySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $apWorkingTemplatePath).Hash.ToLowerInvariant()
if ($apReviewedTemplateBodySha256 -notmatch '^[a-f0-9]{64}$' -or $apReviewedTemplateBodySha256 -ne $apWorkingTemplateBodySha256) {
  throw 'Extracted and reviewed working-tree template bytes differ.'
}

$apNormalizedLine = (node $apValidatorPath --template $apReviewedTemplatePath --print-template-sha256).Trim()
if ($LASTEXITCODE -ne 0 -or $apNormalizedLine -notmatch '^AWS_STAGING_FOUNDATION_TEMPLATE_SHA256=([a-f0-9]{64})$') {
  throw 'Exact reviewed template failed deterministic validation.'
}
$apReviewedNormalizedTemplateSha256 = $Matches[1]
$apReviewedTemplateUri = 'file://' + ($apReviewedTemplatePath -replace '\\', '/')
```

The immutable extracted file is outside the repository, and its body SHA-256, normalized SHA-256, Git blob, tree, and commit are bound before any provider call. Do not unset its read-only attribute or substitute another path.

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

User-provided console evidence reports MFA assigned to this exact IAM user. The screenshot is not stored in the repository and is not independent provider proof. Deployment still requires an administrator to attest the exact user and MFA device assignment, or to grant the user self-scoped `iam:ListMFADevices` for direct verification. Do not substitute an access key for the temporary `aws login` session.

## Mandatory read-only collision preflight

Run this only after the provenance and identity gates. Every AWS call is read-only. Any API error, active exact-name stack, exact alias, prior matching key, or exact-CIDR VPC fails closed. A `PendingDeletion` key still counts as present and blocks a new create until reviewed resolution.

```powershell
$apActiveStatuses = @(
  'CREATE_IN_PROGRESS', 'CREATE_FAILED', 'CREATE_COMPLETE', 'ROLLBACK_IN_PROGRESS', 'ROLLBACK_FAILED', 'ROLLBACK_COMPLETE',
  'DELETE_IN_PROGRESS', 'DELETE_FAILED', 'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_COMPLETE',
  'UPDATE_FAILED', 'UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_FAILED', 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
  'UPDATE_ROLLBACK_COMPLETE', 'REVIEW_IN_PROGRESS', 'IMPORT_IN_PROGRESS', 'IMPORT_COMPLETE', 'IMPORT_ROLLBACK_IN_PROGRESS',
  'IMPORT_ROLLBACK_FAILED', 'IMPORT_ROLLBACK_COMPLETE'
)
$apStackList = (& $apAws cloudformation list-stacks --profile $apProfile --region $apRegion --stack-status-filter $apActiveStatuses --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Could not prove exact stack absence.' }
if (($apStackList.StackSummaries | Where-Object StackName -eq $apStackName).Count -ne 0) { throw 'Exact foundation stack already exists.' }

$apAliases = (& $apAws kms list-aliases --profile $apProfile --region $apRegion --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Could not prove exact KMS alias absence.' }
if (($apAliases.Aliases | Where-Object AliasName -eq 'alias/applypack-staging-sensitive-payloads').Count -ne 0) { throw 'Exact staging KMS alias already exists.' }

$apKeys = (& $apAws kms list-keys --profile $apProfile --region $apRegion --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate customer-managed KMS keys.' }
foreach ($apKeySummary in $apKeys.Keys) {
  $apMetadata = (& $apAws kms describe-key --profile $apProfile --region $apRegion --key-id $apKeySummary.KeyId --output json | ConvertFrom-Json).KeyMetadata
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect an existing KMS key.' }
  $apTags = (& $apAws kms list-resource-tags --profile $apProfile --region $apRegion --key-id $apKeySummary.KeyId --output json | ConvertFrom-Json).Tags
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect existing KMS key tags.' }
  $apHasExactTags = ($apTags | Where-Object { $_.TagKey -eq 'Application' -and $_.TagValue -eq 'ApplyPack' }).Count -eq 1 -and
    ($apTags | Where-Object { $_.TagKey -eq 'Environment' -and $_.TagValue -eq 'staging' }).Count -eq 1 -and
    ($apTags | Where-Object { $_.TagKey -eq 'ManagedBy' -and $_.TagValue -eq 'CloudFormation' }).Count -eq 1
  if ($apMetadata.Description -eq 'ApplyPack staging sensitive-payload envelope key' -or $apHasExactTags) {
    throw 'A prior matching staging KMS key exists, including a possible PendingDeletion key.'
  }
}

$apVpcCollisions = (& $apAws ec2 describe-vpcs --profile $apProfile --region $apRegion --filters 'Name=cidr-block,Values=10.84.0.0/16' --output json | ConvertFrom-Json).Vpcs
if ($LASTEXITCODE -ne 0) { throw 'Could not prove staging VPC CIDR absence.' }
if ($apVpcCollisions.Count -ne 0) { throw 'The exact staging foundation VPC CIDR already exists.' }

& $apAws cloudformation validate-template --profile $apProfile --region $apRegion --template-body $apReviewedTemplateUri *> $null
if ($LASTEXITCODE -ne 0) { throw 'Provider rejected the exact reviewed template.' }
```

## Reviewed CREATE change-set workflow

This section is documentation, not current authorization. Re-run every preceding gate immediately before it. Create the change set from the immutable extracted template, review and receipt the exact provider plan, obtain two independent approvals bound to that receipt, and execute only the exact returned change-set ID. Do not use a direct stack-create or deployment shortcut.

`ChangeSetType` is an input to `CreateChangeSet`; AWS does not return it from `DescribeChangeSet`. The workflow therefore writes a read-only, hashed receipt of the exact governed request before the API call and never fabricates a provider-returned type. It independently requires the exact returned IDs, matching description and failure policy, an empty new-stack `REVIEW_IN_PROGRESS` placeholder, no nested/import/drift fields, and the exact nine-resource Add-only plan. A change set created without that immutable request receipt is not executable under this procedure.

```powershell
$apExpectedChanges = [ordered]@{
  StagingVpc = 'AWS::EC2::VPC'
  PrivateSubnetA = 'AWS::EC2::Subnet'
  PrivateSubnetB = 'AWS::EC2::Subnet'
  PrivateRouteTableA = 'AWS::EC2::RouteTable'
  PrivateRouteTableB = 'AWS::EC2::RouteTable'
  PrivateSubnetRouteTableAssociationA = 'AWS::EC2::SubnetRouteTableAssociation'
  PrivateSubnetRouteTableAssociationB = 'AWS::EC2::SubnetRouteTableAssociation'
  StagingSensitivePayloadKey = 'AWS::KMS::Key'
  StagingSensitivePayloadAlias = 'AWS::KMS::Alias'
}

function Get-FoundationChangeSetReceipt {
  param(
    [Parameter(Mandatory)] $ChangeSet,
    [Parameter(Mandatory)] [bool] $TerminationProtectionEnabled
  )
  Assert-GovernedFoundationCreateRequest
  $apImportExistingResourcesProperty = $ChangeSet.PSObject.Properties['ImportExistingResources']
  $apIncludeNestedStacksProperty = $ChangeSet.PSObject.Properties['IncludeNestedStacks']
  $apImportExistingResources = $null -ne $apImportExistingResourcesProperty -and
    $null -ne $apImportExistingResourcesProperty.Value -and [bool]$apImportExistingResourcesProperty.Value
  $apIncludeNestedStacks = $null -ne $apIncludeNestedStacksProperty -and
    $null -ne $apIncludeNestedStacksProperty.Value -and [bool]$apIncludeNestedStacksProperty.Value
  if ($ChangeSet.ChangeSetId -ne $apChangeSetId -or $ChangeSet.StackId -ne $apStackId -or
    $ChangeSet.StackName -ne $apGovernedCreateRequest.stackName -or
    $ChangeSet.ChangeSetName -ne $apGovernedCreateRequest.changeSetName -or
    $ChangeSet.Description -ne $apGovernedCreateRequest.description -or
    $ChangeSet.OnStackFailure -ne $apGovernedCreateRequest.onStackFailure -or
    $ChangeSet.Status -ne 'CREATE_COMPLETE' -or $ChangeSet.ExecutionStatus -ne 'AVAILABLE') {
    throw 'Provider change set identity or state is not executable.'
  }
  if ($ChangeSet.Capabilities.Count -ne 0 -or $ChangeSet.Parameters.Count -ne 0 -or
    $apIncludeNestedStacks -eq $true -or $apImportExistingResources -eq $true -or
    $null -ne $ChangeSet.ParentChangeSetId -or $null -ne $ChangeSet.RootChangeSetId -or
    $null -ne $ChangeSet.DeploymentMode) {
    throw 'Unexpected IAM capability, parameter, nested-stack, or import request in foundation change set.'
  }
  if ($ChangeSet.Changes.Count -ne 9) { throw 'CREATE change set must contain exactly the expected nine resources.' }
  $apActualLogicalIds = @($ChangeSet.Changes.ResourceChange.LogicalResourceId | Sort-Object)
  $apExpectedLogicalIds = @($apExpectedChanges.Keys | Sort-Object)
  if ((Compare-Object -ReferenceObject $apExpectedLogicalIds -DifferenceObject $apActualLogicalIds).Count -ne 0) {
    throw 'CREATE change set does not contain the exact expected logical-resource set.'
  }
  $apSanitizedChanges = @($ChangeSet.Changes | ForEach-Object {
    $apResource = $_.ResourceChange
    if ($_.Type -ne 'Resource' -or !$apExpectedChanges.Contains($apResource.LogicalResourceId) -or
      $apExpectedChanges[$apResource.LogicalResourceId] -ne $apResource.ResourceType -or
      $apResource.Action -ne 'Add' -or $null -ne $apResource.Replacement -or
      $apResource.Scope.Count -ne 0 -or $apResource.ResourceType -like 'AWS::IAM::*') {
      throw 'CREATE change set contains an unexpected action, type, replacement, import, scope, or IAM resource.'
    }
    [ordered]@{
      logicalResourceId = $apResource.LogicalResourceId
      resourceType = $apResource.ResourceType
      changeType = $_.Type
      action = $apResource.Action
      replacement = $null
      scope = @()
    }
  } | Sort-Object logicalResourceId)
  [ordered]@{
    schemaVersion = 3
    approvedCommitSha = $apApprovedSha
    approvedTreeOid = $apApprovedTree
    approvedTemplateBlobOid = $apApprovedTemplateBlob
    reviewedTemplateBodySha256 = $apReviewedTemplateBodySha256
    reviewedNormalizedTemplateSha256 = $apReviewedNormalizedTemplateSha256
    changeSetId = $apChangeSetId
    stackId = $apStackId
    stackName = $apStackName
    region = $apRegion
    governedCreateRequestSha256 = $apGovernedCreateRequestSha256
    requestedChangeSetType = $apGovernedCreateRequest.changeSetType
    status = $ChangeSet.Status
    executionStatus = $ChangeSet.ExecutionStatus
    terminationProtectionEnabled = $TerminationProtectionEnabled
    capabilities = @($ChangeSet.Capabilities)
    parameters = @($ChangeSet.Parameters)
    includeNestedStacks = $apIncludeNestedStacks
    importExistingResources = $apImportExistingResources
    changes = $apSanitizedChanges
  }
}

function Get-Utf8Sha256 {
  param([Parameter(Mandatory)] [string] $Text)
  $apBytes = [Text.Encoding]::UTF8.GetBytes($Text)
  try {
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($apBytes)).ToLowerInvariant()
  } finally {
    [Array]::Clear($apBytes, 0, $apBytes.Length)
  }
}

function Assert-GovernedFoundationCreateRequest {
  $apCurrentCreateRequestJson = $apGovernedCreateRequest | ConvertTo-Json -Depth 10 -Compress
  $apCurrentCreateRequestSha256 = Get-Utf8Sha256 -Text $apCurrentCreateRequestJson
  if ($apGovernedCreateRequest.schemaVersion -ne 1 -or
    $apGovernedCreateRequest.apiAction -ne 'CreateChangeSet' -or
    $apGovernedCreateRequest.stackName -ne $apStackName -or
    $apGovernedCreateRequest.changeSetName -ne $apChangeSetName -or
    $apGovernedCreateRequest.changeSetType -ne 'CREATE' -or
    $apGovernedCreateRequest.onStackFailure -ne 'ROLLBACK' -or
    $apGovernedCreateRequest.includeNestedStacks -ne $false -or
    $apGovernedCreateRequest.importExistingResources -ne $false -or
    $apGovernedCreateRequest.capabilities.Count -ne 0 -or
    $apGovernedCreateRequest.parameters.Count -ne 0 -or
    $apGovernedCreateRequest.resourcesToImport.Count -ne 0 -or
    $apCurrentCreateRequestSha256 -ne $apGovernedCreateRequestSha256 -or
    !(Test-Path -LiteralPath $apGovernedCreateRequestPath -PathType Leaf) -or
    !((Get-Item -LiteralPath $apGovernedCreateRequestPath).Attributes -band [IO.FileAttributes]::ReadOnly) -or
    [IO.File]::ReadAllText($apGovernedCreateRequestPath, [Text.UTF8Encoding]::new($false)) -cne $apCurrentCreateRequestJson -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $apGovernedCreateRequestPath).Hash.ToLowerInvariant() -ne $apGovernedCreateRequestSha256) {
    throw 'Immutable governed CREATE request is missing, changed, or not CREATE-only.'
  }
}

function Remove-UnexecutedFoundationCreate {
  param(
    [Parameter(Mandatory)] [string] $ChangeSetId,
    [Parameter(Mandatory)] [string] $StackId
  )
  Assert-GovernedFoundationCreateRequest
  $apDeleteState = (& $apAws cloudformation describe-change-set --profile $apProfile --region $apRegion --change-set-name $ChangeSetId --output json | ConvertFrom-Json)
  $apSafelyUnexecuted = ($apDeleteState.Status -eq 'CREATE_COMPLETE' -and $apDeleteState.ExecutionStatus -eq 'AVAILABLE') -or
    ($apDeleteState.Status -eq 'FAILED' -and $apDeleteState.ExecutionStatus -eq 'UNAVAILABLE')
  if ($LASTEXITCODE -ne 0 -or $apDeleteState.ChangeSetId -ne $ChangeSetId -or $apDeleteState.StackId -ne $StackId -or
    $ChangeSetId -ne $apChangeSetId -or $StackId -ne $apStackId -or
    $apDeleteState.StackName -ne $apGovernedCreateRequest.stackName -or
    $apDeleteState.ChangeSetName -ne $apGovernedCreateRequest.changeSetName -or
    $apDeleteState.Description -ne $apGovernedCreateRequest.description -or
    $apDeleteState.OnStackFailure -ne $apGovernedCreateRequest.onStackFailure -or !$apSafelyUnexecuted) {
    throw 'Exact unexecuted CREATE change set is not in a safely deletable state.'
  }
  $apPlaceholder = (& $apAws cloudformation describe-stacks --profile $apProfile --region $apRegion --stack-name $StackId --output json | ConvertFrom-Json).Stacks[0]
  $apPlaceholderResources = (& $apAws cloudformation list-stack-resources --profile $apProfile --region $apRegion --stack-name $StackId --output json | ConvertFrom-Json).StackResourceSummaries
  if ($LASTEXITCODE -ne 0 -or $apPlaceholder.StackId -ne $StackId -or $apPlaceholder.StackStatus -ne 'REVIEW_IN_PROGRESS' -or
    $apPlaceholderResources.Count -ne 0) {
    throw 'Exact REVIEW_IN_PROGRESS placeholder is not empty; cleanup stopped.'
  }
  if ($apDeleteState.Status -eq 'CREATE_COMPLETE') {
    $null = Get-FoundationChangeSetReceipt -ChangeSet $apDeleteState -TerminationProtectionEnabled ([bool]$apPlaceholder.EnableTerminationProtection)
  }
  & $apAws cloudformation delete-change-set --profile $apProfile --region $apRegion --change-set-name $ChangeSetId
  if ($LASTEXITCODE -ne 0) { throw 'Exact unexecuted CREATE change set deletion failed.' }
  $apRemainingChangeSets = (& $apAws cloudformation list-change-sets --profile $apProfile --region $apRegion --stack-name $StackId --output json | ConvertFrom-Json).Summaries
  if ($LASTEXITCODE -ne 0 -or ($apRemainingChangeSets | Where-Object ChangeSetId -eq $ChangeSetId).Count -ne 0) {
    throw 'Could not prove exact change-set deletion; placeholder cleanup stopped.'
  }
  $apPlaceholder = (& $apAws cloudformation describe-stacks --profile $apProfile --region $apRegion --stack-name $StackId --output json | ConvertFrom-Json).Stacks[0]
  $apPlaceholderResources = (& $apAws cloudformation list-stack-resources --profile $apProfile --region $apRegion --stack-name $StackId --output json | ConvertFrom-Json).StackResourceSummaries
  if ($LASTEXITCODE -ne 0 -or $apPlaceholder.StackId -ne $StackId -or $apPlaceholder.StackStatus -ne 'REVIEW_IN_PROGRESS' -or
    $apPlaceholderResources.Count -ne 0) {
    throw 'Empty placeholder changed after change-set deletion; stack cleanup stopped.'
  }
  if ($apPlaceholder.EnableTerminationProtection -eq $true) {
    $apDisableResult = (& $apAws cloudformation update-termination-protection --profile $apProfile --region $apRegion --stack-name $StackId --no-enable-termination-protection --output json | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or $apDisableResult.StackId -ne $StackId) {
      throw 'Could not disable protection on the exact empty placeholder; stack deletion stopped.'
    }
  }
  & $apAws cloudformation delete-stack --profile $apProfile --region $apRegion --stack-name $StackId
  if ($LASTEXITCODE -ne 0) { throw 'Exact empty placeholder deletion request failed.' }
  & $apAws cloudformation wait stack-delete-complete --profile $apProfile --region $apRegion --stack-name $StackId
  if ($LASTEXITCODE -ne 0) { throw 'Exact empty placeholder deletion was not proven complete.' }
}

$apChangeSetName = "applypack-staging-foundation-create-$($apApprovedSha.Substring(0, 12))"
$apCreateTagArguments = @(
  'Key=Application,Value=ApplyPack',
  'Key=Environment,Value=staging',
  'Key=ManagedBy,Value=CloudFormation'
)
$apGovernedCreateRequest = [ordered]@{
  schemaVersion = 1
  apiAction = 'CreateChangeSet'
  approvedCommitSha = $apApprovedSha
  approvedTreeOid = $apApprovedTree
  approvedTemplateBlobOid = $apApprovedTemplateBlob
  reviewedTemplateBodySha256 = $apReviewedTemplateBodySha256
  reviewedNormalizedTemplateSha256 = $apReviewedNormalizedTemplateSha256
  stackName = $apStackName
  changeSetName = $apChangeSetName
  changeSetType = 'CREATE'
  description = "ApplyPack staging foundation exact commit $apApprovedSha"
  onStackFailure = 'ROLLBACK'
  includeNestedStacks = $false
  importExistingResources = $false
  capabilities = @()
  parameters = @()
  resourcesToImport = @()
  tags = @($apCreateTagArguments)
}
$apGovernedCreateRequestJson = $apGovernedCreateRequest | ConvertTo-Json -Depth 10 -Compress
$apGovernedCreateRequestSha256 = Get-Utf8Sha256 -Text $apGovernedCreateRequestJson
$apGovernedCreateRequestPath = Join-Path $apEvidenceDirectory 'aws-staging-foundation-create-request.json'
[IO.File]::WriteAllText($apGovernedCreateRequestPath, $apGovernedCreateRequestJson, [Text.UTF8Encoding]::new($false))
[IO.File]::SetAttributes($apGovernedCreateRequestPath, [IO.FileAttributes]::ReadOnly)
Assert-GovernedFoundationCreateRequest
$apCreateChangeSet = (& $apAws cloudformation create-change-set `
  --profile $apProfile `
  --region $apRegion `
  --stack-name $apGovernedCreateRequest.stackName `
  --change-set-name $apGovernedCreateRequest.changeSetName `
  --change-set-type $apGovernedCreateRequest.changeSetType `
  --description $apGovernedCreateRequest.description `
  --template-body $apReviewedTemplateUri `
  --on-stack-failure $apGovernedCreateRequest.onStackFailure `
  --no-include-nested-stacks `
  --no-import-existing-resources `
  --tags $apCreateTagArguments `
  --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $apCreateChangeSet.Id -notmatch '^arn:aws:cloudformation:us-east-1:838445019912:changeSet/' -or
  $apCreateChangeSet.StackId -notmatch '^arn:aws:cloudformation:us-east-1:838445019912:stack/applypack-staging-foundation/') {
  throw 'Reviewed CREATE change-set request failed or returned the wrong identity.'
}
$apChangeSetId = $apCreateChangeSet.Id
$apStackId = $apCreateChangeSet.StackId

& $apAws cloudformation wait change-set-create-complete --profile $apProfile --region $apRegion --change-set-name $apChangeSetId
if ($LASTEXITCODE -ne 0) {
  $apFailedChangeSet = (& $apAws cloudformation describe-change-set --profile $apProfile --region $apRegion --change-set-name $apChangeSetId --output json | ConvertFrom-Json)
  if ($LASTEXITCODE -eq 0 -and $apFailedChangeSet.ChangeSetId -eq $apChangeSetId -and $apFailedChangeSet.StackId -eq $apStackId -and
    $apFailedChangeSet.Status -eq 'FAILED' -and $apFailedChangeSet.ExecutionStatus -eq 'UNAVAILABLE') {
    Remove-UnexecutedFoundationCreate -ChangeSetId $apChangeSetId -StackId $apStackId
  }
  throw 'CREATE change set did not become reviewable. Do not execute or retry blindly.'
}

$apChangeSet = (& $apAws cloudformation describe-change-set --profile $apProfile --region $apRegion --change-set-name $apChangeSetId --output json | ConvertFrom-Json)
$apPlaceholder = (& $apAws cloudformation describe-stacks --profile $apProfile --region $apRegion --stack-name $apStackId --output json | ConvertFrom-Json).Stacks[0]
$apPlaceholderResources = (& $apAws cloudformation list-stack-resources --profile $apProfile --region $apRegion --stack-name $apStackId --output json | ConvertFrom-Json).StackResourceSummaries
if ($LASTEXITCODE -ne 0 -or $apPlaceholder.StackId -ne $apStackId -or $apPlaceholder.StackStatus -ne 'REVIEW_IN_PROGRESS' -or
  $apPlaceholderResources.Count -ne 0) {
  throw 'CREATE change set did not yield the exact empty REVIEW_IN_PROGRESS stack.'
}
$apEnableResult = (& $apAws cloudformation update-termination-protection --profile $apProfile --region $apRegion --stack-name $apStackId --enable-termination-protection --output json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $apEnableResult.StackId -ne $apStackId) {
  Remove-UnexecutedFoundationCreate -ChangeSetId $apChangeSetId -StackId $apStackId
  throw 'Termination protection could not be enabled on the exact empty stack; plan was not executed.'
}
$apProtectedPlaceholder = (& $apAws cloudformation describe-stacks --profile $apProfile --region $apRegion --stack-name $apStackId --output json | ConvertFrom-Json).Stacks[0]
if ($LASTEXITCODE -ne 0 -or $apProtectedPlaceholder.StackId -ne $apStackId -or
  $apProtectedPlaceholder.StackStatus -ne 'REVIEW_IN_PROGRESS' -or $apProtectedPlaceholder.EnableTerminationProtection -ne $true) {
  Remove-UnexecutedFoundationCreate -ChangeSetId $apChangeSetId -StackId $apStackId
  throw 'Termination protection was not proven on the exact empty stack; plan was not executed.'
}

$apChangeSetReceipt = Get-FoundationChangeSetReceipt -ChangeSet $apChangeSet -TerminationProtectionEnabled $true
$apChangeSetReceiptJson = $apChangeSetReceipt | ConvertTo-Json -Depth 10 -Compress
$apChangeSetReceiptPath = Join-Path $apEvidenceDirectory 'aws-staging-foundation-change-set-receipt.json'
[IO.File]::WriteAllText($apChangeSetReceiptPath, $apChangeSetReceiptJson, [Text.UTF8Encoding]::new($false))
[IO.File]::SetAttributes($apChangeSetReceiptPath, [IO.FileAttributes]::ReadOnly)
$apChangeSetReceiptSha256 = Get-Utf8Sha256 -Text $apChangeSetReceiptJson
if ($apChangeSetReceiptSha256 -notmatch '^[a-f0-9]{64}$' -or
  (Get-FileHash -Algorithm SHA256 -LiteralPath $apChangeSetReceiptPath).Hash.ToLowerInvariant() -ne $apChangeSetReceiptSha256) {
  throw 'Sanitized change-set receipt hash is missing or inconsistent.'
}
```

Stop here for independent review. Each supervisor must review the provider plan and return the exact receipt SHA-256 through the approved channel. If either rejects it, invoke only `Remove-UnexecutedFoundationCreate` with the exact IDs. That helper re-proves the unexecuted change-set state, the empty `REVIEW_IN_PROGRESS` placeholder, and zero resources; it then deletes the change set, disables protection only on that exact empty placeholder if necessary, deletes that placeholder, and waits for deletion. Never use it after execution starts or when any resource exists.

```powershell
$apSupervisorOneApprovedChangeSetReceiptSha256 = '<supervisor-one-approved-64-character-receipt-sha256>'
$apSupervisorTwoApprovedChangeSetReceiptSha256 = '<supervisor-two-approved-64-character-receipt-sha256>'

$apExecuteState = (& $apAws cloudformation describe-change-set --profile $apProfile --region $apRegion --change-set-name $apChangeSetId --output json | ConvertFrom-Json)
$apExecutePlaceholder = (& $apAws cloudformation describe-stacks --profile $apProfile --region $apRegion --stack-name $apStackId --output json | ConvertFrom-Json).Stacks[0]
$apExecuteResources = (& $apAws cloudformation list-stack-resources --profile $apProfile --region $apRegion --stack-name $apStackId --output json | ConvertFrom-Json).StackResourceSummaries
if ($LASTEXITCODE -ne 0 -or $apExecutePlaceholder.StackId -ne $apStackId -or
  $apExecutePlaceholder.StackStatus -ne 'REVIEW_IN_PROGRESS' -or $apExecutePlaceholder.EnableTerminationProtection -ne $true -or
  $apExecuteResources.Count -ne 0) {
  throw 'Exact protected empty stack is no longer ready for execution.'
}
$apExecuteReceipt = Get-FoundationChangeSetReceipt -ChangeSet $apExecuteState -TerminationProtectionEnabled $true
$apExecuteReceiptJson = $apExecuteReceipt | ConvertTo-Json -Depth 10 -Compress
$apExecuteReceiptSha256 = Get-Utf8Sha256 -Text $apExecuteReceiptJson
$apStoredReceiptJson = [IO.File]::ReadAllText($apChangeSetReceiptPath, [Text.UTF8Encoding]::new($false))
$apStoredReceiptSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $apChangeSetReceiptPath).Hash.ToLowerInvariant()
if ($apExecuteReceiptJson -cne $apChangeSetReceiptJson -or $apStoredReceiptJson -cne $apExecuteReceiptJson -or
  $apExecuteReceiptSha256 -ne $apChangeSetReceiptSha256 -or $apStoredReceiptSha256 -ne $apExecuteReceiptSha256) {
  throw 'Change-set receipt changed after review. Do not execute.'
}
if ($apSupervisorOneApprovedChangeSetReceiptSha256 -ne $apExecuteReceiptSha256 -or
  $apSupervisorTwoApprovedChangeSetReceiptSha256 -ne $apExecuteReceiptSha256) {
  throw 'Two independent approvals no longer match the exact current change-set receipt.'
}
& $apAws cloudformation execute-change-set --profile $apProfile --region $apRegion --change-set-name $apChangeSetId
if ($LASTEXITCODE -ne 0) { throw 'Exact approved CREATE change set did not execute.' }
& $apAws cloudformation wait stack-create-complete --profile $apProfile --region $apRegion --stack-name $apStackId
if ($LASTEXITCODE -ne 0) { throw 'Staging foundation did not complete safely.' }
$apCreatedStack = (& $apAws cloudformation describe-stacks --profile $apProfile --region $apRegion --stack-name $apStackId --output json | ConvertFrom-Json).Stacks[0]
if ($LASTEXITCODE -ne 0 -or $apCreatedStack.StackId -ne $apStackId -or $apCreatedStack.StackStatus -ne 'CREATE_COMPLETE' -or
  $apCreatedStack.EnableTerminationProtection -ne $true) {
  throw 'Final stack identity, state, or termination-protection assertion failed.'
}
```

For a rejected or abandoned unexecuted plan, run only the guarded cleanup below, record the sanitized result, and repeat the stack/alias/key/VPC orphan scan. It refuses any non-CREATE plan, any started execution, any stack outside `REVIEW_IN_PROGRESS`, or any placeholder containing resources.

```powershell
Remove-UnexecutedFoundationCreate -ChangeSetId $apChangeSetId -StackId $apStackId
```

Do not request IAM capabilities; this foundation intentionally creates no IAM resource. Disabling termination protection is permitted only inside the guarded zero-resource placeholder cleanup above, never for a created foundation or an update. Any replacement of the retained KMS key requires a separate ciphertext migration and deletion review.

## Provider template receipt

Immediately after a successful create, fetch the provider's original template, validate it through the same deterministic parser, and compare normalized hashes. This detects path substitution and provider-template drift while retaining the exact extracted-body hash as provenance.

```powershell
$apProviderEnvelopeJson = & $apAws cloudformation get-template --profile $apProfile --region $apRegion --stack-name $apStackId --template-stage Original --output json
if ($LASTEXITCODE -ne 0 -or !$apProviderEnvelopeJson) { throw 'Provider template retrieval failed.' }
$apProviderEnvelope = $apProviderEnvelopeJson | ConvertFrom-Json
if ($null -eq $apProviderEnvelope.TemplateBody) { throw 'Provider template body is missing.' }
$apProviderTemplateText = if ($apProviderEnvelope.TemplateBody -is [string]) {
  $apProviderEnvelope.TemplateBody
} else {
  $apProviderEnvelope.TemplateBody | ConvertTo-Json -Depth 100
}
$apProviderTemplatePath = Join-Path $apEvidenceDirectory 'provider-template.yaml'
[IO.File]::WriteAllText($apProviderTemplatePath, $apProviderTemplateText, [Text.UTF8Encoding]::new($false))
[IO.File]::SetAttributes($apProviderTemplatePath, [IO.FileAttributes]::ReadOnly)
$apProviderTemplateBodySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $apProviderTemplatePath).Hash.ToLowerInvariant()
$apProviderNormalizedLine = (node $apValidatorPath --template $apProviderTemplatePath --print-template-sha256).Trim()
if ($LASTEXITCODE -ne 0 -or $apProviderNormalizedLine -notmatch '^AWS_STAGING_FOUNDATION_TEMPLATE_SHA256=([a-f0-9]{64})$') {
  throw 'Provider template failed deterministic validation.'
}
$apProviderNormalizedTemplateSha256 = $Matches[1]
if ($apProviderTemplateBodySha256 -ne $apReviewedTemplateBodySha256) { throw 'Provider original template bytes differ from the exact reviewed template.' }
if ($apProviderNormalizedTemplateSha256 -ne $apReviewedNormalizedTemplateSha256) { throw 'Provider template differs from the exact reviewed template.' }

$apReceipt = [ordered]@{
  schemaVersion = 1
  approvedCommitSha = $apApprovedSha
  approvedTreeOid = $apApprovedTree
  approvedTemplateBlobOid = $apApprovedTemplateBlob
  reviewedTemplateBodySha256 = $apReviewedTemplateBodySha256
  reviewedNormalizedTemplateSha256 = $apReviewedNormalizedTemplateSha256
  providerTemplateBodySha256 = $apProviderTemplateBodySha256
  providerNormalizedTemplateSha256 = $apProviderNormalizedTemplateSha256
  stackId = $apStackId
  stackName = $apStackName
  region = $apRegion
}
$apReceiptPath = Join-Path $apEvidenceDirectory 'aws-staging-foundation-template-receipt.json'
[IO.File]::WriteAllText($apReceiptPath, ($apReceipt | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
[IO.File]::SetAttributes($apReceiptPath, [IO.FileAttributes]::ReadOnly)
$apReceiptSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $apReceiptPath).Hash.ToLowerInvariant()
if ($apReceiptSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Provider template receipt hash is missing.' }
```

The receipt contains no credentials, template parameters, customer data, subscriber addresses, or secret values. Preserve it outside Git with the review evidence.

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

On create failure, preserve sanitized CloudFormation events for review and do not retry blindly. `DeletionPolicy: RetainExceptOnCreate` tells CloudFormation to delete resources created by a failed initial stack operation instead of retaining an enabled orphan. For KMS, that delete schedules the key as `PendingDeletion`; it is not immediate. The validator and negative tests enforce `RetainExceptOnCreate` offline. After a successful create, `RetainExceptOnCreate` behaves like `Retain`, and `UpdateReplacePolicy: Retain` preserves a replaced key.

`PendingWindowInDays: 30` supplies the waiting period when CloudFormation deletes this key. It does not globally force every deletion request to 30 days. A separately authorized caller invoking `ScheduleKeyDeletion` directly can choose any AWS-allowed waiting period between 7 and 30 days. Preventing that requires IAM/SCP controls outside this template; never represent the template property as account-wide enforcement.

After an initial create rollback, repeat the exact stack, alias, key, and VPC scans from the collision preflight. The stack, alias, and VPC must be absent. A matching key may remain visible only as `PendingDeletion` with a deletion date; an enabled, disabled, or otherwise retained matching key is an orphan and blocks all retry work. Preserve sanitized evidence and escalate rather than changing the alias or CIDR to bypass a collision.

Deleting a successfully created stack later retains the key. Scheduling that retained key for deletion requires separate authorization, proof that no staging ciphertext or backup still depends on it, and a reviewed recovery plan. Never repurpose this staging key or network for production.

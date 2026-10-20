$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Repository root unavailable.' }
$runbookPath = Join-Path $repo 'docs\runbooks\AWS_STAGING_FOUNDATION.md'
$validatorPath = Join-Path $repo 'scripts\validate-aws-staging-foundation-template.mjs'
$sourceTemplatePath = Join-Path $repo 'infra\aws\staging-foundation\template.yaml'
$runbook = [IO.File]::ReadAllText($runbookPath)
$controlMatch = [regex]::Match(
  $runbook,
  '(?s)# APPLYPACK_FOUNDATION_CONTROL_FUNCTIONS_BEGIN\r?\n(.*?)# APPLYPACK_FOUNDATION_CONTROL_FUNCTIONS_END'
)
if (!$controlMatch.Success) { throw 'Foundation control functions are not extractable from the runbook.' }
Invoke-Expression $controlMatch.Groups[1].Value

function Assert-Throws {
  param(
    [Parameter(Mandatory)] [scriptblock] $Action,
    [Parameter(Mandatory)] [string] $Label
  )
  $threw = $false
  try { & $Action } catch { $threw = $true }
  if (!$threw) { throw "Expected fail-closed rejection: $Label" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) "applypack-foundation-controls-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $work | Out-Null
$apGovernedCreateRequestPath = $null
try {
  $apApprovedSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  $apApprovedTree = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  $apApprovedTemplateBlob = 'cccccccccccccccccccccccccccccccccccccccc'
  $apProfile = 'parallel-variable-must-not-drive-create-args'
  $apRegion = 'parallel-variable-must-not-drive-create-args'
  $apStackName = 'applypack-staging-foundation'
  $apChangeSetName = "applypack-staging-foundation-create-$($apApprovedSha.Substring(0, 12))"
  $apChangeSetId = 'arn:aws:cloudformation:us-east-1:838445019912:changeSet/test/00000000-0000-0000-0000-000000000000'
  $apStackId = 'arn:aws:cloudformation:us-east-1:838445019912:stack/applypack-staging-foundation/00000000-0000-0000-0000-000000000000'
  $apValidatorPath = $validatorPath
  $apReviewedTemplatePath = Join-Path $work 'reviewed-template.yaml'
  [IO.File]::WriteAllBytes($apReviewedTemplatePath, [IO.File]::ReadAllBytes($sourceTemplatePath))
  $templateBytes = [IO.File]::ReadAllBytes($apReviewedTemplatePath)
  $apReviewedTemplateUri = 'file://' + ($apReviewedTemplatePath -replace '\\', '/')
  $apReviewedTemplateBodySha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $apReviewedTemplatePath).Hash.ToLowerInvariant()
  $normalizedLine = (node $apValidatorPath --template $apReviewedTemplatePath --print-template-sha256).Trim()
  if ($LASTEXITCODE -ne 0 -or $normalizedLine -notmatch '^AWS_STAGING_FOUNDATION_TEMPLATE_SHA256=([a-f0-9]{64})$') {
    throw 'Controlled template normalization failed.'
  }
  $apReviewedNormalizedTemplateSha256 = $Matches[1]
  $apGovernedCreateRequest = [ordered]@{
    schemaVersion = 2
    apiAction = 'CreateChangeSet'
    profile = 'applypack-staging'
    region = 'us-east-1'
    expectedAccount = '838445019912'
    expectedArn = 'arn:aws:iam::838445019912:user/applypack-staging-operator'
    approvedCommitSha = $apApprovedSha
    approvedTreeOid = $apApprovedTree
    approvedTemplateBlobOid = $apApprovedTemplateBlob
    reviewedTemplatePath = $apReviewedTemplatePath
    templateUri = $apReviewedTemplateUri
    reviewedTemplateBodySha256 = $apReviewedTemplateBodySha256
    reviewedNormalizedTemplateSha256 = $apReviewedNormalizedTemplateSha256
    stackName = $apStackName
    changeSetName = $apChangeSetName
    clientToken = "applypack-foundation-$($apApprovedSha.Substring(0, 32))"
    changeSetType = 'CREATE'
    description = "ApplyPack staging foundation exact commit $apApprovedSha"
    onStackFailure = 'ROLLBACK'
    includeNestedStacks = $false
    importExistingResources = $false
    capabilities = @()
    parameters = @()
    resourcesToImport = @()
    deploymentMode = $null
    deploymentConfig = $null
    tags = @(
      'Key=Application,Value=ApplyPack',
      'Key=Environment,Value=staging',
      'Key=ManagedBy,Value=CloudFormation'
    )
  }
  $apGovernedCreateRequestJson = $apGovernedCreateRequest | ConvertTo-Json -Depth 10 -Compress
  $apGovernedCreateRequestSha256 = Get-Utf8Sha256 -Text $apGovernedCreateRequestJson
  $apGovernedCreateRequestPath = Join-Path $work 'aws-staging-foundation-create-request.json'
  [IO.File]::WriteAllText($apGovernedCreateRequestPath, $apGovernedCreateRequestJson, [Text.UTF8Encoding]::new($false))
  [IO.File]::SetAttributes($apGovernedCreateRequestPath, [IO.FileAttributes]::ReadOnly)

  Assert-GovernedFoundationCreateRequest
  $identity = [pscustomobject]@{ Account = $apGovernedCreateRequest.expectedAccount; Arn = $apGovernedCreateRequest.expectedArn }
  $null = Assert-GovernedFoundationIdentityAndTemplate -Identity $identity
  $arguments = @(Get-GovernedFoundationCreateChangeSetArguments)
  if ($arguments -contains $apProfile -or $arguments -contains $apRegion -or
    $arguments -notcontains $apGovernedCreateRequest.profile -or $arguments -notcontains $apGovernedCreateRequest.templateUri) {
    throw 'CreateChangeSet arguments were not sourced exclusively from the governed request.'
  }

  $emptyCredentialEnvironment = @{
    AWS_ACCESS_KEY_ID = $null
    AWS_SECRET_ACCESS_KEY = $null
    AWS_SESSION_TOKEN = $null
    AWS_PROFILE = $null
    AWS_DEFAULT_PROFILE = $null
  }
  $credentialPosture = Assert-FoundationBrowserLoginCredentialPosture `
    -LoginSession $apGovernedCreateRequest.expectedArn `
    -ConfiguredRegion $apGovernedCreateRequest.region `
    -ExpectedArn $apGovernedCreateRequest.expectedArn `
    -ExpectedRegion $apGovernedCreateRequest.region `
    -StaticAccessKeyConfigured $false `
    -StaticSecretKeyConfigured $false `
    -StaticSessionTokenConfigured $false `
    -ProcessEnvironment $emptyCredentialEnvironment
  if ($credentialPosture.credentialSource -ne 'aws-login-browser-temporary' -or
    $credentialPosture.staticCredentialKeyCount -ne 0 -or $credentialPosture.processCredentialOverrideCount -ne 0) {
    throw 'Controlled browser-login credential posture receipt is invalid.'
  }
  Assert-Throws -Label 'wrong browser login_session identity' -Action {
    $null = Assert-FoundationBrowserLoginCredentialPosture -LoginSession 'arn:aws:iam::838445019912:user/wrong' `
      -ConfiguredRegion $apGovernedCreateRequest.region -ExpectedArn $apGovernedCreateRequest.expectedArn `
      -ExpectedRegion $apGovernedCreateRequest.region -StaticAccessKeyConfigured $false `
      -StaticSecretKeyConfigured $false -StaticSessionTokenConfigured $false -ProcessEnvironment $emptyCredentialEnvironment
  }
  Assert-Throws -Label 'static profile credential key' -Action {
    $null = Assert-FoundationBrowserLoginCredentialPosture -LoginSession $apGovernedCreateRequest.expectedArn `
      -ConfiguredRegion $apGovernedCreateRequest.region -ExpectedArn $apGovernedCreateRequest.expectedArn `
      -ExpectedRegion $apGovernedCreateRequest.region -StaticAccessKeyConfigured $true `
      -StaticSecretKeyConfigured $false -StaticSessionTokenConfigured $false -ProcessEnvironment $emptyCredentialEnvironment
  }
  $overriddenCredentialEnvironment = @{} + $emptyCredentialEnvironment
  $overriddenCredentialEnvironment.AWS_PROFILE = 'unexpected-profile'
  Assert-Throws -Label 'process credential override' -Action {
    $null = Assert-FoundationBrowserLoginCredentialPosture -LoginSession $apGovernedCreateRequest.expectedArn `
      -ConfiguredRegion $apGovernedCreateRequest.region -ExpectedArn $apGovernedCreateRequest.expectedArn `
      -ExpectedRegion $apGovernedCreateRequest.region -StaticAccessKeyConfigured $false `
      -StaticSecretKeyConfigured $false -StaticSessionTokenConfigured $false -ProcessEnvironment $overriddenCredentialEnvironment
  }

  $apGovernedCreateRequest.tags[0] = 'Key=Application,Value=Tampered'
  Assert-Throws -Label 'request tag tamper' -Action { Assert-GovernedFoundationCreateRequest }
  $apGovernedCreateRequest.tags[0] = 'Key=Application,Value=ApplyPack'
  [IO.File]::AppendAllText($apReviewedTemplatePath, "`n# raw-byte divergence", [Text.UTF8Encoding]::new($false))
  Assert-Throws -Label 'fresh template raw hash divergence' -Action { $null = Assert-GovernedFoundationIdentityAndTemplate -Identity $identity }
  [IO.File]::WriteAllBytes($apReviewedTemplatePath, $templateBytes)

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
  $changes = @($apExpectedChanges.GetEnumerator() | ForEach-Object {
    [pscustomobject]@{
      Type = 'Resource'
      ResourceChange = [pscustomobject]@{
        LogicalResourceId = $_.Key
        ResourceType = $_.Value
        Action = 'Add'
        Replacement = $null
        Scope = @()
      }
    }
  })
  $tags = @($apGovernedCreateRequest.tags | ForEach-Object {
    $parts = $_ -split ',', 2
    [pscustomobject]@{ Key = $parts[0].Substring(4); Value = $parts[1].Substring(6) }
  })
  # Optional nullable provider fields are deliberately absent in this controlled response.
  $changeSet = [pscustomobject]@{
    ChangeSetId = $apChangeSetId
    StackId = $apStackId
    StackName = $apGovernedCreateRequest.stackName
    ChangeSetName = $apGovernedCreateRequest.changeSetName
    Description = $apGovernedCreateRequest.description
    OnStackFailure = $apGovernedCreateRequest.onStackFailure
    Status = 'CREATE_COMPLETE'
    ExecutionStatus = 'AVAILABLE'
    Capabilities = @()
    Parameters = @()
    Tags = $tags
    Changes = $changes
  }
  $providerTemplateReceipt = [ordered]@{
    bodySha256 = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    normalizedSha256 = $apReviewedNormalizedTemplateSha256
  }
  $receiptOne = Get-FoundationChangeSetReceipt -ChangeSet $changeSet -TerminationProtectionEnabled $true -ProviderTemplateReceipt $providerTemplateReceipt
  $receiptTwo = Get-FoundationChangeSetReceipt -ChangeSet $changeSet -TerminationProtectionEnabled $true -ProviderTemplateReceipt $providerTemplateReceipt
  $receiptOneJson = $receiptOne | ConvertTo-Json -Depth 10 -Compress
  $receiptTwoJson = $receiptTwo | ConvertTo-Json -Depth 10 -Compress
  if ($receiptOneJson -cne $receiptTwoJson -or (Get-Utf8Sha256 -Text $receiptOneJson) -ne (Get-Utf8Sha256 -Text $receiptTwoJson)) {
    throw 'Controlled receipt recomputation is not deterministic.'
  }

  $changeSet.Tags[0].Value = 'Tampered'
  Assert-Throws -Label 'provider tag divergence' -Action { $null = Get-FoundationChangeSetReceipt -ChangeSet $changeSet -TerminationProtectionEnabled $true -ProviderTemplateReceipt $providerTemplateReceipt }
  $changeSet.Tags[0].Value = 'ApplyPack'
  $changeSet.Changes[0].ResourceChange.Action = 'Modify'
  Assert-Throws -Label 'non-Add provider plan' -Action { $null = Get-FoundationChangeSetReceipt -ChangeSet $changeSet -TerminationProtectionEnabled $true -ProviderTemplateReceipt $providerTemplateReceipt }
  $changeSet.Changes[0].ResourceChange.Action = 'Add'
  Add-Member -InputObject $changeSet -NotePropertyName DeploymentConfig -NotePropertyValue ([pscustomobject]@{ Unsafe = $true })
  Assert-Throws -Label 'non-null deployment configuration' -Action { $null = Get-FoundationChangeSetReceipt -ChangeSet $changeSet -TerminationProtectionEnabled $true -ProviderTemplateReceipt $providerTemplateReceipt }
  $changeSet.PSObject.Properties.Remove('DeploymentConfig')
  Assert-NoRemainingFoundationChangeSets -Summaries @()
  Assert-Throws -Label 'remaining change set before placeholder deletion' -Action {
    Assert-NoRemainingFoundationChangeSets -Summaries @([pscustomobject]@{ ChangeSetId = $apChangeSetId })
  }

  'AWS_STAGING_FOUNDATION_CONTROLS_OK'
} finally {
  if ($null -ne $apGovernedCreateRequestPath -and (Test-Path -LiteralPath $apGovernedCreateRequestPath)) {
    [IO.File]::SetAttributes($apGovernedCreateRequestPath, [IO.FileAttributes]::Normal)
  }
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}

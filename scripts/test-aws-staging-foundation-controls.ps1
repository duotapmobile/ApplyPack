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
$legacyMatch = [regex]::Match(
  $runbook,
  '(?s)# APPLYPACK_LEGACY_CLEANUP_FUNCTIONS_BEGIN\r?\n(.*?)# APPLYPACK_LEGACY_CLEANUP_FUNCTIONS_END'
)
if (!$legacyMatch.Success) { throw 'Legacy cleanup functions are not extractable from the runbook.' }
Invoke-Expression $legacyMatch.Groups[1].Value

function Assert-Throws {
  param(
    [Parameter(Mandatory)] [scriptblock] $Action,
    [Parameter(Mandatory)] [string] $Label
  )
  $threw = $false
  try { & $Action } catch { $threw = $true }
  if (!$threw) { throw "Expected fail-closed rejection: $Label" }
}

$colonCredentialListFixture = @(
  '      Name                    Value             Type    Location',
  '      ----                    -----             ----    --------',
  '   profile        applypack-staging           manual    --profile',
  'access_key : ****************AB-CD_/+=. : login : login-session',
  'secret_key : ****************WX.YZ_-+=/ : login : login-session',
  '    region                us-east-1      config-file    mock-config'
) -join "`n"
if ((Get-FoundationConfigureListCredentialType -ConfigureListText $colonCredentialListFixture) -cne 'login') {
  throw 'Colon-delimited credential parser fixture failed.'
}
$compactColonCredentialListFixture = @(
  'access_key:****************AB-CD_:login:login-session',
  ' secret_key  :  ****************WX.YZ+  :  login  :  login-session '
) -join "`n"
if ((Get-FoundationConfigureListCredentialType -ConfigureListText $compactColonCredentialListFixture) -cne 'login') {
  throw 'Colon-spacing credential parser fixture failed.'
}
$legacyCredentialListFixture = @(
  '      Name                    Value             Type    Location',
  '      ----                    -----             ----    --------',
  'access_key     ****************ABCD            login    mock-cache',
  'secret_key     ****************WXYZ            login    mock-cache'
) -join "`n"
if ((Get-FoundationConfigureListCredentialType -ConfigureListText $legacyCredentialListFixture) -cne 'login') {
  throw 'Whitespace-table credential parser fixture failed.'
}
Assert-Throws -Label 'credential parser duplicate row' -Action {
  $null = Get-FoundationConfigureListCredentialType -ConfigureListText ($colonCredentialListFixture + "`naccess_key : ****************EXTRA : login : login-session")
}
Assert-Throws -Label 'credential parser missing row' -Action {
  $null = Get-FoundationConfigureListCredentialType -ConfigureListText 'access_key : ****************ONLY : login : login-session'
}
Assert-Throws -Label 'credential parser malformed colon row' -Action {
  $null = Get-FoundationConfigureListCredentialType -ConfigureListText (@(
    'access_key : ****************ABCD : : login-session',
    'secret_key : ****************WXYZ : login : login-session'
  ) -join "`n")
}
Assert-Throws -Label 'credential parser malformed whitespace row' -Action {
  $null = Get-FoundationConfigureListCredentialType -ConfigureListText (@(
    'access_key ****************ABCD',
    'secret_key ****************WXYZ login mock-cache'
  ) -join "`n")
}
Assert-Throws -Label 'credential parser non-login type' -Action {
  $null = Get-FoundationConfigureListCredentialType -ConfigureListText (@(
    'access_key : ****************ABCD : env : environment',
    'secret_key : ****************WXYZ : login : login-session'
  ) -join "`n")
}

function Reset-ApplyPackMockAws {
  param(
    [Parameter(Mandatory)] [ValidateSet('normal','legacy')] [string] $Mode,
    [Parameter(Mandatory)] [string] $Scenario
  )
  $script:apMockMode = $Mode
  $script:apMockScenario = $Scenario
  $script:apMockChangeSetDeleted = $false
  $script:apMockStackDeleted = $false
  $global:LASTEXITCODE = 0
}

function Invoke-ApplyPackMockAws {
  param([Parameter(ValueFromRemainingArguments=$true)] [object[]] $Arguments)
  $global:LASTEXITCODE = 0
  $service = [string]$Arguments[0]
  $operation = [string]$Arguments[1]
  $changeSetId = if ($script:apMockMode -eq 'legacy') { $apLegacyChangeSetId } else { $apChangeSetId }
  $stackId = if ($script:apMockMode -eq 'legacy') { $apLegacyStackId } else { $apStackId }
  $stackName = if ($script:apMockMode -eq 'legacy') { $apLegacyStackName } else { $apGovernedCreateRequest.stackName }
  $changeSetName = if ($script:apMockMode -eq 'legacy') { $apLegacyChangeSetName } else { $apGovernedCreateRequest.changeSetName }
  $description = if ($script:apMockMode -eq 'legacy') { $apLegacyExpectedDescription } else { $apGovernedCreateRequest.description }

  if ($service -eq 'configure' -and $operation -eq 'list') {
    $credentialType = if ($script:apMockScenario -eq 'credential-non-login') { 'env' } else { 'login' }
    @(
      "      Name                    Value             Type    Location",
      "      ----                    -----             ----    --------",
      "access_key : ****************ABCD : $credentialType : login-session",
      "secret_key : ****************WXYZ : $credentialType : login-session",
      "    region                us-east-1      config-file    mock-config"
    ) -join "`n"
    return
  }
  if ($service -eq 'configure' -and $operation -eq 'get') {
    $key = [string]$Arguments[2]
    if ($key -eq 'login_session') { 'arn:aws:iam::838445019912:user/applypack-staging-operator'; return }
    if ($key -eq 'region') { 'us-east-1'; return }
    if ($script:apMockScenario -eq 'profile-alternate' -and $key -eq 'credential_process') {
      'mock-credential-process'
      return
    }
    $global:LASTEXITCODE = 1
    return
  }
  if ($service -eq 'sts' -and $operation -eq 'get-caller-identity') {
    @{ Account='838445019912'; Arn='arn:aws:iam::838445019912:user/applypack-staging-operator'; UserId='AIDAMOCK' } |
      ConvertTo-Json -Compress
    return
  }
  if ($service -eq 'iam' -and $operation -eq 'list-mfa-devices') {
    [object[]]$devices = @()
    if ($script:apMockScenario -ne 'mfa-count') { $devices = @(@{ SerialNumber='arn:aws:iam::838445019912:mfa/mock' }) }
    @{ MFADevices=$devices } | ConvertTo-Json -Depth 10 -Compress
    return
  }
  if ($service -eq 'iam' -and $operation -eq 'list-access-keys') {
    if ($script:apMockScenario -eq 'access-key-denied') {
      $global:LASTEXITCODE = 254
      'AccessDenied: mock user lacks iam:ListAccessKeys'
      return
    }
    if ($script:apMockScenario -eq 'access-key-present') {
      @{ AccessKeyMetadata=@(@{ AccessKeyId='REDACTED'; Status='Active' }) } | ConvertTo-Json -Depth 10 -Compress
    } else {
      @{ AccessKeyMetadata=@() } | ConvertTo-Json -Depth 10 -Compress
    }
    return
  }
  if ($service -eq 'cloudformation' -and $operation -eq 'describe-change-set') {
    $providerChangeSetId = if ($script:apMockScenario -eq 'foreign-id') {
      'arn:aws:cloudformation:us-east-1:838445019912:changeSet/foreign/ffffffff-ffff-ffff-ffff-ffffffffffff'
    } else { $changeSetId }
    $executionStatus = switch ($script:apMockScenario) {
      'executed-plan' { 'EXECUTE_COMPLETE' }
      'unavailable-plan' { 'UNAVAILABLE' }
      default { 'AVAILABLE' }
    }
    @{
      ChangeSetId=$providerChangeSetId; StackId=$stackId; StackName=$stackName; ChangeSetName=$changeSetName
      Description=$description; OnStackFailure='ROLLBACK'; Status='CREATE_COMPLETE'; ExecutionStatus=$executionStatus
      Capabilities=@(); Parameters=@(); Tags=$script:apMockTags; Changes=$script:apMockChanges
    } | ConvertTo-Json -Depth 20 -Compress
    return
  }
  if ($service -eq 'cloudformation' -and $operation -eq 'list-change-sets') {
    [object[]]$summaries = @()
    if ($script:apMockChangeSetDeleted) {
      if ($script:apMockScenario -eq 'remaining-after') { $summaries = @(@{ ChangeSetId=$changeSetId }) }
    } else {
      $summaries = @(@{ ChangeSetId=$changeSetId })
      if ($script:apMockScenario -eq 'extra-before') { $summaries += @{ ChangeSetId='arn:aws:cloudformation:us-east-1:838445019912:changeSet/extra/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } }
    }
    @{ Summaries=$summaries } | ConvertTo-Json -Depth 10 -Compress
    return
  }
  if ($service -eq 'cloudformation' -and $operation -eq 'describe-stacks') {
    $protection = $script:apMockMode -eq 'normal'
    @{ Stacks=@(@{ StackId=$stackId; StackName=$stackName; StackStatus='REVIEW_IN_PROGRESS'; EnableTerminationProtection=$protection }) } |
      ConvertTo-Json -Depth 10 -Compress
    return
  }
  if ($service -eq 'cloudformation' -and $operation -eq 'list-stack-resources') {
    [object[]]$resources = @()
    if ($script:apMockScenario -eq 'populated-stack') { $resources = @(@{ LogicalResourceId='Unexpected' }) }
    @{ StackResourceSummaries=$resources } | ConvertTo-Json -Depth 10 -Compress
    return
  }
  if ($service -eq 'cloudformation' -and $operation -eq 'get-template') {
    $templateText = [IO.File]::ReadAllText($sourceTemplatePath)
    if ($script:apMockScenario -eq 'template-mismatch') { $templateText = $templateText -replace '10\.84\.0\.0/16','10.85.0.0/16' }
    @{ TemplateBody=$templateText } | ConvertTo-Json -Depth 100 -Compress
    return
  }
  if ($service -eq 'cloudformation' -and $operation -eq 'delete-change-set') {
    $script:apMockChangeSetDeleted = $true
    return
  }
  if ($service -eq 'cloudformation' -and $operation -eq 'update-termination-protection') {
    @{ StackId=$stackId } | ConvertTo-Json -Compress
    return
  }
  if ($service -eq 'cloudformation' -and $operation -eq 'delete-stack') {
    $script:apMockStackDeleted = $true
    return
  }
  if ($service -eq 'cloudformation' -and $operation -eq 'wait') { return }
  if ($service -eq 'cloudformation' -and $operation -eq 'list-stacks') {
    @{ StackSummaries=@() } | ConvertTo-Json -Compress
    return
  }
  throw "Unexpected mocked AWS command: $($Arguments -join ' ')"
}

$work = Join-Path ([IO.Path]::GetTempPath()) "applypack-foundation-controls-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $work | Out-Null
$apGovernedCreateRequestPath = $null
$savedAwsEnvironment = $null
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
  $emptyCredentialEnvironment = @{}
  foreach ($overrideName in @(
    'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_PROFILE','AWS_DEFAULT_PROFILE',
    'AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE','AWS_ROLE_ARN','AWS_WEB_IDENTITY_TOKEN_FILE','AWS_ROLE_SESSION_NAME',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI','AWS_CONTAINER_CREDENTIALS_FULL_URI','AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE','AWS_ENDPOINT_URL','AWS_ENDPOINT_URL_CLOUDFORMATION','AWS_ENDPOINT_URL_IAM',
    'AWS_ENDPOINT_URL_STS','AWS_CA_BUNDLE','AWS_DATA_PATH','AWS_REGION','AWS_DEFAULT_REGION','AWS_LOGIN_CACHE_DIRECTORY'
  )) { $emptyCredentialEnvironment[$overrideName] = $null }
  $emptyForbiddenProfileMechanisms = @{}
  foreach ($profileKey in @(
    'credential_process','source_profile','credential_source','role_arn','web_identity_token_file',
    'sso_session','sso_start_url','sso_region','sso_account_id','sso_role_name',
    'aws_access_key_id','aws_secret_access_key','aws_session_token','endpoint_url','services','ca_bundle'
  )) { $emptyForbiddenProfileMechanisms[$profileKey] = $false }
  $validCredentialPostureArguments = @{
    Profile = 'applypack-staging'
    LoginSession = 'arn:aws:iam::838445019912:user/applypack-staging-operator'
    ConfiguredRegion = 'us-east-1'
    ResolvedCredentialType = 'login'
    ExpectedArn = 'arn:aws:iam::838445019912:user/applypack-staging-operator'
    ExpectedRegion = 'us-east-1'
    ForbiddenProfileMechanisms = $emptyForbiddenProfileMechanisms
    ConfiguredEndpointsIgnored = $true
    ProcessEnvironment = $emptyCredentialEnvironment
  }
  $apFoundationCredentialPosture = Assert-FoundationBrowserLoginCredentialPosture @validCredentialPostureArguments
  $apGovernedCreateRequest = [ordered]@{
    schemaVersion = 2
    apiAction = 'CreateChangeSet'
    profile = 'applypack-staging'
    region = 'us-east-1'
    expectedAccount = '838445019912'
    expectedArn = 'arn:aws:iam::838445019912:user/applypack-staging-operator'
    credentialPosture = $apFoundationCredentialPosture
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

  if ($apFoundationCredentialPosture.credentialSource -ne 'aws-login-browser-temporary' -or
    $apFoundationCredentialPosture.resolvedCredentialType -ne 'login' -or
    $apFoundationCredentialPosture.forbiddenProfileMechanismCount -ne 0 -or
    $apFoundationCredentialPosture.processCredentialOverrideCount -ne 0 -or !$apFoundationCredentialPosture.configuredEndpointsIgnored) {
    throw 'Controlled browser-login credential posture receipt is invalid.'
  }
  Assert-Throws -Label 'wrong browser login_session identity' -Action {
    $badArguments = @{} + $validCredentialPostureArguments
    $badArguments.LoginSession = 'arn:aws:iam::838445019912:user/wrong'
    $null = Assert-FoundationBrowserLoginCredentialPosture @badArguments
  }
  Assert-Throws -Label 'resolved credential TYPE non-login' -Action {
    $badArguments = @{} + $validCredentialPostureArguments
    $badArguments.ResolvedCredentialType = 'env'
    $null = Assert-FoundationBrowserLoginCredentialPosture @badArguments
  }
  Assert-Throws -Label 'alternate profile credential mechanism' -Action {
    $badMechanisms = @{} + $emptyForbiddenProfileMechanisms
    $badMechanisms.credential_process = $true
    $badArguments = @{} + $validCredentialPostureArguments
    $badArguments.ForbiddenProfileMechanisms = $badMechanisms
    $null = Assert-FoundationBrowserLoginCredentialPosture @badArguments
  }
  $overriddenCredentialEnvironment = @{} + $emptyCredentialEnvironment
  $overriddenCredentialEnvironment.AWS_ENDPOINT_URL_CLOUDFORMATION = 'https://attacker.invalid'
  Assert-Throws -Label 'process credential override' -Action {
    $badArguments = @{} + $validCredentialPostureArguments
    $badArguments.ProcessEnvironment = $overriddenCredentialEnvironment
    $null = Assert-FoundationBrowserLoginCredentialPosture @badArguments
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

  $script:apMockTags = $tags
  $script:apMockChanges = $changes
  $apAws = 'Invoke-ApplyPackMockAws'
  $apEvidenceDirectory = $work
  $awsEnvironmentNames = @(
    'AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_PROFILE','AWS_DEFAULT_PROFILE',
    'AWS_CONFIG_FILE','AWS_SHARED_CREDENTIALS_FILE','AWS_ROLE_ARN','AWS_WEB_IDENTITY_TOKEN_FILE','AWS_ROLE_SESSION_NAME',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI','AWS_CONTAINER_CREDENTIALS_FULL_URI','AWS_CONTAINER_AUTHORIZATION_TOKEN',
    'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE','AWS_ENDPOINT_URL','AWS_ENDPOINT_URL_CLOUDFORMATION','AWS_ENDPOINT_URL_IAM',
    'AWS_ENDPOINT_URL_STS','AWS_CA_BUNDLE','AWS_DATA_PATH','AWS_REGION','AWS_DEFAULT_REGION','AWS_LOGIN_CACHE_DIRECTORY',
    'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS'
  )
  $savedAwsEnvironment = @{}
  foreach ($environmentName in $awsEnvironmentNames) {
    $savedAwsEnvironment[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
    [Environment]::SetEnvironmentVariable($environmentName, $null, 'Process')
  }

  Reset-ApplyPackMockAws -Mode normal -Scenario success
  $mockResourceProbe = (& $apAws cloudformation list-stack-resources --stack-name $apStackId --output json | ConvertFrom-Json)
  if (@($mockResourceProbe.StackResourceSummaries).Count -ne 0) {
    throw "Mock harness empty-resource fixture is invalid: $($mockResourceProbe | ConvertTo-Json -Depth 10 -Compress)"
  }
  Remove-UnexecutedFoundationCreate -ChangeSetId $apChangeSetId -StackId $apStackId
  if (!$script:apMockChangeSetDeleted -or !$script:apMockStackDeleted) { throw 'Mock normal cleanup did not delete both exact empty artifacts.' }
  foreach ($normalFailure in @(
    @{ Scenario='foreign-id'; Label='mock normal cleanup foreign ID' },
    @{ Scenario='extra-before'; Label='mock normal cleanup exactly one before' },
    @{ Scenario='remaining-after'; Label='mock normal cleanup zero after' },
    @{ Scenario='populated-stack'; Label='mock normal cleanup populated stack' },
    @{ Scenario='executed-plan'; Label='mock normal cleanup executed plan' },
    @{ Scenario='unavailable-plan'; Label='mock normal cleanup unavailable plan' },
    @{ Scenario='credential-non-login'; Label='mock normal cleanup credential TYPE non-login' },
    @{ Scenario='profile-alternate'; Label='mock normal cleanup alternate profile source' },
    @{ Scenario='template-mismatch'; Label='mock normal cleanup provider template mismatch' }
  )) {
    Reset-ApplyPackMockAws -Mode normal -Scenario $normalFailure.Scenario
    Assert-Throws -Label $normalFailure.Label -Action {
      Remove-UnexecutedFoundationCreate -ChangeSetId $apChangeSetId -StackId $apStackId
    }
  }
  Reset-ApplyPackMockAws -Mode normal -Scenario success
  [Environment]::SetEnvironmentVariable('AWS_ROLE_ARN', 'arn:aws:iam::838445019912:role/override', 'Process')
  Assert-Throws -Label 'mock normal cleanup process override' -Action {
    Remove-UnexecutedFoundationCreate -ChangeSetId $apChangeSetId -StackId $apStackId
  }
  [Environment]::SetEnvironmentVariable('AWS_ROLE_ARN', $null, 'Process')
  Reset-ApplyPackMockAws -Mode normal -Scenario success
  [Environment]::SetEnvironmentVariable('AWS_LOGIN_CACHE_DIRECTORY', (Join-Path $work 'attacker-controlled-login-cache'), 'Process')
  Assert-Throws -Label 'mock normal cleanup login cache override' -Action {
    Remove-UnexecutedFoundationCreate -ChangeSetId $apChangeSetId -StackId $apStackId
  }
  [Environment]::SetEnvironmentVariable('AWS_LOGIN_CACHE_DIRECTORY', $null, 'Process')

  $apLegacyApprovedProcedureCommit = '1111111111111111111111111111111111111111'
  $apLegacyApprovedProcedureTree = '2222222222222222222222222222222222222222'
  $apLegacyApprovedRunbookBlob = '3333333333333333333333333333333333333333'
  $apLegacyPlanCommit = '8754e1ec334c19657686a8e4d9885b19ed9b20c7'
  $apLegacyTemplateBlob = '93b5c575a5ca77f6e94c459f0b74e722cb4b7df1'
  $apLegacyChangeSetId = 'arn:aws:cloudformation:us-east-1:838445019912:changeSet/applypack-staging-foundation-create-8754e1ec334c/89fd9205-daca-4779-a235-1c8d06092ae8'
  $apLegacyStackId = 'arn:aws:cloudformation:us-east-1:838445019912:stack/applypack-staging-foundation/56601160-cc81-11f1-8a7c-12ffddd7e50d'
  $apLegacyChangeSetName = 'applypack-staging-foundation-create-8754e1ec334c'
  $apLegacyStackName = 'applypack-staging-foundation'
  $apLegacyExpectedDescription = "ApplyPack staging foundation exact commit $apLegacyPlanCommit"
  $apLegacyProfile = 'applypack-staging'
  $apLegacyRegion = 'us-east-1'
  $apLegacyExpectedAccount = '838445019912'
  $apLegacyExpectedArn = 'arn:aws:iam::838445019912:user/applypack-staging-operator'
  $apLegacyEvidenceDirectory = $work
  $apLegacyReviewedNormalizedSha256 = $apReviewedNormalizedTemplateSha256

  Reset-ApplyPackMockAws -Mode legacy -Scenario success
  $approvedLegacyReceiptJson = (Get-ExactLegacyFoundationCleanupReceipt | ConvertTo-Json -Depth 10 -Compress)
  $approvedLegacyReceiptSha256 = Get-Utf8Sha256 -Text $approvedLegacyReceiptJson
  Reset-ApplyPackMockAws -Mode legacy -Scenario access-key-denied
  $limitedLegacyReceipt = Get-ExactLegacyFoundationCleanupReceipt
  if ($limitedLegacyReceipt.accessKeyInventory -ne 'not-authorized') {
    throw 'Mock legacy cleanup overstated an unavailable access-key inventory.'
  }
  foreach ($legacyFailure in @(
    @{ Scenario='foreign-id'; Label='mock legacy cleanup foreign ID' },
    @{ Scenario='extra-before'; Label='mock legacy cleanup exactly one before' },
    @{ Scenario='populated-stack'; Label='mock legacy cleanup populated stack' },
    @{ Scenario='executed-plan'; Label='mock legacy cleanup executed plan' },
    @{ Scenario='unavailable-plan'; Label='mock legacy cleanup unavailable plan' },
    @{ Scenario='credential-non-login'; Label='mock legacy cleanup credential TYPE non-login' },
    @{ Scenario='profile-alternate'; Label='mock legacy cleanup alternate profile source' },
    @{ Scenario='mfa-count'; Label='mock legacy cleanup MFA count' },
    @{ Scenario='access-key-present'; Label='mock legacy cleanup access key present' },
    @{ Scenario='template-mismatch'; Label='mock legacy cleanup provider template mismatch' }
  )) {
    Reset-ApplyPackMockAws -Mode legacy -Scenario $legacyFailure.Scenario
    Assert-Throws -Label $legacyFailure.Label -Action { $null = Get-ExactLegacyFoundationCleanupReceipt }
  }
  Reset-ApplyPackMockAws -Mode legacy -Scenario remaining-after
  Assert-Throws -Label 'mock legacy cleanup zero after' -Action {
    Remove-ExactLegacyFoundationPlaceholder -ApprovedReceiptJson $approvedLegacyReceiptJson `
      -ApprovedReceiptSha256 $approvedLegacyReceiptSha256 `
      -SupervisorOneApprovedReceiptSha256 $approvedLegacyReceiptSha256 `
      -SupervisorTwoApprovedReceiptSha256 $approvedLegacyReceiptSha256
  }
  Reset-ApplyPackMockAws -Mode legacy -Scenario success
  Remove-ExactLegacyFoundationPlaceholder -ApprovedReceiptJson $approvedLegacyReceiptJson `
    -ApprovedReceiptSha256 $approvedLegacyReceiptSha256 `
    -SupervisorOneApprovedReceiptSha256 $approvedLegacyReceiptSha256 `
    -SupervisorTwoApprovedReceiptSha256 $approvedLegacyReceiptSha256
  if (!$script:apMockChangeSetDeleted -or !$script:apMockStackDeleted) { throw 'Mock legacy cleanup did not delete both exact empty artifacts.' }

  'AWS_STAGING_FOUNDATION_CONTROLS_OK'
} finally {
  if ($null -ne $apGovernedCreateRequestPath -and (Test-Path -LiteralPath $apGovernedCreateRequestPath)) {
    [IO.File]::SetAttributes($apGovernedCreateRequestPath, [IO.FileAttributes]::Normal)
  }
  if ($null -ne $savedAwsEnvironment) {
    foreach ($environmentName in $savedAwsEnvironment.Keys) {
      [Environment]::SetEnvironmentVariable($environmentName, $savedAwsEnvironment[$environmentName], 'Process')
    }
  }
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}

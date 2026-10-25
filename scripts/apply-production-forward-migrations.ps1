[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('SelfTest', 'Apply')]
    [string]$Mode,

    [string]$ReceiptPath,
    [string]$CaCertificatePath,
    [string]$BackupReceiptPath,
    [string]$RestoreReceiptPath,
    [string]$ApprovedManifestPath,
    [string]$ApprovedManifestSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:RunnerRelativePath = 'scripts/apply-production-forward-migrations.ps1'
$script:CredentialHelperRelativePath = 'scripts/lib/ApplyPackProductionBackupEnvelope.cs'
$script:PreflightRelativePath = 'scripts/preflight-inventory-identity-conflicts.sql'
$script:CredentialHelperPath = Join-Path $script:RepoRoot $script:CredentialHelperRelativePath
$script:PreflightPath = Join-Path $script:RepoRoot $script:PreflightRelativePath
$script:ProjectRef = 'zzzzzzzzzzzzzzzzzzzz'
$script:DatabaseHost = 'aws-0-us-west-2.pooler.supabase.com'
$script:DatabasePort = '5432'
$script:DatabaseName = 'postgres'
$script:LoginUser = 'postgres.zzzzzzzzzzzzzzzzzzzz'
$script:CurrentUser = 'postgres'
$script:PreSchemaVersion = '202610190084'
$script:PostSchemaVersion = '202610250092'
$script:CaSha256 = '700723581420DD1AC98FD7E9AC529F0EF210EADCAF87FC868A3AD7D114C2F3B7'
$script:PostgresImageDigest = 'public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86'
$script:DockerCliReviewedPath = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$script:DockerEndpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$script:ResolvedDockerCliPath = $null
$script:RunnerVersion = 5
$script:PsqlPasswordHandoffShell = 'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGSSLMODE=verify-full; export PGSSLROOTCERT=/certs/root.crt; export PGCONNECT_TIMEOUT=15; exec "$@"'
$script:ConnectionInfoBegin = 'APPLYPACK_MIGRATION_CONNINFO_BEGIN'
$script:ConnectionInfoEnd = 'APPLYPACK_MIGRATION_CONNINFO_END'
$script:ClientTlsLinePattern = '^SSL connection \(protocol: TLSv1\.[23], cipher: [A-Za-z0-9_-]+, compression: (?:off|no)(?:, ALPN: [A-Za-z0-9_-]+|)\)$'
$script:ForbiddenConnectionEnvironmentNames = @(
    'PGPASSWORD', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE',
    'DATABASE_URL', 'AP_PREMIGRATION_DATABASE_URL'
)
$script:ForbiddenDockerEnvironmentNames = @(
    'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'
)
$script:ScrubbedChildEnvironmentNames = @(
    $script:ForbiddenConnectionEnvironmentNames + $script:ForbiddenDockerEnvironmentNames
)
$script:MutationMayHaveCommitted = $false
$script:ContainerNames = [Collections.Generic.List[string]]::new()
$script:PredecessorLedgerPlan = @(
    [ordered]@{
        version = '202610040077'
        name = 'atomic_inventory_identity_enforcement'
        statementCount = 12
        statementsDigest = 'a905fd140c31aeeef0261be33b9e2330c17cedc8195a1f7427a449e8febfa754'
    },
    [ordered]@{
        version = '202610040078'
        name = 'requeue_identity_policy_feasibility'
        statementCount = 3
        statementsDigest = '1e45eca04b7335e162826e2b200a778873c4d25585102deb1575919492c06da5'
    },
    [ordered]@{
        version = '202610040079'
        name = 'runtime_launch_schema_readiness'
        statementCount = 8
        statementsDigest = '2fb8c49604344702c185ad66cb0857d329741164faab40f9e00789c768abe2a7'
    },
    [ordered]@{
        version = '202610040080'
        name = 'persistent_inventory_identity_guard'
        statementCount = 12
        statementsDigest = 'e7287f02ba7af66dfec6885545514127e24b81db770f064171f4360ef284d2bb'
    }
)
$script:MigrationPlan = @(
    [ordered]@{
        version = '202610220085'
        name = 'staging_rehearsal_checkout_attempts'
        relativePath = 'supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql'
        checkpoint = 'STAGING_REHEARSAL_CHECKOUT_ATTEMPTS'
        predecessor = '202610190084'
        predecessorCheckpoint = 'LEGACY_BOARD_TERMINAL_EVENT_ORDERING'
        marker = 'PRODUCTION_MIGRATION_202610220085_APPLIED'
    },
    [ordered]@{
        version = '202610230086'
        name = 'sandbox_validation_launch_activation'
        relativePath = 'supabase/migrations/202610230086_sandbox_validation_launch_activation.sql'
        checkpoint = 'SANDBOX_VALIDATION_LAUNCH_ACTIVATION'
        predecessor = '202610220085'
        predecessorCheckpoint = 'STAGING_REHEARSAL_CHECKOUT_ATTEMPTS'
        marker = 'PRODUCTION_MIGRATION_202610230086_APPLIED'
    },
    [ordered]@{
        version = '202610240087'
        name = 'one_off_service_retention'
        relativePath = 'supabase/migrations/202610240087_one_off_service_retention.sql'
        checkpoint = 'ONE_OFF_SERVICE_RETENTION'
        predecessor = '202610230086'
        predecessorCheckpoint = 'SANDBOX_VALIDATION_LAUNCH_ACTIVATION'
        marker = 'PRODUCTION_MIGRATION_202610240087_APPLIED'
    },
    [ordered]@{
        version = '202610250088'
        name = 'service_retention_cleanup'
        relativePath = 'supabase/migrations/202610250088_service_retention_cleanup.sql'
        checkpoint = 'SERVICE_RETENTION_CLEANUP'
        predecessor = '202610240087'
        predecessorCheckpoint = 'ONE_OFF_SERVICE_RETENTION'
        marker = 'PRODUCTION_MIGRATION_202610250088_APPLIED'
    },
    [ordered]@{
        version = '202610250089'
        name = 'confirmed_intake'
        relativePath = 'supabase/migrations/202610250089_confirmed_intake.sql'
        checkpoint = 'CONFIRMED_INTAKE'
        predecessor = '202610250088'
        predecessorCheckpoint = 'SERVICE_RETENTION_CLEANUP'
        marker = 'PRODUCTION_MIGRATION_202610250089_APPLIED'
    },
    [ordered]@{
        version = '202610250090'
        name = 'matching_evidence_completion'
        relativePath = 'supabase/migrations/202610250090_matching_evidence_completion.sql'
        checkpoint = 'MATCHING_EVIDENCE_COMPLETION'
        predecessor = '202610250089'
        predecessorCheckpoint = 'CONFIRMED_INTAKE'
        marker = 'PRODUCTION_MIGRATION_202610250090_APPLIED'
    },
    [ordered]@{
        version = '202610250091'
        name = 'material_draft_pair_workflow'
        relativePath = 'supabase/migrations/202610250091_material_draft_pair_workflow.sql'
        checkpoint = 'MATERIAL_DRAFT_PAIR_WORKFLOW'
        predecessor = '202610250090'
        predecessorCheckpoint = 'MATCHING_EVIDENCE_COMPLETION'
        marker = 'PRODUCTION_MIGRATION_202610250091_APPLIED'
    },
    [ordered]@{
        version = '202610250092'
        name = 'material_rule_revalidation'
        relativePath = 'supabase/migrations/202610250092_material_rule_revalidation.sql'
        checkpoint = 'MATERIAL_RULE_REVALIDATION'
        predecessor = '202610250091'
        predecessorCheckpoint = 'MATERIAL_DRAFT_PAIR_WORKFLOW'
        marker = 'PRODUCTION_MIGRATION_202610250092_APPLIED'
    }
)
$script:PublishedPredecessorPaths = @(
    'supabase/migrations/202610190081_open_font_document_contract.sql',
    'supabase/migrations/202610190082_tax_activation_decision.sql',
    'supabase/migrations/202610190083_legacy_board_read_only_archive.sql',
    'supabase/migrations/202610190084_legacy_board_terminal_event_ordering.sql'
)

$script:PublicErrorCodes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
@(
    'WINDOWS_REQUIRED', 'POWERSHELL_7_REQUIRED', 'CREDENTIAL_HELPER_MISSING',
    'OUTPUT_PATH_REQUIRED', 'OUTPUT_PATH_MUST_BE_ABSOLUTE', 'OUTPUT_EXTENSION_INVALID',
    'OUTPUT_ALREADY_EXISTS', 'OUTPUT_PARENT_MISSING', 'OUTPUT_INSIDE_GIT_WORKTREE',
    'OUTPUT_REPARSE_PATH_REJECTED', 'OUTPUT_DIRECTORY_IDENTITY_CHANGED',
    'OUTPUT_FILE_HANDLE_INVALID', 'OUTPUT_FILE_NAME_INVALID', 'OUTPUT_FILE_IDENTITY_CHANGED',
    'OUTPUT_HANDLE_CLEANUP_FAILED', 'ATOMIC_OUTPUT_MISSING', 'GIT_WORKTREE_DISCOVERY_FAILED',
    'PRODUCTION_BINDING_INVALID', 'STAGING_ENVIRONMENT_REJECTED', 'CHECKOUT_FLAG_NOT_FALSE',
    'FORBIDDEN_CONNECTION_ENVIRONMENT', 'FORBIDDEN_DOCKER_ENVIRONMENT',
    'DOCKER_CLI_PATH_INVALID', 'DOCKER_DESKTOP_ENDPOINT_INVALID',
    'CA_PATH_REQUIRED', 'CA_FILE_MISSING', 'CA_PATH_INVALID', 'CA_HASH_MISMATCH',
    'PINNED_IMAGE_MISSING', 'PINNED_IMAGE_DIGEST_MISMATCH', 'PSQL_VERSION_MISMATCH',
    'RELEASE_SHA_UNAVAILABLE', 'RELEASE_SHA_INVALID', 'RELEASE_SHA_BINDING_INVALID',
    'MIGRATION_SOURCE_NOT_TRACKED', 'MIGRATION_SOURCE_NOT_AT_RELEASE_SHA',
    'MIGRATION_SOURCE_HASH_DRIFT', 'MIGRATION_TRANSACTION_BOUNDARY_INVALID',
    'MIGRATION_LEDGER_ENCODING_INVALID', 'CREDENTIAL_NOT_FOUND', 'CREDENTIAL_TARGET_MISMATCH',
    'CREDENTIAL_SECRET_INVALID', 'CREDENTIAL_IDENTITY_INVALID', 'DATABASE_ATTESTATION_FAILED',
    'CLIENT_TLS_ATTESTATION_FAILED',
    'INVENTORY_IDENTITY_PREFLIGHT_FAILED', 'INVENTORY_IDENTITY_PREFLIGHT_CONFLICT',
    'PREMIGRATION_SCHEMA_INVALID', 'MIGRATION_STEP_STATE_INVALID', 'MIGRATION_APPLY_FAILED',
    'POSTMIGRATION_SCHEMA_INVALID', 'UNEXPECTED_DATABASE_OUTPUT', 'PSQL_PROCESS_TIMEOUT',
    'PSQL_PROCESS_START_FAILED', 'CREDENTIAL_PIPE_FAILED', 'CONTAINER_TEARDOWN_FAILED',
    'RECEIPT_WRITE_FAILED', 'RECEIPT_RESERVATION_FAILED',
    'PRODUCTION_DATABASE_ADVANCEMENT_REQUIRES_INSPECTION',
    'PRODUCTION_MANIFEST_INVALID','PRODUCTION_TARGET_NOT_TRUSTED','PRODUCTION_LEDGER_INVALID','PRODUCTION_MIGRATION_SCOPE_INVALID','PRODUCTION_RECOVERY_EVIDENCE_REQUIRED','PRODUCTION_APPROVED_MANIFEST_REQUIRED','PRODUCTION_MANIFEST_HASH_MISMATCH','PRODUCTION_CHECKOUT_NOT_LOCKED','PRODUCTION_SCOPED_AUTHORIZATION_REQUIRED','PRODUCTION_MIGRATION_HASH_MISMATCH', 'BACKUP_RESTORE_BINDING_INVALID', 'SELF_TEST_FAILED', 'MIGRATION_RUNNER_FAILED'
) | ForEach-Object { [void]$script:PublicErrorCodes.Add($_) }

function Throw-Controlled {
    param([Parameter(Mandatory = $true)][string]$Code)
    if ($Code -notmatch '^[A-Z][A-Z0-9_]+$') { throw 'MIGRATION_RUNNER_FAILED' }
    throw $Code
}

function Get-ControlledCode {
    param([Parameter(Mandatory = $true)][Management.Automation.ErrorRecord]$Record)
    $exception = $Record.Exception
    while ($null -ne $exception) {
        if ($script:PublicErrorCodes.Contains($exception.Message)) { return $exception.Message }
        $exception = $exception.InnerException
    }
    return 'MIGRATION_RUNNER_FAILED'
}

function Assert-WindowsRuntime {
    if (-not $IsWindows) { Throw-Controlled 'WINDOWS_REQUIRED' }
    if ($PSVersionTable.PSVersion.Major -lt 7) { Throw-Controlled 'POWERSHELL_7_REQUIRED' }
    if (-not (Test-Path -LiteralPath $script:CredentialHelperPath -PathType Leaf)) {
        Throw-Controlled 'CREDENTIAL_HELPER_MISSING'
    }
    Add-Type -Path $script:CredentialHelperPath
}

function Get-EnvironmentValues {
    param([Parameter(Mandatory = $true)][string[]]$Names)
    $values = [ordered]@{}
    foreach ($name in $Names) {
        $values[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    return $values
}

function Assert-ForbiddenEnvironmentValues {
    param([Parameter(Mandatory = $true)][Collections.IDictionary]$Values)
    foreach ($name in $script:ForbiddenConnectionEnvironmentNames) {
        $value = [string]$Values[$name]
        if ($null -ne $Values[$name] -and $value.Length -ne 0) {
            Throw-Controlled 'FORBIDDEN_CONNECTION_ENVIRONMENT'
        }
    }
    foreach ($name in $script:ForbiddenDockerEnvironmentNames) {
        $value = [string]$Values[$name]
        if ($null -ne $Values[$name] -and $value.Length -ne 0) {
            Throw-Controlled 'FORBIDDEN_DOCKER_ENVIRONMENT'
        }
    }
}

function Assert-CleanInheritedEnvironment {
    Assert-ForbiddenEnvironmentValues -Values (Get-EnvironmentValues -Names $script:ScrubbedChildEnvironmentNames)
}

function New-ProcessStartInfo {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [bool]$RedirectInput = $false,
        [bool]$RedirectOutput = $false
    )
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $FileName
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $RedirectInput
    $start.RedirectStandardOutput = $RedirectOutput
    $start.RedirectStandardError = $true
    foreach ($name in $script:ScrubbedChildEnvironmentNames) {
        [void]$start.Environment.Remove($name)
    }
    foreach ($argument in $Arguments) { [void]$start.ArgumentList.Add($argument) }
    return $start
}

function Complete-RedirectedProcess {
    param(
        [Diagnostics.Process]$Process,
        [Threading.Tasks.Task]$StandardOutputTask,
        [Threading.Tasks.Task]$StandardErrorTask,
        [bool]$ForceTermination
    )
    if ($null -eq $Process) { return $true }
    $clean = $true
    try { $Process.StandardInput.Close() } catch {}
    if ($ForceTermination) {
        try { if (-not $Process.HasExited) { $Process.Kill($true) } } catch { $clean = $false }
    }
    try {
        if (-not $Process.WaitForExit(15000)) {
            $clean = $false
            try { $Process.Kill($true) } catch {}
            try { if (-not $Process.WaitForExit(15000)) { $clean = $false } } catch { $clean = $false }
        }
    }
    catch { $clean = $false }
    foreach ($task in @($StandardOutputTask, $StandardErrorTask)) {
        if ($null -eq $task) { continue }
        try {
            if (-not $task.Wait(15000)) { $clean = $false }
            else { [void]$task.GetAwaiter().GetResult() }
        }
        catch { $clean = $false }
    }
    try { $Process.StandardOutput.Dispose() } catch {}
    try { $Process.StandardError.Dispose() } catch {}
    try { $Process.StandardInput.Dispose() } catch {}
    $Process.Dispose()
    return $clean
}

function Invoke-NativeText {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureCode,
        [int]$TimeoutMilliseconds = 30000
    )
    $process = $null
    $stdoutTask = $null
    $stderrTask = $null
    try {
        $process = [Diagnostics.Process]::Start((New-ProcessStartInfo -FileName $FileName -Arguments $Arguments -RedirectOutput $true))
        if ($null -eq $process) { Throw-Controlled $FailureCode }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        if (-not $process.WaitForExit($TimeoutMilliseconds)) { Throw-Controlled $FailureCode }
        $exitCode = $process.ExitCode
        $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
        [void]$stderrTask.GetAwaiter().GetResult()
        if ($exitCode -ne 0) { Throw-Controlled $FailureCode }
        if (-not (Complete-RedirectedProcess -Process $process -StandardOutputTask $stdoutTask -StandardErrorTask $stderrTask -ForceTermination $false)) {
            $process = $null
            Throw-Controlled $FailureCode
        }
        $process = $null
        return $stdout
    }
    catch {
        if ($null -ne $process) {
            [void](Complete-RedirectedProcess -Process $process -StandardOutputTask $stdoutTask -StandardErrorTask $stderrTask -ForceTermination $true)
        }
        $code = Get-ControlledCode $_
        if ($code -eq 'MIGRATION_RUNNER_FAILED') { Throw-Controlled $FailureCode }
        throw
    }
}

function Resolve-ReviewedDockerCli {
    $candidate = [IO.Path]::GetFullPath($script:DockerCliReviewedPath)
    if (-not [string]::Equals($candidate, $script:DockerCliReviewedPath, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        Throw-Controlled 'DOCKER_CLI_PATH_INVALID'
    }
    $file = Get-Item -LiteralPath $candidate -Force
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        Throw-Controlled 'DOCKER_CLI_PATH_INVALID'
    }
    $script:ResolvedDockerCliPath = $candidate
    return $candidate
}

function Get-DockerCliArguments {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    return @('--host', $script:DockerEndpoint) + $Arguments
}

function New-DockerProcessStartInfo {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [bool]$RedirectInput = $false,
        [bool]$RedirectOutput = $false
    )
    if ([string]::IsNullOrWhiteSpace($script:ResolvedDockerCliPath)) {
        Throw-Controlled 'DOCKER_CLI_PATH_INVALID'
    }
    return New-ProcessStartInfo -FileName $script:ResolvedDockerCliPath `
        -Arguments (Get-DockerCliArguments -Arguments $Arguments) `
        -RedirectInput $RedirectInput -RedirectOutput $RedirectOutput
}

function Invoke-DockerText {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureCode,
        [int]$TimeoutMilliseconds = 30000
    )
    if ([string]::IsNullOrWhiteSpace($script:ResolvedDockerCliPath)) {
        Throw-Controlled 'DOCKER_CLI_PATH_INVALID'
    }
    return Invoke-NativeText -FileName $script:ResolvedDockerCliPath `
        -Arguments (Get-DockerCliArguments -Arguments $Arguments) `
        -FailureCode $FailureCode -TimeoutMilliseconds $TimeoutMilliseconds
}

function Assert-DockerDesktopIdentityText {
    param([Parameter(Mandatory = $true)][string]$Identity)
    $identity = $Identity.Trim()
    $parts = @($identity -split '\|')
    if ($parts.Count -ne 3 -or [string]::IsNullOrWhiteSpace($parts[0]) -or
        $parts[1] -notmatch '^Docker Desktop(?:\s|$)' -or
        -not [string]::Equals($parts[2], 'linux', [StringComparison]::Ordinal)) {
        Throw-Controlled 'DOCKER_DESKTOP_ENDPOINT_INVALID'
    }
    return 'DOCKER_DESKTOP_LOCAL_NAMED_PIPE_ATTESTED'
}

function Assert-DockerDesktopEndpoint {
    $identity = Invoke-DockerText -Arguments @(
        'info', '--format', '{{.Name}}|{{.OperatingSystem}}|{{.OSType}}'
    ) -FailureCode 'DOCKER_DESKTOP_ENDPOINT_INVALID'
    return Assert-DockerDesktopIdentityText -Identity $identity
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Read-Utf8TextWithExpectedSha256 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedHash
    )
    $bytes = $null
    try {
        $bytes = [IO.File]::ReadAllBytes($Path)
        $actualHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
        if (-not [string]::Equals($actualHash, $ExpectedHash, [StringComparison]::Ordinal)) {
            Throw-Controlled 'MIGRATION_SOURCE_HASH_DRIFT'
        }
        return [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
    }
    finally {
        if ($null -ne $bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    }
}

function Get-RequiredReleasePaths {
    return @(
        $script:RunnerRelativePath,
        $script:CredentialHelperRelativePath,
        $script:PreflightRelativePath,
        'scripts/lib/ProductionDatabaseGuard.ps1',
        'docs/launch/production-database-targets.json'
    ) + $script:PublishedPredecessorPaths + @($script:MigrationPlan | ForEach-Object { [string]$_.relativePath })
}

function Assert-ReleaseShaValue {
    param(
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Actual
    )
    if ($Expected -notmatch '^[0-9a-f]{40}$' -or $Actual -notmatch '^[0-9a-f]{40}$') {
        Throw-Controlled 'RELEASE_SHA_INVALID'
    }
    if (-not [string]::Equals($Expected, $Actual, [StringComparison]::Ordinal)) {
        Throw-Controlled 'RELEASE_SHA_BINDING_INVALID'
    }
}

function Get-CleanReleaseContext {
    param([Collections.IDictionary]$ExpectedHashes)
    $head = Invoke-NativeText -FileName 'git' -Arguments @('-C', $script:RepoRoot, 'rev-parse', 'HEAD') -FailureCode 'RELEASE_SHA_UNAVAILABLE'
    $expected = [Environment]::GetEnvironmentVariable('AP_PREMIGRATION_EXPECTED_RELEASE_SHA', 'Process')
    Assert-ReleaseShaValue -Expected $expected -Actual $head
    $hashes = [ordered]@{}
    foreach ($relativePath in (Get-RequiredReleasePaths)) {
        $fullPath = Join-Path $script:RepoRoot $relativePath
        [void](Invoke-NativeText -FileName 'git' -Arguments @('-C', $script:RepoRoot, 'ls-files', '--error-unmatch', '--', $relativePath) -FailureCode 'MIGRATION_SOURCE_NOT_TRACKED')
        $start = New-ProcessStartInfo -FileName 'git' -Arguments @('-C', $script:RepoRoot, 'diff', '--quiet', 'HEAD', '--', $relativePath)
        $process = [Diagnostics.Process]::Start($start)
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        if (-not $process.WaitForExit(30000)) {
            [void](Complete-RedirectedProcess -Process $process -StandardErrorTask $stderrTask -ForceTermination $true)
            Throw-Controlled 'MIGRATION_SOURCE_NOT_AT_RELEASE_SHA'
        }
        $exitCode = $process.ExitCode
        if (-not (Complete-RedirectedProcess -Process $process -StandardErrorTask $stderrTask -ForceTermination $false)) {
            Throw-Controlled 'MIGRATION_SOURCE_NOT_AT_RELEASE_SHA'
        }
        if ($exitCode -ne 0) { Throw-Controlled 'MIGRATION_SOURCE_NOT_AT_RELEASE_SHA' }
        $hash = Get-Sha256 -Path $fullPath
        if ($null -ne $ExpectedHashes -and $ExpectedHashes.Contains($relativePath) -and
            -not [string]::Equals([string]$ExpectedHashes[$relativePath], $hash, [StringComparison]::Ordinal)) {
            Throw-Controlled 'MIGRATION_SOURCE_HASH_DRIFT'
        }
        $hashes[$relativePath] = $hash
    }
    return [pscustomobject]@{ releaseSha = $head; hashes = $hashes }
}

function Assert-BindingValues {
    param([Parameter(Mandatory = $true)][Collections.IDictionary]$Values)
    if ([string]::Equals([string]$Values['AP_DEPLOYMENT_ENV'], 'staging', [StringComparison]::OrdinalIgnoreCase)) {
        Throw-Controlled 'STAGING_ENVIRONMENT_REJECTED'
    }
    $expected = [ordered]@{
        AP_DEPLOYMENT_ENV = 'production'
        AP_PREMIGRATION_EXPECTED_PROJECT_REF = $script:ProjectRef
        AP_PREMIGRATION_EXPECTED_HOST = $script:DatabaseHost
        AP_PREMIGRATION_EXPECTED_PORT = $script:DatabasePort
        AP_PREMIGRATION_EXPECTED_DATABASE = $script:DatabaseName
        AP_PREMIGRATION_EXPECTED_LOGIN_USER = $script:LoginUser
        AP_PREMIGRATION_EXPECTED_CURRENT_USER = $script:CurrentUser
    }
    foreach ($entry in $expected.GetEnumerator()) {
        if (-not [string]::Equals([string]$Values[$entry.Key], $entry.Value, [StringComparison]::Ordinal)) {
            Throw-Controlled 'PRODUCTION_BINDING_INVALID'
        }
    }
    foreach ($flag in @('APP_CHECKOUT_ENABLED', 'APP_CANARY_CHECKOUT_ENABLED', 'APP_REHEARSAL_CHECKOUT_ENABLED', 'APP_LIVE_PAYMENTS_ENABLED', 'APP_JOB_BOARD_CHECKOUT_ENABLED', 'APP_JOB_SOURCE_SYNC_ENABLED', 'APP_SERVICE_RETENTION_ENABLED')) {
        if (-not [string]::Equals([string]$Values[$flag], 'false', [StringComparison]::Ordinal)) {
            Throw-Controlled 'CHECKOUT_FLAG_NOT_FALSE'
        }
    }
}

function Assert-ProductionBinding {
    $values = [ordered]@{}
    foreach ($name in @(
        'AP_DEPLOYMENT_ENV', 'AP_PREMIGRATION_EXPECTED_PROJECT_REF',
        'AP_PREMIGRATION_EXPECTED_HOST', 'AP_PREMIGRATION_EXPECTED_PORT',
        'AP_PREMIGRATION_EXPECTED_DATABASE', 'AP_PREMIGRATION_EXPECTED_LOGIN_USER',
        'AP_PREMIGRATION_EXPECTED_CURRENT_USER', 'APP_CHECKOUT_ENABLED',
        'APP_CANARY_CHECKOUT_ENABLED', 'APP_REHEARSAL_CHECKOUT_ENABLED', 'APP_LIVE_PAYMENTS_ENABLED', 'APP_JOB_BOARD_CHECKOUT_ENABLED', 'APP_JOB_SOURCE_SYNC_ENABLED', 'APP_SERVICE_RETENTION_ENABLED'
    )) {
        $values[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    Assert-BindingValues -Values $values
}

function Assert-CaCertificate {
    if ([string]::IsNullOrWhiteSpace($CaCertificatePath)) { Throw-Controlled 'CA_PATH_REQUIRED' }
    if (-not [IO.Path]::IsPathFullyQualified($CaCertificatePath)) { Throw-Controlled 'CA_PATH_INVALID' }
    $resolved = [IO.Path]::GetFullPath($CaCertificatePath)
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { Throw-Controlled 'CA_FILE_MISSING' }
    $file = Get-Item -LiteralPath $resolved -Force
    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Throw-Controlled 'CA_PATH_INVALID' }
    if (-not [string]::Equals((Get-Sha256 $resolved), $script:CaSha256, [StringComparison]::Ordinal)) {
        Throw-Controlled 'CA_HASH_MISMATCH'
    }
    return $resolved
}

function Register-ContainerName {
    param([Parameter(Mandatory = $true)][string]$Name)
    if ($Name -notmatch '^applypack-production-migrate-[a-z0-9-]{12,80}$') { Throw-Controlled 'MIGRATION_RUNNER_FAILED' }
    $script:ContainerNames.Add($Name)
}

function Test-ContainerExists {
    param([Parameter(Mandatory = $true)][string]$ContainerName)
    $start = New-DockerProcessStartInfo -Arguments @('container', 'inspect', $ContainerName) -RedirectOutput $true
    $process = [Diagnostics.Process]::Start($start)
    $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
    $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    if (-not $process.WaitForExit(15000)) {
        [void](Complete-RedirectedProcess -Process $process -StandardOutputTask $stdoutTask -StandardErrorTask $stderrTask -ForceTermination $true)
        Throw-Controlled 'CONTAINER_TEARDOWN_FAILED'
    }
    $exitCode = $process.ExitCode
    if (-not (Complete-RedirectedProcess -Process $process -StandardOutputTask $stdoutTask -StandardErrorTask $stderrTask -ForceTermination $false)) {
        Throw-Controlled 'CONTAINER_TEARDOWN_FAILED'
    }
    return $exitCode -eq 0
}

function Ensure-ContainerAbsent {
    param([Parameter(Mandatory = $true)][string]$ContainerName)
    if (Test-ContainerExists -ContainerName $ContainerName) {
        try {
            [void](Invoke-DockerText -Arguments @('rm', '--force', $ContainerName) -FailureCode 'CONTAINER_TEARDOWN_FAILED')
        }
        catch { Throw-Controlled 'CONTAINER_TEARDOWN_FAILED' }
    }
    if (Test-ContainerExists -ContainerName $ContainerName) { Throw-Controlled 'CONTAINER_TEARDOWN_FAILED' }
}

function Assert-NoResidualRunnerContainers {
    $output = Invoke-DockerText -Arguments @(
        'ps', '--all', '--filter', 'name=applypack-production-migrate-', '--format', '{{.Names}}'
    ) -FailureCode 'CONTAINER_TEARDOWN_FAILED'
    $residual = @(
        $output -split "`r?`n" |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -match '^applypack-production-migrate-' }
    )
    if ($residual.Count -ne 0) { Throw-Controlled 'CONTAINER_TEARDOWN_FAILED' }
}

function Assert-PinnedImage {
    $inspect = Invoke-DockerText -Arguments @('image', 'inspect', '--format', '{{json .RepoDigests}}', $script:PostgresImageDigest) -FailureCode 'PINNED_IMAGE_MISSING'
    if ($inspect -notmatch [Regex]::Escape($script:PostgresImageDigest)) { Throw-Controlled 'PINNED_IMAGE_DIGEST_MISMATCH' }
    $containerName = "applypack-production-migrate-version-$([Guid]::NewGuid().ToString('N'))"
    Register-ContainerName -Name $containerName
    try {
        $version = Invoke-DockerText -Arguments @(
            'run', '--rm', '--name', $containerName, '--network', 'none', '--pull', 'never',
            '--entrypoint', 'psql', $script:PostgresImageDigest, '--version'
        ) -FailureCode 'PSQL_VERSION_MISMATCH'
        if ($version -notmatch '^psql \(PostgreSQL\) 17\.6(?:\s|$)') { Throw-Controlled 'PSQL_VERSION_MISMATCH' }
    }
    finally { Ensure-ContainerAbsent -ContainerName $containerName }
    return '17.6'
}

function Get-PsqlDockerArguments {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [Parameter(Mandatory = $true)][string]$CaPath
    )
    return @(
        'run', '--rm', '-i', '--name', $ContainerName, '--pull', 'never',
        '--volume', "${CaPath}:/certs/root.crt:ro",
        '--entrypoint', 'sh', $script:PostgresImageDigest,
        '-ec', $script:PsqlPasswordHandoffShell, '--', 'psql',
        '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
        '--set', 'ON_ERROR_STOP=1',
        '--host', $script:DatabaseHost, '--port', $script:DatabasePort,
        '--username', $script:LoginUser, '--dbname', $script:DatabaseName,
        '--file', '-'
    )
}

function Get-BoundedSqlPayload {
    param([Parameter(Mandatory = $true)][string]$Payload)
    return "set lock_timeout='30s';`nset statement_timeout='240s';`n" + $Payload
}

function Invoke-PsqlPayload {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.ProductionSecurity.CredentialMaterial]$Credential,
        [Parameter(Mandatory = $true)][string]$CaPath,
        [Parameter(Mandatory = $true)][string]$Payload,
        [Parameter(Mandatory = $true)][string]$Operation,
        [int]$TimeoutMilliseconds = 300000
    )
    $containerName = "applypack-production-migrate-$Operation-$([Guid]::NewGuid().ToString('N'))"
    Register-ContainerName -Name $containerName
    $process = $null
    $stdoutTask = $null
    $stderrTask = $null
    $payloadBytes = $null
    $timedOut = $false
    try {
        $boundedPayload = Get-BoundedSqlPayload -Payload $Payload
        $arguments = Get-PsqlDockerArguments -ContainerName $containerName -CaPath $CaPath
        if (($arguments -join "`n") -match '(?i)PGPASSWORD=|postgres(?:ql)?://|(?:^|\n)--password(?:$|\n)') {
            Throw-Controlled 'MIGRATION_RUNNER_FAILED'
        }
        $process = [Diagnostics.Process]::Start((New-DockerProcessStartInfo -Arguments $arguments -RedirectInput $true -RedirectOutput $true))
        if ($null -eq $process) { Throw-Controlled 'PSQL_PROCESS_START_FAILED' }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        try {
            $Credential.WriteUtf8LineTo($process.StandardInput.BaseStream)
            $payloadBytes = [Text.UTF8Encoding]::new($false, $true).GetBytes($boundedPayload)
            $process.StandardInput.BaseStream.Write($payloadBytes, 0, $payloadBytes.Length)
            $process.StandardInput.BaseStream.Flush()
            $process.StandardInput.Close()
        }
        catch { Throw-Controlled 'CREDENTIAL_PIPE_FAILED' }
        if (-not $process.WaitForExit($TimeoutMilliseconds)) {
            $timedOut = $true
            Throw-Controlled 'PSQL_PROCESS_TIMEOUT'
        }
        $exitCode = $process.ExitCode
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        [void]$stderrTask.GetAwaiter().GetResult()
        if (-not (Complete-RedirectedProcess -Process $process -StandardOutputTask $stdoutTask -StandardErrorTask $stderrTask -ForceTermination $false)) {
            $process = $null
            Throw-Controlled 'MIGRATION_APPLY_FAILED'
        }
        $process = $null
        return [pscustomobject]@{ exitCode = $exitCode; stdout = $stdout }
    }
    catch {
        if ($null -ne $process) {
            [void](Complete-RedirectedProcess -Process $process -StandardOutputTask $stdoutTask -StandardErrorTask $stderrTask -ForceTermination $true)
        }
        if ($timedOut) { Throw-Controlled 'PSQL_PROCESS_TIMEOUT' }
        throw
    }
    finally {
        if ($null -ne $payloadBytes) { [Array]::Clear($payloadBytes, 0, $payloadBytes.Length) }
        Ensure-ContainerAbsent -ContainerName $containerName
    }
}

function Get-OutputLines {
    param([AllowEmptyString()][string]$Text)
    return @(
        $Text -split "`r?`n" |
            ForEach-Object { $_.Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
}

function Assert-ExactMarkers {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Actual,
        [Parameter(Mandatory = $true)][string[]]$Expected
    )
    if ($Actual.Count -ne $Expected.Count) { Throw-Controlled 'UNEXPECTED_DATABASE_OUTPUT' }
    for ($index = 0; $index -lt $Expected.Count; $index += 1) {
        if (-not [string]::Equals($Actual[$index], $Expected[$index], [StringComparison]::Ordinal)) {
            Throw-Controlled 'UNEXPECTED_DATABASE_OUTPUT'
        }
    }
}

function Assert-ClientTlsAndGetMarkers {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Actual)
    if ($Actual.Count -lt 5 -or
        $Actual[0] -ne $script:ConnectionInfoBegin -or
        $Actual[3] -ne $script:ConnectionInfoEnd) {
        Throw-Controlled 'CLIENT_TLS_ATTESTATION_FAILED'
    }
    $connectionLinePattern = '^You are connected to database "' +
        [Regex]::Escape($script:DatabaseName) + '" as user "' +
        [Regex]::Escape($script:LoginUser) + '" on host "' +
        [Regex]::Escape($script:DatabaseHost) + '" \(address "[0-9A-Fa-f:.]+"\) at port "' +
        [Regex]::Escape($script:DatabasePort) + '"\.$'
    if ($Actual[1] -notmatch $connectionLinePattern -or
        $Actual[2] -notmatch $script:ClientTlsLinePattern) {
        Throw-Controlled 'CLIENT_TLS_ATTESTATION_FAILED'
    }
    return @($Actual[4..($Actual.Count - 1)])
}

function Get-ConnectionAttestationSql {
    return @'
\echo APPLYPACK_MIGRATION_CONNINFO_BEGIN
\conninfo
\echo APPLYPACK_MIGRATION_CONNINFO_END
set client_min_messages=warning;
do $applypack_attestation$
begin
  if current_database() is distinct from 'postgres'
    or current_user is distinct from 'postgres'
  then
    raise exception 'production_connection_attestation_failed';
  end if;
end
$applypack_attestation$;
\echo PRODUCTION_MIGRATION_CONNECTION_ATTESTED
'@
}

function Get-PredecessorLedgerChecksSql {
    $predicates = [Collections.Generic.List[string]]::new()
    foreach ($entry in $script:PredecessorLedgerPlan) {
        $version = [string]$entry.version
        $name = [string]$entry.name
        $statementCount = [int]$entry.statementCount
        $digest = [string]$entry.statementsDigest
        if ($version -notmatch '^\d{12}$' -or $name -notmatch '^[a-z0-9_]+$' -or
            $statementCount -lt 1 -or $digest -notmatch '^[0-9a-f]{64}$') {
            Throw-Controlled 'MIGRATION_LEDGER_ENCODING_INVALID'
        }
        $predicates.Add("(select count(*) from supabase_migrations.schema_migrations where version='$version')<>1`n    or (select count(*) from supabase_migrations.schema_migrations where version='$version' and name='$name' and pg_catalog.cardinality(statements)=$statementCount and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.array_to_json(statements)::text,'UTF8')),'hex')='$digest')<>1")
    }
    foreach ($path in $script:PublishedPredecessorPaths) {
        $fileName = [IO.Path]::GetFileNameWithoutExtension($path)
        $version, $name = $fileName.Split('_', 2)
        $source = [IO.File]::ReadAllText((Join-Path $script:RepoRoot $path), [Text.UTF8Encoding]::new($false, $true))
        $tag = '$ap_predecessor_' + $version + '$'
        if ($source.Contains($tag)) { Throw-Controlled 'MIGRATION_LEDGER_ENCODING_INVALID' }
        $predicates.Add("(select count(*) from supabase_migrations.schema_migrations where version='$version' and name='$name' and pg_catalog.cardinality(statements)=1 and replace(statements[1],chr(13),'')=$tag$($source.Replace("`r", ''))$tag)<>1")
    }
    return $predicates -join "`n    or "
}

function Get-ExpectedSchemaReadinessSql {
    param([Parameter(Mandatory)][string]$Version)
    if ($Version -ceq '202610240087') {
        return "coalesce((readiness->>'ready')::boolean,false) is distinct from false or public.ap_one_off_retention_schema_installed() is distinct from false"
    }
    return "coalesce((readiness->>'ready')::boolean,false) is distinct from true"
}

function Get-PreMigrationStateSql {
    $sql = @'
do $applypack_prestate$
declare readiness jsonb; checkout_unlocked boolean;
begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '__PRE_SCHEMA__'
    or (select count(*) from supabase_migrations.schema_migrations)<>__LEDGER_COUNT__
    or __PREDECESSOR_LEDGER_CHECKS__
    or (select count(*) from supabase_migrations.schema_migrations where version in (__PENDING_VERSIONS__))<>0
    or (select count(*) from public.ap_migration_checkpoints where migration_id='__PRE_SCHEMA__' and checkpoint='__PRE_CHECKPOINT__')<>1
    or (select count(*) from public.ap_migration_checkpoints where migration_id in (__PENDING_VERSIONS__))<>0
    or exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class on index_class.oid=index_row.indexrelid
      join pg_catalog.pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
      where namespace_row.nspname='public' and not index_row.indisvalid
    )
  then
    raise exception 'premigration_schema_invalid';
  end if;
  if not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled) then raise exception 'migration_checkout_not_locked'; end if;
  if to_regclass('public.ap_checkout_mode_configuration') is not null then
    execute 'select not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode=''LOCKED'')' into checkout_unlocked;
    if checkout_unlocked then raise exception 'migration_checkout_not_locked'; end if;
  end if;
  readiness:=public.ap_manual_launch_schema_readiness();
  if readiness->>'requiredSchemaVersion' is distinct from '__PRE_SCHEMA__'
    or __PRE_READINESS__
  then
    raise exception 'premigration_readiness_invalid';
  end if;
end
$applypack_prestate$;
\echo PRODUCTION_MIGRATION_PRESTATE_VERIFIED
'@
    return $sql.Replace('__PRE_READINESS__', (Get-ExpectedSchemaReadinessSql -Version $script:PreSchemaVersion)).Replace('__PREDECESSOR_LEDGER_CHECKS__', (Get-PredecessorLedgerChecksSql)).Replace('__PRE_SCHEMA__', $script:PreSchemaVersion).Replace('__PRE_CHECKPOINT__', [string]$script:MigrationPlan[0].predecessorCheckpoint).Replace('__LEDGER_COUNT__', [string]$script:PredecessorLedgerPlan.Count).Replace('__PENDING_VERSIONS__', ((@($script:MigrationPlan | ForEach-Object { "'$($_.version)'" })) -join ','))
}

function Get-PreflightPayload {
    param([Parameter(Mandatory = $true)][string]$ExpectedHash)
    $preflight = Read-Utf8TextWithExpectedSha256 -Path $script:PreflightPath -ExpectedHash $ExpectedHash
    return (Get-ConnectionAttestationSql) + "`n" + $preflight + "`n" + (Get-PreMigrationStateSql)
}

function Invoke-InventoryAndSchemaPreflight {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.ProductionSecurity.CredentialMaterial]$Credential,
        [Parameter(Mandatory = $true)][string]$CaPath,
        [Parameter(Mandatory = $true)][string]$ExpectedPreflightHash
    )
    $result = Invoke-PsqlPayload -Credential $Credential -CaPath $CaPath -Payload (Get-PreflightPayload -ExpectedHash $ExpectedPreflightHash) -Operation 'preflight' -TimeoutMilliseconds 300000
    $rawLines = @(Get-OutputLines -Text $result.stdout)
    $lines = @(Assert-ClientTlsAndGetMarkers -Actual $rawLines)
    if ($lines.Count -eq 2 -and
        $lines[0] -eq 'PRODUCTION_MIGRATION_CONNECTION_ATTESTED' -and
        $lines[1] -eq 'INVENTORY_IDENTITY_PREFLIGHT_CONFLICT') {
        Throw-Controlled 'INVENTORY_IDENTITY_PREFLIGHT_CONFLICT'
    }
    if ($result.exitCode -ne 0) { Throw-Controlled 'INVENTORY_IDENTITY_PREFLIGHT_FAILED' }
    Assert-ExactMarkers -Actual $lines -Expected @(
        'PRODUCTION_MIGRATION_CONNECTION_ATTESTED',
        'INVENTORY_IDENTITY_PREFLIGHT_CLEAN',
        'PRODUCTION_MIGRATION_PRESTATE_VERIFIED'
    )
    return @($lines)
}

function Get-MigrationText {
    param(
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Migration,
        [Parameter(Mandatory = $true)][string]$ExpectedHash
    )
    $path = Join-Path $script:RepoRoot ([string]$Migration.relativePath)
    return Read-Utf8TextWithExpectedSha256 -Path $path -ExpectedHash $ExpectedHash
}

function Assert-MigrationTransactionBoundary {
    param([Parameter(Mandatory = $true)][string]$Text)
    $beginMatches = [Regex]::Matches($Text, '(?im)^[ \t]*begin[ \t]*;[ \t]*(?:--[^\r\n]*)?\r?$')
    $commitMatches = [Regex]::Matches($Text, '(?im)^[ \t]*commit[ \t]*;[ \t]*(?:--[^\r\n]*)?\r?$')
    $finalCommit = [Regex]::Match($Text, '(?im)^[ \t]*commit[ \t]*;[ \t]*(?:\r?\n)?\z')
    if ($beginMatches.Count -ne 1 -or $commitMatches.Count -ne 1 -or -not $finalCommit.Success -or
        $finalCommit.Index -ne $commitMatches[0].Index) {
        Throw-Controlled 'MIGRATION_TRANSACTION_BOUNDARY_INVALID'
    }
    return $finalCommit
}

function ConvertTo-SqlLiteral {
    param([Parameter(Mandatory = $true)][string]$Value)
    if ($Value -notmatch '^[A-Za-z0-9_]+$') { Throw-Controlled 'MIGRATION_LEDGER_ENCODING_INVALID' }
    return $Value
}

function Get-StepGuardSql {
    param([Parameter(Mandatory = $true)][Collections.IDictionary]$Migration)
    $version = ConvertTo-SqlLiteral ([string]$Migration.version)
    $predecessor = ConvertTo-SqlLiteral ([string]$Migration.predecessor)
    $predecessorCheckpoint = ConvertTo-SqlLiteral -Value ([string]$Migration.predecessorCheckpoint)
    $marker = "PRODUCTION_MIGRATION_${version}_STEP_READY"
    $predecessorLedgerChecks = Get-PredecessorLedgerChecksSql
    return @"
$(Get-ConnectionAttestationSql)
do `$applypack_step_guard`$
declare readiness jsonb; checkout_unlocked boolean;
begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '$predecessor'
    or $predecessorLedgerChecks
    or (select count(*) from supabase_migrations.schema_migrations where version='$predecessor')<>1
    or (select count(*) from public.ap_migration_checkpoints where migration_id='$predecessor' and checkpoint='$predecessorCheckpoint')<>1
    or exists(select 1 from supabase_migrations.schema_migrations where version='$version')
    or exists(select 1 from public.ap_migration_checkpoints where migration_id='$version')
    or exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class on index_class.oid=index_row.indexrelid
      join pg_catalog.pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
      where namespace_row.nspname='public' and not index_row.indisvalid
    )
  then
    raise exception 'migration_step_state_invalid';
  end if;
  if not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled) then raise exception 'migration_checkout_not_locked'; end if;
  if to_regclass('public.ap_checkout_mode_configuration') is not null then
    execute 'select not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode=''LOCKED'')' into checkout_unlocked;
    if checkout_unlocked then raise exception 'migration_checkout_not_locked'; end if;
  end if;
  readiness:=public.ap_manual_launch_schema_readiness();
  if readiness->>'requiredSchemaVersion' is distinct from '$predecessor'
    or $(Get-ExpectedSchemaReadinessSql -Version $predecessor)
  then
    raise exception 'migration_step_readiness_invalid';
  end if;
end
`$applypack_step_guard`$;
\echo $marker
"@
}

function Get-MigrationExecutionPayload {
    param(
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Migration,
        [Parameter(Mandatory = $true)][string]$SourceText
    )
    $finalCommit = Assert-MigrationTransactionBoundary -Text $SourceText
    $version = ConvertTo-SqlLiteral ([string]$Migration.version)
    $name = ConvertTo-SqlLiteral ([string]$Migration.name)
    $checkpoint = ConvertTo-SqlLiteral -Value ([string]$Migration.checkpoint)
    $marker = [string]$Migration.marker
    $sourceTag = '$applypack_source_' + $version + '$'
    if ($SourceText.Contains($sourceTag, [StringComparison]::Ordinal)) { Throw-Controlled 'MIGRATION_LEDGER_ENCODING_INVALID' }
    $prefix = $SourceText.Substring(0, $finalCommit.Index)
    $ledger = @"
do `$applypack_ledger_guard`$
begin
  if exists(select 1 from supabase_migrations.schema_migrations where version='$version')
    or (select count(*) from public.ap_migration_checkpoints where migration_id='$version' and checkpoint='$checkpoint')<>1
  then
    raise exception 'migration_ledger_state_invalid';
  end if;
end
`$applypack_ledger_guard`$;

insert into supabase_migrations.schema_migrations(version,name,statements)
values ('$version','$name',array[$sourceTag$SourceText$sourceTag]::text[]);

do `$applypack_ledger_verify`$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version='$version'
        and name='$name'
        and pg_catalog.cardinality(statements)=1
        and statements[1]=$sourceTag$SourceText$sourceTag)<>1
  then
    raise exception 'migration_ledger_verification_failed';
  end if;
end
`$applypack_ledger_verify`$;

commit;
\echo $marker
"@
    return (Get-ConnectionAttestationSql) + "`n" + $prefix + $ledger
}

function Invoke-MigrationStep {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.ProductionSecurity.CredentialMaterial]$Credential,
        [Parameter(Mandatory = $true)][string]$CaPath,
        [Parameter(Mandatory = $true)][Collections.IDictionary]$Migration,
        [Parameter(Mandatory = $true)][string]$ExpectedHash
    )
    $version = [string]$Migration.version
    $guardResult = Invoke-PsqlPayload -Credential $Credential -CaPath $CaPath -Payload (Get-StepGuardSql $Migration) -Operation "guard-$version" -TimeoutMilliseconds 300000
    $rawGuardLines = @(Get-OutputLines $guardResult.stdout)
    $guardLines = @(Assert-ClientTlsAndGetMarkers -Actual $rawGuardLines)
    if ($guardResult.exitCode -ne 0) { Throw-Controlled 'MIGRATION_STEP_STATE_INVALID' }
    Assert-ExactMarkers -Actual $guardLines -Expected @(
        'PRODUCTION_MIGRATION_CONNECTION_ATTESTED',
        "PRODUCTION_MIGRATION_${version}_STEP_READY"
    )
    $sourceText = Get-MigrationText -Migration $Migration -ExpectedHash $ExpectedHash
    $payload = Get-MigrationExecutionPayload -Migration $Migration -SourceText $sourceText
    $script:MutationMayHaveCommitted = $true
    $result = Invoke-PsqlPayload -Credential $Credential -CaPath $CaPath -Payload $payload -Operation "apply-$version" -TimeoutMilliseconds 300000
    $rawResultLines = @(Get-OutputLines $result.stdout)
    $resultLines = @(Assert-ClientTlsAndGetMarkers -Actual $rawResultLines)
    if ($result.exitCode -ne 0) { Throw-Controlled 'MIGRATION_APPLY_FAILED' }
    Assert-ExactMarkers -Actual $resultLines -Expected @(
        'PRODUCTION_MIGRATION_CONNECTION_ATTESTED',
        [string]$Migration.marker
    )
    if (-not [string]::Equals((Get-Sha256 (Join-Path $script:RepoRoot ([string]$Migration.relativePath))), $ExpectedHash, [StringComparison]::Ordinal)) {
        Throw-Controlled 'MIGRATION_SOURCE_HASH_DRIFT'
    }
    return [string]$Migration.marker
}

function Get-PostMigrationStateSql {
    param([Parameter(Mandatory = $true)][Collections.IDictionary]$MigrationTexts)
    $ledgerPredicates = [Collections.Generic.List[string]]::new()
    $checkpointPredicates = [Collections.Generic.List[string]]::new()
    $predecessorLedgerChecks = Get-PredecessorLedgerChecksSql
    foreach ($migration in $script:MigrationPlan) {
        $version = [string]$migration.version
        $name = [string]$migration.name
        $checkpoint = [string]$migration.checkpoint
        $sourceText = [string]$MigrationTexts[$version]
        $tag = '$applypack_post_' + $version + '$'
        if ($sourceText.Contains($tag, [StringComparison]::Ordinal)) { Throw-Controlled 'MIGRATION_LEDGER_ENCODING_INVALID' }
        $ledgerPredicates.Add("(select count(*) from supabase_migrations.schema_migrations where version='$version' and name='$name' and pg_catalog.cardinality(statements)=1 and statements[1]=$tag$sourceText$tag)<>1")
        $checkpointPredicates.Add("(select count(*) from public.ap_migration_checkpoints where migration_id='$version' and checkpoint='$checkpoint')<>1")
    }
    $ledgerChecks = $ledgerPredicates -join "`n    or "
    $checkpointChecks = $checkpointPredicates -join "`n    or "
    return @"
$(Get-ConnectionAttestationSql)
do `$applypack_poststate`$
declare readiness jsonb; checkout_unlocked boolean;
begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '$($script:PostSchemaVersion)'
    or $predecessorLedgerChecks
    or $ledgerChecks
    or $checkpointChecks
    or exists (
      select 1
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_class on index_class.oid=index_row.indexrelid
      join pg_catalog.pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
      where namespace_row.nspname='public' and not index_row.indisvalid
    )
  then
    raise exception 'postmigration_schema_invalid';
  end if;
  if not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled) then raise exception 'migration_checkout_not_locked'; end if;
  if to_regclass('public.ap_checkout_mode_configuration') is not null then
    execute 'select not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode=''LOCKED'')' into checkout_unlocked;
    if checkout_unlocked then raise exception 'migration_checkout_not_locked'; end if;
  end if;
  readiness:=public.ap_manual_launch_schema_readiness();
  if readiness->>'requiredSchemaVersion' is distinct from '$($script:PostSchemaVersion)'
    or $(Get-ExpectedSchemaReadinessSql -Version $script:PostSchemaVersion)
  then
    raise exception 'postmigration_readiness_invalid';
  end if;
end
`$applypack_poststate`$;
\echo PRODUCTION_MIGRATION_POSTSTATE_VERIFIED
"@
}

function Invoke-PostMigrationVerification {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.ProductionSecurity.CredentialMaterial]$Credential,
        [Parameter(Mandatory = $true)][string]$CaPath,
        [Parameter(Mandatory = $true)][Collections.IDictionary]$MigrationTexts
    )
    $result = Invoke-PsqlPayload -Credential $Credential -CaPath $CaPath -Payload (Get-PostMigrationStateSql $MigrationTexts) -Operation 'poststate' -TimeoutMilliseconds 300000
    $rawLines = @(Get-OutputLines $result.stdout)
    $lines = @(Assert-ClientTlsAndGetMarkers -Actual $rawLines)
    if ($result.exitCode -ne 0) { Throw-Controlled 'POSTMIGRATION_SCHEMA_INVALID' }
    Assert-ExactMarkers -Actual $lines -Expected @(
        'PRODUCTION_MIGRATION_CONNECTION_ATTESTED',
        'PRODUCTION_MIGRATION_POSTSTATE_VERIFIED'
    )
    return @($lines)
}

function Get-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathFullyQualified($Path)) {
        Throw-Controlled 'OUTPUT_PATH_MUST_BE_ABSOLUTE'
    }
    return [IO.Path]::GetFullPath($Path)
}

function Test-IsGitRepository {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)
    $process = $null
    $stdoutTask = $null
    $stderrTask = $null
    try {
        $process = [Diagnostics.Process]::Start((New-ProcessStartInfo -FileName 'git' -Arguments @('-C', $DirectoryPath, 'rev-parse', '--is-inside-work-tree') -RedirectOutput $true))
        $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        if (-not $process.WaitForExit(15000)) { Throw-Controlled 'GIT_WORKTREE_DISCOVERY_FAILED' }
        $exitCode = $process.ExitCode
        if (-not (Complete-RedirectedProcess -Process $process -StandardOutputTask $stdoutTask -StandardErrorTask $stderrTask -ForceTermination $false)) {
            $process = $null
            Throw-Controlled 'GIT_WORKTREE_DISCOVERY_FAILED'
        }
        $process = $null
        return $exitCode -eq 0
    }
    catch {
        if ($null -ne $process) {
            [void](Complete-RedirectedProcess -Process $process -StandardOutputTask $stdoutTask -StandardErrorTask $stderrTask -ForceTermination $true)
        }
        $code = Get-ControlledCode $_
        if ($code -eq 'MIGRATION_RUNNER_FAILED') { Throw-Controlled 'GIT_WORKTREE_DISCOVERY_FAILED' }
        throw
    }
}

function Assert-DirectoryOutsideRepositories {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)
    $directory = [IO.Path]::GetFullPath($DirectoryPath)
    $cursor = [IO.DirectoryInfo]::new($directory)
    while ($null -ne $cursor) {
        $cursor.Refresh()
        if (-not $cursor.Exists) { Throw-Controlled 'OUTPUT_DIRECTORY_IDENTITY_CHANGED' }
        if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Throw-Controlled 'OUTPUT_REPARSE_PATH_REJECTED'
        }
        $cursor = $cursor.Parent
    }
    if (Test-IsGitRepository -DirectoryPath $directory) { Throw-Controlled 'OUTPUT_INSIDE_GIT_WORKTREE' }
}

function Assert-GuardedOutputDirectory {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.ProductionSecurity.OutputDirectoryGuard]$Guard,
        [string]$ExpectedIdentityToken,
        [string]$ExpectedFinalPath
    )
    if (-not [string]::IsNullOrWhiteSpace($ExpectedIdentityToken) -or
        -not [string]::IsNullOrWhiteSpace($ExpectedFinalPath)) {
        $Guard.AssertIdentity($ExpectedIdentityToken, $ExpectedFinalPath)
    }
    else { $Guard.AssertUnchanged() }
    Assert-DirectoryOutsideRepositories -DirectoryPath $Guard.FinalPath
    $Guard.AssertUnchanged()
}

function New-ReceiptReservation {
    param([Parameter(Mandatory = $true)][string]$Path)
    $fullPath = Get-FullPath $Path
    if (-not [string]::Equals([IO.Path]::GetExtension($fullPath), '.json', [StringComparison]::OrdinalIgnoreCase)) {
        Throw-Controlled 'OUTPUT_EXTENSION_INVALID'
    }
    if (Test-Path -LiteralPath $fullPath) { Throw-Controlled 'OUTPUT_ALREADY_EXISTS' }
    $parent = [IO.Path]::GetDirectoryName($fullPath)
    if ([string]::IsNullOrWhiteSpace($parent) -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
        Throw-Controlled 'OUTPUT_PARENT_MISSING'
    }
    $guard = [ApplyPack.ProductionSecurity.OutputDirectoryGuard]::Capture($parent)
    $stream = $null
    $temporaryLeaf = "$([IO.Path]::GetFileName($fullPath)).partial-$([Guid]::NewGuid().ToString('N'))"
    $temporaryPath = Join-Path $parent $temporaryLeaf
    try {
        Assert-GuardedOutputDirectory -Guard $guard
        $stream = [IO.FileStream]::new(
            $temporaryPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::Delete,
            65536,
            [IO.FileOptions]::WriteThrough
        )
        $guard.AssertFileIsDirectChild($stream.SafeFileHandle, $temporaryLeaf)
        return [pscustomobject]@{
            FinalPath = $fullPath
            FinalLeaf = [IO.Path]::GetFileName($fullPath)
            PartialPath = $temporaryPath
            PartialLeaf = $temporaryLeaf
            Guard = $guard
            Stream = $stream
            Published = $false
            Completed = $false
        }
    }
    catch {
        if ($null -ne $stream) {
            $deleteHandle = $null
            try {
                $guard.AssertFileIsDirectChild($stream.SafeFileHandle, $temporaryLeaf)
                $deleteHandle = [ApplyPack.ProductionSecurity.OutputDirectoryGuard]::OpenRegularFileForDeletion($temporaryPath)
                $guard.AssertFileIsDirectChild($deleteHandle, $temporaryLeaf)
                [ApplyPack.ProductionSecurity.OutputDirectoryGuard]::MarkDeleteOnClose($deleteHandle)
            }
            catch {}
            finally {
                if ($null -ne $deleteHandle) { $deleteHandle.Dispose() }
            }
            $stream.Dispose()
        }
        $guard.Dispose()
        Throw-Controlled 'RECEIPT_RESERVATION_FAILED'
    }
}

function Write-JsonStream {
    param([Parameter(Mandatory = $true)][IO.Stream]$Stream, [Parameter(Mandatory = $true)]$Value)
    $json = $Value | ConvertTo-Json -Depth 12 -Compress
    if ($json -match '(?i)postgres(?:ql)?://|password|PGPASSWORD') { Throw-Controlled 'RECEIPT_WRITE_FAILED' }
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    try { $Stream.Write($bytes, 0, $bytes.Length) }
    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Assert-ReceiptReservation {
    param([Parameter(Mandatory = $true)]$Reservation)
    $guard = [ApplyPack.ProductionSecurity.OutputDirectoryGuard]$Reservation.Guard
    $stream = [IO.FileStream]$Reservation.Stream
    if ($null -eq $guard -or $null -eq $stream -or -not $stream.CanWrite) {
        Throw-Controlled 'RECEIPT_RESERVATION_FAILED'
    }
    Assert-GuardedOutputDirectory -Guard $guard
    $leaf = if ([bool]$Reservation.Published) { [string]$Reservation.FinalLeaf } else { [string]$Reservation.PartialLeaf }
    $guard.AssertFileIsDirectChild($stream.SafeFileHandle, $leaf)
    if (-not [bool]$Reservation.Published -and (Test-Path -LiteralPath ([string]$Reservation.FinalPath))) {
        Throw-Controlled 'OUTPUT_ALREADY_EXISTS'
    }
}

function Publish-ReceiptReservation {
    param([Parameter(Mandatory = $true)]$Reservation, [Parameter(Mandatory = $true)]$Receipt)
    try {
        Assert-ReceiptReservation -Reservation $Reservation
        $stream = [IO.FileStream]$Reservation.Stream
        $stream.Position = 0
        $stream.SetLength(0)
        Write-JsonStream -Stream $stream -Value $Receipt
        $stream.Flush($true)
        Assert-ReceiptReservation -Reservation $Reservation
        [IO.File]::Move([string]$Reservation.PartialPath, [string]$Reservation.FinalPath)
        $Reservation.Published = $true
        Assert-ReceiptReservation -Reservation $Reservation
        $Reservation.Completed = $true
    }
    catch {
        Throw-Controlled 'RECEIPT_WRITE_FAILED'
    }
    if (-not (Test-Path -LiteralPath ([string]$Reservation.FinalPath) -PathType Leaf)) {
        Throw-Controlled 'ATOMIC_OUTPUT_MISSING'
    }
}

function Close-ReceiptReservation {
    param([Parameter(Mandatory = $true)]$Reservation, [Parameter(Mandatory = $true)][bool]$KeepPublished)
    $cleanupFailed = $false
    $deleteHandle = $null
    $pathToRemove = if ([bool]$Reservation.Published) { [string]$Reservation.FinalPath } else { [string]$Reservation.PartialPath }
    try {
        if (-not $KeepPublished) {
            try {
                Assert-ReceiptReservation -Reservation $Reservation
                $deleteHandle = [ApplyPack.ProductionSecurity.OutputDirectoryGuard]::OpenRegularFileForDeletion($pathToRemove)
                ([ApplyPack.ProductionSecurity.OutputDirectoryGuard]$Reservation.Guard).AssertFileIsDirectChild(
                    $deleteHandle,
                    $(if ([bool]$Reservation.Published) { [string]$Reservation.FinalLeaf } else { [string]$Reservation.PartialLeaf })
                )
                [ApplyPack.ProductionSecurity.OutputDirectoryGuard]::MarkDeleteOnClose($deleteHandle)
            }
            catch { $cleanupFailed = $true }
        }
    }
    finally {
        try {
            if ($null -ne $deleteHandle) {
                $deleteHandle.Dispose()
                $deleteHandle = $null
            }
        }
        catch { $cleanupFailed = $true }
        try {
            if ($null -ne $Reservation.Stream) {
                ([IO.FileStream]$Reservation.Stream).Dispose()
                $Reservation.Stream = $null
            }
        }
        catch { $cleanupFailed = $true }
        try {
            if ($null -ne $Reservation.Guard) {
                ([ApplyPack.ProductionSecurity.OutputDirectoryGuard]$Reservation.Guard).Dispose()
                $Reservation.Guard = $null
            }
        }
        catch { $cleanupFailed = $true }
    }
    if (-not $KeepPublished -and (Test-Path -LiteralPath $pathToRemove)) { $cleanupFailed = $true }
    if ($KeepPublished -and -not (Test-Path -LiteralPath ([string]$Reservation.FinalPath) -PathType Leaf)) {
        $cleanupFailed = $true
    }
    if ($cleanupFailed) { Throw-Controlled 'RECEIPT_RESERVATION_FAILED' }
}

function Assert-AllContainersAbsent {
    foreach ($containerName in @($script:ContainerNames)) { Ensure-ContainerAbsent -ContainerName $containerName }
    Assert-NoResidualRunnerContainers
}

function Assert-ProductionRecovery {
    param($Release)
    Assert-ProductionSourceHashes -Manifest $script:ApprovedManifest -RepositoryRoot $script:RepoRoot
    try {
        $backup = Get-Content -LiteralPath $BackupReceiptPath -Raw | ConvertFrom-Json
        $restore = Get-Content -LiteralPath $RestoreReceiptPath -Raw | ConvertFrom-Json
        if ($backup.operation -cne 'production-governed-backup' -or
            $backup.manifestSha256 -cne $ApprovedManifestSha256 -or $restore.manifestSha256 -cne $ApprovedManifestSha256 -or
            $restore.operation -cne 'isolated-production-structural-restore-drill' -or
            $backup.releaseSha -cne $Release.releaseSha -or $restore.sourceReleaseSha -cne $Release.releaseSha -or
            $backup.envelopeSha256 -cnotmatch '^[A-Fa-f0-9]{64}$' -or $backup.envelopeSha256 -cne $restore.envelopeSha256 -or
            $backup.sourceEvidence.latestMigration -cne $script:PreSchemaVersion -or
            $restore.aggregateEvidence.latestMigration -cne $script:PreSchemaVersion -or
            $backup.sourceEvidence.tableRowCountSha256 -cne $restore.tableRowCountSha256 -or
            $restore.networkMode -cne 'none' -or $restore.publishedPorts -ne 0 -or $restore.teardownVerified -ne $true -or
            [DateTimeOffset]::Parse($backup.completedAt) -gt [DateTimeOffset]::UtcNow -or
            [DateTimeOffset]::Parse($backup.completedAt) -lt [DateTimeOffset]::UtcNow.AddHours(-24) -or
            [DateTimeOffset]::Parse($restore.completedAt) -lt [DateTimeOffset]::Parse($backup.completedAt)) {
            Throw-Controlled 'BACKUP_RESTORE_BINDING_INVALID'
        }
    } catch { Throw-Controlled 'BACKUP_RESTORE_BINDING_INVALID' }
}

function Invoke-Apply {
    Assert-CleanInheritedEnvironment
    if ([string]::IsNullOrWhiteSpace($ReceiptPath)) { Throw-Controlled 'OUTPUT_PATH_REQUIRED' }
    $script:MutationMayHaveCommitted = $false
    $reservation = $null
    $credential = $null
    $failureCode = $null
    $cleanupCode = $null
    $receiptPublished = $false
    $successReport = $null
    $dockerReady = $false
    $release = $null
    $startedAt = [DateTimeOffset]::UtcNow.ToString('O')
    $preflightMarkers = $null
    $postflightMarkers = $null
    $migrationReceipts = [Collections.Generic.List[object]]::new()
    $migrationTexts = [ordered]@{}
    try {
        $reservation = New-ReceiptReservation -Path $ReceiptPath
        Assert-ReceiptReservation -Reservation $reservation
        Assert-ProductionBinding
        $release = Get-CleanReleaseContext
        Assert-ProductionRecovery -Release $release
        $caPath = Assert-CaCertificate
        [void](Resolve-ReviewedDockerCli)
        $dockerAttestation = Assert-DockerDesktopEndpoint
        $dockerReady = $true
        Assert-NoResidualRunnerContainers
        $psqlVersion = Assert-PinnedImage
        Assert-ReceiptReservation -Reservation $reservation
        $credential = [ApplyPack.ProductionSecurity.WindowsCredentialStore]::ReadProductionDatabase()
        if ($credential.HasLineBreak -or -not [string]::Equals($credential.UserName, $script:LoginUser, [StringComparison]::Ordinal)) {
            Throw-Controlled 'CREDENTIAL_IDENTITY_INVALID'
        }
        $preflightMarkers = Invoke-InventoryAndSchemaPreflight -Credential $credential -CaPath $caPath -ExpectedPreflightHash ([string]$release.hashes[$script:PreflightRelativePath])
        Assert-ReceiptReservation -Reservation $reservation
        foreach ($migration in $script:MigrationPlan) {
            $expectedHash = [string]$release.hashes[[string]$migration.relativePath]
            $migrationTexts[[string]$migration.version] = Get-MigrationText -Migration $migration -ExpectedHash $expectedHash
            Assert-ReceiptReservation -Reservation $reservation
            $marker = Invoke-MigrationStep -Credential $credential -CaPath $caPath -Migration $migration -ExpectedHash $expectedHash
            Assert-ReceiptReservation -Reservation $reservation
            $migrationReceipts.Add([ordered]@{
                version = [string]$migration.version
                name = [string]$migration.name
                sha256 = $expectedHash
                checkpoint = [string]$migration.checkpoint
                ledgerRows = 1
                statementsElements = 1
                marker = $marker
            })
        }
        $postflightMarkers = Invoke-PostMigrationVerification -Credential $credential -CaPath $caPath -MigrationTexts $migrationTexts
        Assert-ReceiptReservation -Reservation $reservation
        $credential.Dispose()
        $credential = $null
        Assert-AllContainersAbsent
        $postRelease = Get-CleanReleaseContext -ExpectedHashes $release.hashes
        if (-not [string]::Equals($postRelease.releaseSha, $release.releaseSha, [StringComparison]::Ordinal)) {
            Throw-Controlled 'RELEASE_SHA_BINDING_INVALID'
        }
        Assert-ReceiptReservation -Reservation $reservation
        $receipt = [ordered]@{
            operation = 'production-reviewed-forward-migrations'
            manifestSha256 = $ApprovedManifestSha256
            runnerVersion = $script:RunnerVersion
            startedAt = $startedAt
            completedAt = [DateTimeOffset]::UtcNow.ToString('O')
            deploymentEnvironment = 'production'
            projectRef = $script:ProjectRef
            endpointType = Get-ProductionDatabaseEndpointType -Manifest $script:ApprovedManifest
            host = $script:DatabaseHost
            port = [int]$script:DatabasePort
            database = $script:DatabaseName
            loginUser = $script:LoginUser
            currentUser = $script:CurrentUser
            releaseSha = $release.releaseSha
            caSha256 = $script:CaSha256
            postgresImageDigest = $script:PostgresImageDigest
            dockerCliPath = $script:DockerCliReviewedPath
            dockerEndpoint = $script:DockerEndpoint
            dockerAttestation = $dockerAttestation
            psqlVersion = $psqlVersion
            serverLockTimeout = '30s'
            serverStatementTimeout = '240s'
            clientTimeout = '300s'
            clientTlsVerified = $true
            preflightMarkers = @($preflightMarkers)
            preState = [ordered]@{
                latestSchemaVersion = $script:PreSchemaVersion
                predecessorLedger = @($script:PredecessorLedgerPlan | ForEach-Object {
                    [ordered]@{
                        version = [string]$_.version
                        name = [string]$_.name
                        statementCount = [int]$_.statementCount
                        statementsDigest = [string]$_.statementsDigest
                    }
                })
                migration085Rows = [int]($script:PreSchemaVersion -cge '202610220085')
                migration086Rows = [int]($script:PreSchemaVersion -cge '202610230086')
                migration087Rows = [int]($script:PreSchemaVersion -cge '202610240087')
                migration088Rows = [int]($script:PreSchemaVersion -cge '202610250088')
                migration089Rows = [int]($script:PreSchemaVersion -cge '202610250089')
                migration090Rows = [int]($script:PreSchemaVersion -cge '202610250090')
                migration091Rows = [int]($script:PreSchemaVersion -cge '202610250091')
                migration092Rows = 0
                requiredSchemaVersion = $script:PreSchemaVersion
                ready = ($script:PreSchemaVersion -cne '202610240087')
                invalidPublicIndexes = 0
            }
            migrations = @($migrationReceipts)
            postflightMarkers = @($postflightMarkers)
            postState = [ordered]@{
                latestSchemaVersion = $script:PostSchemaVersion
                migration085Rows = 1
                migration086Rows = 1
                migration087Rows = 1
                migration088Rows = [int]($script:PostSchemaVersion -cge '202610250088')
                migration089Rows = [int]($script:PostSchemaVersion -cge '202610250089')
                migration090Rows = [int]($script:PostSchemaVersion -cge '202610250090')
                migration091Rows = [int]($script:PostSchemaVersion -cge '202610250091')
                migration092Rows = [int]($script:PostSchemaVersion -cge '202610250092')
                requiredSchemaVersion = $script:PostSchemaVersion
                ready = ($script:PostSchemaVersion -cne '202610240087')
                invalidPublicIndexes = 0
            }
            publishedPorts = 0
            teardownVerified = $true
            residualNamedContainers = 0
        }
        Publish-ReceiptReservation -Reservation $reservation -Receipt $receipt
        $receiptPublished = $true
        $successReport = [ordered]@{
            status = 'PRODUCTION_FORWARD_MIGRATIONS_APPLIED'
            releaseSha = $release.releaseSha
            receiptPath = [string]$reservation.FinalPath
            teardownVerified = $true
        } | ConvertTo-Json -Compress
    }
    catch { $failureCode = Get-ControlledCode $_ }
    finally {
        if ($null -ne $credential) { $credential.Dispose() }
        if (-not $receiptPublished -and $dockerReady) {
            try { Assert-AllContainersAbsent }
            catch { $cleanupCode = Get-ControlledCode $_ }
        }
        if ($null -ne $reservation) {
            try { Close-ReceiptReservation -Reservation $reservation -KeepPublished $receiptPublished }
            catch { if ($null -eq $cleanupCode) { $cleanupCode = Get-ControlledCode $_ } }
        }
    }
    if ($null -ne $failureCode -or $null -ne $cleanupCode) {
        if ($script:MutationMayHaveCommitted -and -not $receiptPublished) {
            Throw-Controlled 'PRODUCTION_DATABASE_ADVANCEMENT_REQUIRES_INSPECTION'
        }
        if ($null -ne $failureCode) { Throw-Controlled $failureCode }
        Throw-Controlled $cleanupCode
    }
    return $successReport
}

function Invoke-SelfTest {
    Assert-CleanInheritedEnvironment
    $secretMarker = 'SELF_TEST_SECRET_DO_NOT_LOG_92841'
    $secretChars = $secretMarker.ToCharArray()
    $credential = $null
    $stream = $null
    $reservation = $null
    $failureReservation = $null
    $originalChildEnvironment = [ordered]@{}
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "applypack-production-migration-selftest-$([Guid]::NewGuid().ToString('N'))"
    [IO.Directory]::CreateDirectory($tempRoot) | Out-Null
    try {
        $receiptEndpoint = [ordered]@{ projectRef=$script:ProjectRef; port=5432;
            host='aws-0-us-east-1.pooler.supabase.com'; loginUser="postgres.$($script:ProjectRef)" }
        if ((Get-ProductionDatabaseEndpointType -Manifest $receiptEndpoint) -cne 'session-pooler') {
            Throw-Controlled 'SELF_TEST_FAILED'
        }
        $receiptEndpoint.host = "db.$($script:ProjectRef).supabase.co"
        $receiptEndpoint.loginUser = 'postgres'
        if ((Get-ProductionDatabaseEndpointType -Manifest $receiptEndpoint) -cne 'direct') {
            Throw-Controlled 'SELF_TEST_FAILED'
        }
        $emptyEnvironment = [ordered]@{}
        foreach ($name in $script:ScrubbedChildEnvironmentNames) { $emptyEnvironment[$name] = $null }
        $connectionEnvironmentRejected = $false
        try {
            $blocked = [ordered]@{} + $emptyEnvironment
            $blocked['PGPASSWORD'] = $secretMarker
            Assert-ForbiddenEnvironmentValues -Values $blocked
        }
        catch { $connectionEnvironmentRejected = (Get-ControlledCode $_) -eq 'FORBIDDEN_CONNECTION_ENVIRONMENT' }
        if (-not $connectionEnvironmentRejected) { Throw-Controlled 'SELF_TEST_FAILED' }
        $dockerEnvironmentRejected = $false
        try {
            $blocked = [ordered]@{} + $emptyEnvironment
            $blocked['DOCKER_HOST'] = 'tcp://not-local.example.invalid:2376'
            Assert-ForbiddenEnvironmentValues -Values $blocked
        }
        catch { $dockerEnvironmentRejected = (Get-ControlledCode $_) -eq 'FORBIDDEN_DOCKER_ENVIRONMENT' }
        if (-not $dockerEnvironmentRejected) { Throw-Controlled 'SELF_TEST_FAILED' }

        foreach ($name in $script:ScrubbedChildEnvironmentNames) {
            $originalChildEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
            [Environment]::SetEnvironmentVariable($name, $secretMarker, 'Process')
        }
        try {
            $scrubbedStart = New-ProcessStartInfo -FileName 'never-started.exe' -Arguments @('self-test')
            foreach ($name in $script:ScrubbedChildEnvironmentNames) {
                if ($scrubbedStart.Environment.ContainsKey($name)) { Throw-Controlled 'SELF_TEST_FAILED' }
            }
        }
        finally {
            foreach ($name in $script:ScrubbedChildEnvironmentNames) {
                [Environment]::SetEnvironmentVariable($name, $originalChildEnvironment[$name], 'Process')
            }
        }

        $validBinding = [ordered]@{
            AP_DEPLOYMENT_ENV = 'production'
            AP_PREMIGRATION_EXPECTED_PROJECT_REF = $script:ProjectRef
            AP_PREMIGRATION_EXPECTED_HOST = $script:DatabaseHost
            AP_PREMIGRATION_EXPECTED_PORT = $script:DatabasePort
            AP_PREMIGRATION_EXPECTED_DATABASE = $script:DatabaseName
            AP_PREMIGRATION_EXPECTED_LOGIN_USER = $script:LoginUser
            AP_PREMIGRATION_EXPECTED_CURRENT_USER = $script:CurrentUser
            APP_CHECKOUT_ENABLED = 'false'
            APP_CANARY_CHECKOUT_ENABLED = 'false'
            APP_REHEARSAL_CHECKOUT_ENABLED = 'false'
            APP_LIVE_PAYMENTS_ENABLED = 'false'
            APP_JOB_BOARD_CHECKOUT_ENABLED = 'false'
            APP_JOB_SOURCE_SYNC_ENABLED = 'false'
            APP_SERVICE_RETENTION_ENABLED = 'false'
        }
        Assert-BindingValues -Values $validBinding
        $productionRejected = $false
        try {
            $invalid = [ordered]@{} + $validBinding
            $invalid['AP_DEPLOYMENT_ENV'] = 'staging'
            Assert-BindingValues -Values $invalid
        }
        catch { $productionRejected = (Get-ControlledCode $_) -eq 'STAGING_ENVIRONMENT_REJECTED' }
        if (-not $productionRejected) { Throw-Controlled 'SELF_TEST_FAILED' }
        $flagRejected = $false
        try {
            $invalid = [ordered]@{} + $validBinding
            $invalid['APP_CHECKOUT_ENABLED'] = 'False'
            Assert-BindingValues -Values $invalid
        }
        catch { $flagRejected = (Get-ControlledCode $_) -eq 'CHECKOUT_FLAG_NOT_FALSE' }
        if (-not $flagRejected) { Throw-Controlled 'SELF_TEST_FAILED' }
        $releaseRejected = $false
        try { Assert-ReleaseShaValue -Expected ('a' * 40) -Actual ('b' * 40) }
        catch { $releaseRejected = (Get-ControlledCode $_) -eq 'RELEASE_SHA_BINDING_INVALID' }
        if (-not $releaseRejected) { Throw-Controlled 'SELF_TEST_FAILED' }
        $unexpectedOutputRejected = $false
        try { Assert-ExactMarkers -Actual @('EXPECTED', 'EXTRA') -Expected @('EXPECTED') }
        catch { $unexpectedOutputRejected = (Get-ControlledCode $_) -eq 'UNEXPECTED_DATABASE_OUTPUT' }
        if (-not $unexpectedOutputRejected) { Throw-Controlled 'SELF_TEST_FAILED' }
        $zeroMarkerLines = @(Get-OutputLines -Text '')
        $zeroMarkerRejected = $false
        try { Assert-ExactMarkers -Actual $zeroMarkerLines -Expected @('EXPECTED') }
        catch { $zeroMarkerRejected = (Get-ControlledCode $_) -eq 'UNEXPECTED_DATABASE_OUTPUT' }
        if ($zeroMarkerLines.Count -ne 0 -or -not $zeroMarkerRejected) { Throw-Controlled 'SELF_TEST_FAILED' }
        $oneMarkerLines = @(Get-OutputLines -Text "EXPECTED`n")
        Assert-ExactMarkers -Actual $oneMarkerLines -Expected @('EXPECTED')
        $oneMarkerRejected = $false
        try { Assert-ExactMarkers -Actual $oneMarkerLines -Expected @('EXPECTED', 'MISSING') }
        catch { $oneMarkerRejected = (Get-ControlledCode $_) -eq 'UNEXPECTED_DATABASE_OUTPUT' }
        if ($oneMarkerLines.Count -ne 1 -or -not $oneMarkerRejected) { Throw-Controlled 'SELF_TEST_FAILED' }

        $validClientTlsLines = @(
            $script:ConnectionInfoBegin,
            "You are connected to database `"$($script:DatabaseName)`" as user `"$($script:LoginUser)`" on host `"$($script:DatabaseHost)`" (address `"2001:db8::1`") at port `"$($script:DatabasePort)`".",
            'SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)',
            $script:ConnectionInfoEnd,
            'EXPECTED'
        )
        $clientTlsMarkers = @(Assert-ClientTlsAndGetMarkers -Actual $validClientTlsLines)
        Assert-ExactMarkers -Actual $clientTlsMarkers -Expected @('EXPECTED')
        $unverifiedClientTlsRejected = $false
        try {
            $invalidClientTlsLines = @($validClientTlsLines)
            $invalidClientTlsLines[2] = 'You are connected without SSL.'
            [void](Assert-ClientTlsAndGetMarkers -Actual $invalidClientTlsLines)
        }
        catch { $unverifiedClientTlsRejected = (Get-ControlledCode $_) -eq 'CLIENT_TLS_ATTESTATION_FAILED' }
        if (-not $unverifiedClientTlsRejected) { Throw-Controlled 'SELF_TEST_FAILED' }

        $predecessorLedgerSql = Get-PredecessorLedgerChecksSql
        foreach ($entry in $script:PredecessorLedgerPlan) {
            if ($predecessorLedgerSql -notmatch [Regex]::Escape("version='$([string]$entry.version)' and name='$([string]$entry.name)'") -or
                $predecessorLedgerSql -notmatch [Regex]::Escape("pg_catalog.cardinality(statements)=$([int]$entry.statementCount)") -or
                $predecessorLedgerSql -notmatch [Regex]::Escape("='$([string]$entry.statementsDigest)'") ) {
                Throw-Controlled 'SELF_TEST_FAILED'
            }
        }

        foreach ($lineEnding in @("`n", "`r`n")) {
            [void](Assert-MigrationTransactionBoundary -Text ("begin;{0}select 1;{0}commit;{0}" -f $lineEnding))
        }
        foreach ($invalidBoundary in @("begin;`ncommit;`nselect 1;", "begin;`ncommit;`ncommit;`n", "select 1;`ncommit;`n")) {
            $rejected = $false
            try { [void](Assert-MigrationTransactionBoundary -Text $invalidBoundary) } catch { $rejected = $true }
            if (!$rejected) { Throw-Controlled 'SELF_TEST_FAILED' }
        }

        $migrationHashes = [ordered]@{}
        foreach ($migration in $script:MigrationPlan) {
            $path = Join-Path $script:RepoRoot ([string]$migration.relativePath)
            $hash = Get-Sha256 $path
            $migrationHashes[[string]$migration.version] = $hash
            $text = Get-MigrationText -Migration $migration -ExpectedHash $hash
            $payload = Get-MigrationExecutionPayload -Migration $migration -SourceText $text
            if ($payload -notmatch [Regex]::Escape("insert into supabase_migrations.schema_migrations(version,name,statements)") -or
                $payload -notmatch [Regex]::Escape("values ('$([string]$migration.version)','$([string]$migration.name)',array[") -or
                $payload -notmatch [Regex]::Escape($script:ConnectionInfoBegin) -or
                $payload -notmatch [Regex]::Escape('\conninfo') -or
                $payload -match [Regex]::Escape($secretMarker)) {
                Throw-Controlled 'SELF_TEST_FAILED'
            }
        }

        $credential = [ApplyPack.ProductionSecurity.WindowsCredentialStore]::CreateSyntheticForSelfTest($secretChars)
        $stream = [IO.MemoryStream]::new()
        $credential.WriteUtf8LineTo($stream)
        $syntheticSql = "\echo SELF_TEST_SQL_STDIN_REMAINS`n"
        $syntheticSqlBytes = [Text.UTF8Encoding]::new($false, $true).GetBytes($syntheticSql)
        try { $stream.Write($syntheticSqlBytes, 0, $syntheticSqlBytes.Length) }
        finally { [Array]::Clear($syntheticSqlBytes, 0, $syntheticSqlBytes.Length) }
        $piped = [Text.UTF8Encoding]::new($false, $true).GetString($stream.ToArray())
        $passwordDelimiter = $piped.IndexOf("`n", [StringComparison]::Ordinal)
        if ($passwordDelimiter -lt 0 -or
            -not [string]::Equals($piped.Substring(0, $passwordDelimiter).TrimEnd("`r"), $secretMarker, [StringComparison]::Ordinal) -or
            -not [string]::Equals($piped.Substring($passwordDelimiter + 1), $syntheticSql, [StringComparison]::Ordinal)) {
            Throw-Controlled 'SELF_TEST_FAILED'
        }
        $credential.Dispose()
        $credential = $null
        if (@($secretChars | Where-Object { $_ -ne [char]0 }).Count -ne 0) { Throw-Controlled 'SELF_TEST_FAILED' }

        $syntheticCa = Join-Path $tempRoot 'synthetic-ca.crt'
        [IO.File]::WriteAllText($syntheticCa, 'synthetic', [Text.UTF8Encoding]::new($false))
        $arguments = Get-PsqlDockerArguments -ContainerName 'applypack-production-migrate-selftest1' -CaPath $syntheticCa
        $joinedArguments = $arguments -join "`n"
        if (-not [string]::Equals($script:PsqlPasswordHandoffShell, 'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGSSLMODE=verify-full; export PGSSLROOTCERT=/certs/root.crt; export PGCONNECT_TIMEOUT=15; exec "$@"', [StringComparison]::Ordinal) -or
            $joinedArguments -match '(?i)PGPASSWORD=|postgres(?:ql)?://|--password|--publish|(^|\n)-p($|\n)' -or
            $joinedArguments -notmatch '(?m)^--entrypoint\nsh\n' -or
            $joinedArguments -notmatch '(?m)^-ec\nIFS= read -r PGPASSWORD; export PGPASSWORD; export PGSSLMODE=verify-full; export PGSSLROOTCERT=/certs/root\.crt; export PGCONNECT_TIMEOUT=15; exec "\$@"\n--\npsql\n' -or
            $joinedArguments -match [Regex]::Escape($secretMarker)) {
            Throw-Controlled 'SELF_TEST_FAILED'
        }

        $script:ResolvedDockerCliPath = $script:DockerCliReviewedPath
        $dockerStart = New-DockerProcessStartInfo -Arguments @('version')
        if (-not [string]::Equals($dockerStart.FileName, $script:DockerCliReviewedPath, [StringComparison]::OrdinalIgnoreCase) -or
            $dockerStart.ArgumentList.Count -lt 3 -or
            $dockerStart.ArgumentList[0] -ne '--host' -or
            $dockerStart.ArgumentList[1] -ne $script:DockerEndpoint -or
            $dockerStart.ArgumentList[2] -ne 'version') {
            Throw-Controlled 'SELF_TEST_FAILED'
        }
        foreach ($name in $script:ScrubbedChildEnvironmentNames) {
            if ($dockerStart.Environment.ContainsKey($name)) { Throw-Controlled 'SELF_TEST_FAILED' }
        }
        $dockerIdentityMarker = Assert-DockerDesktopIdentityText -Identity 'applypack-selftest|Docker Desktop 4.42|linux'
        if ($dockerIdentityMarker -ne 'DOCKER_DESKTOP_LOCAL_NAMED_PIPE_ATTESTED') { Throw-Controlled 'SELF_TEST_FAILED' }
        $nonLocalDockerRejected = $false
        try { [void](Assert-DockerDesktopIdentityText -Identity 'remote-engine|Ubuntu 24.04|linux') }
        catch { $nonLocalDockerRejected = (Get-ControlledCode $_) -eq 'DOCKER_DESKTOP_ENDPOINT_INVALID' }
        if (-not $nonLocalDockerRejected) { Throw-Controlled 'SELF_TEST_FAILED' }
        $script:ResolvedDockerCliPath = $null

        $boundedPayload = Get-BoundedSqlPayload -Payload '\echo SELF_TEST'
        if (-not $boundedPayload.StartsWith("set lock_timeout='30s';`nset statement_timeout='240s';`n", [StringComparison]::Ordinal)) {
            Throw-Controlled 'SELF_TEST_FAILED'
        }

        $receiptPath = Join-Path $tempRoot 'selftest-receipt.json'
        $reservation = New-ReceiptReservation -Path $receiptPath
        Assert-ReceiptReservation -Reservation $reservation
        if (-not (Test-Path -LiteralPath ([string]$reservation.PartialPath) -PathType Leaf) -or
            (Get-Item -LiteralPath ([string]$reservation.PartialPath)).Length -ne 0) {
            Throw-Controlled 'SELF_TEST_FAILED'
        }
        Publish-ReceiptReservation -Reservation $reservation -Receipt ([ordered]@{
            operation = 'self-test'
            releaseSha = ('a' * 40)
            teardownVerified = $true
        })
        Close-ReceiptReservation -Reservation $reservation -KeepPublished $true
        $reservation = $null
        $receiptText = [IO.File]::ReadAllText($receiptPath)
        if ($receiptText -match [Regex]::Escape($secretMarker) -or $receiptText -match '(?i)postgres(?:ql)?://|password') {
            Throw-Controlled 'SELF_TEST_FAILED'
        }
        $existingRejected = $false
        try { [void](New-ReceiptReservation -Path $receiptPath) }
        catch { $existingRejected = (Get-ControlledCode $_) -eq 'OUTPUT_ALREADY_EXISTS' }
        if (-not $existingRejected) { Throw-Controlled 'SELF_TEST_FAILED' }

        $failureReceiptPath = Join-Path $tempRoot 'selftest-failure-receipt.json'
        $failureReservation = New-ReceiptReservation -Path $failureReceiptPath
        $failurePartialPath = [string]$failureReservation.PartialPath
        Assert-ReceiptReservation -Reservation $failureReservation
        Close-ReceiptReservation -Reservation $failureReservation -KeepPublished $false
        $failureReservation = $null
        if ((Test-Path -LiteralPath $failurePartialPath) -or (Test-Path -LiteralPath $failureReceiptPath)) {
            Throw-Controlled 'SELF_TEST_FAILED'
        }

        [ordered]@{
            status = 'PRODUCTION_MIGRATION_ENGINE_SELF_TEST_OK'
            receiptEndpointClassificationVerified = $true
            exactScopeAndOrderVerified = $true
            stagingBindingRejected = $true
            checkoutFlagBindingVerified = $true
            releaseBindingRejectionVerified = $true
            conflictAndUnexpectedOutputFailClosed = $true
            migrationHashBindingVerified = $true
            transactionAndLedgerAtomicityVerified = $true
            exactLedgerTupleVerified = $true
            predecessorLedgerIdentityAndDigestVerified = $true
            passwordStdinOnlyVerified = $true
            passwordFirstShellHandoffVerified = $true
            remainingSqlStdinVerified = $true
            zeroAndOneMarkerHandlingVerified = $true
            clientTlsConninfoVerified = $true
            noSecretArgumentsEnvironmentOrFilesVerified = $true
            forbiddenEnvironmentRejectionVerified = $true
            childEnvironmentScrubbingVerified = $true
            dockerDesktopNamedPipeBindingVerified = $true
            serverTimeoutBoundsVerified = $true
            atomicReceiptVerified = $true
            longLivedReceiptReservationVerified = $true
            failedReceiptReservationCleanupVerified = $true
            migrationHashes = $migrationHashes
        } | ConvertTo-Json -Compress
    }
    finally {
        if ($null -ne $credential) { $credential.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
        if ($null -ne $reservation) {
            try { Close-ReceiptReservation -Reservation $reservation -KeepPublished $false } catch {}
        }
        if ($null -ne $failureReservation) {
            try { Close-ReceiptReservation -Reservation $failureReservation -KeepPublished $false } catch {}
        }
        foreach ($name in $originalChildEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $originalChildEnvironment[$name], 'Process')
        }
        $script:ResolvedDockerCliPath = $null
        if ($null -ne $secretChars) { [Array]::Clear($secretChars, 0, $secretChars.Length) }
        if (Test-Path -LiteralPath $tempRoot) {
            $cleanupTarget = [IO.Path]::GetFullPath($tempRoot)
            $cleanupParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
            if (-not $cleanupTarget.StartsWith($cleanupParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'SELF_TEST_CLEANUP_PATH_INVALID' }
            Remove-Item -LiteralPath $cleanupTarget -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

try {
    . (Join-Path $PSScriptRoot 'lib/ProductionDatabaseGuard.ps1')
    if ($Mode -ne 'SelfTest') {
        $script:ApprovedManifest = Read-ApprovedProductionDatabaseManifest -Path $ApprovedManifestPath -ExpectedSha256 $ApprovedManifestSha256 -RepositoryRoot $script:RepoRoot -Operation 'Apply'
        Assert-ProductionSourceHashes -Manifest $script:ApprovedManifest -RepositoryRoot $script:RepoRoot
        $script:ProjectRef = $script:ApprovedManifest.projectRef
        $script:DatabaseHost = $script:ApprovedManifest.host
        $script:DatabasePort = [string]$script:ApprovedManifest.port
        $script:DatabaseName = $script:ApprovedManifest.database
        $script:LoginUser = $script:ApprovedManifest.loginUser
        $script:CurrentUser = $script:ApprovedManifest.currentUser
        $script:CaSha256 = $script:ApprovedManifest.caSha256.ToUpperInvariant()
        $script:PreSchemaVersion = $script:ApprovedManifest.expectedSchemaVersion
        $script:PostSchemaVersion = $script:ApprovedManifest.postSchemaVersion
        $script:PredecessorLedgerPlan = @($script:ApprovedManifest.expectedLedger)
        $script:PublishedPredecessorPaths = @()
        $script:MigrationPlan = @($script:ApprovedManifest.migrations | ForEach-Object {
            [ordered]@{ version=$_.version; name=$_.name; relativePath=$_.relativePath; checkpoint=$_.checkpoint;
                predecessor=$_.predecessor; predecessorCheckpoint=$_.predecessorCheckpoint; marker="PRODUCTION_MIGRATION_$($_.version)_APPLIED" }
        })
    }
    Assert-WindowsRuntime
    switch ($Mode) {
        'SelfTest' { Invoke-SelfTest }
        'Apply' { Invoke-Apply }
    }
}
catch {
    [Console]::Error.WriteLine((Get-ControlledCode $_))
    exit 1
}

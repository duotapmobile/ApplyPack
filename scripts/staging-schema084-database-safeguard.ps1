[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Backup', 'Restore', 'SelfTest')]
    [string]$Mode,

    [string]$BackupPath,
    [string]$ReceiptPath,
    [string]$CaCertificatePath,
    [string]$DockerExecutable = 'docker'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:ProjectRef = 'fmugizadzdnqfckujqlw'
$script:DatabaseHost = 'aws-0-us-west-2.pooler.supabase.com'
$script:DatabasePort = '5432'
$script:DatabaseName = 'postgres'
$script:LoginUser = 'postgres.fmugizadzdnqfckujqlw'
$script:CurrentUser = 'postgres'
$script:RestoreDatabaseName = 'applypack_restore_drill'
$script:RestoreDatabaseUser = 'supabase_admin'
$script:RestoreDatabaseCreateSql = 'create database applypack_restore_drill with template template0 owner supabase_admin'
$script:ExpectedSchemaVersion = '202610190084'
$script:MinimumPostgresServerVersionNum = 170006
$script:CaSha256 = '700723581420DD1AC98FD7E9AC529F0EF210EADCAF87FC868A3AD7D114C2F3B7'
$script:PostgresImage = 'public.ecr.aws/supabase/postgres:17.6.1.166'
$script:PostgresImageDigest = 'public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86'
$script:SourceConninfoBegin = 'APPLYPACK_SOURCE_CONNINFO_BEGIN'
$script:SourceConninfoEnd = 'APPLYPACK_SOURCE_CONNINFO_END'
$script:ClientTlsLinePattern = '^SSL connection \(protocol: TLSv1\.[23], cipher: [A-Za-z0-9_-]+, compression: (?:off|no)(?:, ALPN: [A-Za-z0-9_-]+|)\)$'
$script:EnvelopeSource = Join-Path $PSScriptRoot 'lib\ApplyPackStagingBackupEnvelope.cs'
$script:PublicErrorCodes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
@(
    'WINDOWS_REQUIRED', 'POWERSHELL_7_REQUIRED', 'ENVELOPE_HELPER_MISSING',
    'OUTPUT_PATH_MUST_BE_ABSOLUTE', 'GIT_WORKTREE_DISCOVERY_FAILED', 'OUTPUT_EXTENSION_INVALID',
    'OUTPUT_ALREADY_EXISTS', 'OUTPUT_PARENT_MISSING', 'OUTPUT_INSIDE_GIT_WORKTREE',
    'OUTPUT_REPARSE_PATH_REJECTED', 'OUTPUT_DIRECTORY_OPEN_FAILED',
    'OUTPUT_DIRECTORY_IDENTITY_CHANGED', 'OUTPUT_IDENTITY_QUERY_FAILED',
    'OUTPUT_FILE_HANDLE_INVALID', 'OUTPUT_FILE_NAME_INVALID', 'OUTPUT_FILE_IDENTITY_CHANGED',
    'OUTPUT_HANDLE_CLEANUP_FAILED', 'ATOMIC_OUTPUT_MISSING', 'STAGING_BINDING_INVALID',
    'CHECKOUT_FLAG_NOT_FALSE', 'NATIVE_COMMAND_FAILED', 'RELEASE_SHA_UNAVAILABLE',
    'RELEASE_SHA_INVALID', 'RELEASE_SHA_BINDING_INVALID', 'SAFEGUARD_SOURCE_NOT_TRACKED',
    'SAFEGUARD_SOURCE_NOT_AT_RELEASE_SHA', 'CA_PATH_REQUIRED', 'CA_FILE_MISSING', 'CA_HASH_MISMATCH',
    'CA_PATH_INVALID', 'PINNED_IMAGE_MISSING', 'PINNED_IMAGE_INSPECT_INVALID',
    'PINNED_IMAGE_DIGEST_MISMATCH', 'PG_DUMP_VERSION_CHECK_FAILED', 'PG_DUMP_VERSION_MISMATCH',
    'CREDENTIAL_NOT_FOUND', 'CREDENTIAL_TARGET_MISMATCH', 'CREDENTIAL_SECRET_INVALID',
    'CREDENTIAL_TARGET_INVALID', 'CREDENTIAL_IDENTITY_INVALID', 'DATABASE_ATTESTATION_FAILED',
    'DATABASE_EVIDENCE_INVALID', 'SOURCE_EVIDENCE_INVALID', 'OUTPUT_PATHS_REQUIRED',
    'OUTPUT_PATHS_MUST_DIFFER', 'BACKUP_PROCESS_START_FAILED', 'BACKUP_CREDENTIAL_PIPE_FAILED',
    'BACKUP_STREAM_FAILED', 'BACKUP_PROCESS_TEARDOWN_FAILED', 'BACKUP_CONTAINER_TEARDOWN_FAILED',
    'PG_DUMP_FAILED', 'BACKUP_FILE_INVALID',
    'ENVELOPE_METADATA_INVALID', 'ENVELOPE_BINDING_INVALID', 'ENVELOPE_RELEASE_SHA_MISMATCH', 'PG_RESTORE_LIST_FAILED',
    'RESTORE_CONTAINER_START_FAILED', 'RESTORE_CONTAINER_START_INVALID', 'RESTORE_CONTAINER_NOT_READY',
    'RESTORE_DATABASE_CREATE_FAILED',
    'PG_RESTORE_FAILED', 'RESTORE_EVIDENCE_QUERY_FAILED', 'RESTORE_EVIDENCE_INVALID',
    'RESTORE_AGGREGATE_MISMATCH', 'RESTORE_INTEGRITY_INVALID', 'RESTORE_CONTAINER_TEARDOWN_FAILED',
    'DPAPI_INPUT_INVALID', 'DPAPI_PROTECT_FAILED', 'DPAPI_UNPROTECT_FAILED',
    'PLAINTEXT_STREAM_INVALID', 'ENVELOPE_STREAM_INVALID', 'ENVELOPE_METADATA_TOO_LARGE',
    'ENVELOPE_TRUNCATED', 'ENVELOPE_MAGIC_INVALID', 'ENVELOPE_FORMAT_INVALID',
    'ENVELOPE_KEY_INVALID', 'ENVELOPE_KEY_UNAVAILABLE', 'ENVELOPE_AUTHENTICATION_FAILED',
    'PLAINTEXT_DESTINATION_INVALID',
    'SELF_TEST_METADATA_FAILED', 'SELF_TEST_ROUNDTRIP_FAILED', 'SELF_TEST_TAMPER_FAILED',
    'SELF_TEST_TRUNCATION_FAILED', 'SELF_TEST_PATH_REJECTION_FAILED',
    'SELF_TEST_LOG_REDACTION_FAILED', 'SELF_TEST_FAILURE_CLEANUP_FAILED',
    'SELF_TEST_PROCESS_CLEANUP_FAILED', 'SELF_TEST_PATH_RACE_FAILED',
    'SELF_TEST_RELEASE_BINDING_FAILED', 'SELF_TEST_RESTORE_PRECEDENCE_FAILED',
    'SELF_TEST_SOURCE_VERSION_FAILED', 'SELF_TEST_READINESS_SCHEMA_FAILED', 'SELF_TEST_CLIENT_TLS_FAILED',
    'SELF_TEST_RESTORE_IDENTITY_FAILED',
    'SELF_TEST_CREDENTIAL_INVALID', 'SAFEGUARD_FAILED'
) | ForEach-Object { [void]$script:PublicErrorCodes.Add($_) }

function Throw-Controlled {
    param([Parameter(Mandatory = $true)][string]$Code)
    if ($Code -notmatch '^[A-Z][A-Z0-9_]+$') { throw 'SAFEGUARD_FAILED' }
    throw $Code
}

function Get-ControlledCode {
    param([Parameter(Mandatory = $true)][Management.Automation.ErrorRecord]$Record)
    $exception = $Record.Exception
    while ($null -ne $exception) {
        if ($script:PublicErrorCodes.Contains($exception.Message)) { return $exception.Message }
        $exception = $exception.InnerException
    }
    return 'SAFEGUARD_FAILED'
}

function New-ControlledOperationException {
    param(
        [Parameter(Mandatory = $true)][string]$PrimaryCode,
        [Exception]$Cause,
        [string]$CleanupCode
    )
    if (-not $script:PublicErrorCodes.Contains($PrimaryCode)) { $PrimaryCode = 'SAFEGUARD_FAILED' }
    $exception = [InvalidOperationException]::new($PrimaryCode, $Cause)
    if (-not [string]::IsNullOrWhiteSpace($CleanupCode)) {
        if (-not $script:PublicErrorCodes.Contains($CleanupCode)) { $CleanupCode = 'SAFEGUARD_FAILED' }
        $exception.Data['ApplyPackCleanupCode'] = $CleanupCode
    }
    return $exception
}

function Resolve-OperationFailures {
    param(
        [Management.Automation.ErrorRecord]$PrimaryFailure,
        [Management.Automation.ErrorRecord]$CleanupFailure,
        [string]$PrimaryFallback = 'SAFEGUARD_FAILED',
        [string]$CleanupFallback = 'SAFEGUARD_FAILED'
    )
    if ($null -ne $PrimaryFailure) {
        $primaryCode = Get-ControlledCode $PrimaryFailure
        if ($primaryCode -eq 'SAFEGUARD_FAILED') { $primaryCode = $PrimaryFallback }
        $cleanupCode = $null
        $attachedCleanup = $PrimaryFailure.Exception.Data['ApplyPackCleanupCode']
        if ($attachedCleanup -is [string] -and $script:PublicErrorCodes.Contains($attachedCleanup)) {
            $cleanupCode = $attachedCleanup
        }
        if ($null -ne $CleanupFailure) {
            $cleanupCode = Get-ControlledCode $CleanupFailure
            if ($cleanupCode -eq 'SAFEGUARD_FAILED') { $cleanupCode = $CleanupFallback }
        }
        throw (New-ControlledOperationException -PrimaryCode $primaryCode -Cause $PrimaryFailure.Exception -CleanupCode $cleanupCode)
    }
    if ($null -ne $CleanupFailure) {
        $cleanupCode = Get-ControlledCode $CleanupFailure
        if ($cleanupCode -eq 'SAFEGUARD_FAILED') { $cleanupCode = $CleanupFallback }
        throw (New-ControlledOperationException -PrimaryCode $cleanupCode -Cause $CleanupFailure.Exception)
    }
}

function Assert-WindowsRuntime {
    if (-not $IsWindows) { Throw-Controlled 'WINDOWS_REQUIRED' }
    if ($PSVersionTable.PSVersion.Major -lt 7) { Throw-Controlled 'POWERSHELL_7_REQUIRED' }
    if (-not (Test-Path -LiteralPath $script:EnvelopeSource -PathType Leaf)) {
        Throw-Controlled 'ENVELOPE_HELPER_MISSING'
    }
    Add-Type -Path $script:EnvelopeSource
}

function Get-FullPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathFullyQualified($Path)) {
        Throw-Controlled 'OUTPUT_PATH_MUST_BE_ABSOLUTE'
    }
    return [IO.Path]::GetFullPath($Path)
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Root
    )
    $candidateFull = [IO.Path]::GetFullPath($Candidate).TrimEnd('\') + '\'
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    return $candidateFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)
}

function Get-WorktreeRoots {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = 'git'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in @('-C', $script:RepoRoot, 'worktree', 'list', '--porcelain')) {
        [void]$start.ArgumentList.Add($argument)
    }
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    $process.WaitForExit()
    [void]$stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { Throw-Controlled 'GIT_WORKTREE_DISCOVERY_FAILED' }
    return @(
        $stdout -split "`r?`n" |
            Where-Object { $_.StartsWith('worktree ', [StringComparison]::Ordinal) } |
            ForEach-Object { [IO.Path]::GetFullPath($_.Substring(9)) }
    )
}

function Test-IsGitRepository {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)
    $start = New-ProcessStartInfo -FileName 'git' -Arguments @(
        '-C', $DirectoryPath, 'rev-parse', '--git-dir'
    ) -RedirectOutput $true
    $process = $null
    $stdoutTask = $null
    $stderrTask = $null
    try {
        $process = [Diagnostics.Process]::Start($start)
        $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        if (-not $process.WaitForExit(15000)) { Throw-Controlled 'GIT_WORKTREE_DISCOVERY_FAILED' }
        $exitCode = $process.ExitCode
        if (-not (Complete-RedirectedProcess -Process $process -StandardErrorTask $stderrTask -StandardOutputTask $stdoutTask -ForceTermination $false)) {
            $process = $null
            Throw-Controlled 'GIT_WORKTREE_DISCOVERY_FAILED'
        }
        $process = $null
        return $exitCode -eq 0
    }
    catch {
        if ($null -ne $process) {
            [void](Complete-RedirectedProcess -Process $process -StandardErrorTask $stderrTask -StandardOutputTask $stdoutTask -ForceTermination $true)
        }
        $code = Get-ControlledCode $_
        if ($code -eq 'SAFEGUARD_FAILED') { Throw-Controlled 'GIT_WORKTREE_DISCOVERY_FAILED' }
        throw
    }
}

function Assert-DirectoryOutsideRepositories {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)
    $directory = [IO.Path]::GetFullPath($DirectoryPath)
    foreach ($worktree in (Get-WorktreeRoots)) {
        if (Test-PathWithin -Candidate $directory -Root $worktree) {
            Throw-Controlled 'OUTPUT_INSIDE_GIT_WORKTREE'
        }
    }
    $cursor = [IO.DirectoryInfo]::new($directory)
    while ($null -ne $cursor) {
        $cursor.Refresh()
        if (-not $cursor.Exists) { Throw-Controlled 'OUTPUT_DIRECTORY_IDENTITY_CHANGED' }
        if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Throw-Controlled 'OUTPUT_REPARSE_PATH_REJECTED'
        }
        if ((Test-Path -LiteralPath (Join-Path $cursor.FullName '.git')) -or
            (Test-IsGitRepository -DirectoryPath $cursor.FullName)) {
            Throw-Controlled 'OUTPUT_INSIDE_GIT_WORKTREE'
        }
        $cursor = $cursor.Parent
    }
}

function Assert-GuardedOutputDirectory {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.Security.OutputDirectoryGuard]$Guard,
        [string]$ExpectedIdentityToken,
        [string]$ExpectedFinalPath
    )
    if (-not [string]::IsNullOrWhiteSpace($ExpectedIdentityToken) -or
        -not [string]::IsNullOrWhiteSpace($ExpectedFinalPath)) {
        $Guard.AssertIdentity($ExpectedIdentityToken, $ExpectedFinalPath)
    }
    else {
        $Guard.AssertUnchanged()
    }
    Assert-DirectoryOutsideRepositories -DirectoryPath $Guard.FinalPath
    $Guard.AssertUnchanged()
}

function Assert-SafeOutputPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedExtension
    )
    $fullPath = Get-FullPath $Path
    if (-not [string]::Equals([IO.Path]::GetExtension($fullPath), $ExpectedExtension, [StringComparison]::OrdinalIgnoreCase)) {
        Throw-Controlled 'OUTPUT_EXTENSION_INVALID'
    }
    if (Test-Path -LiteralPath $fullPath) { Throw-Controlled 'OUTPUT_ALREADY_EXISTS' }
    $parent = [IO.Path]::GetDirectoryName($fullPath)
    if ([string]::IsNullOrWhiteSpace($parent) -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
        Throw-Controlled 'OUTPUT_PARENT_MISSING'
    }
    $guard = [ApplyPack.Security.OutputDirectoryGuard]::Capture($parent)
    try {
        Assert-GuardedOutputDirectory -Guard $guard
        return [PSCustomObject]@{
            FullPath = $fullPath
            DirectoryFinalPath = $guard.FinalPath
            DirectoryIdentityToken = $guard.IdentityToken
        }
    }
    finally { $guard.Dispose() }
}

function Invoke-AtomicFile {
    param(
        [Parameter(Mandatory = $true)]$Target,
        [Parameter(Mandatory = $true)][scriptblock]$Writer
    )
    $FinalPath = [string]$Target.FullPath
    $parent = [IO.Path]::GetDirectoryName($FinalPath)
    $temporaryLeaf = "$([IO.Path]::GetFileName($FinalPath)).partial-$([Guid]::NewGuid().ToString('N'))"
    $temporaryPath = Join-Path $parent $temporaryLeaf
    $guard = [ApplyPack.Security.OutputDirectoryGuard]::Capture($parent)
    $stream = $null
    $completed = $false
    $primaryFailure = $null
    $cleanupFailure = $null
    try {
        Assert-GuardedOutputDirectory `
            -Guard $guard `
            -ExpectedIdentityToken ([string]$Target.DirectoryIdentityToken) `
            -ExpectedFinalPath ([string]$Target.DirectoryFinalPath)
        $stream = [IO.FileStream]::new(
            $temporaryPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::Delete,
            65536,
            [IO.FileOptions]::WriteThrough
        )
        $guard.AssertFileIsDirectChild($stream.SafeFileHandle, $temporaryLeaf)
        & $Writer $stream
        $stream.Flush($true)
        Assert-GuardedOutputDirectory `
            -Guard $guard `
            -ExpectedIdentityToken ([string]$Target.DirectoryIdentityToken) `
            -ExpectedFinalPath ([string]$Target.DirectoryFinalPath)
        $guard.AssertFileIsDirectChild($stream.SafeFileHandle, $temporaryLeaf)
        if (Test-Path -LiteralPath $FinalPath) { Throw-Controlled 'OUTPUT_ALREADY_EXISTS' }
        [IO.File]::Move($temporaryPath, $FinalPath)
        $guard.AssertFileIsDirectChild($stream.SafeFileHandle, [IO.Path]::GetFileName($FinalPath))
        $completed = $true
    }
    catch { $primaryFailure = $_ }
    finally {
        if ($null -ne $stream) {
            if (-not $completed) {
                $deleteHandle = $null
                try {
                    $deleteHandle = [ApplyPack.Security.OutputDirectoryGuard]::OpenRegularFileForDeletion($temporaryPath)
                    $guard.AssertFileIsDirectChild($deleteHandle, $temporaryLeaf)
                    [ApplyPack.Security.OutputDirectoryGuard]::MarkDeleteOnClose($deleteHandle)
                }
                catch { $cleanupFailure = $_ }
                finally { if ($null -ne $deleteHandle) { $deleteHandle.Dispose() } }
            }
            try { $stream.Dispose() } catch { if ($null -eq $cleanupFailure) { $cleanupFailure = $_ } }
        }
        try { $guard.Dispose() } catch { if ($null -eq $cleanupFailure) { $cleanupFailure = $_ } }
    }
    Resolve-OperationFailures `
        -PrimaryFailure $primaryFailure `
        -CleanupFailure $cleanupFailure `
        -PrimaryFallback 'SAFEGUARD_FAILED' `
        -CleanupFallback 'OUTPUT_HANDLE_CLEANUP_FAILED'
}

function Remove-VerifiedOutputFile {
    param([Parameter(Mandatory = $true)]$Target)
    $Path = [string]$Target.FullPath
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $parent = [IO.Path]::GetDirectoryName($Path)
    $guard = [ApplyPack.Security.OutputDirectoryGuard]::Capture($parent)
    $deleteHandle = $null
    try {
        Assert-GuardedOutputDirectory `
            -Guard $guard `
            -ExpectedIdentityToken ([string]$Target.DirectoryIdentityToken) `
            -ExpectedFinalPath ([string]$Target.DirectoryFinalPath)
        $deleteHandle = [ApplyPack.Security.OutputDirectoryGuard]::OpenRegularFileForDeletion($Path)
        $guard.AssertFileIsDirectChild($deleteHandle, [IO.Path]::GetFileName($Path))
        [ApplyPack.Security.OutputDirectoryGuard]::MarkDeleteOnClose($deleteHandle)
    }
    finally {
        if ($null -ne $deleteHandle) { $deleteHandle.Dispose() }
        $guard.Dispose()
    }
}

function Assert-StagingBinding {
    $expected = [ordered]@{
        AP_DEPLOYMENT_ENV = 'staging'
        AP_PREMIGRATION_EXPECTED_PROJECT_REF = $script:ProjectRef
        AP_PREMIGRATION_EXPECTED_HOST = $script:DatabaseHost
        AP_PREMIGRATION_EXPECTED_PORT = $script:DatabasePort
        AP_PREMIGRATION_EXPECTED_DATABASE = $script:DatabaseName
        AP_PREMIGRATION_EXPECTED_LOGIN_USER = $script:LoginUser
        AP_PREMIGRATION_EXPECTED_CURRENT_USER = $script:CurrentUser
    }
    foreach ($entry in $expected.GetEnumerator()) {
        $actual = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
        if (-not [string]::Equals($actual, $entry.Value, [StringComparison]::Ordinal)) {
            Throw-Controlled 'STAGING_BINDING_INVALID'
        }
    }
    foreach ($flag in @('APP_CHECKOUT_ENABLED', 'APP_CANARY_CHECKOUT_ENABLED', 'APP_REHEARSAL_CHECKOUT_ENABLED', 'APP_LIVE_PAYMENTS_ENABLED', 'APP_JOB_BOARD_CHECKOUT_ENABLED', 'APP_JOB_SOURCE_SYNC_ENABLED')) {
        $value = [Environment]::GetEnvironmentVariable($flag, 'Process')
        if (-not [string]::Equals($value, 'false', [StringComparison]::Ordinal)) {
            Throw-Controlled 'CHECKOUT_FLAG_NOT_FALSE'
        }
    }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Get-StreamSha256 {
    param([Parameter(Mandatory = $true)][IO.FileStream]$Stream)
    $Stream.Position = 0
    $hash = [Security.Cryptography.SHA256]::HashData($Stream)
    try { return [Convert]::ToHexString($hash) }
    finally {
        [Array]::Clear($hash, 0, $hash.Length)
        $Stream.Position = 0
    }
}

function New-ProcessStartInfo {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [bool]$RedirectInput = $false,
        [bool]$RedirectOutput = $false
    )
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $FileName
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $RedirectInput
    $start.RedirectStandardOutput = $RedirectOutput
    $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { [void]$start.ArgumentList.Add($argument) }
    return $start
}

function Invoke-SafeNativeText {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$FailureCode = 'NATIVE_COMMAND_FAILED'
    )
    $process = [Diagnostics.Process]::Start((New-ProcessStartInfo -FileName $FileName -Arguments $Arguments -RedirectOutput $true))
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    $process.WaitForExit()
    [void]$stderrTask.GetAwaiter().GetResult()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { Throw-Controlled $FailureCode }
    return $stdout.Trim()
}

function Complete-RedirectedProcess {
    param(
        [Diagnostics.Process]$Process,
        [Threading.Tasks.Task]$StandardErrorTask,
        [Threading.Tasks.Task]$StandardOutputTask,
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
    foreach ($task in @($StandardErrorTask, $StandardOutputTask)) {
        if ($null -eq $task) { continue }
        try { if (-not $task.Wait(15000)) { $clean = $false } } catch { $clean = $false }
    }
    try { $Process.StandardOutput.Dispose() } catch {}
    try { $Process.StandardError.Dispose() } catch {}
    try { $Process.StandardInput.Dispose() } catch {}
    $Process.Dispose()
    return $clean
}

function Invoke-NativeDiscarded {
    param(
        [Parameter(Mandatory = $true)][string]$FileName,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    $process = $null
    $stdoutTask = $null
    $stderrTask = $null
    try {
        $start = New-ProcessStartInfo -FileName $FileName -Arguments $Arguments -RedirectOutput $true
        $process = [Diagnostics.Process]::Start($start)
        $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        if (-not $process.WaitForExit(15000)) { Throw-Controlled $FailureCode }
        $exitCode = $process.ExitCode
        if (-not (Complete-RedirectedProcess -Process $process -StandardErrorTask $stderrTask -StandardOutputTask $stdoutTask -ForceTermination $false)) {
            $process = $null
            Throw-Controlled $FailureCode
        }
        $process = $null
        return $exitCode
    }
    catch {
        if ($null -ne $process) {
            [void](Complete-RedirectedProcess -Process $process -StandardErrorTask $stderrTask -StandardOutputTask $stdoutTask -ForceTermination $true)
        }
        $code = Get-ControlledCode $_
        if ($code -eq 'SAFEGUARD_FAILED') { Throw-Controlled $FailureCode }
        throw
    }
}

function Ensure-ContainerAbsent {
    param(
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [Parameter(Mandatory = $true)][string]$FailureCode,
        [scriptblock]$CleanupOverride
    )
    if ($null -ne $CleanupOverride) {
        & $CleanupOverride $ContainerName
        return
    }
    try {
        [void](Invoke-NativeDiscarded -FileName $DockerExecutable -Arguments @(
            'rm', '--force', $ContainerName
        ) -FailureCode $FailureCode)
    }
    catch {
        # Absence verification below is authoritative. A remove command failure
        # does not fail cleanup if the independent listing proves no container remains.
    }
    $remaining = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
        'ps', '--all', '--filter', "name=^/$ContainerName$", '--format', '{{.Names}}'
    ) -FailureCode $FailureCode
    if (-not [string]::IsNullOrWhiteSpace($remaining)) { Throw-Controlled $FailureCode }
}

function Get-CleanReleaseSha {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$ExpectedSha,
        [Parameter(Mandatory = $true)][string[]]$RequiredPaths
    )
    $sha = Invoke-SafeNativeText -FileName 'git' -Arguments @('-C', $RepositoryRoot, 'rev-parse', 'HEAD') -FailureCode 'RELEASE_SHA_UNAVAILABLE'
    if ($sha -notmatch '^[0-9a-f]{40}$') { Throw-Controlled 'RELEASE_SHA_INVALID' }
    if ($ExpectedSha -notmatch '^[0-9a-f]{40}$' -or
        -not [string]::Equals($sha, $ExpectedSha, [StringComparison]::Ordinal)) {
        Throw-Controlled 'RELEASE_SHA_BINDING_INVALID'
    }
    foreach ($path in $RequiredPaths) {
        [void](Invoke-SafeNativeText -FileName 'git' -Arguments @(
            '-C', $RepositoryRoot, 'ls-files', '--error-unmatch', '--', $path
        ) -FailureCode 'SAFEGUARD_SOURCE_NOT_TRACKED')
        $start = New-ProcessStartInfo -FileName 'git' -Arguments @(
            '-C', $RepositoryRoot, 'diff', '--quiet', 'HEAD', '--', $path
        )
        $process = [Diagnostics.Process]::Start($start)
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        $process.WaitForExit(); [void]$stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { Throw-Controlled 'SAFEGUARD_SOURCE_NOT_AT_RELEASE_SHA' }
    }
    return $sha
}

function Get-ReleaseSha {
    return Get-CleanReleaseSha `
        -RepositoryRoot $script:RepoRoot `
        -ExpectedSha ([Environment]::GetEnvironmentVariable('AP_PREMIGRATION_EXPECTED_RELEASE_SHA', 'Process')) `
        -RequiredPaths @(
            'scripts/staging-schema084-database-safeguard.ps1',
            'scripts/lib/ApplyPackStagingBackupEnvelope.cs'
        )
}

function Assert-EnvelopeReleaseBinding {
    param(
        [Parameter(Mandatory = $true)]$Metadata,
        [Parameter(Mandatory = $true)][string]$ReleaseSha
    )
    if ($Metadata.releaseSha -notmatch '^[0-9a-f]{40}$' -or
        -not [string]::Equals([string]$Metadata.releaseSha, $ReleaseSha, [StringComparison]::Ordinal)) {
        Throw-Controlled 'ENVELOPE_RELEASE_SHA_MISMATCH'
    }
}

function Assert-CaCertificate {
    if ([string]::IsNullOrWhiteSpace($CaCertificatePath)) { Throw-Controlled 'CA_PATH_REQUIRED' }
    $path = Get-FullPath $CaCertificatePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Throw-Controlled 'CA_FILE_MISSING' }
    if ((Get-Sha256 $path) -ne $script:CaSha256) { Throw-Controlled 'CA_HASH_MISMATCH' }
    if ($path.Contains(',')) { Throw-Controlled 'CA_PATH_INVALID' }
    return $path
}

function Assert-PinnedImage {
    $digestsJson = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
        'image', 'inspect', '--format', '{{json .RepoDigests}}', $script:PostgresImage
    ) -FailureCode 'PINNED_IMAGE_MISSING'
    try { $digests = @($digestsJson | ConvertFrom-Json) } catch { Throw-Controlled 'PINNED_IMAGE_INSPECT_INVALID' }
    if ($script:PostgresImageDigest -notin $digests) { Throw-Controlled 'PINNED_IMAGE_DIGEST_MISMATCH' }
    $version = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
        'run', '--rm', '--network', 'none', '--pull', 'never', '--entrypoint', 'pg_dump',
        $script:PostgresImage, '--version'
    ) -FailureCode 'PG_DUMP_VERSION_CHECK_FAILED'
    if ($version -notmatch '^pg_dump \(PostgreSQL\) 17\.6(?:\s|$)') { Throw-Controlled 'PG_DUMP_VERSION_MISMATCH' }
    return $version
}

function Get-SourceEvidenceSql {
    return @"
with public_tables as materialized (
  select n.nspname as schema_name, c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
), table_counts as materialized (
  select table_name,
    ((xpath(
      '//row_count/text()',
      query_to_xml(
        format('select count(*)::bigint as row_count from %I.%I', schema_name, table_name),
        false,
        true,
        ''
      )
    ))[1]::text)::bigint as row_count
  from public_tables
)
select json_build_object(
  'database', current_database(),
  'currentUser', current_user,
  'ssl', coalesce((select ssl from pg_stat_ssl where pid = pg_backend_pid()), false),
  'serverVersionNum', current_setting('server_version_num')::integer,
  'publicTableCount', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
  'rlsEnabledTableCount', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity),
  'rlsPolicyCount', (select count(*) from pg_policies where schemaname='public'),
  'publicTriggerCount', (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
  'publicFunctionCount', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
  'invalidIndexCount', (select count(*) from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not i.indisvalid),
  'migrationCount', (select count(*) from supabase_migrations.schema_migrations),
  'latestMigration', (select max(version) from supabase_migrations.schema_migrations),
  'migration080Present', (select exists(select 1 from supabase_migrations.schema_migrations where version='202610040080')),
  'migrations081084Count', (select count(*) from supabase_migrations.schema_migrations where version in ('202610190081','202610190082','202610190083','202610190084')),
  'tableRowCounts', (select coalesce(jsonb_object_agg(table_name, row_count order by table_name), '{}'::jsonb) from table_counts),
  'readiness', public.ap_manual_launch_schema_readiness()
)::text;
"@
}

function Add-RowCountDigest {
    param([Parameter(Mandatory = $true)]$Evidence)
    if ($null -eq $Evidence.tableRowCounts) { Throw-Controlled 'DATABASE_EVIDENCE_INVALID' }
    $canonical = [ordered]@{}
    foreach ($property in @($Evidence.tableRowCounts.PSObject.Properties | Sort-Object Name)) {
        $canonical[$property.Name] = [long]$property.Value
    }
    if ($canonical.Count -eq 0) { Throw-Controlled 'DATABASE_EVIDENCE_INVALID' }
    $json = $canonical | ConvertTo-Json -Compress
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    try {
        $hash = [Security.Cryptography.SHA256]::HashData($bytes)
        try { $digest = [Convert]::ToHexString($hash).ToLowerInvariant() }
        finally { [Array]::Clear($hash, 0, $hash.Length) }
    }
    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
    $Evidence | Add-Member -NotePropertyName tableRowCountSha256 -NotePropertyValue $digest -Force
    return $Evidence
}

function Get-DockerConnectionArguments {
    param(
        [Parameter(Mandatory = $true)][string]$CaPath,
        [Parameter(Mandatory = $true)][string]$Tool,
        [string]$ContainerName,
        [Parameter(Mandatory = $true)][string[]]$ToolArguments
    )
    $shell = 'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGSSLMODE=verify-full; export PGSSLROOTCERT=/certs/root.crt; export PGCONNECT_TIMEOUT=15; exec "$@"'
    $arguments = @('run', '--rm', '-i', '--pull', 'never')
    if (-not [string]::IsNullOrWhiteSpace($ContainerName)) { $arguments += @('--name', $ContainerName) }
    return $arguments + @(
        '--volume', "${CaPath}:/certs/root.crt:ro",
        '--entrypoint', 'sh', $script:PostgresImage,
        '-ec', $shell, '--', $Tool
    ) + $ToolArguments
}

function Invoke-CredentialedText {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.Security.CredentialMaterial]$Credential,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    $process = $null
    $stdoutTask = $null
    $stderrTask = $null
    $primaryFailure = $null
    $cleanupFailure = $null
    $stdout = $null
    try {
        $process = [Diagnostics.Process]::Start((New-ProcessStartInfo -FileName $DockerExecutable -Arguments $Arguments -RedirectInput $true -RedirectOutput $true))
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        $Credential.WriteUtf8LineTo($process.StandardInput.BaseStream)
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(30000)) { Throw-Controlled $FailureCode }
        $exitCode = $process.ExitCode
        $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
        if ($exitCode -ne 0) { Throw-Controlled $FailureCode }
    }
    catch { $primaryFailure = $_ }
    finally {
        if ($null -ne $process) {
            if (-not (Complete-RedirectedProcess -Process $process -StandardErrorTask $stderrTask -StandardOutputTask $stdoutTask -ForceTermination ($null -ne $primaryFailure))) {
                try { Throw-Controlled $FailureCode } catch { if ($null -eq $cleanupFailure) { $cleanupFailure = $_ } }
            }
        }
        try { Ensure-ContainerAbsent -ContainerName $ContainerName -FailureCode $FailureCode } catch { if ($null -eq $cleanupFailure) { $cleanupFailure = $_ } }
    }
    Resolve-OperationFailures -PrimaryFailure $primaryFailure -CleanupFailure $cleanupFailure -PrimaryFallback $FailureCode -CleanupFallback $FailureCode
    return $stdout
}

function ConvertFrom-SourceEvidenceOutput {
    param([Parameter(Mandatory = $true)][string]$Text)
    $lines = @(
        $Text -split "`r?`n" |
            ForEach-Object { $_.Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($lines.Count -ne 5 -or
        $lines[0] -ne $script:SourceConninfoBegin -or
        $lines[3] -ne $script:SourceConninfoEnd) {
        Throw-Controlled 'DATABASE_EVIDENCE_INVALID'
    }

    $connectionLinePattern = '^You are connected to database "' +
        [Regex]::Escape($script:DatabaseName) + '" as user "' +
        [Regex]::Escape($script:LoginUser) + '" on host "' +
        [Regex]::Escape($script:DatabaseHost) + '" \(address "[0-9A-Fa-f:.]+"\) at port "' +
        [Regex]::Escape($script:DatabasePort) + '"\.$'
    if ($lines[1] -notmatch $connectionLinePattern -or
        $lines[2] -notmatch $script:ClientTlsLinePattern) {
        Throw-Controlled 'DATABASE_EVIDENCE_INVALID'
    }

    try { $evidence = $lines[4] | ConvertFrom-Json }
    catch { Throw-Controlled 'DATABASE_EVIDENCE_INVALID' }
    if ($null -eq $evidence -or
        $evidence -isnot [Management.Automation.PSCustomObject] -or
        $null -ne $evidence.PSObject.Properties['clientTlsVerified']) {
        Throw-Controlled 'DATABASE_EVIDENCE_INVALID'
    }
    $evidence | Add-Member -NotePropertyName clientTlsVerified -NotePropertyValue $true
    return $evidence
}

function Invoke-EncryptedBackupProcess {
    param(
        [Parameter(Mandatory = $true)][Diagnostics.ProcessStartInfo]$StartInfo,
        [Parameter(Mandatory = $true)][ApplyPack.Security.CredentialMaterial]$Credential,
        [Parameter(Mandatory = $true)][IO.Stream]$Destination,
        [Parameter(Mandatory = $true)][string]$MetadataJson,
        [Parameter(Mandatory = $true)][string]$ContainerName,
        [scriptblock]$ContainerCleanupOverride
    )
    $process = $null
    $stderrTask = $null
    $stdoutDrainTask = $null
    $primaryFailure = $null
    $cleanupFailure = $null
    $stageFailureCode = 'BACKUP_PROCESS_START_FAILED'
    try {
        $process = [Diagnostics.Process]::Start($StartInfo)
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        $stageFailureCode = 'BACKUP_CREDENTIAL_PIPE_FAILED'
        $Credential.WriteUtf8LineTo($process.StandardInput.BaseStream)
        $process.StandardInput.Close()
        $stageFailureCode = 'BACKUP_STREAM_FAILED'
        [ApplyPack.Security.StagingBackupEnvelope]::Encrypt($process.StandardOutput.BaseStream, $Destination, $MetadataJson)
        $Destination.Flush()
        $stageFailureCode = 'BACKUP_PROCESS_TEARDOWN_FAILED'
        if (-not $process.WaitForExit(15000)) { Throw-Controlled 'BACKUP_PROCESS_TEARDOWN_FAILED' }
        if ($process.ExitCode -ne 0) { Throw-Controlled 'PG_DUMP_FAILED' }
    }
    catch { $primaryFailure = $_ }
    finally {
        if ($null -ne $process) {
            if ($null -ne $primaryFailure) {
                try { $stdoutDrainTask = [ApplyPack.Security.StagingBackupEnvelope]::DrainAsync($process.StandardOutput.BaseStream) } catch {}
            }
            if (-not (Complete-RedirectedProcess -Process $process -StandardErrorTask $stderrTask -StandardOutputTask $stdoutDrainTask -ForceTermination ($null -ne $primaryFailure))) {
                try { Throw-Controlled 'BACKUP_PROCESS_TEARDOWN_FAILED' } catch { if ($null -eq $cleanupFailure) { $cleanupFailure = $_ } }
            }
        }
        try {
            Ensure-ContainerAbsent -ContainerName $ContainerName -FailureCode 'BACKUP_CONTAINER_TEARDOWN_FAILED' -CleanupOverride $ContainerCleanupOverride
        }
        catch { if ($null -eq $cleanupFailure) { $cleanupFailure = $_ } }
        $Credential.Dispose()
    }
    Resolve-OperationFailures `
        -PrimaryFailure $primaryFailure `
        -CleanupFailure $cleanupFailure `
        -PrimaryFallback $stageFailureCode `
        -CleanupFallback 'BACKUP_CONTAINER_TEARDOWN_FAILED'
}

function Assert-SourceEvidence {
    param([Parameter(Mandatory = $true)]$Evidence)
    if ($Evidence.database -ne $script:DatabaseName -or
        $Evidence.currentUser -ne $script:CurrentUser -or
        -not ($Evidence.ssl -is [bool]) -or
        $Evidence.clientTlsVerified -ne $true -or
        [int]$Evidence.serverVersionNum -lt $script:MinimumPostgresServerVersionNum -or
        [int]$Evidence.publicTableCount -le 0 -or
        [int]$Evidence.rlsEnabledTableCount -le 0 -or
        [int]$Evidence.rlsPolicyCount -le 0 -or
        [int]$Evidence.invalidIndexCount -ne 0 -or
        [int]$Evidence.migrationCount -le 0 -or
        $Evidence.tableRowCountSha256 -notmatch '^[0-9a-f]{64}$' -or
        $Evidence.latestMigration -ne $script:ExpectedSchemaVersion -or
        $Evidence.migration080Present -ne $true -or
        [int]$Evidence.migrations081084Count -ne 4 -or
        -not (Test-ReadinessEvidence -Evidence $Evidence)) {
        Throw-Controlled 'SOURCE_EVIDENCE_INVALID'
    }
}

function Test-ReadinessEvidence {
    param([Parameter(Mandatory = $true)]$Evidence)
    $readinessProperty = $Evidence.PSObject.Properties['readiness']
    if ($null -eq $readinessProperty -or $null -eq $readinessProperty.Value) { return $false }
    $requiredSchemaVersionProperty = $readinessProperty.Value.PSObject.Properties['requiredSchemaVersion']
    $readyProperty = $readinessProperty.Value.PSObject.Properties['ready']
    return (
        $null -ne $requiredSchemaVersionProperty -and
        $requiredSchemaVersionProperty.Value -is [string] -and
        [string]::Equals(
            $requiredSchemaVersionProperty.Value,
            $script:ExpectedSchemaVersion,
            [StringComparison]::Ordinal
        ) -and
        $null -ne $readyProperty -and
        $readyProperty.Value -is [bool] -and
        $readyProperty.Value -eq $true
    )
}

function Get-SourceEvidence {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.Security.CredentialMaterial]$Credential,
        [Parameter(Mandatory = $true)][string]$CaPath
    )
    $containerName = "applypack-staging-evidence-$([Guid]::NewGuid().ToString('N'))"
    $arguments = Get-DockerConnectionArguments -CaPath $CaPath -Tool 'psql' -ContainerName $containerName -ToolArguments @(
        '--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--set', 'ON_ERROR_STOP=1',
        '--host', $script:DatabaseHost, '--port', $script:DatabasePort,
        '--username', $script:LoginUser, '--dbname', $script:DatabaseName,
        '--command', "\echo $($script:SourceConninfoBegin)",
        '--command', '\conninfo',
        '--command', "\echo $($script:SourceConninfoEnd)",
        '--command', (Get-SourceEvidenceSql)
    )
    $text = Invoke-CredentialedText -Credential $Credential -Arguments $arguments -ContainerName $containerName -FailureCode 'DATABASE_ATTESTATION_FAILED'
    $evidence = ConvertFrom-SourceEvidenceOutput -Text $text
    $evidence = Add-RowCountDigest $evidence
    Assert-SourceEvidence $evidence
    return $evidence
}

function Write-JsonStream {
    param([Parameter(Mandatory = $true)][IO.Stream]$Stream, [Parameter(Mandatory = $true)]$Value)
    $json = $Value | ConvertTo-Json -Depth 12 -Compress
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    try {
        $Stream.Write($bytes, 0, $bytes.Length)
    }
    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function New-SanitizedMetadata {
    param(
        [Parameter(Mandatory = $true)]$Evidence,
        [Parameter(Mandatory = $true)][string]$ReleaseSha,
        [Parameter(Mandatory = $true)][string]$PgDumpVersion
    )
    return [ordered]@{
        format = 'ApplyPackStagingSchema084DatabaseBackup'
        formatVersion = 1
        createdAt = [DateTimeOffset]::UtcNow.ToString('O')
        deploymentEnvironment = 'staging'
        projectRef = $script:ProjectRef
        endpointType = 'session-pooler'
        host = $script:DatabaseHost
        port = [int]$script:DatabasePort
        database = $script:DatabaseName
        loginUser = $script:LoginUser
        expectedCurrentUser = $script:CurrentUser
        releaseSha = $ReleaseSha
        caSha256 = $script:CaSha256
        postgresImage = $script:PostgresImage
        postgresImageDigest = $script:PostgresImageDigest
        pgDumpVersion = $PgDumpVersion
        powershellVersion = $PSVersionTable.PSVersion.ToString()
        sourceEvidence = $Evidence
    }
}

function Invoke-Backup {
    $backupTarget = Assert-SafeOutputPath -Path $BackupPath -ExpectedExtension '.apdb'
    $receiptTarget = Assert-SafeOutputPath -Path $ReceiptPath -ExpectedExtension '.json'
    $resolvedBackup = [string]$backupTarget.FullPath
    $resolvedReceipt = [string]$receiptTarget.FullPath
    if ([string]::Equals($resolvedBackup, $resolvedReceipt, [StringComparison]::OrdinalIgnoreCase)) {
        Throw-Controlled 'OUTPUT_PATHS_MUST_DIFFER'
    }
    Assert-StagingBinding
    $caPath = Assert-CaCertificate
    $pgDumpVersion = Assert-PinnedImage
    $releaseSha = Get-ReleaseSha

    $credential = [ApplyPack.Security.WindowsCredentialStore]::ReadStagingDatabase()
    try {
        if ($credential.HasLineBreak -or $credential.UserName -ne $script:LoginUser) {
            Throw-Controlled 'CREDENTIAL_IDENTITY_INVALID'
        }
        $evidence = Get-SourceEvidence -Credential $credential -CaPath $caPath
        $metadata = New-SanitizedMetadata -Evidence $evidence -ReleaseSha $releaseSha -PgDumpVersion $pgDumpVersion
        $metadataJson = $metadata | ConvertTo-Json -Depth 12 -Compress
        $dumpContainerName = "applypack-staging-backup-$([Guid]::NewGuid().ToString('N'))"
        $dumpArguments = Get-DockerConnectionArguments -CaPath $caPath -Tool 'pg_dump' -ContainerName $dumpContainerName -ToolArguments @(
            '--format=custom', '--no-password', '--host', $script:DatabaseHost,
            '--port', $script:DatabasePort, '--username', $script:LoginUser, '--dbname', $script:DatabaseName
        )

        Invoke-AtomicFile -Target $backupTarget -Writer {
            param($output)
            $start = New-ProcessStartInfo -FileName $DockerExecutable -Arguments $dumpArguments -RedirectInput $true -RedirectOutput $true
            Invoke-EncryptedBackupProcess `
                -StartInfo $start `
                -Credential $credential `
                -Destination $output `
                -MetadataJson $metadataJson `
                -ContainerName $dumpContainerName
        }

        try {
            $info = [ApplyPack.Security.StagingBackupEnvelope]::AuthenticateAndReadMetadata($resolvedBackup)
            $receipt = [ordered]@{
                operation = 'staging-schema084-backup'
                completedAt = [DateTimeOffset]::UtcNow.ToString('O')
                releaseSha = $releaseSha
                envelopeSha256 = Get-Sha256 $resolvedBackup
                envelopeBytes = $info.FileLength
                ciphertextBytes = $info.CiphertextLength
                caSha256 = $script:CaSha256
                postgresImageDigest = $script:PostgresImageDigest
                sourceEvidence = $evidence
            }
            Invoke-AtomicFile -Target $receiptTarget -Writer { param($output) Write-JsonStream -Stream $output -Value $receipt }
        }
        catch {
            Remove-VerifiedOutputFile -Target $backupTarget
            throw
        }
    }
    finally { if ($null -ne $credential) { $credential.Dispose() } }
    [ordered]@{ status = 'STAGING_BACKUP_ENCRYPTED'; receiptPath = $resolvedReceipt; envelopeSha256 = Get-Sha256 $resolvedBackup } | ConvertTo-Json -Compress
}

function Invoke-DecryptToProcess {
    param(
        [Parameter(Mandatory = $true)][IO.FileStream]$EnvelopeStream,
        [Parameter(Mandatory = $true)][Diagnostics.ProcessStartInfo]$StartInfo,
        [Parameter(Mandatory = $true)][string]$FailureCode,
        [string]$EphemeralContainerName
    )
    $process = $null
    $stdoutTask = $null
    $stderrTask = $null
    $primaryFailure = $null
    $cleanupFailure = $null
    try {
        $process = [Diagnostics.Process]::Start($StartInfo)
        $stdoutTask = if ($StartInfo.RedirectStandardOutput) { $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null) } else { $null }
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        [void][ApplyPack.Security.StagingBackupEnvelope]::DecryptAuthenticated($EnvelopeStream, $process.StandardInput.BaseStream)
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(30000)) { Throw-Controlled $FailureCode }
        if ($process.ExitCode -ne 0) { Throw-Controlled $FailureCode }
    }
    catch { $primaryFailure = $_ }
    finally {
        if ($null -ne $process) {
            if (-not (Complete-RedirectedProcess -Process $process -StandardErrorTask $stderrTask -StandardOutputTask $stdoutTask -ForceTermination ($null -ne $primaryFailure))) {
                try { Throw-Controlled $FailureCode } catch { if ($null -eq $cleanupFailure) { $cleanupFailure = $_ } }
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($EphemeralContainerName)) {
            try {
                Ensure-ContainerAbsent -ContainerName $EphemeralContainerName -FailureCode $FailureCode
            }
            catch { if ($null -eq $cleanupFailure) { $cleanupFailure = $_ } }
        }
    }
    Resolve-OperationFailures -PrimaryFailure $primaryFailure -CleanupFailure $cleanupFailure -PrimaryFallback $FailureCode -CleanupFallback $FailureCode
}

function Get-RestoreEvidence {
    param([Parameter(Mandatory = $true)][string]$ContainerName)
    $query = (Get-SourceEvidenceSql) -replace "coalesce\(\(select ssl from pg_stat_ssl where pid = pg_backend_pid\(\)\), false\)", 'false'
    $text = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
        'exec', $ContainerName, 'psql', '--no-psqlrc', '--tuples-only', '--no-align', '--quiet',
        '--set', 'ON_ERROR_STOP=1', '--username', $script:RestoreDatabaseUser,
        '--dbname', $script:RestoreDatabaseName, '--command', $query
    ) -FailureCode 'RESTORE_EVIDENCE_QUERY_FAILED'
    try { $evidence = $text | ConvertFrom-Json } catch { Throw-Controlled 'RESTORE_EVIDENCE_INVALID' }
    return Add-RowCountDigest $evidence
}

function Assert-RestoreEvidence {
    param($Source, $Restored)
    $sourceReadinessValid = Test-ReadinessEvidence -Evidence $Source
    $restoredReadinessValid = Test-ReadinessEvidence -Evidence $Restored
    $readinessMatches = $false
    if ($sourceReadinessValid -and $restoredReadinessValid) {
        $readinessMatches = (
            [string]::Equals(
                $Source.readiness.requiredSchemaVersion,
                $Restored.readiness.requiredSchemaVersion,
                [StringComparison]::Ordinal
            ) -and
            $Source.readiness.ready -eq $Restored.readiness.ready
        )
    }
    foreach ($field in @(
        'publicTableCount', 'rlsEnabledTableCount', 'rlsPolicyCount', 'publicTriggerCount',
        'publicFunctionCount', 'migrationCount', 'latestMigration', 'migration080Present', 'migrations081084Count'
    )) {
        if ([string]$Source.$field -ne [string]$Restored.$field) { Throw-Controlled 'RESTORE_AGGREGATE_MISMATCH' }
    }
    if ($Source.tableRowCountSha256 -ne $Restored.tableRowCountSha256) {
        Throw-Controlled 'RESTORE_AGGREGATE_MISMATCH'
    }
    $sourceCounts = @($Source.tableRowCounts.PSObject.Properties | Sort-Object Name)
    $restoredCounts = @($Restored.tableRowCounts.PSObject.Properties | Sort-Object Name)
    if ($sourceCounts.Count -ne $restoredCounts.Count) { Throw-Controlled 'RESTORE_AGGREGATE_MISMATCH' }
    for ($index = 0; $index -lt $sourceCounts.Count; $index += 1) {
        if ($sourceCounts[$index].Name -ne $restoredCounts[$index].Name -or
            [long]$sourceCounts[$index].Value -ne [long]$restoredCounts[$index].Value) {
            Throw-Controlled 'RESTORE_AGGREGATE_MISMATCH'
        }
    }
    if ($Restored.database -isnot [string] -or
        -not [string]::Equals($Restored.database, $script:RestoreDatabaseName, [StringComparison]::Ordinal) -or
        $Restored.currentUser -isnot [string] -or
        -not [string]::Equals($Restored.currentUser, $script:RestoreDatabaseUser, [StringComparison]::Ordinal) -or
        [int]$Restored.invalidIndexCount -ne 0 -or
        $Restored.latestMigration -ne $script:ExpectedSchemaVersion -or
        $Restored.migration080Present -ne $true -or
        [int]$Restored.migrations081084Count -ne 4 -or
        -not $sourceReadinessValid -or
        -not $restoredReadinessValid -or
        -not $readinessMatches) {
        Throw-Controlled 'RESTORE_INTEGRITY_INVALID'
    }
}

function Invoke-Restore {
    Assert-StagingBinding
    $releaseSha = Get-ReleaseSha
    $resolvedBackup = Get-FullPath $BackupPath
    if (-not (Test-Path -LiteralPath $resolvedBackup -PathType Leaf) -or
        [IO.Path]::GetExtension($resolvedBackup) -ne '.apdb') { Throw-Controlled 'BACKUP_FILE_INVALID' }
    $receiptTarget = Assert-SafeOutputPath -Path $ReceiptPath -ExpectedExtension '.json'
    $resolvedReceipt = [string]$receiptTarget.FullPath
    [void](Assert-PinnedImage)
    $containerName = "applypack-staging-restore-$([Guid]::NewGuid().ToString('N'))"
    $listContainerName = "applypack-staging-restore-list-$([Guid]::NewGuid().ToString('N'))"
    $containerAttempted = $false
    $restoredEvidence = $null
    $metadata = $null
    $envelopeSha256 = $null
    $envelopeStream = $null
    $primaryFailure = $null
    $cleanupFailure = $null
    try {
        $envelopeStream = [IO.FileStream]::new(
            $resolvedBackup,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::None,
            65536,
            [IO.FileOptions]::SequentialScan
        )
        [ApplyPack.Security.OutputDirectoryGuard]::AssertRegularFileHandle($envelopeStream.SafeFileHandle)
        $envelopeSha256 = Get-StreamSha256 $envelopeStream
        $info = [ApplyPack.Security.StagingBackupEnvelope]::AuthenticateAndReadMetadata($envelopeStream)
        try { $metadata = $info.MetadataJson | ConvertFrom-Json } catch { Throw-Controlled 'ENVELOPE_METADATA_INVALID' }
        Assert-EnvelopeReleaseBinding -Metadata $metadata -ReleaseSha $releaseSha
        if ($metadata.format -ne 'ApplyPackStagingSchema084DatabaseBackup' -or
            [int]$metadata.formatVersion -ne 1 -or
            $metadata.deploymentEnvironment -ne 'staging' -or
            $metadata.projectRef -ne $script:ProjectRef -or
            $metadata.host -ne $script:DatabaseHost -or
            $metadata.database -ne $script:DatabaseName -or
            $metadata.loginUser -ne $script:LoginUser -or
            $metadata.expectedCurrentUser -ne $script:CurrentUser -or
            $metadata.postgresImageDigest -ne $script:PostgresImageDigest -or
            $metadata.caSha256 -ne $script:CaSha256 -or
            $metadata.sourceEvidence.latestMigration -ne $script:ExpectedSchemaVersion -or
            [int]$metadata.sourceEvidence.migrations081084Count -ne 4 -or
            $metadata.sourceEvidence.clientTlsVerified -ne $true -or
            $metadata.sourceEvidence.tableRowCountSha256 -notmatch '^[0-9a-f]{64}$') {
            Throw-Controlled 'ENVELOPE_BINDING_INVALID'
        }

        $listStart = New-ProcessStartInfo -FileName $DockerExecutable -Arguments @(
            'run', '--rm', '--name', $listContainerName, '-i', '--network', 'none', '--pull', 'never',
            '--entrypoint', 'pg_restore', $script:PostgresImage, '--list'
        ) -RedirectInput $true -RedirectOutput $true
        Invoke-DecryptToProcess `
            -EnvelopeStream $envelopeStream `
            -StartInfo $listStart `
            -FailureCode 'PG_RESTORE_LIST_FAILED' `
            -EphemeralContainerName $listContainerName

        $containerAttempted = $true
        $containerId = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
            'run', '--detach', '--rm', '--name', $containerName, '--network', 'none',
            '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=4g',
            '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--pull', 'never',
            '--entrypoint', 'docker-entrypoint.sh', $script:PostgresImage,
            'postgres', '-D', '/var/lib/postgresql/data'
        ) -FailureCode 'RESTORE_CONTAINER_START_FAILED'
        if ($containerId -notmatch '^[0-9a-f]{12,64}$') { Throw-Controlled 'RESTORE_CONTAINER_START_INVALID' }
        $ready = $false
        for ($attempt = 0; $attempt -lt 45; $attempt += 1) {
            try {
                [void](Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
                    # The entrypoint's temporary init server accepts Unix sockets
                    # before it stops. Loopback TCP becomes ready only on the final server.
                    'exec', $containerName, 'pg_isready', '--host', '127.0.0.1', '--username', 'postgres', '--dbname', 'postgres'
                ) -FailureCode 'RESTORE_CONTAINER_NOT_READY')
                $ready = $true
                break
            }
            catch {
                if ($_.Exception.Message -ne 'RESTORE_CONTAINER_NOT_READY') { throw }
                Start-Sleep -Milliseconds 1000
            }
        }
        if (-not $ready) { Throw-Controlled 'RESTORE_CONTAINER_NOT_READY' }

        [void](Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
            'exec', $containerName, 'psql', '--no-psqlrc', '--quiet',
            '--set', 'ON_ERROR_STOP=1', '--username', $script:RestoreDatabaseUser,
            '--dbname', 'postgres', '--command', $script:RestoreDatabaseCreateSql
        ) -FailureCode 'RESTORE_DATABASE_CREATE_FAILED')

        $restoreStart = New-ProcessStartInfo -FileName $DockerExecutable -Arguments @(
            'exec', '-i', $containerName, 'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges',
            '--username', $script:RestoreDatabaseUser, '--dbname', $script:RestoreDatabaseName
        ) -RedirectInput $true -RedirectOutput $true
        Invoke-DecryptToProcess -EnvelopeStream $envelopeStream -StartInfo $restoreStart -FailureCode 'PG_RESTORE_FAILED'
        $restoredEvidence = Get-RestoreEvidence -ContainerName $containerName
        Assert-RestoreEvidence -Source $metadata.sourceEvidence -Restored $restoredEvidence
    }
    catch { $primaryFailure = $_ }
    finally {
        if ($containerAttempted) {
            try {
                Ensure-ContainerAbsent -ContainerName $containerName -FailureCode 'RESTORE_CONTAINER_TEARDOWN_FAILED'
            }
            catch { $cleanupFailure = $_ }
        }
        if ($null -ne $envelopeStream) {
            try { $envelopeStream.Dispose() } catch { if ($null -eq $cleanupFailure) { $cleanupFailure = $_ } }
        }
    }
    Resolve-OperationFailures `
        -PrimaryFailure $primaryFailure `
        -CleanupFailure $cleanupFailure `
        -PrimaryFallback 'SAFEGUARD_FAILED' `
        -CleanupFallback 'RESTORE_CONTAINER_TEARDOWN_FAILED'

    $receipt = [ordered]@{
        operation = 'isolated-staging-schema084-restore-drill'
        completedAt = [DateTimeOffset]::UtcNow.ToString('O')
        sourceReleaseSha = $releaseSha
        envelopeSha256 = $envelopeSha256
        postgresImageDigest = $script:PostgresImageDigest
        networkMode = 'none'
        publishedPorts = 0
        restoreDatabase = $script:RestoreDatabaseName
        restoreDatabaseUser = $script:RestoreDatabaseUser
        aggregateEvidence = $restoredEvidence
        tableRowCountSha256 = $restoredEvidence.tableRowCountSha256
        teardownVerified = $true
    }
    Invoke-AtomicFile -Target $receiptTarget -Writer { param($output) Write-JsonStream -Stream $output -Value $receipt }
    [ordered]@{ status = 'STAGING_RESTORE_DRILL_VERIFIED'; receiptPath = $resolvedReceipt; envelopeSha256 = $envelopeSha256 } | ConvertTo-Json -Compress
}

function Invoke-SelfTest {
    $testRoot = Join-Path ([IO.Path]::GetTempPath()) "applypack-staging-safeguard-$([Guid]::NewGuid().ToString('N'))"
    [IO.Directory]::CreateDirectory($testRoot) | Out-Null
    $marker = 'SELF_TEST_SECRET_DO_NOT_LOG_76291'
    $plain = $null
    $syntheticSecret = $null
    try {
        $sourceEvidencePayload = [pscustomobject]@{
            database = $script:DatabaseName
            currentUser = $script:CurrentUser
            ssl = $false
            serverVersionNum = $script:MinimumPostgresServerVersionNum
            publicTableCount = 1
            rlsEnabledTableCount = 1
            rlsPolicyCount = 1
            invalidIndexCount = 0
            migrationCount = 1
            tableRowCountSha256 = ('0' * 64 -join '')
            latestMigration = $script:ExpectedSchemaVersion
            migration080Present = $true
            migrations081084Count = 4
            readiness = [pscustomobject]@{
                requiredSchemaVersion = $script:ExpectedSchemaVersion
                ready = $true
            }
        }
        $sourceEvidenceJson = $sourceEvidencePayload | ConvertTo-Json -Depth 12 -Compress
        $sourceConnectionLine = 'You are connected to database "postgres" as user "postgres.fmugizadzdnqfckujqlw" on host "aws-0-us-west-2.pooler.supabase.com" (address "127.0.0.1") at port "5432".'
        $sourceTlsLine = 'SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off, ALPN: postgresql)'
        $validSourceOutput = @(
            $script:SourceConninfoBegin,
            $sourceConnectionLine,
            $sourceTlsLine,
            $script:SourceConninfoEnd,
            $sourceEvidenceJson
        ) -join "`n"
        $sourceEvidenceFixture = ConvertFrom-SourceEvidenceOutput -Text $validSourceOutput
        Assert-SourceEvidence -Evidence $sourceEvidenceFixture

        $invalidClientTlsOutputs = @(
            (@($script:SourceConninfoBegin, $sourceConnectionLine, $script:SourceConninfoEnd, $sourceEvidenceJson) -join "`n"),
            (@($script:SourceConninfoBegin, $sourceConnectionLine, 'SSL connection (protocol: TLSv1.0, cipher: TLS_AES_256_GCM_SHA384, compression: off)', $script:SourceConninfoEnd, $sourceEvidenceJson) -join "`n"),
            (@($script:SourceConninfoBegin, $sourceConnectionLine, 'SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: on)', $script:SourceConninfoEnd, $sourceEvidenceJson) -join "`n"),
            (@($script:SourceConninfoBegin, $sourceConnectionLine, 'You are connected without SSL.', $script:SourceConninfoEnd, $sourceEvidenceJson) -join "`n"),
            (@($script:SourceConninfoBegin, $sourceConnectionLine, $sourceTlsLine, $sourceTlsLine, $script:SourceConninfoEnd, $sourceEvidenceJson) -join "`n"),
            (@('WRONG_SOURCE_CONNINFO_BEGIN', $sourceConnectionLine, $sourceTlsLine, $script:SourceConninfoEnd, $sourceEvidenceJson) -join "`n")
        )
        foreach ($invalidClientTlsOutput in $invalidClientTlsOutputs) {
            $clientTlsRejected = $false
            try { [void](ConvertFrom-SourceEvidenceOutput -Text $invalidClientTlsOutput) }
            catch { $clientTlsRejected = (Get-ControlledCode $_) -eq 'DATABASE_EVIDENCE_INVALID' }
            if (-not $clientTlsRejected) { Throw-Controlled 'SELF_TEST_CLIENT_TLS_FAILED' }
        }
        $sourceEvidenceFixture.clientTlsVerified = $false
        $unverifiedTlsRejected = $false
        try { Assert-SourceEvidence -Evidence $sourceEvidenceFixture }
        catch { $unverifiedTlsRejected = (Get-ControlledCode $_) -eq 'SOURCE_EVIDENCE_INVALID' }
        if (-not $unverifiedTlsRejected) { Throw-Controlled 'SELF_TEST_CLIENT_TLS_FAILED' }
        $sourceEvidenceFixture.clientTlsVerified = $true

        $restoreSourceFixture = [pscustomobject]@{
            database = $script:DatabaseName
            currentUser = $script:CurrentUser
            publicTableCount = 1
            rlsEnabledTableCount = 1
            rlsPolicyCount = 1
            publicTriggerCount = 1
            publicFunctionCount = 1
            invalidIndexCount = 0
            migrationCount = 1
            latestMigration = $script:ExpectedSchemaVersion
            migration080Present = $true
            migrations081084Count = 4
            tableRowCounts = [pscustomobject]@{ example = 0 }
            tableRowCountSha256 = ('0' * 64 -join '')
            readiness = [pscustomobject]@{
                requiredSchemaVersion = $script:ExpectedSchemaVersion
                ready = $true
            }
        }
        $validRestoreEvidence = $restoreSourceFixture | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json
        $validRestoreEvidence.database = $script:RestoreDatabaseName
        $validRestoreEvidence.currentUser = $script:RestoreDatabaseUser
        Assert-RestoreEvidence -Source $restoreSourceFixture -Restored $validRestoreEvidence

        if ($script:RestoreDatabaseName -ne 'applypack_restore_drill' -or
            $script:RestoreDatabaseUser -ne 'supabase_admin' -or
            $script:RestoreDatabaseCreateSql -ne 'create database applypack_restore_drill with template template0 owner supabase_admin') {
            Throw-Controlled 'SELF_TEST_RESTORE_IDENTITY_FAILED'
        }
        foreach ($invalidIdentity in @(
            [pscustomobject]@{ Property = 'database'; Value = 'postgres' },
            [pscustomobject]@{ Property = 'currentUser'; Value = 'postgres' }
        )) {
            $invalidIdentityEvidence = $validRestoreEvidence | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json
            $invalidIdentityEvidence.($invalidIdentity.Property) = $invalidIdentity.Value
            $identityRejected = $false
            try { Assert-RestoreEvidence -Source $restoreSourceFixture -Restored $invalidIdentityEvidence }
            catch { $identityRejected = (Get-ControlledCode $_) -eq 'RESTORE_INTEGRITY_INVALID' }
            if (-not $identityRejected) { Throw-Controlled 'SELF_TEST_RESTORE_IDENTITY_FAILED' }
        }

        $invalidReadinessCases = @(
            [pscustomobject]@{ Name = 'missing-readiness'; Mutator = { param($fixture) $fixture.PSObject.Properties.Remove('readiness') } },
            [pscustomobject]@{ Name = 'null-readiness'; Mutator = { param($fixture) $fixture.readiness = $null } },
            [pscustomobject]@{ Name = 'missing-required-version'; Mutator = { param($fixture) $fixture.readiness.PSObject.Properties.Remove('requiredSchemaVersion') } },
            [pscustomobject]@{ Name = 'legacy-version-key'; Mutator = {
                param($fixture)
                $fixture.readiness.PSObject.Properties.Remove('requiredSchemaVersion')
                $fixture.readiness | Add-Member -NotePropertyName 'schemaVersion' -NotePropertyValue $script:ExpectedSchemaVersion
            } },
            [pscustomobject]@{ Name = 'null-required-version'; Mutator = { param($fixture) $fixture.readiness.requiredSchemaVersion = $null } },
            [pscustomobject]@{ Name = 'numeric-required-version'; Mutator = { param($fixture) $fixture.readiness.requiredSchemaVersion = [long]202610040080 } },
            [pscustomobject]@{ Name = 'wrong-required-version'; Mutator = { param($fixture) $fixture.readiness.requiredSchemaVersion = 'wrong-schema-version' } },
            [pscustomobject]@{ Name = 'missing-ready'; Mutator = { param($fixture) $fixture.readiness.PSObject.Properties.Remove('ready') } },
            [pscustomobject]@{ Name = 'null-ready'; Mutator = { param($fixture) $fixture.readiness.ready = $null } },
            [pscustomobject]@{ Name = 'false-ready'; Mutator = { param($fixture) $fixture.readiness.ready = $false } },
            [pscustomobject]@{ Name = 'numeric-ready'; Mutator = { param($fixture) $fixture.readiness.ready = [long]1 } },
            [pscustomobject]@{ Name = 'titlecase-string-ready'; Mutator = { param($fixture) $fixture.readiness.ready = 'True' } },
            [pscustomobject]@{ Name = 'lowercase-string-ready'; Mutator = { param($fixture) $fixture.readiness.ready = 'true' } }
        )
        foreach ($invalidReadinessCase in $invalidReadinessCases) {
            $mutator = $invalidReadinessCase.Mutator

            $invalidSourceEvidence = $sourceEvidenceFixture | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json
            & $mutator $invalidSourceEvidence
            $sourceRejected = $false
            try { Assert-SourceEvidence -Evidence $invalidSourceEvidence }
            catch { $sourceRejected = (Get-ControlledCode $_) -eq 'SOURCE_EVIDENCE_INVALID' }

            $invalidRestoreSource = $restoreSourceFixture | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json
            & $mutator $invalidRestoreSource
            $restoreSourceRejected = $false
            try { Assert-RestoreEvidence -Source $invalidRestoreSource -Restored $validRestoreEvidence }
            catch { $restoreSourceRejected = (Get-ControlledCode $_) -eq 'RESTORE_INTEGRITY_INVALID' }

            $invalidRestoredEvidence = $validRestoreEvidence | ConvertTo-Json -Depth 12 -Compress | ConvertFrom-Json
            & $mutator $invalidRestoredEvidence
            $restoredRejected = $false
            try { Assert-RestoreEvidence -Source $restoreSourceFixture -Restored $invalidRestoredEvidence }
            catch { $restoredRejected = (Get-ControlledCode $_) -eq 'RESTORE_INTEGRITY_INVALID' }

            if (-not $sourceRejected -or -not $restoreSourceRejected -or -not $restoredRejected) {
                Throw-Controlled 'SELF_TEST_READINESS_SCHEMA_FAILED'
            }
        }

        $sourceEvidenceFixture.serverVersionNum = $script:MinimumPostgresServerVersionNum - 1
        $olderVersionRejected = $false
        try { Assert-SourceEvidence -Evidence $sourceEvidenceFixture }
        catch { $olderVersionRejected = (Get-ControlledCode $_) -eq 'SOURCE_EVIDENCE_INVALID' }
        if (-not $olderVersionRejected) { Throw-Controlled 'SELF_TEST_SOURCE_VERSION_FAILED' }

        $plain = [Text.UTF8Encoding]::new($false).GetBytes('deterministic synthetic pg_dump payload v1')
        $metadata = '{"format":"self-test","fixture":1}'
        $envelope = Join-Path $testRoot 'roundtrip.apdb'
        $destination = [IO.FileStream]::new($envelope, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $source = [IO.MemoryStream]::new($plain, $false)
        try { [ApplyPack.Security.StagingBackupEnvelope]::Encrypt($source, $destination, $metadata); $destination.Flush($true) }
        finally { $source.Dispose(); $destination.Dispose() }
        $info = [ApplyPack.Security.StagingBackupEnvelope]::AuthenticateAndReadMetadata($envelope)
        if ($info.MetadataJson -ne $metadata) { Throw-Controlled 'SELF_TEST_METADATA_FAILED' }
        $roundtrip = [IO.MemoryStream]::new()
        try {
            [void][ApplyPack.Security.StagingBackupEnvelope]::DecryptAuthenticated($envelope, $roundtrip)
            if (-not [Linq.Enumerable]::SequenceEqual[byte]($plain, $roundtrip.ToArray())) { Throw-Controlled 'SELF_TEST_ROUNDTRIP_FAILED' }
        }
        finally { $roundtrip.Dispose() }

        # Keep one non-shareable handle across every authentication/decryption
        # phase. A second valid CurrentUser envelope cannot replace the verified
        # bytes while this handle is alive.
        $replacement = Join-Path $testRoot 'replacement.apdb'
        $replacementPlain = [Text.UTF8Encoding]::new($false).GetBytes('different valid replacement payload')
        $replacementDestination = [IO.FileStream]::new($replacement, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $replacementSource = [IO.MemoryStream]::new($replacementPlain, $false)
        try {
            [ApplyPack.Security.StagingBackupEnvelope]::Encrypt($replacementSource, $replacementDestination, '{"format":"self-test","fixture":2}')
            $replacementDestination.Flush($true)
        }
        finally {
            $replacementSource.Dispose()
            $replacementDestination.Dispose()
            [Array]::Clear($replacementPlain, 0, $replacementPlain.Length)
        }
        $heldEnvelope = [IO.FileStream]::new($envelope, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
        try {
            $heldInfo = [ApplyPack.Security.StagingBackupEnvelope]::AuthenticateAndReadMetadata($heldEnvelope)
            if ($heldInfo.MetadataJson -ne $metadata) { Throw-Controlled 'SELF_TEST_METADATA_FAILED' }
            $replacementRejected = $false
            try { [IO.File]::Move($replacement, $envelope, $true) } catch { $replacementRejected = $true }
            if (-not $replacementRejected) { Throw-Controlled 'SELF_TEST_PATH_RACE_FAILED' }
            foreach ($pass in 1..2) {
                $heldRoundtrip = [IO.MemoryStream]::new()
                try {
                    [void][ApplyPack.Security.StagingBackupEnvelope]::DecryptAuthenticated($heldEnvelope, $heldRoundtrip)
                    if (-not [Linq.Enumerable]::SequenceEqual[byte]($plain, $heldRoundtrip.ToArray())) {
                        Throw-Controlled 'SELF_TEST_ROUNDTRIP_FAILED'
                    }
                }
                finally { $heldRoundtrip.Dispose() }
            }
        }
        finally { $heldEnvelope.Dispose() }

        $tampered = Join-Path $testRoot 'tampered.apdb'
        [IO.File]::Copy($envelope, $tampered)
        $tamperBytes = [IO.File]::ReadAllBytes($tampered)
        $tamperBytes[[Math]::Floor($tamperBytes.Length / 2)] = $tamperBytes[[Math]::Floor($tamperBytes.Length / 2)] -bxor 1
        [IO.File]::WriteAllBytes($tampered, $tamperBytes)
        [Array]::Clear($tamperBytes, 0, $tamperBytes.Length)
        $rejected = $false
        try { [void][ApplyPack.Security.StagingBackupEnvelope]::AuthenticateAndReadMetadata($tampered) } catch { $rejected = $true }
        if (-not $rejected) { Throw-Controlled 'SELF_TEST_TAMPER_FAILED' }

        $truncated = Join-Path $testRoot 'truncated.apdb'
        $envelopeBytes = [IO.File]::ReadAllBytes($envelope)
        [IO.File]::WriteAllBytes($truncated, $envelopeBytes[0..($envelopeBytes.Length - 17)])
        [Array]::Clear($envelopeBytes, 0, $envelopeBytes.Length)
        $rejected = $false
        try { [void][ApplyPack.Security.StagingBackupEnvelope]::AuthenticateAndReadMetadata($truncated) } catch { $rejected = $true }
        if (-not $rejected) { Throw-Controlled 'SELF_TEST_TRUNCATION_FAILED' }

        $rejected = $false
        try { [void](Assert-SafeOutputPath -Path (Join-Path $script:RepoRoot 'forbidden.apdb') -ExpectedExtension '.apdb') } catch { $rejected = $_.Exception.Message -eq 'OUTPUT_INSIDE_GIT_WORKTREE' }
        if (-not $rejected) { Throw-Controlled 'SELF_TEST_PATH_REJECTION_FAILED' }

        # Prove that both the explicit full release SHA and the helper bytes are
        # immutable inputs to backup/restore authorization. This fixture is an
        # isolated local Git repository and never touches the canonical checkout.
        $releaseRepo = Join-Path $testRoot 'release-fixture'
        $releaseHooks = Join-Path $releaseRepo 'empty-hooks'
        $releaseScriptPath = Join-Path $releaseRepo 'scripts\staging-schema084-database-safeguard.ps1'
        $releaseHelperPath = Join-Path $releaseRepo 'scripts\lib\ApplyPackStagingBackupEnvelope.cs'
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($releaseHelperPath)) | Out-Null
        [IO.Directory]::CreateDirectory($releaseHooks) | Out-Null
        [IO.File]::WriteAllText($releaseScriptPath, 'fixture script')
        [IO.File]::WriteAllText($releaseHelperPath, 'fixture helper')
        [void](Invoke-SafeNativeText -FileName 'git' -Arguments @('-C', $releaseRepo, 'init', '--quiet'))
        [void](Invoke-SafeNativeText -FileName 'git' -Arguments @(
            '-C', $releaseRepo, 'add', '--',
            'scripts/staging-schema084-database-safeguard.ps1',
            'scripts/lib/ApplyPackStagingBackupEnvelope.cs'
        ))
        [void](Invoke-SafeNativeText -FileName 'git' -Arguments @(
            '-C', $releaseRepo,
            '-c', 'user.name=ApplyPack Self Test',
            '-c', 'user.email=applypack-self-test.invalid',
            '-c', 'commit.gpgsign=false',
            '-c', "core.hooksPath=$releaseHooks",
            'commit', '--quiet', '-m', 'fixture'
        ))
        $releaseFixtureSha = Invoke-SafeNativeText -FileName 'git' -Arguments @('-C', $releaseRepo, 'rev-parse', 'HEAD')
        $releasePaths = @(
            'scripts/staging-schema084-database-safeguard.ps1',
            'scripts/lib/ApplyPackStagingBackupEnvelope.cs'
        )
        if ((Get-CleanReleaseSha -RepositoryRoot $releaseRepo -ExpectedSha $releaseFixtureSha -RequiredPaths $releasePaths) -ne $releaseFixtureSha) {
            Throw-Controlled 'SELF_TEST_RELEASE_BINDING_FAILED'
        }
        $mismatchedShaRejected = $false
        try {
            [void](Get-CleanReleaseSha -RepositoryRoot $releaseRepo -ExpectedSha ('0' * 40) -RequiredPaths $releasePaths)
        }
        catch { $mismatchedShaRejected = (Get-ControlledCode $_) -eq 'RELEASE_SHA_BINDING_INVALID' }
        if (-not $mismatchedShaRejected) { Throw-Controlled 'SELF_TEST_RELEASE_BINDING_FAILED' }
        [IO.File]::AppendAllText($releaseHelperPath, ' dirty')
        $dirtyHelperRejected = $false
        try {
            [void](Get-CleanReleaseSha -RepositoryRoot $releaseRepo -ExpectedSha $releaseFixtureSha -RequiredPaths $releasePaths)
        }
        catch { $dirtyHelperRejected = (Get-ControlledCode $_) -eq 'SAFEGUARD_SOURCE_NOT_AT_RELEASE_SHA' }
        if (-not $dirtyHelperRejected) { Throw-Controlled 'SELF_TEST_RELEASE_BINDING_FAILED' }

        $oldReleaseSha = '1111111111111111111111111111111111111111'
        $oldMetadata = [ordered]@{ format = 'self-test'; releaseSha = $oldReleaseSha } | ConvertTo-Json -Compress
        $oldEnvelope = Join-Path $testRoot 'old-release-valid.apdb'
        $oldDestination = [IO.FileStream]::new($oldEnvelope, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $oldSource = [IO.MemoryStream]::new($plain, $false)
        try {
            [ApplyPack.Security.StagingBackupEnvelope]::Encrypt($oldSource, $oldDestination, $oldMetadata)
            $oldDestination.Flush($true)
        }
        finally { $oldSource.Dispose(); $oldDestination.Dispose() }
        $oldInfo = [ApplyPack.Security.StagingBackupEnvelope]::AuthenticateAndReadMetadata($oldEnvelope)
        $oldReleaseRejected = $false
        try {
            Assert-EnvelopeReleaseBinding -Metadata ($oldInfo.MetadataJson | ConvertFrom-Json) -ReleaseSha $releaseFixtureSha
        }
        catch { $oldReleaseRejected = (Get-ControlledCode $_) -eq 'ENVELOPE_RELEASE_SHA_MISMATCH' }
        if (-not $oldReleaseRejected) { Throw-Controlled 'SELF_TEST_RELEASE_BINDING_FAILED' }

        $raceParent = Join-Path $testRoot 'race-parent'
        $raceMoved = Join-Path $testRoot 'race-parent-moved'
        [IO.Directory]::CreateDirectory($raceParent) | Out-Null
        $raceGuard = [ApplyPack.Security.OutputDirectoryGuard]::Capture($raceParent)
        $raceRejected = $false
        try {
            try { [IO.Directory]::Move($raceParent, $raceMoved) } catch { $raceRejected = $true }
            if (-not $raceRejected) {
                [IO.Directory]::CreateDirectory($raceParent) | Out-Null
                try { $raceGuard.AssertUnchanged() } catch { $raceRejected = $true }
            }
        }
        finally { $raceGuard.Dispose() }
        if (-not $raceRejected) { Throw-Controlled 'SELF_TEST_PATH_RACE_FAILED' }

        # Prove a swap that occurs after approval but before the long-lived write
        # guard is captured cannot redirect output into the substitute directory.
        $preCaptureParent = Join-Path $testRoot 'pre-capture-parent'
        $preCaptureMoved = Join-Path $testRoot 'pre-capture-parent-approved'
        [IO.Directory]::CreateDirectory($preCaptureParent) | Out-Null
        $preCaptureTarget = Assert-SafeOutputPath -Path (Join-Path $preCaptureParent 'rejected.apdb') -ExpectedExtension '.apdb'
        [IO.Directory]::Move($preCaptureParent, $preCaptureMoved)
        [IO.Directory]::CreateDirectory($preCaptureParent) | Out-Null
        $preCaptureRejected = $false
        try {
            Invoke-AtomicFile -Target $preCaptureTarget -Writer {
                param($output)
                $output.WriteByte(42)
            }
        }
        catch { $preCaptureRejected = (Get-ControlledCode $_) -eq 'OUTPUT_DIRECTORY_IDENTITY_CHANGED' }
        if (-not $preCaptureRejected -or
            (Test-Path -LiteralPath $preCaptureTarget.FullPath) -or
            (Test-Path -LiteralPath (Join-Path $preCaptureMoved 'rejected.apdb'))) {
            Throw-Controlled 'SELF_TEST_PATH_RACE_FAILED'
        }

        $failurePath = Join-Path $testRoot 'failed.apdb'
        $failureTarget = Assert-SafeOutputPath -Path $failurePath -ExpectedExtension '.apdb'
        $caughtCode = $null
        try {
            Invoke-AtomicFile -Target $failureTarget -Writer {
                param($output)
                $output.Write([byte[]](1, 2, 3), 0, 3)
                throw $marker
            }
        }
        catch { $caughtCode = Get-ControlledCode $_ }
        if ($caughtCode -ne 'SAFEGUARD_FAILED' -or $caughtCode.Contains($marker)) { Throw-Controlled 'SELF_TEST_LOG_REDACTION_FAILED' }
        if (Test-Path -LiteralPath $failurePath) { Throw-Controlled 'SELF_TEST_FAILURE_CLEANUP_FAILED' }
        if (@(Get-ChildItem -LiteralPath $testRoot -Filter '*.partial-*' -Force).Count -ne 0) { Throw-Controlled 'SELF_TEST_FAILURE_CLEANUP_FAILED' }
        if (($info.MetadataJson + ($caughtCode ?? '')).Contains($marker)) { Throw-Controlled 'SELF_TEST_LOG_REDACTION_FAILED' }

        # Inject an output failure after a real child process has started and
        # begun streaming. The lifecycle helper must kill the full process tree,
        # wait/drain/dispose it, clear the supplied char[], invoke container
        # cleanup, and leave no final or partial envelope.
        $pidFile = Join-Path $testRoot 'synthetic-child.pid'
        $containerMarker = Join-Path $testRoot 'synthetic-container.marker'
        [IO.File]::WriteAllText($containerMarker, 'present')
        $childScript = @'
$null = [Console]::In.ReadLine()
[IO.File]::WriteAllText($env:AP_SELF_TEST_PID_FILE, $PID.ToString())
$chunk = [Text.Encoding]::UTF8.GetBytes(('x' * 65536))
$stdout = [Console]::OpenStandardOutput()
while ($true) {
    $stdout.Write($chunk, 0, $chunk.Length)
    $stdout.Flush()
    Start-Sleep -Milliseconds 5
}
'@
        $childBytes = [Text.Encoding]::Unicode.GetBytes($childScript)
        try { $encodedChild = [Convert]::ToBase64String($childBytes) }
        finally { [Array]::Clear($childBytes, 0, $childBytes.Length) }
        $pwshExecutable = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
        $processStart = New-ProcessStartInfo `
            -FileName $pwshExecutable `
            -Arguments @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encodedChild) `
            -RedirectInput $true `
            -RedirectOutput $true
        $processStart.Environment['AP_SELF_TEST_PID_FILE'] = $pidFile
        $syntheticSecret = $marker.ToCharArray()
        $syntheticCredential = [ApplyPack.Security.WindowsCredentialStore]::CreateSyntheticForSelfTest($syntheticSecret)
        $processFailurePath = Join-Path $testRoot 'process-failure.apdb'
        $processFailureTarget = Assert-SafeOutputPath -Path $processFailurePath -ExpectedExtension '.apdb'
        $processCaughtCode = $null
        $cleanupOverride = {
            param($ignoredContainerName)
            if (Test-Path -LiteralPath $containerMarker) {
                Remove-Item -LiteralPath $containerMarker -Force
            }
        }
        try {
            Invoke-AtomicFile -Target $processFailureTarget -Writer {
                param($output)
                $failingOutput = [ApplyPack.Security.DeterministicFailingWriteStream]::new($output, 4096)
                try {
                    Invoke-EncryptedBackupProcess `
                        -StartInfo $processStart `
                        -Credential $syntheticCredential `
                        -Destination $failingOutput `
                        -MetadataJson '{"format":"self-test-process-failure"}' `
                        -ContainerName 'applypack-self-test-container' `
                        -ContainerCleanupOverride $cleanupOverride
                }
                finally { $failingOutput.Dispose() }
            }
        }
        catch { $processCaughtCode = Get-ControlledCode $_ }
        if ($processCaughtCode -ne 'BACKUP_STREAM_FAILED') { Throw-Controlled 'SELF_TEST_PROCESS_CLEANUP_FAILED' }
        if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) { Throw-Controlled 'SELF_TEST_PROCESS_CLEANUP_FAILED' }
        $childPid = [int]([IO.File]::ReadAllText($pidFile))
        if ($null -ne (Get-Process -Id $childPid -ErrorAction SilentlyContinue)) { Throw-Controlled 'SELF_TEST_PROCESS_CLEANUP_FAILED' }
        if ((Test-Path -LiteralPath $containerMarker) -or (Test-Path -LiteralPath $processFailurePath)) {
            Throw-Controlled 'SELF_TEST_PROCESS_CLEANUP_FAILED'
        }
        if (@(Get-ChildItem -LiteralPath $testRoot -Filter '*.partial-*' -Force).Count -ne 0) {
            Throw-Controlled 'SELF_TEST_PROCESS_CLEANUP_FAILED'
        }
        if (@($syntheticSecret | Where-Object { $_ -ne [char]0 }).Count -ne 0) {
            Throw-Controlled 'SELF_TEST_PROCESS_CLEANUP_FAILED'
        }
        if (($processCaughtCode ?? '').Contains($marker)) { Throw-Controlled 'SELF_TEST_LOG_REDACTION_FAILED' }

        $restorePrimary = $null
        $restoreCleanup = $null
        try { Throw-Controlled 'PG_RESTORE_FAILED' } catch { $restorePrimary = $_ }
        try { Throw-Controlled 'RESTORE_CONTAINER_TEARDOWN_FAILED' } catch { $restoreCleanup = $_ }
        $precedenceVerified = $false
        try {
            Resolve-OperationFailures `
                -PrimaryFailure $restorePrimary `
                -CleanupFailure $restoreCleanup `
                -PrimaryFallback 'PG_RESTORE_FAILED' `
                -CleanupFallback 'RESTORE_CONTAINER_TEARDOWN_FAILED'
        }
        catch {
            $precedenceVerified = (
                (Get-ControlledCode $_) -eq 'PG_RESTORE_FAILED' -and
                $_.Exception.Data['ApplyPackCleanupCode'] -eq 'RESTORE_CONTAINER_TEARDOWN_FAILED'
            )
        }
        if (-not $precedenceVerified) { Throw-Controlled 'SELF_TEST_RESTORE_PRECEDENCE_FAILED' }

        $cleanupOnlyVerified = $false
        try {
            Resolve-OperationFailures `
                -PrimaryFailure $null `
                -CleanupFailure $restoreCleanup `
                -CleanupFallback 'RESTORE_CONTAINER_TEARDOWN_FAILED'
        }
        catch { $cleanupOnlyVerified = (Get-ControlledCode $_) -eq 'RESTORE_CONTAINER_TEARDOWN_FAILED' }
        if (-not $cleanupOnlyVerified) { Throw-Controlled 'SELF_TEST_RESTORE_PRECEDENCE_FAILED' }

        [ordered]@{
            status = 'STAGING_DATABASE_SAFEGUARD_SELF_TEST_OK'
            dpapiCurrentUser = $true
            authenticatedEncryption = $true
            tamperRejected = $true
            truncationRejected = $true
            envelopeHandlePinned = $true
            repositoryOutputRejected = $true
            outputPathRaceRejected = $true
            preCaptureSwapRejected = $true
            releaseBindingVerified = $true
            sourceVersionBoundaryVerified = $true
            readinessSchemaContractVerified = $true
            restoreDatabaseIdentityVerified = $true
            clientTlsAttestationVerified = $true
            failureCleanupVerified = $true
            processFailureCleanupVerified = $true
            credentialBufferCleared = $true
            restoreFailurePrecedenceVerified = $true
            secretLoggingRejected = $true
        } | ConvertTo-Json -Compress
    }
    finally {
        if ($null -ne $plain) { [Array]::Clear($plain, 0, $plain.Length) }
        if ($null -ne $syntheticSecret) { [Array]::Clear($syntheticSecret, 0, $syntheticSecret.Length) }
        if (Test-Path -LiteralPath $testRoot) {
            $cleanupTarget = [IO.Path]::GetFullPath($testRoot)
            $cleanupParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
            if (-not $cleanupTarget.StartsWith($cleanupParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'SELF_TEST_CLEANUP_PATH_INVALID' }
            Remove-Item -LiteralPath $cleanupTarget -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

try {
    Assert-WindowsRuntime
    switch ($Mode) {
        'Backup' {
            if ([string]::IsNullOrWhiteSpace($BackupPath) -or [string]::IsNullOrWhiteSpace($ReceiptPath)) { Throw-Controlled 'OUTPUT_PATHS_REQUIRED' }
            Invoke-Backup
        }
        'Restore' {
            if ([string]::IsNullOrWhiteSpace($BackupPath) -or [string]::IsNullOrWhiteSpace($ReceiptPath)) { Throw-Controlled 'OUTPUT_PATHS_REQUIRED' }
            Invoke-Restore
        }
        'SelfTest' { Invoke-SelfTest }
    }
}
catch {
    $code = Get-ControlledCode $_
    $cleanupCode = $_.Exception.Data['ApplyPackCleanupCode']
    if ($cleanupCode -is [string] -and $script:PublicErrorCodes.Contains($cleanupCode)) {
        [Console]::Error.WriteLine(([ordered]@{ error = $code; cleanupError = $cleanupCode } | ConvertTo-Json -Compress))
    }
    else {
        [Console]::Error.WriteLine($code)
    }
    exit 1
}

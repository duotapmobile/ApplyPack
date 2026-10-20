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
$script:ExpectedSchemaVersion = '202610040080'
$script:CaSha256 = '700723581420DD1AC98FD7E9AC529F0EF210EADCAF87FC868A3AD7D114C2F3B7'
$script:PostgresImage = 'public.ecr.aws/supabase/postgres:17.6.1.166'
$script:PostgresImageDigest = 'public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86'
$script:EnvelopeSource = Join-Path $PSScriptRoot 'lib\ApplyPackStagingBackupEnvelope.cs'
$script:PublicErrorCodes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
@(
    'WINDOWS_REQUIRED', 'POWERSHELL_7_REQUIRED', 'ENVELOPE_HELPER_MISSING',
    'OUTPUT_PATH_MUST_BE_ABSOLUTE', 'GIT_WORKTREE_DISCOVERY_FAILED', 'OUTPUT_EXTENSION_INVALID',
    'OUTPUT_ALREADY_EXISTS', 'OUTPUT_PARENT_MISSING', 'OUTPUT_INSIDE_GIT_WORKTREE',
    'OUTPUT_REPARSE_PATH_REJECTED', 'ATOMIC_OUTPUT_MISSING', 'STAGING_BINDING_INVALID',
    'CHECKOUT_FLAG_NOT_FALSE', 'NATIVE_COMMAND_FAILED', 'RELEASE_SHA_UNAVAILABLE',
    'RELEASE_SHA_INVALID', 'RELEASE_SHA_BINDING_INVALID', 'SAFEGUARD_SOURCE_NOT_TRACKED',
    'SAFEGUARD_SOURCE_NOT_AT_RELEASE_SHA', 'CA_PATH_REQUIRED', 'CA_FILE_MISSING', 'CA_HASH_MISMATCH',
    'CA_PATH_INVALID', 'PINNED_IMAGE_MISSING', 'PINNED_IMAGE_INSPECT_INVALID',
    'PINNED_IMAGE_DIGEST_MISMATCH', 'PG_DUMP_VERSION_CHECK_FAILED', 'PG_DUMP_VERSION_MISMATCH',
    'CREDENTIAL_NOT_FOUND', 'CREDENTIAL_TARGET_MISMATCH', 'CREDENTIAL_SECRET_INVALID',
    'CREDENTIAL_TARGET_INVALID', 'CREDENTIAL_IDENTITY_INVALID', 'DATABASE_ATTESTATION_FAILED',
    'DATABASE_EVIDENCE_INVALID', 'SOURCE_EVIDENCE_INVALID', 'OUTPUT_PATHS_REQUIRED',
    'OUTPUT_PATHS_MUST_DIFFER', 'PG_DUMP_FAILED', 'BACKUP_FILE_INVALID',
    'ENVELOPE_METADATA_INVALID', 'ENVELOPE_BINDING_INVALID', 'PG_RESTORE_LIST_FAILED',
    'RESTORE_CONTAINER_START_FAILED', 'RESTORE_CONTAINER_START_INVALID', 'RESTORE_CONTAINER_NOT_READY',
    'PG_RESTORE_FAILED', 'RESTORE_EVIDENCE_QUERY_FAILED', 'RESTORE_EVIDENCE_INVALID',
    'RESTORE_AGGREGATE_MISMATCH', 'RESTORE_INTEGRITY_INVALID', 'RESTORE_CONTAINER_TEARDOWN_FAILED',
    'DPAPI_INPUT_INVALID', 'DPAPI_PROTECT_FAILED', 'DPAPI_UNPROTECT_FAILED',
    'PLAINTEXT_STREAM_INVALID', 'ENVELOPE_STREAM_INVALID', 'ENVELOPE_METADATA_TOO_LARGE',
    'ENVELOPE_TRUNCATED', 'ENVELOPE_MAGIC_INVALID', 'ENVELOPE_FORMAT_INVALID',
    'ENVELOPE_KEY_INVALID', 'ENVELOPE_KEY_UNAVAILABLE', 'ENVELOPE_AUTHENTICATION_FAILED',
    'PLAINTEXT_DESTINATION_INVALID',
    'SELF_TEST_METADATA_FAILED', 'SELF_TEST_ROUNDTRIP_FAILED', 'SELF_TEST_TAMPER_FAILED',
    'SELF_TEST_TRUNCATION_FAILED', 'SELF_TEST_PATH_REJECTION_FAILED',
    'SELF_TEST_LOG_REDACTION_FAILED', 'SELF_TEST_FAILURE_CLEANUP_FAILED', 'SAFEGUARD_FAILED'
) | ForEach-Object { [void]$script:PublicErrorCodes.Add($_) }

function Throw-Controlled {
    param([Parameter(Mandatory = $true)][string]$Code)
    if ($Code -notmatch '^[A-Z][A-Z0-9_]+$') { throw 'SAFEGUARD_FAILED' }
    throw $Code
}

function Get-ControlledCode {
    param([Parameter(Mandatory = $true)][Management.Automation.ErrorRecord]$Record)
    $message = $Record.Exception.Message
    if ($script:PublicErrorCodes.Contains($message)) { return $message }
    return 'SAFEGUARD_FAILED'
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
    $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { Throw-Controlled 'GIT_WORKTREE_DISCOVERY_FAILED' }
    return @(
        $stdout -split "`r?`n" |
            Where-Object { $_.StartsWith('worktree ', [StringComparison]::Ordinal) } |
            ForEach-Object { [IO.Path]::GetFullPath($_.Substring(9)) }
    )
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
    foreach ($worktree in (Get-WorktreeRoots)) {
        if (Test-PathWithin -Candidate $fullPath -Root $worktree) {
            Throw-Controlled 'OUTPUT_INSIDE_GIT_WORKTREE'
        }
    }
    $cursor = [IO.DirectoryInfo]::new($parent)
    while ($null -ne $cursor) {
        if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Throw-Controlled 'OUTPUT_REPARSE_PATH_REJECTED'
        }
        if (Test-Path -LiteralPath (Join-Path $cursor.FullName '.git')) {
            Throw-Controlled 'OUTPUT_INSIDE_GIT_WORKTREE'
        }
        $cursor = $cursor.Parent
    }
    return $fullPath
}

function Invoke-AtomicFile {
    param(
        [Parameter(Mandatory = $true)][string]$FinalPath,
        [Parameter(Mandatory = $true)][scriptblock]$Writer
    )
    $temporaryPath = "$FinalPath.partial-$([Guid]::NewGuid().ToString('N'))"
    try {
        & $Writer $temporaryPath
        if (-not (Test-Path -LiteralPath $temporaryPath -PathType Leaf)) {
            Throw-Controlled 'ATOMIC_OUTPUT_MISSING'
        }
        [IO.File]::Move($temporaryPath, $FinalPath)
    }
    catch {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
        throw
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
    foreach ($flag in @('APP_CHECKOUT_ENABLED', 'APP_CANARY_CHECKOUT_ENABLED')) {
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
    $stderrTask.GetAwaiter().GetResult()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { Throw-Controlled $FailureCode }
    return $stdout.Trim()
}

function Get-ReleaseSha {
    $sha = Invoke-SafeNativeText -FileName 'git' -Arguments @('-C', $script:RepoRoot, 'rev-parse', 'HEAD') -FailureCode 'RELEASE_SHA_UNAVAILABLE'
    if ($sha -notmatch '^[0-9a-f]{40}$') { Throw-Controlled 'RELEASE_SHA_INVALID' }
    $expectedSha = [Environment]::GetEnvironmentVariable('AP_PREMIGRATION_EXPECTED_RELEASE_SHA', 'Process')
    if ($expectedSha -notmatch '^[0-9a-f]{40}$' -or
        -not [string]::Equals($sha, $expectedSha, [StringComparison]::Ordinal)) {
        Throw-Controlled 'RELEASE_SHA_BINDING_INVALID'
    }
    foreach ($path in @('scripts/staging-database-safeguard.ps1', 'scripts/lib/ApplyPackStagingBackupEnvelope.cs')) {
        [void](Invoke-SafeNativeText -FileName 'git' -Arguments @(
            '-C', $script:RepoRoot, 'ls-files', '--error-unmatch', '--', $path
        ) -FailureCode 'SAFEGUARD_SOURCE_NOT_TRACKED')
        $start = New-ProcessStartInfo -FileName 'git' -Arguments @(
            '-C', $script:RepoRoot, 'diff', '--quiet', 'HEAD', '--', $path
        )
        $process = [Diagnostics.Process]::Start($start)
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
        $process.WaitForExit(); $stderrTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { Throw-Controlled 'SAFEGUARD_SOURCE_NOT_AT_RELEASE_SHA' }
    }
    return $sha
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
  'readiness', public.ap_manual_launch_schema_readiness()
)::text;
"@
}

function Get-DockerConnectionArguments {
    param(
        [Parameter(Mandatory = $true)][string]$CaPath,
        [Parameter(Mandatory = $true)][string]$Tool,
        [Parameter(Mandatory = $true)][string[]]$ToolArguments
    )
    $shell = 'IFS= read -r PGPASSWORD; export PGPASSWORD; export PGSSLMODE=verify-full; export PGSSLROOTCERT=/certs/root.crt; export PGCONNECT_TIMEOUT=15; exec "$@"'
    return @(
        'run', '--rm', '-i', '--pull', 'never',
        '--volume', "${CaPath}:/certs/root.crt:ro",
        '--entrypoint', 'sh', $script:PostgresImage,
        '-ec', $shell, '--', $Tool
    ) + $ToolArguments
}

function Invoke-CredentialedText {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.Security.CredentialMaterial]$Credential,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    $process = [Diagnostics.Process]::Start((New-ProcessStartInfo -FileName $DockerExecutable -Arguments $Arguments -RedirectInput $true -RedirectOutput $true))
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    try { $Credential.WriteLineTo($process.StandardInput); $process.StandardInput.Close() } catch { try { $process.Kill($true) } catch {}; throw }
    $process.WaitForExit()
    $stderrTask.GetAwaiter().GetResult()
    $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
    if ($process.ExitCode -ne 0) { Throw-Controlled $FailureCode }
    return $stdout
}

function Assert-SourceEvidence {
    param([Parameter(Mandatory = $true)]$Evidence)
    if ($Evidence.database -ne $script:DatabaseName -or
        $Evidence.currentUser -ne $script:CurrentUser -or
        $Evidence.ssl -ne $true -or
        [int]$Evidence.serverVersionNum -lt 170600 -or
        [int]$Evidence.publicTableCount -le 0 -or
        [int]$Evidence.rlsEnabledTableCount -le 0 -or
        [int]$Evidence.rlsPolicyCount -le 0 -or
        [int]$Evidence.invalidIndexCount -ne 0 -or
        [int]$Evidence.migrationCount -le 0 -or
        $Evidence.latestMigration -ne $script:ExpectedSchemaVersion -or
        $Evidence.migration080Present -ne $true -or
        [int]$Evidence.migrations081084Count -ne 0 -or
        $Evidence.readiness.schemaVersion -ne $script:ExpectedSchemaVersion -or
        $Evidence.readiness.ready -ne $true) {
        Throw-Controlled 'SOURCE_EVIDENCE_INVALID'
    }
}

function Get-SourceEvidence {
    param(
        [Parameter(Mandatory = $true)][ApplyPack.Security.CredentialMaterial]$Credential,
        [Parameter(Mandatory = $true)][string]$CaPath
    )
    $arguments = Get-DockerConnectionArguments -CaPath $CaPath -Tool 'psql' -ToolArguments @(
        '--no-password', '--no-psqlrc', '--tuples-only', '--no-align', '--quiet', '--set', 'ON_ERROR_STOP=1',
        '--host', $script:DatabaseHost, '--port', $script:DatabasePort,
        '--username', $script:LoginUser, '--dbname', $script:DatabaseName,
        '--command', (Get-SourceEvidenceSql)
    )
    $text = Invoke-CredentialedText -Credential $Credential -Arguments $arguments -FailureCode 'DATABASE_ATTESTATION_FAILED'
    try { $evidence = $text | ConvertFrom-Json } catch { Throw-Controlled 'DATABASE_EVIDENCE_INVALID' }
    Assert-SourceEvidence $evidence
    return $evidence
}

function Write-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Value)
    $json = $Value | ConvertTo-Json -Depth 12 -Compress
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
    try {
        $stream = [IO.FileStream]::new($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
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
        format = 'ApplyPackStagingDatabaseBackup'
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
    $resolvedBackup = Assert-SafeOutputPath -Path $BackupPath -ExpectedExtension '.apdb'
    $resolvedReceipt = Assert-SafeOutputPath -Path $ReceiptPath -ExpectedExtension '.json'
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
        $dumpArguments = Get-DockerConnectionArguments -CaPath $caPath -Tool 'pg_dump' -ToolArguments @(
            '--format=custom', '--no-password', '--host', $script:DatabaseHost,
            '--port', $script:DatabasePort, '--username', $script:LoginUser, '--dbname', $script:DatabaseName
        )

        Invoke-AtomicFile -FinalPath $resolvedBackup -Writer {
            param($temporaryPath)
            $process = [Diagnostics.Process]::Start((New-ProcessStartInfo -FileName $DockerExecutable -Arguments $dumpArguments -RedirectInput $true -RedirectOutput $true))
            $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
            try { $credential.WriteLineTo($process.StandardInput); $process.StandardInput.Close() } catch { try { $process.Kill($true) } catch {}; throw }
            $output = [IO.FileStream]::new($temporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                [ApplyPack.Security.StagingBackupEnvelope]::Encrypt($process.StandardOutput.BaseStream, $output, $metadataJson)
                $output.Flush($true)
            }
            finally { $output.Dispose() }
            $process.WaitForExit()
            $stderrTask.GetAwaiter().GetResult()
            if ($process.ExitCode -ne 0) { Throw-Controlled 'PG_DUMP_FAILED' }
        }

        try {
            $info = [ApplyPack.Security.StagingBackupEnvelope]::AuthenticateAndReadMetadata($resolvedBackup)
            $receipt = [ordered]@{
                operation = 'staging-backup'
                completedAt = [DateTimeOffset]::UtcNow.ToString('O')
                releaseSha = $releaseSha
                envelopeSha256 = Get-Sha256 $resolvedBackup
                envelopeBytes = $info.FileLength
                ciphertextBytes = $info.CiphertextLength
                caSha256 = $script:CaSha256
                postgresImageDigest = $script:PostgresImageDigest
                sourceEvidence = $evidence
            }
            Invoke-AtomicFile -FinalPath $resolvedReceipt -Writer { param($temporaryPath) Write-JsonFile -Path $temporaryPath -Value $receipt }
        }
        catch {
            Remove-Item -LiteralPath $resolvedBackup -Force -ErrorAction SilentlyContinue
            throw
        }
    }
    finally { if ($null -ne $credential) { $credential.Dispose() } }
    [ordered]@{ status = 'STAGING_BACKUP_ENCRYPTED'; receiptPath = $resolvedReceipt; envelopeSha256 = Get-Sha256 $resolvedBackup } | ConvertTo-Json -Compress
}

function Invoke-DecryptToProcess {
    param(
        [Parameter(Mandatory = $true)][string]$EnvelopePath,
        [Parameter(Mandatory = $true)][Diagnostics.ProcessStartInfo]$StartInfo,
        [Parameter(Mandatory = $true)][string]$FailureCode
    )
    $process = [Diagnostics.Process]::Start($StartInfo)
    $stdoutTask = if ($StartInfo.RedirectStandardOutput) { $process.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null) } else { $null }
    $stderrTask = $process.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
    try {
        [void][ApplyPack.Security.StagingBackupEnvelope]::DecryptAuthenticated($EnvelopePath, $process.StandardInput.BaseStream)
        $process.StandardInput.Close()
    }
    catch {
        try { $process.StandardInput.Close() } catch {}
        try { $process.Kill($true) } catch {}
        throw
    }
    $process.WaitForExit()
    $stderrTask.GetAwaiter().GetResult()
    if ($null -ne $stdoutTask) { $stdoutTask.GetAwaiter().GetResult() }
    if ($process.ExitCode -ne 0) { Throw-Controlled $FailureCode }
}

function Get-RestoreEvidence {
    param([Parameter(Mandatory = $true)][string]$ContainerName)
    $query = (Get-SourceEvidenceSql) -replace "coalesce\(\(select ssl from pg_stat_ssl where pid = pg_backend_pid\(\)\), false\)", 'false'
    $text = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
        'exec', $ContainerName, 'psql', '--no-psqlrc', '--tuples-only', '--no-align', '--quiet',
        '--set', 'ON_ERROR_STOP=1', '--username', 'postgres', '--dbname', 'postgres', '--command', $query
    ) -FailureCode 'RESTORE_EVIDENCE_QUERY_FAILED'
    try { return $text | ConvertFrom-Json } catch { Throw-Controlled 'RESTORE_EVIDENCE_INVALID' }
}

function Assert-RestoreEvidence {
    param($Source, $Restored)
    foreach ($field in @(
        'publicTableCount', 'rlsEnabledTableCount', 'rlsPolicyCount', 'publicTriggerCount',
        'publicFunctionCount', 'migrationCount', 'latestMigration', 'migration080Present', 'migrations081084Count'
    )) {
        if ([string]$Source.$field -ne [string]$Restored.$field) { Throw-Controlled 'RESTORE_AGGREGATE_MISMATCH' }
    }
    if ([int]$Restored.invalidIndexCount -ne 0 -or
        $Restored.latestMigration -ne $script:ExpectedSchemaVersion -or
        $Restored.migration080Present -ne $true -or
        [int]$Restored.migrations081084Count -ne 0 -or
        $Restored.readiness.schemaVersion -ne $script:ExpectedSchemaVersion -or
        $Restored.readiness.ready -ne $true) {
        Throw-Controlled 'RESTORE_INTEGRITY_INVALID'
    }
}

function Invoke-Restore {
    Assert-StagingBinding
    $resolvedBackup = Get-FullPath $BackupPath
    if (-not (Test-Path -LiteralPath $resolvedBackup -PathType Leaf) -or
        [IO.Path]::GetExtension($resolvedBackup) -ne '.apdb') { Throw-Controlled 'BACKUP_FILE_INVALID' }
    $resolvedReceipt = Assert-SafeOutputPath -Path $ReceiptPath -ExpectedExtension '.json'
    [void](Assert-PinnedImage)

    $info = [ApplyPack.Security.StagingBackupEnvelope]::AuthenticateAndReadMetadata($resolvedBackup)
    try { $metadata = $info.MetadataJson | ConvertFrom-Json } catch { Throw-Controlled 'ENVELOPE_METADATA_INVALID' }
    if ($metadata.format -ne 'ApplyPackStagingDatabaseBackup' -or
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
        [int]$metadata.sourceEvidence.migrations081084Count -ne 0) {
        Throw-Controlled 'ENVELOPE_BINDING_INVALID'
    }

    $listStart = New-ProcessStartInfo -FileName $DockerExecutable -Arguments @(
        'run', '--rm', '-i', '--network', 'none', '--pull', 'never',
        '--entrypoint', 'pg_restore', $script:PostgresImage, '--list'
    ) -RedirectInput $true -RedirectOutput $true
    Invoke-DecryptToProcess -EnvelopePath $resolvedBackup -StartInfo $listStart -FailureCode 'PG_RESTORE_LIST_FAILED'

    $containerName = "applypack-staging-restore-$([Guid]::NewGuid().ToString('N'))"
    $started = $false
    $restoredEvidence = $null
    try {
        $containerId = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
            'run', '--detach', '--rm', '--name', $containerName, '--network', 'none',
            '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=4g',
            '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--pull', 'never',
            '--entrypoint', 'docker-entrypoint.sh', $script:PostgresImage,
            'postgres', '-D', '/var/lib/postgresql/data'
        ) -FailureCode 'RESTORE_CONTAINER_START_FAILED'
        if ($containerId -notmatch '^[0-9a-f]{12,64}$') { Throw-Controlled 'RESTORE_CONTAINER_START_INVALID' }
        $started = $true
        $ready = $false
        for ($attempt = 0; $attempt -lt 45; $attempt += 1) {
            try {
                [void](Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
                    'exec', $containerName, 'pg_isready', '--username', 'postgres', '--dbname', 'postgres'
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

        $restoreStart = New-ProcessStartInfo -FileName $DockerExecutable -Arguments @(
            'exec', '-i', $containerName, 'pg_restore', '--exit-on-error', '--no-owner', '--no-privileges',
            '--clean', '--if-exists', '--username', 'postgres', '--dbname', 'postgres'
        ) -RedirectInput $true -RedirectOutput $true
        Invoke-DecryptToProcess -EnvelopePath $resolvedBackup -StartInfo $restoreStart -FailureCode 'PG_RESTORE_FAILED'
        $restoredEvidence = Get-RestoreEvidence -ContainerName $containerName
        Assert-RestoreEvidence -Source $metadata.sourceEvidence -Restored $restoredEvidence
    }
    finally {
        if ($started) {
            try { [void](Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @('rm', '--force', $containerName) -FailureCode 'RESTORE_CONTAINER_TEARDOWN_FAILED') } catch { throw }
            $inspectStart = New-ProcessStartInfo -FileName $DockerExecutable -Arguments @('inspect', $containerName) -RedirectOutput $true
            $inspect = [Diagnostics.Process]::Start($inspectStart)
            $outTask = $inspect.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
            $errTask = $inspect.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
            $inspect.WaitForExit(); $outTask.GetAwaiter().GetResult(); $errTask.GetAwaiter().GetResult()
            if ($inspect.ExitCode -eq 0) { Throw-Controlled 'RESTORE_CONTAINER_TEARDOWN_FAILED' }
        }
    }

    $receipt = [ordered]@{
        operation = 'isolated-staging-restore-drill'
        completedAt = [DateTimeOffset]::UtcNow.ToString('O')
        sourceReleaseSha = $metadata.releaseSha
        envelopeSha256 = Get-Sha256 $resolvedBackup
        postgresImageDigest = $script:PostgresImageDigest
        networkMode = 'none'
        publishedPorts = 0
        aggregateEvidence = $restoredEvidence
        teardownVerified = $true
    }
    Invoke-AtomicFile -FinalPath $resolvedReceipt -Writer { param($temporaryPath) Write-JsonFile -Path $temporaryPath -Value $receipt }
    [ordered]@{ status = 'STAGING_RESTORE_DRILL_VERIFIED'; receiptPath = $resolvedReceipt; envelopeSha256 = Get-Sha256 $resolvedBackup } | ConvertTo-Json -Compress
}

function Invoke-SelfTest {
    $testRoot = Join-Path ([IO.Path]::GetTempPath()) "applypack-staging-safeguard-$([Guid]::NewGuid().ToString('N'))"
    [IO.Directory]::CreateDirectory($testRoot) | Out-Null
    $marker = 'SELF_TEST_SECRET_DO_NOT_LOG_76291'
    try {
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

        $failurePath = Join-Path $testRoot 'failed.apdb'
        $caughtCode = $null
        try {
            Invoke-AtomicFile -FinalPath $failurePath -Writer {
                param($temporaryPath)
                [IO.File]::WriteAllBytes($temporaryPath, [byte[]](1, 2, 3))
                throw $marker
            }
        }
        catch { $caughtCode = Get-ControlledCode $_ }
        if ($caughtCode -ne 'SAFEGUARD_FAILED' -or $caughtCode.Contains($marker)) { Throw-Controlled 'SELF_TEST_LOG_REDACTION_FAILED' }
        if (Test-Path -LiteralPath $failurePath) { Throw-Controlled 'SELF_TEST_FAILURE_CLEANUP_FAILED' }
        if (@(Get-ChildItem -LiteralPath $testRoot -Filter '*.partial-*' -Force).Count -ne 0) { Throw-Controlled 'SELF_TEST_FAILURE_CLEANUP_FAILED' }
        if (($info.MetadataJson + ($caughtCode ?? '')).Contains($marker)) { Throw-Controlled 'SELF_TEST_LOG_REDACTION_FAILED' }

        [Array]::Clear($plain, 0, $plain.Length)
        [ordered]@{
            status = 'STAGING_DATABASE_SAFEGUARD_SELF_TEST_OK'
            dpapiCurrentUser = $true
            authenticatedEncryption = $true
            tamperRejected = $true
            truncationRejected = $true
            repositoryOutputRejected = $true
            failureCleanupVerified = $true
            secretLoggingRejected = $true
        } | ConvertTo-Json -Compress
    }
    finally {
        if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
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
    [Console]::Error.WriteLine((Get-ControlledCode $_))
    exit 1
}

Set-StrictMode -Version Latest

function Get-ProductionDatabaseEndpointType {
    param([Parameter(Mandatory)]$Manifest)
    # Classification is receipt metadata, not authorization. Hosted callers must
    # still pass the complete manifest, registry and scoped-approval checks.
    if ($Manifest.projectRef -cnotmatch '^[a-z]{20}$' -or
        $Manifest.projectRef -ceq 'fmugizadzdnqfckujqlw' -or $Manifest.port -ne 5432) {
        throw 'PRODUCTION_MANIFEST_INVALID'
    }
    if ($Manifest.host -ceq "db.$($Manifest.projectRef).supabase.co" -and $Manifest.loginUser -ceq 'postgres') {
        return 'direct'
    }
    if ($Manifest.host -cmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$' -and
        $Manifest.loginUser -ceq "postgres.$($Manifest.projectRef)") {
        return 'session-pooler'
    }
    throw 'PRODUCTION_MANIFEST_INVALID'
}

function Assert-ProductionDatabaseManifest {
    param([Parameter(Mandatory)]$Manifest, [Parameter(Mandatory)]$Registry)
    $expectedLoginUser = if ($Manifest.host -clike 'db.*') { 'postgres' } else { "postgres.$($Manifest.projectRef)" }
    if ($Manifest.version -ne 1 -or $Manifest.environment -cne 'production' -or
        $Manifest.projectRef -cnotmatch '^[a-z]{20}$' -or $Manifest.projectRef -ceq 'fmugizadzdnqfckujqlw' -or
        $Manifest.host -cnotmatch '^(db\.[a-z]{20}\.supabase\.co|aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com)$' -or
        $Manifest.port -ne 5432 -or $Manifest.database -cne 'postgres' -or $Manifest.currentUser -cne 'postgres' -or
        $Manifest.loginUser -cne $expectedLoginUser -or
        $Manifest.credentialTarget -cne 'ApplyPack/Supabase/Production/Database' -or
        $Manifest.caSha256 -cnotmatch '^[a-f0-9]{64}$' -or $Manifest.releaseSha -cnotmatch '^[a-f0-9]{40}$' -or
        $Manifest.expectedLedgerSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $Manifest.expectedSchemaVersion -notin @('202610040080','202610190081','202610190082','202610190083','202610190084','202610220085','202610230086','202610240087','202610250088','202610250089','202610250090','202610250091','202610250092','202610250093','202610250094','202610250095','202610250096','202610250097','202610250098','202610250099') -or
        $Manifest.postSchemaVersion -notin @('202610240087','202610250088','202610250089','202610250090','202610250091','202610250092','202610250093','202610250094','202610250095','202610250096','202610250097','202610250098','202610250099','202610250100') -or
        $Manifest.expectedSchemaVersion -cge $Manifest.postSchemaVersion -or
        $Manifest.recoveryStrategy -notin @('TESTED_COMPATIBLE_SHA','LOCKED_FORWARD_RECOVERY')) {
        throw 'PRODUCTION_MANIFEST_INVALID'
    }
    if ($Manifest.host.StartsWith('db.') -and $Manifest.host -cne "db.$($Manifest.projectRef).supabase.co") {
        throw 'PRODUCTION_MANIFEST_INVALID'
    }
    # The trusted registry is committed source, separate from caller-supplied manifests.
    # Empty means no production target has been approved. Tests never replace this file.
    $matches = @($Registry.targets | Where-Object {
        $_.environment -ceq 'production' -and $_.projectRef -ceq $Manifest.projectRef -and
        $_.host -ceq $Manifest.host -and $_.port -eq $Manifest.port -and
        $_.caSha256 -ceq $Manifest.caSha256 -and $_.credentialTarget -ceq $Manifest.credentialTarget
    })
    if ($Registry.version -ne 1 -or $matches.Count -ne 1) { throw 'PRODUCTION_TARGET_NOT_TRUSTED' }
    if (@($Manifest.expectedLedger).Count -eq 0) { throw 'PRODUCTION_LEDGER_INVALID' }
    $previous = ''
    foreach ($entry in $Manifest.expectedLedger) {
        if ($entry.version -cnotmatch '^\d{12}$' -or $entry.version -cle $previous -or
            $entry.name -cnotmatch '^[a-z0-9_]+$' -or $entry.statementCount -lt 1 -or
            $entry.statementsDigest -cnotmatch '^[a-f0-9]{64}$') { throw 'PRODUCTION_LEDGER_INVALID' }
        $previous = $entry.version
    }
    if ($previous -cne $Manifest.expectedSchemaVersion) { throw 'PRODUCTION_LEDGER_INVALID' }
    $ledgerText = @($Manifest.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
    $ledgerHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText))).ToLowerInvariant()
    if ($ledgerHash -cne $Manifest.expectedLedgerSha256) { throw 'PRODUCTION_LEDGER_INVALID' }
    $known = [ordered]@{
        '202610190081' = @('open_font_document_contract','OPEN_FONT_DOCUMENT_CONTRACT')
        '202610190082' = @('tax_activation_decision','TAX_ACTIVATION_DECISION')
        '202610190083' = @('legacy_board_read_only_archive','LEGACY_BOARD_READ_ONLY_ARCHIVE')
        '202610190084' = @('legacy_board_terminal_event_ordering','LEGACY_BOARD_TERMINAL_EVENT_ORDERING')
        '202610220085' = @('staging_rehearsal_checkout_attempts','STAGING_REHEARSAL_CHECKOUT_ATTEMPTS')
        '202610230086' = @('sandbox_validation_launch_activation','SANDBOX_VALIDATION_LAUNCH_ACTIVATION')
        '202610240087' = @('one_off_service_retention','ONE_OFF_SERVICE_RETENTION')
        '202610250088' = @('service_retention_cleanup','SERVICE_RETENTION_CLEANUP')
        '202610250089' = @('confirmed_intake','CONFIRMED_INTAKE')
        '202610250090' = @('matching_evidence_completion','MATCHING_EVIDENCE_COMPLETION')
        '202610250091' = @('material_draft_pair_workflow','MATERIAL_DRAFT_PAIR_WORKFLOW')
        '202610250092' = @('material_rule_revalidation','MATERIAL_RULE_REVALIDATION')
        '202610250093' = @('source_aware_document_acceptance','SOURCE_AWARE_DOCUMENT_ACCEPTANCE')
        '202610250094' = @('material_draft_stage_claiming','MATERIAL_DRAFT_STAGE_CLAIMING')
        '202610250095' = @('reference_aware_draft_delivery','REFERENCE_AWARE_DRAFT_DELIVERY')
        '202610250096' = @('service_error_contract_and_triage','SERVICE_ERROR_CONTRACT_AND_TRIAGE')
        '202610250097' = @('material_draft_change_requests','MATERIAL_DRAFT_CHANGE_REQUESTS')
        '202610250098' = @('protected_archive_lifecycle','PROTECTED_ARCHIVE_LIFECYCLE')
        '202610250099' = @('scoped_service_error_repairs','SCOPED_SERVICE_ERROR_REPAIRS')
        '202610250100' = @('automatic_research_preparation','AUTOMATIC_RESEARCH_PREPARATION')
    }
    $expected = @($known.Keys | Where-Object { $_ -cgt $Manifest.expectedSchemaVersion -and $_ -cle $Manifest.postSchemaVersion })
    if (@($Manifest.migrations).Count -ne $expected.Count) { throw 'PRODUCTION_MIGRATION_SCOPE_INVALID' }
    $previousCheckpoint = if ($previous -ceq '202610040080') { 'PERSISTENT_INVENTORY_IDENTITY_GUARD' } else { $known[$previous][1] }
    for ($index = 0; $index -lt $expected.Count; $index++) {
        $entry = $Manifest.migrations[$index]
        $version = $expected[$index]
        $name, $checkpoint = $known[$version]
        if ($entry.version -cne $version -or $entry.name -cne $name -or $entry.checkpoint -cne $checkpoint -or
            $entry.relativePath -cne "supabase/migrations/${version}_${name}.sql" -or
            $entry.predecessor -cne $previous -or $entry.predecessorCheckpoint -cne $previousCheckpoint -or
            $entry.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'PRODUCTION_MIGRATION_SCOPE_INVALID' }
        $previous = $version
        $previousCheckpoint = $checkpoint
    }
    if ([string]::IsNullOrWhiteSpace($Manifest.quiescenceReference) -or
        [string]::IsNullOrWhiteSpace($Manifest.protectedRecoveryReference) -or
        [string]::IsNullOrWhiteSpace($Manifest.offMachineRecoveryReference) -or
        [string]::IsNullOrWhiteSpace($Manifest.privateObjectsBackupReference) -or
        $Manifest.acceptedRecoveryTimeMinutes -lt 1 -or $Manifest.acceptedRecoveryTimeMinutes -gt 240 -or
        $Manifest.acceptedDataLossMinutes -lt 0 -or $Manifest.acceptedDataLossMinutes -gt 15 -or
        ($Manifest.recoveryStrategy -ceq 'TESTED_COMPATIBLE_SHA' -and $Manifest.rollbackSha -cnotmatch '^[a-f0-9]{40}$')) {
        throw 'PRODUCTION_RECOVERY_EVIDENCE_REQUIRED'
    }
}

function Read-ApprovedProductionDatabaseManifest {
    param([string]$Path, [string]$ExpectedSha256, [string]$RepositoryRoot, [string]$Operation)
    if (![IO.Path]::IsPathFullyQualified($Path) -or $ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$') {
        throw 'PRODUCTION_APPROVED_MANIFEST_REQUIRED'
    }
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSha256) {
        throw 'PRODUCTION_MANIFEST_HASH_MISMATCH'
    }
    $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $registry = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'docs/launch/production-database-targets.json') -Raw | ConvertFrom-Json
    Assert-ProductionDatabaseManifest -Manifest $manifest -Registry $registry
    foreach ($flag in @('APP_CHECKOUT_ENABLED','APP_CANARY_CHECKOUT_ENABLED','APP_REHEARSAL_CHECKOUT_ENABLED',
        'APP_LIVE_PAYMENTS_ENABLED','APP_JOB_BOARD_CHECKOUT_ENABLED','APP_JOB_SOURCE_SYNC_ENABLED','APP_SERVICE_RETENTION_ENABLED')) {
        if ([Environment]::GetEnvironmentVariable($flag, 'Process') -cne 'false') { throw 'PRODUCTION_CHECKOUT_NOT_LOCKED' }
    }
    if ([Environment]::GetEnvironmentVariable('AP_DEPLOYMENT_ENV', 'Process') -cne 'production' -or
        [Environment]::GetEnvironmentVariable('AP_PREMIGRATION_EXPECTED_RELEASE_SHA', 'Process') -cne $manifest.releaseSha -or
        [Environment]::GetEnvironmentVariable('AP_PRODUCTION_DATABASE_AUTHORIZATION', 'Process') -cne
            "$($Operation.ToLowerInvariant()):$($manifest.projectRef):$($manifest.releaseSha):$ExpectedSha256") {
        throw 'PRODUCTION_SCOPED_AUTHORIZATION_REQUIRED'
    }
    return $manifest
}

function Assert-ProductionSourceHashes {
    param($Manifest, [string]$RepositoryRoot)
    foreach ($entry in $Manifest.migrations) {
        if ((Get-FileHash -LiteralPath (Join-Path $RepositoryRoot $entry.relativePath) -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) {
            throw 'PRODUCTION_MIGRATION_HASH_MISMATCH'
        }
    }
}

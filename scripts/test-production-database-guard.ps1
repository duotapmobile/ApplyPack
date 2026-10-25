[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib/ProductionDatabaseGuard.ps1')

$entry = [ordered]@{ version='202610190084'; name='legacy_board_terminal_event_ordering'; statementCount=1; statementsDigest=('b' * 64) }
$ledgerText = "$($entry.version):$($entry.name):1:$($entry.statementsDigest)"
$fixture = [ordered]@{
    version=1; environment='production'; projectRef=('z' * 20); host='aws-0-us-east-1.pooler.supabase.com'; port=5432
    database='postgres'; currentUser='postgres'; loginUser=('postgres.' + ('z' * 20))
    credentialTarget='ApplyPack/Supabase/Production/Database'; caSha256=('c' * 64); releaseSha=('a' * 40)
    expectedSchemaVersion='202610190084'; postSchemaVersion='202610240087'; expectedLedger=@($entry)
    expectedLedgerSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText))).ToLowerInvariant()
    recoveryStrategy='LOCKED_FORWARD_RECOVERY'; quiescenceReference='fixture:no-writers'; protectedRecoveryReference='fixture:recovery'
    offMachineRecoveryReference='fixture:independent-recovery'; privateObjectsBackupReference='fixture:objects'
    acceptedRecoveryTimeMinutes=60; acceptedDataLossMinutes=15
    migrations=@([ordered]@{
        version='202610220085'; name='staging_rehearsal_checkout_attempts'; checkpoint='STAGING_REHEARSAL_CHECKOUT_ATTEMPTS'
        relativePath='supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql'
        predecessor='202610190084'; predecessorCheckpoint='LEGACY_BOARD_TERMINAL_EVENT_ORDERING'; sha256=('d' * 64)
    }, [ordered]@{
        version='202610230086'; name='sandbox_validation_launch_activation'; checkpoint='SANDBOX_VALIDATION_LAUNCH_ACTIVATION'
        relativePath='supabase/migrations/202610230086_sandbox_validation_launch_activation.sql'
        predecessor='202610220085'; predecessorCheckpoint='STAGING_REHEARSAL_CHECKOUT_ATTEMPTS'; sha256=('e' * 64)
    }, [ordered]@{
        version='202610240087'; name='one_off_service_retention'; checkpoint='ONE_OFF_SERVICE_RETENTION'
        relativePath='supabase/migrations/202610240087_one_off_service_retention.sql'
        predecessor='202610230086'; predecessorCheckpoint='SANDBOX_VALIDATION_LAUNCH_ACTIVATION'; sha256=('f' * 64)
    })
}
$registry = [ordered]@{ version=1; targets=@([ordered]@{
    environment='production'; projectRef=$fixture.projectRef; host=$fixture.host; port=5432
    caSha256=$fixture.caSha256; credentialTarget=$fixture.credentialTarget
}) }
function Copy-Fixture { return ($fixture | ConvertTo-Json -Depth 10 | ConvertFrom-Json) }
$checks = 0
Assert-ProductionDatabaseManifest -Manifest (Copy-Fixture) -Registry $registry
$checks++
if ((Get-ProductionDatabaseEndpointType -Manifest (Copy-Fixture)) -cne 'session-pooler') {
    throw 'GUARD_RECEIPT_POOLER_CLASSIFICATION_INVALID'
}
$checks++
$direct = Copy-Fixture
$direct.host = "db.$($direct.projectRef).supabase.co"
$direct.loginUser = 'postgres'
$directRegistry = $registry | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$directRegistry.targets[0].host = $direct.host
Assert-ProductionDatabaseManifest -Manifest $direct -Registry $directRegistry
$checks++
if ((Get-ProductionDatabaseEndpointType -Manifest $direct) -cne 'direct') {
    throw 'GUARD_RECEIPT_DIRECT_CLASSIFICATION_INVALID'
}
$checks++
foreach ($mutation in @(
    { param($x) $x.loginUser = "postgres.$($x.projectRef)" },
    { param($x) $x.host = 'db.abcdefghijklmnopqrst.supabase.co' }
)) {
    $changed = $direct | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    & $mutation $changed
    $rejected = $false
    try { Assert-ProductionDatabaseManifest -Manifest $changed -Registry $directRegistry } catch { $rejected = $true }
    if (!$rejected) { throw 'GUARD_ACCEPTED_DIRECT_ENDPOINT_DRIFT' }
    $receiptRejected = $false
    try { [void](Get-ProductionDatabaseEndpointType -Manifest $changed) } catch { $receiptRejected = $true }
    if (!$receiptRejected) { throw 'GUARD_CLASSIFIED_INVALID_DIRECT_ENDPOINT' }
    $checks++
}
$cases = @(
    @{ field='environment'; value='staging' }, @{ field='environment'; value='preview' },
    @{ field='projectRef'; value='fmugizadzdnqfckujqlw' }, @{ field='host'; value='localhost' },
    @{ field='host'; value='aws-0-us-west-2.pooler.supabase.com' }, @{ field='port'; value=6543 },
    @{ field='database'; value='template1' }, @{ field='currentUser'; value='app_user' },
    @{ field='loginUser'; value='postgres.other' }, @{ field='credentialTarget'; value='ApplyPack/Supabase/Staging/Database' },
    @{ field='caSha256'; value=('e' * 64) }, @{ field='releaseSha'; value='main' },
    @{ field='expectedSchemaVersion'; value='202610220085' }, @{ field='expectedLedgerSha256'; value=('f' * 64) },
    @{ field='protectedRecoveryReference'; value='' }, @{ field='offMachineRecoveryReference'; value='' },
    @{ field='privateObjectsBackupReference'; value='' }, @{ field='acceptedRecoveryTimeMinutes'; value=0 },
    @{ field='acceptedRecoveryTimeMinutes'; value=241 }, @{ field='acceptedDataLossMinutes'; value=16 },
    @{ field='postSchemaVersion'; value='202610220085' }
)
foreach ($case in $cases) {
    $changed = Copy-Fixture
    $changed.($case.field) = $case.value
    $rejected = $false
    try { Assert-ProductionDatabaseManifest -Manifest $changed -Registry $registry } catch { $rejected = $true }
    if (!$rejected) { throw "GUARD_ACCEPTED_$($case.field)" }
    $checks++
}
foreach ($mutation in @(
    { param($x) $x.migrations[0].sha256='wrong' },
    { param($x) $x.migrations[0].relativePath='../unreviewed.sql' },
    { param($x) $x.migrations[0].predecessor='202610040080' },
    { param($x) $x.expectedLedger[0].statementsDigest='c' * 64 },
    { param($x) $x.migrations=@() }
)) {
    $changed = Copy-Fixture
    & $mutation $changed
    $rejected = $false
    try { Assert-ProductionDatabaseManifest -Manifest $changed -Registry $registry } catch { $rejected = $true }
    if (!$rejected) { throw 'GUARD_ACCEPTED_DRIFT' }
    $checks++
}
# A verified085 ledger advances through087; the already-published085 bytes are
# retained as the predecessor digest and cannot be silently reapplied.
$from085 = Copy-Fixture
$from085.expectedSchemaVersion = '202610220085'
$from085.expectedLedger = @($from085.expectedLedger) + @([pscustomobject]@{
    version='202610220085'; name='staging_rehearsal_checkout_attempts'; statementCount=1; statementsDigest=('d' * 64)
})
$ledgerText085 = @($from085.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$from085.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText085))).ToLowerInvariant()
$from085.migrations = @($from085.migrations[1], $from085.migrations[2])
Assert-ProductionDatabaseManifest -Manifest $from085 -Registry $registry
$checks++
foreach ($mutation in @(
    { param($x) $x.migrations = @($fixture.migrations) },
    { param($x) $x.migrations[0].predecessor = '202610190084' },
    { param($x) $x.postSchemaVersion = '202610220085' }
)) {
    $changed = $from085 | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    & $mutation $changed
    $rejected = $false
    try { Assert-ProductionDatabaseManifest -Manifest $changed -Registry $registry } catch { $rejected = $true }
    if (!$rejected) { throw 'GUARD_ACCEPTED_085_HISTORY_REINTERPRETATION' }
    $checks++
}
# A verified086 ledger adds only087. Neither an old target nor a replayed
# historical migration can be substituted for the new approved policy change.
$from086 = $from085 | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$from086.expectedSchemaVersion = '202610230086'
$from086.expectedLedger = @($from086.expectedLedger) + @([pscustomobject]@{
    version='202610230086'; name='sandbox_validation_launch_activation'; statementCount=1; statementsDigest=('e' * 64)
})
$ledgerText086 = @($from086.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$from086.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText086))).ToLowerInvariant()
$from086.migrations = @($from086.migrations[1])
Assert-ProductionDatabaseManifest -Manifest $from086 -Registry $registry
$checks++
foreach ($mutation in @(
    { param($x) $x.migrations = @($fixture.migrations) },
    { param($x) $x.migrations[0].predecessor = '202610220085' },
    { param($x) $x.postSchemaVersion = '202610230086' }
)) {
    $changed = $from086 | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    & $mutation $changed
    $rejected = $false
    try { Assert-ProductionDatabaseManifest -Manifest $changed -Registry $registry } catch { $rejected = $true }
    if (!$rejected) { throw 'GUARD_ACCEPTED_086_HISTORY_REINTERPRETATION' }
    $checks++
}
# Every current forward boundary preserves its predecessor ledger and applies
# only the missing, exact ordered suffix. The historical087 cases above remain.
$current = Copy-Fixture
$current.postSchemaVersion = '202610250092'
foreach ($extra in @(
    @('202610250088','service_retention_cleanup','SERVICE_RETENTION_CLEANUP','202610240087','ONE_OFF_SERVICE_RETENTION'),
    @('202610250089','confirmed_intake','CONFIRMED_INTAKE','202610250088','SERVICE_RETENTION_CLEANUP'),
    @('202610250090','matching_evidence_completion','MATCHING_EVIDENCE_COMPLETION','202610250089','CONFIRMED_INTAKE'),
    @('202610250091','material_draft_pair_workflow','MATERIAL_DRAFT_PAIR_WORKFLOW','202610250090','MATCHING_EVIDENCE_COMPLETION'),
    @('202610250092','material_rule_revalidation','MATERIAL_RULE_REVALIDATION','202610250091','MATERIAL_DRAFT_PAIR_WORKFLOW')
)) {
    $current.migrations += [pscustomobject]@{version=$extra[0];name=$extra[1];checkpoint=$extra[2];relativePath="supabase/migrations/$($extra[0])_$($extra[1]).sql";predecessor=$extra[3];predecessorCheckpoint=$extra[4];sha256=('a' * 64)}
}
Assert-ProductionDatabaseManifest -Manifest $current -Registry $registry
$checks++
$historical091 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical091.postSchemaVersion = '202610250091'
$historical091.migrations = @($historical091.migrations | Where-Object version -cle '202610250091')
Assert-ProductionDatabaseManifest -Manifest $historical091 -Registry $registry
$checks++
foreach ($boundary in @('202610240087','202610250088','202610250089','202610250090','202610250091')) {
    $advance = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    $advance.expectedSchemaVersion = $boundary
    $advance.expectedLedger = @($entry) + @($advance.migrations | Where-Object { $_.version -cle $boundary } | ForEach-Object {
        [pscustomobject]@{version=$_.version;name=$_.name;statementCount=1;statementsDigest=$_.sha256}
    })
    $text = @($advance.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
    $advance.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($text))).ToLowerInvariant()
    $advance.migrations = @($advance.migrations | Where-Object { $_.version -cgt $boundary })
    Assert-ProductionDatabaseManifest -Manifest $advance -Registry $registry
    $checks++
    foreach ($mutation in @(
        { param($x) $x.migrations[0].checkpoint='WRONG_CHECKPOINT' },
        { param($x) $x.migrations[0].predecessor='202610190084' },
        { param($x) $x.migrations=@($x.migrations) + @($x.migrations[-1]) },
        { param($x) $x.expectedLedger[-1].statementsDigest=('9' * 64) }
    )) {
        $changed = $advance | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        & $mutation $changed
        $rejected=$false
        try { Assert-ProductionDatabaseManifest -Manifest $changed -Registry $registry } catch { $rejected=$true }
        if (!$rejected) { throw 'GUARD_ACCEPTED_CURRENT_FORWARD_DRIFT' }
        $checks++
    }
}
# The production entrypoints always read this committed registry. The fixture
# registry above is passed only to the pure validator and grants no access.
$actualRegistry = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../docs/launch/production-database-targets.json') -Raw | ConvertFrom-Json
$rejected = $false
try { Assert-ProductionDatabaseManifest -Manifest (Copy-Fixture) -Registry $actualRegistry } catch { $rejected = $_.Exception.Message -ceq 'PRODUCTION_TARGET_NOT_TRUSTED' }
if (!$rejected) { throw 'FIXTURE_TARGET_MUST_NEVER_BE_TRUSTED' }
$checks++
[ordered]@{ status='PASS'; checks=$checks; providerCalls=0; productionCredentialsRead=$false; fixtureTargetTrusted=$false } | ConvertTo-Json -Compress

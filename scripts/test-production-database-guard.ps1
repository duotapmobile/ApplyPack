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
    expectedSchemaVersion='202610190084'; postSchemaVersion='202610230086'; expectedLedger=@($entry)
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
# A verified085 ledger advances only086; the already-published085 bytes are
# retained as the predecessor digest and cannot be silently reapplied.
$from085 = Copy-Fixture
$from085.expectedSchemaVersion = '202610220085'
$from085.expectedLedger = @($from085.expectedLedger) + @([pscustomobject]@{
    version='202610220085'; name='staging_rehearsal_checkout_attempts'; statementCount=1; statementsDigest=('d' * 64)
})
$ledgerText085 = @($from085.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$from085.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText085))).ToLowerInvariant()
$from085.migrations = @($from085.migrations[1])
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
# The production entrypoints always read this committed registry. The fixture
# registry above is passed only to the pure validator and grants no access.
$actualRegistry = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../docs/launch/production-database-targets.json') -Raw | ConvertFrom-Json
$rejected = $false
try { Assert-ProductionDatabaseManifest -Manifest (Copy-Fixture) -Registry $actualRegistry } catch { $rejected = $_.Exception.Message -ceq 'PRODUCTION_TARGET_NOT_TRUSTED' }
if (!$rejected) { throw 'FIXTURE_TARGET_MUST_NEVER_BE_TRUSTED' }
$checks++
[ordered]@{ status='PASS'; checks=$checks; providerCalls=0; productionCredentialsRead=$false; fixtureTargetTrusted=$false } | ConvertTo-Json -Compress

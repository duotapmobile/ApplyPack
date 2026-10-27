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
$current.postSchemaVersion = '202610270104'
foreach ($extra in @(
    @('202610250088','service_retention_cleanup','SERVICE_RETENTION_CLEANUP','202610240087','ONE_OFF_SERVICE_RETENTION'),
    @('202610250089','confirmed_intake','CONFIRMED_INTAKE','202610250088','SERVICE_RETENTION_CLEANUP'),
    @('202610250090','matching_evidence_completion','MATCHING_EVIDENCE_COMPLETION','202610250089','CONFIRMED_INTAKE'),
    @('202610250091','material_draft_pair_workflow','MATERIAL_DRAFT_PAIR_WORKFLOW','202610250090','MATCHING_EVIDENCE_COMPLETION'),
    @('202610250092','material_rule_revalidation','MATERIAL_RULE_REVALIDATION','202610250091','MATERIAL_DRAFT_PAIR_WORKFLOW'),
    @('202610250093','source_aware_document_acceptance','SOURCE_AWARE_DOCUMENT_ACCEPTANCE','202610250092','MATERIAL_RULE_REVALIDATION'),
    @('202610250094','material_draft_stage_claiming','MATERIAL_DRAFT_STAGE_CLAIMING','202610250093','SOURCE_AWARE_DOCUMENT_ACCEPTANCE'),
    @('202610250095','reference_aware_draft_delivery','REFERENCE_AWARE_DRAFT_DELIVERY','202610250094','MATERIAL_DRAFT_STAGE_CLAIMING'),
    @('202610250096','service_error_contract_and_triage','SERVICE_ERROR_CONTRACT_AND_TRIAGE','202610250095','REFERENCE_AWARE_DRAFT_DELIVERY'),
    @('202610250097','material_draft_change_requests','MATERIAL_DRAFT_CHANGE_REQUESTS','202610250096','SERVICE_ERROR_CONTRACT_AND_TRIAGE'),
    @('202610250098','protected_archive_lifecycle','PROTECTED_ARCHIVE_LIFECYCLE','202610250097','MATERIAL_DRAFT_CHANGE_REQUESTS'),
    @('202610250099','scoped_service_error_repairs','SCOPED_SERVICE_ERROR_REPAIRS','202610250098','PROTECTED_ARCHIVE_LIFECYCLE'),
    @('202610250100','automatic_research_preparation','AUTOMATIC_RESEARCH_PREPARATION','202610250099','SCOPED_SERVICE_ERROR_REPAIRS'),
    @('202610250101','material_clarification_confirmation','MATERIAL_CLARIFICATION_CONFIRMATION','202610250100','AUTOMATIC_RESEARCH_PREPARATION'),
    @('202610260102','service_repair_case_state_cas','SERVICE_REPAIR_CASE_STATE_CAS','202610250101','MATERIAL_CLARIFICATION_CONFIRMATION'),
    @('202610260103','material_clarification_resume','MATERIAL_CLARIFICATION_RESUME','202610260102','SERVICE_REPAIR_CASE_STATE_CAS'),
    @('202610270104','employer_rule_review_confirmation','EMPLOYER_RULE_REVIEW_CONFIRMATION','202610260103','MATERIAL_CLARIFICATION_RESUME')
)) {
    $current.migrations += [pscustomobject]@{version=$extra[0];name=$extra[1];checkpoint=$extra[2];relativePath="supabase/migrations/$($extra[0])_$($extra[1]).sql";predecessor=$extra[3];predecessorCheckpoint=$extra[4];sha256=('a' * 64)}
}
Assert-ProductionDatabaseManifest -Manifest $current -Registry $registry
$checks++
$historical091 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical091.postSchemaVersion = '202610250091'
$historical091.migrations = @($historical091.migrations | Where-Object version -cle '202610250091')
Assert-ProductionDatabaseManifest -Manifest $historical091 -Registry $registry
$historical092 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical092.postSchemaVersion = '202610250092'
$historical092.migrations = @($historical092.migrations | Where-Object version -cle '202610250092')
Assert-ProductionDatabaseManifest -Manifest $historical092 -Registry $registry
$checks++
$historical093 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical093.postSchemaVersion = '202610250093'
$historical093.migrations = @($historical093.migrations | Where-Object version -cle '202610250093')
Assert-ProductionDatabaseManifest -Manifest $historical093 -Registry $registry
$checks++
$historical094 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical094.postSchemaVersion = '202610250094'
$historical094.migrations = @($historical094.migrations | Where-Object version -cle '202610250094')
Assert-ProductionDatabaseManifest -Manifest $historical094 -Registry $registry
$checks++
$historical095 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical095.postSchemaVersion = '202610250095'
$historical095.migrations = @($historical095.migrations | Where-Object version -cle '202610250095')
Assert-ProductionDatabaseManifest -Manifest $historical095 -Registry $registry
$checks++
$historical096 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical096.postSchemaVersion = '202610250096'
$historical096.migrations = @($historical096.migrations | Where-Object version -cle '202610250096')
Assert-ProductionDatabaseManifest -Manifest $historical096 -Registry $registry
$checks++
$historical097 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical097.postSchemaVersion = '202610250097'
$historical097.migrations = @($historical097.migrations | Where-Object version -cle '202610250097')
Assert-ProductionDatabaseManifest -Manifest $historical097 -Registry $registry
$checks++
$historical097Suffix = $historical097 | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical097Suffix.expectedSchemaVersion = '202610250096'
$historical097Suffix.expectedLedger = @($entry) + @($historical097Suffix.migrations | Where-Object version -cle '202610250096' | ForEach-Object {
    [pscustomobject]@{version=$_.version;name=$_.name;statementCount=1;statementsDigest=$_.sha256}
})
$ledgerText = @($historical097Suffix.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$historical097Suffix.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText))).ToLowerInvariant()
$historical097Suffix.migrations = @($historical097Suffix.migrations | Where-Object version -cgt '202610250096')
if ($historical097Suffix.migrations.Count -ne 1 -or $historical097Suffix.migrations[0].version -cne '202610250097' -or
    $historical097Suffix.migrations[0].predecessorCheckpoint -cne 'SERVICE_ERROR_CONTRACT_AND_TRIAGE' -or
    $historical097Suffix.expectedLedger[-1].version -cne '202610250096') { throw 'GUARD_097_ONLY_SUFFIX_FIXTURE_INVALID' }
Assert-ProductionDatabaseManifest -Manifest $historical097Suffix -Registry $registry
$checks++
$historical098 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical098.postSchemaVersion = '202610250098'
$historical098.migrations = @($historical098.migrations | Where-Object version -cle '202610250098')
Assert-ProductionDatabaseManifest -Manifest $historical098 -Registry $registry
$historical098.expectedSchemaVersion = '202610250097'
$historical098.expectedLedger = @($entry) + @($historical098.migrations | Where-Object version -cle '202610250097' | ForEach-Object {
    [pscustomobject]@{version=$_.version;name=$_.name;statementCount=1;statementsDigest=$_.sha256}
})
$ledgerText = @($historical098.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$historical098.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText))).ToLowerInvariant()
$historical098.migrations = @($historical098.migrations | Where-Object version -cgt '202610250097')
if (@($historical098.migrations).Count -ne 1 -or $historical098.migrations[0].version -cne '202610250098' -or
    $historical098.migrations[0].predecessorCheckpoint -cne 'MATERIAL_DRAFT_CHANGE_REQUESTS' -or
    $historical098.expectedLedger[-1].version -cne '202610250097') { throw 'GUARD_098_ONLY_SUFFIX_FIXTURE_INVALID' }
Assert-ProductionDatabaseManifest -Manifest $historical098 -Registry $registry
$checks++
$historical099 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical099.postSchemaVersion = '202610250099'
$historical099.migrations = @($historical099.migrations | Where-Object version -cle '202610250099')
Assert-ProductionDatabaseManifest -Manifest $historical099 -Registry $registry
$historical099.expectedSchemaVersion = '202610250098'
$historical099.expectedLedger = @($entry) + @($historical099.migrations | Where-Object version -cle '202610250098' | ForEach-Object {
    [pscustomobject]@{version=$_.version;name=$_.name;statementCount=1;statementsDigest=$_.sha256}
})
$ledgerText = @($historical099.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$historical099.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText))).ToLowerInvariant()
$historical099.migrations = @($historical099.migrations | Where-Object version -cgt '202610250098')
if (@($historical099.migrations).Count -ne 1 -or $historical099.migrations[0].version -cne '202610250099' -or
    $historical099.migrations[0].predecessorCheckpoint -cne 'PROTECTED_ARCHIVE_LIFECYCLE' -or
    $historical099.expectedLedger[-1].version -cne '202610250098') { throw 'GUARD_099_ONLY_SUFFIX_FIXTURE_INVALID' }
Assert-ProductionDatabaseManifest -Manifest $historical099 -Registry $registry
$checks++
$historical100 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical100.postSchemaVersion = '202610250100'
$historical100.migrations = @($historical100.migrations | Where-Object version -cle '202610250100')
Assert-ProductionDatabaseManifest -Manifest $historical100 -Registry $registry
$historical100.expectedSchemaVersion = '202610250099'
$historical100.expectedLedger = @($entry) + @($historical100.migrations | Where-Object version -cle '202610250099' | ForEach-Object {
    [pscustomobject]@{version=$_.version;name=$_.name;statementCount=1;statementsDigest=$_.sha256}
})
$ledgerText = @($historical100.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$historical100.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText))).ToLowerInvariant()
$historical100.migrations = @($historical100.migrations | Where-Object version -cgt '202610250099')
if (@($historical100.migrations).Count -ne 1 -or $historical100.migrations[0].version -cne '202610250100' -or
    $historical100.migrations[0].predecessorCheckpoint -cne 'SCOPED_SERVICE_ERROR_REPAIRS' -or
    $historical100.expectedLedger[-1].version -cne '202610250099') { throw 'GUARD_100_ONLY_SUFFIX_FIXTURE_INVALID' }
Assert-ProductionDatabaseManifest -Manifest $historical100 -Registry $registry
$checks++
$historical101 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical101.postSchemaVersion = '202610250101'
$historical101.migrations = @($historical101.migrations | Where-Object version -cle '202610250101')
Assert-ProductionDatabaseManifest -Manifest $historical101 -Registry $registry
$historical101.expectedSchemaVersion = '202610250100'
$historical101.expectedLedger = @($entry) + @($historical101.migrations | Where-Object version -cle '202610250100' | ForEach-Object {
    [pscustomobject]@{version=$_.version;name=$_.name;statementCount=1;statementsDigest=$_.sha256}
})
$ledgerText = @($historical101.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$historical101.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText))).ToLowerInvariant()
$historical101.migrations = @($historical101.migrations | Where-Object version -cgt '202610250100')
if (@($historical101.migrations).Count -ne 1 -or $historical101.migrations[0].version -cne '202610250101' -or
    $historical101.migrations[0].predecessorCheckpoint -cne 'AUTOMATIC_RESEARCH_PREPARATION' -or
    $historical101.expectedLedger[-1].version -cne '202610250100') { throw 'GUARD_101_ONLY_SUFFIX_FIXTURE_INVALID' }
Assert-ProductionDatabaseManifest -Manifest $historical101 -Registry $registry
$checks++
$historical102 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical102.postSchemaVersion = '202610260102'
$historical102.migrations = @($historical102.migrations | Where-Object version -cle '202610260102')
$historical102.expectedSchemaVersion = '202610250101'
$historical102.expectedLedger = @($entry) + @($historical102.migrations | Where-Object version -cle '202610250101' | ForEach-Object {
    [pscustomobject]@{version=$_.version;name=$_.name;statementCount=1;statementsDigest=$_.sha256}
})
$ledgerText = @($historical102.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$historical102.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText))).ToLowerInvariant()
$historical102.migrations = @($historical102.migrations | Where-Object version -cgt '202610250101')
if (@($historical102.migrations).Count -ne 1 -or $historical102.migrations[0].version -cne '202610260102' -or
    $historical102.migrations[0].predecessorCheckpoint -cne 'MATERIAL_CLARIFICATION_CONFIRMATION' -or
    $historical102.expectedLedger[-1].version -cne '202610250101') { throw 'GUARD_102_ONLY_SUFFIX_FIXTURE_INVALID' }
Assert-ProductionDatabaseManifest -Manifest $historical102 -Registry $registry
$checks++
$historical103 = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
$historical103.postSchemaVersion = '202610260103'
$historical103.migrations = @($historical103.migrations | Where-Object version -cle '202610260103')
$historical103.expectedSchemaVersion = '202610260102'
$historical103.expectedLedger = @($entry) + @($historical103.migrations | Where-Object version -cle '202610260102' | ForEach-Object {
    [pscustomobject]@{version=$_.version;name=$_.name;statementCount=1;statementsDigest=$_.sha256}
})
$ledgerText103 = @($historical103.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
$historical103.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ledgerText103))).ToLowerInvariant()
$historical103.migrations = @($historical103.migrations | Where-Object version -cgt '202610260102')
if (@($historical103.migrations).Count -ne 1 -or $historical103.migrations[0].version -cne '202610260103' -or
    $historical103.migrations[0].predecessorCheckpoint -cne 'SERVICE_REPAIR_CASE_STATE_CAS' -or
    $historical103.expectedLedger[-1].version -cne '202610260102') { throw 'GUARD_103_ONLY_SUFFIX_FIXTURE_INVALID' }
Assert-ProductionDatabaseManifest -Manifest $historical103 -Registry $registry
$checks++
foreach ($boundary in @('202610240087','202610250088','202610250089','202610250090','202610250091','202610250092','202610250093','202610250094','202610250095','202610250096','202610250097','202610250098','202610250099','202610250100','202610250101','202610260102','202610260103')) {
    $advance = $current | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    $advance.expectedSchemaVersion = $boundary
    $advance.expectedLedger = @($entry) + @($advance.migrations | Where-Object { $_.version -cle $boundary } | ForEach-Object {
        [pscustomobject]@{version=$_.version;name=$_.name;statementCount=1;statementsDigest=$_.sha256}
    })
    $text = @($advance.expectedLedger | ForEach-Object { "$($_.version):$($_.name):$($_.statementCount):$($_.statementsDigest)" }) -join "`n"
    $advance.expectedLedgerSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($text))).ToLowerInvariant()
    $advance.migrations = @($advance.migrations | Where-Object { $_.version -cgt $boundary })
    if ($boundary -ceq '202610260103' -and
        (@($advance.migrations).Count -ne 1 -or $advance.migrations[0].version -cne '202610270104' -or
         $advance.migrations[0].predecessorCheckpoint -cne 'MATERIAL_CLARIFICATION_RESUME' -or
         $advance.expectedLedger[-1].version -cne '202610260103')) { throw 'GUARD_104_ONLY_SUFFIX_FIXTURE_INVALID' }
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

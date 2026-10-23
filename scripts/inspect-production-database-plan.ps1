[CmdletBinding()]
param([Parameter(Mandatory)][string]$ManifestPath, [Parameter(Mandatory)][string]$ExpectedManifestSha256)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$apRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'lib/ProductionDatabaseGuard.ps1')
try {
    if ($ExpectedManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or
        (Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedManifestSha256) {
        throw 'PRODUCTION_MANIFEST_HASH_MISMATCH'
    }
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    $registry = Get-Content -LiteralPath (Join-Path $apRoot 'docs/launch/production-database-targets.json') -Raw | ConvertFrom-Json
    Assert-ProductionDatabaseManifest -Manifest $manifest -Registry $registry
    Assert-ProductionSourceHashes -Manifest $manifest -RepositoryRoot $apRoot
    [ordered]@{ status='LOCAL_PLAN_VALIDATED'; providerVerified=$false; providerCalls=0; mutationAuthorized=$false;
        manifestSha256=$ExpectedManifestSha256; releaseSha=$manifest.releaseSha; environment='production';
        projectRef=$manifest.projectRef; host=$manifest.host; caSha256=$manifest.caSha256;
        credentialTarget=$manifest.credentialTarget; fromSchema=$manifest.expectedSchemaVersion; toSchema=$manifest.postSchemaVersion;
        ledgerRows=@($manifest.expectedLedger).Count; ledgerSha256=$manifest.expectedLedgerSha256;
        migrations=@($manifest.migrations | ForEach-Object { [ordered]@{ version=$_.version; sha256=$_.sha256 } });
        recoveryStrategy=$manifest.recoveryStrategy } | ConvertTo-Json -Depth 5
} catch {
    $code = $_.Exception.Message
    if ($code -cnotmatch '^PRODUCTION_[A-Z_]+$') { $code='PRODUCTION_PLAN_INVALID' }
    [Console]::Error.WriteLine($code)
    exit 1
}

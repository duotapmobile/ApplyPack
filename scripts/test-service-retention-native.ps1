param([string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
$arguments = @{ FixtureNames = @('service-retention-cleanup.sql','service-retention-races.sql'); MaximumMigrationVersion = '202610250088' }
if ($EvidenceDirectory) { $arguments.EvidenceDirectory = $EvidenceDirectory }
& (Join-Path $PSScriptRoot 'test-database-native.ps1') @arguments

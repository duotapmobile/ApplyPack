param(
  [string]$PostgresBin = (Join-Path $env:USERPROFILE 'scoop\apps\postgresql\current\bin'),
  [string]$EvidenceDirectory = (Join-Path ([IO.Path]::GetTempPath()) ('applypack-native-db-' + [guid]::NewGuid().ToString('N'))),
  [switch]$LegacyBackfill,
  [switch]$CapacityPressure,
  [switch]$RetainClusterData
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$evidenceRoot = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $evidenceRoot) { throw 'Evidence directory must be new; existing clusters are never reused.' }
$null = New-Item -ItemType Directory -Path $evidenceRoot
$dataPath = Join-Path $evidenceRoot 'cluster'
$logPath = Join-Path $evidenceRoot 'validation.log'
$serverLog = Join-Path $evidenceRoot 'postgres.log'
$inputPath = Join-Path $evidenceRoot 'inputs'
$null = New-Item -ItemType Directory -Path $inputPath
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$bootstrap = @'
-- Minimal synthetic Supabase compatibility bootstrap; NOT hosted Supabase proof.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.users (
 id uuid primary key, instance_id uuid, aud text, role text, email text,
 encrypted_password text, email_confirmed_at timestamptz,
 raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz
);
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), auth.jwt()->>'sub')::uuid
$$;
create table storage.buckets (
 id text primary key, name text not null, public boolean not null default false,
 file_size_limit bigint, allowed_mime_types text[]
);
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
-- Model Supabase's permissive public-schema defaults so migrations must
-- explicitly revoke inherited table writes before granting narrower access.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
'@
$bootstrapPath = Join-Path $inputPath 'bootstrap.sql'
Set-Content -LiteralPath $bootstrapPath -Value $bootstrap -Encoding utf8
$migrationFiles = @(Get-ChildItem (Join-Path $repoRoot 'supabase/migrations') -Filter '*.sql' | Sort-Object Name)
$fixtures = @('chunk1-foundation.sql', 'chunk2-four-step.sql', 'chunk3-matching-engine.sql', 'chunk4-commerce-release.sql', 'chunk5-materials-delivery.sql', 'chunk6-final-integration.sql', 'employer-first-aggregation.sql', 'matching-fulfillment.sql', 'unpaid-source-retention.sql')
if ($LegacyBackfill) { $fixtures = @('chunk1-legacy-fixture.sql', 'chunk1-legacy-verify.sql') }
$inputs = @([pscustomobject]@{Kind='bootstrap'; Name='bootstrap.sql'; Path=$bootstrapPath})
foreach ($migration in $migrationFiles) {
  $copy = Join-Path $inputPath $migration.Name
  Copy-Item -LiteralPath $migration.FullName -Destination $copy
  $inputs += [pscustomobject]@{Kind='migration'; Name=$migration.Name; Path=$copy}
}
foreach ($fixture in $fixtures) {
  $copy = Join-Path $inputPath $fixture
  Copy-Item -LiteralPath (Join-Path $repoRoot "tests/integration/$fixture") -Destination $copy
  $inputs += [pscustomobject]@{Kind='fixture'; Name=$fixture; Path=$copy}
}
if ($LegacyBackfill) {
  $inputs = @($inputs | Where-Object Kind -eq 'bootstrap') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -le '202609030021' }) +
    @($inputs | Where-Object Name -eq 'chunk1-legacy-fixture.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -gt '202609030021' }) +
    @($inputs | Where-Object Name -eq 'chunk1-legacy-verify.sql')
}
$sharedFixture = 'reviewed-source-fixture.sql'
$sharedFixtureCopy = Join-Path $inputPath $sharedFixture
Copy-Item -LiteralPath (Join-Path $repoRoot "tests/integration/$sharedFixture") -Destination $sharedFixtureCopy
$inputs += [pscustomobject]@{Kind='helper'; Name=$sharedFixture; Path=$sharedFixtureCopy}
$inputs | ForEach-Object { [pscustomobject]@{Kind=$_.Kind;Name=$_.Name;Sha256=(Get-FileHash -LiteralPath $_.Path -Algorithm SHA256).Hash} } | ConvertTo-Json | Set-Content (Join-Path $evidenceRoot 'input-hashes.json')
@"
Native PostgreSQL engine validation only. Synthetic auth.users/auth.uid/auth.jwt,
storage.buckets and API roles substitute minimal schema dependencies. This does
not verify Supabase Auth, Storage API/object access, PostgREST, hosted settings,
provider credentials, production migrations, backup recovery or deployment.
Isolated cluster: $dataPath
Listen address: 127.0.0.1:$port
Inputs copied and hashed before execution. No existing database is accessed.
Legacy backfill mode: $LegacyBackfill. When true, synthetic paid legacy records
are inserted after version 202609030021, before all remaining migrations and
the existing legacy verification fixture. This is not a provider migration
ledger/idempotency or production backup restoration test.
"@ | Set-Content (Join-Path $evidenceRoot 'SCOPE.txt')
function Invoke-Native([string]$Executable, [string[]]$Arguments, [int]$TimeoutSeconds = 60) {
  # Capturing pg_ctl through a PowerShell pipeline can inherit pipe handles in
  # the server and block until shutdown. Use files and wait on only this PID.
  $commandId = [guid]::NewGuid().ToString('N')
  $stdout = Join-Path $evidenceRoot "$commandId.stdout"
  $stderr = Join-Path $evidenceRoot "$commandId.stderr"
  $quoted = $Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
  $process = Start-Process -FilePath (Join-Path $PostgresBin $Executable) -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  # Windows PowerShell 5.1 can otherwise release the process handle before
  # ExitCode is read, returning null even after a successful WaitForExit.
  $null = $process.Handle
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while (!$process.WaitForExit(1000)) {
    if ([DateTime]::UtcNow -ge $deadline) { $process.Kill(); throw "$Executable exceeded $TimeoutSeconds seconds" }
  }
  $process.Refresh()
  $code = $process.ExitCode
  $output = @(Get-Content -LiteralPath $stdout; Get-Content -LiteralPath $stderr)
  $output | Out-File -LiteralPath $logPath -Append -Encoding utf8
  if ($null -eq $code) { throw "$Executable exited without a readable exit code; refusing to infer success" }
  if ($code -ne 0) { $output | Select-Object -Last 18 | Write-Host; throw "$Executable failed with exit $code" }
}
if ($CapacityPressure) {
  $pressureScript = Join-Path $inputPath 'test-capacity-pressure.py'
  Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts/test-capacity-pressure.py') -Destination $pressureScript
  [pscustomobject]@{Name='test-capacity-pressure.py';Sha256=(Get-FileHash -LiteralPath $pressureScript -Algorithm SHA256).Hash} |
    ConvertTo-Json | Set-Content (Join-Path $evidenceRoot 'capacity-script-hash.json')
}
$previousOptions = $env:PGOPTIONS
try {
  Invoke-Native 'psql.exe' @('--version')
  Invoke-Native 'initdb.exe' @('-D', $dataPath, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C') 180
  Invoke-Native 'pg_ctl.exe' @('-D', $dataPath, '-l', $serverLog, '-o', "-h 127.0.0.1 -p $port", '-w', '-t', '30', 'start')
  $env:PGOPTIONS = '-c statement_timeout=60000 -c lock_timeout=10000'
  $batchPath = Join-Path $inputPath 'run-all.sql'
  $batch = foreach ($input in ($inputs | Where-Object Kind -ne 'helper')) {
    "\echo $($input.Kind): $($input.Name)"
    "\ir '" + $input.Path.Replace('\', '/').Replace("'", "\'") + "'"
  }
  Set-Content -LiteralPath $batchPath -Value $batch -Encoding utf8
  $step = 'batched migrations and fixtures; see validation.log for exact file'
  Write-Host "Running $($migrationFiles.Count) migrations and $($fixtures.Count) fixtures in one psql session."
  Invoke-Native 'psql.exe' @('-X', '-h', '127.0.0.1', '-p', "$port", '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', $batchPath) 600
  if ($CapacityPressure) {
    if ($LegacyBackfill) { throw 'Capacity pressure requires the fresh synthetic fixture mode.' }
    $step = 'independent-connection synthetic capacity pressure'
    & python $pressureScript --postgres-bin $PostgresBin --evidence-directory $evidenceRoot --port $port
    if ($LASTEXITCODE -ne 0) { throw 'Capacity pressure failed; see process output.' }
  }
  "PASS: $($migrationFiles.Count) migrations and $($fixtures.Count) fixtures; native PostgreSQL engine only." | Set-Content (Join-Path $evidenceRoot 'RESULT.txt')
} catch {
  "FAIL: $step`n$($_.Exception.Message)" | Set-Content (Join-Path $evidenceRoot 'RESULT.txt')
  throw
} finally {
  $env:PGOPTIONS = $previousOptions
  if (Test-Path -LiteralPath (Join-Path $dataPath 'postmaster.pid')) {
    Invoke-Native 'pg_ctl.exe' @('-D', $dataPath, '-w', '-t', '30', '-m', 'fast', 'stop')
  }
  if (Test-Path -LiteralPath (Join-Path $dataPath 'postmaster.pid')) { throw 'Cluster shutdown not confirmed; retaining data.' }
  if (!$RetainClusterData -and (Test-Path -LiteralPath $dataPath)) {
    $resolvedData = (Resolve-Path -LiteralPath $dataPath).Path
    $resolvedEvidence = (Resolve-Path -LiteralPath $evidenceRoot).Path
    $expectedData = [IO.Path]::GetFullPath((Join-Path $resolvedEvidence 'cluster'))
    if ($resolvedData -ne $expectedData -or !$resolvedData.StartsWith($resolvedEvidence.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Cluster cleanup boundary mismatch; retaining data.'
    }
    Remove-Item -LiteralPath $resolvedData -Recurse -Force
    Add-Content -LiteralPath $logPath -Value 'Own isolated cluster stopped and data directory removed; evidence retained.'
  }
  if ($RetainClusterData) { Add-Content -LiteralPath $logPath -Value 'Own isolated cluster stopped; data retained by explicit option.' }
  Write-Host "Evidence: $evidenceRoot"
}

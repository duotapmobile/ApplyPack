param(
  [string]$PostgresBin = (Join-Path $env:USERPROFILE 'scoop\apps\postgresql\current\bin'),
  [string]$EvidenceDirectory = (Join-Path ([IO.Path]::GetTempPath()) ('applypack-native-db-' + [guid]::NewGuid().ToString('N'))),
  [switch]$LegacyBackfill,
  [switch]$CapacityPressure,
  [switch]$RetainClusterData,
  [switch]$RuleRevalidationUpgrade,
  [switch]$SourceAwareDocumentUpgrade,
  [switch]$DraftStageUpgrade,
  [switch]$ReferenceDraftUpgrade,
  [switch]$ServiceErrorUpgrade,
  [switch]$DraftChangeUpgrade,
  [switch]$ArchiveLifecycleUpgrade,
  [switch]$LegalReceiptUpgrade,
  [string[]]$FixtureNames,
  [string]$MaximumMigrationVersion
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
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key,name text not null,statements text[] not null);
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
create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt()->>'role',current_user::text)
$$;
create table storage.buckets (
 id text primary key, name text not null, public boolean not null default false,
 file_size_limit bigint, allowed_mime_types text[]
);
-- Storage catalog only: actual object bytes and hosted authorization are not emulated.
create table storage.objects (
 id uuid primary key default extensions.gen_random_uuid(), bucket_id text not null references storage.buckets(id),
 name text not null, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
 metadata jsonb, unique(bucket_id,name)
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
if ($MaximumMigrationVersion) {
  if ($MaximumMigrationVersion -notmatch '^\d{12}$') { throw 'MaximumMigrationVersion must be an exact numeric migration identifier.' }
  $migrationFiles = @($migrationFiles | Where-Object { $_.Name.Split('_')[0] -le $MaximumMigrationVersion })
}
$fixtures = @('unpaid-source-retention.sql', 'chunk1-foundation.sql', 'chunk2-four-step.sql', 'chunk3-matching-engine.sql', 'chunk4-commerce-release.sql', 'chunk5-materials-delivery.sql', 'chunk6-final-integration.sql', 'employer-first-aggregation.sql', 'matching-fulfillment.sql', 'manual-launch-hardening.sql', 'sandbox-validation-launch-activation.sql', 'atomic-intake-legal-acceptance.sql', 'document-standard-compatibility.sql', 'source-upload-cleanup.sql', 'material-filename-cleanup-compatibility.sql', 'aws-temporary-cleanup.sql', 'open-font-document-contract.sql', 'legacy-board-read-only-archive.sql', 'legacy-board-terminal-event-ordering.sql')
if ($LegacyBackfill) { $fixtures = @('chunk1-legacy-fixture.sql', 'chunk1-legacy-verify.sql') }
if ($FixtureNames) {
  if ($LegacyBackfill) { throw 'Explicit fixtures cannot replace the legacy backfill sequence.' }
  foreach ($fixtureName in $FixtureNames) {
    if ($fixtureName -notmatch '^[a-z0-9][a-z0-9-]*\.sql$') { throw 'Fixture name must be a repository integration SQL filename.' }
  }
  $fixtures = $FixtureNames
}
if ($RuleRevalidationUpgrade) {
  if ($LegacyBackfill -or $CapacityPressure -or $MaximumMigrationVersion -cne '202610250092' -or
      $migrationFiles[-1].Name -cne '202610250092_material_rule_revalidation.sql') {
    throw 'Rule revalidation upgrade requires the exact isolated 091-to-092 sequence.'
  }
  $fixtures += @('material-rule-revalidation-upgrade-seed.sql','material-rule-revalidation-upgrade-verify.sql')
}
if ($LegalReceiptUpgrade) {
  if ($LegacyBackfill -or $CapacityPressure -or $MaximumMigrationVersion -cnotin @('202610250092','202610250093','202610250094','202610250095','202610250096','202610250097','202610250098') -or
      $migrationFiles[-1].Name.Split('_')[0] -cne $MaximumMigrationVersion) {
    throw 'Legal receipt upgrade requires an exact isolated historical-to-092,093,094,095,096,097 or098 sequence.'
  }
  $fixtures += @('legal-receipt-074-fixture.sql','legal-receipt-076-verify.sql','legal-receipt-086-verify.sql','legal-receipt-087-verify.sql')
}
if ($SourceAwareDocumentUpgrade) {
  if ($LegacyBackfill -or $CapacityPressure -or $RuleRevalidationUpgrade -or $MaximumMigrationVersion -cne '202610250093' -or
      $migrationFiles[-1].Name -cne '202610250093_source_aware_document_acceptance.sql') {
    throw 'Source-aware document upgrade requires the exact isolated092-to093 sequence.'
  }
  $fixtures += @('source-aware-document-upgrade-seed.sql','source-aware-document-upgrade-verify.sql')
  if ($LegalReceiptUpgrade) { $fixtures += @('material-rule-revalidation-upgrade-seed.sql','material-rule-revalidation-upgrade-verify.sql') }
}
if ($DraftStageUpgrade) {
  if ($LegacyBackfill -or $CapacityPressure -or $RuleRevalidationUpgrade -or $SourceAwareDocumentUpgrade -or
      $MaximumMigrationVersion -cne '202610250094' -or $migrationFiles[-1].Name -cne '202610250094_material_draft_stage_claiming.sql') {
    throw 'Draft stage upgrade requires the exact isolated093-to094 sequence.'
  }
  $fixtures += @('material-draft-stage-upgrade-seed.sql','material-draft-stage-upgrade-verify.sql')
  if ($LegalReceiptUpgrade) { $fixtures += @('material-rule-revalidation-upgrade-seed.sql','material-rule-revalidation-upgrade-verify.sql','source-aware-document-upgrade-seed.sql','source-aware-document-upgrade-verify.sql') }
}
if ($ReferenceDraftUpgrade) {
  if ($LegacyBackfill -or $CapacityPressure -or $RuleRevalidationUpgrade -or $SourceAwareDocumentUpgrade -or $DraftStageUpgrade -or
      $MaximumMigrationVersion -cne '202610250095' -or $migrationFiles[-1].Name -cne '202610250095_reference_aware_draft_delivery.sql') {
    throw 'Reference draft upgrade requires the exact isolated094-to095 sequence.'
  }
  $fixtures += @('reference-draft-upgrade-seed.sql','reference-draft-upgrade-verify.sql')
  if ($LegalReceiptUpgrade) { $fixtures += @('material-rule-revalidation-upgrade-seed.sql','material-rule-revalidation-upgrade-verify.sql','source-aware-document-upgrade-seed.sql','source-aware-document-upgrade-verify.sql','material-draft-stage-upgrade-seed.sql','material-draft-stage-upgrade-verify.sql') }
}
if ($ServiceErrorUpgrade) {
  if ($LegacyBackfill -or $CapacityPressure -or $RuleRevalidationUpgrade -or $SourceAwareDocumentUpgrade -or $DraftStageUpgrade -or $ReferenceDraftUpgrade -or
      $MaximumMigrationVersion -cne '202610250096' -or $migrationFiles[-1].Name -cne '202610250096_service_error_contract_and_triage.sql') {
    throw 'Service-error upgrade requires the exact isolated095-to096 sequence.'
  }
  $fixtures += @('service-error-upgrade-seed.sql','service-error-upgrade-verify.sql')
  if ($LegalReceiptUpgrade) { $fixtures += @('material-rule-revalidation-upgrade-seed.sql','material-rule-revalidation-upgrade-verify.sql','source-aware-document-upgrade-seed.sql','source-aware-document-upgrade-verify.sql','material-draft-stage-upgrade-seed.sql','material-draft-stage-upgrade-verify.sql','reference-draft-upgrade-seed.sql','reference-draft-upgrade-verify.sql') }
}
if ($DraftChangeUpgrade) {
  if ($LegacyBackfill -or $CapacityPressure -or $RuleRevalidationUpgrade -or $SourceAwareDocumentUpgrade -or $DraftStageUpgrade -or $ReferenceDraftUpgrade -or $ServiceErrorUpgrade -or $LegalReceiptUpgrade -or
      $MaximumMigrationVersion -cne '202610250097' -or $migrationFiles[-1].Name -cne '202610250097_material_draft_change_requests.sql') {
    throw 'Draft-change upgrade requires the exact isolated096-to097 preservation sequence.'
  }
  if (-not $FixtureNames) { $fixtures = @() }
  $fixtures += @('draft-change-upgrade-seed.sql','draft-change-upgrade-verify.sql')
}
if ($ArchiveLifecycleUpgrade) {
  if ($LegacyBackfill -or $CapacityPressure -or $RuleRevalidationUpgrade -or $SourceAwareDocumentUpgrade -or $DraftStageUpgrade -or $ReferenceDraftUpgrade -or $ServiceErrorUpgrade -or $DraftChangeUpgrade -or $LegalReceiptUpgrade -or
      $MaximumMigrationVersion -cne '202610250098' -or $migrationFiles[-1].Name -cne '202610250098_protected_archive_lifecycle.sql') {
    throw 'Archive lifecycle upgrade requires the exact isolated097-to098 preservation sequence.'
  }
  if (-not $FixtureNames) { $fixtures = @() }
  $fixtures += @('archive-lifecycle-upgrade-seed.sql','archive-lifecycle-upgrade-verify.sql')
}
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
if ($RuleRevalidationUpgrade) {
  $inputs = @($inputs | Where-Object Kind -eq 'bootstrap') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -le '202610250091' }) +
    @($inputs | Where-Object Name -eq 'material-rule-revalidation-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250092' }) +
    @($inputs | Where-Object Name -eq 'material-rule-revalidation-upgrade-verify.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'fixture' -and $_.Name -notin @('material-rule-revalidation-upgrade-seed.sql','material-rule-revalidation-upgrade-verify.sql') })
}
if ($SourceAwareDocumentUpgrade) {
  $inputs = @($inputs | Where-Object Kind -eq 'bootstrap') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -le '202610250092' }) +
    @($inputs | Where-Object Name -eq 'source-aware-document-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250093' }) +
    @($inputs | Where-Object Name -eq 'source-aware-document-upgrade-verify.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'fixture' -and $_.Name -notin @('source-aware-document-upgrade-seed.sql','source-aware-document-upgrade-verify.sql') })
}
if ($DraftStageUpgrade) {
  $inputs = @($inputs | Where-Object Kind -eq 'bootstrap') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -le '202610250093' }) +
    @($inputs | Where-Object Name -eq 'material-draft-stage-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250094' }) +
    @($inputs | Where-Object Name -eq 'material-draft-stage-upgrade-verify.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'fixture' -and $_.Name -notin @('material-draft-stage-upgrade-seed.sql','material-draft-stage-upgrade-verify.sql') })
}
if ($ReferenceDraftUpgrade) {
  $inputs = @($inputs | Where-Object Kind -eq 'bootstrap') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -le '202610250094' }) +
    @($inputs | Where-Object Name -eq 'reference-draft-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250095' }) +
    @($inputs | Where-Object Name -eq 'reference-draft-upgrade-verify.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'fixture' -and $_.Name -notin @('reference-draft-upgrade-seed.sql','reference-draft-upgrade-verify.sql') })
}
if ($ServiceErrorUpgrade) {
  $inputs = @($inputs | Where-Object Kind -eq 'bootstrap') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -le '202610250095' }) +
    @($inputs | Where-Object Name -eq 'service-error-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250096' }) +
    @($inputs | Where-Object Name -eq 'service-error-upgrade-verify.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'fixture' -and $_.Name -notin @('service-error-upgrade-seed.sql','service-error-upgrade-verify.sql') })
}
if ($DraftChangeUpgrade) {
  $inputs = @($inputs | Where-Object Kind -eq 'bootstrap') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -le '202610250096' }) +
    @($inputs | Where-Object Name -eq 'draft-change-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250097' }) +
    @($inputs | Where-Object Name -eq 'draft-change-upgrade-verify.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'fixture' -and $_.Name -notin @('draft-change-upgrade-seed.sql','draft-change-upgrade-verify.sql') })
}
if ($ArchiveLifecycleUpgrade) {
  $inputs = @($inputs | Where-Object Kind -eq 'bootstrap') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -le '202610250097' }) +
    @($inputs | Where-Object Name -eq 'archive-lifecycle-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250098' }) +
    @($inputs | Where-Object Name -eq 'archive-lifecycle-upgrade-verify.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'fixture' -and $_.Name -notin @('archive-lifecycle-upgrade-seed.sql','archive-lifecycle-upgrade-verify.sql') })
}
if ($LegalReceiptUpgrade) {
  $bindingPath = Join-Path $repoRoot 'scripts/launch-legal-contract.mjs'
  $bindingJson = & node --input-type=module -e 'import {pathToFileURL} from "node:url"; const m=await import(pathToFileURL(process.argv[1])); process.stdout.write(JSON.stringify([m.HISTORICAL_086_LEGAL_BINDING,m.LAUNCH_LEGAL_BINDING]));' $bindingPath
  if ($LASTEXITCODE -ne 0) { throw 'Public legal binding source could not be read.' }
  $bindings = $bindingJson | ConvertFrom-Json
  $generated = @{}
  for ($index=0; $index -lt 2; $index++) {
    $binding = $bindings[$index]
    $settings = foreach ($pair in @(@('privacy_version','privacyVersion'),@('privacy_sha256','privacyContentSha256'),@('terms_version','termsVersion'),@('terms_sha256','termsContentSha256'))) {
      $value = [string]$binding.($pair[1])
      if ($value -cnotmatch '^[a-z0-9-]{1,100}$') { throw 'Public legal binding source is invalid.' }
      "select set_config('applypack_test.$($pair[0])','$value',false);"
    }
    $name = if ($index -eq 0) { 'native-legal086-settings.sql' } else { 'native-legal-current-settings.sql' }
    $path = Join-Path $inputPath $name
    Set-Content -LiteralPath $path -Value $settings -Encoding utf8
    $generated[$name] = [pscustomobject]@{Kind='fixture';Name=$name;Path=$path}
  }
  $preservation = @{
    'native-legal076-preserve.sql' = @'
create table public.legal_upgrade_preservation_fixture as
 select 'acceptance'::text as kind,to_jsonb(row) as immutable_record from public.ap_snapshot_legal_acceptances row where snapshot_id='f5300000-0000-4000-8000-000000000001'
 union all select 'receipt',to_jsonb(row) from public.ap_snapshot_legal_content_receipts row where snapshot_id='f5300000-0000-4000-8000-000000000001'
 union all select 'reconciliation',to_jsonb(row) from public.ap_legal_receipt_acceptance_reconciliations row
 where receipt_id in(select id from public.ap_snapshot_legal_content_receipts where snapshot_id='f5300000-0000-4000-8000-000000000001');
'@
    'native-legal086-preserve.sql' = @'
create table public.retention_legal_upgrade_preservation_fixture as
 select 'acceptance'::text as kind,to_jsonb(row) as immutable_record from public.ap_snapshot_legal_acceptances row
 union all select 'receipt',to_jsonb(row) from public.ap_snapshot_legal_content_receipts row
 union all select 'reconciliation',to_jsonb(row) from public.ap_legal_receipt_acceptance_reconciliations row;
'@
  }
  foreach ($name in $preservation.Keys) {
    $path = Join-Path $inputPath $name
    Set-Content -LiteralPath $path -Value $preservation[$name] -Encoding utf8
    $generated[$name] = [pscustomobject]@{Kind='fixture';Name=$name;Path=$path}
  }
  $historicalNames = @('legal-receipt-074-fixture.sql','legal-receipt-076-verify.sql','legal-receipt-086-verify.sql','legal-receipt-087-verify.sql',
    'material-rule-revalidation-upgrade-seed.sql','material-rule-revalidation-upgrade-verify.sql','source-aware-document-upgrade-seed.sql','source-aware-document-upgrade-verify.sql','material-draft-stage-upgrade-seed.sql','material-draft-stage-upgrade-verify.sql','reference-draft-upgrade-seed.sql','reference-draft-upgrade-verify.sql','service-error-upgrade-seed.sql','service-error-upgrade-verify.sql')
  $inputs = @($inputs | Where-Object Kind -eq 'bootstrap') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -le '202610040074' }) +
    @($inputs | Where-Object Name -eq 'legal-receipt-074-fixture.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -gt '202610040074' -and $_.Name.Split('_')[0] -le '202610040076' }) +
    @($inputs | Where-Object Name -eq 'legal-receipt-076-verify.sql') + @($inputs | Where-Object Name -eq 'legal-receipt-076-verify.sql') +
    @($generated['native-legal076-preserve.sql']) +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -gt '202610040076' -and $_.Name.Split('_')[0] -le '202610230086' }) +
    @($generated['native-legal086-settings.sql']) +
    @($inputs | Where-Object Name -eq 'legal-receipt-086-verify.sql') + @($inputs | Where-Object Name -eq 'legal-receipt-086-verify.sql') +
    @($generated['native-legal086-preserve.sql']) +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -gt '202610230086' -and $_.Name.Split('_')[0] -le '202610240087' }) +
    @($generated['native-legal-current-settings.sql']) +
    @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') + @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -gt '202610240087' -and $_.Name.Split('_')[0] -le '202610250091' }) +
    @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') +
    @($inputs | Where-Object Name -eq 'material-rule-revalidation-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250092' }) +
    @($inputs | Where-Object Name -eq 'material-rule-revalidation-upgrade-verify.sql') +
    @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') +
    @($inputs | Where-Object Name -eq 'source-aware-document-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250093' }) +
    @($inputs | Where-Object Name -eq 'source-aware-document-upgrade-verify.sql') +
    $(if ($MaximumMigrationVersion -cge '202610250093') { @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') } else { @() }) +
    @($inputs | Where-Object Name -eq 'material-draft-stage-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250094' }) +
    @($inputs | Where-Object Name -eq 'material-draft-stage-upgrade-verify.sql') +
    $(if ($MaximumMigrationVersion -cge '202610250094') { @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') } else { @() }) +
    @($inputs | Where-Object Name -eq 'reference-draft-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250095' }) +
    @($inputs | Where-Object Name -eq 'reference-draft-upgrade-verify.sql') +
    $(if ($MaximumMigrationVersion -cge '202610250095') { @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') } else { @() }) +
    @($inputs | Where-Object Name -eq 'service-error-upgrade-seed.sql') +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250096' }) +
    @($inputs | Where-Object Name -eq 'service-error-upgrade-verify.sql') +
    $(if ($MaximumMigrationVersion -cge '202610250096') { @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') } else { @() }) +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250097' }) +
    $(if ($MaximumMigrationVersion -cge '202610250097') { @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') } else { @() }) +
    @($inputs | Where-Object { $_.Kind -eq 'migration' -and $_.Name.Split('_')[0] -eq '202610250098' }) +
    $(if ($MaximumMigrationVersion -ceq '202610250098') { @($inputs | Where-Object Name -eq 'legal-receipt-087-verify.sql') } else { @() }) +
    @($inputs | Where-Object { $_.Kind -eq 'fixture' -and $_.Name -notin $historicalNames })
}
$sharedFixture = 'reviewed-source-fixture.sql'
$sharedFixtureCopy = Join-Path $inputPath $sharedFixture
Copy-Item -LiteralPath (Join-Path $repoRoot "tests/integration/$sharedFixture") -Destination $sharedFixtureCopy
$inputs += [pscustomobject]@{Kind='helper'; Name=$sharedFixture; Path=$sharedFixtureCopy}
$rehearsalFixture = 'rehearsal-checkout-attempts.sql'
$rehearsalFixtureCopy = Join-Path $inputPath $rehearsalFixture
Copy-Item -LiteralPath (Join-Path $repoRoot "tests/integration/$rehearsalFixture") -Destination $rehearsalFixtureCopy
$inputs += [pscustomobject]@{Kind='helper'; Name=$rehearsalFixture; Path=$rehearsalFixtureCopy}
$materialRehearsalFixture = 'rehearsal-material-checkout.sql'
$materialRehearsalFixtureCopy = Join-Path $inputPath $materialRehearsalFixture
Copy-Item -LiteralPath (Join-Path $repoRoot "tests/integration/$materialRehearsalFixture") -Destination $materialRehearsalFixtureCopy
$inputs += [pscustomobject]@{Kind='helper'; Name=$materialRehearsalFixture; Path=$materialRehearsalFixtureCopy}
if ($fixtures -contains 'protected-archive-limited-role.sql' -and $fixtures -notcontains 'protected-archive-lifecycle.sql') {
  $archiveFixture = 'protected-archive-lifecycle.sql'
  $archiveFixtureCopy = Join-Path $inputPath $archiveFixture
  Copy-Item -LiteralPath (Join-Path $repoRoot "tests/integration/$archiveFixture") -Destination $archiveFixtureCopy
  $inputs += [pscustomobject]@{Kind='helper'; Name=$archiveFixture; Path=$archiveFixtureCopy}
}
$inputs | ForEach-Object { [pscustomobject]@{Kind=$_.Kind;Name=$_.Name;Sha256=(Get-FileHash -LiteralPath $_.Path -Algorithm SHA256).Hash} } | ConvertTo-Json | Set-Content (Join-Path $evidenceRoot 'input-hashes.json')
@"
Native PostgreSQL engine validation only. Synthetic auth.users/auth.uid/auth.jwt,
storage.buckets and API roles substitute minimal schema dependencies. This does
not verify Supabase Auth, Storage API/object access, PostgREST, hosted settings,
provider credentials, production migrations, backup recovery or deployment.
Isolated cluster: $dataPath
Listen address: 127.0.0.1:$port
Inputs copied and hashed before execution. No existing database is accessed.
Rule revalidation upgrade mode: $RuleRevalidationUpgrade. When true, exact091
public records and document guard definitions are captured before092 and
compared afterward; the new provider runtime remains disabled.
Source-aware document upgrade mode: $SourceAwareDocumentUpgrade. When true,
all existing public records are compared across exact092-to093; drafting stays disabled.
Draft stage upgrade mode: $DraftStageUpgrade. When true, all existing public
records and five unchanged core function definitions are compared across exact093-to094.
Reference draft upgrade mode: $ReferenceDraftUpgrade. When true, all existing
public records and five unchanged financial/refresh/release routines are compared across exact094-to095.
Legal receipt upgrade mode: $LegalReceiptUpgrade. When true, original074 facts
pass076/086/087 verification and the exact087 verifier is rerun at091,092 and each selected093/094/095 endpoint.
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
$startAttempted = $false
$startConfirmed = $false
$ownedPostmasterId = $null
$step = 'isolated cluster initialization'
try {
  Invoke-Native 'psql.exe' @('--version')
  Invoke-Native 'initdb.exe' @('-D', $dataPath, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C') 180
  $startAttempted = $true
  Invoke-Native 'pg_ctl.exe' @('-D', $dataPath, '-l', $serverLog, '-o', "-h 127.0.0.1 -p $port", '-w', '-t', '45', 'start') 60
  $startConfirmed = $true
  $ownedPostmasterId = [int](Get-Content -LiteralPath (Join-Path $dataPath 'postmaster.pid') -TotalCount 1)
  $env:PGOPTIONS = '-c statement_timeout=60000 -c lock_timeout=10000'
  $batchPath = Join-Path $inputPath 'run-all.sql'
  $batch = foreach ($input in ($inputs | Where-Object Kind -ne 'helper')) {
    "\echo $($input.Kind): $($input.Name)"
    "\ir '" + $input.Path.Replace('\', '/').Replace("'", "\'") + "'"
    if ($input.Kind -eq 'migration') {
      $version, $name = $input.Name.Substring(0,$input.Name.Length-4).Split('_',2)
      $source = [IO.File]::ReadAllText($input.Path)
      $tag = '$native_source_' + $version + '$'
      if ($version -notmatch '^\d{12}$' -or $name -notmatch '^[a-z0-9_]+$' -or $source.Contains($tag)) { throw 'Native migration ledger input invalid.' }
      "insert into supabase_migrations.schema_migrations(version,name,statements) values('$version','$name',array[$tag$source$tag]);"
    }
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
  $pidPath = Join-Path $dataPath 'postmaster.pid'
  # pg_ctl can time out before its spawned server creates postmaster.pid. A
  # missing PID file alone is never evidence that initialization is quiescent.
  # Retain every unsuccessful startup, including an initdb timeout, and wait a
  # bounded interval to stop a late-starting server using this exact data path.
  if ($startAttempted -and !$startConfirmed -and !(Test-Path -LiteralPath $pidPath)) {
    $lateStartDeadline = [DateTime]::UtcNow.AddSeconds(20)
    while (!(Test-Path -LiteralPath $pidPath) -and [DateTime]::UtcNow -lt $lateStartDeadline) { Start-Sleep -Milliseconds 250 }
  }
  try {
    if (Test-Path -LiteralPath $pidPath) {
      $pidLines = @(Get-Content -LiteralPath $pidPath -TotalCount 2)
      if ($pidLines.Count -ne 2 -or $pidLines[0] -notmatch '^[1-9][0-9]*$' -or
        [IO.Path]::GetFullPath($pidLines[1]) -ne [IO.Path]::GetFullPath($dataPath)) { throw 'Owned cluster PID identity is unverified; retaining data.' }
      if ($null -ne $ownedPostmasterId -and $ownedPostmasterId -ne [int]$pidLines[0]) { throw 'Owned cluster PID changed; retaining data.' }
      $ownedPostmasterId = [int]$pidLines[0]
      Invoke-Native 'pg_ctl.exe' @('-D', $dataPath, '-w', '-t', '30', '-m', 'fast', 'stop') 45
    }
    if ((Test-Path -LiteralPath $pidPath) -or ($null -ne $ownedPostmasterId -and (Get-Process -Id $ownedPostmasterId -ErrorAction SilentlyContinue))) {
      throw 'Owned cluster process shutdown not confirmed; retaining data.'
    }
  } catch {
    "FAIL: owned cluster cleanup could not confirm shutdown; data retained.`n$($_.Exception.Message)" | Set-Content (Join-Path $evidenceRoot 'RESULT.txt')
    throw
  }
  $cleanupConfirmed = $startConfirmed -and $null -ne $ownedPostmasterId
  if (!$RetainClusterData -and $cleanupConfirmed -and (Test-Path -LiteralPath $dataPath)) {
    $resolvedData = (Resolve-Path -LiteralPath $dataPath).Path
    $resolvedEvidence = (Resolve-Path -LiteralPath $evidenceRoot).Path
    $expectedData = [IO.Path]::GetFullPath((Join-Path $resolvedEvidence 'cluster'))
    if ($resolvedData -ne $expectedData -or !$resolvedData.StartsWith($resolvedEvidence.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Cluster cleanup boundary mismatch; retaining data.'
    }
    Remove-Item -LiteralPath $resolvedData -Recurse -Force
    Add-Content -LiteralPath $logPath -Value 'Own isolated cluster stopped and data directory removed; evidence retained.'
  }
  if (!$cleanupConfirmed) { Add-Content -LiteralPath $logPath -Value 'Unconfirmed startup: owned data retained. No deletion inferred from an absent PID file.' }
  if ($RetainClusterData) { Add-Content -LiteralPath $logPath -Value 'Own isolated cluster stopped; data retained by explicit option.' }
  Write-Host "Evidence: $evidenceRoot"
}

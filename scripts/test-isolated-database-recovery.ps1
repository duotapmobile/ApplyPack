[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# SelfTest loads the actual streaming adapter and uses synthetic credential
# material only. It never enters the production target/credential entrypoint.
. (Join-Path $PSScriptRoot 'production-database-safeguard.ps1') -Mode SelfTest
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "applypack-isolated-recovery-$([Guid]::NewGuid().ToString('N'))"
$container = "applypack-recovery-fixture-$([Guid]::NewGuid().ToString('N'))"
$credential = $null
$envelopeStream = $null
$created = $false
$primaryFailure = $null
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
try {
    [void](Assert-PinnedImage)
    $created = $true
    [void](Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @(
        'run','--detach','--rm','--name',$container,'--network','none','--pull','never',
        '--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=512m',
        '--env','POSTGRES_HOST_AUTH_METHOD=trust','--entrypoint','docker-entrypoint.sh',
        $script:PostgresImageDigest,'postgres','-D','/var/lib/postgresql/data'
    ))
    $ready = $false
    for ($attempt=0; $attempt -lt 45; $attempt++) {
        try {
            [void](Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @('exec',$container,'pg_isready','-U','postgres'))
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 1000 }
    }
    if (!$ready) { throw 'ISOLATED_DATABASE_START_FAILED' }
    $isolation = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @('inspect','--format','{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}',$container)
    if ($isolation -cne 'none|{}') { throw 'ISOLATED_DATABASE_NETWORK_MISMATCH' }
    foreach ($name in @('applypack_engine_source','applypack_engine_restore')) {
        [void](Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @('exec',$container,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',"create database $name with template template0 owner supabase_admin"))
    }
    $fixture = @'
create table public.synthetic_orders(id integer primary key, owner_id integer not null, status text not null);
insert into public.synthetic_orders values(1,11,'PAID'),(2,22,'PENDING');
alter table public.synthetic_orders enable row level security;
create policy owner_policy on public.synthetic_orders using(owner_id=current_setting('fixture.owner')::integer);
create function public.fixture_trigger() returns trigger language plpgsql as $$begin return new; end$$;
create trigger fixture_audit before update on public.synthetic_orders for each row execute function public.fixture_trigger();
'@
    [void](Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @('exec',$container,'psql','-U','supabase_admin','-d','applypack_engine_source','-v','ON_ERROR_STOP=1','-c',$fixture))
    $envelope = Join-Path $testRoot 'synthetic.apdb'
    $target = Assert-SafeOutputPath -Path $envelope -ExpectedExtension '.apdb'
    $credential = [ApplyPack.ProductionSecurity.WindowsCredentialStore]::CreateSyntheticForSelfTest('SYNTHETIC_ONLY'.ToCharArray())
    $start = New-ProcessStartInfo -FileName $DockerExecutable -Arguments @('exec','-i',$container,'pg_dump','-U','supabase_admin','-d','applypack_engine_source','--format=custom') -RedirectInput $true -RedirectOutput $true
    Invoke-AtomicFile -Target $target -Writer {
        param($output)
        Invoke-EncryptedBackupProcess -StartInfo $start -Credential $credential -Destination $output -MetadataJson '{"fixture":true,"scope":"synthetic-isolated-engine"}' -ContainerName $container -ContainerCleanupOverride { param($ignored) }
    }
    $credential = $null
    $envelopeStream = [IO.FileStream]::new($envelope,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    $restore = New-ProcessStartInfo -FileName $DockerExecutable -Arguments @('exec','-i',$container,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','supabase_admin','-d','applypack_engine_restore') -RedirectInput $true -RedirectOutput $true
    Invoke-DecryptToProcess -EnvelopeStream $envelopeStream -StartInfo $restore -FailureCode 'PG_RESTORE_FAILED'
    $envelopeStream.Dispose()
    $envelopeStream = $null
    $query = "select (select string_agg(id||':'||owner_id||':'||status,',' order by id) from public.synthetic_orders)||'|'||(select relrowsecurity from pg_class where oid='public.synthetic_orders'::regclass)||'|'||(select count(*) from pg_policies where schemaname='public')||'|'||(select count(*) from pg_trigger where tgrelid='public.synthetic_orders'::regclass and not tgisinternal)||'|'||(select count(*) from pg_index where indrelid='public.synthetic_orders'::regclass and not indisvalid);"
    $before = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @('exec',$container,'psql','-U','supabase_admin','-d','applypack_engine_source','-At','-c',$query)
    $after = Invoke-SafeNativeText -FileName $DockerExecutable -Arguments @('exec',$container,'psql','-U','supabase_admin','-d','applypack_engine_restore','-At','-c',$query)
    if ($before -cne $after -or $after -cne '1:11:PAID,2:22:PENDING|true|1|1|0') { throw 'ISOLATED_RESTORE_CONTENT_MISMATCH' }
} catch { $primaryFailure = $_ }
finally {
    if ($null -ne $credential) { $credential.Dispose() }
    if ($null -ne $envelopeStream) { $envelopeStream.Dispose() }
    if ($created) {
        try { Ensure-ContainerAbsent -ContainerName $container -FailureCode 'RESTORE_CONTAINER_TEARDOWN_FAILED' }
        catch { $primaryFailure = $_ }
    }
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    $allowedRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (!$resolvedRoot.StartsWith($allowedRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'ISOLATED_TEST_CLEANUP_PATH_INVALID' }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
}
if ($null -ne $primaryFailure) { throw 'ISOLATED_DATABASE_RECOVERY_TEST_FAILED' }
[ordered]@{ status='PASS'; scope='synthetic-postgres-encrypted-streaming-engine'; providerCalls=0;
    productionCredentialsRead=$false; networkMode='none'; publishedPorts=0; sourceRows=2; restoredRows=2;
    rlsAndPolicyPreserved=$true; triggerPreserved=$true; invalidIndexes=0; teardownVerified=$true;
    customerAccessRecoveryProven=$false; offMachineRecoveryProven=$false } | ConvertTo-Json -Compress

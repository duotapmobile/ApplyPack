import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const expectedRoot = 'C:\\Users\\mskir\\Desktop\\Apply_Pack\\applypack-production-v2';
const expectedContainer = '75768f3bc66569e8628b54e7f692db04354e77b2fe1e7501789792a2328e390a';
const dockerHost = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const base = 'docs/evidence/launch-execution-2026-10-22/recovery-ci-continuation';
const prefix = `${base}/structural-20261023-attempt-01`;
const receiptPath = `${prefix}.json`;
const stdoutPath = `${prefix}.stdout.log`;
const stderrPath = `${prefix}.stderr.log`;
const freezePath = 'evidence/launch-recovery-ci/attempt-03/extraction-equivalence.json';
const requiredMigrations = ['202610040077','202610040078','202610040079','202610040080','202610190081','202610190082','202610190083','202610190084','202610220085'];
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
requireThat(path.resolve(process.cwd()).toLowerCase() === expectedRoot.toLowerCase(), 'canonical_root_mismatch');
requireThat(![receiptPath,stdoutPath,stderrPath].some(existsSync), 'fresh_evidence_paths_required');
const environment = { ...process.env, DOCKER_HOST: dockerHost };
for (const name of Object.keys(environment)) {
  if (name === 'DOCKER_CONTEXT' || name.startsWith('AWS_') || name.startsWith('SUPABASE_') || name.startsWith('RAILWAY_') || name === 'AP_ROLLBACK_TARGET_SHA') delete environment[name];
}
const run = (command, args, input) => spawnSync(command, args, { cwd: expectedRoot, env: environment, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const capture = (command, args, input) => {
  const result = run(command, args, input);
  requireThat(!result.error && result.status === 0, `read_only_command_failed:${command}:${result.error?.code || result.status}`);
  return result.stdout;
};
function target() {
  const raw = JSON.parse(capture('docker', ['--host',dockerHost,'inspect','supabase_db_applypack']))[0];
  const labels = raw.Config.Labels;
  requireThat(raw.Name === '/supabase_db_applypack' && raw.State.Running && raw.State.Health?.Status === 'healthy', 'local_container_not_healthy');
  requireThat(labels['com.supabase.cli.project'] === 'applypack' && labels['com.docker.compose.project'] === 'applypack', 'local_project_label_mismatch');
  requireThat(path.resolve(labels['com.supabase.cli.workdir']).toLowerCase() === expectedRoot.toLowerCase(), 'local_workdir_label_mismatch');
  requireThat(raw.Mounts.some(m => m.Type === 'volume' && m.Name === 'supabase_db_applypack' && m.Destination === '/var/lib/postgresql/data'), 'local_volume_mismatch');
  return { id: raw.Id, name: raw.Name, created: raw.Created, status: raw.State.Status, health: raw.State.Health.Status, labels, image: raw.Config.Image, imageManifestDigest: raw.ImageManifestDescriptor.digest, networks: Object.keys(raw.NetworkSettings.Networks), ports: raw.NetworkSettings.Ports, volume: 'supabase_db_applypack' };
}
const stateSql = `BEGIN TRANSACTION READ ONLY;
select jsonb_build_object('database',current_database(),'user',current_user,'serverVersion',current_setting('server_version'),'maxMigration',(select max(version) from supabase_migrations.schema_migrations),'migrationCount',(select count(*) from supabase_migrations.schema_migrations),'readiness',public.ap_manual_launch_schema_readiness(),'mode',(select mode from public.ap_checkout_mode_configuration where singleton),'invalidIndexes',(select count(*) from pg_index where not indisvalid),'activeOtherClientQueries',(select count(*) from pg_stat_activity where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid() and state<>'idle'),'data',jsonb_build_object('orders',(select count(*) from public.orders),'profiles',(select count(*) from public.profiles),'awsCleanupRows',(select count(*) from public.ap_aws_temporary_cleanup),'checkoutInitiationRows',(select count(*) from public.ap_checkout_initiations),'nonLegacySearchServices',(select count(*) from public.ap_search_services where not legacy_record),'anonymousDrafts',(select count(*) from public.ap_anonymous_drafts),'intakeSnapshots',(select count(*) from public.ap_intake_snapshots),'materialPurchases',(select count(*) from public.ap_material_purchases),'providerEvents',(select count(*) from public.ap_provider_events),'nonLegacyPayments',(select count(*) from public.ap_payment_attempts where legacy_payment_id is null),'capacityAllocations',(select count(*) from public.ap_capacity_allocations),'referenceRecords',(select count(*) from public.ap_reference_records),'generatedArtifacts',(select count(*) from public.ap_generated_artifacts),'outboxMessages',(select count(*) from public.ap_outbox_messages),'auditEvents',(select count(*) from public.ap_audit_events)));
COMMIT;`;
function state() {
  const output = capture('docker', ['--host',dockerHost,'exec','-i','supabase_db_applypack','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'], stateSql);
  const value = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')));
  requireThat(value.database === 'postgres' && value.migrationCount === 90 && value.maxMigration === '202610220085', 'database_ledger_mismatch');
  requireThat(value.readiness.ready === true && value.readiness.requiredSchemaVersion === '202610220085' && JSON.stringify(value.readiness.requiredMigrations) === JSON.stringify(requiredMigrations), 'exact_schema_readiness_mismatch');
  requireThat(value.mode === 'LOCKED' && value.invalidIndexes === 0 && value.activeOtherClientQueries === 0, 'database_not_idle_locked_valid');
  requireThat(Object.values(value.data).every(count => count === 0), 'database_operational_data_exists');
  return value;
}
const receipt = { status: 'IN_PROGRESS', startedAt: new Date().toISOString(), scope: 'Authorized structural SQL rollback/reset only against the empty disposable local applypack database; not application rollback or protected backup recovery.', hostedActions: 0, retryCount: 0, dockerHost, evidenceFreezePath: freezePath, environmentBoundary: 'Child-only local Docker host pinned; Docker context and AWS/Supabase/Railway variables removed. Parent process environment unchanged.' };
let child;
try {
  requireThat(capture('git',['rev-parse','--show-toplevel']).trim().replace(/\\/g,'/').toLowerCase() === expectedRoot.replace(/\\/g,'/').toLowerCase(), 'git_root_mismatch');
  requireThat(capture('git',['remote','get-url','origin']).trim() === 'https://github.com/duotapmobile/ApplyPack.git', 'git_origin_mismatch');
  receipt.head = capture('git',['rev-parse','HEAD']).trim();
  receipt.branch = capture('git',['branch','--show-current']).trim();
  const freeze = JSON.parse(readFileSync(freezePath,'utf8').replace(/^\uFEFF/,''));
  receipt.evidenceFreezeSha256 = sha(freezePath);
  for (const file of freeze.files) requireThat(sha(file.path) === file.sha256, `frozen_source_changed:${file.path}`);
  const paths = [...new Set([...freeze.files.map(file => file.path),'scripts/rollback-legal-contract.mjs','supabase/rollback/202609040022_corrected_chunk1_foundation.rollback.sql','supabase/config.toml',...readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).map(name => `supabase/migrations/${name}`)])].sort();
  receipt.sourceBefore = paths.map(file => ({ path: file, sha256: sha(file) }));
  requireThat(receipt.sourceBefore.find(file => file.path === 'supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql').sha256 === 'c99561da94f676f3d8f7fdc32d731fae54210f302d33bc5ea5811b58d7b5e935', 'migration_085_changed');
  requireThat(/^project_id = "applypack"$/m.test(readFileSync('supabase/config.toml','utf8')), 'supabase_project_configuration_mismatch');
  receipt.beforeTarget = target();
  requireThat(receipt.beforeTarget.id === expectedContainer, 'authorized_container_identity_changed');
  receipt.beforeDatabase = state();
  receipt.command = { executable: process.execPath, arguments: ['--input-type=module','-e','import { runStructuralDatabaseRecovery } from "./scripts/lib/supabase-structural-recovery.mjs"; process.exitCode = runStructuralDatabaseRecovery();'], workingDirectory: expectedRoot };
  writeFileSync(receiptPath, JSON.stringify(receipt,null,2)+'\n');
  console.log('STRUCTURAL_PREFLIGHT_OK: exact local target, 100 frozen/consumed source bindings, empty operational data, exclusive database state.');
  child = run(receipt.command.executable, receipt.command.arguments);
  writeFileSync(stdoutPath, child.stdout || '');
  writeFileSync(stderrPath, child.stderr || '');
  receipt.process = { pid: child.pid, exitCode: child.status, signal: child.signal, errorCode: child.error?.code || null, terminal: true };
  receipt.stdout = { path: stdoutPath, sha256: sha(stdoutPath), bytes: Buffer.byteLength(child.stdout || '') };
  receipt.stderr = { path: stderrPath, sha256: sha(stderrPath), bytes: Buffer.byteLength(child.stderr || '') };
  receipt.markers = { rollbackOk: /^\s*ROLLBACK_OK\s*$/m.test(child.stdout || ''), restoreOk: /^\s*RESTORE_OK\s*$/m.test(child.stdout || '') };
  receipt.afterTarget = target();
  receipt.afterDatabase = state();
  receipt.sourceAfter = paths.map(file => ({ path: file, sha256: sha(file) }));
  receipt.sourceUnchanged = JSON.stringify(receipt.sourceBefore) === JSON.stringify(receipt.sourceAfter);
  requireThat(!child.error && child.status === 0 && receipt.markers.rollbackOk && receipt.markers.restoreOk && receipt.sourceUnchanged, 'structural_execution_or_postcondition_failed');
  receipt.status = 'PASS_LOCAL_STRUCTURAL_SCHEMA_RECOVERY';
} catch (error) {
  receipt.status = 'FAIL_PRESERVED_NO_RETRY';
  receipt.failure = error.message;
  if (child && !receipt.process) receipt.process = { pid: child.pid, exitCode: child.status, signal: child.signal, errorCode: child.error?.code || null, terminal: true };
  process.exitCode = 1;
} finally {
  receipt.completedAt = new Date().toISOString();
  receipt.runner = { path: `${base}/structural-runner-20261023.mjs`, sha256: sha(`${base}/structural-runner-20261023.mjs`) };
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, receiptSha256: sha(receiptPath), process: receipt.process || null, markers: receipt.markers || null, sourceUnchanged: receipt.sourceUnchanged || false, failure: receipt.failure || null }));
}

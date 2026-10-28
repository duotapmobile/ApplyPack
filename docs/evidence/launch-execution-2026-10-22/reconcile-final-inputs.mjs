import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const bundle = 'docs/evidence/launch-execution-2026-10-22';
if (process.cwd().replaceAll('\\', '/') !== 'C:/Users/mskir/Desktop/Apply_Pack/applypack-production-v2') throw new Error('Wrong repository directory');
const read = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bind = file => ({ path: file, sha256: sha(readFileSync(file)) });
const finalFile = `${bundle}/local-source-final.json`;
const current = read(finalFile);
for (const entry of current.files) if (bind(entry.path).sha256 !== entry.sha256) throw new Error(`Current input drift: ${entry.path}`);
function compare(file) {
  const old = read(file);
  const oldMap = new Map(old.files.map(entry => [entry.path, entry.sha256]));
  const newMap = new Map(current.files.map(entry => [entry.path, entry.sha256]));
  const changes = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort().flatMap(path => oldMap.get(path) === newMap.get(path) ? [] : [{ path, before: oldMap.get(path) || null, after: newMap.get(path) || null }]);
  return { baseline: bind(file), previousInputs: old.files.length, currentInputs: current.files.length, changes };
}
const browserAfterFile = process.argv[2];
if (!browserAfterFile?.startsWith(`${bundle}/browser-attempt-04-`) || !browserAfterFile.endsWith('.json')) throw new Error('Expected final attempt04 source snapshot');
const browser = compare(browserAfterFile);
if (browser.changes.length !== 1 || browser.changes[0].path !== 'AGENTS.md' || browser.changes[0].before !== '9aa0f74f46cda7a1a4a40f18e661a1bc8843173c6577375a64839e10a512dd83' || browser.changes[0].after !== '289bff516e5625fc5aa307470744761c34d732a0726a62bf9be7d0810d1418d4') throw new Error('Unexpected post-browser source delta');
const packaging = compare(`${bundle}/packaging-validation-inputs-after.json`);
if (packaging.changes.length !== 1 || packaging.changes[0].path !== 'tests/e2e/manual-launch-hardening.spec.ts' || packaging.changes[0].after !== 'dbc20b2633c0c39f470a594bbbc126dc1330958100e4461e80cd6dbc192a9209') throw new Error('Unexpected post-packaging source delta');
const units = compare(`${bundle}/unit-current-serial-inputs-after.json`);
const packagingDelta = read(`${bundle}/operations/image-remediation-source-delta.json`);
const allowedUnitChanges = new Map(packagingDelta.changes.map(entry => [entry.path, entry.sha256]));
allowedUnitChanges.set('tests/e2e/manual-launch-hardening.spec.ts', 'dbc20b2633c0c39f470a594bbbc126dc1330958100e4461e80cd6dbc192a9209');
if (units.changes.some(entry => allowedUnitChanges.get(entry.path) !== entry.after)) throw new Error('Unit-baseline delta lacks an existing affected-proof classification');
const protectedInventory = read(`${bundle}/preexisting-work.json`);
const protectedFiles = protectedInventory.files.map(entry => ({ ...entry, actualSha256: bind(entry.path).sha256 }));
if (protectedFiles.length !== 22 || protectedFiles.some(entry => entry.sha256 !== entry.actualSha256)) throw new Error('Protected user file drift');
const observedAt = new Date().toISOString();
const writeOnce = (name, value) => writeFileSync(`${bundle}/${name}`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
writeOnce('preexisting-work-final-verification.json', { observedAt, collector: 'Codex root', status: 'PASS_ALL_22_BYTE_IDENTICAL', inventory: bind(`${bundle}/preexisting-work.json`), files: protectedFiles });
writeOnce('source-validation-final-reconciliation.json', {
  observedAt, collector: 'Codex root', status: 'PASS_SOURCE_DELTA_AND_PROTECTED_FILE_CHECK', finalInventory: bind(finalFile),
  proofAcceptanceScope: 'This collector verifies input identity and classified deltas only. Test execution and teardown acceptance require their separate actual receipts; the provisional manifest must bind them.',
  browser, packaging, units, packagingDelta: bind(`${bundle}/operations/image-remediation-source-delta.json`),
  classifications: [
    'Post-browser delta is solely the restoration of the Next-generated AGENTS heading to its exact original bytes. No application/test/configuration inputs changed. The restoration requires separate prior server-teardown verification.',
    'Post-packaging delta is solely the independently reviewed denial-case decomposition. Separate fresh lint/typecheck, frozen-image route-probe and complete browser receipts are required for acceptance; application/image/SQL/render source inputs are unchanged.',
    'Post-unit changes match the previously inventoried image security/helper/documentation/browser-output deltas plus denial-case decomposition. Scoped reuse additionally requires the43 affected packaging regressions, fresh image build/smoke/scan, independent reviews and full browser proof. This source check does not claim the801-test run used the final byte inventory.',
  ],
  limitations: ['Local snapshots and agent review only; no committed candidate, clean CI, hosted readiness, human approval or recovery acceptance.'],
});
process.stdout.write(JSON.stringify({ sourceCount: current.files.length, protectedCount: protectedFiles.length, browserDelta: browser.changes.length, packagingDelta: packaging.changes.length, unitDelta: units.changes.length }) + '\n');

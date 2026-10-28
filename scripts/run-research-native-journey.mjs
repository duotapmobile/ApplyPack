import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { researchFixtureIdentity } from './lib/research-fixture-identity.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export function runResearchNativeJourney(args = [], { environment = process.env, platform = process.platform, spawn = spawnSync,
  log = console.log, write = value => process.stdout.write(value), writeError = value => process.stderr.write(value) } = {}) {
const scenario = args[0] ?? 'LIMITED';
if (args.length > 1 || !['LIMITED', 'QUALIFIED', 'PAID_SEARCH', 'EMPLOYER_RULE', 'PACK_PACKET', 'PACK_SOURCE', 'PACK_LOCAL_DOC'].includes(scenario)) throw new Error('Fixed research journey scenario required.');
const identity = researchFixtureIdentity(environment, platform);
if (scenario === 'PACK_LOCAL_DOC' && identity.mode !== 'NATIVE_WINDOWS') throw new Error('Local document journey requires the explicit native renderer.');
const config = identity.mode === 'CONTAINER_PG17'
  ? ['--config', 'vitest.research-container.config.mjs', '--configLoader', 'native']
  : ['--config', 'vitest.research-native.config.mts'];
// Research assertions inspect their entire disposable fixture. Run clarification
// afterward so its separate immutable source records cannot affect those counts.
const stages = scenario === 'PACK_LOCAL_DOC' ? ['PACK_LOCAL_DOC'] : scenario === 'PACK_SOURCE' ? ['PACK_SOURCE'] : scenario === 'PACK_PACKET' ? ['PACK_PACKET'] : scenario === 'EMPLOYER_RULE' ? ['EMPLOYER_RULE'] : scenario === 'PAID_SEARCH' ? ['PAID_SEARCH']
  : scenario === 'LIMITED' ? ['RESEARCH', 'CLARIFICATION', 'NOTIFICATION'] : ['RESEARCH'];
for (const stage of stages) {
  const employer = stage === 'EMPLOYER_RULE', packPacket = stage === 'PACK_PACKET', packSource = stage === 'PACK_SOURCE', localDoc = stage === 'PACK_LOCAL_DOC', captured = employer || packPacket || packSource || localDoc;
  const result = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...config],
    { cwd: root, env: { ...environment, AP_RESEARCH_TEST_CASE: scenario, AP_RESEARCH_JOURNEY_STAGE: stage },
      stdio: captured ? ['ignore', 'pipe', 'pipe'] : 'inherit', ...(captured ? { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 } : {}), timeout: localDoc ? 660_000 : packSource ? 480_000 : 300_000, windowsHide: true });
  if (captured) { if (result.stdout) write(result.stdout); if (result.stderr) writeError(result.stderr); }
  if (result.error || result.status !== 0) return 1;
  if (employer && !stripVTControlCharacters(result.stdout ?? '').split(/\r?\n/u).some(line => /^EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK(?: |$)/u.test(line.trim()))) {
    writeError('Employer-rule owner assertions did not report completion.\n'); return 1;
  }
  if (packPacket) {
    const lines = stripVTControlCharacters(result.stdout ?? '').split(/\r?\n/u).map(line => line.trim());
    for (const marker of ['EMPLOYER_QUESTION_PACK_NATIVE_JOURNEY_OK', 'PAID_PACK_ROUTE_DELIVERY_OBLIGATION_RECEIPT', 'PAID_PACK_PREPARE_PACKET_RECEIPT']) {
      if (lines.filter(line => line === marker || line.startsWith(`${marker} `)).length !== 1) {
        writeError(`Paid-pack stage completion missing or ambiguous: ${marker}.\n`); return 1;
      }
    }
  }
  if (packSource) {
    const lines = stripVTControlCharacters(result.stdout ?? '').split(/\r?\n/u).map(line => line.trim());
    let priorIndex = -1;
    for (const marker of ['EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK','PAID_PACK_ROUTE_DELIVERY_OBLIGATION_RECEIPT','PAID_PACK_PREPARE_PACKET_RECEIPT','PAID_PACK_SOURCE_READY_PROPOSAL_RECEIPT','EMPLOYER_QUESTION_SOURCE_NATIVE_JOURNEY_OK']) {
      const indices = lines.flatMap((line, index) => line === marker || line.startsWith(`${marker} `) ? [index] : []);
      if (indices.length !== 1 || indices[0] <= priorIndex) {
        writeError(`Source-generation stage completion missing, ambiguous or out of order: ${marker}.\n`); return 1;
      }
      priorIndex = indices[0];
    }
  }
  if (localDoc) {
    const lines = stripVTControlCharacters(result.stdout ?? '').split(/\r?\n/u).map(line => line.trim());
    let priorIndex = -1;
    for (const marker of ['EMPLOYER_RULE_OWNER_NATIVE_JOURNEY_OK','PAID_PACK_ROUTE_DELIVERY_OBLIGATION_RECEIPT','PAID_PACK_PREPARE_PACKET_RECEIPT','PAID_PACK_SOURCE_READY_PROPOSAL_RECEIPT','PAID_PACK_OWNER_LOCAL_DOCUMENTS_RECEIPT','EMPLOYER_QUESTION_LOCAL_DOC_NATIVE_JOURNEY_OK']) {
      const indices = lines.flatMap((line, index) => line === marker || line.startsWith(`${marker} `) ? [index] : []);
      if (indices.length !== 1 || indices[0] <= priorIndex) {
        writeError(`Local-document stage completion missing, ambiguous or out of order: ${marker}.\n`); return 1;
      }
      priorIndex = indices[0];
    }
  }
  log(`${stage}_ROUTE_DATABASE_JOURNEY_OK: fictional auth/source/KMS inputs; actual routes, SDK and PostgreSQL; no hosted proof.`);
}
if (scenario === 'LIMITED') log('RESEARCH_CLARIFICATION_NOTIFICATION_JOURNEYS_OK');
return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runResearchNativeJourney(process.argv.slice(2));

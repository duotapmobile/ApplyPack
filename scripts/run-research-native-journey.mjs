import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { researchFixtureIdentity } from './lib/research-fixture-identity.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const scenario = process.argv[2] ?? 'LIMITED';
if (process.argv.length > 3 || !['LIMITED', 'QUALIFIED'].includes(scenario)) throw new Error('Fixed research journey scenario required.');
const identity = researchFixtureIdentity(process.env, process.platform);
const config = identity.mode === 'CONTAINER_PG17'
  ? ['--config', 'vitest.research-container.config.mjs', '--configLoader', 'native']
  : ['--config', 'vitest.research-native.config.mts'];
// Research assertions inspect their entire disposable fixture. Run clarification
// afterward so its separate immutable source records cannot affect those counts.
const stages = scenario === 'LIMITED' ? ['RESEARCH', 'CLARIFICATION', 'NOTIFICATION'] : ['RESEARCH'];
for (const stage of stages) {
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...config],
    { cwd: root, env: { ...process.env, AP_RESEARCH_TEST_CASE: scenario, AP_RESEARCH_JOURNEY_STAGE: stage }, stdio: 'inherit', timeout: 300_000, windowsHide: true });
  if (result.error || result.status !== 0) { process.exitCode = 1; break; }
  console.log(`${stage}_ROUTE_DATABASE_JOURNEY_OK: fictional auth/source/KMS inputs; actual routes, SDK and PostgreSQL; no hosted proof.`);
}
if (!process.exitCode && scenario === 'LIMITED') console.log('RESEARCH_CLARIFICATION_NOTIFICATION_JOURNEYS_OK');

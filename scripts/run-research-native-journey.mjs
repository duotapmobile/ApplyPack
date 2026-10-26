import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const scenario = process.argv[2] ?? 'LIMITED';
if (process.argv.length > 3 || !['LIMITED', 'QUALIFIED'].includes(scenario)) throw new Error('Fixed research journey scenario required.');
if (!/^[1-9][0-9]{3,4}$/.test(process.env.AP_RESEARCH_TEST_PORT || '')
  || !/^[a-f0-9]{32}$/.test(process.env.AP_RESEARCH_TEST_MARKER || '')
  || !process.env.AP_RESEARCH_TEST_PSQL?.endsWith('psql.exe')) throw new Error('Owned native research database identity is required.');
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.research-native.config.mts'],
  { cwd: root, env: { ...process.env, AP_RESEARCH_TEST_CASE: scenario }, stdio: 'inherit', timeout: 300_000, windowsHide: true });
if (result.error || result.status !== 0) process.exitCode = 1;
else console.log('RESEARCH_ROUTE_DATABASE_JOURNEY_OK: fictional auth/source/KMS inputs; actual routes, SDK and PostgreSQL; no hosted proof.');

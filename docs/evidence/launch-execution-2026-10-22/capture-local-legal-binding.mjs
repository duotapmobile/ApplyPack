import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
if (process.cwd().replaceAll('\\', '/') !== 'C:/Users/mskir/Desktop/Apply_Pack/applypack-production-v2') throw new Error('Wrong repository directory');
const ts = require('typescript');
const paths = [
  'src/content/public-pages.ts',
  'src/lib/domain/foundation.ts',
  'src/lib/legal/presentation.ts',
  'src/lib/legal/content-hash.ts',
];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bind = file => { const bytes = readFileSync(file); return { path: file.replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes) }; };
const before = paths.map(bind);
const modules = new Map();
function load(file) {
  if (!paths.includes(file)) throw new Error(`Unexpected legal dependency: ${file}`);
  if (modules.has(file)) return modules.get(file).exports;
  const legalModule = { exports: {} };
  modules.set(file, legalModule);
  const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = specifier => {
    if (specifier.startsWith('@/')) return load(`src/${specifier.slice(2)}.ts`);
    if (!['node:crypto', 'zod'].includes(specifier)) throw new Error(`Unexpected external legal dependency: ${specifier}`);
    return require(specifier);
  };
  new Function('require', 'module', 'exports', output)(localRequire, legalModule, legalModule.exports);
  return legalModule.exports;
}
const binding = load('src/lib/legal/content-hash.ts').currentLegalContentBinding();
for (const key of ['termsContentSha256', 'privacyContentSha256', 'acceptanceCopySha256']) if (!/^[a-f0-9]{64}$/.test(binding[key])) throw new Error(`Invalid ${key}`);
for (const key of ['termsVersion', 'privacyVersion', 'acceptanceCopyVersion', 'contentCanonicalizationVersion', 'receiptSchemaVersion']) if (typeof binding[key] !== 'string' || !binding[key]) throw new Error(`Missing ${key}`);
const after = paths.map(bind);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Legal source changed during capture');
const receipt = {
  observedAt: new Date().toISOString(),
  collector: 'Codex root; actual currentLegalContentBinding function evaluated from current repository source',
  environment: 'Local working tree; no database or provider access',
  status: 'CAPTURED_LOCAL_CONTENT_BINDING',
  method: 'Installed TypeScript transpileModule in memory to CommonJS; dependency allowlist restricted to the four captured source files, node:crypto and installed zod. No emitted source files.',
  typescriptVersion: ts.version,
  nodeRuntime: { version: process.version, executable: bind(process.execPath) },
  zodRuntime: { version: require('zod/package.json').version, packageMetadata: bind(path.relative(process.cwd(), require.resolve('zod/package.json'))), entryPoint: bind(path.relative(process.cwd(), require.resolve('zod'))) },
  transpiler: bind(path.relative(process.cwd(), require.resolve('typescript'))),
  collectorInput: bind(path.relative(process.cwd(), import.meta.filename)),
  binding,
  sources: before,
  sourcesUnchangedDuringCapture: true,
  freshnessRule: 'Any source, canonicalization or runtime dependency change invalidates this local binding.',
  limitations: ['Does not prove deployed legal content, accepted consent records, human approval or provider identity.'],
};
const target = 'docs/evidence/launch-execution-2026-10-22/local-legal-content-binding.json';
writeFileSync(target, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ artifact: bind(target), binding }) + '\n');

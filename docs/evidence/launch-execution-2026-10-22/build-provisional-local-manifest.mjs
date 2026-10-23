import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const bundle = 'docs/evidence/launch-execution-2026-10-22';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true });
const root = git('rev-parse', '--show-toplevel').trim().replaceAll('\\', '/');
const remote = git('remote', 'get-url', 'origin').trim();
if (root !== 'C:/Users/mskir/Desktop/Apply_Pack/applypack-production-v2' || remote !== 'https://github.com/duotapmobile/ApplyPack.git') throw new Error('Wrong repository');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const bind = file => { const bytes = readFileSync(file); return { path: file.replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes) }; };
const sourceFile = `${bundle}/local-source-final.json`;
const source = read(sourceFile);
if (source.baselineHead !== git('rev-parse', 'HEAD').trim()) throw new Error('Baseline changed');
const excluded = ['docs/evidence/launch-execution-2026-10-22/', 'evidence/', 'test-results/', 'playwright-report/'];
const currentPaths = [...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean))].filter(file => !excluded.some(prefix => file.startsWith(prefix))).sort();
if (JSON.stringify(currentPaths) !== JSON.stringify(source.files.map(file => file.path).sort())) throw new Error('Source inventory path set changed');
for (const file of source.files) if (bind(file.path).sha256 !== file.sha256) throw new Error(`Source drift: ${file.path}`);
const configFile = process.argv[2];
if (!configFile || path.resolve(configFile) !== path.resolve(bundle, 'LOCAL_MANIFEST_INPUTS.json')) throw new Error('Expected the versioned local manifest input configuration');
const config = read(configFile);
const bundlePath = file => {
  if (typeof file !== 'string' || !file || !path.resolve(bundle, file).startsWith(path.resolve(bundle) + path.sep)) throw new Error('Evidence path must remain inside the bundle');
  return `${bundle}/${file}`;
};
const browser = read(bundlePath(config.browserReport));
const browserReceipt = read(bundlePath(config.browserReceipt));
if (browserReceipt.status !== 'PASS_LOCAL_FULL_BROWSER_MATRIX' || browserReceipt.processExitCode !== 0 || browserReceipt.validator?.exitCode !== 0 || browserReceipt.uniqueCases !== 351 || browserReceipt.allFirstAttemptPassed !== true || browserReceipt.source?.beforeFiles !== 736 || browserReceipt.source?.afterFiles !== 736 || browserReceipt.source.added?.length !== 0 || browserReceipt.source.changed?.length !== 0 || browserReceipt.source.missing?.length !== 0 || browserReceipt.preservation?.historicalScreenshots !== 62 || browserReceipt.preservation?.protectedUserFiles !== 22 || browserReceipt.preservation?.mismatches !== 0 || browserReceipt.teardown?.remainingKnownProcesses?.length !== 0 || browserReceipt.teardown?.testPortListeners?.length !== 0) throw new Error('Browser acceptance/preservation/teardown receipt failed');
if (browserReceipt.artifactCount !== 63 || browserReceipt.artifacts?.length !== 63) throw new Error('Browser artifact inventory mismatch');
for (const artifact of browserReceipt.artifacts) if (bind(artifact.path).sha256 !== artifact.sha256) throw new Error(`Browser artifact drift: ${artifact.path}`);
if (!readFileSync(bundlePath(config.browserValidator), 'utf8').includes('Required tests passed with zero skipped, failed, todo or flaky cases.')) throw new Error('Required-results validator log missing pass');
const browserTests = [];
const walkSuite = suite => {
  for (const spec of suite.specs || []) for (const test of spec.tests || []) {
    const file = spec.file || suite.file;
    if (typeof file !== 'string' || !Number.isInteger(spec.line) || !spec.title || !test.projectId) throw new Error('Browser test identity is incomplete');
    browserTests.push({ ...test, uniqueIdentity: JSON.stringify([test.projectId, file, spec.line, spec.column, spec.title]) });
  }
  for (const child of suite.suites || []) walkSuite(child);
};
for (const suite of browser.suites || []) walkSuite(suite);
if (browser.stats?.expected !== 351 || browser.stats?.unexpected !== 0 || browser.stats?.skipped !== 0 || browser.stats?.flaky !== 0 || !Array.isArray(browser.errors) || browser.errors.length || browserTests.length !== 351 || browserTests.some(test => test.expectedStatus !== 'passed' || test.status !== 'expected' || test.results?.length !== 1 || test.results[0].status !== 'passed' || test.results[0].retry !== 0)) throw new Error('Actual browser JSON does not prove 351 clean first-attempt passes');
const expectedProjects = { desktop: 74, firefox: 69, webkit: 69, 'mobile-webkit': 69, mobile: 70 };
if (browser.config?.workers !== 1 || browser.config?.forbidOnly !== true || browser.config?.projects?.length !== 5 || browser.config.projects.some(project => !Object.hasOwn(expectedProjects, project.name) || project.retries !== 0)) throw new Error('Effective browser execution settings mismatch');
const projectCounts = {};
for (const test of browserTests) projectCounts[test.projectId] = (projectCounts[test.projectId] || 0) + 1;
if (Object.keys(projectCounts).length !== 5 || Object.entries(expectedProjects).some(([name, count]) => projectCounts[name] !== count) || new Set(browserTests.map(test => test.uniqueIdentity)).size !== 351) throw new Error('Browser project coverage or unique test identities mismatch');
const mandatoryEvidence = [
  'unit-current-serial-validation.json', 'unit-results-current-serial.json',
  'packaging-validation-final.json', 'unit-post-packaging-results.json',
  'integration-results-final.json', 'production-dependency-audit-final.json',
  'database/upgrade-matrix-085-readiness-final.json', 'database/database-final-state-085-readiness.json',
  'operations/selftest-receipts-final.json', 'operations/launch-image-results.json',
  'operations/launch-image-source-final.json', 'operations/launch-image-scan-status.json',
  'operations/launch-image-scan-coverage.json', 'operations/signing-helper-security-rebuild.json',
  'pinned-render-final-attempt.json', 'browser-route-validation-final.json', 'browser-built-route-probe.json',
  'local-source-final.json', 'preexisting-work-final-verification.json', 'final-hygiene-check.json',
  'source-validation-final-reconciliation.json', 'local-legal-content-binding.json', config.browserReport, config.browserReceipt, config.browserValidator,
];
const mandatoryHandoff = ['LOCAL_HANDOFF.md', 'LOCAL_VALIDATION.md', 'EXECUTION_REGISTER.md', 'EVIDENCE_DEPENDENCIES.md', 'VALIDATION_COMMANDS.md', 'reviews/REVIEW_INDEX.md'];
const mandatoryFailures = ['browser-attempt-01-interrupted.json', 'browser-attempt-03-interrupted.json', 'unit-current-invocation-failure.json', 'operations/launch-image-vulnerabilities.pre-security-rebuild.json'];
for (const file of mandatoryEvidence) if (!config.evidence?.some(item => item.file === file)) throw new Error(`Missing required receipt: ${file}`);
for (const file of mandatoryHandoff) if (!config.handoffFiles?.includes(file)) throw new Error(`Missing required handoff: ${file}`);
for (const file of mandatoryFailures) if (!config.preservedFailures?.includes(file)) throw new Error(`Missing preserved failure: ${file}`);
const image = read(`${bundle}/operations/launch-image-results.json`);
const imageInputs = read(`${bundle}/operations/launch-image-source-final.json`);
if (imageInputs.files.length !== image.sourceInputCount) throw new Error('Image input count mismatch');
for (const file of imageInputs.files) if (bind(file.path).sha256 !== file.sha256) throw new Error(`Image source drift: ${file.path}`);
const fonts = read('docs/evidence/OPEN_FONT_MANIFEST_2026-10-19.json');
const render = read(`${bundle}/pinned-render-final-attempt.json`);
const legal = read(`${bundle}/local-legal-content-binding.json`);
for (const file of legal.sources) if (bind(file.path).sha256 !== file.sha256) throw new Error(`Legal source drift: ${file.path}`);
const hygiene = read(`${bundle}/final-hygiene-check.json`);
if (hygiene.status !== 'PASS_SCOPED_SIGNATURE_SCAN' || hygiene.findings?.length !== 0 || !(hygiene.scannedCount > 0)) throw new Error('Scoped text hygiene scan has unresolved matches');
const records = config.evidence.map(item => ({
  ...item,
  environment: 'local synthetic/disposable validation unless its source receipt states a narrower scope',
  collector: 'Codex; original issuer and observation time retained in the referenced receipt',
  freshnessRule: item.freshnessRule || 'Snapshot evidence. Revalidate affected proof after source, tool, schema, identity or configuration changes; not operational readiness evidence.',
  artifact: bind(bundlePath(item.file)),
}));
const manifest = {
  schemaVersion: 'applypack-provisional-local-implementation-manifest-v1',
  observedAt: new Date().toISOString(),
  collector: 'Codex root',
  collectorInput: bind(path.relative(root, import.meta.filename)),
  collectorConfiguration: bind(configFile),
  verdict: 'NOT READY',
  scope: 'Uncommitted local implementation evidence; not a deployment candidate, release approval or operational authorization',
  repository: { root, remote, branch: git('branch', '--show-current').trim(), baselineGitSha: source.baselineHead, candidateGitSha: null, candidateFrozen: false, cleanCiUrls: [], workingTreeSourceInventory: bind(sourceFile), inputCount: source.files.length },
  buildInputs: ['package-lock.json', '.railway/package-lock.json', 'Dockerfile.launch', 'Dockerfile.launch.dockerignore', 'railway.launch.web.json', 'railway.launch.maintenance.json'].map(bind),
  localWebImage: { imageId: image.imageId, imageConfigDigest: image.imageConfigDigest, inputCount: image.sourceInputCount, currentInputHashesMatch: true, inputInventory: bind(`${bundle}/operations/launch-image-source-final.json`), configuration: 'Public staging placeholders only', deployed: false, registryPublished: false, artifact: bind(`${bundle}/operations/launch-image-results.json`) },
  deployedWorker: { imageDigest: null, versionArn: null, identityVerified: false },
  migrations: source.files.filter(file => file.path.startsWith('supabase/migrations/')),
  legal: { sourceBindings: legal.sources, localContentBinding: legal.binding, localBindingReceipt: bind(`${bundle}/local-legal-content-binding.json`), deployedLegalContentBinding: null, currentConsentApprovalVerified: false },
  documentIdentity: { fontManifest: bind('docs/evidence/OPEN_FONT_MANIFEST_2026-10-19.json'), family: fonts.family, version: fonts.version, styleSha256: fonts.styleSha256, canonicalFontManifestSha256: fonts.canonicalManifestSha256, localQaRendererIdentity: render.rendererIdentity, localRenderReceipt: bind(`${bundle}/pinned-render-final-attempt.json`), hostedRendererApproval: null, hostedParserIdentity: null, humanDocumentApproval: null },
  targetConfiguration: { environment: null, providerAccountProjectServiceIdentities: null, sanitizedDeployedConfigurationDigest: null, providerVerificationReceipts: [], allowedRuntimeTransitions: 'Only transitions through locked state; exact authorization and phase-specific configuration/deployment evidence required', authorizedExternalPhase: null },
  recovery: { compatibleCommittedRollbackSha: null, approvedProtectedForwardRecovery: null, status: 'BLOCKED', localSyntheticRestoreOnly: true },
  people: { assignments: 'Deferred by user', releaseApprover: null, primaryResponder: null, backupResponder: null, humanDeviceDocumentAndRiskApprovals: [] },
  evidence: records,
  browserAcceptance: { expected: browser.stats.expected, unexpected: browser.stats.unexpected, skipped: browser.stats.skipped, flaky: browser.stats.flaky, globalErrors: browser.errors.length, enumeratedPassedTests: browserTests.length, uniqueTestIdentities: 351, projectCounts, retries: 0, report: bind(bundlePath(config.browserReport)) },
  handoffBindings: config.handoffFiles.map(file => bind(bundlePath(file))),
  preservedFailures: config.preservedFailures.map(file => bind(bundlePath(file))),
  invalidation: [
    'Baseline SHA identifies the starting checkout, not these uncommitted contents. Any source change requires affected proof and a new inventory and review.',
    'Image, schema, helper, font, legal, tool or configuration changes invalidate dependent evidence. EVIDENCE_DEPENDENCIES.md documents scoped reuse.',
    'Vulnerability findings reflect the recorded scanner/database observation; refresh before release acceptance.',
    'Provider, credential, maintenance, capacity, inventory and approval freshness must be proven separately against actual targets.',
    'The manifest intentionally excludes its own hash to avoid a recursive identity. It does not amend or supersede the original receipts.',
  ],
};
const output = `${bundle}/PROVISIONAL_LOCAL_MANIFEST.json`;
writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ artifact: bind(output), sourceCount: source.files.length, evidenceCount: records.length }) + '\n');

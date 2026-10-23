import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const bundle = 'docs/evidence/launch-execution-2026-10-22';
if (process.cwd().replaceAll('\\', '/') !== 'C:/Users/mskir/Desktop/Apply_Pack/applypack-production-v2') throw new Error('Wrong repository directory');
const output = `${bundle}/final-hygiene-check.json`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const textExtensions = new Set(['.md', '.json', '.jsonl', '.log', '.txt', '.mjs', '.cjs', '.js', '.ts', '.ps1', '.patch', '.sql', '.yaml', '.yml', '.csv', '.xml', '.html', '.trace', '.network']);
const rules = [
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['stripe-live-secret', /\bsk_live_[A-Za-z0-9]{20,}\b/g],
  ['stripe-webhook-secret', /\bwhsec_[A-Za-z0-9]{20,}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g],
  ['private-key-header', /-----BEGIN(?: RSA| EC| OPENSSH| ENCRYPTED)? PRIVATE KEY-----/g],
  ['database-url-password', /\b(?:postgres|postgresql):\/\/[^:\s]+:[^@\s]+@/gi],
  ['jwt-shaped-value', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/g],
];
const scanned = [], excluded = [], findings = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected evidence symlink: ${file}`);
    if (entry.isDirectory()) { walk(file); continue; }
    if (file === output) continue;
    const size = statSync(file).size;
    if (!textExtensions.has(path.extname(file).toLowerCase()) || size > 16 * 1024 * 1024) { excluded.push({ path: file, bytes: size, reason: 'Binary/unlisted extension or above16MiB text bound' }); continue; }
    const bytes = readFileSync(file);
    if (bytes.includes(0)) { excluded.push({ path: file, bytes: size, reason: 'Binary NUL present' }); continue; }
    const text = bytes.toString('utf8');
    for (const [rule, expression] of rules) {
      const count = [...text.matchAll(expression)].length;
      if (count) findings.push({ path: file, rule, count });
    }
    scanned.push({ path: file, bytes: size, sha256: sha(bytes) });
  }
}
walk(bundle);
const receipt = {
  observedAt: new Date().toISOString(), collector: 'Codex root', environment: 'Local provisional evidence bundle',
  status: findings.length ? 'REVIEW_REQUIRED_SIGNATURE_MATCHES' : 'PASS_SCOPED_SIGNATURE_SCAN',
  scope: 'Recognizable credential signatures in the enumerated current text snapshot only. No matched values are recorded.',
  rules: rules.map(([name]) => name), scannedCount: scanned.length, scannedBytes: scanned.reduce((sum, item) => sum + item.bytes, 0), findings, excluded, scanned,
  limitations: ['Not an exhaustive secret/PII detector or publication approval.', 'Binary attachments and ignored raw browser/render archives are not scanned here; inspect/sanitize them before any publication.', 'This receipt and subsequently generated hash manifest/review receipts are outside this captured text snapshot.'],
  invalidation: 'Any changed or newly included evidence requires a fresh affected hygiene review before publication.',
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ status: receipt.status, scannedCount: scanned.length, scannedBytes: receipt.scannedBytes, excludedCount: excluded.length, findingCount: findings.length }) + '\n');
if (findings.length) process.exitCode = 1;

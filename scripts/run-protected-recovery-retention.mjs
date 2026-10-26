import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { awsRetentionWorkloadCredentials, retentionRolesAnywhereCertificateStatus } from "./lib/aws-retention-workload-credentials.mjs";
import { createArchiveLifecycleHttpTransport } from "./lib/archive-lifecycle-transport.mjs";
import { createRetentionVersionDeleter } from "./lib/protected-recovery-retention-execute.mjs";
import { runScopedArchiveRetention, reconcileScopedArchiveRetention } from "./lib/scoped-archive-retention.mjs";

const fail = (code) => { throw new Error(`ARCHIVE_RETENTION_RUN_${code}`); };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
export function archiveRetentionArguments(args) {
  if (args.length === 0) return { reconcileRunId: null };
  if (args.length === 2 && args[0] === "--reconcile" && uuid.test(args[1])) return { reconcileRunId: args[1] };
  fail("ARGUMENTS_FORBIDDEN");
}
function createDeleter(environment) {
  retentionRolesAnywhereCertificateStatus(environment);
  const client = new S3Client({ region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com", forcePathStyle: true,
    credentials: awsRetentionWorkloadCredentials(environment), maxAttempts: 1 });
  return { ...createRetentionVersionDeleter(client), close: () => client.destroy() };
}
/** Separate default-disabled entrypoint. It accepts no plan, bucket, path,
 * provider URL, private metadata file or database credentials. */
export async function runArchiveRetention(environment = process.env, options = {}, dependencies = {}) {
  if (environment.APP_ARCHIVE_RETENTION_EXECUTION_ENABLED !== "true" || environment.APP_ARCHIVE_LIFECYCLE_ENABLED !== "true") fail("DISABLED");
  for (const [name, value] of Object.entries(environment)) if (value && (
    ["APP_RECOVERY_READER_SECRET", "APP_RECOVERY_COMPLETION_SECRET", "APP_RECOVERY_RECEIPT_SECRET", "APP_DATABASE_BACKUP_LIFECYCLE_SECRET", "CRON_SECRET"].includes(name)
    || /^(APP_DATABASE_BACKUP_|APP_ARCHIVE_VERIFIER_|APP_BACKUP_AWS_RA_)/u.test(name))) fail("OTHER_CAPABILITY_FORBIDDEN");
  if (Object.keys(options).some((key) => key !== "reconcileRunId") || options.reconcileRunId && !uuid.test(options.reconcileRunId)) fail("ARGUMENTS_FORBIDDEN");
  const lifecycle = (dependencies.createLifecycle || createArchiveLifecycleHttpTransport)(environment, "RETENTION");
  const now = dependencies.now || Date.now;
  if (options.reconcileRunId) return reconcileScopedArchiveRetention({ lifecycle, runId: options.reconcileRunId, releaseSha: lifecycle.releaseSha, now });
  let deleter;
  try {
    deleter = (dependencies.createDeleter || createDeleter)(environment);
    return await runScopedArchiveRetention({ lifecycle, deleter, releaseSha: lifecycle.releaseSha, runId: randomUUID(), now });
  } finally { deleter?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await runArchiveRetention(process.env, archiveRetentionArguments(process.argv.slice(2))))}\n`); }
  catch { process.stderr.write(`${JSON.stringify({ status: "RETENTION_RECONCILIATION_REQUIRED", databaseDeletionPerformed: false })}\n`); process.exitCode = 1; }
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDatabaseRecoveryConfiguration, createDatabaseSnapshotSource } from "./lib/database-recovery-source.mjs";
import { createPinnedPostgresTools } from "./lib/database-recovery-pg-tools.mjs";
import { createDatabaseRecoveryDestination, validateDatabaseRecoveryArchiveConfiguration } from "./lib/database-recovery-s3.mjs";
import { databaseBackupRolesAnywhereCertificateStatus } from "./lib/aws-database-backup-workload-credentials.mjs";
import { createDatabaseCheckpoint } from "./lib/database-recovery-core.mjs";
import { createArchiveLifecycleHttpTransport } from "./lib/archive-lifecycle-transport.mjs";
import { runRegisteredArchiveWriter } from "./lib/archive-writer-run.mjs";

const registryUrl = new URL("../docs/launch/database-recovery-targets.json", import.meta.url);
const runtimePath = "/opt/applypack/database-recovery-runtime.json";
const fail = (code) => { throw new Error(`DATABASE_RECOVERY_RUN_${code}`); };

export function sanitizedDatabaseRecoveryFailure(error) {
  return typeof error?.message === "string" && /^(?:DATABASE_RECOVERY_[A-Z0-9_]{1,100}|aws_database_backup_roles_anywhere_[a-z_]{1,100}|aws_roles_anywhere_[a-z_]{1,100})$/u.test(error.message)
    ? error.message : "DATABASE_RECOVERY_RUN_FAILED";
}

async function readConfiguration(file) {
  try {
    const bytes = await readFile(file);
    if (bytes.length > 64 * 1024) fail("CONFIGURATION_SIZE");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { fail("CONFIGURATION_READ_FAILED"); }
}

/** The executable can only create a checkpoint. It never restores, deletes or unlocks service access. */
export async function runDatabaseRecovery(environment = process.env, dependencies = {}) {
  if (environment.APP_DATABASE_BACKUP_ENABLED !== "true" || environment.APP_DEPLOYMENT_ENV !== "production") fail("DISABLED");
  if (!/^[a-f0-9]{40}$/u.test(environment.APP_EXPECTED_RELEASE_SHA || "")
    || environment.RAILWAY_GIT_COMMIT_SHA !== environment.APP_EXPECTED_RELEASE_SHA) fail("RELEASE_IDENTITY");
  const read = dependencies.readConfiguration || readConfiguration;
  const registry = await read(registryUrl);
  const runtime = await read(runtimePath);
  const configuration = validateDatabaseRecoveryConfiguration({ registry, runtime, environment });
  (dependencies.validateArchive || validateDatabaseRecoveryArchiveConfiguration)(environment);
  // Validate certificate custody before opening a database connection. This is
  // local inspection; the temporary credential provider still verifies STS.
  (dependencies.certificateStatus || databaseBackupRolesAnywhereCertificateStatus)(environment);
  const secret = environment.APP_DATABASE_BACKUP_DB_PASSWORD;
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 16 || Buffer.byteLength(secret) > 1024
    || /[\x00\r\n]/u.test(secret)) fail("PASSWORD_INPUT");
  const lifecycle = (dependencies.createLifecycle || createArchiveLifecycleHttpTransport)(environment, "DATABASE");
  let password; let tools; let destination;
  try {
    password = Buffer.from(secret, "utf8");
    tools = (dependencies.createTools || createPinnedPostgresTools)({ configuration, password,
      caPemBase64: environment.APP_DATABASE_BACKUP_DB_CA_PEM_BASE64 });
    destination = (dependencies.createDestination || createDatabaseRecoveryDestination)(environment);
    const source = (dependencies.createSource || createDatabaseSnapshotSource)({ configuration, tools, now: dependencies.now || Date.now });
    const registered = await runRegisteredArchiveWriter({ lifecycle, kind: "DATABASE", releaseSha: configuration.releaseSha, now: dependencies.now || Date.now,
      execute: async ({ remainingMilliseconds }) => (dependencies.checkpoint || createDatabaseCheckpoint)({ source, destination,
        releaseSha: configuration.releaseSha, now: dependencies.now || Date.now, maximumRunMilliseconds: remainingMilliseconds() }) });
    const result = registered.result;
    return { schemaVersion: "applypack-database-recovery-run-result-v1", status: result.status,
      releaseSha: configuration.releaseSha, sourceStartedAt: result.manifest.watermark,
      manifestSha256: result.manifestSha256, manifestVersionId: result.manifestVersionId,
      runId: registered.runId, completionReceiptSha256: registered.completionReceiptSha256,
      serviceRecoveryComplete: false, authenticatedCheckpointRecorded: true, readinessUpdated: false };
  } finally {
    // Even a factory failure cannot leave credential bytes or a held client behind.
    try { await tools?.dispose?.(); }
    finally { password?.fill(0); destination?.close(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) fail("ARGUMENTS_FORBIDDEN");
    process.stdout.write(`${JSON.stringify(await runDatabaseRecovery())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "FAILED", code: sanitizedDatabaseRecoveryFailure(error) })}\n`);
    process.exitCode = 1;
  }
}

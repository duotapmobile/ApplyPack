import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RECOVERY, copyCheckpoint } from "./lib/protected-recovery-core.mjs";
import { createRecoveryHttpTransport } from "./lib/protected-recovery-transport.mjs";
import { createProtectedRecoveryDestination } from "./lib/protected-recovery-s3.mjs";

export function sanitizedRecoveryFailure(error) {
  return typeof error?.message === "string" && /^(?:PROTECTED_RECOVERY_[A-Z0-9_]{1,100}|aws_backup_roles_anywhere_[a-z_]{1,100})$/u.test(error.message)
    ? error.message : "PROTECTED_RECOVERY_RUN_FAILED";
}

export async function runProtectedRecovery(environment = process.env, dependencies = {}) {
  const transport = (dependencies.createTransport || createRecoveryHttpTransport)(environment);
  const destination = (dependencies.createDestination || createProtectedRecoveryDestination)(environment);
  const now = dependencies.now || Date.now;
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOVERY.maximumRunMilliseconds);
  try {
    const previous = await destination.readPreviousManifest({ signal: controller.signal });
    const remaining = RECOVERY.maximumRunMilliseconds - (now() - started);
    if (controller.signal.aborted || remaining <= 0) throw new Error("PROTECTED_RECOVERY_TIMEOUT");
    const result = await (dependencies.copy || copyCheckpoint)({ source: transport.source, completion: transport.completion,
      destination, archive: destination.archive, releaseSha: transport.releaseSha, previous, now, maximumRunMilliseconds: remaining });
    return { schemaVersion: "applypack-protected-recovery-run-result-v1", status: "COMPLETED", releaseSha: transport.releaseSha,
      sourceStartedAt: result.manifest.watermark, manifestSha256: result.manifestDigest,
      objectCount: result.manifest.entries.length, referenceCount: result.manifest.inventory.references.length,
      tombstoneCount: result.manifest.inventory.tombstones.length };
  } finally { clearTimeout(timer); controller.abort(); destination.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("PROTECTED_RECOVERY_ARGUMENTS_FORBIDDEN");
    process.stdout.write(`${JSON.stringify(await runProtectedRecovery())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "FAILED", code: sanitizedRecoveryFailure(error) })}\n`);
    process.exitCode = 1;
  }
}

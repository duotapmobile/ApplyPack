import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RECOVERY, restoreCheckpoint, validateManifest } from "./lib/protected-recovery-core.mjs";
import { createRecoveryHttpReader } from "./lib/protected-recovery-transport.mjs";
import { validateRecoveryRegistration, readIndependentRecoveryCredentials, createIndependentArchiveReader,
  createRegisteredRestoreTarget } from "./lib/protected-recovery-restore.mjs";
import { readBootstrapCredential } from "./bootstrap-protected-recovery.mjs";
import { sanitizedRecoveryFailure } from "./run-protected-recovery.mjs";

export async function runRegisteredRecoveryRestore({ registration, expectedRegistrationDigest, environment = process.env,
  credentialStream = process.stdin, dependencies = {} }) {
  const now = dependencies.now || Date.now;
  validateRecoveryRegistration(registration, expectedRegistrationDigest, now());
  const controller = new AbortController();
  const started = now(); const timer = setTimeout(() => controller.abort(), RECOVERY.maximumRunMilliseconds);
  let archiveReader;
  try {
    const targetKey = await readBootstrapCredential(credentialStream, { signal: controller.signal });
    const credentials = (dependencies.readCredentials || readIndependentRecoveryCredentials)({ environment, now: now() });
    archiveReader = (dependencies.createArchiveReader || createIndependentArchiveReader)({ registration, credentials });
    const manifest = await archiveReader.readManifest({ signal: controller.signal });
    validateManifest(manifest, registration.manifestSha256);
    const source = (dependencies.createSource || createRecoveryHttpReader)({ ...environment, APP_DEPLOYMENT_ENV: "production",
      APP_BASE_URL: "https://applypack.work", APP_EXPECTED_RELEASE_SHA: registration.sourceReleaseSha,
      RAILWAY_GIT_COMMIT_SHA: registration.sourceReleaseSha }).source;
    const latestInventory = await source.readInventory({ signal: controller.signal });
    const target = (dependencies.createTarget || createRegisteredRestoreTarget)({ registration, supabaseKey: targetKey, now });
    const remaining = RECOVERY.maximumRunMilliseconds - (now() - started);
    if (controller.signal.aborted || remaining <= 0) throw new Error("PROTECTED_RECOVERY_TIMEOUT");
    return await (dependencies.restore || restoreCheckpoint)({ manifest, manifestDigest: registration.manifestSha256,
      latestInventory, archiveReader, target, now, maximumRunMilliseconds: remaining,
      policy: { schemaVersion: "applypack-protected-recovery-restore-policy-v1", targetProjectRef: registration.targetProjectRef,
        targetOrigin: registration.targetOrigin, allowedTargets: [{ projectRef: registration.targetProjectRef, origin: registration.targetOrigin, environment: "recovery" }],
        archiveCredentialIdentity: archiveReader.credentialIdentity, targetCredentialIdentity: target.credentialIdentity,
        sourceCredentialIdentity: "production-recovery-reader-capability", expectedManifestDigest: registration.manifestSha256 } });
  } finally { clearTimeout(timer); controller.abort(); archiveReader?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || !/^[a-f0-9]{64}$/u.test(process.argv[3])) throw new Error("PROTECTED_RECOVERY_RESTORE_ARGUMENTS");
    const bytes = readFileSync(resolve(process.argv[2]));
    if (bytes.length > 32 * 1024) throw new Error("PROTECTED_RECOVERY_RESTORE_REGISTRATION_LIMIT");
    const registration = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    process.stdout.write(`${JSON.stringify(await runRegisteredRecoveryRestore({ registration, expectedRegistrationDigest: process.argv[3] }))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "FAILED", code: sanitizedRecoveryFailure(error) })}\n`);
    process.exitCode = 1;
  }
}

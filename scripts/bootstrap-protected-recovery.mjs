import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addAbortSignal, Readable } from "node:stream";
import { RECOVERY, createBootstrapArchive } from "./lib/protected-recovery-core.mjs";
import { createOperatorBootstrapSource } from "./lib/protected-recovery-bootstrap.mjs";
import { createProtectedRecoveryDestination } from "./lib/protected-recovery-s3.mjs";
import { sanitizedRecoveryFailure } from "./run-protected-recovery.mjs";

/** Existing sealed operator key is supplied through a pipe, never command arguments or a file. */
export async function readBootstrapCredential(stream, { signal } = {}) {
  const chunks = []; let size = 0; let bytes;
  const boundedStream = signal ? addAbortSignal(signal, Readable.from(stream)) : stream;
  try {
    for await (const chunk of boundedStream) {
      size += chunk.byteLength;
      if (size > 8192) throw new Error("PROTECTED_RECOVERY_BOOTSTRAP_INPUT_LIMIT");
      chunks.push(Buffer.from(chunk));
    }
    let input;
    try { bytes = Buffer.concat(chunks, size); input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new Error("PROTECTED_RECOVERY_BOOTSTRAP_INPUT_INVALID"); }
    if (!input || Object.keys(input).join("|") !== "supabaseKey" || typeof input.supabaseKey !== "string") {
      throw new Error("PROTECTED_RECOVERY_BOOTSTRAP_INPUT_INVALID");
    }
    return input.supabaseKey;
  } finally { bytes?.fill(0); for (const chunk of chunks) chunk.fill(0); }
}

export async function runBootstrapRecovery({ environment = process.env, credentialStream = process.stdin, dependencies = {} } = {}) {
  // This historical pre-migration tool cannot participate in the authenticated
  // completion protocol. Retire its credentials before enabling archive pruning.
  if (environment.APP_ARCHIVE_LIFECYCLE_ENABLED === "true") throw new Error("PROTECTED_RECOVERY_BOOTSTRAP_LEGACY_WRITER_RETIRED");
  if (environment.APP_RECOVERY_BOOTSTRAP_WRITERS_LOCKED !== "true"
    || !/^[a-f0-9]{40}$/u.test(environment.APP_RECOVERY_BOOTSTRAP_SOURCE_SHA || "")
    || !/^[a-f0-9]{64}$/u.test(environment.APP_RECOVERY_BOOTSTRAP_DATABASE_EVIDENCE_SHA256 || "")) {
    throw new Error("PROTECTED_RECOVERY_BOOTSTRAP_PRECONDITIONS");
  }
  const destination = (dependencies.createDestination || createProtectedRecoveryDestination)(environment);
  const now = dependencies.now || Date.now; const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RECOVERY.maximumRunMilliseconds);
  try {
    const key = await readBootstrapCredential(credentialStream, { signal: controller.signal });
    const source = (dependencies.createSource || createOperatorBootstrapSource)({ supabaseKey: key,
      releaseSha: environment.APP_RECOVERY_BOOTSTRAP_SOURCE_SHA, now });
    const previous = await destination.readPreviousManifest({ signal: controller.signal });
    const remaining = RECOVERY.maximumRunMilliseconds - (now() - started);
    if (controller.signal.aborted || remaining <= 0) throw new Error("PROTECTED_RECOVERY_TIMEOUT");
    const result = await (dependencies.archive || createBootstrapArchive)({ operatorBootstrap: true, source, destination,
      archive: destination.archive, releaseSha: environment.APP_RECOVERY_BOOTSTRAP_SOURCE_SHA,
      previous, now, maximumRunMilliseconds: remaining });
    return { schemaVersion: "applypack-protected-recovery-bootstrap-result-v1", status: result.status,
      applicationCheckpointCompleted: false, sourceReleaseSha: environment.APP_RECOVERY_BOOTSTRAP_SOURCE_SHA,
      databaseEvidenceSha256: environment.APP_RECOVERY_BOOTSTRAP_DATABASE_EVIDENCE_SHA256,
      manifestSha256: result.manifestDigest, manifestVersionId: result.manifestVersionId,
      sourceStartedAt: result.manifest.watermark, objectCount: result.manifest.entries.length };
  } finally { clearTimeout(timer); controller.abort(); destination.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("PROTECTED_RECOVERY_ARGUMENTS_FORBIDDEN");
    process.stdout.write(`${JSON.stringify(await runBootstrapRecovery())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "FAILED", code: sanitizedRecoveryFailure(error) })}\n`);
    process.exitCode = 1;
  }
}

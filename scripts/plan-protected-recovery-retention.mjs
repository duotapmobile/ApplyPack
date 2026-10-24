import { resolve } from "node:path";
import { open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createProtectedRecoveryRetentionPlanReader, inspectRecoveryRetention, parseRetentionManifestEvidence, RETENTION_EVIDENCE_LIMITS } from "./lib/protected-recovery-retention-plan.mjs";

export async function readRetentionManifestEvidenceFile(path) {
  const handle = await open(path, "r"); let bytes;
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > RETENTION_EVIDENCE_LIMITS.bytes) throw new Error("PROTECTED_RECOVERY_RETENTION_PLAN_EVIDENCE_LIMIT");
    bytes = Buffer.alloc(metadata.size + 1); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== metadata.size) throw new Error("PROTECTED_RECOVERY_RETENTION_PLAN_EVIDENCE_CHANGED");
    return parseRetentionManifestEvidence(bytes.subarray(0, offset));
  } finally { bytes?.fill(0); await handle.close(); }
}

export function retentionPlanArguments(args) {
  if (args.length === 0) return null;
  if (args.length !== 2 || args[0] !== "--manifest-evidence" || typeof args[1] !== "string" || !args[1].trim()) {
    throw new Error("PROTECTED_RECOVERY_RETENTION_PLAN_ARGUMENTS_FORBIDDEN");
  }
  return args[1];
}

export function retentionPlanSummary({ plan, digest }) {
  const mapping = plan.historicalMapping;
  const replacement = mapping.replacementCheckpoint.status;
  if (plan.status !== "READ_ONLY_NOT_AUTHORIZED_TO_DELETE" || plan.providerMutationPerformed !== false
    || plan.proposedRemovals.length !== 0 || mapping.allVersionsPreserved !== true
    || !/^[a-f0-9]{64}$/u.test(digest) || !/^[a-f0-9]{40}$/u.test(plan.releaseSha)
    || !["INCOMPLETE_MANIFEST_EVIDENCE", "METADATA_VERIFIED_ONLY", "NO_MATCHING_CURRENT_CHECKPOINT"].includes(replacement)) {
    throw new Error("PROTECTED_RECOVERY_RETENTION_PLAN_SUMMARY_INVALID");
  }
  return { status: "READ_ONLY_NOT_AUTHORIZED_TO_DELETE", reportDigest: digest, releaseSha: plan.releaseSha,
    providerMutationPerformed: false, allVersionsPreserved: true, proposedRemovalCount: 0,
    retainedVersionCount: plan.retainedVersions.length, unresolvedObjectVersionCount: plan.unresolvedObjectVersions.length,
    expiredManifestCandidateCount: plan.expiredManifestCandidates.length,
    suppliedManifestCount: mapping.manifestCoverage.supplied, missingManifestCount: mapping.manifestCoverage.missing.length,
    replacementMetadataStatus: replacement, providerBytesVerified: false, applicationCompletionVerified: false, hostedRestoreVerified: false };
}

export async function readProtectedRecoveryRetentionPlan(environment = process.env, create = createProtectedRecoveryRetentionPlanReader, manifestEvidence = []) {
  const context = create(environment);
  try { return await inspectRecoveryRetention({ ...context, manifestEvidence }); }
  finally { context.archive.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = retentionPlanArguments(process.argv.slice(2));
    const evidence = path ? await readRetentionManifestEvidenceFile(path) : [];
    const result = await readProtectedRecoveryRetentionPlan(process.env, createProtectedRecoveryRetentionPlanReader, evidence);
    process.stdout.write(`${JSON.stringify(retentionPlanSummary(result))}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({ status: "READ_ONLY_PLAN_FAILED", providerMutationPerformed: false })}\n`);
    process.exitCode = 1;
  }
}

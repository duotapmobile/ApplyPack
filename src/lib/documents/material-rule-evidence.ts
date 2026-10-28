import { z } from "zod";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const materialRuleBasisSchema = z.object({ lineRevisionId: uuid, sourceSnapshotId: uuid, jobSnapshotId: uuid,
  jobContentSha256: hash, ruleId: uuid, ruleSha256: hash, ruleRecordSha256: hash, sourceAuthoritySha256: hash }).strict();
export const materialRuleReviewChecklistSchema = z.object({ applicationAccessReviewed: z.literal(true), liveListingOpened: z.literal(true),
  submissionInstructionsCompared: z.literal(true), unchangedRuleConfirmed: z.literal(true) }).strict();
export const materialRuleReceiptSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, job_id: uuid, line_revision_id: uuid,
  reviewed_version_id: uuid.nullable(), reviewed_lease_generation: z.number().int().nonnegative(),
  review_method: z.literal("OWNER_REOPENED_PUBLIC_APPLICATION"), basis: materialRuleBasisSchema, review_checklist: materialRuleReviewChecklistSchema,
  checked_by: uuid, checked_at: time, receipt_sha256: hash, created_at: time }).strict();
// Only stable source evidence belongs in the encrypted packet. The live job's
// active version and lease generation change during normal claims and refresh.
export const materialRulePacketEvidenceSchema = z.object({ contractVersion: z.literal("applypack-material-rule-revalidation-v1"),
  jobId: uuid, basis: materialRuleBasisSchema, originalCheckedAt: time, effectiveCheckedAt: time,
  revalidation: materialRuleReceiptSchema.nullable() }).strict();
export const materialRuleEvidenceProjectionSchema = materialRulePacketEvidenceSchema.extend({ activeVersionId: uuid.nullable(),
  leaseGeneration: z.number().int().nonnegative() }).strict();
export type MaterialRulePacketEvidence = z.infer<typeof materialRulePacketEvidenceSchema>;
export type MaterialRuleEvidenceBinding = { jobId: string; customerId: string; materialLineId: string; lineRevisionId: string;
  sourceSnapshotId: string; jobSnapshotId: string; jobContentSha256: string; ruleId: string; ruleSha256: string; originalCheckedAt: string };

function requireThat(value: unknown): asserts value { if (!value) throw new Error("MATERIAL_RULE_EVIDENCE_INVALID"); }
function sameBasis(a: MaterialRulePacketEvidence["basis"], b: MaterialRulePacketEvidence["basis"]) {
  return Object.keys(a).every((key) => a[key as keyof typeof a] === b[key as keyof typeof b]);
}

/** Accept only the service-only092 projection of current database authority.
 * receipt_sha256 is the server's stored receipt digest, not a provider signature
 * or independent proof that a new automated fetch happened. */
export function validateMaterialRulePacketEvidence(raw: unknown, expected: MaterialRuleEvidenceBinding, now = new Date()): MaterialRulePacketEvidence {
  const parsed = materialRulePacketEvidenceSchema.safeParse(raw);
  requireThat(parsed.success && Number.isFinite(now.getTime()));
  const evidence = parsed.data, basis = evidence.basis, receipt = evidence.revalidation, clock = now.getTime();
  requireThat(evidence.jobId === expected.jobId && basis.lineRevisionId === expected.lineRevisionId && basis.sourceSnapshotId === expected.sourceSnapshotId
    && basis.jobSnapshotId === expected.jobSnapshotId && basis.jobContentSha256 === expected.jobContentSha256
    && basis.ruleId === expected.ruleId && basis.ruleSha256 === expected.ruleSha256
    && Date.parse(evidence.originalCheckedAt) === Date.parse(expected.originalCheckedAt) && Date.parse(evidence.originalCheckedAt) <= clock);
  if (receipt) {
    requireThat(receipt.customer_id === expected.customerId && receipt.material_line_id === expected.materialLineId && receipt.job_id === expected.jobId
      && receipt.line_revision_id === expected.lineRevisionId && sameBasis(receipt.basis, basis)
      && Date.parse(receipt.checked_at) <= clock && clock - Date.parse(receipt.checked_at) < 3_600_000
      && Date.parse(receipt.created_at) <= clock && Date.parse(receipt.created_at) >= Date.parse(receipt.checked_at));
  }
  const effective = Math.max(Date.parse(evidence.originalCheckedAt), receipt ? Date.parse(receipt.checked_at) : -Infinity);
  requireThat(Date.parse(evidence.effectiveCheckedAt) === effective && effective <= clock && clock - effective < 3_600_000);
  return evidence;
}

export function materialRuleProjectionForPacket(raw: unknown, expected: MaterialRuleEvidenceBinding, now = new Date()) {
  const parsed = materialRuleEvidenceProjectionSchema.safeParse(raw); requireThat(parsed.success);
  const { contractVersion, jobId, basis, originalCheckedAt, effectiveCheckedAt, revalidation } = parsed.data;
  const stable = { contractVersion, jobId, basis, originalCheckedAt, effectiveCheckedAt, revalidation };
  return validateMaterialRulePacketEvidence(stable, expected, now);
}

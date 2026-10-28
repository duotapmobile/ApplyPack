import { describe, expect, it } from "vitest";
import { materialRuleProjectionForPacket, validateMaterialRulePacketEvidence } from "@/lib/documents/material-rule-evidence";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const original = "2026-10-25T10:00:00Z", checked = "2026-10-25T11:55:00Z", now = new Date("2026-10-25T12:00:00Z");
const expected = { jobId: id(1), customerId: id(2), materialLineId: id(3), lineRevisionId: id(4), sourceSnapshotId: id(5),
  jobSnapshotId: id(6), jobContentSha256: "a".repeat(64), ruleId: id(7), ruleSha256: "b".repeat(64), originalCheckedAt: original };
function fixture() {
  const basis = { lineRevisionId: id(4), sourceSnapshotId: id(5), jobSnapshotId: id(6), jobContentSha256: "a".repeat(64),
    ruleId: id(7), ruleSha256: "b".repeat(64), ruleRecordSha256: "c".repeat(64), sourceAuthoritySha256: "d".repeat(64) };
  return { contractVersion: "applypack-material-rule-revalidation-v1", jobId: id(1), basis, originalCheckedAt: original, effectiveCheckedAt: checked,
    revalidation: { id: id(8), customer_id: id(2), material_line_id: id(3), job_id: id(1), line_revision_id: id(4), reviewed_version_id: id(9),
      reviewed_lease_generation: 1, review_method: "OWNER_REOPENED_PUBLIC_APPLICATION", basis: { ...basis },
      review_checklist: { applicationAccessReviewed: true, liveListingOpened: true, submissionInstructionsCompared: true, unchangedRuleConfirmed: true },
      checked_by: id(10), checked_at: checked, receipt_sha256: "e".repeat(64), created_at: checked } };
}
describe("owner rule evidence projection", () => {
  it("preserves original dates and identifies a human recheck without claiming an automated fetch", () => {
    const result = validateMaterialRulePacketEvidence(fixture(), expected, now);
    expect(result.originalCheckedAt).toBe(original); expect(result.effectiveCheckedAt).toBe(checked);
    expect(result.revalidation?.review_method).toBe("OWNER_REOPENED_PUBLIC_APPLICATION");
  });
  it("excludes changing lease/version fields so normal worker claims do not mutate packet evidence", () => {
    const first = materialRuleProjectionForPacket({ ...fixture(), activeVersionId: id(9), leaseGeneration: 2 }, expected, now);
    const next = materialRuleProjectionForPacket({ ...fixture(), activeVersionId: id(11), leaseGeneration: 4 }, expected, now);
    expect(first).toEqual(next); expect(first).not.toHaveProperty("activeVersionId"); expect(first).not.toHaveProperty("leaseGeneration");
  });
  it.each(["jobId", "customerId", "materialLineId", "lineRevisionId", "sourceSnapshotId", "jobSnapshotId", "jobContentSha256", "ruleId", "ruleSha256", "originalCheckedAt"])("rejects the wrong expected %s", (key) => {
    expect(() => validateMaterialRulePacketEvidence(fixture(), { ...expected, [key]: key.endsWith("Sha256") ? "f".repeat(64) : key === "originalCheckedAt" ? checked : id(99) }, now)).toThrow("MATERIAL_RULE_EVIDENCE_INVALID");
  });
  it.each(["ruleRecordSha256", "sourceAuthoritySha256"])("rejects a receipt for a different %s", (key) => {
    const data = fixture(); data.revalidation.basis[key as "ruleRecordSha256" | "sourceAuthoritySha256"] = "f".repeat(64);
    expect(() => validateMaterialRulePacketEvidence(data, expected, now)).toThrow();
  });
  it.each(["2026-10-25T11:00:00Z", "2026-10-25T10:59:59Z", "2026-10-25T12:00:01Z"])("rejects expired or future receipt time %s", (value) => {
    const data = fixture(); data.effectiveCheckedAt = data.revalidation.checked_at = data.revalidation.created_at = value;
    expect(() => validateMaterialRulePacketEvidence(data, expected, now)).toThrow();
  });
  it.each(["method", "incomplete", "forgedEffective", "futureCreation", "creationBeforeReview", "extra"])("rejects %s evidence", (variant) => {
    const data = fixture();
    if (variant === "method") data.revalidation.review_method = "AUTOMATED_FETCH";
    if (variant === "incomplete") data.revalidation.review_checklist.applicationAccessReviewed = false;
    if (variant === "forgedEffective") data.effectiveCheckedAt = now.toISOString();
    if (variant === "futureCreation") data.revalidation.created_at = "2026-10-25T12:01:00Z";
    if (variant === "creationBeforeReview") data.revalidation.created_at = original;
    if (variant === "extra") Object.assign(data.revalidation, { providerSignature: "unverified" });
    expect(() => validateMaterialRulePacketEvidence(data, expected, now)).toThrow();
  });
  it("never treats absent revalidation as permission to renew a stale rule", () => {
    const data = { ...fixture(), effectiveCheckedAt: original, revalidation: null };
    expect(() => validateMaterialRulePacketEvidence(data, expected, now)).toThrow();
    const fresh = { ...data, originalCheckedAt: checked, effectiveCheckedAt: checked };
    expect(validateMaterialRulePacketEvidence(fresh, { ...expected, originalCheckedAt: checked }, now).revalidation).toBeNull();
  });
});

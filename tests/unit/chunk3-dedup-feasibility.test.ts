import { describe, expect, it } from "vitest";
import type { NormalizedJob } from "@/lib/jobs/types";
import { assertPairwiseIndependent, duplicateEdgeReason, selectIndependentInventory, stableNormalizedJobId } from "@/lib/matching/deduplication";
import { assessFeasibility, coverageComplete, createCoveragePlan, customerFeasibilityMessage, type CoverageCell, type PersistedInventoryEvaluation } from "@/lib/matching/feasibility";

function job(id: string, change: Partial<NormalizedJob> = {}): NormalizedJob {
  return { canonicalEmployerId: "employer", employerDisplayName: "Example", employerAliases: [], sourceId: "manual-reviewed", sourceName: "Manual", sourceCategory: "third_party_aggregator", isOfficialSource: false, isDirectEmployerSource: false, officialApplicationUrl: null, sourceJobUrl: `https://board.invalid/${id}`, normalizedSourceUrl: `https://board.invalid/${id}`, externalJobId: null, normalizedTitle: "operations coordinator", rawTitle: "Operations Coordinator", description: "Coordinate workflows.", department: null, employmentType: "w2_full_time", w2OrContractor: "w2", workMode: "remote_us_nationwide", remoteScope: null, eligibleStates: [], eligibleCountries: ["US"], timezoneRequirement: null, scheduleType: null, salaryMin: null, salaryMax: null, salaryCurrency: null, payPeriod: null, payModel: "unknown", phoneIntensity: "low", salesFlag: false, commissionFlag: false, marketingFlag: false, highVolumeContactCenterFlag: false, degreeRequired: null, experienceLevel: "early_career", equipmentRequirement: null, equipmentCostResponsibility: "unknown", applicantCost: null, benefitsStatus: "unknown", languageRequirements: [], postedAt: null, closingAt: null, lastVerifiedAt: "2026-09-04T12:00:00.000Z", sourceFreshnessStatus: "unknown", contentHash: id, deduplicationKey: `fingerprint-${id}`, isActive: true, reviewStatus: "pending", rejectionReason: null, locationText: "Remote", firstSeenAt: "2026-09-04T11:00:00.000Z", ...change };
}
const cell = (change: Partial<CoverageCell> = {}): CoverageCell => ({ id: "cell-1", familyId: "family-1", sourceId: "manual-reviewed", authorizationState: "AUTHORIZED_MANUAL_ONLY", authorizationEvidenceId: "manual-v1", path: "MANUAL", queryFingerprint: "f".repeat(64), paginationBound: 1, lookbackBound: 1, resultBound: 10, outcome: "SUCCEEDED_WITH_RESULTS", resultCount: 10, configuredBoundSatisfied: true, normalizedAndDeduplicated: true, manualChecklistComplete: true, parserResult: "COMPLETE", stopReason: "configured bound", ...change });
const plan = (cellChanges: Partial<CoverageCell> = {}, planChanges: Record<string, unknown> = {}) => createCoveragePlan({ id: "plan-1", inventoryVersionId: "inventory-v1", snapshotHash: "a".repeat(64), breadth: "ADJACENT_OPPORTUNITIES", requiredFamilyIds: ["family-1"], cells: [cell(cellChanges)], versions: { source: "s1", query: "q1", inventory: "i1", parser: "p1", cutoff: "c1" }, disposition: "REQUIRED", collisionProof: null, ...planChanges } as never);
const deliverable = (change: Partial<PersistedInventoryEvaluation> = {}): PersistedInventoryEvaluation => {
  const id = randomUUID();
  return { inventoryMemberId: `member-${id}`, inventoryVersionId: "inventory-v1", evaluationId: `evaluation-${id}`, snapshotId: "snapshot-v1", jobSnapshotId: `job-${id}`, classification: "PRELIMINARILY_DELIVERABLE", resolutionBlocker: "NONE", exclusionReason: null, ...change };
};

describe("Chunk 3 deduplication and feasibility", () => {
  it("creates requisition, canonical URL, and fingerprint OR edges with null safety", () => {
    expect(duplicateEdgeReason(job("a", { externalJobId: "req", externalJobIdReliable: true }), job("b", { externalJobId: "req", externalJobIdReliable: true }))).toBe("external_job_id");
    expect(duplicateEdgeReason(job("a", { officialApplicationUrl: "https://employer.invalid/jobs/1" }), job("b", { officialApplicationUrl: "https://employer.invalid/jobs/1?utm_source=x" }))).toBe("canonical_url");
    expect(duplicateEdgeReason(job("a", { deduplicationKey: "same" }), job("b", { deduplicationKey: "same" }))).toBe("fingerprint");
    expect(duplicateEdgeReason(job("a"), job("b"))).toBeNull();
  });

  it("deduplicates the same canonical application URL across employer identities and keeps stable identity independent of listing content", () => {
    const left = job("left", { canonicalEmployerId: "employer-a", officialApplicationUrl: "https://apply.example/jobs/42", contentHash: "old" });
    const right = job("right", { canonicalEmployerId: "employer-b", officialApplicationUrl: "https://apply.example/jobs/42?utm_source=board", contentHash: "new" });
    expect(duplicateEdgeReason(left, right)).toBe("canonical_url");
    expect(stableNormalizedJobId(left)).toBe(stableNormalizedJobId({ ...left, contentHash: "revised-listing-content" }));
  });

  it("keeps both strong endpoints in the non-transitive A-B, B-C, not-A-C chain", () => {
    const a = job("a", { externalJobId: "A", externalJobIdReliable: true, officialApplicationUrl: "https://employer.invalid/a", deduplicationKey: "bridge" });
    const b = job("b", { externalJobId: null, officialApplicationUrl: null, deduplicationKey: "bridge" });
    const c = job("c", { externalJobId: "C", externalJobIdReliable: true, officialApplicationUrl: "https://employer.invalid/c", deduplicationKey: "bridge" });
    expect(duplicateEdgeReason(a, b)).toBe("fingerprint"); expect(duplicateEdgeReason(b, c)).toBe("fingerprint"); expect(duplicateEdgeReason(a, c)).toBeNull();
    const result = selectIndependentInventory([b, c, a]);
    expect(result.selected.map((item) => item.contentHash)).toEqual(["a", "c"]);
    expect(result.displacements).toHaveLength(1);
    expect(assertPairwiseIndependent(result.selected)).toBe(true);
  });

  it("is input-order stable and chooses the strict stronger record", () => {
    const weak = job("weak", { deduplicationKey: "same", lastVerifiedAt: "2026-09-05T00:00:00.000Z" });
    const strong = job("strong", { deduplicationKey: "same", externalJobId: "req", externalJobIdReliable: true, isOfficialSource: true, isDirectEmployerSource: true });
    const outputs = [[weak, strong], [strong, weak]].map((items) => selectIndependentInventory(items).selected.map((x) => x.contentHash));
    expect(outputs[0]).toEqual(["strong"]); expect(outputs[1]).toEqual(outputs[0]);
  });

  it.each(["AUTHORIZATION_ERROR", "RETRIEVAL_ERROR", "TIMEOUT", "TRUNCATED", "PARSER_ERROR"] as const)("fails completeness for %s", (outcome) => expect(coverageComplete(plan({ outcome })).complete).toBe(false));

  it("rejects empty, unauthorized, zero-bound, incomplete manual, and parser-failed plans", () => {
    expect(coverageComplete(plan({}, { requiredFamilyIds: [], cells: [] })).error).toBe("UNSET_BLOCKING");
    expect(coverageComplete(plan({ authorizationState: "UNVERIFIED_DISABLED", authorizationEvidenceId: null })).error).toBe("AUTHORIZATION_ERROR");
    expect(coverageComplete(plan({ resultBound: 0 })).error).toBe("UNSET_BLOCKING");
    expect(coverageComplete(plan({ manualChecklistComplete: false })).complete).toBe(false);
    expect(coverageComplete(plan({ parserResult: "ERROR" })).complete).toBe(false);
    expect(coverageComplete(plan({ path: "AUTOMATED", authorizationState: "AUTHORIZED_AUTOMATED", configuredBoundSatisfied: false })).complete).toBe(false);
  });

  it("requires a typed machine-verifiable collision proof", () => {
    expect(coverageComplete(plan({}, { disposition: "NOT_REQUIRED_CONSTRAINT_COLLISION", collisionProof: null })).error).toBe("UNSUPPORTED_COLLISION_PROOF");
    expect(coverageComplete(plan({}, { disposition: "NOT_REQUIRED_CONSTRAINT_COLLISION", collisionProof: { kind: "TYPED_CONTRADICTION", inputHash: "prose", version: "collision-v1" } })).complete).toBe(false);
    expect(coverageComplete(plan({}, { disposition: "NOT_REQUIRED_CONSTRAINT_COLLISION", collisionProof: { kind: "TYPED_CONTRADICTION", inputHash: "b".repeat(64), version: "collision-v1" } })).complete).toBe(true);
  });

  it("derives exact LIKELY, LIMITED, and INFEASIBLE count boundaries", () => {
    const likely = assessFeasibility({ plan: plan(), inventory: Array.from({ length: 10 }, () => deliverable()), currentSnapshotId: "snapshot-v1", currentSnapshotHash: "a".repeat(64) });
    expect(likely).toMatchObject({ runState: "COMPLETE", outcome: "LIKELY", preliminarilyDeliverableCount: 10, reviewableCount: 0, checkoutEligible: true });
    const limited = assessFeasibility({ plan: plan(), inventory: [deliverable(), deliverable({ classification: "REVIEWABLE", resolutionBlocker: "NEEDS_HUMAN_REVIEW" })], currentSnapshotId: "snapshot-v1", currentSnapshotHash: "a".repeat(64) });
    expect(limited).toMatchObject({ outcome: "LIMITED", preliminarilyDeliverableCount: 1, reviewableCount: 1, excludedCount: 0, checkoutEligible: false });
    const infeasible = assessFeasibility({ plan: plan({ outcome: "SUCCEEDED_EMPTY", resultCount: 0 }), inventory: [], currentSnapshotId: "snapshot-v1", currentSnapshotHash: "a".repeat(64) });
    expect(infeasible).toMatchObject({ outcome: "INFEASIBLE", preliminarilyDeliverableCount: 0, reviewableCount: 0, excludedCount: 0 });
  });

  it("counts an allowed employer omission as deliverable and unresolved issues as reviewable", () => {
    const result = assessFeasibility({ plan: plan(), inventory: [deliverable(), deliverable({ classification: "REVIEWABLE", resolutionBlocker: "NEEDS_CANDIDATE_INPUT" })], currentSnapshotId: "snapshot-v1", currentSnapshotHash: "a".repeat(64) });
    expect(result).toMatchObject({ preliminarilyDeliverableCount: 1, reviewableCount: 1, checkoutEligible: false });
  });

  it("uses exact reason precedence and does not invent a salary reason without plausible jobs", () => {
    const result = assessFeasibility({ plan: plan(), inventory: [deliverable({ classification: "EXCLUDED", exclusionReason: "COMPENSATION_UNCONFIRMED" }), deliverable({ classification: "EXCLUDED", exclusionReason: "QUALIFICATION_GAP" })], currentSnapshotId: "snapshot-v1", currentSnapshotHash: "a".repeat(64) });
    expect(result.reasons).toEqual(["QUALIFICATION_GAP", "COMPENSATION_UNCONFIRMED", "INVENTORY_SHORTAGE"]); expect(result.primaryReason).toBe("QUALIFICATION_GAP");
    const noPlausible = assessFeasibility({ plan: plan(), inventory: [deliverable({ classification: "EXCLUDED" })], currentSnapshotId: "snapshot-v1", currentSnapshotHash: "a".repeat(64) });
    expect(noPlausible.reasons).toEqual(["INVENTORY_SHORTAGE"]);
  });

  it("marks snapshot mismatch stale and retrieval defects error, never infeasible", () => {
    expect(assessFeasibility({ plan: plan(), inventory: [], currentSnapshotId: "snapshot-v1", currentSnapshotHash: "b".repeat(64) }).runState).toBe("STALE");
    expect(assessFeasibility({ plan: plan({ outcome: "TIMEOUT" }), inventory: [], currentSnapshotId: "snapshot-v1", currentSnapshotHash: "a".repeat(64) }).runState).toBe("ERROR");
    expect(assessFeasibility({ plan: plan(), inventory: [], currentSnapshotId: "snapshot-v1", currentSnapshotHash: "a".repeat(64), expiresAt: "2026-09-04T00:00:00.000Z", now: "2026-09-05T00:00:00.000Z" }).runState).toBe("STALE");
  });

  it("uses respectful customer language and states rules were not lowered", () => {
    expect(customerFeasibilityMessage("INFEASIBLE", "COMPENSATION_BELOW_MINIMUM")).toContain("including your minimum compensation");
    expect(customerFeasibilityMessage("LIMITED", "EVIDENCE_GAP")).toContain("ApplyPack has not lowered any rule");
  });
});
import { randomUUID } from "node:crypto";

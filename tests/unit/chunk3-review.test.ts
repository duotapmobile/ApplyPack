import { describe, expect, it } from "vitest";
import { buildMatchingReviewDecision, matchingReviewRequestSchema } from "@/lib/matching/review";

const valid = { snapshotId: "53000000-0000-4000-8000-000000000001", jobSnapshotId: "83000000-0000-4000-8000-000000000001", reviewKind: "PARSER_CORRECTION", disposition: "RESOLVED_PASS", sourceEvidenceNodeIds: ["43000000-0000-4000-8000-000000000001"], candidateFactIds: [], evidenceChanges: ["Corrected the requirement classification from unclear to required."], rationale: "The cited listing sentence uses mandatory wording.", comparedTasks: ["prepare monthly report"] } as const;

describe("Chunk 3 protected review record", () => {
  it("requires typed disposition, source evidence, evidence changes, and rationale", () => {
    expect(matchingReviewRequestSchema.parse(valid)).toBeDefined();
    expect(matchingReviewRequestSchema.safeParse({ ...valid, sourceEvidenceNodeIds: [] }).success).toBe(false);
    expect(matchingReviewRequestSchema.safeParse({ ...valid, evidenceChanges: [] }).success).toBe(false);
    expect(matchingReviewRequestSchema.safeParse({ ...valid, humanApproved: true }).success).toBe(false);
  });

  it("builds deterministic evidence links with reviewer, time, and rules version", () => {
    const parsed = matchingReviewRequestSchema.parse({ ...valid, sourceEvidenceNodeIds: [valid.sourceEvidenceNodeIds[0], valid.sourceEvidenceNodeIds[0]] });
    expect(buildMatchingReviewDecision(parsed, "reviewer", "2026-09-05T00:00:00.000Z")).toEqual({ disposition: "RESOLVED_PASS", sourceEvidenceNodeIds: [valid.sourceEvidenceNodeIds[0]], candidateFactIds: [], evidenceChanges: valid.evidenceChanges, rulesVersion: "matching-rules-v2", reviewerId: "reviewer", resolvedAt: "2026-09-05T00:00:00.000Z" });
  });
});

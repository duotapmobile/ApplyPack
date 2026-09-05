import { z } from "zod";
import { MATCHING_RULES_VERSION } from "@/lib/matching/evaluation-engine";

const uuid = z.string().uuid();
export const matchingReviewRequestSchema = z.object({
  snapshotId: uuid,
  jobSnapshotId: uuid,
  reviewKind: z.enum(["PARSER_CORRECTION", "FEASIBILITY_EVIDENCE", "ADJACENT_EQUIVALENCE", "TOOL_EQUIVALENCE", "CATEGORICAL_USEFULNESS"]),
  disposition: z.enum(["RESOLVED_PASS", "RESOLVED_FAIL", "REQUIRES_MORE_EVIDENCE"]),
  sourceEvidenceNodeIds: z.array(uuid).min(1).max(100),
  candidateFactIds: z.array(uuid).max(100).default([]),
  evidenceChanges: z.array(z.string().trim().min(3).max(500)).min(1).max(50),
  rationale: z.string().trim().min(10).max(4000),
  comparedTasks: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
}).strict();

export type MatchingReviewRequest = z.infer<typeof matchingReviewRequestSchema>;

export function buildMatchingReviewDecision(input: MatchingReviewRequest, reviewerId: string, resolvedAt: string) {
  return {
    disposition: input.disposition,
    sourceEvidenceNodeIds: [...new Set(input.sourceEvidenceNodeIds)].sort(),
    candidateFactIds: [...new Set(input.candidateFactIds)].sort(),
    evidenceChanges: [...input.evidenceChanges],
    rulesVersion: MATCHING_RULES_VERSION,
    reviewerId,
    resolvedAt,
  };
}

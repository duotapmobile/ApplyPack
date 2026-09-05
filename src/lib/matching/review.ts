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
  stableCriterionId: uuid.optional(),
  taskSimilarity: z.enum(["STRONG", "PARTIAL", "NONE"]).optional(),
  complexity: z.string().trim().min(1).max(1000).optional(),
  autonomy: z.string().trim().min(1).max(1000).optional(),
  scope: z.string().trim().min(1).max(1000).optional(),
  domainContext: z.string().trim().min(1).max(1000).optional(),
  durationAndIntensity: z.object({
    calendarMonths: z.number().int().nonnegative(),
    fteLowerMonths: z.number().nonnegative(),
    fteUpperMonths: z.number().nonnegative(),
    basis: z.enum(["CALENDAR", "FTE", "EMPLOYER_EXPLICIT_OTHER"]),
  }).strict().optional(),
  essentialTools: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  candidateFactVersionIds: z.array(uuid).max(100).optional(),
  equivalentForCriterion: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  const adjacentFields = [value.stableCriterionId, value.taskSimilarity, value.complexity, value.autonomy, value.scope, value.domainContext, value.durationAndIntensity, value.essentialTools, value.candidateFactVersionIds, value.equivalentForCriterion];
  if (value.reviewKind === "ADJACENT_EQUIVALENCE") {
    if (!value.comparedTasks.length || value.taskSimilarity !== "STRONG" || !value.stableCriterionId || !value.complexity || !value.autonomy || !value.scope || !value.domainContext || !value.durationAndIntensity || !value.essentialTools?.length || !value.candidateFactVersionIds?.length || value.equivalentForCriterion !== true) {
      context.addIssue({ code: "custom", message: "Adjacent equivalence requires an exact criterion, strong task comparison, context, duration, tools, and fact versions." });
    }
    const facts = [...new Set(value.candidateFactIds)].sort();
    const versions = [...new Set(value.candidateFactVersionIds ?? [])].sort();
    if (facts.length !== versions.length || facts.some((id, index) => id !== versions[index])) context.addIssue({ code: "custom", message: "Adjacent equivalence must bind the same exact candidate fact versions." });
  } else if (adjacentFields.some((field) => field !== undefined)) {
    context.addIssue({ code: "custom", message: "Adjacent-equivalence fields are not valid for this review kind." });
  }
});

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
    ...(input.reviewKind === "ADJACENT_EQUIVALENCE" ? {
      stableCriterionId: input.stableCriterionId,
      taskSimilarity: input.taskSimilarity,
      complexity: input.complexity,
      autonomy: input.autonomy,
      scope: input.scope,
      domainContext: input.domainContext,
      durationAndIntensity: input.durationAndIntensity,
      essentialTools: input.essentialTools,
      candidateFactVersionIds: [...new Set(input.candidateFactVersionIds ?? [])].sort(),
      equivalentForCriterion: input.equivalentForCriterion,
    } : {}),
  };
}

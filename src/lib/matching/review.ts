import { z } from "zod";
import { MATCHING_RULES_VERSION } from "@/lib/matching/evaluation-engine";

const uuid = z.string().uuid();
const evidenceRelationSchema = z.enum(["DIRECT", "ADJACENT", "TRANSFERABLE", "UNSUPPORTED"]);
const explanationEvidenceSchema = z.object({
  whatJobInvolves: z.object({ sourceEvidenceNodeIds: z.array(uuid).min(1).max(100), candidateFactIds: z.array(uuid).max(100).default([]) }).strict(),
  whyMadeList: z.object({ sourceEvidenceNodeIds: z.array(uuid).min(1).max(100), candidateFactIds: z.array(uuid).min(1).max(100) }).strict(),
  howExperienceConnects: z.object({ sourceEvidenceNodeIds: z.array(uuid).min(1).max(100), candidateFactIds: z.array(uuid).min(1).max(100) }).strict(),
  whatMayBeNew: z.object({ sourceEvidenceNodeIds: z.array(uuid).min(1).max(100), candidateFactIds: z.array(uuid).max(100).default([]) }).strict(),
  whatToKnow: z.object({ sourceEvidenceNodeIds: z.array(uuid).min(1).max(100), candidateFactIds: z.array(uuid).max(100).default([]) }).strict(),
}).strict();

export const matchingReviewRequestSchema = z.object({
  snapshotId: uuid,
  jobSnapshotId: uuid,
  reviewKind: z.enum(["PARSER_CORRECTION", "FEASIBILITY_EVIDENCE", "ADJACENT_EQUIVALENCE", "TOOL_EQUIVALENCE", "MATCH_EVIDENCE", "CATEGORICAL_USEFULNESS", "COMPENSATION_COMPARABILITY"]),
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
  evidenceRelation: evidenceRelationSchema.optional(),
  adjacentEquivalenceReviewId: uuid.optional(),
  explanationEvidence: explanationEvidenceSchema.optional(),
  applicationReadiness: z.enum(["READY", "NEEDS_CUSTOMER_ACTION", "BLOCKED"]).optional(),
  presentationRisk: z.enum(["LOW", "MEDIUM", "HIGH", "NOT_ASSESSED"]).optional(),
  presentationRiskReasons: z.array(z.enum(["CONTACT_DETAIL_CONFIRMATION", "FORMAT_REPAIR", "CLAIM_WORDING_REVIEW", "APPLICATION_QUESTION_REVIEW"])).max(4).optional(),
  reviewerWorthwhileReason: z.string().trim().min(10).max(2000).optional(),
  certifiedNotQuotaFiller: z.literal(true).optional(),
  correctLocationRange: z.boolean().optional(),
  workerBasisComparable: z.boolean().optional(),
  conversion: z.object({ hoursPerWeek: z.number().positive(), weeksPerYear: z.number().positive(), version: z.string().trim().min(1).max(100) }).strict().optional(),
}).strict().superRefine((value, context) => {
  const adjacentFields = [value.stableCriterionId, value.taskSimilarity, value.complexity, value.autonomy, value.scope, value.domainContext, value.durationAndIntensity, value.essentialTools, value.candidateFactVersionIds, value.equivalentForCriterion];
  if (value.reviewKind === "ADJACENT_EQUIVALENCE") {
    if (!value.comparedTasks.length || value.taskSimilarity !== "STRONG" || !value.stableCriterionId || !value.complexity || !value.autonomy || !value.scope || !value.domainContext || !value.durationAndIntensity || !value.essentialTools?.length || !value.candidateFactVersionIds?.length || value.equivalentForCriterion !== true) {
      context.addIssue({ code: "custom", message: "Adjacent equivalence requires an exact criterion, strong task comparison, context, duration, tools, and fact versions." });
    }
    const facts = [...new Set(value.candidateFactIds)].sort();
    const versions = [...new Set(value.candidateFactVersionIds ?? [])].sort();
    if (facts.length !== versions.length || facts.some((id, index) => id !== versions[index])) context.addIssue({ code: "custom", message: "Adjacent equivalence must bind the same exact candidate fact versions." });
  } else if (value.reviewKind === "MATCH_EVIDENCE") {
    if (!value.stableCriterionId || !value.candidateFactIds.length || value.disposition === "RESOLVED_PASS" && (!value.evidenceRelation || value.evidenceRelation === "UNSUPPORTED")) {
      context.addIssue({ code: "custom", message: "Match evidence must bind an exact criterion, candidate fact versions, and a supported evidence relation." });
    }
    const facts = [...new Set(value.candidateFactIds)].sort();
    const versions = [...new Set(value.candidateFactVersionIds ?? [])].sort();
    if (facts.length !== versions.length || facts.some((id, index) => id !== versions[index])) context.addIssue({ code: "custom", message: "Match evidence must bind the same exact candidate fact versions." });
    if (value.evidenceRelation === "ADJACENT" && !value.adjacentEquivalenceReviewId) context.addIssue({ code: "custom", message: "Adjacent match evidence requires its exact equivalence review." });
  } else if (value.reviewKind === "CATEGORICAL_USEFULNESS") {
    if (!value.candidateFactIds.length || !value.explanationEvidence || !value.applicationReadiness || !value.presentationRisk || !value.presentationRiskReasons || !value.reviewerWorthwhileReason || value.certifiedNotQuotaFiller !== true) {
      context.addIssue({ code: "custom", message: "Categorical usefulness requires five evidence-backed explanation sections, readiness, presentation review, and the no-padding certification." });
    } else {
      const allowedNodes = new Set(value.sourceEvidenceNodeIds);
      const allowedFacts = new Set(value.candidateFactIds);
      for (const section of Object.values(value.explanationEvidence)) {
        if (section.sourceEvidenceNodeIds.some((id) => !allowedNodes.has(id)) || section.candidateFactIds.some((id) => !allowedFacts.has(id))) {
          context.addIssue({ code: "custom", message: "Explanation evidence must be a subset of the exact reviewed node and fact versions." });
          break;
        }
      }
    }
  } else if (value.reviewKind === "COMPENSATION_COMPARABILITY") {
    if (value.correctLocationRange === undefined || value.workerBasisComparable === undefined) context.addIssue({ code: "custom", message: "Compensation comparability requires explicit location-range and worker-basis findings." });
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
    ...(input.reviewKind === "MATCH_EVIDENCE" ? {
      stableCriterionId: input.stableCriterionId,
      candidateFactVersionIds: [...new Set(input.candidateFactVersionIds ?? [])].sort(),
      evidenceRelation: input.evidenceRelation,
      adjacentEquivalenceReviewId: input.adjacentEquivalenceReviewId ?? null,
    } : {}),
    ...(input.reviewKind === "CATEGORICAL_USEFULNESS" ? {
      explanationEvidence: input.explanationEvidence,
      applicationReadiness: input.applicationReadiness,
      presentationRisk: input.presentationRisk,
      presentationRiskReasons: input.presentationRiskReasons,
      reviewerWorthwhileReason: input.reviewerWorthwhileReason,
      certifiedNotQuotaFiller: input.certifiedNotQuotaFiller,
    } : {}),
    ...(input.reviewKind === "COMPENSATION_COMPARABILITY" ? {
      correctLocationRange: input.correctLocationRange,
      workerBasisComparable: input.workerBasisComparable,
      conversion: input.conversion ?? null,
    } : {}),
  };
}

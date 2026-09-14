import { z } from "zod";
import {
  applicationReadinesses,
  componentApplicabilities,
  criterionResults,
  eligibilityDispositions,
  evidenceRelations,
  jobOrigins,
  presentationRisks,
  requirementNodeSchema,
  resolutionIssues,
  salaryGateDispositions,
  salaryStatuses,
  unknownTreatments,
} from "./foundation";

const boundedString = z.string().trim().min(1).max(1_000);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const httpsUrl = z.string().url().regex(/^https:\/\//u);
const utcTimestamp = z.string().datetime().regex(/Z$/u);

export const applicationHostTypes = ["EMPLOYER_HOSTED", "APPROVED_THIRD_PARTY"] as const;

export const jobSnapshotProvenanceSchema = z.object({
  id: z.string().uuid(),
  discoverySource: boundedString,
  origin: z.enum(jobOrigins),
  externalJobId: boundedString.nullable(),
  canonicalApplicationUrl: httpsUrl,
  applicationHostType: z.enum(applicationHostTypes),
  canonicalEmployerListingUrl: httpsUrl.nullable(),
  sourceUrl: httpsUrl,
  company: boundedString,
  exactTitle: boundedString,
  normalizedFingerprint: sha256,
  capturedListing: z.union([z.string().min(1), z.record(z.string(), z.unknown())]),
  retrievedAt: utcTimestamp,
  postedOn: z.string().date().nullable(),
  postedDateUnknown: z.boolean(),
  liveVerifiedAt: utcTimestamp,
  compensationText: z.string().nullable(),
  compensationSource: z.string().nullable(),
  locationAndWorkMode: z.record(z.string(), z.unknown()),
  requirementTree: requirementNodeSchema,
  parserVersion: boundedString,
  contentSha256: sha256,
}).strict().superRefine((snapshot, context) => {
  if ((snapshot.postedOn === null) !== snapshot.postedDateUnknown) {
    context.addIssue({ code: "custom", message: "posted date and unknown marker conflict" });
  }
});

export const satisfactionPathSchema = z.object({
  requirementNodeId: z.string().uuid(),
  selectedChildNodeIds: z.array(z.string().uuid()).min(1),
  candidateFactIds: z.array(z.string().uuid()),
  jobEvidenceIds: z.array(z.string().uuid()).min(1),
  relation: z.enum(evidenceRelations),
  adjacentEquivalenceReviewId: z.string().uuid().nullable(),
}).strict();

export const criterionLeafResultSchema = z.object({
  requirementNodeId: z.string().uuid(),
  result: z.enum(criterionResults),
  resolutionIssue: z.enum(resolutionIssues),
  unknownTreatment: z.enum(unknownTreatments),
  satisfactionPath: satisfactionPathSchema.nullable(),
}).strict();

export const adjacentEquivalenceReviewSchema = z.object({
  id: z.string().uuid(),
  candidateTask: boundedString,
  employerTask: boundedString,
  taskSimilarityRating: z.number().min(0).max(1),
  complexity: boundedString,
  autonomy: boundedString,
  scope: boundedString,
  domainContext: boundedString,
  durationMonths: z.number().int().nonnegative().nullable(),
  intensityPercent: z.number().min(0).max(100).nullable(),
  essentialTools: z.array(boundedString),
  relation: z.literal("ADJACENT"),
  strongEquivalent: z.boolean(),
  rationale: boundedString,
  reviewerId: z.string().uuid(),
  reviewedAt: utcTimestamp,
  catalogVersion: boundedString,
}).strict();

export const fitComponentNames = [
  "CORE_RESPONSIBILITY_ALIGNMENT",
  "REQUIRED_TOOL_TECHNICAL_ALIGNMENT",
  "RELEVANT_EXPERIENCE_DEPTH_SCOPE",
  "EDUCATION_CERTIFICATION_ALIGNMENT",
  "CURRENT_READINESS",
] as const;

const fitBaseWeights: Record<(typeof fitComponentNames)[number], number> = {
  CORE_RESPONSIBILITY_ALIGNMENT: 35,
  REQUIRED_TOOL_TECHNICAL_ALIGNMENT: 25,
  RELEVANT_EXPERIENCE_DEPTH_SCOPE: 20,
  EDUCATION_CERTIFICATION_ALIGNMENT: 10,
  CURRENT_READINESS: 10,
};

export const fitComponentSchema = z.object({
  name: z.enum(fitComponentNames),
  applicability: z.enum(componentApplicabilities),
  baseWeight: z.number().int().positive(),
  coverage: z.number().min(0).max(1).nullable(),
  numerator: z.number().nonnegative().nullable(),
  denominator: z.number().positive().nullable(),
  contributions: z.array(z.object({
    criterionId: z.string().uuid(),
    importance: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    evidenceRelation: z.enum(evidenceRelations),
    evidenceFactor: z.number().min(0).max(1),
    capabilityOrDepthFactor: z.number().min(0).max(1).nullable(),
  }).strict()),
}).strict().superRefine((component, context) => {
  if (component.baseWeight !== fitBaseWeights[component.name]) {
    context.addIssue({ code: "custom", message: "fit component weight conflicts with the contract" });
  }
  const applicable = component.applicability === "APPLICABLE";
  if (applicable !== (component.coverage !== null && component.numerator !== null && component.denominator !== null)) {
    context.addIssue({ code: "custom", message: "fit component applicability fields conflict" });
  }
});

export const confidenceComponentsSchema = z.object({
  candidateCompleteness: z.number().min(0).max(1),
  employerCompleteness: z.number().min(0).max(1),
  sourceQuality: z.number().min(0).max(1),
  parserCertainty: z.number().min(0).max(1),
  score: z.number().min(0).max(100),
}).strict().superRefine((components, context) => {
  const expected = 40 * components.candidateCompleteness
    + 25 * components.employerCompleteness
    + 20 * components.sourceQuality
    + 15 * components.parserCertainty;
  if (Math.abs(expected - components.score) > 1e-9) {
    context.addIssue({ code: "custom", message: "confidence score conflicts with its components" });
  }
});

export const softPreferenceAlignmentSchema = z.object({
  selectedCount: z.number().int().nonnegative(),
  score: z.number().min(0).max(1).nullable(),
  components: z.array(z.object({
    preferenceId: z.string().uuid(),
    kind: z.enum(["DESIRED_RESPONSIBILITY", "TITLE", "INDUSTRY", "TARGET_COMPENSATION", "WORK_MODE_TYPE", "BENEFIT_SCHEDULE", "SOFT_AVOIDANCE"]),
    disposition: z.enum(["SUPPORTED", "ALLOWED_EMPLOYER_UNKNOWN", "UNMET"]),
    value: z.union([z.literal(0), z.literal(0.5), z.literal(0.75), z.literal(1)]),
    warningCode: boundedString.nullable(),
  }).strict()),
}).strict().superRefine((preferences, context) => {
  if ((preferences.selectedCount === 0) !== (preferences.score === null)
    || preferences.components.length !== preferences.selectedCount) {
    context.addIssue({ code: "custom", message: "soft preference aggregate is inconsistent" });
  }
});

export const presentationRiskReasonSchema = z.object({
  code: boundedString,
  allowlistVersion: boundedString,
  approved: z.literal(true),
  evidenceIds: z.array(z.string().uuid()),
}).strict();

export const customerWarningSchema = z.object({
  code: boundedString,
  messageKey: boundedString,
  evidenceIds: z.array(z.string().uuid()),
}).strict();

export const jobEvidenceSchema = z.object({
  id: z.string().uuid(),
  jobSnapshotId: z.string().uuid(),
  field: boundedString,
  sourceLocator: boundedString,
  contentSha256: sha256,
}).strict();

export const evaluationVersionBundleSchema = z.object({
  matching: boundedString,
  parser: boundedString,
  catalog: boundedString,
  criteria: boundedString,
  selector: boundedString,
  jobSnapshot: sha256,
}).strict();

export const humanReviewRecordSchema = z.object({
  id: z.string().uuid(),
  reviewerId: z.string().uuid(),
  reviewedAt: utcTimestamp,
  disposition: z.enum(["APPROVED", "REJECTED", "NEEDS_RESOLUTION"]),
  rulesVersions: z.record(z.string(), boundedString),
  evidenceChanges: z.array(z.object({ evidenceId: z.string().uuid(), action: z.enum(["ADDED", "REMOVED", "CORRECTED"]), reason: boundedString }).strict()),
  reason: boundedString,
  adjacentEquivalence: adjacentEquivalenceReviewSchema.nullable(),
}).strict();

export const matchEvaluationSchema = z.object({
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
  jobSnapshotId: z.string().uuid(),
  eligibility: z.enum(eligibilityDispositions),
  rootResult: z.enum(criterionResults),
  leafResults: z.array(criterionLeafResultSchema).min(1),
  categoricalEvidenceSufficient: z.boolean(),
  usefulnessRationale: boundedString,
  fitScore: z.number().min(0).max(100).nullable(),
  fitComponents: z.array(fitComponentSchema).length(5),
  evidenceConfidence: z.number().min(0).max(100),
  confidenceComponents: confidenceComponentsSchema,
  salaryStatus: z.enum(salaryStatuses),
  salaryDisposition: z.enum(salaryGateDispositions),
  softPreferences: softPreferenceAlignmentSchema,
  applicationReadiness: z.enum(applicationReadinesses),
  presentationRisk: z.enum(presentationRisks),
  presentationRiskReasons: z.array(presentationRiskReasonSchema),
  warnings: z.array(customerWarningSchema),
  candidateFactIds: z.array(z.string().uuid()),
  jobEvidence: z.array(jobEvidenceSchema),
  versionBundle: evaluationVersionBundleSchema,
  humanReview: humanReviewRecordSchema.nullable(),
}).strict().superRefine((evaluation, context) => {
  if (new Set(evaluation.fitComponents.map(({ name }) => name)).size !== fitComponentNames.length) {
    context.addIssue({ code: "custom", message: "every fit component must appear exactly once" });
  }
  if (Math.abs(evaluation.evidenceConfidence - evaluation.confidenceComponents.score) > 1e-9) {
    context.addIssue({ code: "custom", message: "evidence confidence conflicts with its components" });
  }
});

export type JobSnapshotProvenance = z.infer<typeof jobSnapshotProvenanceSchema>;
export type MatchEvaluation = z.infer<typeof matchEvaluationSchema>;
export type HumanReviewRecord = z.infer<typeof humanReviewRecordSchema>;

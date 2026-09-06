import type { CriterionResult, EligibilityDisposition, EmployerUnknownPolicy, ResolutionIssue, SalaryGateDisposition, SalaryStatus, UnknownTreatment } from "@/lib/domain/foundation";
import { isLiveopsReference } from "@/lib/jobs/canonicalize";

export const MATCHING_RULES_VERSION = "matching-rules-v3";
export const SALARY_RULES_VERSION = "salary-rules-v1";
export const SELECTOR_VERSION = "bounded-diversity-v2";

export type GateResult = { rootKey: string; result: CriterionResult; resolutionIssue: ResolutionIssue; unknownTreatment: UnknownTreatment; warning?: string; consentVersion?: string; unwaivable?: boolean };

export function mapEmployerUnknownPolicy(rootKey: string, policy: EmployerUnknownPolicy, input: { consentVersion?: string; warning?: string; unwaivable?: boolean } = {}): GateResult {
  const allowed = policy === "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" && !input.unwaivable;
  if (allowed && (!input.consentVersion || !input.warning)) throw new Error("allowed_employer_unknown_requires_consent_warning");
  return { rootKey, result: "UNKNOWN", resolutionIssue: "EMPLOYER_OMITTED", unknownTreatment: allowed ? "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" : "BLOCK", consentVersion: allowed ? input.consentVersion : undefined, warning: allowed ? input.warning : undefined, unwaivable: input.unwaivable };
}

export function candidateUnknownGate(rootKey: string, question: { prompt: string; promptVersion: string }) {
  if (!question.prompt.trim() || !question.promptVersion.trim()) throw new Error("targeted_question_required");
  return { gate: { rootKey, result: "UNKNOWN", resolutionIssue: "CANDIDATE_MISSING", unknownTreatment: "BLOCK" } satisfies GateResult, question: { stableRootKey: rootKey, ...question } };
}

export function applyHumanEvidenceResolution(gate: GateResult, resolution: { result: "PASS" | "FAIL"; reviewerId: string; resolvedAt: string; rulesVersion: string; evidenceIds: readonly string[]; evidenceChanges: readonly string[]; rationale: string }): GateResult {
  if (gate.result === "FAIL") throw new Error("reviewer_cannot_override_hard_failure");
  if (gate.result !== "UNKNOWN" || !["PARSER_UNCERTAIN", "EVIDENCE_CONFLICT"].includes(gate.resolutionIssue)) throw new Error("human_resolution_not_applicable");
  if (!resolution.reviewerId || !resolution.resolvedAt || !resolution.rulesVersion || !resolution.evidenceIds.length || !resolution.evidenceChanges.length || !resolution.rationale.trim()) throw new Error("human_resolution_evidence_required");
  return { rootKey: gate.rootKey, result: resolution.result, resolutionIssue: "NONE", unknownTreatment: "BLOCK", warning: gate.warning };
}

export function deriveEligibility(expectedRootKeys: readonly string[], results: readonly GateResult[]): { disposition: EligibilityDisposition; warnings: string[] } {
  const expected = [...new Set(expectedRootKeys)].sort();
  const actual = [...new Set(results.map((r) => r.rootKey))].sort();
  if (!expected.length || expected.length !== expectedRootKeys.length || actual.length !== results.length || expected.join("|") !== actual.join("|")) return { disposition: "INVALID", warnings: [] };
  if (results.some((r) => r.result === "FAIL")) return { disposition: "INELIGIBLE", warnings: [] };
  const unknown = results.filter((r) => r.result === "UNKNOWN");
  if (unknown.some((r) => r.resolutionIssue === "CANDIDATE_MISSING")) return { disposition: "NEEDS_CANDIDATE_INPUT", warnings: [] };
  if (unknown.some((r) => r.unwaivable || r.resolutionIssue === "PARSER_UNCERTAIN" || r.resolutionIssue === "EVIDENCE_CONFLICT")) return { disposition: "NEEDS_HUMAN_REVIEW", warnings: [] };
  if (unknown.some((r) => r.resolutionIssue !== "EMPLOYER_OMITTED" || r.unknownTreatment !== "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" || !r.consentVersion || !r.warning)) return { disposition: "INELIGIBLE", warnings: [] };
  if (unknown.length) return { disposition: "ELIGIBLE_WITH_ALLOWED_UNKNOWNS", warnings: unknown.map((r) => r.warning!) };
  return { disposition: "ELIGIBLE", warnings: [] };
}

export type SalaryInput = {
  hardMinimumCents: number | null;
  flexibleMinimum: boolean;
  minimumPeriod: "HOUR" | "YEAR" | null;
  minimumBasis: "BASE" | "GUARANTEED_TOTAL" | null;
  publishedByEmployer: boolean;
  estimateOnly: boolean;
  currency: string | null;
  period: "HOUR" | "YEAR" | null;
  basis: "BASE" | "GUARANTEED_TOTAL" | "VARIABLE_OTE" | null;
  lowerCents: number | null;
  upperCents: number | null;
  endpointMeaning?: "RANGE" | "STARTING_AT" | "UP_TO" | "FIXED";
  correctLocationRange: boolean;
  workerBasisComparable: boolean;
  variableMaterial: boolean;
  variableAccepted: boolean;
  includeOverlap: boolean;
  includeUnpublished: boolean;
  includeNoncomparableUsd: boolean;
  conversion?: { hoursPerWeek: number; weeksPerYear: number; version: string; accepted: boolean } | null;
};

export function evaluateSalary(input: SalaryInput): { status: SalaryStatus; disposition: SalaryGateDisposition; warning: string | null; comparedLowerCents: number | null; comparedUpperCents: number | null; conversionVersion: string | null } {
  if ([input.lowerCents, input.upperCents].some((value) => value != null && (!Number.isInteger(value) || value < 0))) throw new Error("invalid_salary_amount");
  if (input.lowerCents != null && input.upperCents != null && input.lowerCents > input.upperCents) throw new Error("reversed_salary_range");
  const hasHardGate = input.hardMinimumCents != null && !input.flexibleMinimum;
  if (hasHardGate && (!Number.isInteger(input.hardMinimumCents) || input.hardMinimumCents! < 0 || !input.minimumPeriod || !input.minimumBasis)) throw new Error("invalid_salary_minimum");
  const allowedUnknown = (status: SalaryStatus, policy: boolean, warning: string) => ({ status, disposition: policy ? "ALLOWED_WITH_WARNING" as const : "FAIL" as const, warning: policy ? warning : null, comparedLowerCents: null, comparedUpperCents: null, conversionVersion: null });
  const employerPublishedAmount = input.publishedByEmployer && (input.lowerCents != null || input.upperCents != null);
  if ((employerPublishedAmount || input.estimateOnly) && input.currency != null && input.currency !== "USD") return { status: "PUBLISHED_NONCOMPARABLE", disposition: "FAIL", warning: null, comparedLowerCents: null, comparedUpperCents: null, conversionVersion: null };
  if (!hasHardGate) {
    if (input.estimateOnly) return { status: "ESTIMATE_ONLY", disposition: "NOT_APPLICABLE", warning: null, comparedLowerCents: null, comparedUpperCents: null, conversionVersion: null };
    if (!employerPublishedAmount) return { status: "UNPUBLISHED", disposition: "NOT_APPLICABLE", warning: null, comparedLowerCents: null, comparedUpperCents: null, conversionVersion: null };
    return { status: "PUBLISHED_NONCOMPARABLE", disposition: "NOT_APPLICABLE", warning: null, comparedLowerCents: input.lowerCents, comparedUpperCents: input.upperCents, conversionVersion: null };
  }
  if (input.estimateOnly) return allowedUnknown("ESTIMATE_ONLY", input.includeUnpublished, "Pay is a third-party estimate, not employer-confirmed compensation.");
  if (!input.publishedByEmployer || (input.lowerCents == null && input.upperCents == null)) return allowedUnknown("UNPUBLISHED", input.includeUnpublished, "The employer did not publish compensation.");
  if (input.currency !== "USD") return { status: "PUBLISHED_NONCOMPARABLE", disposition: "FAIL", warning: null, comparedLowerCents: null, comparedUpperCents: null, conversionVersion: null };
  if (!input.period || !input.basis) return allowedUnknown("PUBLISHED_NONCOMPARABLE", input.includeNoncomparableUsd, "Published USD compensation was missing a comparable period or basis.");
  if (!input.correctLocationRange || !input.workerBasisComparable || input.basis === "VARIABLE_OTE" || (input.minimumBasis === "BASE" && input.basis !== "BASE") || (input.minimumBasis === "GUARANTEED_TOTAL" && !["BASE", "GUARANTEED_TOTAL"].includes(input.basis ?? ""))) {
    return allowedUnknown("PUBLISHED_NONCOMPARABLE", input.includeNoncomparableUsd, "Published USD compensation could not be compared like for like.");
  }
  if (input.variableMaterial && !input.variableAccepted) return { status: "PUBLISHED_NONCOMPARABLE", disposition: "FAIL", warning: null, comparedLowerCents: null, comparedUpperCents: null, conversionVersion: null };
  let lower = input.lowerCents, upper = input.upperCents;
  let conversionVersion: string | null = null;
  if (input.period !== input.minimumPeriod) {
    const conversion = input.conversion;
    if (!conversion?.accepted || !conversion.version || !(conversion.hoursPerWeek > 0) || !(conversion.weeksPerYear > 0)) return allowedUnknown("PUBLISHED_NONCOMPARABLE", input.includeNoncomparableUsd, "A supported work schedule was not available for pay conversion.");
    const multiplier = conversion.hoursPerWeek * conversion.weeksPerYear;
    if (input.period === "HOUR" && input.minimumPeriod === "YEAR") { lower = lower == null ? null : Math.round(lower * multiplier); upper = upper == null ? null : Math.round(upper * multiplier); }
    else { lower = lower == null ? null : Math.round(lower / multiplier); upper = upper == null ? null : Math.round(upper / multiplier); }
    conversionVersion = conversion.version;
  }
  if (input.endpointMeaning === "STARTING_AT") upper = null;
  if (input.endpointMeaning === "FIXED") { lower = lower ?? upper; upper = lower; }
  if (input.endpointMeaning === "UP_TO") {
    upper = upper ?? lower;
    lower = null;
    if (upper != null && upper < input.hardMinimumCents!) return { status: "PUBLISHED_BELOW_MINIMUM", disposition: "FAIL", warning: null, comparedLowerCents: null, comparedUpperCents: upper, conversionVersion };
    return allowedUnknown("PUBLISHED_NONCOMPARABLE", input.includeNoncomparableUsd, "The employer published only a maximum, so no guaranteed floor could be confirmed.");
  }
  if (lower != null && lower >= input.hardMinimumCents!) return { status: "PUBLISHED_MEETS_MINIMUM", disposition: "PASS", warning: input.variableMaterial ? "Published pay includes a material variable component you accepted." : null, comparedLowerCents: lower, comparedUpperCents: upper, conversionVersion };
  if (upper != null && upper < input.hardMinimumCents!) return { status: "PUBLISHED_BELOW_MINIMUM", disposition: "FAIL", warning: null, comparedLowerCents: lower, comparedUpperCents: upper, conversionVersion };
  if (upper != null && upper >= input.hardMinimumCents!) return { status: "PUBLISHED_OVERLAPS_MINIMUM", disposition: input.includeOverlap ? "ALLOWED_WITH_WARNING" : "FAIL", warning: input.includeOverlap ? "The published range starts below your minimum but reaches it." : null, comparedLowerCents: lower, comparedUpperCents: upper, conversionVersion };
  return allowedUnknown("PUBLISHED_NONCOMPARABLE", input.includeNoncomparableUsd, "The employer did not publish a comparable upper bound.");
}

export const fitWeights = { CORE_RESPONSIBILITY_ALIGNMENT: 35, REQUIRED_TOOL_TECHNICAL_ALIGNMENT: 25, RELEVANT_EXPERIENCE_DEPTH_SCOPE: 20, EDUCATION_CERTIFICATION_ALIGNMENT: 10, CURRENT_READINESS: 10 } as const;
export type FitComponentName = keyof typeof fitWeights;
export type FitCriterion = { criterionId: string; importance: 1 | 2 | 3; evidenceFactor: number; capabilityOrDepthFactor?: number | null; evidenceIds: string[] };
export type FitComponentInput = { name: FitComponentName; applicable: boolean; criteria: FitCriterion[] };

export function evidenceFactorForRelation(relation: "DIRECT" | "ADJACENT" | "TRANSFERABLE" | "UNSUPPORTED", hardCriterion: boolean) {
  return relation === "DIRECT" ? 1 : relation === "ADJACENT" ? 0.8 : relation === "TRANSFERABLE" && !hardCriterion ? 0.5 : 0;
}

export function experienceDepthFactor(input: { conservativeVerifiedMonths: number | null; employerTargetMonths: number | null; statedScopeConfirmed: boolean }) {
  if (input.employerTargetMonths == null) return input.statedScopeConfirmed ? 1 : 0;
  if (!(input.employerTargetMonths > 0) || input.conservativeVerifiedMonths == null || input.conservativeVerifiedMonths < 0) return 0;
  return Math.min(input.conservativeVerifiedMonths / input.employerTargetMonths, 1);
}

export function educationAlignmentFactor(input: { strength: "REQUIRED" | "PREFERRED"; passed: boolean; exact: boolean; approvedRelated: boolean }) {
  if (!input.passed) return 0;
  if (input.exact) return 1;
  if (input.approvedRelated) return input.strength === "REQUIRED" ? 1 : 0.8;
  return 0;
}

export function readinessCapabilityFactor(status: "CAN_DO_NOW" | "DONE_BEFORE_NEEDS_REFRESHER" | "BASIC_EXPOSURE" | "NOT_DONE" | "UNSURE") {
  return { CAN_DO_NOW: 1, DONE_BEFORE_NEEDS_REFRESHER: 0.6, BASIC_EXPOSURE: 0.25, NOT_DONE: 0, UNSURE: 0 }[status];
}

export function calculateFit(disposition: EligibilityDisposition, categoricalEvidenceSufficient: boolean, components: readonly FitComponentInput[]) {
  if (!["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"].includes(disposition) || !categoricalEvidenceSufficient) return { score: null, components: [] };
  if (components.length !== 5 || new Set(components.map((c) => c.name)).size !== 5) throw new Error("invalid_fit_component_set");
  let weighted = 0, applicableWeight = 0;
  const details = components.map((component) => {
    if (!component.applicable) { if (component.criteria.length) throw new Error("not_applicable_component_has_criteria"); return { name: component.name, coverage: null }; }
    if (!component.criteria.length) throw new Error("empty_fit_denominator");
    const seen = new Set<string>(); let numerator = 0, denominator = 0;
    for (const criterion of component.criteria) {
      if (seen.has(criterion.criterionId)) throw new Error("duplicate_fit_criterion"); seen.add(criterion.criterionId);
      if (!criterion.evidenceIds.length) throw new Error("fit_evidence_missing");
      const factor = criterion.evidenceFactor * (criterion.capabilityOrDepthFactor ?? 1);
      if (![criterion.evidenceFactor, factor].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error("invalid_fit_factor");
      numerator += criterion.importance * factor; denominator += criterion.importance;
    }
    const coverage = numerator / denominator; weighted += fitWeights[component.name] * coverage; applicableWeight += fitWeights[component.name];
    return { name: component.name, coverage };
  });
  if (applicableWeight === 0) return { score: null, components: details, uncomputableReason: "NO_APPLICABLE_COMPONENTS" as const };
  const score = 100 * weighted / applicableWeight;
  if (!Number.isFinite(score)) throw new Error("invalid_fit_result");
  return { score, components: details, uncomputableReason: null };
}

export type PreferenceComponent = { preferenceId: string; value: 0 | 0.5 | 0.75 | 1 };
export function calculatePreferenceAlignment(components: readonly PreferenceComponent[]) {
  if (!components.length) return null;
  if (new Set(components.map((c) => c.preferenceId)).size !== components.length) throw new Error("duplicate_preference");
  return components.reduce((sum, item) => sum + item.value, 0) / components.length;
}

export function targetCompensationPreference(input: { targetCents: number | null; publishedComparable: boolean; employerConfirmed: boolean; lowerCents: number | null; upperCents: number | null; hardFloorCents: number | null; allowedUnknown: boolean }) {
  if (input.targetCents == null) return null;
  if (input.publishedComparable && input.employerConfirmed && input.lowerCents != null && input.lowerCents >= input.targetCents) return 1 as const;
  if (input.publishedComparable && input.employerConfirmed && input.upperCents != null && input.upperCents >= input.targetCents) return 0.75 as const;
  if (input.publishedComparable && input.employerConfirmed && input.hardFloorCents != null && input.lowerCents != null && input.lowerCents >= input.hardFloorCents) return 0.5 as const;
  if (input.allowedUnknown) return 0.5 as const;
  return 0 as const;
}

export type ApplicationReadiness = "READY" | "NEEDS_CUSTOMER_ACTION" | "BLOCKED";
export type PresentationRiskReason = "CONTACT_DETAIL_CONFIRMATION" | "FORMAT_REPAIR" | "CLAIM_WORDING_REVIEW" | "APPLICATION_QUESTION_REVIEW";
export const presentationRiskReasons: readonly PresentationRiskReason[] = ["CONTACT_DETAIL_CONFIRMATION", "FORMAT_REPAIR", "CLAIM_WORDING_REVIEW", "APPLICATION_QUESTION_REVIEW"];

export function evaluateUsefulnessGate(input: { disposition: EligibilityDisposition; employerCoreResponsibilityCount: number; confirmedDirectCoreConnections: number; reviewedAdjacentCoreConnections: number; explanationSectionEvidenceCounts: readonly number[]; readiness: ApplicationReadiness; reviewerWorthwhileReason?: string | null; certifiedNotQuotaFiller: boolean }) {
  if (!["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"].includes(input.disposition)) return { evidenceSufficient: false, reason: "INELIGIBLE" as const };
  if (input.employerCoreResponsibilityCount < 1) return { evidenceSufficient: false, reason: "CORE_RESPONSIBILITY_MISSING" as const };
  if (input.confirmedDirectCoreConnections + input.reviewedAdjacentCoreConnections < 1) return { evidenceSufficient: false, reason: "CORE_CONNECTION_MISSING" as const };
  if (input.explanationSectionEvidenceCounts.length !== 5 || input.explanationSectionEvidenceCounts.some((count) => !Number.isInteger(count) || count < 1)) return { evidenceSufficient: false, reason: "EXPLANATION_EVIDENCE_MISSING" as const };
  if (input.readiness === "BLOCKED") return { evidenceSufficient: false, reason: "READINESS_BLOCKED" as const };
  if (!input.reviewerWorthwhileReason?.trim() || !input.certifiedNotQuotaFiller) return { evidenceSufficient: false, reason: "HUMAN_REVIEW_REQUIRED" as const };
  return { evidenceSufficient: true, reason: null };
}

export function calculateConfidence(input: { candidateCompleteness: number; employerCompleteness: number; materialSourceQualities: readonly number[]; parserCertainty: number }) {
  const values = [input.candidateCompleteness, input.employerCompleteness, input.parserCertainty, ...input.materialSourceQualities];
  if (!input.materialSourceQualities.length || values.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error("invalid_confidence_inputs");
  const sourceQuality = Math.min(...input.materialSourceQualities);
  const score = 40 * input.candidateCompleteness + 25 * input.employerCompleteness + 20 * sourceQuality + 15 * input.parserCertainty;
  return { score, label: score >= 80 ? "HIGH" as const : score >= 60 ? "MEDIUM" as const : "LOW" as const, sourceQuality };
}

export function rejectCallerCalculatedFields(value: unknown) {
  if (!value || typeof value !== "object") return;
  const keys = Object.keys(value as object);
  if (keys.some((key) => ["fitScore", "score", "confidenceScore", "rankingScore", "eligibility"].includes(key))) throw new Error("caller_calculated_field_rejected");
}

export type RankCandidate = { jobId: string; employerId: string; titleFamily: string; discoverySourceId: string; fit: number; preference: number | null; confidence: number; confidenceLabel: "HIGH" | "MEDIUM" | "LOW"; postedOn: string | null; firstSeenAt: string; eligible: boolean; evidenceSufficient: boolean };
function baseCompare(a: RankCandidate, b: RankCandidate) {
  return b.fit - a.fit || (a.fit === b.fit ? (b.preference ?? -1) - (a.preference ?? -1) : 0) || b.confidence - a.confidence || (b.postedOn ?? b.firstSeenAt).localeCompare(a.postedOn ?? a.firstSeenAt) || a.jobId.localeCompare(b.jobId);
}
export function baseRank(candidates: readonly RankCandidate[]) { return [...candidates].sort(baseCompare); }

export function baseRankWithExplanations(candidates: readonly RankCandidate[]) {
  return baseRank(candidates).map((candidate, index) => ({
    candidate,
    baseRank: index + 1,
    explanation: { fit: candidate.fit, preference: candidate.preference, confidence: candidate.confidence, confidenceLabel: candidate.confidenceLabel, freshnessAt: candidate.postedOn ?? candidate.firstSeenAt, postedDateKnown: candidate.postedOn != null, stableJobId: candidate.jobId, version: MATCHING_RULES_VERSION },
  }));
}

export function selectWithBoundedDiversity(candidates: readonly RankCandidate[], count: number) {
  const remaining = baseRank(candidates.filter((candidate) => candidate.eligible && candidate.evidenceSufficient && !isLiveopsReference(candidate.discoverySourceId))); const selected: RankCandidate[] = []; const displacements: Array<{ slot: number; anchorId: string; selectedId: string; anchorVector: [number, number, number]; selectedVector: [number, number, number]; anchorValues: { fit: number; preference: number | null; confidence: number }; selectedValues: { fit: number; preference: number | null; confidence: number }; reason: "LEXICOGRAPHIC_CONCENTRATION" }> = [];
  const preferenceConstraintApplies = remaining.some((candidate) => candidate.preference != null);
  const counts = (candidate: RankCandidate): [number, number, number] => [selected.filter((x) => x.employerId === candidate.employerId).length + 1, selected.filter((x) => x.titleFamily === candidate.titleFamily).length + 1, selected.filter((x) => x.discoverySourceId === candidate.discoverySourceId).length + 1];
  const lex = (a: readonly number[], b: readonly number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  while (remaining.length && selected.length < count) {
    const anchor = remaining[0];
    const eligible = remaining.filter((candidate) => anchor.fit - candidate.fit <= 5 && labelRank(candidate.confidenceLabel) >= labelRank(anchor.confidenceLabel) && (!preferenceConstraintApplies || (anchor.preference != null && candidate.preference != null && anchor.preference - candidate.preference <= 0.05)));
    const chosen = eligible.sort((a, b) => lex(counts(a), counts(b)) || a.jobId.localeCompare(b.jobId))[0] ?? anchor;
    if (chosen.jobId !== anchor.jobId) displacements.push({ slot: selected.length + 1, anchorId: anchor.jobId, selectedId: chosen.jobId, anchorVector: counts(anchor), selectedVector: counts(chosen), anchorValues: { fit: anchor.fit, preference: anchor.preference, confidence: anchor.confidence }, selectedValues: { fit: chosen.fit, preference: chosen.preference, confidence: chosen.confidence }, reason: "LEXICOGRAPHIC_CONCENTRATION" });
    selected.push(chosen); remaining.splice(remaining.findIndex((x) => x.jobId === chosen.jobId), 1);
  }
  return { selected, displacements, version: SELECTOR_VERSION };
}
function labelRank(label: RankCandidate["confidenceLabel"]) { return { LOW: 0, MEDIUM: 1, HIGH: 2 }[label]; }

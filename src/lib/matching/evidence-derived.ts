import { canonicalSha256, semanticComparisonKey, typedCriterionSchema, type TypedCriterion } from "@/lib/domain/foundation";
import {
  MATCHING_RULES_VERSION,
  SELECTOR_VERSION,
  calculateConfidence,
  calculateFit,
  calculatePreferenceAlignment,
  deriveEligibility,
  evaluateSalary,
  evaluateUsefulnessGate,
  evidenceFactorForRelation,
  experienceDepthFactor,
  readinessCapabilityFactor,
  targetCompensationPreference,
  type FitComponentInput,
  type FitComponentName,
} from "@/lib/matching/evaluation-engine";
import { evaluateRequirementTree, type EvaluatableRequirementNode, type LeafDecision } from "@/lib/matching/requirements";

export type PersistedRequirementRow = {
  id: string;
  parent_id: string | null;
  position: number;
  node_kind: "ALL_OF" | "ANY_OF" | "CRITERION";
  criterion_type: string | null;
  stable_criterion_id: string | null;
  semantic_key: string | null;
  requirement_strength: string | null;
  source_locator: string | null;
  source_excerpt: string | null;
  parser_certainty: number | null;
  importance: number | null;
  typed_value: unknown;
};

export type PersistedCandidateFact = {
  id: string;
  snapshot_id: string | null;
  semantic_key: string;
  value_kind: string;
  typed_value: unknown;
  verification: string;
  source_kind: string;
  supplied_source_id: string | null;
  superseded_at: string | null;
  capability_status: string | null;
  calendar_duration_days: number | null;
  customer_display_label: string | null;
  customer_display_value: unknown;
};

export type PersistedReview = {
  id: string;
  snapshot_id: string;
  job_snapshot_id: string | null;
  review_kind: string;
  decision: unknown;
  invalidated_at: string | null;
  reviewer_id: string;
  created_at: string;
};

export type PersistedIntakeForMatching = {
  id: string;
  customer_id: string | null;
  content_sha256: string;
  schema_version: string;
  work_modes: unknown;
  optional_titles: unknown;
  salary_target_cents: number | null;
  salary_hard_minimum_cents: number | null;
  salary_minimum_flexible: boolean;
  salary_period: string | null;
  salary_basis: string | null;
  salary_overlap_policy: string;
  salary_unpublished_policy: string;
  salary_noncomparable_policy: string;
  salary_variable_pay_policy: string;
};

export type PersistedJobForMatching = {
  id: string;
  exact_title: string;
  content_sha256: string;
  parser_version: string;
  requirement_completeness: number;
  compensation_completeness: number;
  application_host_type: string;
  legitimacy_result: string | null;
  listing_activity_result: string | null;
  application_path_result: string | null;
};

export type CurrentSourceAuthorization = {
  id: string;
  state: string;
  access_method: string;
  authorization_version: string;
};

type DecisionRecord = Record<string, unknown>;
type EvidenceRelation = "DIRECT" | "ADJACENT" | "TRANSFERABLE" | "UNSUPPORTED";

function object(value: unknown): DecisionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as DecisionRecord;
}

function strings(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
}

function policyAllows(value: string) {
  return ["INCLUDE_WITH_WARNING", "ALLOW_WITH_WARNING", "PUBLISHED_OVERLAP_ALLOWED"].includes(value);
}

function importance(row: PersistedRequirementRow): 1 | 2 | 3 {
  if (row.importance === 1 || row.importance === 2 || row.importance === 3) return row.importance;
  return row.requirement_strength === "REQUIRED" ? 3 : row.requirement_strength === "PREFERRED" ? 1 : 2;
}

function currentFact(fact: PersistedCandidateFact, snapshotId: string) {
  return fact.snapshot_id === snapshotId
    && fact.superseded_at == null
    && (fact.verification === "CUSTOMER_CONFIRMED"
      || (fact.verification === "HUMAN_VERIFIED" && fact.source_kind === "HUMAN_VERIFICATION" && Boolean(fact.supplied_source_id)));
}

export function reconstructPersistedRequirementTree(rows: readonly PersistedRequirementRow[]) {
  const operators = rows.filter((row) => row.parent_id == null && row.node_kind !== "CRITERION");
  if (operators.length !== 1) throw new Error("exactly_one_hard_requirement_root_required");
  const byParent = new Map<string, PersistedRequirementRow[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const children = byParent.get(row.parent_id) ?? [];
    children.push(row);
    byParent.set(row.parent_id, children);
  }
  const seen = new Set<string>();
  const visit = (row: PersistedRequirementRow): EvaluatableRequirementNode => {
    if (seen.has(row.id)) throw new Error("cyclic_or_duplicate_persisted_requirement");
    seen.add(row.id);
    if (row.node_kind === "CRITERION") {
      const criterion = typedCriterionSchema.safeParse(row.typed_value);
      if (!criterion.success || criterion.data.strength !== "REQUIRED" || criterion.data.stableCriterionId !== row.stable_criterion_id) throw new Error("untyped_or_mismatched_hard_requirement");
      return { nodeId: row.id, semanticKey: row.semantic_key || criterion.data.semanticKey, kind: "CRITERION", criterion: criterion.data };
    }
    const children = [...(byParent.get(row.id) ?? [])].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    if (!children.length) throw new Error("empty_persisted_requirement_operator");
    return { nodeId: row.id, semanticKey: row.semantic_key || `operator:${row.id}`, kind: row.node_kind, children: children.map(visit) };
  };
  return visit(operators[0]);
}

function reviewForCriterion(reviews: readonly PersistedReview[], criterionId: string) {
  const matches = reviews.filter((review) => {
    const decision = object(review.decision);
    return review.review_kind === "MATCH_EVIDENCE" && decision.stableCriterionId === criterionId && !review.invalidated_at;
  });
  if (matches.length > 1) throw new Error("duplicate_current_match_evidence_review");
  return matches[0] ?? null;
}

function relationFromReview(review: PersistedReview | null): EvidenceRelation {
  const value = object(review?.decision).evidenceRelation;
  return ["DIRECT", "ADJACENT", "TRANSFERABLE", "UNSUPPORTED"].includes(String(value)) ? value as EvidenceRelation : "UNSUPPORTED";
}

function automaticLeafDecision(criterion: TypedCriterion, snapshot: PersistedIntakeForMatching, row: PersistedRequirementRow): LeafDecision | null {
  if (criterion.kind === "WORK_MODE") {
    const allowed = new Set(strings(snapshot.work_modes));
    return {
      result: criterion.modes.some((mode) => allowed.has(mode)) ? "PASS" : "FAIL",
      resolutionIssue: "NONE",
      unknownTreatment: "BLOCK",
      importance: importance(row),
      evidenceConfidence: 1,
      candidateFactIds: [],
      jobEvidenceIds: [row.id],
      relation: "DIRECT",
    };
  }
  if (criterion.kind === "COMPENSATION" || criterion.kind === "LISTING_APPLICATION_PATH") {
    return { result: "PASS", resolutionIssue: "NONE", unknownTreatment: "BLOCK", importance: importance(row), evidenceConfidence: 1, candidateFactIds: [], jobEvidenceIds: [row.id], relation: "DIRECT" };
  }
  return null;
}

function reviewedLeafDecision(row: PersistedRequirementRow, review: PersistedReview | null, facts: ReadonlyMap<string, PersistedCandidateFact>, snapshot: PersistedIntakeForMatching): LeafDecision {
  const criterion = typedCriterionSchema.parse(row.typed_value);
  const automatic = automaticLeafDecision(criterion, snapshot, row);
  if (automatic) return automatic;
  if (!review) return { result: "UNKNOWN", resolutionIssue: "CANDIDATE_MISSING", unknownTreatment: "BLOCK", importance: importance(row), evidenceConfidence: 0, candidateFactIds: [], jobEvidenceIds: [row.id], relation: "UNSUPPORTED" };
  const decision = object(review.decision);
  const candidateFactIds = strings(decision.candidateFactVersionIds);
  const jobEvidenceIds = strings(decision.sourceEvidenceNodeIds);
  const relation = relationFromReview(review);
  const activeFacts = candidateFactIds.map((id) => facts.get(id)).filter((fact): fact is PersistedCandidateFact => Boolean(fact) && currentFact(fact!, snapshot.id));
  if (activeFacts.length !== candidateFactIds.length || !jobEvidenceIds.includes(row.id)) throw new Error("review_evidence_not_current_or_not_criterion_bound");
  const disposition = decision.disposition;
  if (disposition === "RESOLVED_PASS" && (!candidateFactIds.length || relation === "UNSUPPORTED" || relation === "TRANSFERABLE" || relation === "ADJACENT" && !decision.adjacentEquivalenceReviewId)) {
    throw new Error("hard_requirement_pass_missing_bound_candidate_evidence");
  }
  return {
    result: disposition === "RESOLVED_PASS" ? "PASS" : disposition === "RESOLVED_FAIL" ? "FAIL" : "UNKNOWN",
    resolutionIssue: disposition === "REQUIRES_MORE_EVIDENCE" ? "EVIDENCE_CONFLICT" : "NONE",
    unknownTreatment: "BLOCK",
    importance: importance(row),
    evidenceConfidence: disposition === "REQUIRES_MORE_EVIDENCE" ? 0 : relation === "ADJACENT" ? 0.8 : 1,
    candidateFactIds,
    jobEvidenceIds,
    relation,
  };
}

function salaryInput(snapshot: PersistedIntakeForMatching, criteria: readonly TypedCriterion[], compensationReview: PersistedReview | null) {
  const criterion = criteria.find((item) => item.kind === "COMPENSATION");
  const compensation = criterion?.kind === "COMPENSATION" ? criterion : null;
  const decision = object(compensationReview?.decision);
  const conversion = object(decision.conversion);
  return {
    hardMinimumCents: snapshot.salary_hard_minimum_cents,
    flexibleMinimum: snapshot.salary_minimum_flexible,
    minimumPeriod: snapshot.salary_period === "HOUR" || snapshot.salary_period === "YEAR" ? snapshot.salary_period as "HOUR" | "YEAR" : null,
    minimumBasis: snapshot.salary_basis === "BASE" || snapshot.salary_basis === "GUARANTEED_TOTAL" ? snapshot.salary_basis as "BASE" | "GUARANTEED_TOTAL" : null,
    publishedByEmployer: Boolean(compensation),
    estimateOnly: false,
    currency: compensation?.currency ?? null,
    period: compensation?.period ?? null,
    basis: compensation?.basis ?? null,
    lowerCents: compensation?.lowerCents ?? null,
    upperCents: compensation?.upperCents ?? null,
    endpointMeaning: compensation && compensation.lowerCents === compensation.upperCents ? "FIXED" as const : "RANGE" as const,
    correctLocationRange: decision.correctLocationRange === true,
    workerBasisComparable: decision.workerBasisComparable === true,
    variableMaterial: compensation?.basis === "VARIABLE_OTE",
    variableAccepted: policyAllows(snapshot.salary_variable_pay_policy),
    includeOverlap: policyAllows(snapshot.salary_overlap_policy),
    includeUnpublished: policyAllows(snapshot.salary_unpublished_policy),
    includeNoncomparableUsd: policyAllows(snapshot.salary_noncomparable_policy),
    conversion: typeof conversion.hoursPerWeek === "number" && typeof conversion.weeksPerYear === "number" && typeof conversion.version === "string"
      ? { hoursPerWeek: conversion.hoursPerWeek, weeksPerYear: conversion.weeksPerYear, version: conversion.version, accepted: true }
      : null,
  };
}

function componentFor(criterion: TypedCriterion): FitComponentName | null {
  if (criterion.kind === "RESPONSIBILITY") return "CORE_RESPONSIBILITY_ALIGNMENT";
  if (criterion.kind === "TOOL_CAPABILITY") return "REQUIRED_TOOL_TECHNICAL_ALIGNMENT";
  if (criterion.kind === "EXPERIENCE") return "RELEVANT_EXPERIENCE_DEPTH_SCOPE";
  if (criterion.kind === "EDUCATION" || criterion.kind === "CERTIFICATION_LICENSE") return "EDUCATION_CERTIFICATION_ALIGNMENT";
  return null;
}

function fitComponents(rows: readonly PersistedRequirementRow[], reviews: readonly PersistedReview[], facts: ReadonlyMap<string, PersistedCandidateFact>, selectedPath: ReadonlySet<string>) {
  const names: FitComponentName[] = ["CORE_RESPONSIBILITY_ALIGNMENT", "REQUIRED_TOOL_TECHNICAL_ALIGNMENT", "RELEVANT_EXPERIENCE_DEPTH_SCOPE", "EDUCATION_CERTIFICATION_ALIGNMENT", "CURRENT_READINESS"];
  const criteriaByComponent = new Map<FitComponentName, FitComponentInput["criteria"]>(names.map((name) => [name, []]));
  const readiness: FitComponentInput["criteria"] = [];
  for (const row of rows) {
    if (row.node_kind !== "CRITERION" || !row.typed_value || row.requirement_strength === "INFORMATIONAL") continue;
    const parsed = typedCriterionSchema.safeParse(row.typed_value);
    if (!parsed.success) continue;
    if (row.requirement_strength === "REQUIRED" && !selectedPath.has(row.id)) continue;
    const component = componentFor(parsed.data);
    if (!component) continue;
    const review = reviewForCriterion(reviews, parsed.data.stableCriterionId);
    if (!review) continue;
    const decision = object(review.decision);
    const factIds = strings(decision.candidateFactVersionIds);
    const relation = relationFromReview(review);
    const evidenceFactor = evidenceFactorForRelation(relation, row.requirement_strength === "REQUIRED");
    const evidenceIds = [...strings(decision.sourceEvidenceNodeIds), ...factIds];
    let capabilityOrDepthFactor: number | null = null;
    const linkedFacts = factIds.map((id) => facts.get(id)).filter((fact): fact is PersistedCandidateFact => Boolean(fact));
    if (parsed.data.kind === "EXPERIENCE") {
      const conservativeMonths = linkedFacts.reduce((max, fact) => Math.max(max, (fact.calendar_duration_days ?? 0) / 30.4375), 0);
      capabilityOrDepthFactor = experienceDepthFactor({ conservativeVerifiedMonths: conservativeMonths, employerTargetMonths: parsed.data.minimumMonths || null, statedScopeConfirmed: object(review.decision).disposition === "RESOLVED_PASS" });
    }
    if (parsed.data.kind === "TOOL_CAPABILITY") {
      const factors = linkedFacts.map((fact) => fact.capability_status && ["CAN_DO_NOW", "DONE_BEFORE_NEEDS_REFRESHER", "BASIC_EXPOSURE", "NOT_DONE", "UNSURE"].includes(fact.capability_status) ? readinessCapabilityFactor(fact.capability_status as Parameters<typeof readinessCapabilityFactor>[0]) : 0);
      capabilityOrDepthFactor = factors.length ? Math.max(...factors) : 0;
    }
    criteriaByComponent.get(component)!.push({ criterionId: parsed.data.stableCriterionId, importance: importance(row), evidenceFactor, capabilityOrDepthFactor, evidenceIds });
    for (const fact of linkedFacts) {
      if (!fact.capability_status || !["CAN_DO_NOW", "DONE_BEFORE_NEEDS_REFRESHER", "BASIC_EXPOSURE", "NOT_DONE", "UNSURE"].includes(fact.capability_status)) continue;
      readiness.push({ criterionId: `${parsed.data.stableCriterionId}:${fact.id}`, importance: importance(row), evidenceFactor, capabilityOrDepthFactor: readinessCapabilityFactor(fact.capability_status as Parameters<typeof readinessCapabilityFactor>[0]), evidenceIds: [row.id, fact.id] });
    }
  }
  criteriaByComponent.set("CURRENT_READINESS", readiness);
  return names.map((name) => ({ name, applicable: name === "CORE_RESPONSIBILITY_ALIGNMENT" || (criteriaByComponent.get(name)?.length ?? 0) > 0, criteria: criteriaByComponent.get(name) ?? [] }));
}

function preferenceComponents(snapshot: PersistedIntakeForMatching, job: PersistedJobForMatching, criteria: readonly TypedCriterion[], salary: ReturnType<typeof evaluateSalary>) {
  const components: Array<{ preferenceId: string; value: 0 | 0.5 | 0.75 | 1 }> = [];
  const workModes = new Set(criteria.filter((criterion): criterion is Extract<TypedCriterion, { kind: "WORK_MODE" }> => criterion.kind === "WORK_MODE").flatMap((criterion) => criterion.modes));
  const preferredModes = strings(snapshot.work_modes);
  if (preferredModes.length) components.push({ preferenceId: "work-mode", value: preferredModes.some((mode) => workModes.has(mode as "REMOTE" | "HYBRID" | "ONSITE")) ? 1 : 0 });
  const titles = strings(snapshot.optional_titles).map(semanticComparisonKey);
  if (titles.length) components.push({ preferenceId: "title", value: titles.includes(semanticComparisonKey(job.exact_title)) ? 1 : 0 });
  if (snapshot.salary_target_cents != null) {
    const compensation = criteria.find((criterion): criterion is Extract<TypedCriterion, { kind: "COMPENSATION" }> => criterion.kind === "COMPENSATION");
    components.push({ preferenceId: "target-compensation", value: targetCompensationPreference({ targetCents: snapshot.salary_target_cents, publishedComparable: salary.status.startsWith("PUBLISHED_") && !["PUBLISHED_NONCOMPARABLE", "PUBLISHED_BELOW_MINIMUM"].includes(salary.status), employerConfirmed: Boolean(compensation), lowerCents: salary.comparedLowerCents, upperCents: salary.comparedUpperCents, hardFloorCents: snapshot.salary_hard_minimum_cents, allowedUnknown: salary.disposition === "ALLOWED_WITH_WARNING" }) ?? 0 });
  }
  return components;
}

export function deriveEvaluationFromPersistedEvidence(input: {
  snapshot: PersistedIntakeForMatching;
  job: PersistedJobForMatching;
  sourceAuthorization: CurrentSourceAuthorization;
  nodes: PersistedRequirementRow[];
  facts: PersistedCandidateFact[];
  evidenceReviews: PersistedReview[];
  usefulnessReview: PersistedReview;
  compensationReview: PersistedReview | null;
}) {
  const { snapshot, job, sourceAuthorization, nodes, facts, evidenceReviews, usefulnessReview, compensationReview } = input;
  if (job.requirement_completeness !== 100) throw new Error("listing_requirement_parse_incomplete");
  if (!["AUTHORIZED_AUTOMATED", "AUTHORIZED_MANUAL_ONLY"].includes(sourceAuthorization.state)) throw new Error("source_authorization_not_current");
  if (usefulnessReview.review_kind !== "CATEGORICAL_USEFULNESS" || usefulnessReview.invalidated_at) throw new Error("current_usefulness_review_required");
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  if (facts.some((fact) => !currentFact(fact, snapshot.id))) throw new Error("inactive_or_unverified_candidate_fact");
  const tree = reconstructPersistedRequirementTree(nodes);
  const hardRows = nodes.filter((row) => row.node_kind === "CRITERION" && row.requirement_strength === "REQUIRED");
  const decisions = new Map(hardRows.map((row) => [row.id, reviewedLeafDecision(row, reviewForCriterion(evidenceReviews, row.stable_criterion_id!), factById, snapshot)]));
  const requirement = evaluateRequirementTree(tree, decisions);
  const requirementIssue = requirement.result === "UNKNOWN"
    ? requirement.leafResults.find((leaf) => leaf.outcomeDeterminative)?.resolutionIssue ?? "PARSER_UNCERTAIN"
    : "NONE";
  const criteria = nodes.flatMap((row) => {
    if (row.node_kind !== "CRITERION") return [];
    const parsed = typedCriterionSchema.safeParse(row.typed_value);
    return parsed.success ? [parsed.data] : [];
  });
  const salarySource = salaryInput(snapshot, criteria, compensationReview);
  const salary = evaluateSalary(salarySource);
  const salaryWarning = salary.warning ?? undefined;
  const salaryAllowedUnknown = salary.disposition === "ALLOWED_WITH_WARNING" && salary.status !== "PUBLISHED_OVERLAPS_MINIMUM";
  const salaryGate = {
    rootKey: "universal:salary",
    result: salary.disposition === "FAIL" ? "FAIL" as const : salaryAllowedUnknown ? "UNKNOWN" as const : "PASS" as const,
    resolutionIssue: salaryAllowedUnknown ? "EMPLOYER_OMITTED" as const : "NONE" as const,
    unknownTreatment: salaryAllowedUnknown ? "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" as const : "BLOCK" as const,
    consentVersion: salaryAllowedUnknown ? `${snapshot.schema_version}:${snapshot.content_sha256}` : undefined,
    warning: salaryWarning,
  };
  const universal = [
    { rootKey: "universal:source-authorization", result: "PASS" as const, resolutionIssue: "NONE" as const, unknownTreatment: "BLOCK" as const, unwaivable: true },
    { rootKey: "universal:listing-legitimacy", result: job.legitimacy_result === "PASS" ? "PASS" as const : "FAIL" as const, resolutionIssue: "NONE" as const, unknownTreatment: "BLOCK" as const, unwaivable: true },
    { rootKey: "universal:listing-activity", result: job.listing_activity_result === "PASS" ? "PASS" as const : "FAIL" as const, resolutionIssue: "NONE" as const, unknownTreatment: "BLOCK" as const, unwaivable: true },
    { rootKey: "universal:application-path", result: job.application_path_result === "PASS" ? "PASS" as const : "FAIL" as const, resolutionIssue: "NONE" as const, unknownTreatment: "BLOCK" as const, unwaivable: true },
    salaryGate,
    { rootKey: requirement.nodeId, result: requirement.result, resolutionIssue: requirementIssue, unknownTreatment: "BLOCK" as const },
  ];
  const eligibility = deriveEligibility(universal.map((gate) => gate.rootKey), universal);
  const usefulnessDecision = object(usefulnessReview.decision);
  const explanationEvidence = object(usefulnessDecision.explanationEvidence);
  const coreRows = nodes.filter((row) => row.node_kind === "CRITERION" && object(row.typed_value).kind === "RESPONSIBILITY");
  const coreReviews = coreRows.map((row) => reviewForCriterion(evidenceReviews, row.stable_criterion_id!)).filter((review): review is PersistedReview => Boolean(review));
  const explanationCounts = ["whatJobInvolves", "whyMadeList", "howExperienceConnects", "whatMayBeNew", "whatToKnow"].map((key) => {
    const section = object(explanationEvidence[key]);
    return strings(section.sourceEvidenceNodeIds).length + strings(section.candidateFactIds).length;
  });
  const applicationReadiness = ["READY", "NEEDS_CUSTOMER_ACTION", "BLOCKED"].includes(String(usefulnessDecision.applicationReadiness)) ? usefulnessDecision.applicationReadiness as "READY" | "NEEDS_CUSTOMER_ACTION" | "BLOCKED" : "BLOCKED";
  const usefulness = evaluateUsefulnessGate({
    disposition: eligibility.disposition,
    employerCoreResponsibilityCount: coreRows.length,
    confirmedDirectCoreConnections: coreReviews.filter((review) => object(review.decision).disposition === "RESOLVED_PASS" && relationFromReview(review) === "DIRECT").length,
    reviewedAdjacentCoreConnections: coreReviews.filter((review) => object(review.decision).disposition === "RESOLVED_PASS" && relationFromReview(review) === "ADJACENT" && Boolean(object(review.decision).adjacentEquivalenceReviewId)).length,
    explanationSectionEvidenceCounts: explanationCounts,
    readiness: applicationReadiness,
    reviewerWorthwhileReason: typeof usefulnessDecision.reviewerWorthwhileReason === "string" ? usefulnessDecision.reviewerWorthwhileReason : null,
    certifiedNotQuotaFiller: usefulnessDecision.certifiedNotQuotaFiller === true,
  });
  const selectedPath = new Set(requirement.selectedSatisfactionPath ?? []);
  const components = fitComponents(nodes, evidenceReviews, factById, selectedPath);
  if (components.find((component) => component.name === "CORE_RESPONSIBILITY_ALIGNMENT")?.criteria.length === 0) throw new Error("core_responsibility_evidence_required");
  const fit = calculateFit(eligibility.disposition, usefulness.evidenceSufficient, components);
  const outcomeRows = hardRows.filter((row) => selectedPath.has(row.id));
  const candidateImportance = outcomeRows.reduce((sum, row) => sum + importance(row), 0) || 1;
  const candidateComplete = outcomeRows.reduce((sum, row) => {
    const leaf = requirement.leafResults.find((item) => item.nodeId === row.id);
    return sum + (leaf?.result === "PASS" && (leaf.candidateFactIds.length > 0 || automaticLeafDecision(typedCriterionSchema.parse(row.typed_value), snapshot, row)) ? importance(row) : 0);
  }, 0) / candidateImportance;
  const parserDenominator = outcomeRows.reduce((sum, row) => sum + importance(row), 0) || 1;
  const parserCertainty = outcomeRows.reduce((sum, row) => sum + importance(row) * (row.parser_certainty ?? 0), 0) / parserDenominator;
  const sourceQuality = sourceAuthorization.access_method === "AUTOMATED" || job.application_host_type === "EMPLOYER_HOSTED" ? 1 : 0.8;
  const confidence = calculateConfidence({ candidateCompleteness: candidateComplete, employerCompleteness: job.requirement_completeness / 100, materialSourceQualities: [sourceQuality], parserCertainty });
  const confidenceInputs = { candidateCompleteness: candidateComplete, employerCompleteness: job.requirement_completeness / 100, sourceQuality, parserCertainty };
  const preferences = preferenceComponents(snapshot, job, criteria, salary);
  const preference = calculatePreferenceAlignment(preferences);
  const allReviewDecisions = [usefulnessReview, ...evidenceReviews, ...(compensationReview ? [compensationReview] : [])].map((review) => object(review.decision));
  const candidateFactIds = [...new Set(allReviewDecisions.flatMap((decision) => strings(decision.candidateFactIds)))];
  const jobEvidenceIds = [...new Set(allReviewDecisions.flatMap((decision) => strings(decision.sourceEvidenceNodeIds)))];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const jobEvidence = jobEvidenceIds.map((id) => {
    const node = nodeById.get(id);
    if (!node?.source_locator || !node.source_excerpt) throw new Error("job_evidence_locator_required");
    return { id, jobSnapshotId: job.id, field: node.stable_criterion_id || node.semantic_key || id, sourceLocator: node.source_locator, contentSha256: canonicalSha256(node.source_excerpt) };
  });
  const presentationRisk = ["LOW", "MEDIUM", "HIGH", "NOT_ASSESSED"].includes(String(usefulnessDecision.presentationRisk)) ? usefulnessDecision.presentationRisk as "LOW" | "MEDIUM" | "HIGH" | "NOT_ASSESSED" : "NOT_ASSESSED";
  const presentationRiskReasons = strings(usefulnessDecision.presentationRiskReasons);
  const versionBundle = { matching: MATCHING_RULES_VERSION, parser: job.parser_version, catalog: MATCHING_RULES_VERSION, criteria: snapshot.schema_version, selector: SELECTOR_VERSION, jobSnapshot: job.content_sha256, sourceAuthorization: sourceAuthorization.authorization_version };
  const calculationInput = { snapshotHash: snapshot.content_sha256, jobHash: job.content_sha256, sourceAuthorizationId: sourceAuthorization.id, reviewIds: [usefulnessReview.id, ...evidenceReviews.map((review) => review.id), compensationReview?.id].filter(Boolean).sort(), factIds: candidateFactIds.sort(), rulesVersion: MATCHING_RULES_VERSION };
  return {
    eligibility,
    requirement,
    gates: universal,
    salary,
    salarySource,
    usefulness,
    fit,
    components,
    confidence,
    confidenceInputs,
    preferences,
    preference,
    applicationReadiness,
    presentationRisk,
    presentationRiskReasons,
    explanationEvidence,
    candidateFactIds,
    jobEvidence,
    versionBundle,
    calculationInputSha256: canonicalSha256(calculationInput),
  };
}

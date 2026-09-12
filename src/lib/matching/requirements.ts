import { occupationalCreditAllowed, typedCriterionSchema, type CapabilityStatus, type CriterionResult, type ResolutionIssue, type TypedCriterion, type UnknownTreatment } from "@/lib/domain/foundation";

export const REQUIREMENT_ENGINE_VERSION = "requirement-engine-v1";

export type EvaluatableRequirementNode =
  | { nodeId: string; semanticKey: string; kind: "ALL_OF" | "ANY_OF"; children: EvaluatableRequirementNode[] }
  | { nodeId: string; semanticKey: string; kind: "CRITERION"; criterion: TypedCriterion };

export type LeafDecision = {
  result: CriterionResult;
  resolutionIssue: ResolutionIssue;
  unknownTreatment: UnknownTreatment;
  importance: 1 | 2 | 3;
  evidenceConfidence: number;
  candidateFactIds: string[];
  jobEvidenceIds: string[];
  relation: "DIRECT" | "ADJACENT" | "TRANSFERABLE" | "UNSUPPORTED";
  consentVersion?: string;
  warning?: string;
};

export type RequirementEvaluation = {
  nodeId: string;
  result: CriterionResult;
  outcomeDeterminativeUnknownNodeIds: string[];
  selectedSatisfactionPath: string[] | null;
  leafResults: Array<LeafDecision & { nodeId: string; outcomeDeterminative: boolean }>;
};

export function validateRequirementTree(value: unknown): EvaluatableRequirementNode {
  const seenObjects = new WeakSet<object>();
  const nodeIds = new Set<string>();
  const semanticKeys = new Set<string>();
  function visit(raw: unknown): EvaluatableRequirementNode {
    if (!raw || typeof raw !== "object") throw new Error("malformed_requirement_node");
    if (seenObjects.has(raw)) throw new Error("cyclic_requirement_tree");
    seenObjects.add(raw);
    const record = raw as Record<string, unknown>;
    const nodeId = typeof record.nodeId === "string" && record.nodeId ? record.nodeId : "";
    const semanticKey = typeof record.semanticKey === "string" && record.semanticKey ? record.semanticKey : "";
    if (!nodeId || !semanticKey) throw new Error("missing_requirement_identity");
    if (nodeIds.has(nodeId) || semanticKeys.has(semanticKey)) throw new Error("duplicate_requirement_identity");
    nodeIds.add(nodeId); semanticKeys.add(semanticKey);
    if (record.kind === "CRITERION") {
      const parsed = typedCriterionSchema.safeParse(record.criterion);
      if (!parsed.success) throw new Error("untyped_requirement_leaf");
      if (parsed.data.strength !== "REQUIRED") throw new Error("nonrequired_criterion_in_hard_tree");
      return { nodeId, semanticKey, kind: "CRITERION", criterion: parsed.data };
    }
    if (record.kind !== "ALL_OF" && record.kind !== "ANY_OF") throw new Error("malformed_requirement_node");
    if (!Array.isArray(record.children) || record.children.length === 0) throw new Error("empty_requirement_operator");
    return { nodeId, semanticKey, kind: record.kind, children: record.children.map(visit) };
  }
  return visit(value);
}

export function evaluateRequirementTree(raw: unknown, decisions: ReadonlyMap<string, LeafDecision>): RequirementEvaluation {
  const root = validateRequirementTree(raw);
  type Internal = { node: EvaluatableRequirementNode; result: CriterionResult; leaves: Array<LeafDecision & { nodeId: string }>; path: string[] | null; quality: [number, number, string] };
  const walk = (node: EvaluatableRequirementNode): Internal => {
    if (node.kind === "CRITERION") {
      const decision = decisions.get(node.nodeId);
      if (!decision || !Number.isFinite(decision.evidenceConfidence) || decision.evidenceConfidence < 0 || decision.evidenceConfidence > 1) throw new Error("missing_or_invalid_leaf_decision");
      if (!["PASS", "FAIL", "UNKNOWN"].includes(decision.result)
        || !["NONE", "CANDIDATE_MISSING", "EMPLOYER_OMITTED", "PARSER_UNCERTAIN", "EVIDENCE_CONFLICT"].includes(decision.resolutionIssue)
        || !["BLOCK", "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING", "IMMATERIAL_ALTERNATIVE"].includes(decision.unknownTreatment)
        || ![1, 2, 3].includes(decision.importance)
        || !Array.isArray(decision.candidateFactIds)
        || !Array.isArray(decision.jobEvidenceIds)) throw new Error("invalid_leaf_decision_union");
      if (decision.result === "PASS" && (!decision.jobEvidenceIds.length || decision.relation === "UNSUPPORTED")) throw new Error("passing_leaf_missing_evidence");
      return { node, result: decision.result, leaves: [{ ...decision, nodeId: node.nodeId }], path: decision.result === "PASS" ? [node.nodeId] : null, quality: [decision.importance, decision.evidenceConfidence, node.nodeId] };
    }
    const children = node.children.map(walk);
    const result: CriterionResult = node.kind === "ALL_OF"
      ? children.some((c) => c.result === "FAIL") ? "FAIL" : children.every((c) => c.result === "PASS") ? "PASS" : "UNKNOWN"
      : children.some((c) => c.result === "PASS") ? "PASS" : children.every((c) => c.result === "FAIL") ? "FAIL" : "UNKNOWN";
    let selected = children;
    if (node.kind === "ANY_OF" && result === "PASS") {
      selected = children.filter((c) => c.result === "PASS").sort((a, b) => b.quality[0] - a.quality[0] || b.quality[1] - a.quality[1] || a.quality[2].localeCompare(b.quality[2])).slice(0, 1);
    }
    const leaves = children.flatMap((c) => c.leaves);
    const selectedLeaves = selected.flatMap((c) => c.leaves);
    const quality: [number, number, string] = [selectedLeaves.reduce((sum, leaf) => sum + leaf.importance, 0), selectedLeaves.length ? selectedLeaves.reduce((sum, leaf) => sum + leaf.evidenceConfidence, 0) / selectedLeaves.length : 0, node.nodeId];
    return { node, result, leaves, path: result === "PASS" ? [node.nodeId, ...selected.flatMap((c) => c.path ?? [])] : null, quality };
  };
  const evaluated = walk(root);
  const resultWithOverride = (node: EvaluatableRequirementNode, leafId: string, override: CriterionResult): CriterionResult => {
    if (node.kind === "CRITERION") return node.nodeId === leafId ? override : decisions.get(node.nodeId)!.result;
    const results = node.children.map((child) => resultWithOverride(child, leafId, override));
    return node.kind === "ALL_OF"
      ? results.some((result) => result === "FAIL") ? "FAIL" : results.every((result) => result === "PASS") ? "PASS" : "UNKNOWN"
      : results.some((result) => result === "PASS") ? "PASS" : results.every((result) => result === "FAIL") ? "FAIL" : "UNKNOWN";
  };
  const determinative = evaluated.result === "UNKNOWN" ? evaluated.leaves.filter((leaf) => leaf.result === "UNKNOWN"
    && (resultWithOverride(root, leaf.nodeId, "PASS") !== evaluated.result || resultWithOverride(root, leaf.nodeId, "FAIL") !== evaluated.result)).map((leaf) => leaf.nodeId) : [];
  const selected = new Set(evaluated.path ?? []);
  return {
    nodeId: root.nodeId,
    result: evaluated.result,
    outcomeDeterminativeUnknownNodeIds: determinative.sort(),
    selectedSatisfactionPath: evaluated.path,
    leafResults: evaluated.leaves.map((leaf) => ({ ...leaf, outcomeDeterminative: determinative.includes(leaf.nodeId), unknownTreatment: leaf.result === "UNKNOWN" && evaluated.result === "PASS" && !selected.has(leaf.nodeId) ? "IMMATERIAL_ALTERNATIVE" : leaf.unknownTreatment })),
  };
}

export type ToolRequirementWording = "CURRENT_PROFICIENCY" | "PRIOR_EXPERIENCE" | "FAMILIARITY" | "PREFERRED";
export function evaluateToolCapability(wording: ToolRequirementWording, status: CapabilityStatus) {
  const table: Record<ToolRequirementWording, Record<CapabilityStatus, { result: CriterionResult; factor: number; warning: boolean }>> = {
    CURRENT_PROFICIENCY: { CAN_DO_NOW: { result: "PASS", factor: 1, warning: false }, DONE_BEFORE_NEEDS_REFRESHER: { result: "UNKNOWN", factor: 0, warning: false }, BASIC_EXPOSURE: { result: "FAIL", factor: 0, warning: false }, NOT_DONE: { result: "FAIL", factor: 0, warning: false }, UNSURE: { result: "UNKNOWN", factor: 0, warning: false } },
    PRIOR_EXPERIENCE: { CAN_DO_NOW: { result: "PASS", factor: 1, warning: false }, DONE_BEFORE_NEEDS_REFRESHER: { result: "PASS", factor: 1, warning: true }, BASIC_EXPOSURE: { result: "UNKNOWN", factor: 0, warning: false }, NOT_DONE: { result: "FAIL", factor: 0, warning: false }, UNSURE: { result: "UNKNOWN", factor: 0, warning: false } },
    FAMILIARITY: { CAN_DO_NOW: { result: "PASS", factor: 1, warning: false }, DONE_BEFORE_NEEDS_REFRESHER: { result: "PASS", factor: 1, warning: false }, BASIC_EXPOSURE: { result: "PASS", factor: 0.6, warning: false }, NOT_DONE: { result: "FAIL", factor: 0, warning: false }, UNSURE: { result: "UNKNOWN", factor: 0, warning: false } },
    PREFERRED: { CAN_DO_NOW: { result: "PASS", factor: 1, warning: false }, DONE_BEFORE_NEEDS_REFRESHER: { result: "PASS", factor: 0.75, warning: false }, BASIC_EXPOSURE: { result: "PASS", factor: 0.4, warning: false }, NOT_DONE: { result: "PASS", factor: 0, warning: false }, UNSURE: { result: "PASS", factor: 0, warning: false } },
  };
  return table[wording][status];
}

export function relatedEducationPass(input: { exact: boolean; employerAllowsRelated: boolean; mappingVersion?: string; rationale?: string }) {
  return input.exact || (input.employerAllowsRelated && Boolean(input.mappingVersion && input.rationale));
}

export type AdjacentEquivalenceReview = {
  reviewId: string;
  criterionId: string;
  jobSnapshotId: string;
  candidateFactVersionIds: string[];
  equivalentForCriterion: true;
  comparedTasks: string[];
  taskSimilarity: "STRONG";
  complexity: string;
  autonomy: string;
  scope: string;
  domainContext: string;
  durationAndIntensity: string;
  essentialTools: string[];
  rationale: string;
  reviewerId: string;
  reviewedAt: string;
  rulesVersion: string;
  catalogVersion: string;
};

export type DurationCriterionContext = {
  criterionId: string;
  jobSnapshotId: string;
  candidateFactVersionIds: readonly string[];
  rulesVersion: string;
  catalogVersion: string;
};

export type ExperiencePeriod = { startMonth: string; endMonth: string; intensityLower: number | null; intensityUpper: number | null; verified: boolean; relation: "DIRECT" | "ADJACENT" | "TRANSFERABLE" | "UNSUPPORTED"; kind: "PAID_EMPLOYMENT" | "SELF_EMPLOYMENT_BUSINESS" | "CONTRACT_FREELANCE" | "VOLUNTEER" | "PROJECT" | "EDUCATION" | "CAREER_BREAK" | "CAREGIVING"; equivalenceReview?: AdjacentEquivalenceReview };

function monthIndex(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(value);
  if (!match) throw new Error("invalid_month");
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function exactAdjacentReview(review: AdjacentEquivalenceReview | undefined, context: DurationCriterionContext | undefined) {
  if (!review || !context || !review.reviewId || !review.reviewerId || !review.rationale.trim() || !review.reviewedAt) return false;
  if (review.criterionId !== context.criterionId || review.jobSnapshotId !== context.jobSnapshotId || review.rulesVersion !== context.rulesVersion || review.catalogVersion !== context.catalogVersion) return false;
  if (!review.comparedTasks.length || !review.complexity.trim() || !review.autonomy.trim() || !review.scope.trim() || !review.domainContext.trim() || !review.durationAndIntensity.trim() || !review.essentialTools.length) return false;
  const expectedFacts = [...new Set(context.candidateFactVersionIds)].sort();
  const reviewedFacts = [...new Set(review.candidateFactVersionIds)].sort();
  return expectedFacts.length > 0 && expectedFacts.length === reviewedFacts.length && expectedFacts.every((id, index) => id === reviewedFacts[index]);
}

export function calculateVerifiedDuration(periods: readonly ExperiencePeriod[], context?: DurationCriterionContext) {
  const eligible = periods.filter((p) => p.verified && occupationalCreditAllowed(p.kind) && (p.relation === "DIRECT" || (p.relation === "ADJACENT" && exactAdjacentReview(p.equivalenceReview, context))));
  if (eligible.some((p) => p.kind === "PROJECT" && (p.intensityLower == null || p.intensityUpper == null))) return { calendarMonths: 0, fteLowerMonths: 0, fteUpperMonths: 0, unresolvedIntensity: true };
  const ranges = eligible.map((p) => ({ ...p, start: monthIndex(p.startMonth), end: monthIndex(p.endMonth) })).map((p) => {
    if (p.end < p.start) throw new Error("invalid_month_range");
    return p;
  });
  if (!ranges.length) return { calendarMonths: 0, fteLowerMonths: 0, fteUpperMonths: 0, unresolvedIntensity: false };
  const first = Math.min(...ranges.map((p) => p.start));
  const last = Math.max(...ranges.map((p) => p.end));
  let calendarMonths = 0, fteLowerMonths = 0, fteUpperMonths = 0;
  for (let month = first; month <= last; month += 1) {
    const active = ranges.filter((p) => p.start <= month && p.end >= month);
    if (!active.length) continue;
    calendarMonths += 1;
    fteLowerMonths += Math.min(1, active.reduce((sum, p) => sum + Math.max(0, Math.min(1, p.intensityLower ?? 0)), 0));
    fteUpperMonths += Math.min(1, active.reduce((sum, p) => sum + Math.max(0, Math.min(1, p.intensityUpper ?? 0)), 0));
  }
  return { calendarMonths, fteLowerMonths, fteUpperMonths, unresolvedIntensity: false };
}

export function durationGate(requiredMonths: number, basis: "CALENDAR" | "FTE" | "EMPLOYER_EXPLICIT_OTHER", duration: ReturnType<typeof calculateVerifiedDuration>): CriterionResult {
  if (!Number.isInteger(requiredMonths) || requiredMonths < 0) throw new Error("invalid_required_duration");
  if (basis === "EMPLOYER_EXPLICIT_OTHER" || duration.unresolvedIntensity) return "UNKNOWN";
  const lower = basis === "FTE" ? duration.fteLowerMonths : duration.calendarMonths;
  const upper = basis === "FTE" ? duration.fteUpperMonths : duration.calendarMonths;
  return lower >= requiredMonths ? "PASS" : upper < requiredMonths ? "FAIL" : "UNKNOWN";
}

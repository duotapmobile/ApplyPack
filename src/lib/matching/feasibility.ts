import { canonicalSha256 } from "@/lib/domain/foundation";
import type { SourceAuthorizationState } from "@/lib/jobs/types";

export const FEASIBILITY_POLICY_VERSION = "feasibility-v1";
export const feasibilityReasonPrecedence = ["CONSTRAINT_COLLISION", "QUALIFICATION_GAP", "EVIDENCE_GAP", "COMPENSATION_BELOW_MINIMUM", "COMPENSATION_UNCONFIRMED", "INVENTORY_SHORTAGE"] as const;
export type FeasibilityReason = (typeof feasibilityReasonPrecedence)[number];
export type CellOutcome = "PENDING" | "SUCCEEDED_WITH_RESULTS" | "SUCCEEDED_EMPTY" | "AUTHORIZATION_ERROR" | "RETRIEVAL_ERROR" | "TIMEOUT" | "TRUNCATED" | "PARSER_ERROR";

export type CoverageCell = {
  id: string;
  familyId: string;
  sourceId: string;
  authorizationState: SourceAuthorizationState;
  authorizationEvidenceId: string | null;
  path: "AUTOMATED" | "MANUAL";
  queryFingerprint: string;
  paginationBound: number;
  lookbackBound: number;
  resultBound: number;
  outcome: CellOutcome;
  resultCount: number | null;
  configuredBoundSatisfied: boolean;
  normalizedAndDeduplicated: boolean;
  manualChecklistComplete: boolean;
  parserResult: "COMPLETE" | "ERROR" | "PENDING";
  stopReason: string | null;
};

export type CoveragePlan = {
  id: string;
  snapshotHash: string;
  breadth: string;
  requiredFamilyIds: string[];
  cells: CoverageCell[];
  versions: { source: string; query: string; inventory: string; parser: string; cutoff: string };
  disposition: "REQUIRED" | "NOT_REQUIRED_CONSTRAINT_COLLISION";
  collisionProof: { kind: "TYPED_CONTRADICTION"; inputHash: string; version: string } | null;
  contentHash: string;
};

export function createCoveragePlan(input: Omit<CoveragePlan, "contentHash">): CoveragePlan {
  const contentHash = canonicalSha256(input, { setPaths: ["$.requiredFamilyIds"] });
  return Object.freeze({ ...input, requiredFamilyIds: [...input.requiredFamilyIds], cells: input.cells.map((cell) => ({ ...cell })), contentHash });
}

export function coverageComplete(plan: CoveragePlan) {
  if (!plan.snapshotHash || !Object.values(plan.versions).every(Boolean)) return { complete: false, error: "UNSET_BLOCKING" as const };
  if (plan.disposition === "NOT_REQUIRED_CONSTRAINT_COLLISION") return plan.collisionProof?.kind === "TYPED_CONTRADICTION" && /^[0-9a-f]{64}$/u.test(plan.collisionProof.inputHash) && Boolean(plan.collisionProof.version)
    ? { complete: true, error: null } : { complete: false, error: "UNSUPPORTED_COLLISION_PROOF" as const };
  if (!plan.requiredFamilyIds.length || !plan.cells.length) return { complete: false, error: "UNSET_BLOCKING" as const };
  const required = new Set(plan.requiredFamilyIds);
  for (const familyId of required) {
    const familyCells = plan.cells.filter((cell) => cell.familyId === familyId);
    if (!familyCells.length) return { complete: false, error: "UNSET_BLOCKING" as const };
    if (!familyCells.some((cell) => ["AUTHORIZED_AUTOMATED", "AUTHORIZED_MANUAL_ONLY"].includes(cell.authorizationState) && cell.authorizationEvidenceId)) return { complete: false, error: "AUTHORIZATION_ERROR" as const };
  }
  for (const cell of plan.cells) {
    if (!required.has(cell.familyId) || !cell.queryFingerprint || ![cell.paginationBound, cell.lookbackBound, cell.resultBound].every((v) => Number.isInteger(v) && v > 0)) return { complete: false, error: "UNSET_BLOCKING" as const };
    if (!["SUCCEEDED_WITH_RESULTS", "SUCCEEDED_EMPTY"].includes(cell.outcome) || cell.parserResult !== "COMPLETE" || !cell.normalizedAndDeduplicated) return { complete: false, error: cell.outcome === "PENDING" ? "PENDING" as const : "RESULT_CHANGING_ERROR" as const };
    if (cell.path === "AUTOMATED" && !cell.configuredBoundSatisfied) return { complete: false, error: "RESULT_CHANGING_ERROR" as const };
    if (cell.path === "MANUAL" && !cell.manualChecklistComplete) return { complete: false, error: "RESULT_CHANGING_ERROR" as const };
    if (cell.resultCount == null || cell.resultCount < 0 || (cell.outcome === "SUCCEEDED_WITH_RESULTS" && cell.resultCount === 0) || (cell.outcome === "SUCCEEDED_EMPTY" && cell.resultCount !== 0)) return { complete: false, error: "RESULT_CHANGING_ERROR" as const };
  }
  return { complete: true, error: null };
}

export type InventoryEvaluation = { eligibility: "ELIGIBLE" | "ELIGIBLE_WITH_ALLOWED_UNKNOWNS" | "INELIGIBLE" | "NEEDS_CANDIDATE_INPUT" | "NEEDS_HUMAN_REVIEW" | "INVALID"; sourcePermitted: boolean; legitimate: boolean; evidenceSufficient: boolean; preliminaryUsefulness: boolean; otherwisePlausible: boolean; soleExclusion?: "COMPENSATION_BELOW_MINIMUM" | "COMPENSATION_UNCONFIRMED" | "QUALIFICATION_GAP" | "EVIDENCE_GAP" | "CONSTRAINT_COLLISION" };

export function assessFeasibility(input: { plan: CoveragePlan; inventory: readonly InventoryEvaluation[]; currentSnapshotHash: string; resolutionBlocker: "NONE" | "NEEDS_CANDIDATE_INPUT" | "NEEDS_HUMAN_REVIEW"; expiresAt?: string | null; now?: string }) {
  if (input.plan.snapshotHash !== input.currentSnapshotHash) return { runState: "STALE" as const, outcome: null, preliminarilyDeliverableCount: 0, reviewableCount: 0, excludedCount: input.inventory.length, reasons: [] as FeasibilityReason[], primaryReason: null, checkoutEligible: false };
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= new Date(input.now ?? new Date().toISOString()).getTime()) return { runState: "STALE" as const, outcome: null, preliminarilyDeliverableCount: 0, reviewableCount: 0, excludedCount: input.inventory.length, reasons: [] as FeasibilityReason[], primaryReason: null, checkoutEligible: false };
  const completeness = coverageComplete(input.plan);
  if (!completeness.complete) return { runState: completeness.error === "PENDING" ? "PENDING" as const : "ERROR" as const, outcome: null, preliminarilyDeliverableCount: 0, reviewableCount: 0, excludedCount: input.inventory.length, reasons: [] as FeasibilityReason[], primaryReason: null, checkoutEligible: false };
  const deliverable = input.inventory.filter((job) => ["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"].includes(job.eligibility) && job.sourcePermitted && job.legitimate && job.evidenceSufficient && job.preliminaryUsefulness).length;
  const reviewable = input.inventory.filter((job) => !(["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"].includes(job.eligibility) && job.sourcePermitted && job.legitimate && job.evidenceSufficient && job.preliminaryUsefulness) && (job.eligibility === "NEEDS_CANDIDATE_INPUT" || job.eligibility === "NEEDS_HUMAN_REVIEW" || !job.sourcePermitted || !job.evidenceSufficient) && job.otherwisePlausible).length;
  const excluded = input.inventory.length - deliverable - reviewable;
  const outcome = deliverable >= 10 ? "LIKELY" as const : deliverable + reviewable >= 1 ? "LIMITED" as const : "INFEASIBLE" as const;
  const reasonSet = new Set<FeasibilityReason>();
  for (const job of input.inventory.filter((item) => item.otherwisePlausible && item.soleExclusion)) reasonSet.add(job.soleExclusion!);
  if (!input.inventory.some((item) => item.otherwisePlausible)) reasonSet.add("INVENTORY_SHORTAGE");
  if (input.plan.disposition === "NOT_REQUIRED_CONSTRAINT_COLLISION") reasonSet.add("CONSTRAINT_COLLISION");
  const reasons = feasibilityReasonPrecedence.filter((reason) => reasonSet.has(reason));
  return { runState: "COMPLETE" as const, outcome, preliminarilyDeliverableCount: deliverable, reviewableCount: reviewable, excludedCount: excluded, reasons, primaryReason: reasons[0] ?? null, checkoutEligible: outcome === "LIKELY" && input.resolutionBlocker === "NONE" };
}

export function customerFeasibilityMessage(outcome: "LIKELY" | "LIMITED" | "INFEASIBLE", reason: FeasibilityReason | null) {
  if (outcome === "LIKELY") return "We confirmed at least 10 current jobs that meet the must-haves you selected. ApplyPack has not lowered any rule.";
  const detail = reason === "COMPENSATION_BELOW_MINIMUM" || reason === "COMPENSATION_UNCONFIRMED" ? ", including your minimum compensation" : "";
  return `We could not confirm 10 current jobs that meet all of your must-haves${detail}. You can edit the specific setting, request human review, or leave without paying. ApplyPack has not lowered any rule.`;
}

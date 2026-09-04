import { createHash } from "node:crypto";
import { z } from "zod";

export const CANONICALIZATION_VERSION = "applypack-c14n-v1";
export const SCHEMA_VERSION = "applypack-foundation-v1";
export const CURRENCY = "USD" as const;

const literalEnum = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

export const searchBreadths = ["CLOSE_TO_PREVIOUS_WORK", "ADJACENT_OPPORTUNITIES", "BROADEST_SUPPORTED_SCOPE"] as const;
export const evidenceVerifications = ["EXTRACTED_UNCONFIRMED", "CUSTOMER_CONFIRMED", "HUMAN_VERIFIED", "CUSTOMER_REJECTED", "DISPUTED"] as const;
export const capabilityStatuses = ["CAN_DO_NOW", "DONE_BEFORE_NEEDS_REFRESHER", "BASIC_EXPOSURE", "NOT_DONE", "UNSURE"] as const;
export const evidenceRelations = ["DIRECT", "ADJACENT", "TRANSFERABLE", "UNSUPPORTED"] as const;
export const requirementStrengths = ["REQUIRED", "PREFERRED", "INFORMATIONAL", "UNCLEAR"] as const;
export const criterionResults = ["PASS", "FAIL", "UNKNOWN"] as const;
export const resolutionIssues = ["NONE", "CANDIDATE_MISSING", "EMPLOYER_OMITTED", "PARSER_UNCERTAIN", "EVIDENCE_CONFLICT"] as const;
export const eligibilityDispositions = ["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS", "INELIGIBLE", "NEEDS_CANDIDATE_INPUT", "NEEDS_HUMAN_REVIEW", "INVALID"] as const;
export const unknownTreatments = ["BLOCK", "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING", "IMMATERIAL_ALTERNATIVE"] as const;
export const employerUnknownPolicies = ["EXCLUDE_IF_UNKNOWN", "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING"] as const;
export const componentApplicabilities = ["APPLICABLE", "NOT_APPLICABLE"] as const;
export const salaryStatuses = ["PUBLISHED_MEETS_MINIMUM", "PUBLISHED_OVERLAPS_MINIMUM", "PUBLISHED_BELOW_MINIMUM", "PUBLISHED_NONCOMPARABLE", "UNPUBLISHED", "ESTIMATE_ONLY"] as const;
export const salaryGateDispositions = ["PASS", "FAIL", "ALLOWED_WITH_WARNING", "NEEDS_HUMAN_REVIEW", "NOT_APPLICABLE"] as const;
export const feasibilityRunStates = ["NOT_RUN", "PENDING", "COMPLETE", "STALE", "ERROR"] as const;
export const feasibilityOutcomes = ["LIKELY", "LIMITED", "INFEASIBLE"] as const;
export const feasibilityReasons = ["INVENTORY_SHORTAGE", "QUALIFICATION_GAP", "EVIDENCE_GAP", "CONSTRAINT_COLLISION", "COMPENSATION_BELOW_MINIMUM", "COMPENSATION_UNCONFIRMED"] as const;
export const jobOrigins = ["APPLYPACK_FOUND", "CUSTOMER_SUPPLIED"] as const;
export const applicationReadinesses = ["READY", "NEEDS_CUSTOMER_ACTION", "BLOCKED"] as const;
export const presentationRisks = ["LOW", "MEDIUM", "HIGH", "NOT_ASSESSED"] as const;
export const priorCoverLetterUses = ["FACT_EXTRACTION_ONLY", "FACT_EXTRACTION_AND_VOICE", "NEITHER"] as const;

export type SearchBreadth = (typeof searchBreadths)[number];
export type EvidenceVerification = (typeof evidenceVerifications)[number];
export type CapabilityStatus = (typeof capabilityStatuses)[number];
export type EvidenceRelation = (typeof evidenceRelations)[number];
export type RequirementStrength = (typeof requirementStrengths)[number];
export type CriterionResult = (typeof criterionResults)[number];
export type ResolutionIssue = (typeof resolutionIssues)[number];
export type EligibilityDisposition = (typeof eligibilityDispositions)[number];
export type UnknownTreatment = (typeof unknownTreatments)[number];
export type EmployerUnknownPolicy = (typeof employerUnknownPolicies)[number];
export type ComponentApplicability = (typeof componentApplicabilities)[number];
export type SalaryStatus = (typeof salaryStatuses)[number];
export type SalaryGateDisposition = (typeof salaryGateDispositions)[number];
export type FeasibilityRunState = (typeof feasibilityRunStates)[number];
export type FeasibilityOutcome = (typeof feasibilityOutcomes)[number];
export type FeasibilityReason = (typeof feasibilityReasons)[number];
export type JobOrigin = (typeof jobOrigins)[number];
export type ApplicationReadiness = (typeof applicationReadinesses)[number];
export type PresentationRisk = (typeof presentationRisks)[number];
export type PriorCoverLetterUse = (typeof priorCoverLetterUses)[number];

const criterionBase = z.object({
  stableCriterionId: z.string().uuid(),
  semanticKey: z.string().min(1).max(300),
  strength: literalEnum(requirementStrengths),
  sourceLocator: z.string().min(1).max(1_000),
  parserCertainty: z.number().min(0).max(1),
  version: z.string().min(1).max(100),
});

const boundedString = z.string().trim().min(1).max(300);
const stringSet = z.array(boundedString).max(100);

export const typedCriterionSchema = z.discriminatedUnion("kind", [
  criterionBase.extend({ kind: z.literal("WORK_MODE"), modes: z.array(z.enum(["REMOTE", "HYBRID", "ONSITE"])).min(1), locationRestrictions: stringSet }),
  criterionBase.extend({ kind: z.literal("GEOGRAPHY"), country: z.literal("US"), statesOrDc: stringSet, polarity: z.enum(["ALLOW", "DENY"]), relocationRequired: z.boolean().nullable() }),
  criterionBase.extend({ kind: z.literal("COMMUTE"), maximum: z.number().nonnegative(), unit: z.enum(["MILES", "MINUTES"]), method: z.enum(["DRIVE", "TRANSIT", "ANY"]), originRegion: boundedString }),
  criterionBase.extend({ kind: z.literal("EMPLOYMENT_TYPE"), employmentTypes: z.array(z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY"])).min(1) }),
  criterionBase.extend({ kind: z.literal("COMPENSATION"), currency: z.literal("USD"), period: z.enum(["HOUR", "YEAR"]), lowerCents: z.number().int().nonnegative().nullable(), upperCents: z.number().int().nonnegative().nullable(), basis: z.enum(["BASE", "GUARANTEED_TOTAL", "VARIABLE_OTE"]), workerClass: z.enum(["EMPLOYEE", "CONTRACTOR"]), source: boundedString, comparisonMethod: boundedString }),
  criterionBase.extend({ kind: z.literal("SCHEDULE"), days: stringSet, startTime: z.string().nullable(), endTime: z.string().nullable(), timeZone: z.string().nullable(), shift: z.string().nullable(), weekend: z.boolean().nullable(), evening: z.boolean().nullable(), onCall: z.boolean().nullable(), flexible: z.boolean().nullable() }),
  criterionBase.extend({ kind: z.literal("TRAVEL_PHYSICAL"), normalizedDemand: boundedString, threshold: z.number().nonnegative().nullable(), unit: z.string().nullable(), accommodationNeutral: z.literal(true) }),
  criterionBase.extend({ kind: z.literal("DUTY_EXCLUSION"), duty: boundedString, customerConfirmed: z.literal(true) }),
  criterionBase.extend({ kind: z.literal("AUTHORIZATION_SPONSORSHIP"), employerRule: boundedString, customerStatus: boundedString, inferred: z.literal(false) }),
  criterionBase.extend({ kind: z.literal("EDUCATION"), level: boundedString, allowedFields: stringSet, completionStatus: boundedString, equivalencyLanguage: z.string().nullable() }),
  criterionBase.extend({ kind: z.literal("CERTIFICATION_LICENSE"), credential: boundedString, status: z.enum(["ACTIVE", "EXPIRED", "UNKNOWN"]), jurisdiction: z.string().nullable() }),
  criterionBase.extend({ kind: z.literal("EXPERIENCE"), responsibilityOrDomain: boundedString, minimumMonths: z.number().int().nonnegative(), fteExplicit: z.boolean(), permittedEquivalents: stringSet, seniorityOrScope: z.string().nullable() }),
  criterionBase.extend({ kind: z.literal("RESPONSIBILITY"), activity: boundedString, centrality: z.enum(["CENTRAL", "SECONDARY"]), complexity: z.string().nullable(), autonomy: z.string().nullable(), scope: z.string().nullable(), frequency: z.string().nullable() }),
  criterionBase.extend({ kind: z.literal("TOOL_CAPABILITY"), toolOrTaskCluster: boundedString, proficiency: z.enum(["CURRENT", "PRIOR_USE", "FAMILIARITY"]) }),
  criterionBase.extend({ kind: z.literal("BENEFIT"), benefit: boundedString, employerConfirmation: z.enum(["CONFIRMED", "UNKNOWN"])}),
  criterionBase.extend({ kind: z.literal("INDUSTRY_DOMAIN"), domain: boundedString, polarity: z.enum(["ALLOW", "PREFER", "AVOID_SOFT", "DENY_HARD"])}),
  criterionBase.extend({ kind: z.literal("CUSTOMER_TITLE_RESTRICTION"), titles: stringSet, matching: z.enum(["EXACT", "TITLE_FAMILY"]), customerHard: z.literal(true)}),
  criterionBase.extend({ kind: z.literal("CUSTOM_EXCLUSION"), supportedVariant: boundedString, operator: z.enum(["EQ", "NE", "IN", "NOT_IN", "GTE", "LTE"]), thresholdOrValue: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]), unknownPolicy: literalEnum(employerUnknownPolicies), customerReconfirmed: z.literal(true)}),
  criterionBase.extend({ kind: z.literal("LISTING_APPLICATION_PATH"), identity: boundedString, activeStatus: z.enum(["ACTIVE", "INACTIVE", "UNKNOWN"]), sourceAuthorized: z.boolean(), applicationPath: z.enum(["ACTIONABLE", "MISSING", "UNSAFE", "UNKNOWN"]), hostType: z.enum(["EMPLOYER_HOSTED", "APPROVED_THIRD_PARTY"])}),
]);

export type TypedCriterion = z.infer<typeof typedCriterionSchema>;

export type RequirementNode =
  | { kind: "ALL_OF"; children: RequirementNode[] }
  | { kind: "ANY_OF"; children: RequirementNode[] }
  | { kind: "CRITERION"; criterion: TypedCriterion };

export const requirementNodeSchema: z.ZodType<RequirementNode> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ALL_OF"), children: z.array(requirementNodeSchema).min(1) }),
  z.object({ kind: z.literal("ANY_OF"), children: z.array(requirementNodeSchema).min(1) }),
  z.object({ kind: z.literal("CRITERION"), criterion: typedCriterionSchema }),
]));

export const candidateFactSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DOCUMENT"), documentVersionId: z.string().uuid(), locator: boundedString }),
  z.object({ kind: z.literal("CUSTOMER_ASSERTION"), snapshotId: z.string().uuid(), controlId: boundedString }),
  z.object({ kind: z.literal("HUMAN_VERIFICATION"), suppliedSourceId: z.string().uuid(), locator: boundedString, reviewerId: z.string().uuid() }),
]);

export type CandidateFactSource = z.infer<typeof candidateFactSourceSchema>;

export const experienceKinds = ["PAID_EMPLOYMENT", "SELF_EMPLOYMENT_BUSINESS", "CONTRACT_FREELANCE", "VOLUNTEER", "PROJECT", "EDUCATION", "CAREER_BREAK", "CAREGIVING"] as const;
export type ExperienceKind = (typeof experienceKinds)[number];

export const candidateFactSchema = z.object({
  id: z.string().uuid(),
  semanticKey: boundedString,
  valueKind: boundedString,
  value: z.record(z.string(), z.unknown()),
  source: candidateFactSourceSchema,
  extractionConfidence: z.number().min(0).max(1).nullable(),
  verification: literalEnum(evidenceVerifications),
  confirmedOrCorrectedAt: z.string().datetime().nullable(),
  catalogVersion: boundedString,
  schemaVersion: boundedString,
  startsOn: z.string().date().nullable(),
  endsOn: z.string().date().nullable(),
  calendarMonths: z.number().int().nonnegative().nullable(),
  intensityPercent: z.number().min(0).max(100).nullable(),
  capabilityStatus: literalEnum(capabilityStatuses).nullable(),
  supersedesFactId: z.string().uuid().nullable(),
  conflictId: z.string().uuid().nullable(),
});

export type CandidateFact = z.infer<typeof candidateFactSchema>;

export function factMaySupportHardRequirement(fact: CandidateFact) {
  if (fact.verification === "CUSTOMER_CONFIRMED") return true;
  return fact.verification === "HUMAN_VERIFIED" && fact.source.kind === "HUMAN_VERIFICATION";
}

export function occupationalCreditAllowed(kind: ExperienceKind) {
  return !["CAREER_BREAK", "CAREGIVING"].includes(kind);
}

export type DateInterval = { start: string; end: string };

export function overlapSafeCalendarDays(intervals: readonly DateInterval[]) {
  const ranges = intervals.map(({ start, end }) => {
    const from = Date.parse(`${start}T00:00:00.000Z`);
    const to = Date.parse(`${end}T00:00:00.000Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) throw new Error("invalid_date_interval");
    return [from, to + 86_400_000] as const;
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let start = 0;
  let end = 0;
  for (const [nextStart, nextEnd] of ranges) {
    if (!end) { start = nextStart; end = nextEnd; continue; }
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else { total += end - start; start = nextStart; end = nextEnd; }
  }
  if (end) total += end - start;
  return total / 86_400_000;
}

export const lifecycleValues = {
  draft: ["IN_PROGRESS", "COMPLETE", "LOCKED_TO_CHECKOUT", "CONVERTED", "EXPIRED"],
  resumeProcessing: ["UPLOADED", "QUARANTINED", "SCANNING", "EXTRACTING", "READY", "FAILED", "SUPERSEDED"],
  feasibility: feasibilityRunStates,
  resolutionBlocker: ["NONE", "NEEDS_CANDIDATE_INPUT", "NEEDS_HUMAN_REVIEW"],
  allocation: ["NONE", "RESERVED", "CONSUMED", "COMPLETED", "SUPERSEDED", "RELEASED", "EXPIRED"],
  debit: ["NONE", "HELD", "SPENT", "RETURNED"],
  checkout: ["NONE", "OPEN", "CANCELED", "EXPIRED", "COMPLETED", "FAILED"],
  settlement: ["UNPAID", "PROCESSING", "PAID", "FAILED"],
  dispute: ["NONE", "OPEN", "WON", "LOST"],
  refundOperation: ["PENDING", "SUCCEEDED", "FAILED"],
  refundScope: ["FULL_SEARCH", "DUPLICATE_ATTEMPT", "STALE_ATTEMPT", "MATERIAL_LINE"],
  searchFulfillment: ["QUEUED", "RESEARCHING", "HUMAN_REVIEW", "ADJUSTMENT_REQUIRED", "READY_TO_RELEASE", "DELIVERED", "CANCELED"],
  adjustment: ["NONE", "PROPOSED", "ACCEPTED", "DECLINED", "EXPIRED"],
  outbox: ["QUEUED", "SENDING", "SENT", "RETRY", "DEAD_LETTER"],
  materialReadiness: ["PENDING", "BLOCKED_ON_CUSTOMER_INPUT", "CHECKOUT_ELIGIBLE"],
  materialFulfillment: ["NOT_PURCHASED", "PAID", "GENERATING", "HUMAN_REVIEW", "READY_TO_RELEASE", "DELIVERED", "CANCELED"],
  materialSubstitution: ["NONE", "REQUIRED", "OFFERED", "ACCEPTED", "DECLINED", "EXPIRED"],
} as const;

type AllocationState = (typeof lifecycleValues.allocation)[number];
type DebitDisposition = (typeof lifecycleValues.debit)[number];

export function validAllocationDebit(state: AllocationState, debit: DebitDisposition) {
  if (state === "NONE") return debit === "NONE";
  if (state === "RESERVED") return debit === "HELD";
  if (["CONSUMED", "COMPLETED"].includes(state)) return debit === "SPENT";
  if (state === "SUPERSEDED") return debit === "SPENT" || debit === "RETURNED";
  return debit === "RETURNED";
}

export function capacityAvailable(totalUnits: number, allocations: readonly { units: number; debitDisposition: DebitDisposition }[]) {
  if (!Number.isInteger(totalUnits) || totalUnits < 0) throw new Error("invalid_capacity_total");
  const debited = allocations.filter(({ debitDisposition }) => debitDisposition === "HELD" || debitDisposition === "SPENT")
    .reduce((sum, { units }) => {
      if (!Number.isInteger(units) || units < 1) throw new Error("invalid_capacity_units");
      return sum + units;
    }, 0);
  return Math.max(0, totalUnits - debited);
}

export type RefundOperation = { idempotencyKey: string; amountCents: number; state: "PENDING" | "SUCCEEDED" | "FAILED"; required: boolean; superseded?: boolean };
export type ScopedRefundOperation = RefundOperation & { paymentAttemptId: string; scope: "FULL_SEARCH" | "DUPLICATE_ATTEMPT" | "STALE_ATTEMPT" | "MATERIAL_LINE" };

export function deriveRefundAggregate(paidAmountCents: number, operations: readonly RefundOperation[]) {
  if (!Number.isInteger(paidAmountCents) || paidAmountCents <= 0) throw new Error("invalid_paid_amount");
  const active = operations.filter(({ superseded }) => !superseded);
  const unique = new Map<string, RefundOperation>();
  for (const operation of active) {
    if (!Number.isInteger(operation.amountCents) || operation.amountCents <= 0) throw new Error("invalid_refund_amount");
    const previous = unique.get(operation.idempotencyKey);
    if (previous && JSON.stringify(previous) !== JSON.stringify(operation)) throw new Error("conflicting_refund_idempotency_key");
    unique.set(operation.idempotencyKey, operation);
  }
  const rows = [...unique.values()];
  const refundedAmountCents = rows.filter(({ state }) => state === "SUCCEEDED").reduce((sum, row) => sum + row.amountCents, 0);
  if (refundedAmountCents > paidAmountCents) throw new Error("refund_total_exceeds_payment");
  const aggregate = refundedAmountCents === paidAmountCents ? "FULL"
    : rows.some(({ state }) => state === "PENDING") ? "PENDING"
      : rows.some(({ state, required }) => state === "FAILED" && required) ? "FAILED"
        : refundedAmountCents > 0 ? "PARTIAL" : "NONE";
  return { aggregate: aggregate as "NONE" | "PENDING" | "PARTIAL" | "FULL" | "FAILED", refundedAmountCents, fullyRefunded: aggregate === "FULL" };
}

export function deriveServiceRefundProjection(
  winningPaymentAttemptId: string,
  paidAmountCents: number,
  operations: readonly ScopedRefundOperation[],
) {
  const active = operations.filter(({ superseded }) => !superseded);
  const fullServiceOperations = active.filter(({ paymentAttemptId, scope }) => paymentAttemptId === winningPaymentAttemptId && scope === "FULL_SEARCH");
  const aggregate = deriveRefundAggregate(paidAmountCents, fullServiceOperations);
  if (aggregate.aggregate === "PARTIAL") throw new Error("full_service_refund_amount_mismatch");
  const fullRefund = aggregate.aggregate === "FULL" ? "SUCCEEDED"
    : aggregate.aggregate === "PENDING" ? "PENDING"
      : aggregate.aggregate === "FAILED" ? "FAILED" : "NONE";
  return {
    fullRefund: fullRefund as "NONE" | "PENDING" | "FAILED" | "SUCCEEDED",
    secondaryOperations: active.filter(({ paymentAttemptId, scope }) => paymentAttemptId !== winningPaymentAttemptId || scope !== "FULL_SEARCH"),
  };
}
export type ProjectionInput = {
  fullRefund: "NONE" | "PENDING" | "FAILED" | "SUCCEEDED";
  dispute: "NONE" | "OPEN" | "WON" | "LOST";
  delivered: boolean;
  adjustmentRequired: boolean;
  resolutionBlocker: "NONE" | "NEEDS_CANDIDATE_INPUT" | "NEEDS_HUMAN_REVIEW";
  capacityException: boolean;
  paymentProcessing: boolean;
  checkoutOpen: boolean;
  feasibility: "NOT_RUN" | "PENDING" | "ERROR" | "LIMITED" | "INFEASIBLE" | "LIKELY";
  researchingOrReview: boolean;
  intakeComplete: boolean;
};

export function projectCustomerState(input: ProjectionInput) {
  if (input.fullRefund === "SUCCEEDED") return "Refunded";
  if (input.fullRefund === "PENDING") return "Refund processing";
  if (input.fullRefund === "FAILED") return "Refund problem";
  if (!input.delivered && (input.dispute === "OPEN" || input.dispute === "LOST")) return "Payment problem";
  if (input.delivered) return "Delivered";
  if (input.adjustmentRequired) return "Adjustment required";
  if (input.resolutionBlocker === "NEEDS_CANDIDATE_INPUT") return "Needs your confirmation";
  if (input.resolutionBlocker === "NEEDS_HUMAN_REVIEW") return "Human review";
  if (input.capacityException) return "Capacity problem";
  if (input.paymentProcessing) return "Payment processing";
  if (input.checkoutOpen) return "Checkout open";
  if (input.feasibility === "PENDING" || input.feasibility === "ERROR" || input.feasibility === "LIMITED" || input.feasibility === "INFEASIBLE") return `Feasibility ${input.feasibility.toLowerCase()}`;
  if (input.researchingOrReview) return "Researching";
  if (input.intakeComplete) return "Intake complete";
  return "Draft";
}

function normalizeText(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}

function pathMatches(path: string, patterns: ReadonlySet<string>) {
  return patterns.has(path);
}

export function canonicalize(value: unknown, options: { setPaths?: readonly string[]; comparisonKeyPaths?: readonly string[] } = {}, path = "$"): unknown {
  const setPaths = new Set(options.setPaths ?? []);
  const comparisonPaths = new Set(options.comparisonKeyPaths ?? []);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    return pathMatches(path, comparisonPaths) ? normalized.toLowerCase() : normalized;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number");
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value.map((item, index) => canonicalize(item, options, `${path}[${index}]`));
    if (!pathMatches(path, setPaths)) return items;
    const keyed = new Map(items.map((item) => [stableStringify(item), item]));
    return [...keyed.entries()].sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1).map(([, item]) => item);
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1)
      .map(([key, entry]) => [key, canonicalize(entry, options, `${path}.${key}`)]));
  }
  throw new Error("unsupported_canonical_value");
}

export function stableStringify(value: unknown, options?: Parameters<typeof canonicalize>[1]) {
  return JSON.stringify(canonicalize(value, options));
}

export function canonicalSha256(value: unknown, options?: Parameters<typeof canonicalize>[1]) {
  return createHash("sha256").update(stableStringify(value, options), "utf8").digest("hex");
}

export function semanticComparisonKey(value: string) {
  return normalizeText(value).toLowerCase();
}

export function jobFingerprint(company: string | null, title: string | null, location: string | null) {
  const component = (value: string | null) => value === null ? "␀" : semanticComparisonKey(value);
  return canonicalSha256([component(company), component(title), component(location)]);
}

export function customerSuppliedIngestionEnabled(environment: Partial<NodeJS.ProcessEnv> = process.env) {
  return environment.APP_CUSTOMER_SUPPLIED_JOBS_ENABLED === "true";
}

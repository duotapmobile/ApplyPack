import { describe, expect, it } from "vitest";
import {
  CANONICALIZATION_VERSION,
  candidateFactSchema,
  canonicalSha256,
  canonicalize,
  capacityAvailable,
  customerSuppliedIngestionEnabled,
  deriveRefundAggregate,
  deriveServiceRefundProjection,
  factMaySupportHardRequirement,
  jobFingerprint,
  occupationalCreditAllowed,
  overlapSafeCalendarDays,
  projectCustomerState,
  requirementNodeSchema,
  semanticComparisonKey,
  typedCriterionSchema,
  validAllocationDebit,
} from "@/lib/domain/foundation";

const base = {
  stableCriterionId: "10000000-0000-4000-8000-000000000001",
  semanticKey: "criterion.key",
  strength: "REQUIRED",
  sourceLocator: "listing:1",
  parserCertainty: 1,
  version: "v1",
} as const;

const variants = [
  { kind: "WORK_MODE", modes: ["REMOTE"], locationRestrictions: [] },
  { kind: "GEOGRAPHY", country: "US", statesOrDc: ["DC"], polarity: "ALLOW", relocationRequired: null },
  { kind: "COMMUTE", maximum: 30, unit: "MILES", method: "ANY", originRegion: "22102" },
  { kind: "EMPLOYMENT_TYPE", employmentTypes: ["FULL_TIME"] },
  { kind: "COMPENSATION", currency: "USD", period: "YEAR", lowerCents: 5000000, upperCents: null, basis: "BASE", workerClass: "EMPLOYEE", source: "listing", comparisonMethod: "annual-base" },
  { kind: "SCHEDULE", days: ["MONDAY"], startTime: null, endTime: null, timeZone: null, shift: null, weekend: false, evening: false, onCall: null, flexible: true },
  { kind: "TRAVEL_PHYSICAL", normalizedDemand: "travel", threshold: 10, unit: "PERCENT", accommodationNeutral: true },
  { kind: "DUTY_EXCLUSION", duty: "cold calling", customerConfirmed: true },
  { kind: "AUTHORIZATION_SPONSORSHIP", employerRule: "US work authorization", customerStatus: "authorized", inferred: false },
  { kind: "EDUCATION", level: "bachelor", allowedFields: [], completionStatus: "complete", equivalencyLanguage: null },
  { kind: "CERTIFICATION_LICENSE", credential: "PMP", status: "ACTIVE", jurisdiction: null },
  { kind: "EXPERIENCE", responsibilityOrDomain: "operations", minimumMonths: 24, fteExplicit: false, permittedEquivalents: [], seniorityOrScope: null },
  { kind: "RESPONSIBILITY", activity: "coordinate", centrality: "CENTRAL", complexity: null, autonomy: null, scope: null, frequency: null },
  { kind: "TOOL_CAPABILITY", toolOrTaskCluster: "spreadsheets", proficiency: "CURRENT" },
  { kind: "BENEFIT", benefit: "health insurance", employerConfirmation: "CONFIRMED" },
  { kind: "INDUSTRY_DOMAIN", domain: "healthcare", polarity: "DENY_HARD" },
  { kind: "CUSTOMER_TITLE_RESTRICTION", titles: ["Coordinator"], matching: "TITLE_FAMILY", customerHard: true },
  { kind: "CUSTOM_EXCLUSION", supportedVariant: "no commission", operator: "EQ", thresholdOrValue: false, unknownPolicy: "EXCLUDE_IF_UNKNOWN", customerReconfirmed: true },
  { kind: "LISTING_APPLICATION_PATH", identity: "employer ATS", activeStatus: "ACTIVE", sourceAuthorized: true, applicationPath: "ACTIONABLE", hostType: "EMPLOYER_HOSTED" },
] as const;

describe("corrected-contract typed domain", () => {
  it("accepts every typed criterion variant and rejects unknown or untyped payloads", () => {
    for (const variant of variants) expect(typedCriterionSchema.safeParse({ ...base, ...variant }).success, variant.kind).toBe(true);
    expect(typedCriterionSchema.safeParse({ ...base, kind: "FREE_TEXT", value: "anything" }).success).toBe(false);
    expect(requirementNodeSchema.safeParse({ kind: "ALL_OF", children: [{ kind: "CRITERION", criterion: { ...base, ...variants[0] } }] }).success).toBe(true);
    expect(requirementNodeSchema.safeParse({ kind: "ALL_OF", children: [] }).success).toBe(false);
  });

  it("enforces source provenance and hard-gate verification boundaries", () => {
    const common = { id: "20000000-0000-4000-8000-000000000001", semanticKey: "employment.company", valueKind: "string", value: { text: "Example" }, extractionConfidence: 0.9, confirmedOrCorrectedAt: null, catalogVersion: "facts-v1", schemaVersion: "v1", startsOn: null, endsOn: null, calendarMonths: null, intensityPercent: null, capabilityStatus: null, supersedesFactId: null, conflictId: null };
    const document = candidateFactSchema.parse({ ...common, source: { kind: "DOCUMENT", documentVersionId: "30000000-0000-4000-8000-000000000001", locator: "page 1 line 4" }, verification: "EXTRACTED_UNCONFIRMED" });
    expect(factMaySupportHardRequirement(document)).toBe(false);
    expect(factMaySupportHardRequirement({ ...document, verification: "CUSTOMER_CONFIRMED" })).toBe(true);
    expect(factMaySupportHardRequirement(candidateFactSchema.parse({ ...common, source: { kind: "HUMAN_VERIFICATION", suppliedSourceId: "40000000-0000-4000-8000-000000000001", locator: "license registry", reviewerId: "50000000-0000-4000-8000-000000000001" }, verification: "HUMAN_VERIFIED" }))).toBe(true);
    const assertion = candidateFactSchema.parse({ ...common, source: { kind: "CUSTOMER_ASSERTION", snapshotId: "60000000-0000-4000-8000-000000000001", controlId: "capability-control" }, verification: "CUSTOMER_CONFIRMED" });
    expect(factMaySupportHardRequirement(assertion)).toBe(true);
    expect(factMaySupportHardRequirement({ ...assertion, verification: "DISPUTED" })).toBe(false);
    expect(candidateFactSchema.safeParse({ ...common, source: { kind: "CUSTOMER_ASSERTION", controlId: "answer" }, verification: "CUSTOMER_CONFIRMED" }).success).toBe(false);
    expect(candidateFactSchema.safeParse({ ...common, source: { kind: "DOCUMENT", documentVersionId: "invented" }, verification: "DISPUTED" }).success).toBe(false);
  });

  it("merges overlapping calendar intervals and never credits caregiving as occupation", () => {
    expect(overlapSafeCalendarDays([{ start: "2026-01-01", end: "2026-01-10" }, { start: "2026-01-05", end: "2026-01-15" }])).toBe(15);
    expect(occupationalCreditAllowed("PAID_EMPLOYMENT")).toBe(true);
    expect(occupationalCreditAllowed("CAREGIVING")).toBe(false);
    expect(occupationalCreditAllowed("CAREER_BREAK")).toBe(false);
  });

  it("canonicalizes deterministically without collapsing null, sequence order, or meaningful numbers", () => {
    const left = { z: null, text: "Cafe\u0301  role", sequence: [2, 1], tags: ["B", "a", "B"], cents: 101 };
    const right = { cents: 101, tags: ["a", "B"], sequence: [2, 1], text: "Café role", z: null };
    const options = { setPaths: ["$.tags"], comparisonKeyPaths: ["$.tags[0]", "$.tags[1]", "$.tags[2]"] };
    expect(canonicalSha256(left, options)).toBe(canonicalSha256(right, options));
    expect(canonicalSha256({ value: null })).not.toBe(canonicalSha256({}));
    expect(canonicalSha256({ sequence: [1, 2] })).not.toBe(canonicalSha256({ sequence: [2, 1] }));
    expect(canonicalSha256({ cents: 101 })).not.toBe(canonicalSha256({ cents: 100 }));
    expect(semanticComparisonKey("  RÉSUMÉ\tWriter ")).toBe("résumé writer");
    expect(jobFingerprint("Co", "Role", null)).toBe(jobFingerprint("  co ", "ROLE", null));
    expect(CANONICALIZATION_VERSION).toBe("applypack-c14n-v1");
    expect(canonicalize(new Date("2026-09-04T12:00:00-04:00"))).toBe("2026-09-04T16:00:00.000Z");
  });

  it("keeps orthogonal lifecycle and integer financial/capacity rules", () => {
    expect(validAllocationDebit("RESERVED", "HELD")).toBe(true);
    expect(validAllocationDebit("COMPLETED", "RETURNED")).toBe(false);
    expect(validAllocationDebit("SUPERSEDED", "SPENT")).toBe(true);
    expect(capacityAvailable(10, [{ units: 2, debitDisposition: "HELD" }, { units: 3, debitDisposition: "SPENT" }, { units: 4, debitDisposition: "RETURNED" }])).toBe(5);
    expect(deriveRefundAggregate(2000, [{ idempotencyKey: "line-1", amountCents: 800, state: "SUCCEEDED", required: true }])).toEqual({ aggregate: "PARTIAL", refundedAmountCents: 800, fullyRefunded: false });
    expect(deriveRefundAggregate(2000, [{ idempotencyKey: "full", amountCents: 2000, state: "SUCCEEDED", required: true }]).aggregate).toBe("FULL");
    expect(deriveRefundAggregate(2000, [{ idempotencyKey: "pending", amountCents: 2000, state: "PENDING", required: true }]).aggregate).toBe("PENDING");
    expect(deriveRefundAggregate(2000, [{ idempotencyKey: "failed", amountCents: 2000, state: "FAILED", required: true }]).aggregate).toBe("FAILED");
    const secondaryOnly = deriveServiceRefundProjection("winning", 2000, [
      { paymentAttemptId: "duplicate", scope: "DUPLICATE_ATTEMPT", idempotencyKey: "duplicate", amountCents: 2000, state: "SUCCEEDED", required: true },
      { paymentAttemptId: "winning", scope: "STALE_ATTEMPT", idempotencyKey: "stale", amountCents: 2000, state: "SUCCEEDED", required: true },
      { paymentAttemptId: "winning", scope: "MATERIAL_LINE", idempotencyKey: "line", amountCents: 800, state: "SUCCEEDED", required: true },
    ]);
    expect(secondaryOnly).toMatchObject({ fullRefund: "NONE", secondaryOperations: { length: 3 } });
    expect(deriveServiceRefundProjection("winning", 2000, [
      { paymentAttemptId: "winning", scope: "FULL_SEARCH", idempotencyKey: "full", amountCents: 2000, state: "SUCCEEDED", required: true },
    ]).fullRefund).toBe("SUCCEEDED");
    expect(projectCustomerState({ fullRefund: "NONE", dispute: "WON", delivered: false, adjustmentRequired: false, resolutionBlocker: "NONE", capacityException: false, paymentProcessing: false, checkoutOpen: false, feasibility: "LIKELY", researchingOrReview: true, intakeComplete: true })).toBe("Researching");
    expect(projectCustomerState({ fullRefund: "NONE", dispute: "LOST", delivered: false, adjustmentRequired: false, resolutionBlocker: "NONE", capacityException: false, paymentProcessing: false, checkoutOpen: false, feasibility: "LIKELY", researchingOrReview: false, intakeComplete: true })).toBe("Payment problem");
  });

  it("keeps customer-supplied ingestion off by default", () => {
    expect(customerSuppliedIngestionEnabled({})).toBe(false);
    expect(customerSuppliedIngestionEnabled({ APP_CUSTOMER_SUPPLIED_JOBS_ENABLED: "true" })).toBe(true);
  });
});

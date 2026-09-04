import { describe, expect, it } from "vitest";
import {
  activityCatalog, breadthChoices, businessSystemTasks, capabilityChoices, clearInapplicableCommute,
  dealbreakerCatalog, emptyFourStepDraft, excelTasks, fourStepDraftSchema, parseCompensationInput,
  relevantToolFamilies, safeIntakeEvent, stateOrDcOptions, validateFourStep, type FourStepDraft,
} from "@/lib/intake/four-step";

describe("four-step intake contract", () => {
  it("locks the governed choice cardinalities and visible adjacent default", () => {
    expect(breadthChoices).toHaveLength(3);
    expect(emptyFourStepDraft.searchBreadth).toBe("ADJACENT_OPPORTUNITIES");
    expect(capabilityChoices).toHaveLength(5);
    expect(excelTasks).toHaveLength(10);
    expect(businessSystemTasks).toHaveLength(7);
    expect(dealbreakerCatalog.map(([id]) => id)).toEqual(["SALES","COMMISSION_ONLY","COLD_CALLING","HEAVY_PHONE","REQUIRED_TRAVEL","PHYSICAL_LABOR","SOMETHING_ELSE"]);
    expect(stateOrDcOptions).toHaveLength(51);
    expect(activityCatalog.length).toBeGreaterThan(10);
  });

  it("validates only required and applicable controls", () => {
    const base = { ...emptyFourStepDraft, fullName: "Test Person", email: "test@example.invalid" };
    expect(validateFourStep(0, base, { resume: null, facts: [], presentedFactIds: new Set() }).map((error) => error.fieldId)).toEqual(["resume"]);
    expect(validateFourStep(1, base, { resume: null, facts: [], presentedFactIds: new Set() })[0].fieldId).toBe("desired-activities");
    expect(validateFourStep(1, { ...base, guidanceRequested: true }, { resume: null, facts: [], presentedFactIds: new Set() })).toEqual([]);
  });

  it("requires a presented affirmative outcome for every search-critical fact", () => {
    const fact = { id: "10000000-0000-4000-8000-000000000001", semanticKey: "role", displayLabel: "Role", displayValue: "Coordinator",
      tier: "SEARCH_CRITICAL" as const, verification: "EXTRACTED_UNCONFIRMED" as const, documentVersionId: "20000000-0000-4000-8000-000000000001", sourceLocator: "page 1" };
    expect(validateFourStep(2, emptyFourStepDraft, { resume: null, facts: [fact], presentedFactIds: new Set() })[0].fieldId).toBe(`fact-${fact.id}`);
    const reviewed = { ...emptyFourStepDraft, factReviews: { [fact.id]: "CONFIRM" as const } };
    expect(validateFourStep(2, reviewed, { resume: null, facts: [fact], presentedFactIds: new Set([fact.id]) })).toEqual([]);
  });

  it("clears hidden commute values and preserves distinct salary semantics", () => {
    const cleared = clearInapplicableCommute({ ...emptyFourStepDraft, workModes: ["REMOTE"], zipCode: "22201", commuteDistanceMiles: 25 });
    expect(cleared.zipCode).toBe(""); expect(cleared.commuteDistanceMiles).toBeNull();
    expect(parseCompensationInput("$70,000")).toBe(7_000_000);
    expect(parseCompensationInput("31.50")).toBe(3150);
    expect(Number.isNaN(parseCompensationInput("unknown"))).toBe(true);
  });

  it("asks task-based tool questions adaptively without inferring advanced capability", () => {
    expect(relevantToolFamilies({ ...emptyFourStepDraft, desiredActivities: ["PREPARING_REPORTS"] })).toEqual({ excel: true, systems: false });
    expect(relevantToolFamilies(emptyFourStepDraft, ["used a CRM"])).toEqual({ excel: false, systems: true });
    expect(emptyFourStepDraft.capabilities.SYSTEM_SQL).toBeUndefined();
  });

  it("rejects arbitrary analytics and unknown draft fields", () => {
    expect(safeIntakeEvent({ event: "STEP_VIEWED", step: 1 }).success).toBe(true);
    expect(safeIntakeEvent({ event: "STEP_VIEWED", step: 1, email: "pii@example.invalid" }).success).toBe(false);
    expect(safeIntakeEvent({ event: "FIELD_VALUE", step: 1 }).success).toBe(false);
    expect(fourStepDraftSchema.safeParse({ ...emptyFourStepDraft, workAuthorization: "not allowed" }).success).toBe(false);
  });

  it("rejects a target below a firm minimum and requires criterion-specific unknown policy", () => {
    const value: FourStepDraft = { ...emptyFourStepDraft, workModes: ["REMOTE"], stateOrDc: "VA", employmentTypes: ["FULL_TIME"],
      salaryTargetCents: 4_000_000, salaryHardMinimumCents: 5_000_000, salaryPeriod: "YEAR" as const, salaryBasis: "BASE" as const,
      dealbreakers: ["SALES"], termsAccepted: true };
    expect(validateFourStep(3, value, { resume: null, facts: [], presentedFactIds: new Set() }).map((error) => error.fieldId)).toEqual(["salary-target", "unknown-sales"]);
  });
});

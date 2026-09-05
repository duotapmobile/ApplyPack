import { describe, expect, it } from "vitest";
import {
  activityCatalog, breadthChoices, buildFourStepSnapshot, businessSystemTasks, capabilityChoices,
  clearInapplicableCommute, dealbreakerCatalog, emptyFactCorrection, emptyFourStepDraft, excelTasks,
  factCorrectionCategories, factCorrectionIsComplete, factCorrectionSchema, fourStepDraftSchema,
  hardEmployerCriteria, normalizedFourStepDraft, parseCompensationInput, recommendedFactCorrectionCategory,
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
    expect(validateFourStep(3, value, { resume: null, facts: [], presentedFactIds: new Set() }).map((error) => error.fieldId)).toEqual(["salary-target", "unknown-dealbreaker-sales"]);
  });

  it("normalizes hidden preferences and title restrictions before persistence", () => {
    const normalized = normalizedFourStepDraft({
      ...emptyFourStepDraft,
      searchBreadth: "ADJACENT_OPPORTUNITIES",
      targetTitles: ["Coordinator"],
      titleRestrictionConfirmed: true,
      workModes: ["REMOTE"],
      preferredWorkMode: "HYBRID",
      employmentTypes: ["FULL_TIME"],
      preferredEmploymentType: "PART_TIME",
      avoidedActivities: [],
      workConditionPreferences: { "activity:SALES": "DEALBREAKER", TRAVEL: "WOULD_PREFER" },
      employerUnknownPolicies: { "work_condition:activity:SALES": "EXCLUDE_IF_UNKNOWN", stale: "EXCLUDE_IF_UNKNOWN" },
      salaryNoncomparablePolicy: "INCLUDE_WITH_WARNING",
    });
    expect(normalized.titleRestrictionConfirmed).toBe(false);
    expect(normalized.preferredWorkMode).toBe("");
    expect(normalized.preferredEmploymentType).toBe("");
    expect(normalized.workConditionPreferences).toEqual({ TRAVEL: "WOULD_PREFER" });
    expect(normalized.employerUnknownPolicies).toEqual({});
    expect(normalized.salaryNoncomparablePolicy).toBe("EXCLUDE");
  });

  it("preserves every selected preference in the immutable snapshot mapping", () => {
    const draft: FourStepDraft = {
      ...emptyFourStepDraft,
      email: " Person@Example.Invalid ",
      workModes: ["REMOTE", "HYBRID"],
      preferredWorkMode: "REMOTE",
      employmentTypes: ["FULL_TIME", "PART_TIME"],
      preferredEmploymentType: "PART_TIME",
      avoidedActivities: ["SUPPORTING_CUSTOMERS"],
      workConditionPreferences: { TRAVEL: "MUST_HAVE", "activity:SUPPORTING_CUSTOMERS": "WOULD_PREFER" },
      benefits: { mustHave: ["Health insurance"], wouldPrefer: ["Paid time off"], openTo: [] },
      employerUnknownPolicies: {
        "work_condition:TRAVEL": "EXCLUDE_IF_UNKNOWN",
        "benefit:Health insurance": "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING",
      },
    };
    const snapshot = buildFourStepSnapshot(draft, "a".repeat(64), "applypack-c14n-v1");
    expect(snapshot.accessEmailNormalized).toBe("person@example.invalid");
    expect(snapshot.preferredWorkMode).toBe("REMOTE");
    expect(snapshot.preferredEmploymentType).toBe("PART_TIME");
    expect(snapshot.workConditionPreferences).toEqual(draft.workConditionPreferences);
    expect(snapshot.employerUnknownPolicies).toEqual(draft.employerUnknownPolicies);
    expect(snapshot.schemaVersion).toBe("applypack-intake-v3");
  });

  it("requires unknown handling for dealbreakers, required benefits, and hard work conditions", () => {
    const draft: FourStepDraft = {
      ...emptyFourStepDraft,
      workModes: ["REMOTE"],
      stateOrDc: "VA",
      employmentTypes: ["FULL_TIME"],
      benefits: { mustHave: ["Health insurance"], wouldPrefer: [], openTo: [] },
      workConditionPreferences: { TRAVEL: "MUST_HAVE" },
      dealbreakers: ["SALES"],
      termsAccepted: true,
    };
    expect(hardEmployerCriteria(draft).map(({ key }) => key)).toEqual([
      "dealbreaker:SALES",
      "benefit:Health insurance",
      "work_condition:TRAVEL",
    ]);
    expect(validateFourStep(3, draft, { resume: null, facts: [], presentedFactIds: new Set() }).map(({ fieldId }) => fieldId)).toEqual([
      "unknown-dealbreaker-sales",
      "unknown-benefit-health-insurance",
      "unknown-work-condition-travel",
    ]);
  });

  it("supports every recognizable structured correction category without a generic text collapse", () => {
    const validCorrections = [
      { category: "EMPLOYER_OR_ORGANIZATION", employerOrOrganization: "Acme" },
      { category: "ROLE_OR_RELATIONSHIP", roleOrRelationship: "Coordinator" },
      { category: "DATE_RANGE", startsOn: "2024-01-01", endsOn: "2024-12-31", datePrecision: "MONTH" },
      { category: "RESPONSIBILITY", responsibility: "Prepared reports" },
      { category: "TOOL_CAPABILITY", taskOrTool: "Excel sorting", capabilityStatus: "CAN_DO_NOW" },
      { category: "EDUCATION", educationLevel: "Bachelor's", educationField: "History", completionStatus: "Completed" },
      { category: "CERTIFICATION_OR_CREDENTIAL", credentialName: "PMP", issuingOrganization: "PMI", completionStatus: "Active" },
      { category: "OTHER_STRUCTURED_FACT", factLabel: "Language", factValue: "Spanish" },
    ];
    expect(factCorrectionSchema.safeParse({ category: "OTHER", value: "generic text" }).success).toBe(false);
    expect(factCorrectionSchema.safeParse({ category: "ROLE_OR_RELATIONSHIP" }).success).toBe(false);
    expect(factCorrectionCategories).toHaveLength(validCorrections.length);
    for (const correction of validCorrections) {
      const parsed = factCorrectionSchema.parse(correction);
      expect(factCorrectionIsComplete(parsed)).toBe(true);
    }
    for (const category of factCorrectionCategories) expect(factCorrectionIsComplete(emptyFactCorrection(category))).toBe(false);
    expect(recommendedFactCorrectionCategory({ semanticKey: "latest-employer", displayLabel: "Company" })).toBe("EMPLOYER_OR_ORGANIZATION");
    expect(recommendedFactCorrectionCategory({ semanticKey: "latest-role", displayLabel: "Title" })).toBe("ROLE_OR_RELATIONSHIP");
    expect(recommendedFactCorrectionCategory({ semanticKey: "degree", displayLabel: "Education" })).toBe("EDUCATION");
    expect(recommendedFactCorrectionCategory({ semanticKey: "license", displayLabel: "Credential" })).toBe("CERTIFICATION_OR_CREDENTIAL");
  });});

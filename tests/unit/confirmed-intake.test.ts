import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { buildConfirmedReview, confirmationReceiptSchema, contextualDutySuggestions, experienceDate } from "@/lib/intake/confirmed-review";
import { buildFourStepSnapshot, emptyFourStepDraft, experienceAdditionSchema, factCorrectionSchema, relevantToolFamilies, validateFourStep, type FourStepDraft } from "@/lib/intake/four-step";

const experience = experienceAdditionSchema.parse({ clientId: "10000000-0000-4000-8000-000000000001", kind: "PAID_EMPLOYMENT", organizationOrProject: "Fixture Store", roleOrRelationship: "Cashier", startsOn: "2022-01-01", endsOn: "2024-01-01", datePrecision: "YEAR", responsibilities: ["Handled payments"], tools: [], scope: "", outcome: "", intensityPercent: null, educationLevel: "", educationField: "", completionStatus: "", certifications: [], relevantCoursework: [], optionalDetail: "" });
const context = { resume: null, facts: [], presentedFactIds: new Set<string>() };
const guided: FourStepDraft = { ...emptyFourStepDraft, entryMode: "GUIDED", fullName: "Fixture Customer", email: "fixture@example.invalid", backgroundReviewed: true, experienceAdditions: [experience] };

describe("confirmed adaptive intake", () => {
  it("accepts several named field corrections while rejecting added keys, type changes and impossible dates", () => {
    const fact = { id: "20000000-0000-4000-8000-000000000001", documentVersionId: "30000000-0000-4000-8000-000000000001", semanticKey: "annotated:EMPLOYMENT:one", displayLabel: "Employment", displayValue: "Old Store", tier: "SEARCH_CRITICAL" as const, verification: "EXTRACTED_UNCONFIRMED" as const, sourceLocator: "page 1", editableValues: { employer: "Old Store", historicalTitle: "Cashier", phone: "555 0100", startsOn: "2020-01-01", endsOn: "2022-01-01", datePrecision: "YEAR" } };
    const fields = { ...fact.editableValues, employer: "Corrected Store", historicalTitle: "Team lead", phone: "555 0199" };
    const corrected: FourStepDraft = { ...guided, factReviews: { [fact.id]: "CORRECT" }, factCorrections: { [fact.id]: { category: "FIELD_EDITS", fields } } };
    const state = { ...context, facts: [fact], presentedFactIds: new Set([fact.id]) };
    expect(validateFourStep(2, corrected, state)).toEqual([]);
    const review = JSON.stringify(buildConfirmedReview(corrected, [], [fact]));
    for (const value of ["Corrected Store", "Team lead", "555 0199"]) expect(review).toContain(value);
    expect(factCorrectionSchema.safeParse({ category: "FIELD_EDITS", fields: { employmentFactId: "forged" } }).success).toBe(false);
    for (const patch of [{ employer: ["changed type"] }, { location: "not an original field" }, { startsOn: "2025-02-30" }]) {
      expect(validateFourStep(2, { ...corrected, factCorrections: { [fact.id]: { category: "FIELD_EDITS", fields: { ...fields, ...patch } } } }, state).map((error) => error.fieldId)).toContain(`fact-correction-${fact.id}`);
    }
    expect(validateFourStep(2, { ...corrected, factCorrections: { [fact.id]: { category: "FIELD_EDITS", fields: { startsOn: "2023-01-01" } } } }, state).map((error) => error.fieldId)).toContain(`fact-correction-${fact.id}`);
    expect(validateFourStep(2, { ...corrected, factCorrections: { [fact.id]: { category: "FIELD_EDITS", fields: { current: true } } } }, { ...state, facts: [{ ...fact, editableValues: { ...fact.editableValues, current: false } }] }).map((error) => error.fieldId)).toContain(`fact-correction-${fact.id}`);
  });
  it("accepts real guided background without inventing a resume", () => {
    expect(validateFourStep(0, guided, context)).toEqual([]);
    expect(validateFourStep(2, guided, context)).toEqual([]);
    expect(buildFourStepSnapshot(guided, "a".repeat(64), "applypack-c14n-v1")).toMatchObject({ schemaVersion: "applypack-intake-v4", entryMode: "GUIDED", experienceAdditions: [experience] });
  });
  it("requires actual tasks, but never optional scope, metrics or tools", () => {
    expect(validateFourStep(2, guided, context)).toEqual([]);
    const errors = validateFourStep(2, { ...guided, experienceAdditions: [{ ...experience, responsibilities: [] }] }, context);
    expect(errors.map((error) => error.fieldId)).toEqual([`experience-${experience.clientId}-responsibilities`]);
  });
  it("supports an honest no-prior-job history without forcing invented employment", () => {
    expect(validateFourStep(2, { ...guided, noPriorEmployment: true, experienceAdditions: [] }, context)).toEqual([]);
    expect(validateFourStep(2, { ...guided, experienceAdditions: [] }, context)[0].fieldId).toBe("experience-additions");
    expect(validateFourStep(2, { ...guided, noPriorEmployment: true }, context).map((error) => error.fieldId)).toContain("no-prior-employment");
  });
  it("asks about previous work rather than desired future work", () => {
    expect(contextualDutySuggestions(experience)).toContain("Handled payments");
    expect(contextualDutySuggestions({ ...experience, roleOrRelationship: "Tutor", responsibilities: [] })).not.toContain("Handled payments");
    expect(relevantToolFamilies({ ...emptyFourStepDraft, desiredActivities: ["PREPARING_REPORTS"] })).toEqual({ excel: false, systems: false });
    expect(relevantToolFamilies({ ...guided, experienceAdditions: [{ ...experience, tools: ["Excel"] }] }).excel).toBe(true);
  });
  it("does not turn caregiving into occupational duties", () => {
    expect(contextualDutySuggestions({ ...experience, kind: "CAREGIVING", roleOrRelationship: "Family care manager" })).toEqual([]);
  });
  it("keeps declared date precision visible and asks about missing dates only when claimed known", () => {
    expect(experienceDate("2022-01-01", "YEAR")).toBe("2022");
    expect(experienceDate("2022-01-01", "UNKNOWN")).toBe("Not known");
    expect(validateFourStep(2, { ...guided, experienceAdditions: [{ ...experience, startsOn: "", endsOn: "", datePrecision: "UNKNOWN" }] }, context)).toEqual([]);
    expect(validateFourStep(2, { ...guided, experienceAdditions: [{ ...experience, endsOn: "" }] }, context)[0].fieldId).toBe(`experience-${experience.clientId}-end`);
  });
  it("rejects an unreviewed stale resume fact even when a generic background checkbox is checked", () => {
    const fact = { id: "20000000-0000-4000-8000-000000000001", documentVersionId: "30000000-0000-4000-8000-000000000001", semanticKey: "role", displayLabel: "Role", displayValue: "Manager", tier: "SEARCH_CRITICAL" as const, verification: "EXTRACTED_UNCONFIRMED" as const, sourceLocator: "page 1" };
    expect(validateFourStep(2, guided, { ...context, facts: [fact] }).map((error) => error.fieldId)).toContain(`fact-${fact.id}`);
    expect(validateFourStep(2, { ...guided, factReviews: { [fact.id]: "SKIP" } }, { ...context, facts: [fact], presentedFactIds: new Set([fact.id]) })).not.toEqual([]);
  });
  it("shows full customer background, contextual facts and every selected exclusion instead of counts", () => {
    const sections = buildConfirmedReview({ ...guided, phone: "555 0100", careerChange: true, workModes: ["ONSITE"], zipCode: "22201", commuteDistanceMiles: 10, stateOrDc: "VA", avoidedActivities: ["SUPERVISING"], employerUnknownPolicies: { "work_condition:TRAVEL": "EXCLUDE_IF_UNKNOWN" }, workConditionPreferences: { TRAVEL: "MUST_HAVE" } }, [], []);
    const text = JSON.stringify(sections);
    for (const expected of ["Fixture Store", "Cashier", "Handled payments", "2022 to 2024", "555 0100", "22201", "10 miles", "Supervising people", "Exclude if unknown"]) expect(text).toContain(expected);
    expect(sections.every((section) => section.controlId && section.lines.length)).toBe(true);
  });
  it("binds each meaningful answer change to a different review digest", () => {
    const baseline = canonicalSha256(buildConfirmedReview(guided, [], []));
    for (const patch of [{ phone: "555 0101" }, { careerChange: true }, { experienceAdditions: [{ ...experience, roleOrRelationship: "Team lead" }] }]) {
      expect(canonicalSha256(buildConfirmedReview({ ...guided, ...patch }, [], []))).not.toBe(baseline);
    }
  });
  it("rejects extra private fields inside the content-free receipt", () => {
    const receipt = { id: "10000000-0000-4000-8000-000000000001", contractVersion: "applypack-confirmed-intake-v1", draftVersion: 2, sourceSha256: "a".repeat(64), reviewSha256: "b".repeat(64), answersSha256: "c".repeat(64), preparedAt: "2026-10-25T00:00:00.000Z", entryMode: "GUIDED" };
    expect(confirmationReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(confirmationReceiptSchema.safeParse({ ...receipt, answers: guided }).success).toBe(false);
  });
});

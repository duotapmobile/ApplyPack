import { describe, expect, it } from "vitest";
import { applyHumanEvidenceResolution, baseRank, baseRankWithExplanations, calculateConfidence, calculateFit, calculatePreferenceAlignment, candidateUnknownGate, deriveEligibility, educationAlignmentFactor, evaluateSalary, evaluateUsefulnessGate, evidenceFactorForRelation, experienceDepthFactor, mapEmployerUnknownPolicy, presentationRiskReasons, readinessCapabilityFactor, rejectCallerCalculatedFields, selectWithBoundedDiversity, targetCompensationPreference, type FitComponentInput, type GateResult, type RankCandidate, type SalaryInput } from "@/lib/matching/evaluation-engine";

const pass = (rootKey: string): GateResult => ({ rootKey, result: "PASS", resolutionIssue: "NONE", unknownTreatment: "BLOCK" });
const salaryBase: SalaryInput = { hardMinimumCents: 5_000_000, flexibleMinimum: false, minimumPeriod: "YEAR", minimumBasis: "BASE", publishedByEmployer: true, estimateOnly: false, currency: "USD", period: "YEAR", basis: "BASE", lowerCents: 5_000_000, upperCents: 6_000_000, correctLocationRange: true, workerBasisComparable: true, variableMaterial: false, variableAccepted: false, includeOverlap: false, includeUnpublished: false, includeNoncomparableUsd: false, endpointMeaning: "RANGE", conversion: null };
const allComponents = (factor = 1): FitComponentInput[] => [
  "CORE_RESPONSIBILITY_ALIGNMENT", "REQUIRED_TOOL_TECHNICAL_ALIGNMENT", "RELEVANT_EXPERIENCE_DEPTH_SCOPE", "EDUCATION_CERTIFICATION_ALIGNMENT", "CURRENT_READINESS",
].map((name, index) => ({ name: name as FitComponentInput["name"], applicable: index < 3, criteria: index < 3 ? [{ criterionId: `c${index}`, importance: 3, evidenceFactor: factor, evidenceIds: [`e${index}`] }] : [] }));

describe("Chunk 3 eligibility, salary, fit, confidence, and selection", () => {
  it("requires exact stable gate-root equality", () => {
    expect(deriveEligibility([], []).disposition).toBe("INVALID");
    expect(deriveEligibility(["a"], []).disposition).toBe("INVALID");
    expect(deriveEligibility(["a"], [pass("a"), pass("extra")]).disposition).toBe("INVALID");
    expect(deriveEligibility(["a", "a"], [pass("a")]).disposition).toBe("INVALID");
  });

  it.each([
    [{ ...pass("a"), result: "FAIL" }, "INELIGIBLE"],
    [{ ...pass("a"), result: "UNKNOWN", resolutionIssue: "CANDIDATE_MISSING" }, "NEEDS_CANDIDATE_INPUT"],
    [{ ...pass("a"), result: "UNKNOWN", resolutionIssue: "PARSER_UNCERTAIN" }, "NEEDS_HUMAN_REVIEW"],
    [{ ...pass("a"), result: "UNKNOWN", resolutionIssue: "EVIDENCE_CONFLICT" }, "NEEDS_HUMAN_REVIEW"],
    [{ ...pass("a"), result: "UNKNOWN", resolutionIssue: "EMPLOYER_OMITTED" }, "INELIGIBLE"],
  ] as const)("derives disposition precedence", (gate, disposition) => expect(deriveEligibility(["a"], [gate]).disposition).toBe(disposition));

  it("keeps allowed employer omissions unknown with consent and a warning", () => {
    const allowed: GateResult = { rootKey: "benefit.health", result: "UNKNOWN", resolutionIssue: "EMPLOYER_OMITTED", unknownTreatment: "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING", consentVersion: "snapshot-v1", warning: "Health benefits were not confirmed." };
    expect(deriveEligibility(["benefit.health"], [allowed])).toEqual({ disposition: "ELIGIBLE_WITH_ALLOWED_UNKNOWNS", warnings: ["Health benefits were not confirmed."] });
    expect(deriveEligibility(["license"], [{ ...allowed, rootKey: "license", unwaivable: true }]).disposition).toBe("NEEDS_HUMAN_REVIEW");
  });

  it("maps the exact employer-unknown policy without converting unknown to pass", () => {
    expect(mapEmployerUnknownPolicy("benefit.health", "EXCLUDE_IF_UNKNOWN")).toMatchObject({ result: "UNKNOWN", resolutionIssue: "EMPLOYER_OMITTED", unknownTreatment: "BLOCK" });
    expect(mapEmployerUnknownPolicy("benefit.health", "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING", { consentVersion: "snapshot-v1", warning: "Health benefits were not confirmed." })).toMatchObject({ result: "UNKNOWN", resolutionIssue: "EMPLOYER_OMITTED", unknownTreatment: "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" });
    expect(() => mapEmployerUnknownPolicy("benefit.health", "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING")).toThrow("allowed_employer_unknown_requires_consent_warning");
    expect(deriveEligibility(["license"], [mapEmployerUnknownPolicy("license", "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING", { consentVersion: "snapshot-v1", warning: "License not confirmed.", unwaivable: true })]).disposition).toBe("NEEDS_HUMAN_REVIEW");
  });

  it("creates a targeted candidate question and forbids a reviewer hard-failure override", () => {
    const missing = candidateUnknownGate("authorization.sponsorship", { prompt: "Will you now or later require sponsorship?", promptVersion: "question-v1" });
    expect(missing.gate).toMatchObject({ result: "UNKNOWN", resolutionIssue: "CANDIDATE_MISSING", unknownTreatment: "BLOCK" });
    expect(deriveEligibility([missing.gate.rootKey], [missing.gate]).disposition).toBe("NEEDS_CANDIDATE_INPUT");
    expect(() => applyHumanEvidenceResolution({ ...pass("license"), result: "FAIL" }, { result: "PASS", reviewerId: "reviewer", resolvedAt: "2026-09-05T00:00:00.000Z", rulesVersion: "matching-rules-v1", evidenceIds: ["registry"], evidenceChanges: ["Added registry record"], rationale: "Verified source" })).toThrow("reviewer_cannot_override_hard_failure");
    expect(applyHumanEvidenceResolution({ ...pass("parser"), result: "UNKNOWN", resolutionIssue: "PARSER_UNCERTAIN" }, { result: "PASS", reviewerId: "reviewer", resolvedAt: "2026-09-05T00:00:00.000Z", rulesVersion: "matching-rules-v1", evidenceIds: ["listing-line"], evidenceChanges: ["Corrected parser classification"], rationale: "The cited listing text is explicit." }).result).toBe("PASS");
  });

  it.each([
    [{}, "PUBLISHED_MEETS_MINIMUM", "PASS"],
    [{ lowerCents: 4_000_000, upperCents: 4_999_999 }, "PUBLISHED_BELOW_MINIMUM", "FAIL"],
    [{ lowerCents: 4_000_000, upperCents: 5_000_000 }, "PUBLISHED_OVERLAPS_MINIMUM", "FAIL"],
    [{ lowerCents: 4_000_000, upperCents: 5_000_000, includeOverlap: true }, "PUBLISHED_OVERLAPS_MINIMUM", "ALLOWED_WITH_WARNING"],
    [{ publishedByEmployer: false, lowerCents: null, upperCents: null }, "UNPUBLISHED", "FAIL"],
    [{ publishedByEmployer: false, lowerCents: null, upperCents: null, includeUnpublished: true }, "UNPUBLISHED", "ALLOWED_WITH_WARNING"],
    [{ estimateOnly: true, includeUnpublished: true }, "ESTIMATE_ONLY", "ALLOWED_WITH_WARNING"],
  ] as const)("evaluates salary status", (change, status, disposition) => expect(evaluateSalary({ ...salaryBase, ...change })).toMatchObject({ status, disposition }));

  it("applies equality, starting-at, up-to, basis, location, variable, currency, and conversion rules", () => {
    expect(evaluateSalary({ ...salaryBase, endpointMeaning: "STARTING_AT", lowerCents: 5_000_000, upperCents: null }).disposition).toBe("PASS");
    expect(evaluateSalary({ ...salaryBase, endpointMeaning: "UP_TO", includeNoncomparableUsd: true }).status).toBe("PUBLISHED_NONCOMPARABLE");
    expect(evaluateSalary({ ...salaryBase, basis: "GUARANTEED_TOTAL", minimumBasis: "BASE" }).disposition).toBe("FAIL");
    expect(evaluateSalary({ ...salaryBase, correctLocationRange: false, includeNoncomparableUsd: true }).disposition).toBe("ALLOWED_WITH_WARNING");
    expect(evaluateSalary({ ...salaryBase, workerBasisComparable: false }).disposition).toBe("FAIL");
    expect(evaluateSalary({ ...salaryBase, variableMaterial: true, variableAccepted: false }).disposition).toBe("FAIL");
    expect(evaluateSalary({ ...salaryBase, currency: "CAD", includeNoncomparableUsd: true }).disposition).toBe("FAIL");
    expect(evaluateSalary({ ...salaryBase, period: "HOUR", lowerCents: 2500, upperCents: 3000 }).disposition).toBe("FAIL");
    expect(evaluateSalary({ ...salaryBase, period: "HOUR", lowerCents: 2500, upperCents: 3000, conversion: { hoursPerWeek: 40, weeksPerYear: 50, version: "conversion-v1", accepted: true } })).toMatchObject({ status: "PUBLISHED_MEETS_MINIMUM", conversionVersion: "conversion-v1" });
    expect(evaluateSalary({ ...salaryBase, hardMinimumCents: null, flexibleMinimum: false, minimumPeriod: null, minimumBasis: null }).disposition).toBe("NOT_APPLICABLE");
    expect(evaluateSalary({ ...salaryBase, hardMinimumCents: null, flexibleMinimum: false, minimumPeriod: null, minimumBasis: null }).status).toBe("PUBLISHED_NONCOMPARABLE");
    expect(evaluateSalary({ ...salaryBase, estimateOnly: true, currency: "CAD", includeUnpublished: true }).disposition).toBe("FAIL");
    expect(evaluateSalary({ ...salaryBase, endpointMeaning: "UP_TO", lowerCents: null, upperCents: 4_999_999, includeNoncomparableUsd: true })).toMatchObject({ status: "PUBLISHED_BELOW_MINIMUM", disposition: "FAIL" });
    expect(evaluateSalary({ ...salaryBase, period: null, includeNoncomparableUsd: true }).disposition).toBe("ALLOWED_WITH_WARNING");
    expect(() => evaluateSalary({ ...salaryBase, lowerCents: 50.5 })).toThrow("invalid_salary_amount");
    expect(() => evaluateSalary({ ...salaryBase, lowerCents: 6_000_000, upperCents: 5_000_000 })).toThrow("reversed_salary_range");
  });

  it("calculates exact normalized applicable-weight fit and no score for ineligible jobs", () => {
    expect(calculateFit("ELIGIBLE", true, allComponents(1)).score).toBe(100);
    expect(calculateFit("ELIGIBLE", true, allComponents(0.5)).score).toBe(50);
    expect(calculateFit("INELIGIBLE", true, allComponents(1)).score).toBeNull();
    expect(calculateFit("ELIGIBLE", false, allComponents(1)).score).toBeNull();
    expect(calculateFit("ELIGIBLE", true, allComponents(1).map((component) => ({ ...component, applicable: false, criteria: [] })))).toMatchObject({ score: null, uncomputableReason: "NO_APPLICABLE_COMPONENTS" });
    expect(() => calculateFit("ELIGIBLE", true, allComponents(1).map((c, i) => i === 0 ? { ...c, criteria: [] } : c))).toThrow("empty_fit_denominator");
    expect(() => calculateFit("ELIGIBLE", true, allComponents(1).map((c, i) => i === 0 ? { ...c, criteria: [{ ...c.criteria[0], evidenceFactor: Number.NaN }] } : c))).toThrow("invalid_fit_factor");
    expect(() => calculateFit("ELIGIBLE", true, allComponents(1).map((c, i) => i === 0 ? { ...c, criteria: [c.criteria[0], c.criteria[0]] } : c))).toThrow("duplicate_fit_criterion");
  });

  it("derives exact evidence, depth, education, and readiness factors from structured inputs", () => {
    expect(["DIRECT", "ADJACENT", "TRANSFERABLE", "UNSUPPORTED"].map((relation) => evidenceFactorForRelation(relation as never, false))).toEqual([1, 0.8, 0.5, 0]);
    expect(evidenceFactorForRelation("TRANSFERABLE", true)).toBe(0);
    expect(experienceDepthFactor({ conservativeVerifiedMonths: 18, employerTargetMonths: 24, statedScopeConfirmed: true })).toBe(0.75);
    expect(experienceDepthFactor({ conservativeVerifiedMonths: null, employerTargetMonths: null, statedScopeConfirmed: true })).toBe(1);
    expect(educationAlignmentFactor({ strength: "REQUIRED", passed: true, exact: false, approvedRelated: true })).toBe(1);
    expect(educationAlignmentFactor({ strength: "PREFERRED", passed: true, exact: false, approvedRelated: true })).toBe(0.8);
    expect(["CAN_DO_NOW", "DONE_BEFORE_NEEDS_REFRESHER", "BASIC_EXPOSURE", "NOT_DONE", "UNSURE"].map((status) => readinessCapabilityFactor(status as never))).toEqual([1, 0.6, 0.25, 0, 0]);
  });

  it("keeps career break, breadth, title, and industry labels outside fit", () => {
    const baseline = calculateFit("ELIGIBLE", true, allComponents(0.8));
    const contextOnly = { careerBreak: true, breadth: "BROADEST_SUPPORTED_SCOPE", title: "Unfamiliar Fintech Wrangler", industry: "Fintech" };
    expect(contextOnly).toBeDefined();
    expect(calculateFit("ELIGIBLE", true, allComponents(0.8))).toEqual(baseline);
  });

  it("rejects caller totals and missing evidence links", () => {
    expect(() => rejectCallerCalculatedFields({ fitScore: 100 })).toThrow("caller_calculated_field_rejected");
    expect(() => calculateFit("ELIGIBLE", true, allComponents(1).map((c, i) => i === 0 ? { ...c, criteria: [{ ...c.criteria[0], evidenceIds: [] }] } : c))).toThrow("fit_evidence_missing");
  });

  it("uses equal-weight preferences without duplicates and null for none", () => {
    expect(calculatePreferenceAlignment([])).toBeNull();
    expect(calculatePreferenceAlignment([{ preferenceId: "a", value: 1 }])).toBe(1);
    expect(calculatePreferenceAlignment([{ preferenceId: "a", value: 1 }, { preferenceId: "b", value: 0.5 }, { preferenceId: "c", value: 0 }])).toBe(0.5);
    expect(() => calculatePreferenceAlignment([{ preferenceId: "a", value: 1 }, { preferenceId: "a", value: 0.5 }])).toThrow("duplicate_preference");
  });

  it("scores target compensation separately from the hard minimum", () => {
    expect(targetCompensationPreference({ targetCents: 7_000_000, publishedComparable: true, employerConfirmed: true, lowerCents: 7_000_000, upperCents: 8_000_000, hardFloorCents: 5_000_000, allowedUnknown: false })).toBe(1);
    expect(targetCompensationPreference({ targetCents: 7_000_000, publishedComparable: true, employerConfirmed: true, lowerCents: 6_000_000, upperCents: 7_000_000, hardFloorCents: 5_000_000, allowedUnknown: false })).toBe(0.75);
    expect(targetCompensationPreference({ targetCents: 7_000_000, publishedComparable: true, employerConfirmed: true, lowerCents: 5_000_000, upperCents: 6_000_000, hardFloorCents: 5_000_000, allowedUnknown: false })).toBe(0.5);
    expect(targetCompensationPreference({ targetCents: 7_000_000, publishedComparable: false, employerConfirmed: false, lowerCents: null, upperCents: null, hardFloorCents: 5_000_000, allowedUnknown: true })).toBe(0.5);
  });

  it("keeps usefulness, readiness, and controlled presentation risk separate", () => {
    const useful = { disposition: "ELIGIBLE" as const, employerCoreResponsibilityCount: 1, confirmedDirectCoreConnections: 1, reviewedAdjacentCoreConnections: 0, explanationSectionEvidenceCounts: [1, 1, 1, 1, 1], readiness: "READY" as const, reviewerWorthwhileReason: "The verified core work matches directly.", certifiedNotQuotaFiller: true };
    expect(evaluateUsefulnessGate(useful).evidenceSufficient).toBe(true);
    expect(evaluateUsefulnessGate({ ...useful, readiness: "BLOCKED" }).reason).toBe("READINESS_BLOCKED");
    expect(evaluateUsefulnessGate({ ...useful, employerCoreResponsibilityCount: 0 }).reason).toBe("CORE_RESPONSIBILITY_MISSING");
    expect(presentationRiskReasons).not.toContain("CAREER_BREAK");
  });

  it("uses the minimum material source quality and exact confidence labels", () => {
    expect(calculateConfidence({ candidateCompleteness: 1, employerCompleteness: 1, materialSourceQualities: [1, 0.8, 1], parserCertainty: 1 })).toEqual({ score: 96, label: "HIGH", sourceQuality: 0.8 });
    expect(calculateConfidence({ candidateCompleteness: 0.5, employerCompleteness: 0.6, materialSourceQualities: [0.8], parserCertainty: 0.6 }).label).toBe("MEDIUM");
    expect(calculateConfidence({ candidateCompleteness: 0, employerCompleteness: 0, materialSourceQualities: [0.8], parserCertainty: 0 }).label).toBe("LOW");
  });

  it("base-ranks by fit, exact-fit preference, confidence, freshness, then stable ID", () => {
    const candidate = (jobId: string, change: Partial<RankCandidate> = {}): RankCandidate => ({ jobId, employerId: jobId, titleFamily: jobId, discoverySourceId: "s", fit: 90, preference: 0.5, confidence: 80, confidenceLabel: "HIGH", postedOn: null, firstSeenAt: "2026-09-01T00:00:00.000Z", eligible: true, evidenceSufficient: true, ...change });
    expect(baseRank([candidate("lower-fit", { fit: 89, preference: 1 }), candidate("higher-fit", { fit: 90, preference: 0 })])[0].jobId).toBe("higher-fit");
    expect(baseRank([candidate("low-pref", { preference: 0.5 }), candidate("high-pref", { preference: 1 })])[0].jobId).toBe("high-pref");
    expect(baseRank([candidate("b"), candidate("a")])[0].jobId).toBe("a");
    expect(baseRankWithExplanations([candidate("a")])[0]).toMatchObject({ baseRank: 1, explanation: { fit: 90, preference: 0.5, confidence: 80, postedDateKnown: false, stableJobId: "a", version: "matching-rules-v3" } });
  });

  it("applies inclusive diversity bounds, concentration vectors, and null preference omission", () => {
    const candidate = (jobId: string, employerId: string, change: Partial<RankCandidate> = {}): RankCandidate => ({ jobId, employerId, titleFamily: "ops", discoverySourceId: "manual", fit: 90, preference: 0.8, confidence: 90, confidenceLabel: "HIGH", postedOn: null, firstSeenAt: "2026-09-01T00:00:00.000Z", eligible: true, evidenceSufficient: true, ...change });
    const input = [candidate("a", "same", { fit: 95, preference: 0.85 }), candidate("b", "other", { fit: 90, preference: 0.8 }), candidate("c", "same", { fit: 94 })];
    const result = selectWithBoundedDiversity(input, 2);
    expect(result.selected.map((x) => x.jobId)).toEqual(["a", "b"]);
    expect(result.displacements[0]).toMatchObject({ anchorId: "c", selectedId: "b" });
    expect(result.displacements[0]).toMatchObject({ reason: "LEXICOGRAPHIC_CONCENTRATION", anchorValues: { fit: 94 }, selectedValues: { fit: 90 } });
    const nullPreference = selectWithBoundedDiversity([candidate("a", "same", { preference: null, fit: 95 }), candidate("b", "other", { preference: null, fit: 90 })], 2);
    expect(nullPreference.selected.map((x) => x.jobId)).toEqual(["a", "b"]);
    expect(selectWithBoundedDiversity([candidate("blocked", "x", { eligible: false, fit: 100 }), candidate("good", "y")], 1).selected[0].jobId).toBe("good");
    expect(selectWithBoundedDiversity([candidate("liveops", "x", { discoverySourceId: "liveops", fit: 100 }), candidate("permitted", "y")], 1).selected[0].jobId).toBe("permitted");
  });
});

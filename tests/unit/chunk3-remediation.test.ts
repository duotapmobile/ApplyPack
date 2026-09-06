import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseListingRequirements } from "@/lib/matching/listing-parser";
import { deriveCustomerHardGates, derivePreferenceComponents, materialSourceQuality, salaryInput } from "@/lib/matching/evidence-derived";
import { buildReviewSubjectKey } from "@/lib/matching/review";
import { evaluateSalary } from "@/lib/matching/evaluation-engine";
import { assessFeasibility, createCoveragePlan } from "@/lib/matching/feasibility";
import { deliveryRow, selectPersistedEvaluations, type PersistedMatchEvaluation } from "@/lib/matching/persisted-runtime";
import { processPendingFeasibilityRequests } from "@/lib/matching/supabase-feasibility-store";

const uuid = "10000000-0000-4000-8000-000000000001";

function evaluation(id: string): PersistedMatchEvaluation {
  return {
    id,
    snapshot_id: uuid,
    job_snapshot_id: id,
    eligibility: "ELIGIBLE",
    categorical_evidence_sufficient: true,
    fit_score: 90,
    evidence_confidence: 85,
    preference_alignment: 0.75,
    confidence_label: "HIGH",
    salary_status: "PUBLISHED_MEETS_MINIMUM",
    salary_disposition: "PASS",
    usefulness_result: "PASS",
    application_readiness: "READY",
    candidate_fact_ids: [uuid],
    root_results: [{ rootKey: uuid, result: "PASS" }],
    leaf_results: [],
    satisfaction_paths: [{ rootKey: uuid, selectedNodeIds: [uuid] }],
    job_evidence: [{ id: uuid, field: "responsibility", sourceLocator: "line:2" }],
    explanation_evidence: {
      whatJobInvolves: { sourceEvidenceNodeIds: [uuid], candidateFactIds: [] },
      whyMadeList: { sourceEvidenceNodeIds: [uuid], candidateFactIds: [uuid] },
      howExperienceConnects: { sourceEvidenceNodeIds: [uuid], candidateFactIds: [uuid] },
      whatMayBeNew: { sourceEvidenceNodeIds: [uuid], candidateFactIds: [] },
      whatToKnow: { sourceEvidenceNodeIds: [uuid], candidateFactIds: [] },
    },
    warnings: [],
    candidate_facts: [{ id: uuid, semantic_key: "experience:customer-operations", value_kind: "RESPONSIBILITY", verification: "CUSTOMER_CONFIRMED", source_kind: "CUSTOMER_ASSERTION", supplied_source_id: null, superseded_at: null, customer_display_label: "Customer operations", customer_display_value: "Coordinated service recovery" }],
    job_snapshot: {
      id,
      legacy_job_id: id,
      company: `Employer ${id}`,
      exact_title: "Operations Specialist",
      discovery_source: "manual-reviewed",
      canonical_application_url: `https://employer.example/${id}`,
      canonical_employer_domain: `employer-${id}.example`,
      normalized_fingerprint: "f".repeat(64),
      posted_on: "2026-09-04",
      first_seen_at: "2026-09-04T12:00:00.000Z",
      live_verified_at: "2026-09-05T12:00:00.000Z",
      listing_activity_result: "PASS",
      application_path_result: "PASS",
      legitimacy_result: "PASS",
      source_authorization_id: uuid,
      source_authorization: { id: uuid, source_id: "manual-reviewed", state: "AUTHORIZED_MANUAL_ONLY", access_method: "MANUAL", authorization_version: "source-auth-v1", created_at: "2026-09-04T00:00:00.000Z" },
      current_source_authorization: { id: uuid, source_id: "manual-reviewed", state: "AUTHORIZED_MANUAL_ONLY", access_method: "MANUAL", authorization_version: "source-auth-v1", created_at: "2026-09-04T00:00:00.000Z" },
    },
  };
}

describe("Chunk 3 audit remediation", () => {
  it("preserves compensation endpoint, currency, and location semantics through parsing", () => {
    const parsed = parseListingRequirements({
      jobSnapshotId: uuid,
      listingText: "Remote full-time role in Virginia.\nRequired: 3 years of customer operations experience.\nVirginia: Up to $60,000 USD.\nOntario: C$80,000 CAD.",
    });
    const compensation = parsed.criteria.filter((criterion) => criterion.kind === "COMPENSATION");
    expect(compensation).toHaveLength(2);
    expect(compensation[0]).toMatchObject({ currency: "USD", lowerCents: null, upperCents: 6_000_000, endpointMeaning: "UP_TO", locationApplicability: "Virginia" });
    expect(compensation[1]).toMatchObject({ currency: "CAD", lowerCents: 8_000_000, upperCents: 8_000_000, endpointMeaning: "FIXED", locationApplicability: "Ontario" });
    const snapshot = {
      salary_hard_minimum_cents: 5_000_000,
      salary_minimum_flexible: false,
      salary_period: "YEAR",
      salary_basis: "BASE",
      salary_overlap_policy: "EXCLUDE",
      salary_unpublished_policy: "EXCLUDE",
      salary_noncomparable_policy: "EXCLUDE",
      salary_variable_pay_policy: "EXCLUDE",
    } as never;
    const exactReview = (criterion: (typeof compensation)[number]) => ({
      decision: {
        selectedCompensationCriterionId: criterion.stableCriterionId,
        correctLocationRange: true,
        workerBasisComparable: true,
      },
    }) as never;
    expect(evaluateSalary(salaryInput(snapshot, [compensation[0]], exactReview(compensation[0])))).toMatchObject({ status: "PUBLISHED_NONCOMPARABLE", disposition: "FAIL" });
    expect(evaluateSalary(salaryInput(snapshot, [compensation[1]], exactReview(compensation[1])))).toMatchObject({ status: "PUBLISHED_NONCOMPARABLE", disposition: "FAIL" });
    expect(evaluateSalary(salaryInput(snapshot, compensation, null))).toMatchObject({ status: "PUBLISHED_NONCOMPARABLE", disposition: "FAIL" });
  });

  it("creates one customer gate for every active hard constraint and never lets a review waive a confirmed failure", () => {
    const parsed = parseListingRequirements({ jobSnapshotId: uuid, listingText: "Remote part-time role in Virginia.\nRequired: 3 years of customer operations experience.\nResponsibilities: coordinate service recovery." });
    const snapshot = {
      id: uuid, customer_id: uuid, content_sha256: "a".repeat(64), schema_version: "applypack-intake-v3",
      desired_activities: [], avoided_activities: [], optional_titles: [], confirmed_title_restriction: null,
      optional_industries: [], blocked_industries: ["HEALTHCARE"], work_modes: ["REMOTE"], preferred_work_mode: null,
      us_state_or_dc: "VA", commute_distance_miles: null, employment_types: ["FULL_TIME"], preferred_employment_type: null,
      schedules: ["Weekdays"], travel: {}, benefits: { mustHave: ["Health insurance"], wouldPrefer: [], openTo: [] },
      work_condition_preferences: { TRAVEL: "DEALBREAKER" }, dealbreakers: ["REQUIRED_TRAVEL"], employer_unknown_policy: {},
      salary_target_cents: null, salary_hard_minimum_cents: null, salary_minimum_flexible: false, salary_period: null, salary_basis: null,
      salary_overlap_policy: "EXCLUDE", salary_unpublished_policy: "EXCLUDE", salary_noncomparable_policy: "EXCLUDE", salary_variable_pay_policy: "EXCLUDE",
    };
    const job = { id: uuid, exact_title: "Operations Specialist", content_sha256: "b".repeat(64), parser_version: parsed.parserVersion, requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED", legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS", material_source_qualities: [1] };
    const gates = deriveCustomerHardGates({
      snapshot,
      job,
      criteria: parsed.criteria,
      reviews: [{ id: "10000000-0000-4000-8000-000000000099", snapshot_id: uuid, job_snapshot_id: uuid, review_kind: "CUSTOMER_CRITERION", review_subject_key: "customer:employment-type", decision: { disposition: "RESOLVED_PASS", customerCriterionKey: "customer:employment-type", sourceEvidenceNodeIds: [] }, invalidated_at: null, reviewer_id: uuid, created_at: "2026-09-05T00:00:00.000Z" }],
    });
    expect(gates.map((gate) => gate.rootKey)).toEqual(expect.arrayContaining([
      "customer:work-mode", "customer:geography-state", "customer:employment-type", "customer:schedule:weekdays",
      "customer:blocked-industry:healthcare", "customer:benefit:health-insurance", "customer:dealbreaker:required-travel", "customer:work-condition:travel",
    ]));
    expect(gates.find((gate) => gate.rootKey === "customer:employment-type")?.result).toBe("FAIL");
  });

  it("scores every selected soft-preference family without counting accepted hard choices as preferences", () => {
    const parsed = parseListingRequirements({ jobSnapshotId: uuid, listingText: "Remote full-time operations role in Virginia healthcare.\nRequired: 3 years of customer operations experience.\nResponsibilities: coordinating projects.\nBenefits include health insurance.\nWeekday schedule; no travel required." });
    const snapshot = {
      id: uuid, customer_id: uuid, content_sha256: "a".repeat(64), schema_version: "applypack-intake-v3",
      desired_activities: ["COORDINATING_PROJECTS"], avoided_activities: ["REQUIRED_TRAVEL"], optional_titles: ["Operations Specialist"], confirmed_title_restriction: null,
      optional_industries: ["HEALTHCARE"], blocked_industries: [], work_modes: ["REMOTE", "HYBRID"], preferred_work_mode: "REMOTE",
      us_state_or_dc: "VA", commute_distance_miles: null, employment_types: ["FULL_TIME", "PART_TIME"], preferred_employment_type: "FULL_TIME",
      schedules: ["Weekdays"], travel: {}, benefits: { mustHave: [], wouldPrefer: ["Health insurance"], openTo: [] },
      work_condition_preferences: { TRAVEL: "WOULD_PREFER" }, dealbreakers: [], employer_unknown_policy: {},
      salary_target_cents: null, salary_hard_minimum_cents: null, salary_minimum_flexible: false, salary_period: null, salary_basis: null,
      salary_overlap_policy: "EXCLUDE", salary_unpublished_policy: "EXCLUDE", salary_noncomparable_policy: "EXCLUDE", salary_variable_pay_policy: "EXCLUDE",
    };
    const job = { id: uuid, exact_title: "Operations Specialist", content_sha256: "b".repeat(64), parser_version: parsed.parserVersion, requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED", legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS", material_source_qualities: [1] };
    const components = derivePreferenceComponents({
      snapshot,
      job,
      criteria: parsed.criteria,
      salary: { status: "UNPUBLISHED", disposition: "NOT_APPLICABLE", warning: null, comparedLowerCents: null, comparedUpperCents: null, conversionVersion: null },
    });
    expect(components.map((component) => component.preferenceId)).toEqual(expect.arrayContaining([
      "desired-activity:coordinating-projects", "title:operations-specialist", "industry:healthcare", "preferred-work-mode", "preferred-employment-type",
      "benefit:health-insurance", "schedule:weekdays", "soft-avoidance:required-travel",
    ]));
    expect(components).not.toContainEqual(expect.objectContaining({ preferenceId: "accepted-work-modes" }));
  });

  it("uses the minimum persisted material-source quality and keys reviews for atomic supersession", () => {
    expect(materialSourceQuality([1, 0.8, 1])).toBe(0.8);
    expect(buildReviewSubjectKey({ reviewKind: "MATCH_EVIDENCE", stableCriterionId: uuid } as never)).toBe("criterion:" + uuid);
    expect(buildReviewSubjectKey({ reviewKind: "CATEGORICAL_USEFULNESS" } as never)).toBe("categorical-usefulness");
    const jobsRoute = readFileSync("src/app/api/admin/jobs/route.ts", "utf8");
    const evaluationRoute = readFileSync("src/app/api/admin/matching-evaluations/route.ts", "utf8");
    const reviewRoute = readFileSync("src/app/api/admin/matching-reviews/route.ts", "utf8");
    expect(jobsRoute).toContain("listingHost === applicationHost ? [1] : [0.8, 1]");
    expect(evaluationRoute).toContain('.is("invalidated_at", null)');
    expect(evaluationRoute).toContain('eq("supersedes_job_snapshot_id", input.jobSnapshotId)');
    expect(reviewRoute).toContain('rpc("ap_record_matching_review"');
    expect(reviewRoute).toContain("correctedJobSnapshotId");
  });

  it("parses supported listing requirements and fails closed on unsupported hard wording", () => {
    const complete = parseListingRequirements({ jobSnapshotId: uuid, listingText: "This is a remote role.\nRequired: 3 years of customer operations experience.\nResponsibilities: coordinate service recovery." });
    expect(complete).toMatchObject({ status: "COMPLETE" });
    expect(complete.criteria.map((criterion) => criterion.kind)).toEqual(["WORK_MODE", "EXPERIENCE", "RESPONSIBILITY"]);
    const held = parseListingRequirements({ jobSnapshotId: uuid, listingText: "Must hold the employer's bespoke certification matrix." });
    expect(held.status).toBe("NEEDS_HUMAN_REVIEW");
    expect(held.issues[0].code).toBe("UNSUPPORTED_REQUIREMENT");
    const informationalOnly = parseListingRequirements({ jobSnapshotId: uuid, listingText: "This role is remote.\nResponsibilities: coordinate service recovery." });
    expect(informationalOnly.status).toBe("NEEDS_HUMAN_REVIEW");
    expect(informationalOnly.issues).toContainEqual(expect.objectContaining({ code: "NO_REQUIREMENTS_FOUND" }));
  });

  it("builds selection and delivery only from persisted typed evaluations", () => {
    const rows = Array.from({ length: 10 }, (_, index) => evaluation(`20000000-0000-4000-8000-${String(index).padStart(12, "0")}`));
    const selected = selectPersistedEvaluations(rows, 10).selected;
    expect(selected).toHaveLength(10);
    selected[0].selection!.runId = uuid;
    expect(selected[0].selection).toMatchObject({ baseRank: expect.any(Number), selectedRank: expect.any(Number), rankExplanation: expect.any(Object), selectorExplanation: expect.any(Object) });
    expect(deliveryRow(selected[0], 1)).toMatchObject({
      job_id: selected[0].job_snapshot.legacy_job_id,
      matching_experience: ["Customer operations: Coordinated service recovery"],
      criteria_checks: { experienceConfirmed: true, nonNegotiablesSatisfied: true },
      ranking_reason_codes: { selectionRunId: uuid, baseRank: expect.any(Number), selectedRank: expect.any(Number) },
    });
    expect(() => deliveryRow({ ...selected[0], usefulness_result: "FAIL" }, 1)).toThrow("persisted_evaluation_not_deliverable");
  });

  it("excludes a persisted evaluation when the linked source authorization is no longer current", () => {
    const row = evaluation("20000000-0000-4000-8000-000000000099");
    row.job_snapshot.current_source_authorization = { id: "30000000-0000-4000-8000-000000000099", source_id: "manual-reviewed", state: "BLOCKED", access_method: "NONE", authorization_version: "source-auth-v2", created_at: "2026-09-05T00:00:00.000Z" };
    expect(selectPersistedEvaluations([row], 1).selected).toHaveLength(0);
    expect(() => deliveryRow(row, 1)).toThrow("persisted_evaluation_not_deliverable");
  });

  it("rejects manufactured feasibility objects without persisted identity and version bindings", () => {
    const plan = createCoveragePlan({ id: "plan", inventoryVersionId: "inventory", snapshotHash: "a".repeat(64), breadth: "ADJACENT_OPPORTUNITIES", requiredFamilyIds: ["family"], cells: [{ id: "cell", familyId: "family", sourceId: "manual-reviewed", authorizationState: "AUTHORIZED_MANUAL_ONLY", authorizationEvidenceId: "evidence", path: "MANUAL", queryFingerprint: "f".repeat(64), paginationBound: 1, lookbackBound: 1, resultBound: 10, outcome: "SUCCEEDED_WITH_RESULTS", resultCount: 10, configuredBoundSatisfied: true, normalizedAndDeduplicated: true, manualChecklistComplete: true, parserResult: "COMPLETE", stopReason: "bound" }], versions: { source: "source", query: "query", inventory: "inventory", parser: "parser", cutoff: "cutoff" }, disposition: "REQUIRED", collisionProof: null });
    const forged = Array.from({ length: 10 }, () => ({ legitimate: true, evidenceSufficient: true, preliminaryUsefulness: true })) as never;
    expect(assessFeasibility({ plan, inventory: forged, currentSnapshotId: uuid, currentSnapshotHash: "a".repeat(64) }).runState).toBe("ERROR");
  });

  it("keeps the production feasibility processor disabled without explicit worker configuration", async () => {
    const original = process.env.APP_FEASIBILITY_WORKER_ID;
    delete process.env.APP_FEASIBILITY_WORKER_ID;
    await expect(processPendingFeasibilityRequests({} as never)).resolves.toMatchObject({ status: "disabled", reason: "APP_FEASIBILITY_WORKER_ID_UNSET", processed: 0 });
    if (original === undefined) delete process.env.APP_FEASIBILITY_WORKER_ID; else process.env.APP_FEASIBILITY_WORKER_ID = original;
  });

  it("removes legacy ranking and caller-authored explanations from active search and release call chains", () => {
    const paths = [
      "src/lib/workflow/process.ts",
      "src/app/api/admin/jobs/route.ts",
      "src/app/api/admin/search-orders/[id]/deliver/route.ts",
      "src/app/api/admin/conflicts/[id]/resolve/route.ts",
    ];
    const source = paths.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toContain("rankLegacyJobs");
    expect(source).not.toContain("rankingDatabaseValues");
    expect(source).not.toContain("jobPayloadSchema");
    expect(source).toContain("loadPersistedEvaluationsForOrder");
    expect(readFileSync("src/app/api/admin/jobs/route.ts", "utf8")).toContain("ap_persist_parsed_inventory_job");
    expect(readFileSync("src/app/api/cron/maintenance/route.ts", "utf8")).toContain("processPendingFeasibilityRequests");
    const evaluationRoute = readFileSync("src/app/api/admin/matching-evaluations/route.ts", "utf8");
    expect(evaluationRoute).toContain("deriveEvaluationFromPersistedEvidence");
    expect(evaluationRoute).not.toContain("fitComponents:");
    expect(evaluationRoute).not.toContain("hardMinimumCents:");
  });
});

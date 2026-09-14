import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customerCriterionEvidenceMatches, deriveCustomerHardGates, deriveEvaluationFromPersistedEvidence, type PersistedCandidateFact, type PersistedReview } from "@/lib/matching/evidence-derived";
import { parseListingRequirements, requirementPersistenceRows } from "@/lib/matching/listing-parser";

const jobId = "91000000-0000-4000-8000-000000000001";
const snapshotId = "91000000-0000-4000-8000-000000000002";
const factId = "91000000-0000-4000-8000-000000000003";

function matchingSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: snapshotId,
    customer_id: "91000000-0000-4000-8000-000000000008",
    content_sha256: "a".repeat(64),
    schema_version: "applypack-intake-v3",
    desired_activities: [],
    avoided_activities: [],
    work_modes: ["REMOTE"],
    preferred_work_mode: null,
    optional_titles: [],
    confirmed_title_restriction: null,
    optional_industries: [],
    blocked_industries: [],
    us_state_or_dc: "VA",
    employment_types: ["FULL_TIME"],
    preferred_employment_type: null,
    schedules: [],
    travel: {},
    benefits: { mustHave: [], wouldPrefer: [], openTo: [] },
    work_condition_preferences: {},
    dealbreakers: [],
    employer_unknown_policy: {},
    salary_target_cents: null,
    salary_hard_minimum_cents: null,
    salary_minimum_flexible: false,
    salary_period: null,
    salary_basis: null,
    salary_overlap_policy: "EXCLUDE",
    salary_unpublished_policy: "EXCLUDE",
    salary_noncomparable_policy: "EXCLUDE",
    salary_variable_pay_policy: "EXCLUDE",
    ...overrides,
  };
}

function review(id: string, kind: string, decision: Record<string, unknown>): PersistedReview {
  return { id, snapshot_id: snapshotId, job_snapshot_id: jobId, review_kind: kind, decision, invalidated_at: null, reviewer_id: "91000000-0000-4000-8000-000000000009", created_at: "2026-09-05T12:00:00.000Z" };
}

function fixture() {
  const listingText = "Remote full-time role in Virginia.\nRequired: 3 years of customer operations experience.\nResponsibilities: coordinate service recovery.";
  const parsed = parseListingRequirements({ jobSnapshotId: jobId, listingText });
  const nodes = requirementPersistenceRows(parsed, listingText) as never[];
  const criteria = nodes.filter((node) => (node as { node_kind: string }).node_kind === "CRITERION") as Array<{ id: string; stable_criterion_id: string; typed_value: { kind: string } }>;
  const experience = criteria.find((node) => node.typed_value.kind === "EXPERIENCE")!;
  const responsibility = criteria.find((node) => node.typed_value.kind === "RESPONSIBILITY")!;
  const facts: PersistedCandidateFact[] = [{
    id: factId,
    snapshot_id: snapshotId,
    semantic_key: "experience:customer-operations",
    value_kind: "RESPONSIBILITY",
    typed_value: { activity: "Coordinated service recovery" },
    verification: "CUSTOMER_CONFIRMED",
    source_kind: "CUSTOMER_ASSERTION",
    supplied_source_id: null,
    superseded_at: null,
    capability_status: "CAN_DO_NOW",
    calendar_duration_days: 1_200,
    customer_display_label: "Customer operations",
    customer_display_value: "Coordinated service recovery",
  }];
  const evidenceReviews = [
    review("91000000-0000-4000-8000-000000000004", "MATCH_EVIDENCE", { disposition: "RESOLVED_PASS", stableCriterionId: experience.stable_criterion_id, sourceEvidenceNodeIds: [experience.id], candidateFactIds: [factId], candidateFactVersionIds: [factId], evidenceRelation: "DIRECT" }),
    review("91000000-0000-4000-8000-000000000005", "MATCH_EVIDENCE", { disposition: "RESOLVED_PASS", stableCriterionId: responsibility.stable_criterion_id, sourceEvidenceNodeIds: [responsibility.id], candidateFactIds: [factId], candidateFactVersionIds: [factId], evidenceRelation: "DIRECT" }),
  ];
  const explanationEvidence = {
    whatJobInvolves: { sourceEvidenceNodeIds: [responsibility.id], candidateFactIds: [] },
    whyMadeList: { sourceEvidenceNodeIds: [responsibility.id], candidateFactIds: [factId] },
    howExperienceConnects: { sourceEvidenceNodeIds: [responsibility.id], candidateFactIds: [factId] },
    whatMayBeNew: { sourceEvidenceNodeIds: [responsibility.id], candidateFactIds: [] },
    whatToKnow: { sourceEvidenceNodeIds: [experience.id], candidateFactIds: [] },
  };
  const usefulnessReview = review("91000000-0000-4000-8000-000000000006", "CATEGORICAL_USEFULNESS", { disposition: "RESOLVED_PASS", sourceEvidenceNodeIds: [experience.id, responsibility.id], candidateFactIds: [factId], explanationEvidence, applicationReadiness: "READY", presentationRisk: "LOW", presentationRiskReasons: [], reviewerWorthwhileReason: "The confirmed responsibilities make this a worthwhile application.", certifiedNotQuotaFiller: true });
  return { parsed, nodes, facts, evidenceReviews, usefulnessReview };
}

describe("Chunk 3 persisted-evidence remediation", () => {
  it("preserves a supported employer OR as an ANY_OF hard subtree", () => {
    const parsed = parseListingRequirements({ jobSnapshotId: jobId, listingText: "Required: Bachelor's degree in finance OR five years of relevant experience." });
    expect(parsed.status).toBe("COMPLETE");
    expect(parsed.tree).toMatchObject({ kind: "ALL_OF", children: [{ kind: "ANY_OF", children: [{ kind: "CRITERION" }, { kind: "CRITERION" }] }] });
  });

  it("holds the entire listing when any hard requirement is unsupported", () => {
    const parsed = parseListingRequirements({ jobSnapshotId: jobId, listingText: "Required: 3 years of customer operations experience.\nMust hold the employer's bespoke certification matrix." });
    expect(parsed.status).toBe("NEEDS_HUMAN_REVIEW");
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_REQUIREMENT" }));
  });

  it("parses negated modes and schedules without turning the negated value into a positive fact", () => {
    const parsed = parseListingRequirements({ jobSnapshotId: jobId, listingText: "This role is not remote; onsite only.\nNo weekdays; weekends only." });
    const workMode = parsed.criteria.find((criterion) => criterion.kind === "WORK_MODE");
    const schedule = parsed.criteria.find((criterion) => criterion.kind === "SCHEDULE");
    expect(workMode).toMatchObject({ modes: ["ONSITE"] });
    expect(schedule).toMatchObject({ days: ["WEEKENDS"], weekend: true });
  });

  it("places required physical demands in the hard tree and holds untyped hard wording", () => {
    const physical = parseListingRequirements({ jobSnapshotId: jobId, listingText: "Ability to lift 50 pounds." });
    expect(physical.status).toBe("COMPLETE");
    expect(physical.tree).toMatchObject({ children: [{ criterion: { kind: "TRAVEL_PHYSICAL", threshold: 50, unit: "POUNDS" } }] });
    const mixed = parseListingRequirements({ jobSnapshotId: jobId, listingText: "Required: 3 years of operations experience.\nSuccessful candidate must satisfy the bespoke matrix." });
    expect(mixed.status).toBe("NEEDS_HUMAN_REVIEW");
  });

  it("derives gates, salary policy, fit, confidence, and explanations from persisted evidence", () => {
    const data = fixture();
    const derived = deriveEvaluationFromPersistedEvidence({
      snapshot: matchingSnapshot(),
      job: { id: jobId, exact_title: "Operations Specialist", content_sha256: "b".repeat(64), parser_version: data.parsed.parserVersion, requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED", legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS", material_source_qualities: [1] },
      sourceAuthorization: { id: "91000000-0000-4000-8000-000000000007", state: "AUTHORIZED_MANUAL_ONLY", access_method: "MANUAL", authorization_version: "source-auth-v1" },
      nodes: data.nodes as never,
      facts: data.facts,
      evidenceReviews: data.evidenceReviews,
      customerCriteriaReviews: [],
      usefulnessReview: data.usefulnessReview,
      compensationReview: null,
    });
    expect(derived.eligibility.disposition).toBe("ELIGIBLE");
    expect(derived.fit.score).toBeGreaterThan(0);
    expect(derived.confidence.score).toBeGreaterThanOrEqual(80);
    expect(derived.candidateFactIds).toEqual([factId]);
    expect(derived.explanationEvidence).toHaveProperty("howExperienceConnects");
  });

  it("uses the immutable intake salary floor as an eligibility gate", () => {
    const data = fixture();
    const derived = deriveEvaluationFromPersistedEvidence({
      snapshot: matchingSnapshot({ salary_hard_minimum_cents: 7_500_000, salary_period: "YEAR", salary_basis: "BASE" }),
      job: { id: jobId, exact_title: "Operations Specialist", content_sha256: "b".repeat(64), parser_version: data.parsed.parserVersion, requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED", legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS", material_source_qualities: [1] },
      sourceAuthorization: { id: "91000000-0000-4000-8000-000000000007", state: "AUTHORIZED_MANUAL_ONLY", access_method: "MANUAL", authorization_version: "source-auth-v1" },
      nodes: data.nodes as never,
      facts: data.facts,
      evidenceReviews: data.evidenceReviews,
      customerCriteriaReviews: [],
      usefulnessReview: data.usefulnessReview,
      compensationReview: null,
    });
    expect(derived.salary).toMatchObject({ status: "UNPUBLISHED", disposition: "FAIL" });
    expect(derived.gates).toContainEqual(expect.objectContaining({ rootKey: "universal:salary", result: "FAIL" }));
    expect(derived.eligibility.disposition).toBe("INELIGIBLE");
    expect(derived.fit.score).toBeNull();
  });

  it("rejects employer evidence that is from the job but not from the exact criterion", () => {
    const data = fixture();
    data.evidenceReviews[0] = review("91000000-0000-4000-8000-000000000004", "MATCH_EVIDENCE", {
      ...(data.evidenceReviews[0].decision as Record<string, unknown>),
      sourceEvidenceNodeIds: (data.evidenceReviews[1].decision as Record<string, unknown>).sourceEvidenceNodeIds,
    });
    expect(() => deriveEvaluationFromPersistedEvidence({
      snapshot: matchingSnapshot(),
      job: { id: jobId, exact_title: "Operations Specialist", content_sha256: "b".repeat(64), parser_version: data.parsed.parserVersion, requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED", legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS", material_source_qualities: [1] },
      sourceAuthorization: { id: "91000000-0000-4000-8000-000000000007", state: "AUTHORIZED_MANUAL_ONLY", access_method: "MANUAL", authorization_version: "source-auth-v1" },
      nodes: data.nodes as never,
      facts: data.facts,
      evidenceReviews: data.evidenceReviews,
      customerCriteriaReviews: [],
      usefulnessReview: data.usefulnessReview,
      compensationReview: null,
    })).toThrow("review_evidence_not_current_or_not_criterion_bound");
  });

  it("rejects a passing candidate qualification without exact candidate fact versions", () => {
    const data = fixture();
    data.evidenceReviews[0] = review("91000000-0000-4000-8000-000000000004", "MATCH_EVIDENCE", { disposition: "RESOLVED_PASS", stableCriterionId: (data.evidenceReviews[0].decision as Record<string, unknown>).stableCriterionId, sourceEvidenceNodeIds: (data.evidenceReviews[0].decision as Record<string, unknown>).sourceEvidenceNodeIds, candidateFactIds: [], candidateFactVersionIds: [], evidenceRelation: "DIRECT" });
    expect(() => deriveEvaluationFromPersistedEvidence({
      snapshot: matchingSnapshot(),
      job: { id: jobId, exact_title: "Operations Specialist", content_sha256: "b".repeat(64), parser_version: data.parsed.parserVersion, requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED", legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS", material_source_qualities: [1] },
      sourceAuthorization: { id: "91000000-0000-4000-8000-000000000007", state: "AUTHORIZED_MANUAL_ONLY", access_method: "MANUAL", authorization_version: "source-auth-v1" },
      nodes: data.nodes as never,
      facts: data.facts,
      evidenceReviews: data.evidenceReviews,
      customerCriteriaReviews: [],
      usefulnessReview: data.usefulnessReview,
      compensationReview: null,
    })).toThrow("hard_requirement_pass_missing_bound_candidate_evidence");
  });

  it("rejects reviewer PASS when persisted duration is below the employer minimum", () => {
    const data = fixture();
    data.facts[0].calendar_duration_days = 300;
    expect(() => deriveEvaluationFromPersistedEvidence({
      snapshot: matchingSnapshot(),
      job: { id: jobId, exact_title: "Operations Specialist", content_sha256: "b".repeat(64), parser_version: data.parsed.parserVersion, requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED", legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS", material_source_qualities: [1] },
      sourceAuthorization: { id: "91000000-0000-4000-8000-000000000007", state: "AUTHORIZED_MANUAL_ONLY", access_method: "MANUAL", authorization_version: "source-auth-v1" },
      nodes: data.nodes as never, facts: data.facts, evidenceReviews: data.evidenceReviews, customerCriteriaReviews: [], usefulnessReview: data.usefulnessReview, compensationReview: null,
    })).toThrow("review_disposition_conflicts_with_persisted_fact_derivation");
  });

  it("does not satisfy occupational experience with caregiving or insufficient FTE intensity", () => {
    for (const change of [
      { value_kind: "CAREGIVING" },
      { starts_on: "2023-01-01", ends_on: "2025-12-31", intensity_percent: 50, calendar_duration_days: null },
    ]) {
      const data = fixture();
      Object.assign(data.facts[0], change);
      const experience = (data.nodes as Array<{ typed_value?: { kind?: string; fteExplicit?: boolean } }>).find((node) => node.typed_value?.kind === "EXPERIENCE");
      if ("intensity_percent" in change && experience?.typed_value) experience.typed_value.fteExplicit = true;
      expect(() => deriveEvaluationFromPersistedEvidence({
        snapshot: matchingSnapshot(),
        job: { id: jobId, exact_title: "Operations Specialist", content_sha256: "b".repeat(64), parser_version: data.parsed.parserVersion, requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED", legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS", material_source_qualities: [1] },
        sourceAuthorization: { id: "91000000-0000-4000-8000-000000000007", state: "AUTHORIZED_MANUAL_ONLY", access_method: "MANUAL", authorization_version: "source-auth-v1" },
        nodes: data.nodes as never, facts: data.facts, evidenceReviews: data.evidenceReviews, customerCriteriaReviews: [], usefulnessReview: data.usefulnessReview, compensationReview: null,
      })).toThrow("review_disposition_conflicts_with_persisted_fact_derivation");
    }
  });

  it("does not create a commute hard gate for a remote job or duplicate schedule preferences as hard gates", () => {
    const parsed = parseListingRequirements({ jobSnapshotId: jobId, listingText: "Remote full-time role in Virginia." });
    const gates = deriveCustomerHardGates({ snapshot: matchingSnapshot({ work_modes: ["REMOTE", "HYBRID"], schedules: ["weekends"] }), job: { id: jobId, exact_title: "Remote Specialist", content_sha256: "b".repeat(64), parser_version: parsed.parserVersion, requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED", legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS" }, criteria: parsed.criteria, reviews: [] });
    expect(gates.some((gate) => gate.rootKey.startsWith("customer:commute"))).toBe(false);
    expect(gates.some((gate) => gate.rootKey.startsWith("customer:schedule"))).toBe(false);
  });

  it("requires customer review evidence to match the exact typed gate", () => {
    const parsed = parseListingRequirements({ jobSnapshotId: jobId, listingText: "Health insurance is offered.\n401k retirement benefit is offered." });
    const health = parsed.criteria.find((criterion) => criterion.kind === "BENEFIT" && criterion.benefit.toLowerCase().includes("health"))!;
    expect(customerCriterionEvidenceMatches("customer:benefit:health-insurance", health)).toBe(true);
    expect(customerCriterionEvidenceMatches("customer:benefit:retirement", health)).toBe(false);
  });

  it("does not expose caller-assigned gates, salary policy, fit factors, or confidence numbers", () => {
    const route = readFileSync("src/app/api/admin/matching-evaluations/route.ts", "utf8");
    expect(route).not.toMatch(/gateSchema|fitComponents: z|hardMinimumCents: z|candidateCompleteness: z|evidenceFactor: z/u);
    expect(route).toContain("deriveEvaluationFromPersistedEvidence");
  });
});

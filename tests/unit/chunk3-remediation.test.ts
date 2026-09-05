import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseListingRequirements } from "@/lib/matching/listing-parser";
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

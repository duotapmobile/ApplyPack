import { describe, expect, it } from "vitest";
import { z } from "zod";
import { canonicalSha256, typedCriterionSchema } from "@/lib/domain/foundation";
import { deriveEvaluationFromPersistedEvidence, type PersistedRequirementRow, type PersistedReview } from "@/lib/matching/evidence-derived";
import { baseRankWithExplanations, MATCHING_RULES_VERSION, selectWithBoundedDiversity, type RankCandidate } from "@/lib/matching/evaluation-engine";
import { parseListingRequirements, requirementPersistenceRows } from "@/lib/matching/listing-parser";

type EvaluationInput = Parameters<typeof deriveEvaluationFromPersistedEvidence>[0];
type Evaluation = ReturnType<typeof deriveEvaluationFromPersistedEvidence>;
const jobId = "e1040000-0000-4000-8000-000000000001";
const snapshotId = "e1040000-0000-4000-8000-000000000002";
const factId = "e1040000-0000-4000-8000-000000000003";
// Independently computed from the SQL104 UUID recipe and this exact listing hash.
const instructionId = "73584b2a-4e82-5b29-a289-886917da8ef4";
const listingText = "Remote full-time role in Virginia.\nRequired: 3 years of customer operations experience.\nResponsibilities: coordinate service recovery.\nApplication instructions: Attach PDF documents. In 150 words, describe a time you resolved a client issue.";

// Validate actual parser output instead of bypassing its generic persistence-row type.
const persistedRowSchema = z.object({
  id: z.string().uuid(), parent_id: z.string().uuid().nullable(), position: z.number(),
  node_kind: z.enum(["ALL_OF", "ANY_OF", "CRITERION"]), criterion_type: z.string().nullable(),
  stable_criterion_id: z.string().uuid().nullable(), semantic_key: z.string().nullable(),
  requirement_strength: z.string().nullable(), source_locator: z.string().nullable(),
  source_excerpt: z.string().nullable(), parser_certainty: z.number().nullable(),
  criterion_version: z.string(), importance: z.number().nullable().default(null), typed_value: z.unknown(),
}).passthrough();

function review(id: string, reviewKind: string, decision: Record<string, unknown>): PersistedReview {
  return {
    id, snapshot_id: snapshotId, job_snapshot_id: jobId, review_kind: reviewKind, decision,
    invalidated_at: null, reviewer_id: "e1040000-0000-4000-8000-000000000009", created_at: "2026-10-27T12:00:00.000Z",
  };
}

function fixture(parserCertainty = 1, withPreferences = false): EvaluationInput {
  const parsed = parseListingRequirements({ jobSnapshotId: jobId, listingText });
  expect(parsed.status).toBe("COMPLETE");
  const nodes: PersistedRequirementRow[] = persistedRowSchema.array().parse(requirementPersistenceRows(parsed, listingText));
  for (const node of nodes.filter((row) => row.requirement_strength === "REQUIRED")) {
    node.parser_certainty = parserCertainty;
    node.typed_value = { ...typedCriterionSchema.parse(node.typed_value), parserCertainty };
  }
  const experience = nodes.find((node) => node.criterion_type === "EXPERIENCE")!;
  const responsibility = nodes.find((node) => node.criterion_type === "RESPONSIBILITY")!;
  expect(experience).toBeDefined();
  expect(responsibility).toBeDefined();
  const explanationEvidence = {
    whatJobInvolves: { sourceEvidenceNodeIds: [responsibility.id], candidateFactIds: [] },
    whyMadeList: { sourceEvidenceNodeIds: [responsibility.id], candidateFactIds: [factId] },
    howExperienceConnects: { sourceEvidenceNodeIds: [responsibility.id], candidateFactIds: [factId] },
    whatMayBeNew: { sourceEvidenceNodeIds: [responsibility.id], candidateFactIds: [] },
    whatToKnow: { sourceEvidenceNodeIds: [experience.id], candidateFactIds: [] },
  };
  return {
    snapshot: {
      id: snapshotId, customer_id: "e1040000-0000-4000-8000-000000000008", content_sha256: "a".repeat(64), schema_version: "applypack-intake-v4",
      desired_activities: withPreferences ? ["coordinate service recovery"] : [], avoided_activities: withPreferences ? ["night shifts"] : [],
      work_modes: ["REMOTE"], preferred_work_mode: withPreferences ? "REMOTE" : null,
      optional_titles: withPreferences ? ["Operations Specialist"] : [], confirmed_title_restriction: null,
      optional_industries: withPreferences ? ["healthcare"] : [], blocked_industries: [], us_state_or_dc: "VA",
      employment_types: ["FULL_TIME"], preferred_employment_type: withPreferences ? "FULL_TIME" : null,
      schedules: [], travel: {}, benefits: { mustHave: [], wouldPrefer: withPreferences ? ["health insurance"] : [], openTo: [] },
      work_condition_preferences: {}, dealbreakers: [], employer_unknown_policy: {},
      salary_target_cents: null, salary_hard_minimum_cents: null, salary_minimum_flexible: false,
      salary_period: null, salary_basis: null, salary_overlap_policy: "EXCLUDE", salary_unpublished_policy: "EXCLUDE",
      salary_noncomparable_policy: "EXCLUDE", salary_variable_pay_policy: "EXCLUDE",
    },
    job: {
      id: jobId, exact_title: "Operations Specialist", content_sha256: canonicalSha256(listingText), parser_version: parsed.parserVersion,
      requirement_completeness: 100, compensation_completeness: 0, application_host_type: "EMPLOYER_HOSTED",
      legitimacy_result: "PASS", listing_activity_result: "PASS", application_path_result: "PASS", material_source_qualities: [1],
      captured_listing: { text: listingText },
    },
    sourceAuthorization: { id: "e1040000-0000-4000-8000-000000000007", state: "AUTHORIZED_AUTOMATED", access_method: "API", authorization_version: "source-auth-v1" },
    nodes,
    facts: [{
      id: factId, snapshot_id: snapshotId, semantic_key: "experience:customer-operations", value_kind: "RESPONSIBILITY",
      typed_value: { activity: "Coordinated service recovery" }, verification: "CUSTOMER_CONFIRMED", source_kind: "CUSTOMER_ASSERTION",
      supplied_source_id: null, superseded_at: null, capability_status: "CAN_DO_NOW", calendar_duration_days: 1_200,
      customer_display_label: "Customer operations", customer_display_value: "Coordinated service recovery",
    }],
    evidenceReviews: [experience, responsibility].map((node, index) => review(`e1040000-0000-4000-8000-00000000000${index + 4}`, "MATCH_EVIDENCE", {
      disposition: "RESOLVED_PASS", stableCriterionId: node.stable_criterion_id, sourceEvidenceNodeIds: [node.id], candidateFactIds: [factId], candidateFactVersionIds: [factId], evidenceRelation: "DIRECT",
    })),
    customerCriteriaReviews: [],
    usefulnessReview: review("e1040000-0000-4000-8000-000000000006", "CATEGORICAL_USEFULNESS", {
      disposition: "RESOLVED_PASS", sourceEvidenceNodeIds: [experience.id, responsibility.id], candidateFactIds: [factId], explanationEvidence,
      applicationReadiness: "READY", presentationRisk: "LOW", presentationRiskReasons: [],
      reviewerWorthwhileReason: "Confirmed service recovery experience supports the actual responsibilities.", certifiedNotQuotaFiller: true,
    }),
    compensationReview: null,
  };
}

// Exact proposed104 node contract: the captured text is evidence, outside the hard tree.
function instructionNode(): PersistedRequirementRow & { classification_method: string; human_correction_history: unknown[] } {
  const semanticKey = `employer-instruction-source:${jobId}`;
  return {
    id: instructionId, job_snapshot_id: jobId, parent_id: null, position: 2147483646, node_kind: "CRITERION", criterion_type: "LISTING_APPLICATION_PATH",
    stable_criterion_id: instructionId, semantic_key: semanticKey, requirement_strength: "INFORMATIONAL",
    source_locator: "captured_listing.text", parser_certainty: 1, criterion_version: "employer-instruction-source-v1",
    classification_method: "employer-instruction-source-v1", importance: 1, human_correction_history: [], source_excerpt: listingText,
    typed_value: {
      stableCriterionId: instructionId, semanticKey, strength: "INFORMATIONAL", sourceLocator: "captured_listing.text", parserCertainty: 1,
      version: "employer-instruction-source-v1", kind: "LISTING_APPLICATION_PATH", identity: `saved-listing:${jobId}`,
      activeStatus: "ACTIVE", sourceAuthorized: true, applicationPath: "ACTIONABLE", hostType: "EMPLOYER_HOSTED",
    },
  };
}

function withInstruction(input: EvaluationInput): EvaluationInput {
  const node = instructionNode();
  expect(typedCriterionSchema.safeParse(node.typed_value).success).toBe(true);
  expect(input.nodes.some((row) => row.id === node.id)).toBe(false);
  return { ...structuredClone(input), nodes: [...structuredClone(input.nodes), node] };
}

function rankingOutput(derived: Evaluation) {
  const candidate: RankCandidate = {
    jobId, employerId: "fictional-employer.example", titleFamily: "operations", discoverySourceId: "permitted-source",
    fit: derived.fit.score ?? 0, preference: derived.preference, confidence: derived.confidence.score, confidenceLabel: derived.confidence.label,
    postedOn: "2026-10-26", firstSeenAt: "2026-10-26T12:00:00.000Z",
    eligible: ["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"].includes(derived.eligibility.disposition), evidenceSufficient: derived.usefulness.evidenceSufficient,
  };
  const peer = { ...candidate, jobId: "e1040000-0000-4000-8000-000000000011", employerId: "other-fictional-employer.example", fit: candidate.fit - 1 };
  return { ranks: baseRankWithExplanations([candidate, peer]), selection: selectWithBoundedDiversity([candidate, peer], 2) };
}

function expectPreserved(input: EvaluationInput) {
  const original = structuredClone(input);
  const enriched = withInstruction(input);
  const originalEnriched = structuredClone(enriched);
  const before = deriveEvaluationFromPersistedEvidence(input);
  const after = deriveEvaluationFromPersistedEvidence(enriched);
  // This intentionally compares every returned field, including roots/leaves, review-bound
  // evidence, fit components, confidence inputs, preferences, versions and calculation hash.
  expect(after).toStrictEqual(before);
  expect(rankingOutput(after)).toStrictEqual(rankingOutput(before));
  expect(input).toStrictEqual(original);
  expect(enriched).toStrictEqual(originalEnriched);
  const calculationInput = {
    snapshotHash: input.snapshot.content_sha256, jobHash: input.job.content_sha256, sourceAuthorizationId: input.sourceAuthorization.id,
    reviewIds: [input.usefulnessReview, ...input.evidenceReviews, ...input.customerCriteriaReviews, ...(input.compensationReview ? [input.compensationReview] : [])].map((row) => row.id).sort(),
    factIds: [factId], rulesVersion: MATCHING_RULES_VERSION,
  };
  expect(after.calculationInputSha256).toBe(canonicalSha256(calculationInput));
  expect(after.jobEvidence.some((evidence) => evidence.id === instructionId)).toBe(false);
  expect(after.requirement.leafResults.some((leaf) => leaf.nodeId === instructionId)).toBe(false);
  return after;
}

describe("employer instruction evidence preserves matching", () => {
  it.each([1, 0.35])("preserves all matching and ranking output at hard-parser certainty %s", (certainty) => {
    const result = expectPreserved(fixture(certainty));
    expect(result.eligibility.disposition).toBe("ELIGIBLE");
    expect(result.usefulness.evidenceSufficient).toBe(true);
    expect(result.fit.score).toBeGreaterThan(0);
    expect(result.confidenceInputs.parserCertainty).toBeCloseTo(certainty);
    expect(result.preferences).toEqual([]);
  });

  it("preserves real positive and unknown preference components without using instruction prose as matching evidence", () => {
    const result = expectPreserved(fixture(0.35, true));
    expect(result.preferences).toEqual(expect.arrayContaining([
      { preferenceId: "preferred-work-mode", value: 1 }, { preferenceId: "preferred-employment-type", value: 1 },
      { preferenceId: "desired-activity:coordinate-service-recovery", value: 1 }, { preferenceId: "title:operations-specialist", value: 1 },
      { preferenceId: "industry:healthcare", value: 0 }, { preferenceId: "benefit:health-insurance", value: 0 },
      { preferenceId: "soft-avoidance:night-shifts", value: 0 },
    ]));
  });

  it.each([false, true])("does not treat source-label words as a custom dealbreaker when unknowns allowed=%s", (allowed) => {
    const input = fixture(0.35, true);
    input.snapshot.dealbreakers = ["SOMETHING_ELSE"];
    input.snapshot.travel = { customDealbreaker: "instruction" };
    input.snapshot.employer_unknown_policy = allowed ? { "dealbreaker:SOMETHING_ELSE": "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" } : {};
    const result = expectPreserved(input);
    expect(result.eligibility.disposition).toBe(allowed ? "ELIGIBLE_WITH_ALLOWED_UNKNOWNS" : "INELIGIBLE");
    expect(result.gates).toContainEqual(expect.objectContaining({ rootKey: "customer:dealbreaker:custom:instruction", result: "UNKNOWN", resolutionIssue: "EMPLOYER_OMITTED" }));
    expect(result.confidenceInputs.employerCompleteness).toBe(0.75);
  });

  it("keeps historical informational evidence active for customer preferences and hard gates", () => {
    const input = fixture();
    input.snapshot.preferred_work_mode = "REMOTE";
    const mode = input.nodes.find((row) => row.criterion_type === "WORK_MODE")!;
    expect(mode.requirement_strength).toBe("INFORMATIONAL");
    const original = expectPreserved(input);
    expect(original.preferences).toContainEqual({ preferenceId: "preferred-work-mode", value: 1 });
    const missingMode = { ...input, nodes: input.nodes.filter((row) => row.id !== mode.id) };
    const changed = expectPreserved(missingMode);
    expect(changed.preferences).toContainEqual({ preferenceId: "preferred-work-mode", value: 0 });
    expect(changed.gates).not.toStrictEqual(original.gates);
  });

  it.each([
    { name: "attached to the hard root", change: (node: PersistedRequirementRow) => { node.parent_id = "e1040000-0000-4000-8000-000000000099"; } },
    { name: "masquerading required evidence", change: (node: PersistedRequirementRow) => { node.requirement_strength = "REQUIRED"; } },
    { name: "wrong criterion kind", change: (node: PersistedRequirementRow) => { node.criterion_type = "RESPONSIBILITY"; } },
    { name: "operator masquerade", change: (node: PersistedRequirementRow) => { node.node_kind = "ALL_OF"; } },
    { name: "foreign job", change: (node: PersistedRequirementRow) => { node.job_snapshot_id = snapshotId; } },
    { name: "noncanonical identity", change: (node: PersistedRequirementRow) => { node.id = snapshotId; node.stable_criterion_id = snapshotId; } },
    { name: "wrong stable identity", change: (node: PersistedRequirementRow) => { node.stable_criterion_id = snapshotId; } },
    { name: "wrong semantic key", change: (node: PersistedRequirementRow) => { node.semantic_key = "other-source"; } },
    { name: "wrong position", change: (node: PersistedRequirementRow) => { node.position = 0; } },
    { name: "wrong locator", change: (node: PersistedRequirementRow) => { node.source_locator = "other.text"; } },
    { name: "wrong parser certainty", change: (node: PersistedRequirementRow) => { node.parser_certainty = 0.5; } },
    { name: "wrong version", change: (node: PersistedRequirementRow) => { node.criterion_version = "listing-requirements-v6"; } },
    { name: "missing classifier", change: (node: PersistedRequirementRow) => { delete node.classification_method; } },
    { name: "changed source text", change: (node: PersistedRequirementRow) => { node.source_excerpt = "Unrelated instructions."; } },
    { name: "wrong importance", change: (node: PersistedRequirementRow) => { node.importance = 3; } },
    { name: "missing correction history", change: (node: PersistedRequirementRow) => { delete node.human_correction_history; } },
    { name: "edited correction history", change: (node: PersistedRequirementRow) => { node.human_correction_history = [{}]; } },
    { name: "wrong typed identity", change: (node: PersistedRequirementRow) => { node.typed_value = { ...typedCriterionSchema.parse(node.typed_value), identity: "other" }; } },
    { name: "typed required masquerade", change: (node: PersistedRequirementRow) => { node.typed_value = { ...typedCriterionSchema.parse(node.typed_value), strength: "REQUIRED" }; } },
    { name: "typed authorization mismatch", change: (node: PersistedRequirementRow) => { node.typed_value = { ...typedCriterionSchema.parse(node.typed_value), sourceAuthorized: false }; } },
    { name: "typed host mismatch", change: (node: PersistedRequirementRow) => { node.typed_value = { ...typedCriterionSchema.parse(node.typed_value), hostType: "APPROVED_THIRD_PARTY" }; } },
    { name: "extra typed field", change: (node: PersistedRequirementRow) => { node.typed_value = { ...typedCriterionSchema.parse(node.typed_value), activity: "instruction" }; } },
    { name: "missing typed marker", change: (node: PersistedRequirementRow) => { const typed = z.record(z.string(), z.unknown()).parse(node.typed_value); delete typed.version; node.typed_value = typed; } },
  ])("rejects $name instead of silently hiding it", ({ change }) => {
    const input = withInstruction(fixture());
    change(input.nodes.at(-1)!);
    expect(() => deriveEvaluationFromPersistedEvidence(input)).toThrow("employer_instruction_source_evidence_invalid");
  });

  it("rejects duplicate source nodes, children, and unavailable or changed captured text", () => {
    const input = withInstruction(fixture());
    const invalidInputs = [
      { ...input, nodes: [...input.nodes, instructionNode()] },
      { ...input, nodes: [...input.nodes, { ...input.nodes[1], parent_id: instructionId }] },
      { ...input, job: { ...input.job, captured_listing: undefined } },
      { ...input, job: { ...input.job, captured_listing: { text: "Altered saved text." } } },
      { ...input, job: { ...input.job, application_host_type: "UNAPPROVED" } },
      { ...input, job: { ...input.job, content_sha256: "f".repeat(64) } },
    ];
    for (const invalid of invalidInputs) expect(() => deriveEvaluationFromPersistedEvidence(invalid)).toThrow("employer_instruction_source_evidence_invalid");
  });

  it("does not accept source-only document evidence as a matching-review citation", () => {
    const input = withInstruction(fixture());
    input.usefulnessReview.decision = { ...z.record(z.string(), z.unknown()).parse(input.usefulnessReview.decision), sourceEvidenceNodeIds: [instructionId] };
    expect(() => deriveEvaluationFromPersistedEvidence(input)).toThrow("job_evidence_locator_required");
  });

  it.each([false, true])("preserves salary-unknown eligibility when consent allowed=%s", (allowed) => {
    const input = fixture();
    Object.assign(input.snapshot, { salary_hard_minimum_cents: 7_500_000, salary_period: "YEAR", salary_basis: "BASE", salary_unpublished_policy: allowed ? "INCLUDE_WITH_WARNING" : "EXCLUDE" });
    const result = expectPreserved(input);
    expect(result.eligibility.disposition).toBe(allowed ? "ELIGIBLE_WITH_ALLOWED_UNKNOWNS" : "INELIGIBLE");
    expect(result.fit.score === null).toBe(!allowed);
  });

  it("cannot substitute for an invalidated hard-requirement review", () => {
    const input = fixture();
    input.evidenceReviews[0].invalidated_at = "2026-10-27T12:01:00.000Z";
    const result = expectPreserved(input);
    expect(result.eligibility.disposition).toBe("NEEDS_CANDIDATE_INPUT");
    expect(result.requirement.result).toBe("UNKNOWN");
    expect(result.fit.score).toBeNull();
  });

  it.each([
    { name: "invalidated usefulness", error: "current_usefulness_review_required", change: (input: EvaluationInput) => { input.usefulnessReview.invalidated_at = "2026-10-27T12:01:00.000Z"; } },
    { name: "superseded candidate fact", error: "inactive_or_unverified_candidate_fact", change: (input: EvaluationInput) => { input.facts[0].superseded_at = "2026-10-27T12:01:00.000Z"; } },
    { name: "revoked source", error: "source_authorization_not_current", change: (input: EvaluationInput) => { input.sourceAuthorization.state = "REVOKED"; } },
    { name: "foreign review evidence", error: "review_evidence_not_current_or_not_criterion_bound", change: (input: EvaluationInput) => { input.evidenceReviews[0].decision = { ...z.record(z.string(), z.unknown()).parse(input.evidenceReviews[0].decision), sourceEvidenceNodeIds: [instructionId] }; } },
  ])("preserves rejection of $name", ({ error, change }) => {
    const input = fixture();
    change(input);
    expect(() => deriveEvaluationFromPersistedEvidence(input)).toThrow(error);
    expect(() => deriveEvaluationFromPersistedEvidence(withInstruction(input))).toThrow(error);
  });
});

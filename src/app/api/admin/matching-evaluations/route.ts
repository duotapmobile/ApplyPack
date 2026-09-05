import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { MATCHING_RULES_VERSION, SELECTOR_VERSION } from "@/lib/matching/evaluation-engine";
import { deriveEvaluationFromPersistedEvidence, type PersistedCandidateFact, type PersistedRequirementRow, type PersistedReview } from "@/lib/matching/evidence-derived";
import { isSameOriginRequest } from "@/lib/security/origin";

const uuid = z.string().uuid();
const schema = z.object({
  snapshotId: uuid,
  inventoryMemberId: uuid,
  jobSnapshotId: uuid,
  evidenceReviewIds: z.array(uuid).min(1).max(200).refine((ids) => new Set(ids).size === ids.length, "Evidence review IDs must be distinct."),
  usefulnessReviewId: uuid,
  compensationReviewId: uuid.nullable().optional(),
}).strict();

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This evaluation request was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Immutable evidence-review references are required; gate results and scores are not accepted.", details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  const requestedReviewIds = [...new Set([...input.evidenceReviewIds, input.usefulnessReviewId, ...(input.compensationReviewId ? [input.compensationReviewId] : [])])];
  const [{ data: snapshot }, { data: inventoryMember }, { data: nodes }, { data: requestedReviews }] = await Promise.all([
    auth.admin.from("ap_intake_snapshots").select("id,customer_id,draft_id,content_sha256,schema_version,work_modes,optional_titles,salary_target_cents,salary_hard_minimum_cents,salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy").eq("id", input.snapshotId).maybeSingle(),
    auth.admin.from("ap_inventory_members").select("id,inventory_version_id,job_snapshot_id,selected_by_deduplication,job_snapshot:ap_job_snapshots(id,exact_title,content_sha256,parser_version,requirement_completeness,compensation_completeness,application_host_type,legitimacy_result,listing_activity_result,application_path_result,source_authorization:ap_source_authorizations(id,state,access_method,authorization_version))").eq("id", input.inventoryMemberId).maybeSingle(),
    auth.admin.from("ap_requirement_nodes").select("id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,source_excerpt,parser_certainty,importance,typed_value").eq("job_snapshot_id", input.jobSnapshotId),
    auth.admin.from("ap_human_review_records").select("id,snapshot_id,job_snapshot_id,review_kind,decision,invalidated_at,reviewer_id,created_at").in("id", requestedReviewIds),
  ]);
  const jobSnapshot = one(inventoryMember?.job_snapshot ?? null);
  const sourceAuthorization = jobSnapshot ? one(jobSnapshot.source_authorization) : null;
  if (!snapshot?.customer_id || !inventoryMember?.selected_by_deduplication || inventoryMember.job_snapshot_id !== input.jobSnapshotId || !jobSnapshot || !sourceAuthorization) {
    return NextResponse.json({ error: "The immutable snapshot, selected inventory member, or source authorization is unavailable." }, { status: 409 });
  }
  if ((requestedReviews || []).length !== requestedReviewIds.length || (requestedReviews || []).some((review) => review.snapshot_id !== input.snapshotId || review.job_snapshot_id !== input.jobSnapshotId || review.invalidated_at)) {
    return NextResponse.json({ error: "Every evaluation input must be a current immutable review for this exact snapshot and job." }, { status: 409 });
  }
  const reviewById = new Map((requestedReviews || []).map((review) => [review.id, review]));
  const evidenceReviews = input.evidenceReviewIds.map((id) => reviewById.get(id)!).filter((review) => review.review_kind === "MATCH_EVIDENCE");
  const usefulnessReview = reviewById.get(input.usefulnessReviewId);
  const compensationReview = input.compensationReviewId ? reviewById.get(input.compensationReviewId) ?? null : null;
  if (evidenceReviews.length !== input.evidenceReviewIds.length || usefulnessReview?.review_kind !== "CATEGORICAL_USEFULNESS" || input.compensationReviewId && compensationReview?.review_kind !== "COMPENSATION_COMPARABILITY") {
    return NextResponse.json({ error: "Review references must use the exact evidence, usefulness, and compensation review kinds." }, { status: 409 });
  }

  const allReviewRecords = [usefulnessReview, ...evidenceReviews, ...(compensationReview ? [compensationReview] : [])] as PersistedReview[];
  const candidateFactIds = [...new Set(allReviewRecords.flatMap((review) => {
    const decision = record(review.decision);
    const sections = record(decision.explanationEvidence);
    return [
      ...strings(decision.candidateFactIds),
      ...strings(decision.candidateFactVersionIds),
      ...Object.values(sections).flatMap((section) => strings(record(section).candidateFactIds)),
    ];
  }))];
  const adjacentReviewIds = [...new Set(evidenceReviews.flatMap((review) => {
    const id = record(review.decision).adjacentEquivalenceReviewId;
    return typeof id === "string" ? [id] : [];
  }))];
  const [{ data: facts }, { data: adjacentReviews }] = await Promise.all([
    candidateFactIds.length
      ? auth.admin.from("ap_candidate_facts").select("id,snapshot_id,semantic_key,value_kind,typed_value,verification,source_kind,supplied_source_id,superseded_at,capability_status,calendar_duration_days,customer_display_label,customer_display_value").in("id", candidateFactIds)
      : Promise.resolve({ data: [] as PersistedCandidateFact[], error: null }),
    adjacentReviewIds.length
      ? auth.admin.from("ap_human_review_records").select("id,snapshot_id,job_snapshot_id,review_kind,decision,invalidated_at,reviewer_id,created_at").in("id", adjacentReviewIds)
      : Promise.resolve({ data: [] as PersistedReview[], error: null }),
  ]);
  if ((facts || []).length !== candidateFactIds.length || (facts || []).some((fact) => fact.snapshot_id !== input.snapshotId || fact.superseded_at || !["CUSTOMER_CONFIRMED", "HUMAN_VERIFIED"].includes(fact.verification) || fact.verification === "HUMAN_VERIFIED" && (fact.source_kind !== "HUMAN_VERIFICATION" || !fact.supplied_source_id))) {
    return NextResponse.json({ error: "All candidate evidence must be current and customer-confirmed or independently human-verified." }, { status: 409 });
  }
  const adjacentById = new Map((adjacentReviews || []).map((review) => [review.id, review]));
  const invalidAdjacent = evidenceReviews.some((review) => {
    const decision = record(review.decision);
    if (decision.evidenceRelation !== "ADJACENT") return false;
    const adjacent = typeof decision.adjacentEquivalenceReviewId === "string" ? adjacentById.get(decision.adjacentEquivalenceReviewId) : null;
    const adjacentDecision = record(adjacent?.decision);
    const expectedFacts = strings(decision.candidateFactVersionIds).sort();
    const reviewedFacts = strings(adjacentDecision.candidateFactVersionIds).sort();
    return !adjacent || adjacent.invalidated_at || adjacent.snapshot_id !== input.snapshotId || adjacent.job_snapshot_id !== input.jobSnapshotId || adjacent.review_kind !== "ADJACENT_EQUIVALENCE"
      || adjacentDecision.stableCriterionId !== decision.stableCriterionId || adjacentDecision.equivalentForCriterion !== true
      || expectedFacts.length !== reviewedFacts.length || expectedFacts.some((id, index) => id !== reviewedFacts[index]);
  });
  if ((adjacentReviews || []).length !== adjacentReviewIds.length || invalidAdjacent) return NextResponse.json({ error: "Adjacent evidence no longer has an exact current equivalence review." }, { status: 409 });

  try {
    const derived = deriveEvaluationFromPersistedEvidence({
      snapshot,
      job: jobSnapshot,
      sourceAuthorization,
      nodes: (nodes || []) as PersistedRequirementRow[],
      facts: (facts || []) as PersistedCandidateFact[],
      evidenceReviews,
      usefulnessReview,
      compensationReview,
    });
    const rootResult = derived.gates.some((gate) => gate.result === "FAIL") ? "FAIL" : derived.gates.some((gate) => gate.result === "UNKNOWN") ? "UNKNOWN" : "PASS";
    const { data, error } = await auth.admin.from("ap_match_evaluations").insert({
      customer_id: snapshot.customer_id,
      snapshot_id: input.snapshotId,
      job_snapshot_id: input.jobSnapshotId,
      inventory_member_id: input.inventoryMemberId,
      inventory_version_id: inventoryMember.inventory_version_id,
      eligibility: derived.eligibility.disposition,
      root_result: rootResult,
      leaf_results: [
        ...derived.gates.slice(0, -1).map((gate) => ({ requirementNodeId: gate.rootKey, criterionType: gate.rootKey === "universal:salary" ? "COMPENSATION" : gate.rootKey.slice("universal:".length).toLocaleUpperCase("en-US").replaceAll("-", "_"), result: gate.result, resolutionIssue: gate.resolutionIssue, unknownTreatment: gate.unknownTreatment, outcomeDeterminative: gate.result !== "PASS" })),
        ...derived.requirement.leafResults.map((leaf) => ({ requirementNodeId: leaf.nodeId, criterionType: (nodes || []).find((node) => node.id === leaf.nodeId)?.criterion_type ?? "UNKNOWN", ...leaf })),
      ],
      resolution_issues: [...new Set(derived.gates.map((gate) => gate.resolutionIssue))],
      unknown_treatments: [...new Set(derived.gates.map((gate) => gate.unknownTreatment))],
      satisfaction_paths: derived.requirement.selectedSatisfactionPath ? [{ rootKey: derived.requirement.nodeId, selectedNodeIds: derived.requirement.selectedSatisfactionPath }] : [],
      categorical_evidence_sufficient: derived.usefulness.evidenceSufficient,
      fit_score: derived.fit.score,
      fit_components: derived.components,
      evidence_confidence: derived.confidence.score,
      confidence_components: { ...derived.confidenceInputs, score: derived.confidence.score, provenance: "SERVER_DERIVED_FROM_PERSISTED_EVIDENCE" },
      salary_status: derived.salary.status,
      salary_disposition: derived.salary.disposition,
      soft_preferences: { selectedCount: derived.preferences.length, score: derived.preference, components: derived.preferences },
      application_readiness: derived.applicationReadiness,
      presentation_risk: derived.presentationRisk,
      presentation_risk_reasons: derived.presentationRiskReasons,
      warnings: [...derived.eligibility.warnings.map((warning) => ({ code: "EMPLOYER_UNKNOWN", messageKey: warning, evidenceIds: [] })), ...(derived.salary.warning ? [{ code: "SALARY", messageKey: derived.salary.warning, evidenceIds: [] }] : [])],
      candidate_fact_ids: derived.candidateFactIds,
      job_evidence: derived.jobEvidence,
      explanation_evidence: derived.explanationEvidence,
      version_bundle: derived.versionBundle,
      human_review_id: usefulnessReview.id,
      active_root_keys: derived.gates.map((gate) => gate.rootKey),
      root_results: derived.gates.map((gate) => ({ rootKey: gate.rootKey, result: gate.result })),
      calculation_input_sha256: derived.calculationInputSha256,
      calculation_version: MATCHING_RULES_VERSION,
      usefulness_result: derived.usefulness.evidenceSufficient ? "PASS" : derived.usefulness.reason === "HUMAN_REVIEW_REQUIRED" ? "HUMAN_REVIEW" : "FAIL",
      preference_alignment: derived.preference,
      confidence_label: derived.confidence.label,
      rank_explanation: { state: "AWAITING_SELECTION_RUN", storage: "ap_match_selection_members", version: MATCHING_RULES_VERSION },
      selector_explanation: { state: "AWAITING_SELECTION_RUN", storage: "ap_match_selection_members", version: SELECTOR_VERSION },
      legacy_compatibility: false,
    }).select("id,eligibility,fit_score,evidence_confidence,salary_status,salary_disposition,usefulness_result").single();
    if (error || !data) throw error || new Error("evaluation_not_persisted");
    return NextResponse.json({ evaluation: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The persisted evidence could not produce a typed evaluation." }, { status: 409 });
  }
}

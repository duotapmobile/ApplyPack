import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { canonicalSha256 } from "@/lib/domain/foundation";
import {
  MATCHING_RULES_VERSION,
  SELECTOR_VERSION,
  calculateConfidence,
  calculateFit,
  calculatePreferenceAlignment,
  deriveEligibility,
  evaluateSalary,
  evaluateUsefulnessGate,
  presentationRiskReasons,
} from "@/lib/matching/evaluation-engine";
import { isSameOriginRequest } from "@/lib/security/origin";

const uuid = z.string().uuid();
const gateSchema = z.object({
  rootKey: uuid,
  result: z.enum(["PASS", "FAIL", "UNKNOWN"]),
  resolutionIssue: z.enum(["NONE", "CANDIDATE_MISSING", "EMPLOYER_OMITTED", "PARSER_UNCERTAIN", "EVIDENCE_CONFLICT"]),
  unknownTreatment: z.enum(["BLOCK", "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING", "IMMATERIAL_ALTERNATIVE"]),
  consentVersion: z.string().trim().min(1).max(100).optional(),
  warning: z.string().trim().min(1).max(500).optional(),
  unwaivable: z.boolean().optional(),
  candidateFactIds: z.array(uuid).max(100),
  evidenceNodeIds: z.array(uuid).min(1).max(100),
  relation: z.enum(["DIRECT", "ADJACENT", "TRANSFERABLE", "UNSUPPORTED"]),
  adjacentEquivalenceReviewId: uuid.nullable(),
}).strict();

const schema = z.object({
  snapshotId: uuid,
  inventoryMemberId: uuid,
  jobSnapshotId: uuid,
  gates: z.array(gateSchema).min(1).max(200),
  salary: z.object({
    hardMinimumCents: z.number().int().nonnegative().nullable(), flexibleMinimum: z.boolean(), minimumPeriod: z.enum(["HOUR", "YEAR"]).nullable(), minimumBasis: z.enum(["BASE", "GUARANTEED_TOTAL"]).nullable(),
    publishedByEmployer: z.boolean(), estimateOnly: z.boolean(), currency: z.string().nullable(), period: z.enum(["HOUR", "YEAR"]).nullable(), basis: z.enum(["BASE", "GUARANTEED_TOTAL", "VARIABLE_OTE"]).nullable(),
    lowerCents: z.number().int().nonnegative().nullable(), upperCents: z.number().int().nonnegative().nullable(), endpointMeaning: z.enum(["RANGE", "STARTING_AT", "UP_TO", "FIXED"]).optional(), correctLocationRange: z.boolean(), workerBasisComparable: z.boolean(),
    variableMaterial: z.boolean(), variableAccepted: z.boolean(), includeOverlap: z.boolean(), includeUnpublished: z.boolean(), includeNoncomparableUsd: z.boolean(),
    conversion: z.object({ hoursPerWeek: z.number().positive(), weeksPerYear: z.number().positive(), version: z.string().min(1), accepted: z.boolean() }).strict().nullable().optional(),
  }).strict(),
  usefulness: z.object({ employerCoreResponsibilityCount: z.number().int().nonnegative(), confirmedDirectCoreConnections: z.number().int().nonnegative(), reviewedAdjacentCoreConnections: z.number().int().nonnegative(), explanationSectionEvidenceCounts: z.array(z.number().int().nonnegative()).length(5), reviewerWorthwhileReason: z.string().trim().min(10).max(2000), certifiedNotQuotaFiller: z.literal(true) }).strict(),
  fitComponents: z.array(z.object({ name: z.enum(["CORE_RESPONSIBILITY_ALIGNMENT", "REQUIRED_TOOL_TECHNICAL_ALIGNMENT", "RELEVANT_EXPERIENCE_DEPTH_SCOPE", "EDUCATION_CERTIFICATION_ALIGNMENT", "CURRENT_READINESS"]), applicable: z.boolean(), criteria: z.array(z.object({ criterionId: uuid, importance: z.union([z.literal(1), z.literal(2), z.literal(3)]), evidenceFactor: z.number().min(0).max(1), capabilityOrDepthFactor: z.number().min(0).max(1).nullable().optional(), evidenceIds: z.array(uuid).min(1) }).strict()) }).strict()).length(5),
  confidence: z.object({ candidateCompleteness: z.number().min(0).max(1), employerCompleteness: z.number().min(0).max(1), materialSourceQualities: z.array(z.number().min(0).max(1)).min(1), parserCertainty: z.number().min(0).max(1) }).strict(),
  preferences: z.array(z.object({ preferenceId: uuid, value: z.union([z.literal(0), z.literal(0.5), z.literal(0.75), z.literal(1)]) }).strict()).max(100),
  applicationReadiness: z.enum(["READY", "NEEDS_CUSTOMER_ACTION", "BLOCKED"]),
  presentationRisk: z.enum(["LOW", "MEDIUM", "HIGH", "NOT_ASSESSED"]),
  presentationRiskReasons: z.array(z.enum(presentationRiskReasons)),
  humanReviewId: uuid.nullable(),
}).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This evaluation request was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A complete typed evaluation input is required.", details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  const [{ data: snapshot }, { data: inventoryMember }, { data: nodes }] = await Promise.all([
    auth.admin.from("ap_intake_snapshots").select("id,customer_id,draft_id,content_sha256,schema_version").eq("id", input.snapshotId).maybeSingle(),
    auth.admin.from("ap_inventory_members").select("id,inventory_version_id,job_snapshot_id,selected_by_deduplication,job_snapshot:ap_job_snapshots(id,content_sha256,parser_version,source_authorization_id,legitimacy_result,listing_activity_result,application_path_result)").eq("id", input.inventoryMemberId).maybeSingle(),
    auth.admin.from("ap_requirement_nodes").select("id,stable_criterion_id,job_snapshot_id,requirement_strength,source_locator,source_excerpt,criterion_version").eq("job_snapshot_id", input.jobSnapshotId).eq("node_kind", "CRITERION"),
  ]);
  const jobSnapshot = inventoryMember && (Array.isArray(inventoryMember.job_snapshot) ? inventoryMember.job_snapshot[0] : inventoryMember.job_snapshot);
  if (!snapshot?.customer_id || !inventoryMember?.selected_by_deduplication || inventoryMember.job_snapshot_id !== input.jobSnapshotId || !jobSnapshot) return NextResponse.json({ error: "The immutable snapshot or selected inventory member is unavailable." }, { status: 409 });
  if (jobSnapshot.legitimacy_result !== "PASS" || jobSnapshot.listing_activity_result !== "PASS" || jobSnapshot.application_path_result !== "PASS") return NextResponse.json({ error: "The listing verification record is not eligible for evaluation." }, { status: 409 });
  const requiredNodes = (nodes || []).filter((node) => node.requirement_strength === "REQUIRED" && node.stable_criterion_id);
  const expectedRoots = requiredNodes.map((node) => node.stable_criterion_id!);
  const actualRoots = input.gates.map((gate) => gate.rootKey);
  if (expectedRoots.length !== actualRoots.length || [...expectedRoots].sort().some((id, index) => id !== [...actualRoots].sort()[index])) return NextResponse.json({ error: "Gate results must exactly equal the active persisted root set." }, { status: 409 });
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const evidenceNodeIds = [...new Set(input.gates.flatMap((gate) => gate.evidenceNodeIds))];
  if (evidenceNodeIds.some((id) => !nodeById.has(id))) return NextResponse.json({ error: "Every employer evidence ID must belong to this exact job snapshot." }, { status: 409 });
  const candidateFactIds = [...new Set(input.gates.flatMap((gate) => gate.candidateFactIds))];
  if (candidateFactIds.length) {
    const { data: facts } = await auth.admin.from("ap_candidate_facts").select("id,snapshot_id,verification").in("id", candidateFactIds);
    if ((facts || []).length !== candidateFactIds.length || (facts || []).some((fact) => fact.snapshot_id !== input.snapshotId || !["CUSTOMER_CONFIRMED", "HUMAN_VERIFIED"].includes(fact.verification))) return NextResponse.json({ error: "Candidate facts must be current, customer-confirmed, or independently human-verified." }, { status: 409 });
  }
  const adjacentReviewIds = [...new Set(input.gates.map((gate) => gate.adjacentEquivalenceReviewId).filter((id): id is string => Boolean(id)))];
  if (adjacentReviewIds.length) {
    const { data: reviews } = await auth.admin.from("ap_human_review_records").select("id,snapshot_id,job_snapshot_id,review_kind,decision,invalidated_at").in("id", adjacentReviewIds);
    const reviewById = new Map((reviews || []).map((review) => [review.id, review]));
    const invalidAdjacent = input.gates.some((gate) => {
      if (!gate.adjacentEquivalenceReviewId) return gate.relation === "ADJACENT";
      const review = reviewById.get(gate.adjacentEquivalenceReviewId);
      const decision = review?.decision as Record<string, unknown> | undefined;
      const reviewedFacts = Array.isArray(decision?.candidateFactVersionIds) ? decision.candidateFactVersionIds.map(String).sort() : [];
      return !review || review.snapshot_id !== input.snapshotId || review.job_snapshot_id !== input.jobSnapshotId || review.review_kind !== "ADJACENT_EQUIVALENCE" || Boolean(review.invalidated_at)
        || decision?.equivalentForCriterion !== true || decision.stableCriterionId !== gate.rootKey
        || reviewedFacts.length !== gate.candidateFactIds.length || reviewedFacts.some((id, index) => id !== [...gate.candidateFactIds].sort()[index]);
    });
    if ((reviews || []).length !== adjacentReviewIds.length || invalidAdjacent) return NextResponse.json({ error: "Adjacent evidence must cite an exact current equivalence review for the criterion and fact versions." }, { status: 409 });
  } else if (input.gates.some((gate) => gate.relation === "ADJACENT")) {
    return NextResponse.json({ error: "Adjacent evidence requires an exact persisted equivalence review." }, { status: 409 });
  }
  if (input.humanReviewId) {
    const { data: review } = await auth.admin.from("ap_human_review_records").select("id,snapshot_id,job_snapshot_id,invalidated_at").eq("id", input.humanReviewId).maybeSingle();
    if (!review || review.snapshot_id !== input.snapshotId || review.job_snapshot_id !== input.jobSnapshotId || review.invalidated_at) return NextResponse.json({ error: "The human review must be current and bound to this exact snapshot and job." }, { status: 409 });
  }
  try {
    const eligibility = deriveEligibility(expectedRoots, input.gates.map((gate) => ({ rootKey: gate.rootKey, result: gate.result, resolutionIssue: gate.resolutionIssue, unknownTreatment: gate.unknownTreatment, consentVersion: gate.consentVersion, warning: gate.warning, unwaivable: gate.unwaivable })));
    const salary = evaluateSalary(input.salary);
    const usefulness = evaluateUsefulnessGate({ ...input.usefulness, disposition: eligibility.disposition, readiness: input.applicationReadiness });
    const fit = calculateFit(eligibility.disposition, usefulness.evidenceSufficient, input.fitComponents);
    const confidence = calculateConfidence(input.confidence);
    const preference = calculatePreferenceAlignment(input.preferences);
    if (confidence.label === "LOW" && !input.humanReviewId) return NextResponse.json({ error: "Low-confidence evaluations require a persisted human review." }, { status: 409 });
    const jobEvidence = evidenceNodeIds.map((id) => {
      const node = nodeById.get(id)!;
      return { id, jobSnapshotId: input.jobSnapshotId, field: node.stable_criterion_id || id, sourceLocator: node.source_locator!, contentSha256: canonicalSha256(node.source_excerpt || node.source_locator || id) };
    });
    const rootResult = input.gates.some((gate) => gate.result === "FAIL") ? "FAIL" : input.gates.some((gate) => gate.result === "UNKNOWN") ? "UNKNOWN" : "PASS";
    const versionBundle = { matching: MATCHING_RULES_VERSION, parser: jobSnapshot.parser_version, catalog: MATCHING_RULES_VERSION, criteria: snapshot.schema_version, selector: SELECTOR_VERSION, jobSnapshot: jobSnapshot.content_sha256 };
    const calculationInput = { snapshotHash: snapshot.content_sha256, inventoryMemberId: input.inventoryMemberId, gates: input.gates, salary: input.salary, usefulness: input.usefulness, fitComponents: input.fitComponents, confidence: input.confidence, preferences: input.preferences, applicationReadiness: input.applicationReadiness };
    const { data, error } = await auth.admin.from("ap_match_evaluations").insert({
      customer_id: snapshot.customer_id,
      snapshot_id: input.snapshotId,
      job_snapshot_id: input.jobSnapshotId,
      inventory_member_id: input.inventoryMemberId,
      inventory_version_id: inventoryMember.inventory_version_id,
      eligibility: eligibility.disposition,
      root_result: rootResult,
      leaf_results: input.gates.map((gate) => ({ requirementNodeId: gate.rootKey, result: gate.result, resolutionIssue: gate.resolutionIssue, unknownTreatment: gate.unknownTreatment, satisfactionPath: gate.result === "PASS" ? { requirementNodeId: gate.rootKey, selectedChildNodeIds: [gate.rootKey], candidateFactIds: gate.candidateFactIds, jobEvidenceIds: gate.evidenceNodeIds, relation: gate.relation, adjacentEquivalenceReviewId: gate.adjacentEquivalenceReviewId } : null })),
      resolution_issues: [...new Set(input.gates.map((gate) => gate.resolutionIssue))],
      unknown_treatments: [...new Set(input.gates.map((gate) => gate.unknownTreatment))],
      satisfaction_paths: input.gates.filter((gate) => gate.result === "PASS").map((gate) => ({ rootKey: gate.rootKey, candidateFactIds: gate.candidateFactIds, jobEvidenceIds: gate.evidenceNodeIds, relation: gate.relation, adjacentEquivalenceReviewId: gate.adjacentEquivalenceReviewId })),
      categorical_evidence_sufficient: usefulness.evidenceSufficient,
      fit_score: fit.score,
      fit_components: input.fitComponents,
      evidence_confidence: confidence.score,
      confidence_components: { candidateCompleteness: input.confidence.candidateCompleteness, employerCompleteness: input.confidence.employerCompleteness, sourceQuality: confidence.sourceQuality, parserCertainty: input.confidence.parserCertainty, score: confidence.score },
      salary_status: salary.status,
      salary_disposition: salary.disposition,
      soft_preferences: { selectedCount: input.preferences.length, score: preference, components: input.preferences },
      application_readiness: input.applicationReadiness,
      presentation_risk: input.presentationRisk,
      presentation_risk_reasons: input.presentationRiskReasons,
      warnings: [...eligibility.warnings.map((warning) => ({ code: "EMPLOYER_UNKNOWN", messageKey: warning, evidenceIds: [] })), ...(salary.warning ? [{ code: "SALARY", messageKey: salary.warning, evidenceIds: [] }] : [])],
      candidate_fact_ids: candidateFactIds,
      job_evidence: jobEvidence,
      version_bundle: versionBundle,
      human_review_id: input.humanReviewId,
      active_root_keys: expectedRoots,
      root_results: input.gates.map((gate) => ({ rootKey: gate.rootKey, result: gate.result })),
      calculation_input_sha256: canonicalSha256(calculationInput),
      calculation_version: MATCHING_RULES_VERSION,
      usefulness_result: usefulness.evidenceSufficient ? "PASS" : usefulness.reason === "HUMAN_REVIEW_REQUIRED" ? "HUMAN_REVIEW" : "FAIL",
      preference_alignment: preference,
      confidence_label: confidence.label,
      rank_explanation: { pendingSelection: true, version: MATCHING_RULES_VERSION },
      selector_explanation: { pendingSelection: true, version: SELECTOR_VERSION },
      legacy_compatibility: false,
    }).select("id,eligibility,fit_score,evidence_confidence,salary_status,salary_disposition,usefulness_result").single();
    if (error || !data) throw error || new Error("evaluation_not_persisted");
    return NextResponse.json({ evaluation: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The typed evaluation could not be calculated." }, { status: 409 });
  }
}

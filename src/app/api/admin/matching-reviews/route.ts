import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { matchingReviewRequestSchema, buildMatchingReviewDecision, buildReviewSubjectKey, type ParserCorrectionSystemEvidence } from "@/lib/matching/review";
import { MATCHING_RULES_VERSION } from "@/lib/matching/evaluation-engine";
import { parseListingRequirements, requirementPersistenceRows } from "@/lib/matching/listing-parser";
import { isSameOriginRequest } from "@/lib/security/origin";
import { customerCriterionEvidenceMatches } from "@/lib/matching/evidence-derived";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This review request was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = matchingReviewRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Complete the typed review, evidence changes, rationale, and source links." }, { status: 400 });
  const review = parsed.data;
  const [{ data: snapshot }, { data: jobSnapshot }, { data: nodes }, { data: inventoryMember }, { data: successor, error: successorError }] = await Promise.all([
    auth.admin.from("ap_intake_snapshots").select("id,customer_id,draft_id,content_sha256,schema_version").eq("id", review.snapshotId).maybeSingle(),
    auth.admin.from("ap_job_snapshots").select("id,requirement_completeness,source_authorization:ap_source_authorizations(state)").eq("id", review.jobSnapshotId).maybeSingle(),
    auth.admin.from("ap_requirement_nodes").select("id,job_snapshot_id,node_kind,criterion_type,stable_criterion_id,source_locator,source_excerpt,typed_value").in("id", review.sourceEvidenceNodeIds),
    review.inventoryMemberId
      ? auth.admin.from("ap_inventory_members").select("id,job_snapshot_id,inventory_version_id,stable_normalized_job_id,selected_by_deduplication").eq("id", review.inventoryMemberId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    auth.admin.from("ap_job_snapshots").select("id").eq("supersedes_job_snapshot_id", review.jobSnapshotId).maybeSingle(),
  ]);
  const sourceAuthorization = jobSnapshot && (Array.isArray(jobSnapshot.source_authorization) ? jobSnapshot.source_authorization[0] : jobSnapshot.source_authorization);
  if (!snapshot || !jobSnapshot) return NextResponse.json({ error: "The immutable snapshot or job evidence is unavailable." }, { status: 404 });
  if (successorError || successor) return NextResponse.json({ error: "This job evidence is unavailable or was superseded by a corrected immutable snapshot." }, { status: 409 });
  if (!sourceAuthorization || !["AUTHORIZED_AUTOMATED", "AUTHORIZED_MANUAL_ONLY"].includes(sourceAuthorization.state)) return NextResponse.json({ error: "The job source authorization is not currently valid." }, { status: 409 });
  if ((nodes || []).length !== new Set(review.sourceEvidenceNodeIds).size || (nodes || []).some((node) => node.job_snapshot_id !== review.jobSnapshotId || node.node_kind !== "CRITERION" || !node.source_locator || !node.source_excerpt)) {
    return NextResponse.json({ error: "Every source evidence node must be a cited criterion from this exact job snapshot." }, { status: 409 });
  }
  if (review.candidateFactIds.length) {
    const { data: facts } = await auth.admin.from("ap_candidate_facts").select("id,snapshot_id,verification,source_kind,supplied_source_id,superseded_at").in("id", review.candidateFactIds);
    if ((facts || []).length !== new Set(review.candidateFactIds).size || (facts || []).some((fact) => fact.snapshot_id !== review.snapshotId || fact.superseded_at || !["CUSTOMER_CONFIRMED", "HUMAN_VERIFIED"].includes(fact.verification) || (fact.verification === "HUMAN_VERIFIED" && (fact.source_kind !== "HUMAN_VERIFICATION" || !fact.supplied_source_id)))) {
      return NextResponse.json({ error: "Candidate evidence must belong to this snapshot and be customer-confirmed or independently human-verified." }, { status: 409 });
    }
  }
  if (review.reviewKind === "ADJACENT_EQUIVALENCE" && !(nodes || []).some((node) => node.stable_criterion_id === review.stableCriterionId)) {
    return NextResponse.json({ error: "Adjacent equivalence must cite its exact stable criterion in this job snapshot." }, { status: 409 });
  }
  if (review.reviewKind === "MATCH_EVIDENCE" && (nodes || []).some((node) => node.stable_criterion_id !== review.stableCriterionId)) {
    return NextResponse.json({ error: "Every employer evidence node must correspond to the exact reviewed criterion." }, { status: 409 });
  }
  if (review.reviewKind === "COMPENSATION_COMPARABILITY") {
    const selected = (nodes || []).find((node) => node.criterion_type === "COMPENSATION" && node.stable_criterion_id === review.selectedCompensationCriterionId);
    if (!selected) return NextResponse.json({ error: "Compensation review must cite the exact selected location-specific compensation criterion." }, { status: 409 });
  }
  if (review.reviewKind === "CUSTOMER_CRITERION" && review.unknownTreatment === "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING") {
    const expectedConsent = `${snapshot.schema_version}:${snapshot.content_sha256}`;
    if (review.consentVersion !== expectedConsent) return NextResponse.json({ error: "Allowed employer omission must use the exact immutable customer-consent version." }, { status: 409 });
  }
  if (review.reviewKind === "CUSTOMER_CRITERION" && !(nodes || []).some((node) => customerCriterionEvidenceMatches(review.customerCriterionKey!, node.typed_value))) {
    return NextResponse.json({ error: "Customer-criterion review evidence must be the exact typed employer criterion for that gate." }, { status: 409 });
  }
  if (review.reviewKind === "MATCH_EVIDENCE" && review.evidenceRelation === "ADJACENT" && review.adjacentEquivalenceReviewId) {
    const { data: adjacent } = await auth.admin.from("ap_human_review_records").select("id,snapshot_id,job_snapshot_id,review_kind,decision,invalidated_at").eq("id", review.adjacentEquivalenceReviewId).maybeSingle();
    const decision = adjacent?.decision && typeof adjacent.decision === "object" && !Array.isArray(adjacent.decision) ? adjacent.decision as Record<string, unknown> : {};
    const expectedFacts = [...new Set(review.candidateFactIds)].sort();
    const reviewedFacts = Array.isArray(decision.candidateFactVersionIds) ? decision.candidateFactVersionIds.map(String).sort() : [];
    if (!adjacent || adjacent.invalidated_at || adjacent.snapshot_id !== review.snapshotId || adjacent.job_snapshot_id !== review.jobSnapshotId || adjacent.review_kind !== "ADJACENT_EQUIVALENCE" || decision.stableCriterionId !== review.stableCriterionId || decision.equivalentForCriterion !== true || expectedFacts.length !== reviewedFacts.length || expectedFacts.some((id, index) => id !== reviewedFacts[index])) {
      return NextResponse.json({ error: "Adjacent match evidence must reference the exact current equivalence review." }, { status: 409 });
    }
  }
  let correction: ParserCorrectionSystemEvidence | undefined;
  let correctionPayload: Record<string, unknown> | null = null;
  if (review.reviewKind === "PARSER_CORRECTION" && review.disposition === "RESOLVED_PASS") {
    if (!inventoryMember || !review.correctedListingText || inventoryMember.job_snapshot_id !== review.jobSnapshotId || !inventoryMember.selected_by_deduplication) {
      return NextResponse.json({ error: "Parser correction requires the exact selected inventory member for the incomplete job snapshot." }, { status: 409 });
    }
    const correctedJobSnapshotId = randomUUID();
    const correctedInventoryVersionId = randomUUID();
    const correctedInventoryMemberId = randomUUID();
    const correctedCoveragePlanId = randomUUID();
    const parsedCorrection = parseListingRequirements({ jobSnapshotId: correctedJobSnapshotId, listingText: review.correctedListingText });
    if (parsedCorrection.status !== "COMPLETE" || !parsedCorrection.tree) {
      return NextResponse.json({ error: "The corrected listing still contains unresolved parser issues.", issues: parsedCorrection.issues }, { status: 409 });
    }
    const correctedNodes = requirementPersistenceRows(parsedCorrection, review.correctedListingText);
    const capturedListing = { text: review.correctedListingText, parserIssues: [], correctionOf: review.jobSnapshotId };
    correction = { correctedJobSnapshotId, correctedInventoryVersionId, correctedInventoryMemberId };
    correctionPayload = {
      originalInventoryMemberId: inventoryMember.id,
      correctedJobSnapshotId,
      correctedInventoryVersionId,
      correctedInventoryMemberId,
      correctedCoveragePlanId,
      capturedListing,
      parserVersion: parsedCorrection.parserVersion,
      contentSha256: canonicalSha256(capturedListing),
      compensationText: parsedCorrection.criteria.find((criterion) => criterion.kind === "COMPENSATION")?.semanticKey ?? null,
      compensationCompleteness: parsedCorrection.criteria.some((criterion) => criterion.kind === "COMPENSATION") ? 100 : 0,
      locationAndWorkMode: {
        modes: parsedCorrection.criteria.filter((criterion) => criterion.kind === "WORK_MODE").flatMap((criterion) => criterion.kind === "WORK_MODE" ? criterion.modes : []),
        statesOrDc: parsedCorrection.criteria.filter((criterion) => criterion.kind === "GEOGRAPHY").flatMap((criterion) => criterion.kind === "GEOGRAPHY" ? criterion.statesOrDc : []),
      },
      requirementNodes: correctedNodes,
      inventoryContentSha256: canonicalSha256({ supersedesInventoryVersionId: inventoryMember.inventory_version_id, correctedJobSnapshotId, parserVersion: parsedCorrection.parserVersion }),
      coveragePlanContentSha256: canonicalSha256({ snapshotId: review.snapshotId, correctedInventoryVersionId, correctedJobSnapshotId }),
    };
  }
  const resolvedAt = new Date().toISOString();
  const decision = buildMatchingReviewDecision(review, auth.user.id, resolvedAt, correction);
  const reviewRow = {
    customer_id: snapshot.customer_id,
    draft_id: snapshot.draft_id,
    reviewer_id: auth.user.id,
    snapshot_id: review.snapshotId,
    job_snapshot_id: review.jobSnapshotId,
    review_kind: review.reviewKind,
    review_subject_key: buildReviewSubjectKey(review),
    compared_tasks: review.comparedTasks,
    task_similarity: review.taskSimilarity ?? null,
    complexity: review.complexity ?? null,
    autonomy: review.autonomy ?? null,
    scope: review.scope ?? null,
    domain_context: review.domainContext ?? null,
    duration_and_intensity: review.durationAndIntensity ?? null,
    essential_tools: review.essentialTools ?? null,
    rationale: review.rationale,
    catalog_version: MATCHING_RULES_VERSION,
    decision,
  };
  const { data, error } = await auth.admin.rpc("ap_record_matching_review", { p_review: reviewRow, p_correction: correctionPayload });
  const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  if (error || !result || typeof result.reviewId !== "string") return NextResponse.json({ error: "The immutable review record could not be stored." }, { status: 502 });
  return NextResponse.json({ reviewId: result.reviewId, recordedAt: result.recordedAt, disposition: review.disposition, correctedJobSnapshotId: result.correctedJobSnapshotId ?? null, correctedInventoryMemberId: result.correctedInventoryMemberId ?? null });
}

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { matchingReviewRequestSchema, buildMatchingReviewDecision } from "@/lib/matching/review";
import { MATCHING_RULES_VERSION } from "@/lib/matching/evaluation-engine";
import { isSameOriginRequest } from "@/lib/security/origin";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This review request was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = matchingReviewRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Complete the typed review, evidence changes, rationale, and source links." }, { status: 400 });
  const review = parsed.data;
  const [{ data: snapshot }, { data: jobSnapshot }, { data: nodes }] = await Promise.all([
    auth.admin.from("ap_intake_snapshots").select("id,customer_id,draft_id").eq("id", review.snapshotId).maybeSingle(),
    auth.admin.from("ap_job_snapshots").select("id").eq("id", review.jobSnapshotId).maybeSingle(),
    auth.admin.from("ap_requirement_nodes").select("id,job_snapshot_id,node_kind,source_locator,source_excerpt").in("id", review.sourceEvidenceNodeIds),
  ]);
  if (!snapshot || !jobSnapshot) return NextResponse.json({ error: "The immutable snapshot or job evidence is unavailable." }, { status: 404 });
  if ((nodes || []).length !== new Set(review.sourceEvidenceNodeIds).size || (nodes || []).some((node) => node.job_snapshot_id !== review.jobSnapshotId || node.node_kind !== "CRITERION" || !node.source_locator || !node.source_excerpt)) {
    return NextResponse.json({ error: "Every source evidence node must be a cited criterion from this exact job snapshot." }, { status: 409 });
  }
  if (review.candidateFactIds.length) {
    const { data: facts } = await auth.admin.from("ap_candidate_facts").select("id,snapshot_id,verification").in("id", review.candidateFactIds);
    if ((facts || []).length !== new Set(review.candidateFactIds).size || (facts || []).some((fact) => fact.snapshot_id !== review.snapshotId || !["CUSTOMER_CONFIRMED", "HUMAN_VERIFIED"].includes(fact.verification))) {
      return NextResponse.json({ error: "Candidate evidence must belong to this snapshot and be customer-confirmed or independently human-verified." }, { status: 409 });
    }
  }
  const resolvedAt = new Date().toISOString();
  const decision = buildMatchingReviewDecision(review, auth.user.id, resolvedAt);
  const { data, error } = await auth.admin.from("ap_human_review_records").insert({
    customer_id: snapshot.customer_id,
    draft_id: snapshot.draft_id,
    reviewer_id: auth.user.id,
    snapshot_id: review.snapshotId,
    job_snapshot_id: review.jobSnapshotId,
    review_kind: review.reviewKind,
    compared_tasks: review.comparedTasks,
    rationale: review.rationale,
    catalog_version: MATCHING_RULES_VERSION,
    decision,
  }).select("id,created_at").single();
  if (error || !data) return NextResponse.json({ error: "The immutable review record could not be stored." }, { status: 502 });
  return NextResponse.json({ reviewId: data.id, recordedAt: data.created_at, disposition: review.disposition });
}

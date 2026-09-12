import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { exactTenReleaseMember, loadPersistedEvaluationsForOrder, selectAndPersistEvaluations } from "@/lib/matching/persisted-runtime";
import { releaseVerification } from "@/lib/matching/verification";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  reviewChecklist: z.object({
    criteriaCompared: z.literal(true),
    allListingsRechecked: z.literal(true),
    exactlyTenApplicationWorthy: z.literal(true),
    noPadding: z.literal(true),
    humanReleaseApproved: z.literal(true),
    reviewerNote: z.string().trim().min(20).max(2000),
  }),
  evaluationIds: z.array(z.string().uuid()).length(10).refine((ids) => new Set(ids).size === ids.length, "Evaluation IDs must be distinct."),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This delivery request was rejected." }, { status: 403 });
  const orderId = (await context.params).id;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Exactly 10 persisted match evaluations are required.", details: parsed.error.flatten() }, { status: 400 });
  const { data: order, error: orderError } = await auth.admin.from("orders").select("id,customer_id,intake_id,product_kind,status").eq("id", orderId).maybeSingle();
  if (orderError) return NextResponse.json({ error: "The search order could not be loaded." }, { status: 502 });
  if (!order || order.product_kind !== "job_search" || !["paid", "in_fulfillment"].includes(order.status)) return NextResponse.json({ error: "Search order is not deliverable." }, { status: 409 });

  let evaluations;
  try {
    const current = await loadPersistedEvaluationsForOrder(auth.admin, orderId);
    const selected = (await selectAndPersistEvaluations(auth.admin, current, 10, "RELEASE", orderId)).selected;
    const expected = new Set(selected.map((item) => item.id));
    if (selected.length !== 10 || parsed.data.evaluationIds.some((id) => !expected.has(id))) {
      return NextResponse.json({ error: "Delivery must use the current persisted ten-match selection for the active criteria snapshot." }, { status: 409 });
    }
    const byId = new Map(selected.map((item) => [item.id, item]));
    evaluations = parsed.data.evaluationIds.map((id) => byId.get(id)!);
  } catch {
    return NextResponse.json({ error: "Current persisted evaluations could not be verified." }, { status: 502 });
  }

  const ttlSeconds = Number(process.env.APP_RELEASE_VERIFICATION_TTL_SECONDS);
  const now = new Date().toISOString();
  for (const evaluation of evaluations) {
    const verification = releaseVerification({
      sourceId: evaluation.job_snapshot.discovery_source,
      company: evaluation.job_snapshot.company,
      urls: [evaluation.job_snapshot.canonical_application_url],
      sourceAuthorized: evaluation.job_snapshot.source_authorization?.id === evaluation.job_snapshot.current_source_authorization?.id
        && ["AUTHORIZED_AUTOMATED", "AUTHORIZED_MANUAL_ONLY"].includes(evaluation.job_snapshot.current_source_authorization?.state ?? ""),
      listingActive: evaluation.job_snapshot.listing_activity_result === "PASS",
      applicationActionable: evaluation.job_snapshot.application_path_result === "PASS",
      lastLiveVerifiedAt: evaluation.job_snapshot.live_verified_at,
      now,
      ttlSeconds,
    });
    if (!verification.eligible) return NextResponse.json({ error: "Every persisted listing must pass the configured release-time verification.", reason: verification.reason }, { status: 409 });
  }

  const { data: service, error: serviceError } = await auth.admin.from("ap_search_services")
    .select("id,active_snapshot_id,fulfillment,refund_started_at,delivery_due_at")
    .eq("legacy_order_id", orderId).eq("customer_id", order.customer_id).maybeSingle();
  if (serviceError) return NextResponse.json({ error: "The active corrected search could not be loaded." }, { status: 502 });
  if (!service || service.fulfillment === "DELIVERED" || service.refund_started_at) {
    return NextResponse.json({ error: "The search is already delivered, refunding, or not a corrected active search." }, { status: 409 });
  }
  let members;
  try {
    members = evaluations.map((evaluation, index) => exactTenReleaseMember(evaluation, index + 1));
  } catch {
    return NextResponse.json({ error: "A persisted evaluation is incomplete or no longer deliverable." }, { status: 409 });
  }
  if (new Set(members.map((row) => row.jobId)).size !== 10) {
    return NextResponse.json({ error: "Duplicate jobs cannot occupy more than one delivered position." }, { status: 409 });
  }
  const selectionRunId = evaluations[0]?.selection?.runId;
  if (!selectionRunId || evaluations.some((evaluation) => evaluation.selection?.runId !== selectionRunId)) {
    return NextResponse.json({ error: "All ten evaluations must belong to the current release selection." }, { status: 409 });
  }
  const releaseId = randomUUID();
  const { data: completed, error: completeError } = await auth.admin.rpc("ap_commit_exact_ten_release", {
    p_search_service_id: service.id,
    p_reviewer_id: auth.user.id,
    p_selection_run_id: selectionRunId,
    p_members: members,
    p_review_checklist: parsed.data.reviewChecklist,
    p_reviewer_rationale: parsed.data.reviewChecklist.reviewerNote,
    p_release_id: releaseId,
    p_outbox_id: randomUUID(),
  });
  if (completeError || !completed) {
    return NextResponse.json({ error: "The reviewed matches could not be committed atomically." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, releaseId: completed });
}

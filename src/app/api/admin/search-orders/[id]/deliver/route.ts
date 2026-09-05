import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { notifyCustomer } from "@/lib/email/notify";
import { deliveryRow, loadPersistedEvaluationsForOrder, selectPersistedEvaluations } from "@/lib/matching/persisted-runtime";
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
    const selected = selectPersistedEvaluations(current, 10).selected;
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
      listingActive: evaluation.job_snapshot.listing_activity_result === "PASS",
      applicationActionable: evaluation.job_snapshot.application_path_result === "PASS",
      lastLiveVerifiedAt: evaluation.job_snapshot.live_verified_at,
      now,
      ttlSeconds,
    });
    if (!verification.eligible) return NextResponse.json({ error: "Every persisted listing must pass the configured release-time verification.", reason: verification.reason }, { status: 409 });
  }

  const { data: claimed, error: claimError } = await auth.admin.rpc("claim_order_delivery", { p_order_id: orderId, p_kind: "job_search" });
  if (claimError || !claimed) return NextResponse.json({ error: "The order is already being delivered, refunded, or is no longer eligible." }, { status: 409 });
  const releaseClaim = () => auth.admin.rpc("release_order_delivery", { p_order_id: orderId });
  const { count, error: countError } = await auth.admin.from("job_matches").select("id", { count: "exact", head: true }).eq("search_order_id", orderId);
  if (countError || count) {
    await releaseClaim();
    return NextResponse.json({ error: count ? "Matches already exist for this order." : "Existing delivery state could not be verified." }, { status: count ? 409 : 502 });
  }
  let rows;
  try {
    rows = evaluations.map((evaluation, index) => deliveryRow(evaluation, index + 1));
  } catch {
    await releaseClaim();
    return NextResponse.json({ error: "A persisted evaluation is incomplete or no longer deliverable." }, { status: 409 });
  }
  if (new Set(rows.map((row) => row.job_id)).size !== 10) {
    await releaseClaim();
    return NextResponse.json({ error: "Duplicate jobs cannot occupy more than one delivered position." }, { status: 409 });
  }
  const deliveredAt = new Date();
  const retentionDays = Number(process.env.APP_SOURCE_DOCUMENT_RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    await releaseClaim();
    return NextResponse.json({ error: "Approved source-document retention is not configured." }, { status: 503 });
  }
  const { data: completed, error: completeError } = await auth.admin.rpc("complete_search_delivery", {
    p_order_id: orderId,
    p_actor_id: auth.user.id,
    p_matches: rows,
    p_review_checklist: parsed.data.reviewChecklist,
    p_delivered_at: deliveredAt.toISOString(),
    p_retention_due_at: new Date(deliveredAt.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (completeError || !completed) {
    await releaseClaim();
    return NextResponse.json({ error: "The reviewed matches could not be committed atomically." }, { status: 502 });
  }
  await notifyCustomer({ customerId: order.customer_id, orderId, template: "search_delivery", subject: "Your 10 ApplyPack job matches are ready", lines: ["Your researched job matches are ready in My ApplyPack.", "Review each employer listing before deciding whether to apply."] });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { notifyCustomer } from "@/lib/email/notify";
import { deliveryRow, loadPersistedEvaluationsForOrder, selectAndPersistEvaluations } from "@/lib/matching/persisted-runtime";
import { releaseVerification } from "@/lib/matching/verification";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  status: z.enum(["accepted", "rejected"]),
  resolution: z.string().trim().min(10).max(2000),
  replacementEvaluationId: z.string().uuid().optional(),
}).superRefine((value, context) => {
  if (value.status === "accepted" && !value.replacementEvaluationId) context.addIssue({ code: "custom", path: ["replacementEvaluationId"], message: "Accepted conflicts require a persisted replacement evaluation." });
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This resolution request was rejected." }, { status: 403 });
  const reviewId = (await context.params).id;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a clear resolution and a complete replacement when accepting." }, { status: 400 });
  const { data: review, error: reviewError } = await auth.admin.from("conflict_reviews").select("id,status,customer_id,job_match_id,job_match:job_matches(search_order_id)").eq("id", reviewId).maybeSingle();
  const reviewedMatch = Array.isArray(review?.job_match) ? review.job_match[0] : review?.job_match;
  const searchOrderId = reviewedMatch?.search_order_id;
  if (reviewError) return NextResponse.json({ error: "The conflict review could not be loaded." }, { status: 502 });
  if (!review || review.status !== "submitted") return NextResponse.json({ error: "This conflict review is no longer open." }, { status: 409 });
  let replacementJobId: string | null = null;
  let replacementEvidence: Record<string, unknown> | null = null;
  if (parsed.data.status === "accepted" && parsed.data.replacementEvaluationId) {
    const { count, error: itemCountError } = await auth.admin.from("apply_pack_items").select("id", { count: "exact", head: true }).eq("job_match_id", review.job_match_id);
    if (itemCountError) return NextResponse.json({ error: "Apply Pack eligibility could not be verified." }, { status: 502 });
    if (count) return NextResponse.json({ error: "This job already has a Tailored Resume + Cover Letter order and cannot be replaced automatically." }, { status: 409 });
    try {
      if (!searchOrderId) throw new Error("search_order_required");
      const evaluations = await loadPersistedEvaluationsForOrder(auth.admin, searchOrderId);
      const selection = await selectAndPersistEvaluations(auth.admin, evaluations, 500, "CONFLICT_REPLACEMENT", reviewId);
      const evaluation = selection.selected.find((item) => item.id === parsed.data.replacementEvaluationId);
      if (!evaluation) throw new Error("persisted_replacement_not_current");
      const verification = releaseVerification({
        sourceId: evaluation.job_snapshot.discovery_source,
        company: evaluation.job_snapshot.company,
        urls: [evaluation.job_snapshot.canonical_application_url],
        sourceAuthorized: evaluation.job_snapshot.source_authorization?.id === evaluation.job_snapshot.current_source_authorization?.id
          && ["AUTHORIZED_AUTOMATED", "AUTHORIZED_MANUAL_ONLY"].includes(evaluation.job_snapshot.current_source_authorization?.state ?? ""),
        listingActive: evaluation.job_snapshot.listing_activity_result === "PASS",
        applicationActionable: evaluation.job_snapshot.application_path_result === "PASS",
        lastLiveVerifiedAt: evaluation.job_snapshot.live_verified_at,
        now: new Date().toISOString(),
        ttlSeconds: Number(process.env.APP_RELEASE_VERIFICATION_TTL_SECONDS),
      });
      if (!verification.eligible) return NextResponse.json({ error: "The replacement failed current release verification.", reason: verification.reason }, { status: 409 });
      const persisted = deliveryRow(evaluation, 1);
      replacementJobId = persisted.job_id;
      replacementEvidence = {
        fit_summary: persisted.fit_summary,
        matching_experience: persisted.matching_experience,
        primary_outcome: persisted.primary_outcome,
        core_responsibilities: persisted.core_responsibilities,
        requirements: persisted.requirements,
        hidden_job_functions: persisted.hidden_job_functions,
        concerns: persisted.concerns,
        criteria_checks: persisted.criteria_checks,
        ranking_score: persisted.ranking_score,
        ranking_reason_codes: persisted.ranking_reason_codes,
      };
    } catch {
      return NextResponse.json({ error: "The current persisted replacement evaluation could not be verified." }, { status: 409 });
    }
  }
  const { data: resolved, error } = await auth.admin.rpc("resolve_conflict_review", {
    p_review_id: reviewId,
    p_actor_id: auth.user.id,
    p_status: parsed.data.status,
    p_resolution: parsed.data.resolution,
    p_replacement_job_id: replacementJobId,
    p_replacement: replacementEvidence,
    p_resolved_at: new Date().toISOString(),
  });
  if (error || !resolved) return NextResponse.json({ error: "The review could not be resolved atomically." }, { status: 502 });
  if (searchOrderId) await notifyCustomer({
    customerId: review.customer_id,
    orderId: searchOrderId,
    template: "conflict_review_resolved",
    subject: parsed.data.status === "accepted" ? "Your replacement ApplyPack match is ready" : "Your ApplyPack match review is complete",
    lines: [parsed.data.resolution, parsed.data.status === "accepted" ? "A fresh replacement is now visible in My ApplyPack." : "Your original match remains in My ApplyPack."],
    keySuffix: reviewId,
  });
  return NextResponse.json({ ok: true });
}

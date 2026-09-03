import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { notifyCustomer } from "@/lib/email/notify";
import { normalizeJob } from "@/lib/jobs/normalize";
import { persistNormalizedJob, rankingDatabaseValues } from "@/lib/jobs/persistence";
import { jobPayloadSchema, payloadToRawJob } from "@/lib/jobs/schemas";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  status: z.enum(["accepted", "rejected"]),
  resolution: z.string().trim().min(10).max(2000),
  replacement: jobPayloadSchema.optional(),
}).superRefine((value, context) => {
  if (value.status === "accepted" && !value.replacement) context.addIssue({ code: "custom", path: ["replacement"], message: "Accepted conflicts require a reviewed replacement." });
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
  if (parsed.data.status === "accepted" && parsed.data.replacement) {
    const { count, error: itemCountError } = await auth.admin.from("apply_pack_items").select("id", { count: "exact", head: true }).eq("job_match_id", review.job_match_id);
    if (itemCountError) return NextResponse.json({ error: "Apply Pack eligibility could not be verified." }, { status: 502 });
    if (count) return NextResponse.json({ error: "This job already has an Apply Pack order and cannot be replaced automatically." }, { status: 409 });
    const replacement = parsed.data.replacement;
    const freshnessMs = Number(process.env.APP_JOB_FRESHNESS_HOURS || 24) * 60 * 60 * 1000;
    if (Date.now() - new Date(replacement.checkedAt).getTime() > freshnessMs) {
      return NextResponse.json({ error: "The replacement listing must be freshly rechecked." }, { status: 409 });
    }
    const normalized = normalizeJob(payloadToRawJob(replacement));
    if (normalized.rejectionReason) return NextResponse.json({ error: "An excluded or held employer/source cannot be saved." }, { status: 400 });
    try {
      replacementJobId = await persistNormalizedJob(auth.admin, normalized, replacement.salary || null);
    } catch {
      return NextResponse.json({ error: "The replacement job could not be saved." }, { status: 502 });
    }
    replacementEvidence = {
      fit_summary: replacement.fitSummary,
      matching_experience: replacement.matchingExperience,
      primary_outcome: replacement.primaryOutcome,
      core_responsibilities: replacement.coreResponsibilities,
      requirements: replacement.requirements,
      hidden_job_functions: replacement.hiddenJobFunctions,
      concerns: replacement.concerns,
      criteria_checks: replacement.criteriaChecks,
      ...rankingDatabaseValues(normalized),
    };
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

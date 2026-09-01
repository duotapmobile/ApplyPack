import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { notifyCustomer } from "@/lib/email/notify";

const replacementSchema = z.object({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  sourceUrl: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
  location: z.string().trim().max(300).default(""),
  salary: z.string().trim().max(200).default(""),
  fitSummary: z.string().trim().min(20).max(3000),
  requirements: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  concerns: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  checkedAt: z.iso.datetime(),
});
const schema = z.object({
  status: z.enum(["accepted", "rejected"]),
  resolution: z.string().trim().min(10).max(2000),
  replacement: replacementSchema.optional(),
}).superRefine((value, context) => {
  if (value.status === "accepted" && !value.replacement) context.addIssue({ code: "custom", path: ["replacement"], message: "Accepted conflicts require a reviewed replacement." });
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const reviewId = (await context.params).id;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a clear resolution and a complete replacement when accepting." }, { status: 400 });
  const { data: review } = await auth.admin.from("conflict_reviews").select("id,status,customer_id,job_match_id,job_match:job_matches(search_order_id)").eq("id", reviewId).maybeSingle();
  const reviewedMatch = Array.isArray(review?.job_match) ? review.job_match[0] : review?.job_match;
  const searchOrderId = reviewedMatch?.search_order_id;
  if (!review || review.status !== "submitted") return NextResponse.json({ error: "This conflict review is no longer open." }, { status: 409 });
  if (parsed.data.status === "accepted" && parsed.data.replacement) {
    const { count } = await auth.admin.from("apply_pack_items").select("id", { count: "exact", head: true }).eq("job_match_id", review.job_match_id);
    if (count) return NextResponse.json({ error: "This job already has an Apply Pack order and cannot be replaced automatically." }, { status: 409 });
    const replacement = parsed.data.replacement;
    const freshnessMs = Number(process.env.APP_JOB_FRESHNESS_HOURS || 24) * 60 * 60 * 1000;
    if (Date.now() - new Date(replacement.checkedAt).getTime() > freshnessMs) {
      return NextResponse.json({ error: "The replacement listing must be freshly rechecked." }, { status: 409 });
    }
    const { data: job, error: jobError } = await auth.admin.from("jobs").insert({
      company: replacement.company,
      title: replacement.title,
      source_url: replacement.sourceUrl,
      location_text: replacement.location || null,
      salary_text: replacement.salary || null,
      checked_at: replacement.checkedAt,
      listing_status: "open",
    }).select("id").single();
    if (jobError || !job) return NextResponse.json({ error: "The replacement job could not be saved." }, { status: 502 });
    const { error: matchError } = await auth.admin.from("job_matches").update({
      job_id: job.id,
      fit_summary: replacement.fitSummary,
      requirements: replacement.requirements,
      concerns: replacement.concerns,
      customer_decision: null,
      delivered_at: new Date().toISOString(),
    }).eq("id", review.job_match_id);
    if (matchError) {
      await auth.admin.from("jobs").delete().eq("id", job.id);
      return NextResponse.json({ error: "The replacement match could not be delivered." }, { status: 502 });
    }
  }
  const { error } = await auth.admin.from("conflict_reviews").update({
    status: parsed.data.status,
    resolution: parsed.data.resolution,
    resolved_at: new Date().toISOString(),
  }).eq("id", reviewId).eq("status", "submitted");
  if (error) return NextResponse.json({ error: "The review could not be resolved." }, { status: 502 });
  await auth.admin.from("audit_logs").insert({ actor_id: auth.user.id, action: "conflict_" + parsed.data.status, entity_type: "conflict_review", entity_id: reviewId });
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

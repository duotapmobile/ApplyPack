import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";

const reviewSchema = z.object({
  evaluationId: z.string().uuid(),
  decision: z.enum(["APPROVED", "REJECTED", "EVIDENCE_REQUIRED", "CUSTOMER_INPUT_REQUIRED"]),
  rationale: z.string().trim().min(20).max(2_000),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This review request was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const serviceId = (await context.params).id;
  if (!z.string().uuid().safeParse(serviceId).success) return NextResponse.json({ error: "Search service not found." }, { status: 404 });
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a review decision and provide a specific rationale of at least 20 characters." }, { status: 400 });
  }
  const { data, error } = await auth.admin.rpc("ap_record_job_release_review", {
    p_search_service_id: serviceId,
    p_evaluation_id: parsed.data.evaluationId,
    p_reviewer_id: auth.user.id,
    p_decision: parsed.data.decision,
    p_rationale: parsed.data.rationale,
  });
  if (error || !data) return NextResponse.json({ error: "The bound review could not be recorded." }, { status: 409 });
  return NextResponse.json({ reviewId: data, decision: parsed.data.decision }, { headers: { "cache-control": "no-store" } });
}

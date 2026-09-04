import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyCustomer } from "@/lib/email/notify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({ explanation: z.string().trim().min(10).max(2000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This request was rejected." }, { status: 403 });
  const id = (await context.params).id;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Explain which Dealbreaker conflicts with this job." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return NextResponse.json({ error: "Account storage is not configured." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const rate = await consumeRateLimit({ request, scope: "criteria_conflict", identity: authData.user.id, limit: 10, windowSeconds: 24 * 60 * 60 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many review requests. Contact help@applypack.work if you need assistance." }, { status: 429 });
  const { data: match } = await admin.from("job_matches").select("id,search_order_id,orders!job_matches_search_order_id_fkey(id,customer_id,intake_id,status)").eq("id", id).maybeSingle();
  const order = Array.isArray(match?.orders) ? match?.orders[0] : match?.orders;
  if (!match || !order || order.customer_id !== authData.user.id || order.status !== "delivered") {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }
  const { data: intake, error: intakeError } = await admin.from("intakes").select("criteria_version").eq("id", order.intake_id).maybeSingle();
  if (intakeError || !intake) return NextResponse.json({ error: "The approved criteria snapshot could not be verified." }, { status: 502 });
  const { error } = await admin.from("conflict_reviews").insert({
    job_match_id: id,
    customer_id: authData.user.id,
    explanation: parsed.data.explanation,
    criteria_version: intake?.criteria_version || 1,
  });
  if (error?.code === "23505") return NextResponse.json({ error: "A review is already open for this match." }, { status: 409 });
  if (error) return NextResponse.json({ error: "The review request could not be saved." }, { status: 502 });
  const decision = await admin.from("job_matches").update({ customer_decision: "conflict_reported" }).eq("id", id);
  const audit = await admin.from("audit_logs").insert({ actor_id: authData.user.id, action: "criteria_conflict_submitted", entity_type: "job_match", entity_id: id });
  if (decision.error || audit.error) return NextResponse.json({ error: "The review was recorded, but operator reconciliation is required." }, { status: 500 });
  await notifyCustomer({
    customerId: authData.user.id,
    orderId: order.id,
    template: "conflict_review_received",
    subject: "We received your ApplyPack match review",
    lines: ["We recorded your report that a match conflicts with an Dealbreaker.", "An operator will review the criteria snapshot before deciding on a replacement."],
    keySuffix: id,
  });
  return NextResponse.json({ ok: true });
}

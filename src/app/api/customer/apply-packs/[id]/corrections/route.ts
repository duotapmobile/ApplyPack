import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyCustomer } from "@/lib/email/notify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({ document: z.enum(["resume", "cover_letter", "both"]), correction: z.string().trim().min(10).max(3000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This request was rejected." }, { status: 403 });
  const id = (await context.params).id;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the factual correction." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return NextResponse.json({ error: "Account storage is not configured." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const rate = await consumeRateLimit({ request, scope: "factual_correction", identity: authData.user.id, limit: 5, windowSeconds: 24 * 60 * 60 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many correction attempts. Contact help@applypack.work if you need assistance." }, { status: 429 });
  const { data: item } = await admin.from("apply_pack_items").select("id,delivered_at,orders!inner(id,customer_id,status)").eq("id", id).maybeSingle();
  const order = Array.isArray(item?.orders) ? item?.orders[0] : item?.orders;
  if (!item || !order || order.customer_id !== authData.user.id || order.status !== "delivered" || !item.delivered_at) {
    return NextResponse.json({ error: "Delivered Apply Pack not found." }, { status: 404 });
  }
  if (Date.now() - new Date(item.delivered_at).getTime() > 3 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "The included three-day correction window has closed." }, { status: 409 });
  }
  const { error } = await admin.from("correction_requests").insert({
    apply_pack_item_id: id,
    customer_id: authData.user.id,
    correction_text: parsed.data.document + ": " + parsed.data.correction,
  });
  if (error?.code === "23505") return NextResponse.json({ error: "The included correction request has already been used." }, { status: 409 });
  if (error) return NextResponse.json({ error: "The correction could not be submitted." }, { status: 502 });
  const itemUpdate = await admin.from("apply_pack_items").update({ status: "correction_requested" }).eq("id", id);
  const audit = await admin.from("audit_logs").insert({ actor_id: authData.user.id, action: "correction_requested", entity_type: "apply_pack_item", entity_id: id });
  if (itemUpdate.error || audit.error) return NextResponse.json({ error: "The correction was recorded, but operator reconciliation is required." }, { status: 500 });
  await notifyCustomer({
    customerId: authData.user.id,
    orderId: order.id,
    template: "correction_request_received",
    subject: "We received your ApplyPack correction request",
    lines: ["Your included factual-correction request is in the operator queue.", "We will notify you when the corrected files are ready."],
    keySuffix: id,
  });
  return NextResponse.json({ ok: true });
}

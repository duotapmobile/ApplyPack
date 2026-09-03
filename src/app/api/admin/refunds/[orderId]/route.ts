import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createStripeOperationalClient } from "@/lib/stripe/server";

const schema = z.object({
  reasonCode: z.enum(["duplicate_or_incorrect_charge", "unfinished_item_policy", "missed_deadline"]),
  reason: z.string().trim().min(10).max(1000),
});

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This refund request was rejected." }, { status: 403 });
  }
  const orderId = (await context.params).orderId;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const stripe = createStripeOperationalClient();
  if (!stripe) return NextResponse.json({ error: "Stripe is not connected." }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an approved policy reason and add a customer-visible explanation." }, { status: 400 });

  const { data: prepared, error: prepareError } = await auth.admin.rpc("begin_order_refund", {
    p_order_id: orderId,
    p_actor_id: auth.user.id,
    p_reason_code: parsed.data.reasonCode,
    p_customer_visible_reason: parsed.data.reason,
  });
  const state = Array.isArray(prepared) ? prepared[0] : prepared;
  if (prepareError || !state?.refund_id || !state?.provider_payment_id || !state?.amount_cents) {
    return NextResponse.json({ error: "This order is not eligible for the selected refund policy or is already being processed." }, { status: 409 });
  }

  let refund;
  try {
    refund = await stripe.refunds.create({
      payment_intent: String(state.provider_payment_id),
      amount: Number(state.amount_cents),
      reason: "requested_by_customer",
      metadata: { order_id: orderId, refund_id: String(state.refund_id) },
    }, { idempotencyKey: "applypack-refund/" + orderId });
  } catch {
    return NextResponse.json({
      error: "Stripe refund confirmation is unavailable. Delivery is held while the idempotent refund is reconciled.",
    }, { status: 502 });
  }

  const { error: finalizeError } = await auth.admin.rpc("finalize_order_refund", {
    p_refund_id: state.refund_id,
    p_provider_refund_id: refund.id,
    p_provider_status: refund.status,
    p_error_code: refund.failure_reason || null,
  });
  if (finalizeError) {
    return NextResponse.json({ error: "Stripe accepted the refund, but local reconciliation is pending. Escalate immediately." }, { status: 500 });
  }
  const { error: auditError } = await auth.admin.from("audit_logs").insert({
    actor_id: auth.user.id,
    action: "refund_requested",
    entity_type: "order",
    entity_id: orderId,
    details: { refund_id: refund.id, amount_cents: Number(state.amount_cents), status: refund.status, reason_code: parsed.data.reasonCode },
  });
  if (auditError) return NextResponse.json({ error: "Refund was recorded, but its audit event failed. Escalate immediately." }, { status: 500 });
  return NextResponse.json({ ok: true, refundId: refund.id, status: refund.status });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createStripeClient } from "@/lib/stripe/server";

const schema = z.object({ reason: z.string().trim().min(10).max(1000) });

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  const orderId = (await context.params).orderId;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const stripe = createStripeClient();
  if (!stripe) return NextResponse.json({ error: "Stripe is not connected." }, { status: 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a customer-visible refund reason." }, { status: 400 });
  const { data: order } = await auth.admin.from("orders").select("id,status,amount_cents,source_cart_id").eq("id", orderId).maybeSingle();
  if (!order || !["paid", "in_fulfillment"].includes(order.status)) {
    return NextResponse.json({ error: "Only paid, unfinished orders can be refunded here." }, { status: 409 });
  }
  let paymentQuery = auth.admin.from("payments").select("id,provider_payment_id,status");
  paymentQuery = order.source_cart_id ? paymentQuery.eq("apply_pack_cart_id", order.source_cart_id) : paymentQuery.eq("order_id", orderId);
  const { data: payment } = await paymentQuery.maybeSingle();
  if (!payment || !["paid", "partially_refunded"].includes(payment.status)) {
    return NextResponse.json({ error: "A refundable payment was not found." }, { status: 409 });
  }
  const { data: prior } = await auth.admin.from("refunds").select("id,status").eq("order_id", orderId).maybeSingle();
  if (prior) return NextResponse.json({ error: "A refund already exists for this order." }, { status: 409 });
  let refund;
  try {
    refund = await stripe.refunds.create({
      payment_intent: payment.provider_payment_id,
      amount: order.amount_cents,
      reason: "requested_by_customer",
      metadata: { order_id: orderId },
    }, { idempotencyKey: "applypack-refund/" + orderId });
  } catch {
    return NextResponse.json({ error: "Stripe did not accept the refund. No local status changed." }, { status: 502 });
  }
  const completedAt = refund.status === "succeeded" ? new Date().toISOString() : null;
  const { error: refundError } = await auth.admin.from("refunds").insert({
    payment_id: payment.id,
    order_id: orderId,
    provider_refund_id: refund.id,
    amount_cents: order.amount_cents,
    reason_code: "authorized_policy_refund",
    customer_visible_reason: parsed.data.reason,
    status: refund.status || "pending",
    initiated_by: auth.user.id,
    completed_at: completedAt,
  });
  if (refundError) return NextResponse.json({ error: "Stripe refunded the payment, but local recording failed. Escalate immediately." }, { status: 500 });
  await auth.admin.from("orders").update({ status: "refunded" }).eq("id", orderId);
  await auth.admin.from("payments").update({ status: order.source_cart_id ? "partially_refunded" : "refunded" }).eq("id", payment.id);
  await auth.admin.from("audit_logs").insert({ actor_id: auth.user.id, action: "refund_issued", entity_type: "order", entity_id: orderId, details: { refund_id: refund.id, amount_cents: order.amount_cents } });
  return NextResponse.json({ ok: true, refundId: refund.id });
}

import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { sendOrderReceipt } from "@/lib/email/send";
import { createStripeClient } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = createStripeClient();
  const admin = createSupabaseAdminClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!stripe || !admin || !secret || !signature) {
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const { error: eventError } = await admin.from("webhook_events").insert({
    provider: "stripe",
    provider_event_id: event.id,
    event_type: event.type,
  });
  if (eventError?.code === "23505") {
    const { data: prior } = await admin.from("webhook_events").select("processed_at").eq("provider_event_id", event.id).maybeSingle();
    if (prior?.processed_at) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }
  if (eventError && eventError.code !== "23505") return NextResponse.json({ error: "Could not record event." }, { status: 500 });

  try {
    if (event.type === "checkout.session.completed") {
      await completeCheckout(event.data.object, new Date(event.created * 1000));
    } else if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const orderId = session.metadata?.order_id;
      const cartId = session.metadata?.cart_id;
      if (cartId) {
        await admin.from("apply_pack_carts").update({ status: "expired" }).eq("id", cartId).eq("status", "checkout_pending");
      } else if (orderId) {
        await admin.from("orders").update({ status: "payment_expired" }).eq("id", orderId).eq("status", "pending_payment");
      }
      const reservationId = session.metadata?.capacity_reservation_id;
      if (reservationId) await admin.from("capacity_reservations").update({ status: "released" }).eq("id", reservationId).eq("status", "reserved");
    } else if (event.type === "charge.refunded") {
      await recordRefund(event.data.object);
    } else if (event.type === "charge.dispute.created") {
      await admin.from("audit_logs").insert({
        action: "stripe_dispute_created",
        entity_type: "stripe_dispute",
        entity_id: event.data.object.id,
        details: { amount: event.data.object.amount, reason: event.data.object.reason },
      });
    }
    await admin.from("webhook_events").update({ processed_at: new Date().toISOString(), error_message: null }).eq("provider_event_id", event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    await admin.from("webhook_events").update({ error_message: error instanceof Error ? error.message : "Processing failed" }).eq("provider_event_id", event.id);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}

async function completeCheckout(session: Stripe.Checkout.Session, paidAtDate: Date) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Admin client missing");
  const orderId = session.metadata?.order_id;
  const cartId = session.metadata?.cart_id;
  const reservationId = session.metadata?.capacity_reservation_id;
  const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  if ((!orderId && !cartId) || (orderId && cartId) || !reservationId || !paymentId || session.payment_status !== "paid" || session.amount_total === null) {
    throw new Error("Incomplete checkout metadata");
  }

  const paidAt = paidAtDate.toISOString();
  const deadline = new Date(paidAtDate.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const common = {
      p_checkout_id: session.id,
      p_payment_id: paymentId,
      p_amount_cents: session.amount_total,
      p_paid_at: paidAt,
      p_deadline: deadline,
      p_reservation_id: reservationId,
  };
  const { data: converted, error } = cartId
    ? await admin.rpc("complete_apply_pack_cart", { p_cart_id: cartId, ...common })
    : await admin.rpc("complete_paid_checkout", { p_order_id: orderId, ...common });
  if (error) throw error;
  if (!converted || typeof converted !== "object" || !("customer_id" in converted)) throw new Error("Paid conversion returned no customer");

  const referenceId = cartId || orderId!;
  const template = cartId ? "apply_pack_purchase_confirmation" : "search_purchase_confirmation";
  const idempotencyKey = template + "/" + referenceId;
  const { data: existingEmail } = await admin.from("email_events").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingEmail) return;
  const { data: user } = await admin.auth.admin.getUserById(String(converted.customer_id));
  const email = user.user?.email;
  if (email) {
    const reference = cartId ? { apply_pack_cart_id: cartId } : { order_id: orderId };
    try {
      const sent = await sendOrderReceipt({ to: email, orderId: referenceId, amountCents: session.amount_total, deadline });
      await admin.from("email_events").upsert({
        ...reference,
        recipient: email,
        template,
        status: sent.skipped ? "skipped" : "sent",
        provider_message_id: sent.providerMessageId || null,
        idempotency_key: idempotencyKey,
      }, { onConflict: "idempotency_key" });
    } catch {
      await admin.from("email_events").upsert({
        ...reference, recipient: email, template, status: "failed", idempotency_key: idempotencyKey,
      }, { onConflict: "idempotency_key" });
    }
  }
}

async function recordRefund(charge: Stripe.Charge) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Admin client missing");
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) throw new Error("Refund has no payment intent");
  const { data: payment } = await admin.from("payments").select("id,order_id,apply_pack_cart_id").eq("provider_payment_id", paymentIntentId).maybeSingle();
  if (!payment) throw new Error("Refund payment was not found");
  const fullyRefunded = charge.amount_refunded >= charge.amount;
  await admin.from("payments").update({ status: fullyRefunded ? "refunded" : "partially_refunded" }).eq("id", payment.id);
  if (payment.order_id && fullyRefunded) {
    await admin.from("orders").update({ status: "refunded" }).eq("id", payment.order_id);
  } else if (payment.apply_pack_cart_id && fullyRefunded) {
    await admin.from("apply_pack_carts").update({ status: "cancelled" }).eq("id", payment.apply_pack_cart_id);
    await admin.from("orders").update({ status: "refunded" }).eq("source_cart_id", payment.apply_pack_cart_id).neq("status", "delivered");
  }
  await admin.from("audit_logs").insert({
    action: "stripe_refund_recorded",
    entity_type: "payment",
    entity_id: payment.id,
    details: { amount_refunded: charge.amount_refunded, charge_amount: charge.amount, fully_refunded: fullyRefunded },
  });
}

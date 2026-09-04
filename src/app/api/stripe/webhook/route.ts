import { after, NextResponse } from "next/server";
import type Stripe from "stripe";
import { sendOrderReceipt } from "@/lib/email/send";
import { stripeEventMatchesConfiguredMode } from "@/lib/stripe/mode";
import { assertConfiguredPrice, createStripeOperationalClient } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processWorkflowTasks } from "@/lib/workflow/process";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const stripe = createStripeOperationalClient();
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
  if (!stripeEventMatchesConfiguredMode(event.livemode)) {
    return NextResponse.json({ error: "Webhook payment mode does not match this environment." }, { status: 409 });
  }

  const { error: eventError } = await admin.from("webhook_events").insert({
    provider: "stripe",
    provider_event_id: event.id,
    event_type: event.type,
  });
  if (eventError?.code === "23505") {
    const { data: prior, error: priorError } = await admin
      .from("webhook_events")
      .select("processed_at")
      .eq("provider_event_id", event.id)
      .maybeSingle();
    if (priorError) return NextResponse.json({ error: "Could not inspect duplicate event." }, { status: 500 });
    if (prior?.processed_at) return NextResponse.json({ received: true, duplicate: true });
  } else if (eventError) {
    return NextResponse.json({ error: "Could not record event." }, { status: 500 });
  }

  const { data: claimed, error: claimError } = await admin.rpc("claim_stripe_webhook", {
    p_provider_event_id: event.id,
  });
  if (claimError) return NextResponse.json({ error: "Could not claim event." }, { status: 500 });
  if (!claimed) {
    return NextResponse.json({ error: "Event is still processing; Stripe should retry." }, { status: 503 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const verified = await verifyCompletedCheckout(stripe, event.data.object);
      await completeCheckout(verified, new Date(event.created * 1000));
    } else if (event.type === "checkout.session.expired") {
      await expireCheckout(event.data.object);
    } else if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
      await recordRefund(event.data.object as Stripe.Refund);
    } else if (event.type === "charge.dispute.created") {
      const dispute = event.data.object;
      const { error } = await admin.from("audit_logs").insert({
        action: "stripe_dispute_created",
        entity_type: "stripe_dispute",
        entity_id: dispute.id,
        details: { amount: dispute.amount, reason: dispute.reason },
      });
      if (error) throw new Error("Could not record dispute alert");
    }

    const { data: processed, error: processedError } = await admin
      .from("webhook_events")
      .update({
        processed_at: new Date().toISOString(),
        processing_status: "processed",
        error_message: null,
        last_error_code: null,
      })
      .eq("provider_event_id", event.id)
      .eq("processing_status", "processing")
      .select("id")
      .maybeSingle();
    if (processedError || !processed) throw new Error("Could not finalize webhook event");
    after(() => processWorkflowTasks(admin, 2).catch(() => undefined));
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Processing failed";
    await admin.from("webhook_events").update({
      processing_status: "failed",
      last_error_code: "webhook_processing_failed",
      error_message: message,
    }).eq("provider_event_id", event.id);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}

async function verifyCompletedCheckout(stripe: Stripe, eventSession: Stripe.Checkout.Session) {
  const session = await stripe.checkout.sessions.retrieve(eventSession.id, {
    expand: ["line_items.data.price.product"],
  });
  const orderId = session.metadata?.order_id;
  const cartId = session.metadata?.cart_id;
  const productKind = session.metadata?.product_kind;
  const reservationId = session.metadata?.capacity_reservation_id;
  const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (
    (!orderId && !cartId) ||
    (orderId && cartId) ||
    !reservationId ||
    !paymentId ||
    session.payment_status !== "paid" ||
    session.currency?.toLowerCase() !== "usd"
  ) {
    throw new Error("Incomplete checkout metadata");
  }

  const lines = session.line_items?.data || [];
  if (lines.length !== 1 || !lines[0].price || !lines[0].quantity) {
    throw new Error("Unexpected checkout line items");
  }
  const line = lines[0];
  if (productKind === "job_search" && orderId && !cartId) {
    const priceId = process.env.STRIPE_JOB_SEARCH_PRICE_ID;
    if (!priceId || line.price?.id !== priceId || line.quantity !== 1 || session.amount_total !== 2000) {
      throw new Error("Job Match Search price mismatch");
    }
    await assertConfiguredPrice(stripe, priceId, { unitAmount: 2000, productName: "Job Match Search" });
  } else if (productKind === "apply_pack" && cartId && !orderId) {
    const priceId = process.env.STRIPE_APPLY_PACK_PRICE_ID;
    const quantity = line.quantity ?? 0;
    if (!priceId || line.price?.id !== priceId || quantity < 1 || quantity > 10 || session.amount_total !== quantity * 800) {
      throw new Error("Apply Pack price mismatch");
    }
    await assertConfiguredPrice(stripe, priceId, { unitAmount: 800, productName: "Apply Pack" });
  } else {
    throw new Error("Checkout product mismatch");
  }
  return session;
}

async function expireCheckout(session: Stripe.Checkout.Session) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Admin client missing");
  const orderId = session.metadata?.order_id;
  const cartId = session.metadata?.cart_id;
  if (cartId) {
    const { error } = await admin.from("apply_pack_carts").update({ status: "expired" })
      .eq("id", cartId).eq("status", "checkout_pending");
    if (error) throw error;
  } else if (orderId) {
    const { error } = await admin.from("orders").update({ status: "payment_expired" })
      .eq("id", orderId).eq("status", "pending_payment");
    if (error) throw error;
  } else {
    throw new Error("Expired checkout has no internal reference");
  }
  const reservationId = session.metadata?.capacity_reservation_id;
  if (reservationId) {
    const { error } = await admin.from("capacity_reservations").update({ status: "released" })
      .eq("id", reservationId).eq("status", "reserved");
    if (error) throw error;
  }
}

async function completeCheckout(session: Stripe.Checkout.Session, paidAtDate: Date) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Admin client missing");
  const orderId = session.metadata?.order_id;
  const cartId = session.metadata?.cart_id;
  const reservationId = session.metadata?.capacity_reservation_id;
  const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if ((!orderId && !cartId) || (orderId && cartId) || !reservationId || !paymentId || session.amount_total === null) {
    throw new Error("Incomplete verified checkout");
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
  if (!converted || typeof converted !== "object" || !("customer_id" in converted)) {
    throw new Error("Paid conversion returned no customer");
  }

  const referenceId = cartId || orderId!;
  const template = cartId ? "apply_pack_purchase_confirmation" : "search_purchase_confirmation";
  const idempotencyKey = template + "/" + referenceId;
  const { data: existingEmail, error: existingError } = await admin
    .from("email_events")
    .select("id,status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingEmail && ["sent", "skipped"].includes(existingEmail.status)) return;

  const { data: user, error: userError } = await admin.auth.admin.getUserById(String(converted.customer_id));
  if (userError) throw new Error("Paid customer identity was not found");
  let recipient = user.user?.email || null;
  if (!recipient && orderId && "intake_id" in converted && converted.intake_id) {
    const { data: paidIntake, error: intakeError } = await admin
      .from("intakes")
      .select("email")
      .eq("id", String(converted.intake_id))
      .eq("customer_id", String(converted.customer_id))
      .maybeSingle();
    if (intakeError) throw intakeError;
    recipient = paidIntake?.email || null;
  }
  if (!recipient) throw new Error("Paid customer email was not found");
  const reference = cartId ? { apply_pack_cart_id: cartId } : { order_id: orderId };
  try {
    const sent = await sendOrderReceipt({
      to: recipient,
      orderId: referenceId,
      amountCents: session.amount_total,
      deadline,
    });
    const { error: emailError } = await admin.from("email_events").upsert({
      ...reference,
      recipient,
      template,
      status: sent.skipped ? "skipped" : "sent",
      provider_message_id: sent.providerMessageId || null,
      idempotency_key: idempotencyKey,
    }, { onConflict: "idempotency_key" });
    if (emailError) throw emailError;
  } catch (emailError) {
    const { error: recordError } = await admin.from("email_events").upsert({
      ...reference,
      recipient,
      template,
      status: "failed",
      idempotency_key: idempotencyKey,
    }, { onConflict: "idempotency_key" });
    if (recordError) throw recordError;
    if (emailError instanceof Error && emailError.message.includes("email_events")) throw emailError;
  }
}

async function recordRefund(refund: Stripe.Refund) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Admin client missing");
  const localRefundId = refund.metadata?.refund_id;
  const argumentsForProvider = {
    p_provider_refund_id: refund.id,
    p_provider_status: refund.status,
    p_error_code: refund.failure_reason || null,
  };
  const result = localRefundId
    ? await admin.rpc("finalize_order_refund", { p_refund_id: localRefundId, ...argumentsForProvider })
    : await admin.rpc("finalize_order_refund_by_provider", argumentsForProvider);
  if (result.error) throw result.error;
  const { error: auditError } = await admin.from("audit_logs").insert({
    action: "stripe_refund_reconciled",
    entity_type: "stripe_refund",
    entity_id: refund.id,
    details: { status: refund.status },
  });
  if (auditError) throw auditError;
}

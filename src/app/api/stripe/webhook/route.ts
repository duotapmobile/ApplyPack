import { createHash, randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createCapabilitySecret, hashCapabilitySecret, immediateSearchPayment } from "@/lib/commerce/server";
import { sendOrderReceipt } from "@/lib/email/send";
import { immediateMaterialPayment } from "@/lib/materials/server";
import { stripeEventMatchesConfiguredMode } from "@/lib/stripe/mode";
import { assertConfiguredPrice, createStripeOperationalClient } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processWorkflowTasks } from "@/lib/workflow/process";

export const runtime = "nodejs";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export async function POST(request: Request) {
  const stripe = createStripeOperationalClient();
  const admin = createSupabaseAdminClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!stripe || !admin || !secret || !signature) {
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  }

  let event: Stripe.Event;
  let rawBody: string;
  const signatureVerifiedAt = new Date().toISOString();
  try {
    rawBody = await request.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  if (!stripeEventMatchesConfiguredMode(event.livemode)) {
    return NextResponse.json({ error: "Webhook payment mode does not match this environment." }, { status: 409 });
  }
  const payloadSha256 = createHash("sha256").update(rawBody, "utf8").digest("hex");

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
      if (isCorrectedSearchSession(event.data.object)) {
        await completeCorrectedSearch(stripe, admin, event.data.object, {
          eventId: event.id, eventType: event.type, payloadSha256, signatureVerifiedAt,
        });
      } else if (isCorrectedMaterialSession(event.data.object)) {
        await completeCorrectedMaterials(stripe, admin, event.data.object, {
          eventId: event.id, eventType: event.type, payloadSha256, signatureVerifiedAt,
        });
      } else {
        const verified = await verifyCompletedCheckout(stripe, event.data.object);
        await completeCheckout(verified, new Date(event.created * 1000));
      }
    } else if (event.type === "checkout.session.expired") {
      if (isCorrectedSearchSession(event.data.object)) await expireCorrectedSearch(admin, event.data.object);
      else if (isCorrectedMaterialSession(event.data.object)) await expireCorrectedMaterials(admin, event.data.object);
      else await expireCheckout(event.data.object);
    } else if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
      const refund = event.data.object as Stripe.Refund;
      if (refund.metadata?.refund_operation_id) {
        await recordCorrectedRefund(admin, refund, event, payloadSha256, signatureVerifiedAt);
      } else await recordRefund(refund);
    } else if (["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(event.type)) {
      const handled = await recordCorrectedDispute(admin, stripe, event, payloadSha256, signatureVerifiedAt);
      if (!handled && event.type === "charge.dispute.created") {
        const dispute = event.data.object as Stripe.Dispute;
        const { error } = await admin.from("audit_logs").insert({
          action: "stripe_dispute_created",
          entity_type: "stripe_dispute",
          entity_id: dispute.id,
          details: { amount: dispute.amount, reason: dispute.reason },
        });
        if (error) throw new Error("Could not record dispute alert");
      }
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

function isCorrectedSearchSession(session: Stripe.Checkout.Session) {
  return session.metadata?.contract_version === "chunk4-v1"
    && session.metadata?.product_kind === "job_search"
    && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(session.metadata?.checkout_attempt_id || "");
}

function isCorrectedMaterialSession(session: Stripe.Checkout.Session) {
  return session.metadata?.contract_version === "chunk5-v1"
    && session.metadata?.product_kind === "apply_pack"
    && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(session.metadata?.checkout_intent_id || "");
}

async function completeCorrectedMaterials(
  stripe: Stripe,
  admin: AdminClient,
  eventSession: Stripe.Checkout.Session,
  evidence: { eventId: string; eventType: string; payloadSha256: string; signatureVerifiedAt: string },
) {
  const expectedPriceId = process.env.STRIPE_APPLY_PACK_PRICE_ID;
  if (!expectedPriceId) throw new Error("Corrected materials price is not configured");
  const session = await stripe.checkout.sessions.retrieve(eventSession.id, {
    expand: ["line_items.data.price.product", "payment_intent.latest_charge"],
  });
  if (!isCorrectedMaterialSession(session)) throw new Error("Corrected materials metadata is incomplete");
  const checkoutIntentId = session.metadata!.checkout_intent_id!;
  const { data: checkout, error: checkoutError } = await admin.from("ap_material_checkout_intents")
    .select("id,customer_id,line_count,provider_checkout_session_id")
    .eq("id", checkoutIntentId).eq("provider_checkout_session_id", session.id).maybeSingle();
  if (checkoutError || !checkout) throw checkoutError || new Error("Corrected materials checkout binding was not found");
  const paymentIntent = typeof session.payment_intent === "string"
    ? await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ["latest_charge"] })
    : session.payment_intent;
  if (!paymentIntent) throw new Error("Corrected materials checkout has no PaymentIntent");
  const charge = typeof paymentIntent.latest_charge === "string"
    ? await stripe.charges.retrieve(paymentIntent.latest_charge)
    : paymentIntent.latest_charge || null;
  await assertConfiguredPrice(stripe, expectedPriceId, {
    unitAmount: 800,
    productName: "Tailored Resume + Cover Letter",
  });
  const payment = immediateMaterialPayment({
    session,
    paymentIntent,
    charge,
    expectedPriceId,
    expectedLineCount: checkout.line_count,
  });
  if (!payment.valid || !payment.paymentVerifiedAt) {
    throw new Error("Corrected materials payment was not an immediate successful card charge");
  }
  const payerEmail = session.customer_details?.email || charge?.billing_details.email || session.customer_email || null;
  const { error } = await admin.rpc("ap_apply_verified_material_payment", {
    p_provider_event_id: evidence.eventId,
    p_event_type: evidence.eventType,
    p_payload_sha256: evidence.payloadSha256,
    p_signature_verified_at: evidence.signatureVerifiedAt,
    p_checkout_intent_id: checkout.id,
    p_checkout_session_id: session.id,
    p_payment_intent_id: paymentIntent.id,
    p_payment_status: "paid",
    p_payment_method_type: payment.paymentMethodType,
    p_amount_cents: paymentIntent.amount_received,
    p_currency: paymentIntent.currency.toUpperCase(),
    p_payer_receipt_email: payerEmail,
    p_payment_succeeded_at: payment.paymentVerifiedAt,
    p_outbox_id: randomUUID(),
  });
  if (error) throw error;
}

async function expireCorrectedMaterials(admin: AdminClient, session: Stripe.Checkout.Session) {
  const checkoutIntentId = session.metadata?.checkout_intent_id;
  if (!checkoutIntentId) throw new Error("Corrected materials expiration is missing its checkout intent");
  const { error } = await admin.rpc("ap_expire_material_checkout", {
    p_checkout_intent_id: checkoutIntentId,
    p_reason: "PROVIDER_SESSION_EXPIRED",
  });
  if (error) throw error;
}

async function completeCorrectedSearch(
  stripe: Stripe,
  admin: AdminClient,
  eventSession: Stripe.Checkout.Session,
  evidence: { eventId: string; eventType: string; payloadSha256: string; signatureVerifiedAt: string },
) {
  const expectedPriceId = process.env.STRIPE_JOB_SEARCH_PRICE_ID;
  if (!expectedPriceId) throw new Error("Corrected search price is not configured");
  const session = await stripe.checkout.sessions.retrieve(eventSession.id, {
    expand: ["line_items.data.price.product", "payment_intent.latest_charge"],
  });
  if (!isCorrectedSearchSession(session)) throw new Error("Corrected checkout metadata is incomplete");
  const paymentIntent = typeof session.payment_intent === "string"
    ? await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ["latest_charge"] })
    : session.payment_intent;
  if (!paymentIntent) throw new Error("Corrected checkout has no PaymentIntent");
  const charge = typeof paymentIntent.latest_charge === "string"
    ? await stripe.charges.retrieve(paymentIntent.latest_charge)
    : paymentIntent.latest_charge || null;
  await assertConfiguredPrice(stripe, expectedPriceId, { unitAmount: 2_000, productName: "Job Match Search" });
  const payment = immediateSearchPayment({ session, paymentIntent, charge, expectedPriceId });

  const checkoutAttemptId = session.metadata!.checkout_attempt_id!;
  const { data: checkout, error: checkoutError } = await admin.from("ap_checkout_attempts")
    .select("id,draft_id,quote_id,provider_checkout_session_id")
    .eq("id", checkoutAttemptId).eq("provider_checkout_session_id", session.id).maybeSingle();
  if (checkoutError || !checkout) throw checkoutError || new Error("Corrected checkout binding was not found");
  const { data: quote, error: quoteError } = await admin.from("ap_quotes")
    .select("snapshot_id").eq("id", checkout.quote_id).maybeSingle();
  if (quoteError || !quote) throw quoteError || new Error("Corrected quote binding was not found");
  const { data: snapshot, error: snapshotError } = await admin.from("ap_intake_snapshots")
    .select("id,access_email_normalized").eq("id", quote.snapshot_id).eq("draft_id", checkout.draft_id).maybeSingle();
  if (snapshotError || !snapshot?.access_email_normalized) throw snapshotError || new Error("Immutable access email was not found");

  const paymentIntentId = paymentIntent.id;
  const payerEmail = session.customer_details?.email || charge?.billing_details.email || session.customer_email || null;
  if (!payment.valid || !payment.paymentVerifiedAt) {
    const { error } = await admin.rpc("ap_apply_verified_search_payment", {
      p_provider_event_id: evidence.eventId,
      p_event_type: evidence.eventType,
      p_payload_sha256: evidence.payloadSha256,
      p_signature_verified_at: evidence.signatureVerifiedAt,
      p_payment_succeeded_at: null,
      p_checkout_session_id: session.id,
      p_payment_intent_id: paymentIntentId,
      p_payment_status: `unverified_${paymentIntent.status}`,
      p_payment_method_type: payment.paymentMethodType || "unsupported",
      p_amount_cents: paymentIntent.amount_received,
      p_currency: paymentIntent.currency.toUpperCase(),
      p_payer_receipt_email: payerEmail,
      p_customer_id: randomUUID(),
      p_intake_id: randomUUID(),
      p_order_id: randomUUID(),
      p_search_service_id: randomUUID(),
      p_payment_command_id: randomUUID(),
      p_rotated_draft_secret_hash: hashCapabilitySecret(createCapabilitySecret()),
      p_immediate_access_capability_id: randomUUID(),
      p_email_access_capability_id: randomUUID(),
      p_started_outbox_id: randomUUID(),
      p_exception_outbox_id: randomUUID(),
    });
    if (error) throw error;
    return;
  }

  const customerId = await findOrCreatePaidCustomer(admin, snapshot.access_email_normalized);
  const { error } = await admin.rpc("ap_apply_verified_search_payment", {
    p_provider_event_id: evidence.eventId,
    p_event_type: evidence.eventType,
    p_payload_sha256: evidence.payloadSha256,
    p_signature_verified_at: evidence.signatureVerifiedAt,
    p_payment_succeeded_at: payment.paymentVerifiedAt,
    p_checkout_session_id: session.id,
    p_payment_intent_id: paymentIntentId,
    p_payment_status: paymentIntent.status,
    p_payment_method_type: payment.paymentMethodType,
    p_amount_cents: paymentIntent.amount_received,
    p_currency: paymentIntent.currency.toUpperCase(),
    p_payer_receipt_email: payerEmail,
    p_customer_id: customerId,
    p_intake_id: randomUUID(),
    p_order_id: randomUUID(),
    p_search_service_id: randomUUID(),
    p_payment_command_id: randomUUID(),
    p_rotated_draft_secret_hash: hashCapabilitySecret(createCapabilitySecret()),
    p_immediate_access_capability_id: randomUUID(),
    p_email_access_capability_id: randomUUID(),
    p_started_outbox_id: randomUUID(),
    p_exception_outbox_id: randomUUID(),
  });
  if (error) throw error;
}

async function findOrCreatePaidCustomer(admin: AdminClient, accessEmail: string) {
  async function find() {
    const { data, error } = await admin.rpc("ap_find_customer_by_access_email", { p_email: accessEmail });
    if (error) throw error;
    return typeof data === "string" ? data : null;
  }
  const existing = await find();
  if (existing) return existing;
  const created = await admin.auth.admin.createUser({
    email: accessEmail,
    email_confirm: true,
    user_metadata: { account_origin: "verified_search_payment" },
  });
  if (created.data.user?.id) return created.data.user.id;
  const raced = await find();
  if (raced) return raced;
  throw new Error("Paid customer identity could not be created");
}

async function expireCorrectedSearch(admin: AdminClient, session: Stripe.Checkout.Session) {
  const checkoutAttemptId = session.metadata?.checkout_attempt_id;
  if (!checkoutAttemptId) throw new Error("Corrected checkout expiration is missing its attempt");
  const { error } = await admin.rpc("ap_expire_search_checkout", {
    p_checkout_attempt_id: checkoutAttemptId,
    p_reason: "PROVIDER_SESSION_EXPIRED",
  });
  if (error) throw error;
}

async function recordCorrectedRefund(
  admin: AdminClient,
  refund: Stripe.Refund,
  event: Stripe.Event,
  payloadSha256: string,
  signatureVerifiedAt: string,
) {
  const refundId = refund.metadata?.refund_operation_id;
  if (!refundId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(refundId)) throw new Error("Corrected refund binding is invalid");
  const { error } = await admin.rpc("ap_record_search_refund_result", {
    p_refund_id: refundId,
    p_provider_refund_id: refund.id,
    p_provider_status: refund.status || "pending",
    p_provider_event_id: event.id,
    p_error_code: refund.failure_reason || null,
    p_payload_sha256: payloadSha256,
    p_signature_verified_at: signatureVerifiedAt,
    p_event_type: event.type,
  });
  if (error) throw error;
}

async function recordCorrectedDispute(
  admin: AdminClient,
  stripe: Stripe,
  event: Stripe.Event,
  payloadSha256: string,
  signatureVerifiedAt: string,
) {
  const dispute = event.data.object as Stripe.Dispute;
  const charge = typeof dispute.charge === "string" ? await stripe.charges.retrieve(dispute.charge) : dispute.charge;
  const paymentIntent = charge?.payment_intent;
  const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
  if (!paymentIntentId) return false;
  const { data: payment, error: paymentError } = await admin.from("ap_payment_attempts")
    .select("id").eq("provider_payment_id", paymentIntentId).eq("settlement", "PAID").maybeSingle();
  if (paymentError) throw paymentError;
  if (!payment) return false;
  const state = event.type === "charge.dispute.created" ? "OPEN"
    : dispute.status === "won" ? "WON" : dispute.status === "lost" ? "LOST" : null;
  if (!state) return true;
  const { error } = await admin.rpc("ap_apply_search_dispute", {
    p_provider_event_id: event.id,
    p_payload_sha256: payloadSha256,
    p_signature_verified_at: signatureVerifiedAt,
    p_payment_intent_id: paymentIntentId,
    p_dispute_state: state,
    p_outbox_id: randomUUID(),
  });
  if (error) throw error;
  return true;
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

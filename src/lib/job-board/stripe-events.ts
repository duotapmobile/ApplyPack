import "server-only";
import type Stripe from "stripe";
import { boardPlanPriceId, boardPlans, isBoardPlanId } from "./plans";
import { assertConfiguredRecurringPrice } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { boardSubscriptionStateFromProvider } from "./entitlements";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export async function processBoardStripeEvent(stripe: Stripe, admin: AdminClient, event: Stripe.Event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return session.metadata?.contract_version === "paid-board-v1" && session.metadata?.product_kind === "job_board_subscription";
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const reference = invoice.parent?.subscription_details?.subscription;
    const subscriptionId = typeof reference === "string" ? reference : reference?.id;
    if (!subscriptionId) return false;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (subscription.metadata.contract_version !== "paid-board-v1") return false;
    await persistSubscription(stripe, admin, subscription, event, event.type === "invoice.paid" ? "ACTIVE" : "PAST_DUE");
    return true;
  }
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const eventSubscription = event.data.object as Stripe.Subscription;
    const subscription = event.type === "customer.subscription.deleted"
      ? eventSubscription
      : await stripe.subscriptions.retrieve(eventSubscription.id, { expand: ["latest_invoice"] });
    if (subscription.metadata.contract_version !== "paid-board-v1") return false;
    const invoice = typeof subscription.latest_invoice === "string" ? null : subscription.latest_invoice;
    const invoicePaid = Boolean(invoice && !("deleted" in invoice && invoice.deleted) && invoice.status === "paid");
    const state = boardSubscriptionStateFromProvider({
      eventType: event.type,
      subscriptionStatus: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      latestInvoicePaid: invoicePaid,
    });
    await persistSubscription(stripe, admin, subscription, event, state);
    return true;
  }
  if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
    return processBoardRefund(stripe, admin, event);
  }
  if (["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"].includes(event.type)) {
    return processBoardDispute(stripe, admin, event);
  }
  return false;
}

async function boardSubscriptionForInvoice(stripe: Stripe, invoiceReference: string | Stripe.Invoice | null | undefined) {
  if (!invoiceReference) return null;
  const invoice = typeof invoiceReference === "string" ? await stripe.invoices.retrieve(invoiceReference) : invoiceReference;
  const reference = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof reference === "string" ? reference : reference?.id;
  if (!subscriptionId) return null;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return subscription.metadata.contract_version === "paid-board-v1" ? { subscription, invoice } : null;
}

async function boardSubscriptionForRefund(stripe: Stripe, refund: Stripe.Refund) {
  let paymentIntentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (!paymentIntentId && refund.charge) {
    const charge = typeof refund.charge === "string" ? await stripe.charges.retrieve(refund.charge) : refund.charge;
    paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  }
  return paymentIntentId ? boardSubscriptionForPaymentIntent(stripe, paymentIntentId) : null;
}

async function boardSubscriptionForDispute(stripe: Stripe, dispute: Stripe.Dispute) {
  const charge = typeof dispute.charge === "string" ? await stripe.charges.retrieve(dispute.charge) : dispute.charge;
  const paymentIntentId = typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id;
  return paymentIntentId ? boardSubscriptionForPaymentIntent(stripe, paymentIntentId) : null;
}

async function boardSubscriptionForPaymentIntent(stripe: Stripe, paymentIntentId: string) {
  const payments = await stripe.invoicePayments.list({
    payment: { type: "payment_intent", payment_intent: paymentIntentId }, limit: 1, expand: ["data.invoice"],
  });
  const invoice = payments.data[0]?.invoice;
  if (!invoice) return null;
  if (typeof invoice === "string") return boardSubscriptionForInvoice(stripe, invoice);
  if ("deleted" in invoice && invoice.deleted) return null;
  return boardSubscriptionForInvoice(stripe, invoice);
}

async function recordBoardProviderEvent(admin: AdminClient, input: {
  event: Stripe.Event; subscriptionId: string; refundId?: string; disputeId?: string;
  amountCents?: number; fullAmountCents?: number; resultingState: string;
}) {
  const result = await admin.from("ap_board_provider_events").upsert({
    provider_event_id: input.event.id, provider_subscription_id: input.subscriptionId,
    event_type: input.event.type, provider_created: input.event.created,
    provider_refund_id: input.refundId || null, provider_dispute_id: input.disputeId || null,
    amount_cents: input.amountCents ?? null, full_amount_cents: input.fullAmountCents ?? null,
    resulting_state: input.resultingState,
  }, { onConflict: "provider_event_id", ignoreDuplicates: true });
  if (result.error) throw result.error;
}

async function processBoardRefund(stripe: Stripe, admin: AdminClient, event: Stripe.Event) {
  const refund = event.data.object as Stripe.Refund;
  const binding = await boardSubscriptionForRefund(stripe, refund);
  if (!binding) return false;
  const { data: current, error } = await admin.from("ap_board_subscriptions")
    .select("id,state,refund_state,last_provider_event_created").eq("provider_subscription_id", binding.subscription.id).maybeSingle();
  if (error || !current) throw error || new Error("board_refund_subscription_missing");
  if (Number(current.last_provider_event_created) > event.created) {
    await recordBoardProviderEvent(admin, { event, subscriptionId: binding.subscription.id, refundId: refund.id,
      amountCents: refund.amount, fullAmountCents: binding.invoice.amount_paid, resultingState: current.state });
    return true;
  }
  const latestInvoiceId = typeof binding.subscription.latest_invoice === "string"
    ? binding.subscription.latest_invoice : binding.subscription.latest_invoice?.id;
  const affectsCurrentPeriod = !latestInvoiceId || latestInvoiceId === binding.invoice.id;
  const failed = event.type === "refund.failed" || refund.status === "failed" || refund.status === "canceled";
  const full = affectsCurrentPeriod && !failed && refund.amount >= binding.invoice.amount_paid;
  const nextState = full ? "REFUNDED" : current.state;
  const update = await admin.from("ap_board_subscriptions").update({
    state: nextState, access_ends_at: full ? null : undefined,
    refund_state: affectsCurrentPeriod ? (failed ? "FAILED" : full ? "FULL" : "PARTIAL") : current.refund_state, provider_refund_id: refund.id,
    last_provider_event_created: event.created, last_provider_event_id: event.id, updated_at: new Date().toISOString(),
  }).eq("id", current.id).lte("last_provider_event_created", event.created);
  if (update.error) throw update.error;
  await recordBoardProviderEvent(admin, { event, subscriptionId: binding.subscription.id, refundId: refund.id,
    amountCents: refund.amount, fullAmountCents: binding.invoice.amount_paid, resultingState: nextState });
  return true;
}

async function processBoardDispute(stripe: Stripe, admin: AdminClient, event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute;
  const binding = await boardSubscriptionForDispute(stripe, dispute);
  if (!binding) return false;
  const { data: current, error } = await admin.from("ap_board_subscriptions")
    .select("id,state,last_provider_event_created").eq("provider_subscription_id", binding.subscription.id).maybeSingle();
  if (error || !current) throw error || new Error("board_dispute_subscription_missing");
  if (Number(current.last_provider_event_created) > event.created) {
    await recordBoardProviderEvent(admin, { event, subscriptionId: binding.subscription.id, disputeId: dispute.id,
      amountCents: dispute.amount, fullAmountCents: binding.invoice.amount_paid, resultingState: current.state });
    return true;
  }
  const won = event.type === "charge.dispute.closed" && dispute.status === "won";
  const item = binding.subscription.items.data[0];
  const paidPeriodActive = binding.invoice.status === "paid" && Boolean(item) && item.current_period_end * 1_000 > Date.now();
  const recoveredState = binding.subscription.cancel_at_period_end ? "CANCEL_AT_PERIOD_END" : "ACTIVE";
  const nextState = won && paidPeriodActive ? recoveredState : "DISPUTED";
  const accessEndsAt = nextState === "ACTIVE" || nextState === "CANCEL_AT_PERIOD_END"
    ? new Date(item.current_period_end * 1_000).toISOString() : null;
  const update = await admin.from("ap_board_subscriptions").update({
    state: nextState, access_ends_at: accessEndsAt, provider_dispute_id: dispute.id,
    last_provider_event_created: event.created, last_provider_event_id: event.id, updated_at: new Date().toISOString(),
  }).eq("id", current.id).lte("last_provider_event_created", event.created);
  if (update.error) throw update.error;
  await recordBoardProviderEvent(admin, { event, subscriptionId: binding.subscription.id, disputeId: dispute.id,
    amountCents: dispute.amount, fullAmountCents: binding.invoice.amount_paid, resultingState: nextState });
  return true;
}

async function persistSubscription(
  stripe: Stripe,
  admin: AdminClient,
  subscription: Stripe.Subscription,
  event: Pick<Stripe.Event, "id" | "created">,
  requestedState: "PENDING" | "ACTIVE" | "CANCEL_AT_PERIOD_END" | "PAST_DUE" | "CANCELED",
) {
  const customerId = subscription.metadata.customer_id;
  const planId = subscription.metadata.plan_id;
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(customerId || "") || !isBoardPlanId(planId)) throw new Error("invalid_board_subscription_binding");
  const item = subscription.items.data[0];
  const priceId = item?.price.id;
  const expectedPriceId = boardPlanPriceId(planId);
  if (!item || !priceId || !expectedPriceId || priceId !== expectedPriceId || subscription.items.data.length !== 1 || item.quantity !== 1) throw new Error("invalid_board_subscription_price");
  const plan = boardPlans[planId];
  await assertConfiguredRecurringPrice(stripe, priceId, { unitAmount: plan.amountCents, interval: plan.interval, intervalCount: plan.intervalCount });
  const providerCustomerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const periodEnd = new Date(item.current_period_end * 1_000).toISOString();
  const periodStart = new Date(item.current_period_start * 1_000).toISOString();
  const { data: current, error: currentError } = await admin.from("ap_board_subscriptions")
    .select("id,last_provider_event_created,state,access_ends_at").eq("provider_subscription_id", subscription.id).maybeSingle();
  if (currentError) throw currentError;
  if (current && Number(current.last_provider_event_created) > event.created) return;
  if (current && Number(current.last_provider_event_created) === event.created && requestedState === "PENDING"
    && current.state !== "PENDING") return;
  if (current && Number(current.last_provider_event_created) === event.created && requestedState === "ACTIVE"
    && !["PENDING", "ACTIVE", "CANCEL_AT_PERIOD_END"].includes(current.state)) return;
  const state = requestedState === "CANCEL_AT_PERIOD_END" && (!current || !["ACTIVE", "CANCEL_AT_PERIOD_END"].includes(current.state))
    ? "PAST_DUE"
    : requestedState === "ACTIVE" && subscription.status !== "active" ? "PAST_DUE" : requestedState;
  const accessEndsAt = state === "ACTIVE" || state === "CANCEL_AT_PERIOD_END" ? periodEnd : null;
  const record = {
    customer_id: customerId,
    plan_id: planId,
    state,
    provider_customer_id: providerCustomerId,
    provider_subscription_id: subscription.id,
    current_period_starts_at: periodStart,
    access_ends_at: accessEndsAt,
    cancel_at_period_end: subscription.cancel_at_period_end,
    last_provider_event_created: event.created,
    last_provider_event_id: event.id,
    updated_at: new Date().toISOString(),
  };
  const result = current
    ? await admin.from("ap_board_subscriptions").update(record).eq("id", current.id).lte("last_provider_event_created", event.created)
    : await admin.from("ap_board_subscriptions").insert(record);
  if (result.error) throw result.error;
}

export async function reconcileBoardSubscriptions(stripe: Stripe, admin: AdminClient, limit = 50) {
  const { data, error } = await admin.from("ap_board_subscriptions").select("provider_subscription_id")
    .in("state", ["PENDING", "ACTIVE", "CANCEL_AT_PERIOD_END", "PAST_DUE"]).order("updated_at").limit(limit);
  if (error) throw error;
  let reconciled = 0;
  for (const row of data || []) {
    const subscription = await stripe.subscriptions.retrieve(row.provider_subscription_id, { expand: ["latest_invoice"] });
    if (subscription.metadata.contract_version !== "paid-board-v1") continue;
    const invoice = typeof subscription.latest_invoice === "string" ? null : subscription.latest_invoice;
    const invoicePaid = invoice?.status === "paid";
    const state = subscription.status === "canceled" ? "CANCELED"
      : subscription.cancel_at_period_end && invoicePaid ? "CANCEL_AT_PERIOD_END"
        : subscription.status === "active" && invoicePaid ? "ACTIVE" : "PAST_DUE";
    await persistSubscription(stripe, admin, subscription, { id: `reconciliation:${subscription.id}:${subscription.items.data[0]?.current_period_end || 0}`, created: Math.floor(Date.now() / 1_000) }, state);
    reconciled += 1;
  }
  return reconciled;
}

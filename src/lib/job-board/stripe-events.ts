import "server-only";
import type Stripe from "stripe";
import { boardPlanPriceId, boardPlans, isBoardPlanId } from "./plans";
import { assertConfiguredRecurringPrice } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    if (subscription.metadata.contract_version !== "paid-board-v1") return false;
    if (event.type === "customer.subscription.updated" && !subscription.cancel_at_period_end) return true;
    const state = event.type === "customer.subscription.deleted" ? "CANCELED" : "CANCEL_AT_PERIOD_END";
    await persistSubscription(stripe, admin, subscription, event, state);
    return true;
  }
  return false;
}

async function persistSubscription(
  stripe: Stripe,
  admin: AdminClient,
  subscription: Stripe.Subscription,
  event: Pick<Stripe.Event, "id" | "created">,
  requestedState: "ACTIVE" | "CANCEL_AT_PERIOD_END" | "PAST_DUE" | "CANCELED",
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
  if (current && Number(current.last_provider_event_created) === event.created && requestedState === "ACTIVE"
    && !["PENDING", "ACTIVE"].includes(current.state)) return;
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

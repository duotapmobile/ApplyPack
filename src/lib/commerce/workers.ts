import "server-only";

import type Stripe from "stripe";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertConfiguredPrice, createStripeOperationalClient, createStripeSearchClient } from "@/lib/stripe/server";
import { canonicalApplicationOrigin } from "./server";
import { processChunk4Outbox } from "./outbox";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type ScheduledJob = {
  id: string;
  job_kind: string;
  reference_id: string;
  attempts: number;
  created_at: string;
};

export function scheduledRetryAt(attempts: number, now = new Date()) {
  const seconds = Math.min(6 * 60 * 60, 60 * (2 ** Math.max(0, attempts - 1)));
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function scheduledDeadLetter(job: ScheduledJob, now = new Date()) {
  return job.attempts >= 12 || now.getTime() >= new Date(job.created_at).getTime() + 24 * 60 * 60_000;
}

async function completeExternal(admin: AdminClient, job: ScheduledJob, owner: string) {
  const result = await admin.rpc("ap_complete_external_scheduled_job", { p_job_id: job.id, p_owner: owner });
  if (result.error) throw result.error;
}

async function retryExternal(admin: AdminClient, job: ScheduledJob, owner: string, errorCode: string, retryAt?: string) {
  const result = await admin.rpc("ap_retry_scheduled_job", {
    p_job_id: job.id,
    p_owner: owner,
    p_error_code: errorCode.slice(0, 100),
    p_retry_at: retryAt || scheduledRetryAt(job.attempts),
    p_dead_letter: scheduledDeadLetter(job),
  });
  if (result.error) throw result.error;
}

async function renewExternal(admin: AdminClient, job: ScheduledJob, owner: string) {
  const result = await admin.rpc("ap_renew_scheduled_job_lease", { p_job_id: job.id, p_owner: owner });
  if (result.error) throw result.error;
}

async function handleRefund(admin: AdminClient, job: ScheduledJob, owner: string) {
  await renewExternal(admin, job, owner);
  const stripe = createStripeOperationalClient();
  if (!stripe) throw new Error("refund_provider_not_configured");
  const { data: refund, error: refundError } = await admin.from("ap_refund_operations")
    .select("id,payment_attempt_id,amount_cents,currency,state,provider_refund_id,provider_command_id")
    .eq("id", job.reference_id).maybeSingle();
  if (refundError || !refund) throw refundError || new Error("refund_operation_missing");
  if (["SUCCEEDED", "FAILED"].includes(refund.state)) return completeExternal(admin, job, owner);
  const [{ data: payment, error: paymentError }, { data: command, error: commandError }] = await Promise.all([
    admin.from("ap_payment_attempts").select("provider_payment_id").eq("id", refund.payment_attempt_id).maybeSingle(),
    admin.from("ap_external_commands").select("provider_idempotency_key").eq("id", refund.provider_command_id).maybeSingle(),
  ]);
  if (paymentError || commandError || !payment?.provider_payment_id || !command?.provider_idempotency_key) {
    throw paymentError || commandError || new Error("refund_provider_binding_missing");
  }
  let providerRefund: Stripe.Refund;
  await renewExternal(admin, job, owner);
  if (refund.provider_refund_id) {
    providerRefund = await stripe.refunds.retrieve(refund.provider_refund_id);
  } else {
    providerRefund = await stripe.refunds.create({
      payment_intent: payment.provider_payment_id,
      amount: refund.amount_cents,
      metadata: { refund_operation_id: refund.id, contract_version: "chunk4-v1" },
    }, { idempotencyKey: command.provider_idempotency_key });
  }
  const recorded = await admin.rpc("ap_record_search_refund_result", {
    p_refund_id: refund.id,
    p_provider_refund_id: providerRefund.id,
    p_provider_status: providerRefund.status || "pending",
    p_provider_event_id: null,
    p_error_code: providerRefund.failure_reason || null,
    p_payload_sha256: null,
    p_signature_verified_at: null,
    p_event_type: null,
  });
  if (recorded.error) throw recorded.error;
  if (providerRefund.status === "pending") {
    if (job.job_kind === "REFUND_RECONCILE") return;
    return completeExternal(admin, job, owner);
  }
  return completeExternal(admin, job, owner);
}

async function handleProvisionalCheckout(admin: AdminClient, job: ScheduledJob, owner: string) {
  await renewExternal(admin, job, owner);
  const stripe = createStripeSearchClient();
  const priceId = process.env.STRIPE_JOB_SEARCH_PRICE_ID;
  if (!stripe || !priceId) throw new Error("checkout_provider_not_configured");
  const { data: checkout, error: checkoutError } = await admin.from("ap_checkout_attempts")
    .select("id,draft_id,quote_id,command_id,state,expires_at,provider_checkout_session_id")
    .eq("id", job.reference_id).maybeSingle();
  if (checkoutError || !checkout) throw checkoutError || new Error("provisional_checkout_missing");
  if (checkout.state !== "NONE") return completeExternal(admin, job, owner);
  const [{ data: quote, error: quoteError }, { data: command, error: commandError }] = await Promise.all([
    admin.from("ap_quotes").select("snapshot_id,expires_at,invalidated_at").eq("id", checkout.quote_id).maybeSingle(),
    admin.from("ap_external_commands").select("provider_idempotency_key,provider_object_id,state").eq("id", checkout.command_id).maybeSingle(),
  ]);
  if (quoteError || commandError || !quote || !command) throw quoteError || commandError || new Error("provisional_checkout_binding_missing");
  if (quote.invalidated_at || new Date(quote.expires_at).getTime() <= Date.now()) {
    const expired = await admin.rpc("ap_expire_search_checkout", { p_checkout_attempt_id: checkout.id, p_reason: "PROVISIONAL_RECONCILIATION_EXPIRED" });
    if (expired.error) throw expired.error;
    return completeExternal(admin, job, owner);
  }
  const reopened = await admin.rpc("ap_reopen_provisional_search_checkout", { p_checkout_attempt_id: checkout.id });
  if (reopened.error || !reopened.data) throw reopened.error || new Error("provisional_checkout_not_reopenable");
  const { data: snapshot, error: snapshotError } = await admin.from("ap_intake_snapshots")
    .select("access_email_normalized").eq("id", quote.snapshot_id).maybeSingle();
  if (snapshotError || !snapshot?.access_email_normalized) throw snapshotError || new Error("provisional_checkout_email_missing");
  const origin = canonicalApplicationOrigin();
  await assertConfiguredPrice(stripe, priceId, { unitAmount: 2_000, productName: "Job Match Search" });
  await renewExternal(admin, job, owner);
  let session: Stripe.Checkout.Session;
  if (command.provider_object_id) session = await stripe.checkout.sessions.retrieve(command.provider_object_id);
  else session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: snapshot.access_email_normalized,
    expires_at: Math.floor(new Date(quote.expires_at).getTime() / 1_000),
    success_url: `${origin}/checkout/return`,
    cancel_url: `${origin}/checkout/return?cancelled=1`,
    line_items: [{ quantity: 1, price: priceId }],
    metadata: { checkout_attempt_id: checkout.id, quote_id: checkout.quote_id, product_kind: "job_search", contract_version: "chunk4-v1" },
  }, { idempotencyKey: command.provider_idempotency_key });
  if (session.status === "expired") {
    const expired = await admin.rpc("ap_expire_search_checkout", { p_checkout_attempt_id: checkout.id, p_reason: "PROVIDER_SESSION_EXPIRED" });
    if (expired.error) throw expired.error;
    return completeExternal(admin, job, owner);
  }
  const promoted = await admin.rpc("ap_promote_search_checkout", {
    p_checkout_attempt_id: checkout.id,
    p_provider_session_id: session.id,
    p_provider_session_expires_at: new Date(session.expires_at * 1_000).toISOString(),
  });
  if (promoted.error || !promoted.data) throw promoted.error || new Error("provisional_checkout_promotion_failed");
  return completeExternal(admin, job, owner);
}

async function handleInvalidatedCheckout(admin: AdminClient, job: ScheduledJob, owner: string) {
  await renewExternal(admin, job, owner);
  const stripe = createStripeSearchClient();
  if (!stripe) throw new Error("checkout_provider_not_configured");
  const { data: checkout, error } = await admin.from("ap_checkout_attempts")
    .select("id,state,quote_id,provider_checkout_session_id")
    .eq("id", job.reference_id).maybeSingle();
  if (error || !checkout) throw error || new Error("checkout_expiry_binding_missing");
  const { data: quote, error: quoteError } = await admin.from("ap_quotes")
    .select("invalidated_at").eq("id", checkout.quote_id).maybeSingle();
  if (quoteError || !quote) throw quoteError || new Error("checkout_expiry_quote_missing");
  if (checkout.state !== "OPEN" || !quote.invalidated_at) return completeExternal(admin, job, owner);
  if (!checkout.provider_checkout_session_id) throw new Error("checkout_provider_session_missing");
  await renewExternal(admin, job, owner);
  const session = await stripe.checkout.sessions.retrieve(checkout.provider_checkout_session_id);
  if (session.status === "open") {
    await renewExternal(admin, job, owner);
    await stripe.checkout.sessions.expire(session.id);
  }
  if (session.status !== "complete") {
    const expired = await admin.rpc("ap_expire_search_checkout", {
      p_checkout_attempt_id: checkout.id,
      p_reason: "SNAPSHOT_SUPERSEDED",
    });
    if (expired.error) throw expired.error;
  }
  return completeExternal(admin, job, owner);
}

async function handleOutboxSchedule(admin: AdminClient, job: ScheduledJob, owner: string) {
  const { data: message, error } = await admin.from("ap_outbox_messages")
    .select("state,next_attempt_at").eq("id", job.reference_id).maybeSingle();
  if (error || !message) throw error || new Error("outbox_schedule_message_missing");
  if (["SENT", "DEAD_LETTER"].includes(message.state)) return completeExternal(admin, job, owner);
  return retryExternal(admin, job, owner, "OUTBOX_NOT_TERMINAL", message.next_attempt_at || scheduledRetryAt(job.attempts));
}

async function handleJob(admin: AdminClient, job: ScheduledJob, owner: string) {
  if (["CHECKOUT_EXPIRY", "PROPOSAL_EXPIRY", "SEARCH_DEADLINE"].includes(job.job_kind)) {
    const result = await admin.rpc("ap_apply_local_scheduled_job", { p_job_id: job.id, p_owner: owner });
    if (result.error) throw result.error;
    return;
  }
  if (job.job_kind === "CHECKOUT_PROVISIONAL_CLEANUP") return handleProvisionalCheckout(admin, job, owner);
  if (job.job_kind === "CHECKOUT_PROVIDER_EXPIRE") return handleInvalidatedCheckout(admin, job, owner);
  if (["REFUND_SUBMIT", "REFUND_RECONCILE"].includes(job.job_kind)) return handleRefund(admin, job, owner);
  if (job.job_kind === "OUTBOX_SEND") return handleOutboxSchedule(admin, job, owner);
  throw new Error("unsupported_chunk4_scheduled_job");
}

export async function processChunk4Workers(admin: AdminClient, limit = 20) {
  const owner = process.env.APP_CHUNK4_WORKER_ID?.trim();
  if (!owner || owner.length < 3) return { status: "disabled" as const, reason: "APP_CHUNK4_WORKER_ID_UNSET", processed: 0 };
  const enqueued = await admin.rpc("ap_enqueue_chunk4_due_jobs");
  if (enqueued.error) throw enqueued.error;
  const outbox = await processChunk4Outbox(admin, owner, Math.min(10, limit));
  const claimed = await admin.rpc("ap_claim_scheduled_jobs", { p_owner: owner, p_limit: Math.max(1, Math.min(50, limit)) });
  if (claimed.error) throw claimed.error;
  const jobs = (Array.isArray(claimed.data) ? claimed.data : []) as ScheduledJob[];
  let completed = 0;
  for (const job of jobs) {
    try {
      await handleJob(admin, job, owner);
      completed += 1;
    } catch (error) {
      await retryExternal(admin, job, owner, error instanceof Error ? error.message : "chunk4_worker_failed");
    }
  }
  const monitor = await admin.rpc("ap_chunk4_monitor_snapshot");
  if (monitor.error) throw monitor.error;
  return { status: "enabled" as const, processed: jobs.length, completed, outbox, enqueued: enqueued.data, monitor: monitor.data };
}

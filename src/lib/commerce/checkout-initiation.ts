import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkoutConfiguration } from "@/lib/stripe/mode";
import { createStripeOperationalClient } from "@/lib/stripe/server";

type Admin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type Initiation = {
  id: string; mode: string; release_sha: string; authorization_id: string | null;
  provider_session_id: string | null; provider_idempotency_key: string;
  provider_session_deadline: string; initiated_at: string; state: string;
  payment_attempt_id: string;
};

function currentModeMatches(attempt: Initiation) {
  const configuration = checkoutConfiguration();
  return configuration.sessionCreationAllowed
    && (configuration.acceptingOrders ? "PUBLIC" : configuration.restrictedMode) === attempt.mode
    && attempt.release_sha === (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_RELEASE_SHA);
}

async function initiation(admin: Admin, id: string): Promise<Initiation> {
  const result = await admin.from("ap_checkout_initiations").select("*").eq("id", id).single();
  if (result.error || !result.data) throw new Error("checkout_initiation_missing");
  return result.data as Initiation;
}

async function authorizationActive(admin: Admin, attempt: Initiation) {
  if (!currentModeMatches(attempt) || ["EXPIRATION_REQUIRED", "EXPIRED", "PAID"].includes(attempt.state)) return false;
  const mode = await admin.from("ap_checkout_mode_configuration").select("mode,release_sha").eq("singleton", true).maybeSingle();
  if (mode.error || mode.data?.mode !== attempt.mode || mode.data?.release_sha !== attempt.release_sha) return false;
  if (attempt.mode === "PUBLIC") return true;
  if (!attempt.authorization_id) return false;
  const table = attempt.mode === "REHEARSAL" ? "ap_staging_rehearsal_authorizations" : "ap_manual_launch_canary_authorizations";
  const result = await admin.from(table).select("expires_at,revoked_at").eq("id", attempt.authorization_id).maybeSingle();
  return !result.error && result.data && !result.data.revoked_at && Date.parse(result.data.expires_at) > Date.now();
}

export async function bindCheckoutSession(admin: Admin, attemptId: string, session: Stripe.Checkout.Session) {
  if (session.metadata?.initiation_id !== attemptId) throw new Error("checkout_initiation_provider_mismatch");
  const result = await admin.rpc("ap_bind_checkout_initiation", {
    p_attempt_id: attemptId, p_provider_session_id: session.id,
    p_provider_session_expires_at: new Date(session.expires_at * 1_000).toISOString(),
  });
  if (result.error || !result.data) throw new Error("checkout_initiation_binding_failed");
  const value = result.data as { expirationRequired?: boolean };
  return value.expirationRequired === true;
}

export async function observeCheckoutSession(admin: Admin, attemptId: string, session: Stripe.Checkout.Session) {
  const result = await admin.rpc("ap_reconcile_checkout_initiation", {
    p_attempt_id: attemptId, p_provider_session_id: session.id,
    p_provider_status: session.status || "unknown", p_payment_status: session.payment_status,
  });
  if (result.error) throw new Error("checkout_initiation_reconciliation_failed");
}

async function expireOrObserve(admin: Admin, stripe: Stripe, attempt: Initiation, session: Stripe.Checkout.Session) {
  if (session.status === "open") {
    try { session = await stripe.checkout.sessions.expire(session.id); }
    catch { session = await stripe.checkout.sessions.retrieve(session.id); }
  }
  await observeCheckoutSession(admin, attempt.id, session);
  return session;
}

/** Recover an ambiguous provider result without issuing any create request. */
async function findProviderSession(stripe: Stripe, attempt: Initiation) {
  if (attempt.provider_session_id) return { session: await stripe.checkout.sessions.retrieve(attempt.provider_session_id), absenceReceipt: null };
  let startingAfter: string | undefined;
  const created = { gte: Math.floor(Date.parse(attempt.initiated_at) / 1_000) - 5,
    lte: Math.floor(Date.parse(attempt.provider_session_deadline) / 1_000) };
  const requests: { requestId: string; count: number; hasMore: boolean }[] = [];
  let found: Stripe.Checkout.Session | null = null;
  // Bounded provider inspection; absence in a bounded page is never proof of absence.
  for (let page = 0; page < 3; page++) {
    const sessions = await stripe.checkout.sessions.list({ limit: 100,
      created,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    if (!Array.isArray(sessions.data) || typeof sessions.has_more !== "boolean") throw new Error("checkout_provider_listing_invalid");
    requests.push({ requestId: sessions.lastResponse?.requestId || "", count: sessions.data.length, hasMore: sessions.has_more });
    const matched = sessions.data.filter((session) => session.metadata?.initiation_id === attempt.id);
    if (matched.length > 1 || (found && matched.some((session) => session.id !== found!.id))) throw new Error("checkout_initiation_multiple_provider_sessions");
    if (matched[0]) found = matched[0];
    if (!sessions.has_more) {
      const observedAt = new Date().toISOString();
      const evidence = { attemptId: attempt.id, created, observedAt, requests };
      return { session: found, absenceReceipt: !found && requests.every((entry) => entry.requestId)
        ? { observedAt, evidence, evidenceSha256: createHash("sha256").update(JSON.stringify(evidence)).digest("hex") }
        : null };
    }
    if (!sessions.data.length) throw new Error("checkout_provider_listing_incomplete");
    startingAfter = sessions.data[sessions.data.length - 1].id;
  }
  return { session: found, absenceReceipt: null };
}

export async function createOrResumeCheckoutSession(admin: Admin, stripe: Stripe, attemptId: string,
  parameters: Stripe.Checkout.SessionCreateParams) {
  const attempt = await initiation(admin, attemptId);
  const active = await authorizationActive(admin, attempt);
  let session: Stripe.Checkout.Session | null = attempt.provider_session_id ? await stripe.checkout.sessions.retrieve(attempt.provider_session_id) : null;
  const deadline = Math.floor(Date.parse(attempt.provider_session_deadline) / 1_000);
  if (!session && (!active || deadline < Math.ceil(Date.now() / 1_000) + 30 * 60)) {
    session = (await findProviderSession(stripe, attempt)).session;
    if (!session) throw new Error("checkout_provider_outcome_requires_reconciliation");
  }
  if (!session) {
    // This timestamp is persisted before the network call and never recalculated
    // on a retry: Stripe rejects changed parameters for the same idempotency key.
    session = await stripe.checkout.sessions.create({ ...parameters, expires_at: deadline,
      metadata: { ...parameters.metadata, initiation_id: attempt.id },
    }, { idempotencyKey: attempt.provider_idempotency_key });
  }
  const expirationRequired = await bindCheckoutSession(admin, attempt.id, session);
  if (expirationRequired || !active || !await authorizationActive(admin, await initiation(admin, attempt.id))) {
    await expireOrObserve(admin, stripe, attempt, session);
    throw new Error("checkout_authorization_closed");
  }
  await observeCheckoutSession(admin, attempt.id, session);
  if (session.status !== "open" || session.payment_status === "paid" || !session.url) {
    throw new Error("checkout_provider_session_not_open");
  }
  return session;
}

export async function reconcileCheckoutInitiations(admin: Admin, limit = 20, authorizationId?: string) {
  const stripe = createStripeOperationalClient();
  if (!stripe) throw new Error("checkout_reconciliation_provider_unavailable");
  const marked = await admin.rpc("ap_mark_checkout_initiations_for_expiration");
  if (marked.error) throw new Error("checkout_expiration_marking_failed");
  const result = await admin.rpc("ap_checkout_initiations_requiring_reconciliation", {
    p_limit: Math.min(20, Math.max(1, limit)),
    ...(authorizationId ? { p_authorization_id: authorizationId } : {}),
  });
  if (result.error) throw new Error("checkout_reconciliation_unavailable");
  let unresolved = 0;
  let processed = 0;
  for (const row of result.data || []) {
    const attempt = row as Initiation;
    try {
      const { session, absenceReceipt } = await findProviderSession(stripe, attempt);
      if (!session) {
        if (absenceReceipt && Date.parse(attempt.provider_session_deadline) + 5 * 60_000 <= Date.now()) {
          const recorded = await admin.from("audit_logs").insert({
            action: "checkout_provider_absence_observed", entity_type: "checkout_initiation", entity_id: attempt.id,
            details: { ...absenceReceipt.evidence, evidenceSha256: absenceReceipt.evidenceSha256 },
          });
          if (recorded.error) throw new Error("checkout_provider_absence_evidence_unavailable");
          const absent = await admin.rpc("ap_reconcile_checkout_initiation_absence", {
            p_attempt_id: attempt.id, p_observed_at: absenceReceipt.observedAt,
            p_evidence_sha256: absenceReceipt.evidenceSha256,
          });
          if (absent.error || !absent.data) unresolved++; else processed++;
        } else unresolved++;
        continue;
      }
      const expirationRequired = await bindCheckoutSession(admin, attempt.id, session);
      let observedSession = session;
      if (expirationRequired || !await authorizationActive(admin, attempt)) observedSession = await expireOrObserve(admin, stripe, attempt, session);
      else await observeCheckoutSession(admin, attempt.id, session);
      if (observedSession.payment_status === "paid" || attempt.state === "PAID") {
        // Provider observation does not authorize fulfillment. Keep a missing
        // signed webhook actionable on every sweep until its payment settles.
        const payment = await admin.from("ap_payment_attempts").select("settlement,payment_verified_at")
          .eq("id", attempt.payment_attempt_id).maybeSingle();
        if (payment.error || payment.data?.settlement !== "PAID" || !payment.data.payment_verified_at) {
          unresolved++;
          continue;
        }
      }
      processed++;
    } catch { unresolved++; }
  }
  return { processed, unresolved };
}

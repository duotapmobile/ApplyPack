import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifiedIntakeIdentity } from "@/lib/intake/verified-intake-server";
import { materialCheckoutStatusSchema } from "@/lib/commerce/material-checkout-status";

const headers = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const unavailable = (status = 404) => NextResponse.json({ error: "Apply Pack checkout status is unavailable." }, { status, headers });
const sessionId = z.string().regex(/^cs_(?:test_|live_)?[A-Za-z0-9]+$/);
const intentSchema = z.object({ id: z.uuid(), customer_id: z.uuid(), delivered_order_id: z.uuid(), purchase_id: z.uuid(),
  payment_attempt_id: z.uuid(), provider_checkout_session_id: sessionId.nullable(),
  state: z.enum(["PREFLIGHT", "BLOCKED", "READY", "OPEN", "EXPIRED", "COMPLETED", "FAILED"]),
  amount_cents: z.number().int().positive(), currency: z.literal("USD"), line_count: z.number().int().min(1).max(10),
  completed_at: z.iso.datetime({ offset: true }).nullable() }).strict();

// The URL is only a locator. A browser return never settles, expires or cancels
// payment, and this handler does not read or mutate the search checkout cookie.
export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const id = z.uuid().safeParse((await route.params).id);
    if (!id.success) return unavailable();
    const identity = await verifiedIntakeIdentity();
    if (!identity) return unavailable(401);
    const admin = createSupabaseAdminClient();
    if (!admin) return unavailable(503);
    const signal = AbortSignal.timeout(10_000);
    const found = await admin.from("ap_material_checkout_intents")
      .select("id,customer_id,delivered_order_id,purchase_id,payment_attempt_id,provider_checkout_session_id,state,amount_cents,currency,line_count,completed_at")
      .eq("id", id.data).eq("customer_id", identity.customerId).abortSignal(signal).maybeSingle();
    const parsed = intentSchema.safeParse(found.data);
    if (found.error || !parsed.success || parsed.data.id !== id.data || parsed.data.customer_id !== identity.customerId) return unavailable();
    const intent = parsed.data;
    if (["OPEN", "COMPLETED"].includes(intent.state) && !intent.provider_checkout_session_id) return unavailable();
    const [order, payment, purchase] = await Promise.all([
      admin.from("orders").select("id,customer_id").eq("id", intent.delivered_order_id).eq("customer_id", identity.customerId).abortSignal(signal).maybeSingle(),
      admin.from("ap_payment_attempts").select("id,customer_id,provider,provider_payment_id,provider_checkout_session_id,settlement,payment_verified_at,immediate_charge_verified,amount_cents,currency")
        .eq("id", intent.payment_attempt_id).eq("customer_id", identity.customerId).abortSignal(signal).maybeSingle(),
      admin.from("ap_material_purchases").select("id,customer_id,checkout_intent_id,payment_attempt_id,amount_cents,currency")
        .eq("id", intent.purchase_id).eq("customer_id", identity.customerId).abortSignal(signal).maybeSingle(),
    ]);
    if (order.error || order.data?.id !== intent.delivered_order_id || order.data.customer_id !== identity.customerId
      || payment.error || payment.data?.id !== intent.payment_attempt_id || payment.data.customer_id !== identity.customerId
      || payment.data.provider !== "stripe"
      || payment.data.amount_cents !== intent.amount_cents || payment.data.currency !== intent.currency
      || payment.data.provider_checkout_session_id !== intent.provider_checkout_session_id
      || purchase.error || purchase.data?.id !== intent.purchase_id || purchase.data.customer_id !== identity.customerId
      || purchase.data.checkout_intent_id !== intent.id || purchase.data.payment_attempt_id !== intent.payment_attempt_id
      || purchase.data.amount_cents !== intent.amount_cents || purchase.data.currency !== intent.currency) return unavailable();
    let state: "CONFIRMING_PAYMENT" | "PAYMENT_VERIFIED" | "EXPIRED" | "FAILED" = "CONFIRMING_PAYMENT";
    if (payment.data.settlement === "PAID") {
      if (intent.state !== "COMPLETED" || !intent.completed_at || !intent.provider_checkout_session_id
        || !/^pi_[A-Za-z0-9]+$/.test(payment.data.provider_payment_id || "")
        || payment.data.immediate_charge_verified !== true || !z.iso.datetime({ offset: true }).safeParse(payment.data.payment_verified_at).success) return unavailable(503);
      state = "PAYMENT_VERIFIED";
    } else {
      if (!["UNPAID", "PROCESSING", "FAILED"].includes(payment.data.settlement) || intent.state === "COMPLETED"
        || intent.completed_at || payment.data.payment_verified_at || payment.data.immediate_charge_verified) return unavailable(503);
      if (intent.state === "EXPIRED") state = "EXPIRED";
      else if (intent.state === "FAILED" || intent.state === "BLOCKED" || payment.data.settlement === "FAILED") state = "FAILED";
    }
    return NextResponse.json(materialCheckoutStatusSchema.parse({ checkoutIntentId: intent.id, state, orderId: intent.delivered_order_id,
      lineCount: intent.line_count, amountCents: intent.amount_cents, currency: intent.currency }), { headers });
  } catch { return unavailable(503); }
}

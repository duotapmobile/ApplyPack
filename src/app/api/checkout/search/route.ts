import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { assertConfiguredPrice, createStripeClient } from "@/lib/stripe/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ intakeId: z.uuid() });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This checkout request was rejected." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid intake is required." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const stripe = createStripeClient();
  if (!supabase || !admin || !stripe) {
    return NextResponse.json({ error: "Live checkout is not connected yet." }, { status: 503 });
  }
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Sign in again before payment." }, { status: 401 });
  const rate = await consumeRateLimit({ request, scope: "search_checkout", identity: authData.user.id, limit: 5, windowSeconds: 60 * 60 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many checkout attempts. Try again later." }, { status: 429 });
  }

  const { data: intake } = await supabase
    .from("intakes")
    .select("id,status,source_scan_status")
    .eq("id", parsed.data.intakeId)
    .eq("customer_id", authData.user.id)
    .maybeSingle();
  if (!intake || intake.status !== "ready_for_payment") {
    return NextResponse.json({ error: "This intake is not ready for payment." }, { status: 409 });
  }
  if (intake.source_scan_status !== "clean") {
    return NextResponse.json({ error: "Your documents must pass the configured document safety checks before payment can begin." }, { status: 409 });
  }
  const priceId = process.env.STRIPE_JOB_SEARCH_PRICE_ID;
  if (!priceId) return NextResponse.json({ error: "Test checkout pricing is not configured." }, { status: 503 });
  try {
    await assertConfiguredPrice(stripe, priceId, { unitAmount: 2000, productName: "Job Match Search" });
  } catch {
    return NextResponse.json({ error: "Checkout pricing failed verification. No charge was made." }, { status: 503 });
  }

  const { data: prepared, error: prepareError } = await admin.rpc("prepare_search_checkout", {
    p_customer_id: authData.user.id,
    p_intake_id: parsed.data.intakeId,
  });
  const checkout = Array.isArray(prepared) ? prepared[0] : prepared;
  if (prepareError || !checkout?.order_id || !checkout?.reservation_id) {
    return NextResponse.json({ error: "The search is already purchased or the next 24-hour slot is unavailable. No charge was made." }, { status: 409 });
  }
  const orderId = String(checkout.order_id);
  const reservation = String(checkout.reservation_id);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: authData.user.email,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    success_url: appUrl + "/checkout/return?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: appUrl + "/checkout/return?cancelled=1",
    line_items: [{ quantity: 1, price: priceId }],
    metadata: {
      order_id: orderId,
      capacity_reservation_id: String(reservation),
      product_kind: "job_search",
    },
    }, { idempotencyKey: `search-checkout/${orderId}` });
  } catch {
    return NextResponse.json({ error: "Checkout could not be opened. Retry safely; the same reserved checkout will be reused and no charge was made." }, { status: 502 });
  }
  const { error: orderError } = await admin.from("orders").update({
    stripe_checkout_session_id: session.id,
    checkout_expires_at: new Date(session.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", orderId).eq("status", "pending_payment");
  if (orderError || !session.url) {
    return NextResponse.json({ error: "Checkout was reserved but could not be linked. Retry safely; no duplicate checkout will be created." }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}

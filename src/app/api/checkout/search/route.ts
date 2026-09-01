import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { SEARCH_PRICE_CENTS } from "@/lib/domain/applypack";
import { createStripeClient } from "@/lib/stripe/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ intakeId: z.uuid() });

export async function POST(request: Request) {
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
    .select("id,status")
    .eq("id", parsed.data.intakeId)
    .eq("customer_id", authData.user.id)
    .maybeSingle();
  if (!intake || intake.status !== "ready_for_payment") {
    return NextResponse.json({ error: "This intake is not ready for payment." }, { status: 409 });
  }

  const requestKey = "search:" + parsed.data.intakeId + ":" + randomUUID();
  const { data: reservation, error: reserveError } = await admin.rpc("reserve_capacity", {
    p_customer_id: authData.user.id,
    p_kind: "job_search",
    p_units: 1,
    p_request_key: requestKey,
  });
  if (reserveError || !reservation) {
    return NextResponse.json({ error: "The next 24-hour search slot is unavailable. No charge was made." }, { status: 409 });
  }

  const orderId = randomUUID();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: authData.user.email,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    success_url: appUrl + "/my-applypack?checkout=success",
    cancel_url: appUrl + "/get-started?checkout=cancelled",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: SEARCH_PRICE_CENTS,
        product_data: { name: "ApplyPack Job Match Search", description: "10 matched jobs delivered within 24 hours" },
      },
    }],
    metadata: {
      order_id: orderId,
      intake_id: parsed.data.intakeId,
      customer_id: authData.user.id,
      capacity_reservation_id: String(reservation),
      product_kind: "job_search",
    },
    }, { idempotencyKey: requestKey });
  } catch {
    await admin.from("capacity_reservations").update({ status: "released" }).eq("id", reservation).eq("status", "reserved");
    return NextResponse.json({ error: "Checkout could not be opened. No charge was made." }, { status: 502 });
  }

  const { error: orderError } = await admin.from("orders").insert({
    id: orderId,
    customer_id: authData.user.id,
    intake_id: parsed.data.intakeId,
    product_kind: "job_search",
    amount_cents: SEARCH_PRICE_CENTS,
    status: "pending_payment",
    stripe_checkout_session_id: session.id,
    capacity_reservation_id: reservation,
  });
  if (orderError || !session.url) {
    await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    await admin.from("capacity_reservations").update({ status: "released" }).eq("id", reservation).eq("status", "reserved");
    return NextResponse.json({ error: "Checkout could not be prepared. No charge was made." }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}

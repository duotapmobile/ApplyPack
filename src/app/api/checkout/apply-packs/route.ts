import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { assertConfiguredPrice, createStripeClient } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  items: z.array(z.object({
    jobMatchId: z.uuid(),
    emphasisNotes: z.string().trim().max(500).default(""),
    doNotMentionNotes: z.string().trim().max(500).default(""),
  })).min(1).max(10),
  customerUpdateNotes: z.string().trim().max(2000).default(""),
  selectionConfirmed: z.literal(true),
  submissionBoundaryAcknowledged: z.literal(true),
  outcomesAcknowledged: z.literal(true),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This checkout request was rejected." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Review the selected jobs and confirm all three acknowledgments." }, { status: 400 });
  const ids = [...new Set(parsed.data.items.map((item) => item.jobMatchId))].sort();
  if (ids.length !== parsed.data.items.length) return NextResponse.json({ error: "Duplicate jobs are not allowed." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const stripe = createStripeClient();
  if (!supabase || !admin || !stripe) return NextResponse.json({ error: "Live checkout is not connected yet." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Sign in again before payment." }, { status: 401 });
  const rate = await consumeRateLimit({ request, scope: "apply_pack_checkout", identity: authData.user.id, limit: 5, windowSeconds: 60 * 60 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many checkout attempts. Try again later." }, { status: 429 });
  }
  const { data: matches } = await admin.from("job_matches").select("id,search_order_id,job:jobs(checked_at,listing_status,is_active,review_status,rejection_reason,employer_display_name,source_name,source_job_url,official_application_url)").in("id", ids);
  if (!matches || matches.length !== ids.length || new Set(matches.map((item) => item.search_order_id)).size !== 1) {
    return NextResponse.json({ error: "The selected jobs are not valid for one search." }, { status: 400 });
  }
  const freshnessMs = Number(process.env.APP_JOB_FRESHNESS_HOURS || 24) * 60 * 60 * 1000;
  const staleOrClosed = matches.some((match) => {
    const job = Array.isArray(match.job) ? match.job[0] : match.job;
    const prohibited = job && /live\s*ops/i.test([job.employer_display_name, job.source_name, job.source_job_url, job.official_application_url].filter(Boolean).join(" "));
    return !job || prohibited || !job.is_active || job.review_status === "rejected" || Boolean(job.rejection_reason) || job.listing_status !== "open" || Date.now() - new Date(job.checked_at).getTime() > freshnessMs;
  });
  if (staleOrClosed) {
    return NextResponse.json({ error: "A selected listing is closed or needs a fresh availability check. No charge was made." }, { status: 409 });
  }
  const searchOrderId = matches[0].search_order_id;
  const { data: searchOrder } = await admin.from("orders").select("id,customer_id,status").eq("id", searchOrderId).maybeSingle();
  if (!searchOrder || searchOrder.customer_id !== authData.user.id || searchOrder.status !== "delivered") {
    return NextResponse.json({ error: "These jobs are not ready for Tailored Resume + Cover Letter sets." }, { status: 403 });
  }
  const { data: existingItems } = await admin.from("apply_pack_items").select("job_match_id,orders!inner(status)").in("job_match_id", ids);
  if (existingItems?.some((item) => {
    const related = Array.isArray(item.orders) ? item.orders[0] : item.orders;
    return related && !["cancelled", "refunded", "payment_expired"].includes(related.status);
  })) {
    return NextResponse.json({ error: "A Tailored Resume + Cover Letter order already exists for one selected job." }, { status: 409 });
  }
  const { data: activeCartItems } = await admin.from("apply_pack_cart_items")
    .select("job_match_id,cart:apply_pack_carts!inner(status,expires_at)")
    .in("job_match_id", ids).eq("cart.status", "checkout_pending");
  if (activeCartItems?.some((item) => {
    const cart = Array.isArray(item.cart) ? item.cart[0] : item.cart;
    return cart?.expires_at && new Date(cart.expires_at).getTime() > Date.now();
  })) {
    return NextResponse.json({ error: "A checkout is already open for one selected job. Finish or let it expire before trying again." }, { status: 409 });
  }
  const priceId = process.env.STRIPE_APPLY_PACK_PRICE_ID;
  if (!priceId) return NextResponse.json({ error: "Test checkout pricing is not configured." }, { status: 503 });
  try {
    await assertConfiguredPrice(stripe, priceId, { unitAmount: 800, productName: "Apply Pack" });
  } catch {
    return NextResponse.json({ error: "Checkout pricing failed verification. No charge was made." }, { status: 503 });
  }
  const { data: prepared, error: prepareError } = await admin.rpc("prepare_apply_pack_checkout", {
    p_customer_id: authData.user.id,
    p_search_order_id: searchOrderId,
    p_job_match_ids: ids,
    p_customer_update_notes: parsed.data.customerUpdateNotes,
    p_item_notes: parsed.data.items,
  });
  const checkout = Array.isArray(prepared) ? prepared[0] : prepared;
  if (prepareError || !checkout?.cart_id || !checkout?.reservation_id) {
    return NextResponse.json({ error: "The selected jobs are already purchased, reserved by another checkout, or capacity is unavailable. No charge was made." }, { status: 409 });
  }
  const cartId = String(checkout.cart_id);
  const reservation = String(checkout.reservation_id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
    mode: "payment",
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    payment_method_types: ["card"],
    customer_email: authData.user.email,
    success_url: appUrl + "/checkout/return?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: appUrl + "/checkout/return?cancelled=1",
    line_items: [{ quantity: ids.length, price: priceId }],
    metadata: {
      cart_id: cartId,
      capacity_reservation_id: String(reservation),
      product_kind: "apply_pack",
    },
    }, { idempotencyKey: `apply-pack-checkout/${cartId}` });
  } catch {
    return NextResponse.json({ error: "Checkout could not be opened. Retry safely; the same reserved cart will be reused and no charge was made." }, { status: 502 });
  }
  const { error: cartError } = await admin.from("apply_pack_carts").update({
    stripe_checkout_session_id: session.id,
    expires_at: new Date(session.expires_at * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", cartId).eq("status", "checkout_pending");
  if (cartError || !session.url) {
    return NextResponse.json({ error: "Checkout was reserved but could not be linked. Retry safely; no duplicate checkout will be created." }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}

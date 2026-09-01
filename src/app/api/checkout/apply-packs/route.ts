import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { APPLY_PACK_PRICE_CENTS } from "@/lib/domain/applypack";
import { createStripeClient } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  items: z.array(z.object({
    jobMatchId: z.uuid(),
    emphasisNotes: z.string().trim().max(500).default(""),
    doNotMentionNotes: z.string().trim().max(500).default(""),
  })).min(1).max(2),
  customerUpdateNotes: z.string().trim().max(2000).default(""),
  selectionConfirmed: z.literal(true),
  submissionBoundaryAcknowledged: z.literal(true),
  outcomesAcknowledged: z.literal(true),
});

export async function POST(request: Request) {
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
  const { data: matches } = await admin.from("job_matches").select("id,search_order_id,job:jobs(checked_at,listing_status)").in("id", ids);
  if (!matches || matches.length !== ids.length || new Set(matches.map((item) => item.search_order_id)).size !== 1) {
    return NextResponse.json({ error: "The selected jobs are not valid for one search." }, { status: 400 });
  }
  const freshnessMs = Number(process.env.APP_JOB_FRESHNESS_HOURS || 24) * 60 * 60 * 1000;
  const staleOrClosed = matches.some((match) => {
    const job = Array.isArray(match.job) ? match.job[0] : match.job;
    return !job || job.listing_status !== "open" || Date.now() - new Date(job.checked_at).getTime() > freshnessMs;
  });
  if (staleOrClosed) {
    return NextResponse.json({ error: "A selected listing is closed or needs a fresh availability check. No charge was made." }, { status: 409 });
  }
  const searchOrderId = matches[0].search_order_id;
  const { data: searchOrder } = await admin.from("orders").select("id,customer_id,status").eq("id", searchOrderId).maybeSingle();
  if (!searchOrder || searchOrder.customer_id !== authData.user.id || searchOrder.status !== "delivered") {
    return NextResponse.json({ error: "These jobs are not ready for Apply Packs." }, { status: 403 });
  }
  const { data: existingItems } = await admin.from("apply_pack_items").select("job_match_id,orders!inner(status)").in("job_match_id", ids);
  if (existingItems?.some((item) => {
    const related = Array.isArray(item.orders) ? item.orders[0] : item.orders;
    return related && !["cancelled", "refunded", "payment_expired"].includes(related.status);
  })) {
    return NextResponse.json({ error: "An Apply Pack already exists for one selected job." }, { status: 409 });
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
  const digest = createHash("sha256").update(authData.user.id + ":" + ids.join(",")).digest("hex").slice(0, 24);
  const requestKey = "apply-pack:" + digest + ":" + randomUUID();
  const { data: reservation, error: reserveError } = await admin.rpc("reserve_capacity", {
    p_customer_id: authData.user.id, p_kind: "apply_pack", p_units: ids.length, p_request_key: requestKey,
  });
  if (reserveError || !reservation) return NextResponse.json({ error: "The next 24-hour Apply Pack slots are unavailable. No charge was made." }, { status: 409 });
  const cartId = randomUUID();
  const amount = APPLY_PACK_PRICE_CENTS * ids.length;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
    mode: "payment",
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    payment_method_types: ["card"],
    customer_email: authData.user.email,
    success_url: appUrl + "/my-applypack?checkout=success",
    cancel_url: appUrl + "/my-applypack?checkout=cancelled",
    line_items: [{
      quantity: ids.length,
      price_data: {
        currency: "usd",
        unit_amount: APPLY_PACK_PRICE_CENTS,
        product_data: { name: "ApplyPack Application Pack", description: "One tailored resume and cover letter for one selected job" },
      },
    }],
    metadata: {
      cart_id: cartId,
      customer_id: authData.user.id,
      search_order_id: searchOrderId,
      capacity_reservation_id: String(reservation),
      product_kind: "apply_pack",
      job_match_ids: ids.join(","),
    },
    }, { idempotencyKey: requestKey });
  } catch {
    await admin.from("capacity_reservations").update({ status: "released" }).eq("id", reservation).eq("status", "reserved");
    return NextResponse.json({ error: "Checkout could not be opened. No charge was made." }, { status: 502 });
  }
  const { error: cartError } = await admin.from("apply_pack_carts").insert({
    id: cartId,
    customer_id: authData.user.id,
    search_order_id: searchOrderId,
    status: "checkout_pending",
    item_count: ids.length,
    total_cents: amount,
    stripe_checkout_session_id: session.id,
    capacity_reservation_id: reservation,
    customer_update_notes: parsed.data.customerUpdateNotes || null,
    selection_confirmed: parsed.data.selectionConfirmed,
    submission_boundary_acknowledged: parsed.data.submissionBoundaryAcknowledged,
    outcomes_acknowledged: parsed.data.outcomesAcknowledged,
    expires_at: new Date(session.expires_at * 1000).toISOString(),
  });
  if (!cartError) {
    const notes = new Map(parsed.data.items.map((item) => [item.jobMatchId, item]));
    const { error: itemsError } = await admin.from("apply_pack_cart_items").insert(ids.map((jobMatchId) => ({
      cart_id: cartId,
      job_match_id: jobMatchId,
      emphasis_notes: notes.get(jobMatchId)?.emphasisNotes || null,
      do_not_mention_notes: notes.get(jobMatchId)?.doNotMentionNotes || null,
    })));
    if (itemsError) {
      await admin.from("apply_pack_carts").delete().eq("id", cartId);
      await stripe.checkout.sessions.expire(session.id);
      await admin.from("capacity_reservations").update({ status: "released" }).eq("id", reservation).eq("status", "reserved");
      return NextResponse.json({ error: "Checkout could not be prepared. No charge was made." }, { status: 502 });
    }
  }
  if (cartError || !session.url) {
    await stripe.checkout.sessions.expire(session.id);
    await admin.from("capacity_reservations").update({ status: "released" }).eq("id", reservation).eq("status", "reserved");
    return NextResponse.json({ error: "Checkout could not be prepared. No charge was made." }, { status: 502 });
  }
  return NextResponse.json({ url: session.url });
}

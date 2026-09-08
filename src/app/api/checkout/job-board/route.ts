import { NextResponse } from "next/server";
import { canonicalApplicationOrigin } from "@/lib/commerce/server";
import { boardPlanPriceId, boardPlans, isBoardPlanId } from "@/lib/job-board/plans";
import { assertConfiguredRecurringPrice, createStripeOperationalClient } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const stripe = createStripeOperationalClient();
  if (!supabase || !admin || !stripe || process.env.APP_JOB_BOARD_CHECKOUT_ENABLED !== "true") {
    return NextResponse.json({ error: "Subscription checkout is not configured." }, { status: 503 });
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return NextResponse.json({ error: "Sign in before choosing a plan." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const planId = typeof body === "object" && body !== null && "planId" in body ? (body as { planId?: unknown }).planId : null;
  if (!isBoardPlanId(planId)) return NextResponse.json({ error: "Unknown subscription plan." }, { status: 400 });

  const { data: existing, error: existingError } = await admin.from("ap_board_subscriptions")
    .select("id,state,access_ends_at").eq("customer_id", data.user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existingError) return NextResponse.json({ error: "Subscription status is unavailable." }, { status: 503 });
  if (existing && ["PENDING", "ACTIVE", "CANCEL_AT_PERIOD_END", "PAST_DUE"].includes(existing.state)) {
    return NextResponse.json({ error: "Manage the existing subscription before changing plans." }, { status: 409 });
  }

  const priceId = boardPlanPriceId(planId);
  if (!priceId) return NextResponse.json({ error: "That plan is not configured." }, { status: 503 });
  const plan = boardPlans[planId];
  try {
    await assertConfiguredRecurringPrice(stripe, priceId, { unitAmount: plan.amountCents, interval: plan.interval, intervalCount: plan.intervalCount });
    const origin = canonicalApplicationOrigin();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: data.user.email,
      client_reference_id: data.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/my-applypack/job-board?checkout=returned`,
      cancel_url: `${origin}/job-board?checkout=cancelled`,
      metadata: { contract_version: "paid-board-v1", product_kind: "job_board_subscription", customer_id: data.user.id, plan_id: planId },
      subscription_data: { metadata: { contract_version: "paid-board-v1", customer_id: data.user.id, plan_id: planId } },
    }, { idempotencyKey: `board-subscription/${data.user.id}/${planId}/${existing?.id || "first"}` });
    if (!session.url) throw new Error("missing_checkout_url");
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "Subscription checkout could not be safely created. No access was granted." }, { status: 503 });
  }
}

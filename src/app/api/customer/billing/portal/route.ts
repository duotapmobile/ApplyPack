import { NextResponse } from "next/server";
import { canonicalApplicationOrigin } from "@/lib/commerce/server";
import { createStripeOperationalClient } from "@/lib/stripe/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const stripe = createStripeOperationalClient();
  if (!supabase || !stripe) return NextResponse.json({ error: "Billing management is unavailable." }, { status: 503 });
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: subscription } = await supabase.from("ap_board_subscriptions")
    .select("provider_customer_id").eq("customer_id", data.user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!subscription?.provider_customer_id) return NextResponse.json({ error: "No billing account was found." }, { status: 404 });
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.provider_customer_id,
      return_url: `${canonicalApplicationOrigin()}/my-applypack/job-board`,
    });
    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "Billing management could not be opened." }, { status: 503 });
  }
}

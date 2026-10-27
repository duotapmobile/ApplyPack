import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { checkoutCookieSettings, hashCapabilitySecret, parseCheckoutCapability } from "@/lib/commerce/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { intakePaymentIdentity } from "@/lib/commerce/intake-payment-identity";
import { verifiedIntakeIdentity } from "@/lib/intake/verified-intake-server";

export const dynamic = "force-dynamic";

async function context() {
  try {
    const admin = createSupabaseAdminClient();
    const settings = checkoutCookieSettings();
    const store = await cookies();
    const capability = parseCheckoutCapability(store.get(settings.name)?.value);
    if (!admin || !capability) return null;
    const checkout = await admin.from("ap_checkout_attempts").select("id,draft_id,quote_id")
      .eq("id", capability.checkoutAttemptId).eq("browser_capability_secret_hash", hashCapabilitySecret(capability.secret)).maybeSingle();
    if (checkout.error || !checkout.data || checkout.data.id !== capability.checkoutAttemptId || !checkout.data.draft_id || !checkout.data.quote_id) return null;
    const quote = await admin.from("ap_quotes").select("id,draft_id,snapshot_id").eq("id", checkout.data.quote_id).maybeSingle();
    if (quote.error || !quote.data || quote.data.id !== checkout.data.quote_id || quote.data.draft_id !== checkout.data.draft_id) return null;
    const snapshot = await admin.from("ap_intake_snapshots").select("id,draft_id,finalized_at").eq("id", quote.data.snapshot_id).maybeSingle();
    if (snapshot.error || !snapshot.data || snapshot.data.id !== quote.data.snapshot_id
      || snapshot.data.draft_id !== checkout.data.draft_id || !snapshot.data.finalized_at) return null;
    const result = await admin.rpc("ap_intake_payment_identity", { p_draft_id: checkout.data.draft_id, p_snapshot_id: snapshot.data.id });
    if (result.error) return null;
    const owner = intakePaymentIdentity(result.data);
    if (owner.claimed) {
      const identity = await verifiedIntakeIdentity();
      if (!identity || identity.customerId.toLowerCase() !== owner.customerId.toLowerCase()) return null;
    }
    return { admin, capability, settings };
  } catch { return null; }
}

export async function GET() {
  const current = await context();
  if (!current) {
    return NextResponse.json({ error: "Checkout status is unavailable." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const { data, error } = await current.admin.rpc("ap_read_checkout_status", {
    p_checkout_attempt_id: current.capability.checkoutAttemptId,
    p_browser_secret_hash: hashCapabilitySecret(current.capability.secret),
  });
  if (error || !data || typeof data !== "object") {
    return NextResponse.json({ error: "Checkout status is unavailable." }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const value = data as Record<string, unknown>;
  return NextResponse.json({
    state: value.state,
    searchActive: value.searchActive === true,
    orderId: typeof value.orderId === "string" ? value.orderId : null,
    deliveryDueAt: typeof value.deliveryDueAt === "string" ? value.deliveryDueAt : null,
    refundState: typeof value.refundState === "string" ? value.refundState : null,
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This checkout request was rejected." }, { status: 403 });
  const current = await context();
  if (!current) return NextResponse.json({ error: "Checkout status is unavailable." }, { status: 404, headers: { "cache-control": "no-store" } });
  const { data, error } = await current.admin.rpc("ap_cancel_search_checkout", {
    p_checkout_attempt_id: current.capability.checkoutAttemptId,
    p_browser_secret_hash: hashCapabilitySecret(current.capability.secret),
  });
  const canceled = !error && data === true;
  const response = !canceled
    ? NextResponse.json({ error: "Checkout cancellation could not be confirmed." }, { status: 409 })
    : NextResponse.json({ ok: true, state: "CANCELED" });
  if (canceled) response.cookies.set(current.settings.name, "", { ...current.settings, maxAge: 0 });
  response.headers.set("cache-control", "no-store");
  return response;
}

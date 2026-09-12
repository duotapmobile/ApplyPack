import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { checkoutCookieSettings, hashCapabilitySecret, parseCheckoutCapability } from "@/lib/commerce/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function context() {
  const admin = createSupabaseAdminClient();
  const settings = checkoutCookieSettings();
  const store = await cookies();
  const capability = parseCheckoutCapability(store.get(settings.name)?.value);
  return admin && capability ? { admin, capability, settings } : null;
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
  if (!current) return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  const { error } = await current.admin.rpc("ap_cancel_search_checkout", {
    p_checkout_attempt_id: current.capability.checkoutAttemptId,
    p_browser_secret_hash: hashCapabilitySecret(current.capability.secret),
  });
  const response = error
    ? NextResponse.json({ error: "Checkout cancellation could not be confirmed." }, { status: 409 })
    : NextResponse.json({ ok: true, state: "CANCELED" });
  if (!error) response.cookies.set(current.settings.name, "", { ...current.settings, maxAge: 0 });
  response.headers.set("cache-control", "no-store");
  return response;
}

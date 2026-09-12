import { NextResponse } from "next/server";
import { hashCapabilitySecret, parseOrderAccessCapability } from "@/lib/commerce/server";
import { safeOrderDestination } from "@/lib/commerce/presentation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const capability = parseOrderAccessCapability(url.searchParams.get("access"));
  const admin = createSupabaseAdminClient();
  const supabase = await createSupabaseServerClient();
  if (!capability || !admin || !supabase) return invalid(url);
  const { data, error } = await admin.rpc("ap_consume_order_access", {
    p_capability_id: capability.capabilityId,
    p_secret_hash: hashCapabilitySecret(capability.secret),
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.customer_id || !row.access_email || !row.order_id) return invalid(url);
  const destination = safeOrderDestination(url.searchParams.get("next"), String(row.order_id));
  const generated = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: String(row.access_email),
    options: { redirectTo: `${url.origin}/auth/callback?next=${encodeURIComponent(destination)}` },
  });
  const tokenHash = generated.data.properties?.hashed_token;
  if (generated.error || !tokenHash) return invalid(url);
  const verified = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verified.error || verified.data.user?.id !== row.customer_id) {
    await supabase.auth.signOut().catch(() => undefined);
    return invalid(url);
  }
  const clean = new URL(destination, url.origin);
  clean.searchParams.set("authenticated", "1");
  return NextResponse.redirect(clean, { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

function invalid(url: URL) {
  return NextResponse.redirect(new URL("/sign-in?error=invalid-link", url.origin), {
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

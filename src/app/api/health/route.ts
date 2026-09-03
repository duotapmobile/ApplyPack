import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertConfiguredPrice, createStripeClient } from "@/lib/stripe/server";
import { checkFileScannerHealth, fileScanConfiguration } from "@/lib/files/scanner";

export const dynamic = "force-dynamic";

let stripeCache: { checkedAt: number; healthy: boolean } | null = null;

async function stripeReady() {
  if (stripeCache && Date.now() - stripeCache.checkedAt < 5 * 60 * 1000) return stripeCache.healthy;
  const stripe = createStripeClient();
  const searchPrice = process.env.STRIPE_JOB_SEARCH_PRICE_ID;
  const packPrice = process.env.STRIPE_APPLY_PACK_PRICE_ID;
  let healthy = false;
  if (stripe && searchPrice && packPrice) {
    try {
      await Promise.all([
        assertConfiguredPrice(stripe, searchPrice, { unitAmount: 2000, productName: "Job Match Search" }),
        assertConfiguredPrice(stripe, packPrice, { unitAmount: 800, productName: "Apply Pack" }),
      ]);
      healthy = true;
    } catch {
      healthy = false;
    }
  }
  stripeCache = { checkedAt: Date.now(), healthy };
  return healthy;
}

export async function GET() {
  const fileScan = fileScanConfiguration();
  const scannerHealthy = fileScan.ready ? await checkFileScannerHealth() : false;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  let publicOrigin = false;
  try {
    const parsed = new URL(appUrl);
    const expectedHost = process.env.APP_DEPLOYMENT_ENV === "production" ? "applypack.work" : null;
    publicOrigin = parsed.protocol === "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname) && (!expectedHost || parsed.hostname === expectedHost);
  } catch {
    publicOrigin = false;
  }
  const payments = await stripeReady();
  const configured = {
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)),
    payments,
    email: Boolean(process.env.RESEND_API_KEY && (process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM)),
    publicOrigin,
    fileSafety: scannerHealthy,
    maintenance: Boolean(process.env.CRON_SECRET),
  };
  let database = false;
  let jobSourcesRegistered = false;
  if (configured.supabase) {
    const admin = createSupabaseAdminClient();
    if (admin) {
      const { data, error } = await admin.from("capacity_limits").select("kind,units_per_24h,enabled");
      database = !error && data?.length === 2;
      const { count, error: sourceError } = await admin.from("job_sources").select("id", { count: "exact", head: true }).eq("is_active", true);
      jobSourcesRegistered = !sourceError && (count || 0) >= 69;
    }
  }
  const ready = Object.values(configured).every(Boolean) && database && jobSourcesRegistered;
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: { ...configured, database, jobSourcesRegistered },
    },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}

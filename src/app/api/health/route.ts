import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertConfiguredPrice, assertConfiguredRecurringPrice, createStripeOperationalClient } from "@/lib/stripe/server";
import { checkoutConfiguration } from "@/lib/stripe/mode";
import { boardPlans, boardPlanPriceId } from "@/lib/job-board/plans";
import { checkFileScannerHealth, fileScanConfiguration } from "@/lib/files/scanner";
import { maintenanceHeartbeatIsFresh } from "@/lib/operations/summary";

export const dynamic = "force-dynamic";

let stripeCache: { checkedAt: number; healthy: boolean } | null = null;

async function stripeReady() {
  if (stripeCache && Date.now() - stripeCache.checkedAt < 5 * 60 * 1000) return stripeCache.healthy;
  const checkout = checkoutConfiguration();
  if (!checkout.ready || !checkout.searchReady || !checkout.boardReady) return false;
  const stripe = createStripeOperationalClient();
  const searchPrice = process.env.STRIPE_JOB_SEARCH_PRICE_ID;
  const packPrice = process.env.STRIPE_APPLY_PACK_PRICE_ID;
  let healthy = false;
  const weeklyPrice = boardPlanPriceId("weekly");
  const monthlyPrice = boardPlanPriceId("monthly");
  const threeMonthPrice = boardPlanPriceId("three_months");
  if (stripe && searchPrice && packPrice && weeklyPrice && monthlyPrice && threeMonthPrice) {
    try {
      await Promise.all([
        assertConfiguredPrice(stripe, searchPrice, { unitAmount: 2000, productName: "Job Match Search" }),
        assertConfiguredPrice(stripe, packPrice, { unitAmount: 800, productName: "Tailored Resume + Cover Letter" }),
        assertConfiguredRecurringPrice(stripe, weeklyPrice, { unitAmount: boardPlans.weekly.amountCents, interval: boardPlans.weekly.interval, intervalCount: boardPlans.weekly.intervalCount }),
        assertConfiguredRecurringPrice(stripe, monthlyPrice, { unitAmount: boardPlans.monthly.amountCents, interval: boardPlans.monthly.interval, intervalCount: boardPlans.monthly.intervalCount }),
        assertConfiguredRecurringPrice(stripe, threeMonthPrice, { unitAmount: boardPlans.three_months.amountCents, interval: boardPlans.three_months.interval, intervalCount: boardPlans.three_months.intervalCount }),
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
  const scannerHealthy = fileScan.liveReady ? await checkFileScannerHealth() : false;
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
  const emailVerifiedAt = Date.parse(process.env.APP_EMAIL_DELIVERY_VERIFIED_AT || "");
  const emailRecentlyVerified = Number.isFinite(emailVerifiedAt)
    && emailVerifiedAt <= Date.now()
    && Date.now() - emailVerifiedAt <= 30 * 24 * 60 * 60 * 1_000;
  const configured = {
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)),
    payments,
    email: Boolean(process.env.RESEND_API_KEY && (process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM) && emailRecentlyVerified),
    publicOrigin,
    fileSafety: scannerHealthy,
    maintenance: false,
  };
  let database = false;
  let jobSourcesRegistered = false;
  let authorizedSourceInventory = false;
  if (configured.supabase) {
    const admin = createSupabaseAdminClient();
    if (admin) {
      const [
        { data: heartbeat, error: heartbeatError },
        { count: unresolvedOperationalAlerts, error: alertError },
        { count: unresolvedCriticalAlerts, error: criticalAlertError },
      ] = await Promise.all([
        admin.from("operational_heartbeats").select("last_succeeded_at").eq("task_name", "maintenance").maybeSingle(),
        admin.from("ap_operational_alerts").select("id", { count: "exact", head: true })
          .eq("state", "OPEN").in("category", ["WORKER", "OUTBOX", "WEBHOOK"]),
        admin.from("ap_operational_alerts").select("id", { count: "exact", head: true })
          .eq("state", "OPEN").eq("severity", "CRITICAL"),
      ]);
      configured.maintenance = Boolean(
        process.env.CRON_SECRET
        && !heartbeatError
        && !alertError
        && !criticalAlertError
        && maintenanceHeartbeatIsFresh(heartbeat?.last_succeeded_at)
        && (unresolvedOperationalAlerts || 0) === 0
        && (unresolvedCriticalAlerts || 0) === 0
      );
      const { data, error } = await admin.from("capacity_limits").select("kind,units_per_24h,enabled");
      database = !error && data?.length === 2;
      const { data: sourceReadiness, error: sourceError } = await admin.rpc("ap_current_source_readiness");
      jobSourcesRegistered = !sourceError && sourceReadiness?.jobSourcesRegistered === true;
      authorizedSourceInventory = !sourceError && process.env.APP_JOB_SOURCE_SYNC_ENABLED === "true"
        && sourceReadiness?.authorizedSourceInventory === true;
    }
  }
  const ready = Object.values(configured).every(Boolean) && database && jobSourcesRegistered && authorizedSourceInventory;
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks: { ...configured, database, jobSourcesRegistered, authorizedSourceInventory },
    },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}

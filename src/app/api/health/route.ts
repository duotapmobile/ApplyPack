import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertConfiguredPrice, createStripeOperationalClient } from "@/lib/stripe/server";
import { checkoutConfiguration } from "@/lib/stripe/mode";
import { APPLY_PACK_PRICE_CENTS, SEARCH_PRICE_CENTS } from "@/lib/domain/applypack";
import { checkRuntimeFileSafety } from "@/lib/operations/runtime-readiness";
import { checkSensitivePayloadHealth } from "@/lib/security/kms-health";
import { checkDocumentRendererReadiness } from "@/lib/operations/renderer-readiness";
import { maintenanceHeartbeatIsFresh } from "@/lib/operations/summary";

export const dynamic = "force-dynamic";

let stripeCache: { checkedAt: number; healthy: boolean } | null = null;

async function stripeReady() {
  if (stripeCache && Date.now() - stripeCache.checkedAt < 5 * 60 * 1000) return stripeCache.healthy;
  const checkout = checkoutConfiguration();
  if (!checkout.commerceConfigured) return false;
  const stripe = createStripeOperationalClient();
  const searchPrice = process.env.STRIPE_JOB_SEARCH_PRICE_ID;
  const packPrice = process.env.STRIPE_APPLY_PACK_PRICE_ID;
  let healthy = false;
  if (stripe && searchPrice && packPrice) {
    try {
      await Promise.all([
        assertConfiguredPrice(stripe, searchPrice, { unitAmount: SEARCH_PRICE_CENTS, productName: "Job Match Search" }),
        assertConfiguredPrice(stripe, packPrice, { unitAmount: APPLY_PACK_PRICE_CENTS, productName: "Tailored Resume + Cover Letter" }),
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
  const checkout = checkoutConfiguration();
  const encryption = await checkSensitivePayloadHealth();
  const fileSafety = await checkRuntimeFileSafety();
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
    commerceConfigured: payments,
    acceptingOrders: checkout.acceptingOrders,
    email: Boolean(process.env.RESEND_API_KEY && (process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM) && emailRecentlyVerified),
    publicOrigin,
    fileSafety,
    encryption,
    documentRendering: false,
    maintenance: false,
  };
  let database = false;
  let manualInventoryReady = false;
  const deployedSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_RELEASE_SHA || "";
  const releaseSha = Boolean(deployedSha && process.env.APP_EXPECTED_RELEASE_SHA === deployedSha);
  if (configured.supabase) {
    const admin = createSupabaseAdminClient();
    if (admin) {
      configured.documentRendering = await checkDocumentRendererReadiness(admin).catch(() => false);
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
      database = !error && data?.length === 2
        && data.some((row) => row.kind === "job_search" && row.enabled && row.units_per_24h === 1)
        && data.some((row) => row.kind === "apply_pack" && row.enabled && row.units_per_24h === 2);
      const { data: sourceReadiness, error: sourceError } = await admin.rpc("ap_current_source_readiness");
      manualInventoryReady = !sourceError && sourceReadiness?.manualReady === true;
    }
  }
  const infrastructureChecks = {
    supabase: configured.supabase,
    commerceConfigured: configured.commerceConfigured,
    email: configured.email,
    publicOrigin: configured.publicOrigin,
    fileSafety: configured.fileSafety,
    encryption: configured.encryption,
    documentRendering: configured.documentRendering,
    maintenance: configured.maintenance,
    database,
    manualInventoryReady,
    releaseSha,
  };
  const ready = Object.values(infrastructureChecks).every(Boolean);
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      releaseSha: deployedSha || null,
      commerceConfigured: configured.commerceConfigured,
      acceptingOrders: configured.acceptingOrders,
      checks: infrastructureChecks,
    },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}

import "server-only";

import { checkRuntimeFileSafety } from "@/lib/operations/runtime-readiness";
import { checkSensitivePayloadHealth } from "@/lib/security/kms-health";
import { checkDocumentRendererReadiness } from "@/lib/operations/renderer-readiness";
import { maintenanceHeartbeatIsFresh } from "@/lib/operations/summary";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertConfiguredPrice, createStripeOperationalClient } from "@/lib/stripe/server";
import { checkoutConfiguration } from "@/lib/stripe/mode";
import { APPLY_PACK_PRICE_CENTS, SEARCH_PRICE_CENTS } from "@/lib/domain/applypack";
import { documentWorkerConfiguration } from "@/lib/files/aws-document-worker";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

let stripeCache: { checkedAt: number; healthy: boolean } | null = null;

async function stripeReady() {
  if (stripeCache && Date.now() - stripeCache.checkedAt < 5 * 60 * 1_000) return stripeCache.healthy;
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

function publicOriginReady() {
  try {
    const parsed = new URL(process.env.NEXT_PUBLIC_APP_URL || "");
    const expectedHost = process.env.APP_DEPLOYMENT_ENV === "production" ? "applypack.work" : null;
    return parsed.protocol === "https:"
      && !["localhost", "127.0.0.1"].includes(parsed.hostname)
      && (!expectedHost || parsed.hostname === expectedHost);
  } catch {
    return false;
  }
}

function emailReady() {
  const verifiedAt = Date.parse(process.env.APP_EMAIL_DELIVERY_VERIFIED_AT || "");
  return Boolean(
    process.env.RESEND_API_KEY
    && (process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM)
    && Number.isFinite(verifiedAt)
    && verifiedAt <= Date.now()
    && Date.now() - verifiedAt <= 30 * 24 * 60 * 60 * 1_000,
  );
}

export async function evaluateLaunchInfrastructure(adminClient?: AdminClient) {
  const checkout = checkoutConfiguration();
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
  const [commerceConfigured, encryption, fileSafety] = await Promise.all([
    stripeReady(),
    checkSensitivePayloadHealth(),
    checkRuntimeFileSafety(),
  ]);
  const checks = {
    supabase: supabaseConfigured,
    commerceConfigured,
    email: emailReady(),
    publicOrigin: publicOriginReady(),
    fileSafety,
    encryption,
    documentRendering: false,
    maintenance: false,
    database: false,
    manualInventoryReady: false,
    releaseSha: false,
  };
  const deployedSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_RELEASE_SHA || "";
  checks.releaseSha = Boolean(deployedSha && process.env.APP_EXPECTED_RELEASE_SHA === deployedSha);
  if (supabaseConfigured) {
    const admin = adminClient || createSupabaseAdminClient();
    if (admin) {
      checks.documentRendering = await checkDocumentRendererReadiness(admin).catch(() => false);
      const [
        { data: heartbeat, error: heartbeatError },
        { count: unresolvedOperationalAlerts, error: alertError },
        { count: unresolvedCriticalAlerts, error: criticalAlertError },
        { data: capacity, error: capacityError },
        { data: sourceReadiness, error: sourceError },
      ] = await Promise.all([
        admin.from("operational_heartbeats").select("last_succeeded_at").eq("task_name", "maintenance").maybeSingle(),
        admin.from("ap_operational_alerts").select("id", { count: "exact", head: true })
          .eq("state", "OPEN").in("category", ["WORKER", "OUTBOX", "WEBHOOK"]),
        admin.from("ap_operational_alerts").select("id", { count: "exact", head: true })
          .eq("state", "OPEN").eq("severity", "CRITICAL"),
        admin.rpc("ap_manual_launch_capacity_readiness"),
        admin.rpc("ap_current_source_readiness"),
      ]);
      checks.maintenance = Boolean(
        process.env.CRON_SECRET
        && !heartbeatError
        && !alertError
        && !criticalAlertError
        && maintenanceHeartbeatIsFresh(heartbeat?.last_succeeded_at)
        && (unresolvedOperationalAlerts || 0) === 0
        && (unresolvedCriticalAlerts || 0) === 0,
      );
      checks.database = !capacityError && Boolean(capacity && typeof capacity === "object" && !Array.isArray(capacity)
        && (capacity as Record<string, unknown>).ready === true);
      checks.manualInventoryReady = !sourceError && sourceReadiness?.manualReady === true;
    }
  }
  const ready = Object.values(checks).every(Boolean);
  return {
    ready,
    deployedSha,
    commerceConfigured,
    environmentAcceptingOrders: checkout.acceptingOrders,
    checks,
  };
}

export async function manualLaunchCheckoutGate(
  admin: AdminClient,
  evaluated?: Awaited<ReturnType<typeof evaluateLaunchInfrastructure>>,
) {
  const infrastructure = evaluated || await evaluateLaunchInfrastructure(admin);
  if (!infrastructure.ready || !infrastructure.environmentAcceptingOrders || !infrastructure.deployedSha) return false;
  const { data: configuration, error: configurationError } = await admin.from("ap_commerce_configuration")
    .select("checkout_enabled,launch_activation_id,launch_release_sha,tax_approval_reference,document_worker_network_attestation_sha256")
    .eq("singleton", true).maybeSingle();
  if (configurationError || !configuration?.checkout_enabled || !configuration.launch_activation_id
    || configuration.launch_release_sha !== infrastructure.deployedSha) return false;
  const { data: activation, error: activationError } = await admin.from("ap_manual_launch_activations")
    .select("id,release_sha,tax_approval_reference,worker_network_attestation_sha256,unresolved_p0_count,unresolved_p1_count,canary_reconciled_amount_cents")
    .eq("id", configuration.launch_activation_id).maybeSingle();
  const worker = documentWorkerConfiguration();
  return Boolean(!activationError && activation
    && activation.release_sha === infrastructure.deployedSha
    && activation.tax_approval_reference === configuration.tax_approval_reference
    && activation.worker_network_attestation_sha256 === configuration.document_worker_network_attestation_sha256
    && activation.worker_network_attestation_sha256 === worker.networkAttestationSha256
    && activation.unresolved_p0_count === 0
    && activation.unresolved_p1_count === 0
    && activation.canary_reconciled_amount_cents === 2_698);
}

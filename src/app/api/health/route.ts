import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { evaluateLaunchInfrastructure, manualLaunchCheckoutGate } from "@/lib/operations/launch-readiness";
import { checkoutConfiguration } from "@/lib/stripe/mode";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = createSupabaseAdminClient();
  const infrastructure = await evaluateLaunchInfrastructure(admin || undefined);
  const acceptingOrders = Boolean(admin && await manualLaunchCheckoutGate(admin, infrastructure).catch(() => false));
  const checkout = checkoutConfiguration();
  return NextResponse.json(
    {
      status: infrastructure.ready ? "ready" : "not_ready",
      releaseSha: infrastructure.deployedSha || null,
      commerceConfigured: infrastructure.commerceConfigured,
      acceptingOrders,
      checkoutMode: checkout.state,
      restrictedCheckoutMode: checkout.restrictedMode,
      sessionCreationConfigured: checkout.sessionCreationAllowed,
      checks: infrastructure.checks,
    },
    { status: infrastructure.ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

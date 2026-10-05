import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { evaluateLaunchInfrastructure, manualLaunchCheckoutGate } from "@/lib/operations/launch-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = createSupabaseAdminClient();
  const infrastructure = await evaluateLaunchInfrastructure(admin || undefined);
  const acceptingOrders = Boolean(admin && await manualLaunchCheckoutGate(admin, infrastructure).catch(() => false));
  return NextResponse.json(
    {
      status: infrastructure.ready ? "ready" : "not_ready",
      releaseSha: infrastructure.deployedSha || null,
      commerceConfigured: infrastructure.commerceConfigured,
      acceptingOrders,
      checks: infrastructure.checks,
    },
    { status: infrastructure.ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

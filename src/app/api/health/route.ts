import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  let productionOrigin = false;
  try {
    const parsed = new URL(appUrl);
    productionOrigin = parsed.protocol === "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname);
  } catch {
    productionOrigin = false;
  }
  const configured = {
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    email: Boolean(process.env.RESEND_API_KEY && (process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM)),
    productionOrigin,
    fileScanning: process.env.APP_FILE_SCAN_MODE === "connected",
    cron: Boolean(process.env.CRON_SECRET),
  };
  let database = false;
  if (configured.supabase) {
    const admin = createSupabaseAdminClient();
    if (admin) {
      const { data, error } = await admin.from("capacity_limits").select("kind,units_per_24h,enabled");
      database = !error && data?.length === 2;
    }
  }
  const ready = Object.values(configured).every(Boolean) && database;
  return NextResponse.json(
    {
      status: ready ? "ready" : "configuration_required",
      release: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "local",
      checks: { ...configured, database },
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}

import { NextResponse } from "next/server";
import { safeIntakeEvent } from "@/lib/intake/four-step";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ accepted: false }, { status: 403 });
  const parsed = safeIntakeEvent(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ accepted: false }, { status: 400 });
  const rate = await consumeRateLimit({ request, scope: "intake_aggregate_event", limit: 120, windowSeconds: 60 * 60 });
  const admin = createSupabaseAdminClient();
  if (!admin || !rate.configured || !rate.allowed) return NextResponse.json({ accepted: false }, { status: 202 });
  await admin.rpc("ap_increment_intake_event", { p_event: parsed.data.event, p_step: parsed.data.step });
  return NextResponse.json({ accepted: true }, { status: 202 });
}

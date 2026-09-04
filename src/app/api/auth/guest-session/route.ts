import { NextResponse } from "next/server";
import { requestOriginIsAllowed } from "@/lib/auth/email-code";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) {
    return NextResponse.json({ error: "This intake request was not accepted." }, { status: 403 });
  }

  const rate = await consumeRateLimit({
    request,
    scope: "guest_session",
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (!rate.configured) {
    return NextResponse.json({ error: "Secure intake is not connected yet." }, { status: 503 });
  }
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many intake starts. Wait an hour before trying again." }, { status: 429 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Secure intake is not connected yet." }, { status: 503 });
  }

  const { data: current } = await supabase.auth.getUser();
  if (current.user) {
    return NextResponse.json({ ok: true, guest: current.user.is_anonymous === true });
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user || !data.session) {
    return NextResponse.json({ error: "Secure intake could not be started. Try again shortly." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, guest: true });
}
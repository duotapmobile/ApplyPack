import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({ email: z.email() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const rate = await consumeRateLimit({ request, scope: "magic_link", identity: parsed.data.email.toLowerCase(), limit: 5, windowSeconds: 15 * 60 });
  if (!rate.configured) return NextResponse.json({ error: "Secure email sign-in is not connected yet." }, { status: 503 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many secure-link requests. Wait 15 minutes before trying again." }, { status: 429 });
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Secure email sign-in is not connected yet." }, { status: 503 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: appUrl + "/auth/callback?next=/get-started" },
  });
  if (error) {
    return NextResponse.json({ error: "We could not send the secure link. Try again shortly." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

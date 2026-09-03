import { NextResponse } from "next/server";
import { z } from "zod";
import { requestOriginIsAllowed } from "@/lib/auth/email-code";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ email: z.email().transform((value) => value.trim().toLowerCase()) });

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) {
    return NextResponse.json({ error: "This sign-in request was not accepted." }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const rate = await consumeRateLimit({
    request,
    scope: "email_code_request",
    identity: parsed.data.email,
    limit: 5,
    windowSeconds: 15 * 60,
  });
  if (!rate.configured) {
    return NextResponse.json({ error: "Secure email sign-in is not connected yet." }, { status: 503 });
  }
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many code requests. Wait 15 minutes before trying again." }, { status: 429 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Secure email sign-in is not connected yet." }, { status: 503 });
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    return NextResponse.json({ error: "We could not send the sign-in code. Try again shortly." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

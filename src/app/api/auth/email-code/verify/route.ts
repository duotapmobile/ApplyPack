import { NextResponse } from "next/server";
import { z } from "zod";
import { requestOriginIsAllowed, safeAuthDestination } from "@/lib/auth/email-code";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  code: z.string().regex(/^\d{6}$/),
  next: z.string().optional(),
});

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) {
    return NextResponse.json({ error: "This sign-in request was not accepted." }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the six-digit code from your email." }, { status: 400 });
  }

  const rate = await consumeRateLimit({
    request,
    scope: "email_code_verify",
    identity: parsed.data.email,
    limit: 10,
    windowSeconds: 15 * 60,
  });
  if (!rate.configured) {
    return NextResponse.json({ error: "Secure email sign-in is not connected yet." }, { status: 503 });
  }
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many code attempts. Request a new code in 15 minutes." }, { status: 429 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Secure email sign-in is not connected yet." }, { status: 503 });
  }

  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: "email",
  });
  if (error) {
    return NextResponse.json({ error: "That code is invalid or expired. Check the code or request a new one." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, redirectTo: safeAuthDestination(parsed.data.next) });
}

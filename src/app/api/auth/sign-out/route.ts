import { NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This sign-out request was rejected." }, { status: 403 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Authentication is unavailable." }, { status: 503 });
  const { error } = await supabase.auth.signOut();
  if (error) return NextResponse.json({ error: "Sign-out could not be completed." }, { status: 502 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") || "/my-applypack";
  let destination = new URL("/my-applypack", url.origin);
  try {
    const candidate = new URL(requestedNext, url.origin);
    if (requestedNext.startsWith("/") && !requestedNext.includes("\\") && candidate.origin === url.origin) {
      destination = candidate;
    }
  } catch {
    destination = new URL("/my-applypack", url.origin);
  }
  destination.searchParams.set("authenticated", "1");
  const supabase = await createSupabaseServerClient();

  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(destination);
    }
  }
  return NextResponse.redirect(new URL("/sign-in?error=invalid-link", url.origin));
}

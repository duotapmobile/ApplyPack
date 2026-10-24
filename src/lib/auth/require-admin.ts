import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export function isAdminEmailAllowed(email: string | null | undefined) {
  if (!email) return false;
  const allowed = (process.env.APP_ADMIN_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

export function hasFreshAdminMfa(claims: unknown, userId: string, now = Date.now()) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return false;
  const value = claims as Record<string, unknown>;
  if (value.sub !== userId || !Array.isArray(value.amr)) return false;
  const verifiedAt = value.amr.reduce<number | null>((latest, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return latest;
    const entry = item as Record<string, unknown>;
    if (entry.method !== "totp" || !Number.isSafeInteger(entry.timestamp)) return latest;
    const timestamp = entry.timestamp as number;
    return timestamp > 0 && (latest === null || timestamp > latest) ? timestamp : latest;
  }, null);
  if (verifiedAt === null) return false;
  const verifiedAtMs = verifiedAt * 1_000;
  return verifiedAtMs <= now && now - verifiedAtMs <= 15 * 60 * 1_000;
}

export async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) {
    return { ok: false as const, response: NextResponse.json({ error: "Admin providers are not configured." }, { status: 503 }) };
  }
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    return { ok: false as const, response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (!isAdminEmailAllowed(authData.user.email)) {
    await admin.from("audit_logs").insert({
      actor_id: authData.user.id,
      action: "admin_email_not_allowed",
      entity_type: "admin_route",
      entity_id: "unknown",
    });
    return { ok: false as const, response: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  }
  const { data: profile } = await admin.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (!profile || !["operator", "admin"].includes(profile.role)) {
    await admin.from("audit_logs").insert({
      actor_id: authData.user.id,
      action: "admin_access_denied",
      entity_type: "admin_route",
      entity_id: "unknown",
    });
    return { ok: false as const, response: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  }
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance || assurance.currentLevel !== "aal2") {
    return { ok: false as const, response: NextResponse.json({ error: "Admin MFA verification required." }, { status: 403 }) };
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const verified = token ? await supabase.auth.getClaims(token).catch(() => null) : null;
  if (!verified || verified.error || !hasFreshAdminMfa(verified.data?.claims, authData.user.id)) {
    return { ok: false as const, response: NextResponse.json({ error: "Fresh admin MFA verification required." }, { status: 403 }) };
  }
  return { ok: true as const, user: authData.user, admin, role: profile.role as "operator" | "admin" };
}

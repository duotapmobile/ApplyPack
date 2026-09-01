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
  return { ok: true as const, user: authData.user, admin };
}

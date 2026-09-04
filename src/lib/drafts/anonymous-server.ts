import "server-only";

import { cookies } from "next/headers";
import { hashDraftSecret, parseDraftCapability, draftCookieSettings } from "@/lib/security/draft-capability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function anonymousDraftContext() {
  const settings = draftCookieSettings();
  const admin = createSupabaseAdminClient();
  if (!settings || !admin) return null;
  const store = await cookies();
  const capability = parseDraftCapability(store.get(settings.name)?.value);
  if (!capability) return null;
  return { admin, capability, secretHash: hashDraftSecret(capability.secret), settings };
}

export function anonymousDraftError(error: { message?: string; details?: string } | null) {
  const message = error?.message ?? "";
  if (message.includes("draft_version_conflict")) {
    const currentVersion = /^\d+$/.test(error?.details ?? "") ? Number(error!.details) : null;
    return { status: 409, body: { error: "This draft changed in another tab. Reload the saved draft before retrying.", code: "DRAFT_VERSION_CONFLICT", currentVersion } };
  }
  if (message.includes("draft_capability_invalid")) {
    return { status: 404, body: { error: "The saved draft is unavailable.", code: "DRAFT_UNAVAILABLE" } };
  }
  if (message.includes("document_not_found")) {
    return { status: 404, body: { error: "The saved document is unavailable.", code: "DOCUMENT_UNAVAILABLE" } };
  }
  return { status: 502, body: { error: "The draft service is temporarily unavailable.", code: "DRAFT_SERVICE_ERROR" } };
}

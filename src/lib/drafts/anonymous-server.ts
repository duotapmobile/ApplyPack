import "server-only";

import { cookies, headers } from "next/headers";
import { hashDraftSecret, parseDraftCapability, draftCookieSettings } from "@/lib/security/draft-capability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { INTAKE_DRAFT_HEADER } from "@/lib/intake/verified-intake-contract";
import { readOwnedIntakeContext, verifiedIntakeIdentity } from "@/lib/intake/verified-intake-server";

export async function anonymousDraftContext() {
  const settings = draftCookieSettings();
  const admin = createSupabaseAdminClient();
  if (!settings || !admin) return null;
  const store = await cookies();
  const capability = parseDraftCapability(store.get(settings.name)?.value);
  if (!capability) return null;
  // A tab must name the draft it displayed. A valid cookie for a different
  // selected intake never authorizes this tab's private read or mutation.
  if ((await headers()).get(INTAKE_DRAFT_HEADER) !== capability.draftId) return null;
  const identity = await verifiedIntakeIdentity().catch(() => null);
  if (!identity) return null;
  const owned = await readOwnedIntakeContext(admin, identity, capability).catch(() => null);
  if (!owned) return null;
  return { admin, capability, secretHash: hashDraftSecret(capability.secret), settings,
    customerId: identity.customerId, verifiedEmail: identity.verifiedEmail, accessEmail: owned.accessEmail, owned };
}

export function anonymousDraftError(error: { message?: string; details?: string } | null) {
  const message = error?.message ?? "";
  if (message.includes("confirmed_intake_requires_successor_review")) {
    return { status: 409, body: { error: "Your confirmed intake is preserved. If ApplyPack asks for clarification, answer the saved question and review the complete updated intake before confirming it.", code: "CONFIRMED_INTAKE_PRESERVED" } };
  }
  if (message.includes("clarification_paid_or_checkout_owner_exception")) {
    return { status: 409, body: { error: "This intake has an active checkout or paid service. Contact support so we can review the question without changing your order or deadline.", code: "CLARIFICATION_OWNER_REVIEW_REQUIRED" } };
  }
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

import "server-only";
import { createHash } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkoutConfiguration } from "@/lib/stripe/mode";
import { evaluateLaunchInfrastructure, manualLaunchCanaryCheckoutGate, manualLaunchCheckoutGate } from "@/lib/operations/launch-readiness";

type Admin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
export type CheckoutAuthorization = {
  mode: "PUBLIC" | "CANARY" | "REHEARSAL";
  releaseSha: string;
  customerId: string | null;
  authorizationId: string | null;
};

export function selectedJobResourceSha256(jobIds: string[]) {
  return createHash("sha256").update([...jobIds].map((id) => id.toLowerCase()).sort().join(",")).digest("hex");
}

/** Capacity is reserved atomically by the begin RPC, including idempotent resumes. */
export async function authorizeCheckout(admin: Admin, product: "SEARCH" | "MATERIALS", subject: {
  customerId: string | null; resourceId: string; resourceSha256?: string;
}): Promise<CheckoutAuthorization | null> {
  const configuration = checkoutConfiguration();
  if (!configuration.sessionCreationAllowed) return null;
  const infrastructure = await evaluateLaunchInfrastructure(admin).catch(() => null);
  if (!infrastructure?.ready) return null;
  const base = { releaseSha: infrastructure.deployedSha, customerId: subject.customerId };
  if (configuration.acceptingOrders) {
    return await manualLaunchCheckoutGate(admin, infrastructure, product, true)
      ? { ...base, mode: "PUBLIC", authorizationId: null } : null;
  }
  if (!subject.customerId) return null;
  if (configuration.restrictedMode === "CANARY") {
    if (!await manualLaunchCanaryCheckoutGate(admin, product, {
      expectedCustomerId: subject.customerId,
      searchDraftId: product === "SEARCH" ? subject.resourceId : undefined,
    }, infrastructure, true)) return null;
    let query = admin.from("ap_manual_launch_canary_authorizations").select("id")
      .eq("release_sha", base.releaseSha).eq("product_kind", product)
      .eq("expected_customer_id", subject.customerId).is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());
    if (product === "SEARCH") query = query.eq("search_draft_id", subject.resourceId);
    const result = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error || !result.data) return null;
    const scope = await admin.from("ap_manual_launch_canary_resource_bindings").select("resource_id,resource_sha256")
      .eq("authorization_id", result.data.id).maybeSingle();
    if (scope.error || scope.data?.resource_id !== subject.resourceId
      || scope.data.resource_sha256 !== (subject.resourceSha256 || null)) return null;
    return { ...base, mode: "CANARY", authorizationId: result.data.id };
  }
  if (configuration.restrictedMode !== "REHEARSAL") return null;
  // Rehearsal removes only activation evidence. Every infrastructure check and
  // the product's consent, inventory, renderer and reservation RPC still apply.
  let query = admin.from("ap_staging_rehearsal_authorizations").select("id")
    .eq("release_sha", base.releaseSha).eq("product_kind", product)
    .eq("customer_id", subject.customerId).eq("resource_id", subject.resourceId)
    .is("revoked_at", null).gt("expires_at", new Date().toISOString());
  query = product === "MATERIALS" ? query.eq("resource_sha256", subject.resourceSha256 || "")
    : query.is("resource_sha256", null);
  const result = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return !result.error && result.data ? { ...base, mode: "REHEARSAL", authorizationId: result.data.id } : null;
}

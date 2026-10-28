import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { customerRetentionAccessSchema } from "./retention-access";

export async function loadCustomerRetentionAccess(client: SupabaseClient, customerId: string) {
  const result = await client.rpc("ap_customer_retention_access", { p_customer_id: customerId });
  if (result.error) throw new Error("customer_retention_access_unavailable");
  const parsed = customerRetentionAccessSchema.safeParse(result.data);
  if (!parsed.success) throw new Error("customer_retention_access_invalid");
  return parsed.data;
}

export async function customerPrivateRetentionAccess(client: SupabaseClient, customerId: string) {
  const result = await client.rpc("ap_customer_private_retention_access", { p_customer_id: customerId });
  if (result.error || typeof result.data !== "boolean") throw new Error("customer_private_retention_access_unavailable");
  return result.data;
}

// This permits only recovery of the already-durable command. Database creation
// guards and provider reconciliation still own authorization and fixed expiry.
export async function mayResumeMaterialCheckoutAfterActionExpiry(client: SupabaseClient, input: {
  customerId: string; orderId: string; releaseId: string; snapshotId: string; contactPayloadId: string;
  requestKey: string; selectionSha256: string; launchReleaseSha: string; mode: string;
  authorizationId: string | null; actionExpiresAt: string | null; now?: number;
}) {
  const deadline = input.actionExpiresAt ? Date.parse(input.actionExpiresAt) : NaN;
  if (!Number.isFinite(deadline)) return false;
  const intent = await client.from("ap_material_checkout_intents").select("id,created_at,expires_at,state")
    .eq("customer_id", input.customerId).eq("delivered_order_id", input.orderId)
    .eq("delivered_release_id", input.releaseId).eq("source_snapshot_id", input.snapshotId)
    .eq("contact_payload_id", input.contactPayloadId).eq("request_key", input.requestKey)
    .eq("selection_sha256", input.selectionSha256).maybeSingle();
  if (intent.error) throw new Error("material_checkout_resume_unavailable");
  const parsed = z.object({ id: z.uuid(), created_at: z.iso.datetime({ offset: true }),
    expires_at: z.iso.datetime({ offset: true }), state: z.enum(["PREFLIGHT", "READY", "OPEN"]) }).strict().safeParse(intent.data);
  const now = input.now ?? Date.now();
  if (!parsed.success || Date.parse(parsed.data.created_at) >= deadline || Date.parse(parsed.data.expires_at) <= now) return false;
  const result = await client.from("ap_checkout_initiations").select("initiated_at,provider_session_deadline,state,authorization_id")
    .eq("id", parsed.data.id).eq("customer_id", input.customerId).eq("product_kind", "MATERIALS")
    .eq("resource_id", input.releaseId).eq("request_key", input.requestKey).eq("request_sha256", input.selectionSha256)
    .eq("mode", input.mode).eq("release_sha", input.launchReleaseSha).maybeSingle();
  if (result.error) throw new Error("material_checkout_resume_unavailable");
  const initiation = z.object({ initiated_at: z.iso.datetime({ offset: true }), provider_session_deadline: z.iso.datetime({ offset: true }),
    state: z.enum(["INITIATED", "OPEN"]), authorization_id: z.uuid().nullable() }).strict().safeParse(result.data);
  return initiation.success && initiation.data.authorization_id === input.authorizationId
    && Date.parse(initiation.data.initiated_at) < deadline && Date.parse(initiation.data.initiated_at) <= now
    && Date.parse(initiation.data.provider_session_deadline) === Date.parse(parsed.data.expires_at)
    && Date.parse(initiation.data.provider_session_deadline) - Date.parse(initiation.data.initiated_at) <= 36 * 60_000;
}

import "server-only";
import { hasProviderConfirmedLegacyBoardAccess, type BoardSubscriptionState } from "./entitlements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export async function requireLegacyBoardArchiveAccess() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return { ok: false as const, status: 503, error: "Legacy archive access is unavailable." };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false as const, status: 401, error: "Sign in required." };
  const { data: subscription, error } = await admin.from("ap_board_subscriptions")
    .select("id,state,access_ends_at,provider_customer_id,provider_subscription_id,last_provider_event_created,last_provider_event_id,refund_state,provider_dispute_id")
    .eq("customer_id", data.user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return { ok: false as const, status: 503, error: "Legacy entitlement status is unavailable." };
  if (!subscription || !hasProviderConfirmedLegacyBoardAccess({
    state: subscription.state as BoardSubscriptionState,
    accessEndsAt: subscription.access_ends_at,
    providerCustomerId: subscription.provider_customer_id,
    providerSubscriptionId: subscription.provider_subscription_id,
    lastProviderEventCreated: Number(subscription.last_provider_event_created),
    lastProviderEventId: subscription.last_provider_event_id,
    refundState: subscription.refund_state as "NONE" | "PARTIAL" | "FULL" | "FAILED",
    providerDisputeId: subscription.provider_dispute_id,
  })) {
    return { ok: false as const, status: 410, error: "No current legacy archive entitlement was found." };
  }
  return {
    ok: true as const,
    admin,
    customerId: data.user.id,
    providerCustomerId: subscription.provider_customer_id,
    subscriptionId: subscription.id,
    accessEndsAt: subscription.access_ends_at!,
  };
}

// Compatibility for historical server code that remains in the tree for audit
// and refund reconciliation. New board-origin commerce is permanently retired.
export async function requireBoardAccess(): Promise<
  | { ok: false; status: number; error: string }
  | { ok: true; admin: AdminClient; customerId: string; customerEmail: string; profileId: string; admissionVersion: string }
> {
  return { ok: false as const, status: 410, error: "Board-origin commerce is retired." };
}

import "server-only";
import { hasBoardAccess, type BoardSubscriptionState } from "./entitlements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireBoardAccess() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return { ok: false as const, status: 503, error: "Job board access service is unavailable." };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false as const, status: 401, error: "Sign in required." };
  const { data: subscription, error } = await admin.from("ap_board_subscriptions")
    .select("state,access_ends_at").eq("customer_id", data.user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return { ok: false as const, status: 503, error: "Subscription status is unavailable." };
  if (!subscription || !hasBoardAccess({ state: subscription.state as BoardSubscriptionState, accessEndsAt: subscription.access_ends_at })) {
    return { ok: false as const, status: 402, error: "An active paid subscription is required." };
  }
  const { data: profile, error: profileError } = await admin.from("ap_intake_snapshots")
    .select("id,version").eq("customer_id", data.user.id).order("version", { ascending: false }).limit(1).maybeSingle();
  if (profileError) return { ok: false as const, status: 503, error: "Profile status is unavailable." };
  if (!profile) return { ok: false as const, status: 409, error: "Complete the shared candidate profile first." };
  return { ok: true as const, admin, customerId: data.user.id, profileId: profile.id };
}

import "server-only";
import { hasBoardAccess, type BoardSubscriptionState } from "./entitlements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BOARD_ADMISSION_VERSION } from "./recompute";
import { anonymousDraftContext } from "@/lib/drafts/anonymous-server";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export async function currentBoardProfile(admin: AdminClient, customerId: string) {
  const [claimed, direct] = await Promise.all([
    admin.from("ap_board_profile_claims").select("profile_snapshot_id,profile_version")
      .eq("customer_id", customerId).order("profile_version", { ascending: false }).limit(1).maybeSingle(),
    admin.from("ap_intake_snapshots").select("id,version").eq("customer_id", customerId)
      .not("finalized_at", "is", null).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (claimed.error) throw claimed.error;
  if (direct.error) throw direct.error;
  if (claimed.data && (!direct.data || claimed.data.profile_version >= direct.data.version)) {
    return { id: claimed.data.profile_snapshot_id, version: claimed.data.profile_version };
  }
  return direct.data;
}

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
  const draft = await anonymousDraftContext().catch(() => null);
  if (draft && data.user.email) {
    const claimed = await admin.rpc("ap_claim_board_profile", { p_draft_id: draft.capability.draftId,
      p_secret_hash: draft.secretHash, p_customer_id: data.user.id, p_verified_email: data.user.email });
    if (claimed.error && !claimed.error.message.includes("board_profile_capability_invalid")) {
      return { ok: false as const, status: 409, error: "The latest saved profile could not be securely linked to this account." };
    }
  }
  let profile: Awaited<ReturnType<typeof currentBoardProfile>>;
  try { profile = await currentBoardProfile(admin, data.user.id); }
  catch { return { ok: false as const, status: 503, error: "Profile status is unavailable." }; }
  if (!profile) return { ok: false as const, status: 409, error: "Complete the shared candidate profile first." };
  return { ok: true as const, admin, customerId: data.user.id, customerEmail: data.user.email || "", profileId: profile.id, admissionVersion: BOARD_ADMISSION_VERSION };
}

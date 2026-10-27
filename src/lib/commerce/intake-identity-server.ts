import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { intakePaymentIdentity } from "./intake-payment-identity";
import { intakeRecipient } from "./intake-recipient";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

/** Bind financial ownership to the exact draft and snapshot; this grants no private read access. */
export async function readIntakePaymentIdentity(admin: AdminClient, draftId: string, snapshotId: string) {
  const result = await admin.rpc("ap_intake_payment_identity", { p_draft_id: draftId, p_snapshot_id: snapshotId });
  if (result.error) throw new Error("intake_payment_identity_unavailable");
  return intakePaymentIdentity(result.data);
}

export async function loadCurrentIntakeRecipient(admin: AdminClient, draftId: string, snapshotId: string, historicalEmail: unknown) {
  const identity = await readIntakePaymentIdentity(admin, draftId, snapshotId);
  return intakeRecipient(identity, historicalEmail, async (customerId) => {
    const result = await admin.auth.admin.getUserById(customerId);
    if (result.error) throw new Error("intake_recipient_unavailable");
    return result.data.user;
  });
}

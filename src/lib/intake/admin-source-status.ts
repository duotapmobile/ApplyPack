import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type IntakeSourceMode = "GUIDED" | "UPLOADED_OR_LEGACY" | "UNAVAILABLE";
type OriginalSnapshot = { schema_version: string; confirmed_review: unknown };
type OriginalSource = { legacy_order_id: string; original_snapshot_id: string | null;
  original_snapshot: OriginalSnapshot | OriginalSnapshot[] | null };

export async function loadOrderIntakeSourceModes(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, orderIds: string[],
): Promise<Map<string, IntakeSourceMode>> {
  const modes = new Map<string, IntakeSourceMode>(orderIds.map((id) => [id, "UNAVAILABLE"]));
  for (let offset = 0; offset < orderIds.length; offset += 100) {
    const batch = orderIds.slice(offset, offset + 100);
    try {
      const { data, error } = await admin.from("ap_search_services")
        .select("legacy_order_id,original_snapshot_id,original_snapshot:ap_intake_snapshots!ap_search_services_original_snapshot_id_fkey(schema_version,confirmed_review)")
        .in("legacy_order_id", batch).returns<OriginalSource[]>();
      if (error || !data) continue;
      const byOrder = new Map(data.map((row) => [row.legacy_order_id, row]));
      for (const orderId of batch) {
        const row = byOrder.get(orderId);
        if (!row?.original_snapshot_id) { modes.set(orderId, "UPLOADED_OR_LEGACY"); continue; }
        const snapshot = Array.isArray(row.original_snapshot) ? row.original_snapshot[0] : row.original_snapshot;
        if (!snapshot) continue;
        const receipt = snapshot.confirmed_review;
        const guided = snapshot.schema_version === "applypack-intake-v4"
          && receipt !== null && typeof receipt === "object" && !Array.isArray(receipt)
          && "contractVersion" in receipt && receipt.contractVersion === "applypack-confirmed-intake-v1"
          && "entryMode" in receipt && receipt.entryMode === "GUIDED";
        modes.set(orderId, guided ? "GUIDED" : "UPLOADED_OR_LEGACY");
      }
    } catch { /* Missing provenance must not be interpreted as guided entry. */ }
  }
  return modes;
}

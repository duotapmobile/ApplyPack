import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Only the database can select targets and commit deletion intent under current
// approved policy/hold checks. No caller-supplied bucket or path is accepted.
export async function processUnpaidSourceRetention(admin: SupabaseClient, limit = 10) {
  const claimed = await admin.rpc("ap_claim_unpaid_source_cleanup", { p_limit: Math.max(1, Math.min(20, limit)) });
  if (claimed.error) throw new Error("unpaid_retention_claim_failed");
  let deleted = 0; let failed = 0; let skipped = 0;
  for (const job of claimed.data || []) {
    const authorized = await admin.rpc("ap_authorize_unpaid_source_delete", { p_document_id: job.document_id, p_lease_token: job.lease_token });
    if (authorized.error) { failed++; continue; }
    const target = authorized.data;
    if (!target) { skipped++; continue; }
    if (target.bucket !== "customer-source-documents" || typeof target.path !== "string" || !target.path.startsWith("anonymous/")
      || target.path.includes("..") || target.path.includes("\\")) { failed++; continue; }
    let success = false;
    try { success = !(await admin.storage.from(target.bucket).remove([target.path])).error; }
    catch { success = false; }
    const finalized = await admin.rpc("ap_finish_unpaid_source_delete", { p_document_id: job.document_id, p_lease_token: job.lease_token, p_succeeded: success });
    if (!success || finalized.error || finalized.data !== true) failed++; else deleted++;
  }
  return { processed: (claimed.data || []).length, deleted, failed, skipped };
}

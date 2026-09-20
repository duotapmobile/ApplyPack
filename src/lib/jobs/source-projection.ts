import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeJob } from "./normalize";
import { toJobDatabaseRow } from "./persistence";
import type { RawJobPosting } from "./types";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
export const SOURCE_PROJECTOR_VERSION = "pending-source-projection-v1";

export function pendingProjectionRow(posting: RawJobPosting) {
  const job = normalizeJob(posting);
  if (!job.isActive || job.rejectionReason) throw new Error("source_projection_rejected_listing");
  return { ...toJobDatabaseRow(job), is_active: false, listing_status: "inactive",
    application_path_status: "unverified", source_freshness_status: "unknown",
    last_verified_at: null, last_successfully_verified_at: null };
}

export async function projectSourceRun(admin: AdminClient, runId: string) {
  const result = await admin.from("job_source_run_listings")
    .select("listing_key,captured_listing,content_sha256").eq("run_id", runId).order("listing_key").limit(501);
  if (result.error) throw result.error;
  if ((result.data || []).length > 500) throw new Error("source_projection_bound_exceeded");
  let projected = 0;
  for (const observation of result.data || []) {
    const row = pendingProjectionRow(observation.captured_listing as RawJobPosting);
    if (row.content_hash !== observation.content_sha256) throw new Error("source_projection_content_changed");
    const write = await admin.rpc("ap_project_source_observation", {
      p_run_id: runId, p_listing_key: observation.listing_key,
      p_content_sha256: observation.content_sha256, p_projector_version: SOURCE_PROJECTOR_VERSION,
      p_normalized: row,
    });
    if (write.error) throw write.error;
    projected += 1;
  }
  return { projected, verified: 0, customerVisible: 0 };
}

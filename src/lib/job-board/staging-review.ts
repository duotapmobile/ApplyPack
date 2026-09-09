import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export type StagingBoardReviewJob = {
  id: string; company: string; title: string; source_url: string;
  last_verified_at: string | null; snapshotId: string | null;
  ruleCheckedAt: string | null; materialsReady: boolean;
};

export async function loadSyntheticBoardReviewJobs(admin: AdminClient): Promise<StagingBoardReviewJob[]> {
  const jobs = await admin.from("jobs").select("id,company,title,source_url,last_verified_at")
    .eq("source_id", "synthetic-staging").eq("is_active", true).eq("listing_status", "open")
    .order("title").limit(100);
  if (jobs.error) throw jobs.error;
  const jobIds = (jobs.data || []).map((job) => job.id);
  const snapshots = jobIds.length ? await admin.from("ap_job_snapshots")
    .select("id,legacy_job_id,live_verified_at,content_sha256")
    .in("legacy_job_id", jobIds).order("retrieved_at", { ascending: false }) : { data: [], error: null };
  if (snapshots.error) throw snapshots.error;
  const newest = new Map<string, { id: string; live_verified_at: string; content_sha256: string }>();
  for (const snapshot of snapshots.data || []) if (snapshot.legacy_job_id && !newest.has(snapshot.legacy_job_id)) newest.set(snapshot.legacy_job_id, snapshot);
  const snapshotIds = [...newest.values()].map((snapshot) => snapshot.id);
  const rules = snapshotIds.length ? await admin.from("ap_employer_submission_rules")
    .select("job_snapshot_id,checked_at").in("job_snapshot_id", snapshotIds).eq("is_current", true) : { data: [], error: null };
  if (rules.error) throw rules.error;
  const currentRules = new Map((rules.data || []).map((rule) => [rule.job_snapshot_id, rule.checked_at]));
  const cutoff = Date.now() - 60 * 60 * 1_000;
  return (jobs.data || []).map((job) => {
    const snapshot = newest.get(job.id);
    const checkedAt = snapshot ? currentRules.get(snapshot.id) : null;
    return { ...job, snapshotId: snapshot?.id || null, ruleCheckedAt: checkedAt || null,
      materialsReady: Boolean(checkedAt && Date.parse(checkedAt) >= cutoff) };
  });
}

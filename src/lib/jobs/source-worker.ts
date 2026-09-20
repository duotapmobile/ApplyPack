import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runScheduledSourceCollection, SourceCollectionError, type SourceScheduledJob } from "./source-collection";
import { sourceRetryAt } from "./source-worker-policy";
import { projectSourceRun } from "./source-projection";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export async function processJobSourceWorkers(admin: AdminClient) {
  if (process.env.APP_JOB_SOURCE_SYNC_ENABLED !== "true") {
    return { status: "disabled" as const, reason: "APP_JOB_SOURCE_SYNC_ENABLED_FALSE", enqueued: 0, processed: 0, completed: 0 };
  }
  const owner = process.env.APP_JOB_SOURCE_WORKER_ID?.trim();
  if (!owner || owner.length < 3) {
    return { status: "disabled" as const, reason: "APP_JOB_SOURCE_WORKER_ID_UNSET", enqueued: 0, processed: 0, completed: 0 };
  }

  const enqueued = await admin.rpc("ap_enqueue_due_job_source_syncs", { p_limit: 20 });
  if (enqueued.error) throw enqueued.error;
  const claimed = await admin.rpc("ap_claim_job_source_syncs", { p_owner: owner, p_limit: 1 });
  if (claimed.error) throw claimed.error;
  const jobs = (Array.isArray(claimed.data) ? claimed.data : []) as SourceScheduledJob[];
  let completed = 0;
  for (const job of jobs) {
    try {
      const collection = await runScheduledSourceCollection(admin, job, owner);
      if (process.env.APP_JOB_SOURCE_PROJECTION_ENABLED === "true") await projectSourceRun(admin, collection.runId);
      const result = await admin.rpc("ap_complete_job_source_sync", {
        p_job_id: job.id,
        p_owner: owner,
        p_lease_epoch: job.lease_epoch,
      });
      if (result.error) throw result.error;
      completed += 1;
    } catch (error) {
      if (error instanceof SourceCollectionError && error.code === "job_source_lease_mismatch") continue;
      const retryAfterSeconds = error instanceof SourceCollectionError ? error.retryAfterSeconds : null;
      const retry = await admin.rpc("ap_retry_job_source_sync", {
        p_job_id: job.id,
        p_owner: owner,
        p_lease_epoch: job.lease_epoch,
        p_error_code: sourceWorkerErrorCode(error),
        p_retry_at: sourceRetryAt(job.attempts, retryAfterSeconds),
        p_dead_letter: error instanceof SourceCollectionError ? !error.retryable || sourceDeadLetter(job) : sourceDeadLetter(job),
      });
      if (retry.error) throw retry.error;
    }
  }
  return {
    status: "enabled" as const,
    enqueued: Number(enqueued.data || 0),
    processed: jobs.length,
    completed,
  };
}

function sourceDeadLetter(job: Pick<SourceScheduledJob, "attempts" | "created_at">, now = new Date()) {
  return job.attempts >= 12 || now.getTime() >= new Date(job.created_at).getTime() + 24 * 60 * 60_000;
}

function sourceWorkerErrorCode(error: unknown) {
  if (!(error instanceof SourceCollectionError)) return "job_source_worker_failed";
  const allowed = new Set([
    "current_employer_source_authorization_required",
    "job_source_authority_missing",
    "job_source_authority_or_lease_changed",
    "job_source_registry_drift",
    "job_source_schedule_generation_missing",
    "job_source_schedule_missing",
    "source_enumeration_partial",
    "source_observation_ledger_incomplete",
  ]);
  const sanitized = error.code.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return allowed.has(sanitized) || /^(ashby|greenhouse|lever|recruitee|teamtailor)_[a-z0-9_]+$/.test(sanitized)
    ? sanitized.slice(0, 100)
    : "job_source_worker_failed";
}

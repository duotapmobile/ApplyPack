import "server-only";

import { checkFileScannerHealth, fileScanConfiguration } from "@/lib/files/scanner";
import { checkoutConfiguration } from "@/lib/stripe/mode";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export type QueueCounts = {
  states: Record<string, number>;
  oldestItemAgeSeconds: number | null;
  stale: boolean;
};

export type OperationsSummary = {
  generatedAt: string;
  environment: "staging" | "production";
  releaseSha: string;
  readiness: {
    database: boolean;
    payments: boolean;
    email: boolean;
    fileSafety: boolean;
    maintenance: boolean;
  };
  inventory: {
    registeredSources: number;
    scheduledSources: number;
    scheduledAutomatedRealSources: number;
    realAuthorizedAutomatedSources: number;
    unauthorizedScheduledAutomatedRealSources: number;
    syntheticRuns: number;
    realRuns: number;
    syntheticActiveJobs: number;
    realActiveJobs: number;
  };
  queues: {
    recompute: QueueCounts;
    workflow: QueueCounts;
    outbox: QueueCounts;
    commerceReconciliation: QueueCounts;
  };
  maintenance: {
    heartbeatAgeSeconds: number | null;
    stale: boolean;
  };
  alerts: {
    openWarnings: number;
    openCritical: number;
  };
};

const SYNTHETIC_SOURCE_ID = "synthetic-staging";
const DEFAULT_MAINTENANCE_MAX_AGE_SECONDS = 90 * 60;

function boundedNonnegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(number))) : 0;
}

export function deploymentEnvironment(environment: Partial<NodeJS.ProcessEnv> = process.env): "staging" | "production" {
  const value = environment.APP_DEPLOYMENT_ENV?.trim().toLowerCase();
  if (value === "staging" || value === "production") return value;
  throw new Error("APP_DEPLOYMENT_ENV_MUST_BE_EXPLICIT");
}

export function safeReleaseSha(environment: Partial<NodeJS.ProcessEnv> = process.env) {
  const candidate = environment.RAILWAY_GIT_COMMIT_SHA || environment.GIT_COMMIT_SHA || environment.VERCEL_GIT_COMMIT_SHA || "";
  return /^[a-f0-9]{7,40}$/i.test(candidate) ? candidate.toLowerCase() : "unreported";
}

export function ageSeconds(value: string | null | undefined, now = new Date()) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.trunc((now.getTime() - timestamp) / 1_000));
}

export function queueCounts(
  states: Record<string, unknown>,
  oldestTimestamp: string | null | undefined,
  staleAfterSeconds: number,
  now = new Date(),
): QueueCounts {
  const normalizedStates = Object.fromEntries(Object.entries(states).map(([state, count]) => [state, boundedNonnegative(count)]));
  const oldestItemAgeSeconds = Object.values(normalizedStates).some((count) => count > 0)
    ? ageSeconds(oldestTimestamp, now)
    : null;
  return {
    states: normalizedStates,
    oldestItemAgeSeconds,
    stale: oldestItemAgeSeconds !== null && oldestItemAgeSeconds > staleAfterSeconds,
  };
}

function maintenanceMaxAgeSeconds(environment: Partial<NodeJS.ProcessEnv> = process.env) {
  const minutes = Number(environment.APP_MAINTENANCE_MAX_AGE_MINUTES || 90);
  if (!Number.isFinite(minutes)) return DEFAULT_MAINTENANCE_MAX_AGE_SECONDS;
  return Math.trunc(Math.max(15, Math.min(1_440, minutes)) * 60);
}

export function maintenanceHeartbeatIsFresh(
  lastSucceededAt: string | null | undefined,
  now = new Date(),
  environment: Partial<NodeJS.ProcessEnv> = process.env,
) {
  const age = ageSeconds(lastSucceededAt, now);
  return age !== null && age <= maintenanceMaxAgeSeconds(environment);
}

function recentEmailVerification(environment: Partial<NodeJS.ProcessEnv> = process.env, now = new Date()) {
  const verifiedAt = Date.parse(environment.APP_EMAIL_DELIVERY_VERIFIED_AT || "");
  return Boolean(
    environment.RESEND_API_KEY
    && (environment.EMAIL_FROM_ADDRESS || environment.EMAIL_FROM)
    && Number.isFinite(verifiedAt)
    && verifiedAt <= now.getTime()
    && now.getTime() - verifiedAt <= 30 * 24 * 60 * 60 * 1_000,
  );
}

type QueryResult = { count: number | null; error: unknown };

function countOf(result: QueryResult) {
  return result.error ? 0 : boundedNonnegative(result.count);
}

function firstTimestamp(result: { data: Array<Record<string, unknown>> | null; error: unknown }, key: string) {
  if (result.error || !result.data?.length) return null;
  const value = result.data[0]?.[key];
  return typeof value === "string" ? value : null;
}

export function earliestTimestamp(...values: Array<string | null | undefined>) {
  const parsed = values
    .map((value) => ({ value, timestamp: value ? Date.parse(value) : Number.NaN }))
    .filter((item): item is { value: string; timestamp: number } => typeof item.value === "string" && Number.isFinite(item.timestamp));
  if (!parsed.length) return null;
  return parsed.reduce((earliest, item) => item.timestamp < earliest.timestamp ? item : earliest).value;
}

export function approvedRealSourceIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const id = (row as Record<string, unknown>).id;
    return typeof id === "string" && id && id !== SYNTHETIC_SOURCE_ID ? [id] : [];
  });
}

export function sourcePermissionCoverage(scheduledValue: unknown, authorizedValue: unknown) {
  const scheduledIds = new Set(approvedRealSourceIds(scheduledValue));
  const authorizedIds = new Set(approvedRealSourceIds(authorizedValue).filter((id) => scheduledIds.has(id)));
  return {
    scheduledAutomatedRealSources: boundedNonnegative(scheduledIds.size),
    realAuthorizedAutomatedSources: boundedNonnegative(authorizedIds.size),
    unauthorizedScheduledAutomatedRealSources: boundedNonnegative(scheduledIds.size - authorizedIds.size),
  };
}

export function commerceSnapshot(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    pending: boundedNonnegative(record.webhooksPending),
    failed: boundedNonnegative(record.webhookFailures),
    deadLetter: boundedNonnegative(record.outboxDeadLetters),
    expiredLease: boundedNonnegative(record.leasedJobsOverdue),
    oldestAgeSeconds: Math.max(
      boundedNonnegative(record.oldestWebhookLagSeconds),
      boundedNonnegative(record.oldestOutboxRetrySeconds),
    ) || null,
  };
}

export async function collectOperationsSummary(admin: AdminClient, now = new Date()): Promise<OperationsSummary> {
  const count = (table: string) => admin.from(table).select("id", { count: "exact", head: true });
  const nowIso = now.toISOString();
  const expiredWorkflowLeaseCutoff = new Date(now.getTime() - 15 * 60_000).toISOString();

  const [registeredSources, scheduledSources, scheduledAutomatedSources, authorizedSources] = await Promise.all([
    count("job_sources"),
    count("job_sources").eq("is_active", true).eq("schedule_enabled", true),
    admin.from("job_sources").select("id")
      .eq("is_active", true).eq("schedule_enabled", true)
      .eq("automation_status", "automated")
      .neq("id", SYNTHETIC_SOURCE_ID),
    admin.from("job_sources").select("id")
      .eq("is_active", true).eq("schedule_enabled", true)
      .eq("automation_status", "automated")
      .eq("ingestion_permission_status", "approved_public_endpoint")
      .eq("paid_display_permission_status", "documented_paid_display_authorized")
      .neq("id", SYNTHETIC_SOURCE_ID),
  ]);
  const permissionCoverage = sourcePermissionCoverage(scheduledAutomatedSources.data, authorizedSources.data);

  const [
    syntheticRuns, realRuns, syntheticJobs, realJobs,
    recomputePending, recomputeProcessing, recomputeRetry, recomputeDead,
    workflowQueued, workflowProcessing, workflowReview, workflowBlocked, workflowFailed,
    outboxQueued, outboxSending, outboxRetry, outboxDead,
    oldestRecomputeDue, oldestRecomputeExpiredLease,
    oldestWorkflowDue, oldestWorkflowExpiredLease,
    oldestOutboxScheduled, oldestOutboxImmediate, oldestOutboxSending,
    heartbeat, warnings, critical, commerce,
  ] = await Promise.all([
    count("job_source_runs").eq("source_id", SYNTHETIC_SOURCE_ID),
    count("job_source_runs").neq("source_id", SYNTHETIC_SOURCE_ID),
    count("jobs").eq("source_id", SYNTHETIC_SOURCE_ID).eq("is_active", true).eq("listing_status", "open"),
    count("jobs").neq("source_id", SYNTHETIC_SOURCE_ID).eq("is_active", true).eq("listing_status", "open")
      .neq("source_freshness_status", "stale"),
    count("ap_board_recompute_jobs").eq("state", "PENDING"),
    count("ap_board_recompute_jobs").eq("state", "PROCESSING"),
    count("ap_board_recompute_jobs").eq("state", "RETRY"),
    count("ap_board_recompute_jobs").eq("state", "DEAD_LETTER"),
    count("workflow_tasks").eq("status", "queued"),
    count("workflow_tasks").eq("status", "processing"),
    count("workflow_tasks").eq("status", "awaiting_review"),
    count("workflow_tasks").eq("status", "blocked"),
    count("workflow_tasks").eq("status", "failed"),
    count("ap_outbox_messages").eq("state", "QUEUED"),
    count("ap_outbox_messages").eq("state", "SENDING"),
    count("ap_outbox_messages").eq("state", "RETRY"),
    count("ap_outbox_messages").eq("state", "DEAD_LETTER"),
    admin.from("ap_board_recompute_jobs").select("available_at").in("state", ["PENDING", "RETRY"])
      .lte("available_at", nowIso).order("available_at").limit(1),
    admin.from("ap_board_recompute_jobs").select("lease_expires_at").eq("state", "PROCESSING")
      .not("lease_expires_at", "is", null).lte("lease_expires_at", nowIso).order("lease_expires_at").limit(1),
    admin.from("workflow_tasks").select("not_before").in("status", ["queued", "failed"])
      .lt("attempt_count", 5).lte("not_before", nowIso).order("not_before").limit(1),
    admin.from("workflow_tasks").select("locked_at").eq("status", "processing")
      .lt("attempt_count", 5).not("locked_at", "is", null).lte("locked_at", expiredWorkflowLeaseCutoff).order("locked_at").limit(1),
    admin.from("ap_outbox_messages").select("next_attempt_at").in("state", ["QUEUED", "RETRY"])
      .not("next_attempt_at", "is", null).lte("next_attempt_at", nowIso).order("next_attempt_at").limit(1),
    admin.from("ap_outbox_messages").select("created_at").in("state", ["QUEUED", "RETRY"])
      .is("next_attempt_at", null).lte("created_at", nowIso).order("created_at").limit(1),
    admin.from("ap_outbox_messages").select("updated_at").eq("state", "SENDING").order("updated_at").limit(1),
    admin.from("operational_heartbeats").select("last_succeeded_at").eq("task_name", "maintenance").maybeSingle(),
    count("ap_operational_alerts").eq("state", "OPEN").eq("severity", "WARNING"),
    count("ap_operational_alerts").eq("state", "OPEN").eq("severity", "CRITICAL"),
    admin.rpc("ap_chunk4_monitor_snapshot"),
  ]);

  const results = [registeredSources, scheduledSources, scheduledAutomatedSources, authorizedSources,
    syntheticRuns, realRuns, syntheticJobs, realJobs,
    recomputePending, recomputeProcessing, recomputeRetry, recomputeDead, workflowQueued, workflowProcessing, workflowReview,
    workflowBlocked, workflowFailed, outboxQueued, outboxSending, outboxRetry, outboxDead,
    oldestRecomputeDue, oldestRecomputeExpiredLease, oldestWorkflowDue, oldestWorkflowExpiredLease,
    oldestOutboxScheduled, oldestOutboxImmediate, oldestOutboxSending, heartbeat, warnings, critical, commerce];
  const database = results.every((result) => !result.error);
  const heartbeatAt = !heartbeat.error && heartbeat.data && typeof heartbeat.data.last_succeeded_at === "string"
    ? heartbeat.data.last_succeeded_at
    : null;
  const heartbeatAgeSeconds = ageSeconds(heartbeatAt, now);
  const maintenanceStale = !maintenanceHeartbeatIsFresh(heartbeatAt, now);
  const payment = checkoutConfiguration();
  const fileScan = fileScanConfiguration();
  const fileSafety = fileScan.ready ? await checkFileScannerHealth() : false;
  const commerceCounts = commerceSnapshot(commerce.error ? null : commerce.data);
  const oldestRecomputeActionable = earliestTimestamp(
    firstTimestamp(oldestRecomputeDue, "available_at"),
    firstTimestamp(oldestRecomputeExpiredLease, "lease_expires_at"),
  );
  const oldestWorkflowActionable = earliestTimestamp(
    firstTimestamp(oldestWorkflowDue, "not_before"),
    firstTimestamp(oldestWorkflowExpiredLease, "locked_at"),
  );
  const oldestOutboxActionable = earliestTimestamp(
    firstTimestamp(oldestOutboxScheduled, "next_attempt_at"),
    firstTimestamp(oldestOutboxImmediate, "created_at"),
    firstTimestamp(oldestOutboxSending, "updated_at"),
  );

  return {
    generatedAt: now.toISOString(),
    environment: deploymentEnvironment(),
    releaseSha: safeReleaseSha(),
    readiness: {
      database,
      payments: payment.ready && payment.searchReady && payment.boardReady,
      email: recentEmailVerification(process.env, now),
      fileSafety,
      maintenance: Boolean(process.env.CRON_SECRET) && !maintenanceStale,
    },
    inventory: {
      registeredSources: countOf(registeredSources),
      scheduledSources: countOf(scheduledSources),
      ...permissionCoverage,
      syntheticRuns: countOf(syntheticRuns),
      realRuns: countOf(realRuns),
      syntheticActiveJobs: countOf(syntheticJobs),
      realActiveJobs: countOf(realJobs),
    },
    queues: {
      recompute: queueCounts({ pending: countOf(recomputePending), processing: countOf(recomputeProcessing), retry: countOf(recomputeRetry), deadLetter: countOf(recomputeDead) }, oldestRecomputeActionable, 30 * 60, now),
      workflow: queueCounts({ queued: countOf(workflowQueued), processing: countOf(workflowProcessing), awaitingReview: countOf(workflowReview), blocked: countOf(workflowBlocked), failed: countOf(workflowFailed) }, oldestWorkflowActionable, 30 * 60, now),
      outbox: queueCounts({ queued: countOf(outboxQueued), sending: countOf(outboxSending), retry: countOf(outboxRetry), deadLetter: countOf(outboxDead) }, oldestOutboxActionable, 15 * 60, now),
      commerceReconciliation: {
        states: { pending: commerceCounts.pending, failed: commerceCounts.failed, deadLetter: commerceCounts.deadLetter, expiredLease: commerceCounts.expiredLease },
        oldestItemAgeSeconds: commerceCounts.oldestAgeSeconds,
        stale: commerceCounts.failed > 0
          || commerceCounts.deadLetter > 0
          || commerceCounts.expiredLease > 0
          || (commerceCounts.pending > 0 && commerceCounts.oldestAgeSeconds !== null && commerceCounts.oldestAgeSeconds > 15 * 60),
      },
    },
    maintenance: { heartbeatAgeSeconds, stale: maintenanceStale },
    alerts: { openWarnings: countOf(warnings), openCritical: countOf(critical) },
  };
}

export function containsSensitiveOperationsData(value: unknown): boolean {
  const forbiddenTokens = new Set(["id", "email", "url", "payload", "document", "resume", "cover", "error", "message", "content"]);
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
  const email = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
  const url = /https?:\/\//i;
  const visit = (item: unknown, path = ""): boolean => {
    if (typeof item === "string") return uuid.test(item) || email.test(item) || url.test(item);
    if (Array.isArray(item)) return item.some((nested) => visit(nested, path));
    if (!item || typeof item !== "object") return false;
    return Object.entries(item).some(([key, nested]) => {
      const nextPath = path ? `${path}.${key}` : key;
      const tokens = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split("_");
      const allowedBooleanEmail = nextPath === "readiness.email" && typeof nested === "boolean";
      return (!allowedBooleanEmail && tokens.some((token) => forbiddenTokens.has(token))) || visit(nested, nextPath);
    });
  };
  return visit(value);
}

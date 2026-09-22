import { validRawSourceEvidence } from "./raw-source-evidence";
import "server-only";

import { createHash } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSourceAdapter, resumableAdapterVersion } from "./adapters";
import type { JobEnumerationResult, RuntimeSourceAuthorization } from "./adapters";
import { normalizeJob } from "./normalize";
import { getSource } from "./source-registry";
import type { RawJobPosting, SourceDefinition } from "./types";
import { resumeSourceCheckpoint } from "./source-checkpoint";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export type SourceScheduledJob = {
  id: string;
  reference_id: string;
  attempts: number;
  created_at: string;
  lease_epoch: number;
  source_generation: number | null;
};

type SourceSchedule = {
  id: string;
  source_id: string;
  source_authorization_id: string;
  authorization_head_revision: number;
  scope_sha256: string;
  result_bound: number;
  page_bound: number;
  request_bound: number;
  response_byte_bound: number;
  duration_ms_bound: number;
  host_concurrency_bound: number;
  quota_unit_bound: number;
  minimum_complete_misses: number;
  visibility_window_seconds: number;
  enabled: boolean;
  paused_reason: string | null;
};

type SourceAuthorizationRow = {
  id: string;
  source_id: string;
  state: RuntimeSourceAuthorization["state"];
  access_method: string;
  authorization_version: string;
  allowed_actions: string[];
  allowed_hosts: string[];
  rate_and_result_bounds: unknown;
};

type SourceContext = {
  schedule: SourceSchedule;
  authorization: RuntimeSourceAuthorization;
  authorizationRow: SourceAuthorizationRow;
  source: SourceDefinition;
};

export class SourceCollectionError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterSeconds: number | null = null,
    readonly retryable = false,
  ) {
    super(code);
  }
}

export async function runScheduledSourceCollection(
  admin: AdminClient,
  job: SourceScheduledJob,
  owner: string,
) {
  const replay = await admin.from("job_source_runs")
    .select("id")
    .eq("scheduled_job_id", job.id)
    .eq("status", "succeeded")
    .eq("enumeration_status", "complete")
    .not("closure_reconciled_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (replay.error) throw replay.error;
  if (replay.data) return { runId: replay.data.id, replayed: true, observed: 0 };

  const context = await loadSourceContext(admin, job);
  const previous = await admin.from("job_source_runs")
    .select("checkpoint_end,scope_sha256,adapter_version,response_classification,enumeration_status")
    .eq("scheduled_job_id", job.id).order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (previous.error) throw previous.error;
  // Only bounded successful pages may resume. Errors restart rather than trusting
  // a cursor whose final page may not have been completely recorded.
  const checkpoint = resumeSourceCheckpoint(previous.data, context.schedule.scope_sha256,
    resumableAdapterVersion(context.source.adapterKind));
  const { data: run, error: runError } = await admin.from("job_source_runs").insert({
    source_id: context.source.id,
    status: "started",
    schedule_id: context.schedule.id,
    scheduled_job_id: job.id,
    source_authorization_id: context.authorization.id,
    authorization_head_revision: context.schedule.authorization_head_revision,
    schedule_generation: job.source_generation,
    scope_sha256: context.schedule.scope_sha256,
    attempt_number: job.attempts,
    trigger_kind: "scheduled",
    closure_minimum_complete_misses: context.schedule.minimum_complete_misses,
    closure_visibility_window_seconds: context.schedule.visibility_window_seconds,
    projection_status: "observation_only",
    checkpoint_start: checkpoint ? { cursor: checkpoint, closureEligible: false } : null,
  }).select("id").single();
  if (runError || !run) throw runError || new Error("job_source_run_not_recorded");

  const adapter = createSourceAdapter(context.source.id, context.authorization);
  const collectionDeadlineMs = Date.now() + context.schedule.duration_ms_bound;
  const result = await adapter.enumerateJobs({
    checkpoint,
    resultBound: context.schedule.result_bound,
    pageBound: context.schedule.page_bound,
    requestBound: context.schedule.request_bound,
    maximumResponseBytes: context.schedule.response_byte_bound,
    requestTimeoutMs: context.schedule.duration_ms_bound,
    deadlineAtMs: collectionDeadlineMs,
    beforeRequest: async () => {
      const renewal = await admin.rpc("ap_renew_job_source_sync_lease", {
        p_job_id: job.id,
        p_owner: owner,
        p_lease_epoch: job.lease_epoch,
      });
      if (renewal.error) throw new SourceCollectionError("job_source_lease_mismatch", null, false);
      await assertSourceContextCurrent(admin, job, context, owner);
    },
  });

  await assertSourceContextCurrent(admin, job, context, owner);
  const evidenceRpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
  const archived = await evidenceRpc("ap_archive_source_attempt", { p_run_id: run.id,
    p_adapter_version: result.adapterVersion, p_postings: result.jobs.map(serializablePosting) });
  if (archived.error) throw archived.error;

  if (result.completion !== "complete") {
    await assertSourceContextCurrent(admin, job, context, owner);
    await preservePartialObservations(admin, run.id, result);
    await recordTerminalFailure(admin, run.id, result);
    throw new SourceCollectionError(
      result.errors[0]?.code || "source_enumeration_partial",
      result.errors[0]?.retryAfterSeconds || null,
      result.responseClassification === "bounded_partial" && Boolean(result.checkpoint.cursor)
        || result.errors[0]?.retryable || false,
    );
  }

  const normalized = result.jobs.map((posting) => normalizeJob(posting));
  const listingKeys = normalized.map((posting) => sourceListingKey(posting.externalJobId, posting.normalizedSourceUrl));
  const isAuthoritative = result.jobs.every((posting) => validRawSourceEvidence(posting.rawSourceEvidence, result.adapterVersion))
    && result.counts.received === result.jobs.length
    && result.counts.mapped === result.jobs.length
    && result.counts.rejected === 0
    && normalized.every((posting) => posting.isActive && !posting.rejectionReason && /^[0-9a-f]{64}$/.test(posting.contentHash))
    && listingKeys.every((key): key is string => Boolean(key))
    && new Set(listingKeys).size === listingKeys.length
    && result.counts.pagesCompleted <= context.schedule.page_bound
    && result.counts.pagesRequested <= context.schedule.request_bound;
  if (!isAuthoritative) {
    const downgraded: JobEnumerationResult = {
      ...result,
      completion: "partial",
      responseClassification: "invalid_payload",
      checkpoint: { ...result.checkpoint, stopReason: "OBSERVATION_LEDGER_INCOMPLETE" },
      errors: [{
        code: "source_observation_ledger_incomplete",
        category: "payload",
        message: "The complete response could not be represented as a one-to-one observation ledger.",
        retryable: false,
        httpStatus: null,
        retryAfterSeconds: null,
      }],
    };
    await recordTerminalFailure(admin, run.id, downgraded);
    throw new SourceCollectionError("source_observation_ledger_incomplete", null, false);
  }

  await assertSourceContextCurrent(admin, job, context, owner);
  const observations = normalized.map((posting, index) => ({
    run_id: run.id,
    listing_key: listingKeys[index]!,
    job_id: null,
    source_reference_id: null,
    job_snapshot_id: null,
    captured_listing: serializablePosting(result.jobs[index]),
    content_sha256: posting.contentHash,
    observed_at: posting.lastVerifiedAt,
  }));
  if (observations.length) {
    const inserted = await admin.from("job_source_run_listings").insert(observations);
    if (inserted.error) throw inserted.error;
  }

  const completedAt = new Date().toISOString();
  const terminal = await admin.from("job_source_runs").update({
    status: "succeeded",
    completed_at: completedAt,
    fetched_count: result.counts.received,
    accepted_count: result.jobs.length,
    rejected_count: 0,
    parsed_count: normalized.length,
    persisted_count: 0,
    verified_count: 0,
    adapter_version: result.adapterVersion,
    enumeration_status: "complete",
    response_classification: result.responseClassification,
    checkpoint_end: result.checkpoint,
    pages_requested: result.counts.pagesRequested,
    pages_completed: result.counts.pagesCompleted,
    quota_units: 0,
    retry_after_seconds: null,
    error_code: null,
    error_message: null,
    error_metadata: [],
  }).eq("id", run.id).eq("status", "started");
  if (terminal.error) throw terminal.error;

  const finalized = await admin.rpc("ap_finalize_job_source_run", {
    p_run_id: run.id,
    p_owner: owner,
    p_lease_epoch: job.lease_epoch,
  });
  if (finalized.error) throw finalized.error;

  await admin.from("job_sources").update({
    health_status: "healthy",
    last_health_checked_at: completedAt,
    updated_at: completedAt,
  }).eq("id", context.source.id);
  return { runId: run.id, replayed: false, observed: observations.length };
}

async function preservePartialObservations(admin: AdminClient, runId: string, result: JobEnumerationResult) {
  const observations = new Map<string, Record<string, unknown>>();
  for (const posting of result.jobs) {
    if (!validRawSourceEvidence(posting.rawSourceEvidence, result.adapterVersion)) continue;
    const normalized = normalizeJob(posting);
    const key = sourceListingKey(normalized.externalJobId, normalized.normalizedSourceUrl);
    if (!key) continue;
    // Repeated IDs never establish authoritative complete enumeration.
    if (observations.has(key)) continue;
    observations.set(key, { run_id: runId, listing_key: key, job_id: null,
      source_reference_id: null, job_snapshot_id: null,
      captured_listing: serializablePosting(posting), content_sha256: normalized.contentHash,
      observed_at: normalized.lastVerifiedAt });
  }
  if (observations.size) {
    const inserted = await admin.from("job_source_run_listings").insert([...observations.values()]);
    if (inserted.error) throw inserted.error;
  }
}

async function recordTerminalFailure(admin: AdminClient, runId: string, result: JobEnumerationResult) {
  const completedAt = new Date().toISOString();
  const first = result.errors[0];
  const status = result.completion === "partial"
    ? "partial"
    : result.responseClassification === "rate_limited" ? "rate_limited" : "failed";
  const update = await admin.from("job_source_runs").update({
    status,
    completed_at: completedAt,
    fetched_count: result.counts.received,
    accepted_count: 0,
    rejected_count: result.counts.rejected,
    parsed_count: result.counts.mapped,
    persisted_count: 0,
    verified_count: 0,
    adapter_version: result.adapterVersion,
    enumeration_status: result.completion,
    response_classification: result.responseClassification,
    checkpoint_end: result.checkpoint,
    pages_requested: result.counts.pagesRequested,
    pages_completed: result.counts.pagesCompleted,
    quota_units: 0,
    retry_after_seconds: first?.retryAfterSeconds || null,
    error_code: sanitizedCode(first?.code || "source_enumeration_failed"),
    error_message: null,
    error_metadata: result.errors.map((error) => ({
      code: sanitizedCode(error.code),
      category: error.category,
      httpStatus: error.httpStatus,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    })),
  }).eq("id", runId).eq("status", "started");
  if (update.error) throw update.error;
}

async function loadSourceContext(admin: AdminClient, job: SourceScheduledJob): Promise<SourceContext> {
  if (!job.source_generation || job.lease_epoch < 1) throw new SourceCollectionError("job_source_schedule_generation_missing");
  const { data: schedule, error: scheduleError } = await admin.from("job_source_schedules")
    .select("id,source_id,source_authorization_id,authorization_head_revision,scope_sha256,result_bound,page_bound,request_bound,response_byte_bound,duration_ms_bound,host_concurrency_bound,quota_unit_bound,minimum_complete_misses,visibility_window_seconds,enabled,paused_reason")
    .eq("id", job.reference_id).maybeSingle();
  if (scheduleError || !schedule) throw scheduleError || new SourceCollectionError("job_source_schedule_missing");
  const [{ data: sourceRow, error: sourceError }, { data: head, error: headError }, { data: authorization, error: authorizationError }] = await Promise.all([
    admin.from("job_sources").select("id,adapter_kind,adapter_key,ats_platform,ats_tenant_identifier,is_active").eq("id", schedule.source_id).maybeSingle(),
    admin.from("ap_source_authorization_heads").select("source_id,current_authorization_id,revision").eq("source_id", schedule.source_id).maybeSingle(),
    admin.from("ap_source_authorizations").select("id,source_id,state,access_method,authorization_version,allowed_actions,allowed_hosts,rate_and_result_bounds").eq("id", schedule.source_authorization_id).maybeSingle(),
  ]);
  if (sourceError || headError || authorizationError || !sourceRow || !head || !authorization) {
    throw sourceError || headError || authorizationError || new SourceCollectionError("job_source_authority_missing");
  }
  const registered = getSource(schedule.source_id);
  if (
    !registered
    || !sourceRow.is_active
    || sourceRow.adapter_kind !== registered.adapterKind
    || (sourceRow.adapter_key || null) !== (registered.adapterKey || null)
    || (sourceRow.ats_platform || null) !== (registered.atsPlatform || null)
    || (sourceRow.ats_tenant_identifier || null) !== (registered.atsTenantIdentifier || null)
  ) throw new SourceCollectionError("job_source_registry_drift");
  const authorizationRow = authorization as SourceAuthorizationRow;
  const runtimeAuthorization = toRuntimeAuthorization(authorizationRow);
  const context = { schedule: schedule as SourceSchedule, authorization: runtimeAuthorization, authorizationRow, source: registered };
  assertContextValues(job, context, head);
  return context;
}

async function assertSourceContextCurrent(admin: AdminClient, job: SourceScheduledJob, context: SourceContext, owner: string) {
  const [{ data: schedule }, { data: head }, { data: authorization }, { data: scheduled }] = await Promise.all([
    admin.from("job_source_schedules").select("enabled,paused_reason,source_authorization_id,authorization_head_revision,scope_sha256,result_bound,page_bound,request_bound,response_byte_bound,duration_ms_bound,host_concurrency_bound,quota_unit_bound").eq("id", context.schedule.id).maybeSingle(),
    admin.from("ap_source_authorization_heads").select("current_authorization_id,revision").eq("source_id", context.source.id).maybeSingle(),
    admin.from("ap_source_authorizations").select("state,access_method,allowed_actions,allowed_hosts,rate_and_result_bounds").eq("id", context.authorization.id).maybeSingle(),
    admin.from("ap_scheduled_jobs").select("state,lease_owner,lease_epoch,lease_expires_at,source_generation").eq("id", job.id).maybeSingle(),
  ]);
  const authorizedBounds = authorizedCollectionBounds(authorization?.rate_and_result_bounds);
  if (
    !schedule?.enabled
    || schedule.paused_reason
    || schedule.source_authorization_id !== context.authorization.id
    || schedule.authorization_head_revision !== context.schedule.authorization_head_revision
    || schedule.scope_sha256 !== context.schedule.scope_sha256
    || head?.current_authorization_id !== context.authorization.id
    || head.revision !== context.schedule.authorization_head_revision
    || authorization?.state !== "AUTHORIZED_AUTOMATED"
    || authorization.access_method !== "AUTOMATED"
    || !authorization.allowed_actions?.includes("ENUMERATE_JOBS")
    || !authorization.allowed_hosts?.length
    || !authorizedBoundsCoverSchedule(authorizedBounds, context.schedule)
    || schedule.result_bound !== context.schedule.result_bound
    || schedule.page_bound !== context.schedule.page_bound
    || schedule.request_bound !== context.schedule.request_bound
    || schedule.response_byte_bound !== context.schedule.response_byte_bound
    || schedule.duration_ms_bound !== context.schedule.duration_ms_bound
    || schedule.host_concurrency_bound !== context.schedule.host_concurrency_bound
    || schedule.quota_unit_bound !== context.schedule.quota_unit_bound
    || scheduled?.state !== "LEASED"
    || scheduled.lease_owner !== owner
    || scheduled.lease_epoch !== job.lease_epoch
    || scheduled.source_generation !== job.source_generation
    || !scheduled.lease_expires_at
    || new Date(scheduled.lease_expires_at).getTime() <= Date.now()
  ) throw new SourceCollectionError("job_source_authority_or_lease_changed");
}

function assertContextValues(
  job: SourceScheduledJob,
  context: SourceContext,
  head: { current_authorization_id: string; revision: number },
) {
  const authorizedBounds = authorizedCollectionBounds(context.authorizationRow.rate_and_result_bounds);
  if (
    !context.schedule.enabled
    || context.schedule.paused_reason
    || context.schedule.source_authorization_id !== context.authorization.id
    || context.schedule.authorization_head_revision !== head.revision
    || head.current_authorization_id !== context.authorization.id
    || context.authorization.state !== "AUTHORIZED_AUTOMATED"
    || context.authorization.accessMethod !== "AUTOMATED"
    || !context.authorization.allowedActions.includes("ENUMERATE_JOBS")
    || context.authorization.allowedHosts.length === 0
    || !authorizedBoundsCoverSchedule(authorizedBounds, context.schedule)
    || sourceCollectionScopeSha256(context) !== context.schedule.scope_sha256
    || job.source_generation === null
  ) throw new SourceCollectionError("current_employer_source_authorization_required");
}

function toRuntimeAuthorization(row: SourceAuthorizationRow): RuntimeSourceAuthorization {
  return {
    id: row.id,
    sourceId: row.source_id,
    state: row.state,
    accessMethod: row.access_method,
    authorizationVersion: row.authorization_version,
    allowedActions: row.allowed_actions,
    allowedHosts: row.allowed_hosts,
  };
}

export function sourceCollectionScopeSha256(context: Pick<SourceContext, "schedule" | "authorization" | "source">) {
  const canonical = JSON.stringify({
    sourceId: context.source.id,
    adapterKind: context.source.adapterKind,
    adapterKey: context.source.adapterKey || null,
    atsPlatform: context.source.atsPlatform || null,
    atsTenantIdentifier: context.source.atsTenantIdentifier || null,
    authorizationId: context.authorization.id,
    authorizationVersion: context.authorization.authorizationVersion,
    allowedHosts: [...context.authorization.allowedHosts].map((host) => host.toLowerCase()).sort(),
    resultBound: context.schedule.result_bound,
    pageBound: context.schedule.page_bound,
    requestBound: context.schedule.request_bound,
    responseByteBound: context.schedule.response_byte_bound,
    durationMsBound: context.schedule.duration_ms_bound,
    hostConcurrencyBound: context.schedule.host_concurrency_bound,
    quotaUnitBound: context.schedule.quota_unit_bound,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

type AuthorizedCollectionBounds = {
  resultBound: number;
  pageBound: number;
  requestBound: number;
  responseByteBound: number;
  durationMsBound: number;
  hostConcurrencyBound: number;
  quotaUnitBound: number;
};

function authorizedCollectionBounds(value: unknown): AuthorizedCollectionBounds | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const bounds: AuthorizedCollectionBounds = {
    resultBound: Number(input.resultBound),
    pageBound: Number(input.pageBound),
    requestBound: Number(input.requestBound),
    responseByteBound: Number(input.responseByteBound),
    durationMsBound: Number(input.durationMsBound),
    hostConcurrencyBound: Number(input.hostConcurrencyBound),
    quotaUnitBound: Number(input.quotaUnitBound),
  };
  return [bounds.resultBound, bounds.pageBound, bounds.requestBound, bounds.responseByteBound, bounds.durationMsBound, bounds.hostConcurrencyBound]
      .every((bound) => Number.isInteger(bound) && bound > 0)
    && Number.isInteger(bounds.quotaUnitBound) && bounds.quotaUnitBound >= 0 ? bounds : null;
}

function authorizedBoundsCoverSchedule(bounds: AuthorizedCollectionBounds | null, schedule: SourceSchedule) {
  return Boolean(bounds
    && bounds.resultBound >= schedule.result_bound
    && bounds.pageBound >= schedule.page_bound
    && bounds.requestBound >= schedule.request_bound
    && bounds.responseByteBound >= schedule.response_byte_bound
    && bounds.durationMsBound >= schedule.duration_ms_bound
    && bounds.hostConcurrencyBound >= schedule.host_concurrency_bound
    && bounds.quotaUnitBound >= schedule.quota_unit_bound
    && schedule.host_concurrency_bound === 1
    && schedule.quota_unit_bound === 0);
}

function sourceListingKey(externalJobId: string | null, normalizedSourceUrl: string | null) {
  if (externalJobId) return `id:${externalJobId}`;
  return normalizedSourceUrl ? `url:${normalizedSourceUrl}` : null;
}

function serializablePosting(posting: RawJobPosting): Record<string, unknown> {
  return JSON.parse(JSON.stringify(posting)) as Record<string, unknown>;
}

function sanitizedCode(value: string) {
  const code = value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return (code || "source_collection_failed").slice(0, 100);
}

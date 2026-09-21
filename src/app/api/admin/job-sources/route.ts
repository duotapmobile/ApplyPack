import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSourceAdapter } from "@/lib/jobs/adapters";
import type { RuntimeSourceAuthorization } from "@/lib/jobs/adapters";
import { affiliateDirectories, getSource, jobSources } from "@/lib/jobs/source-registry";
import { isSameOriginRequest } from "@/lib/security/origin";

export const dynamic = "force-dynamic";

const schema = z.object({
  sourceId: z.string().trim().min(1).max(100),
  action: z.enum(["health", "sync", "pause", "resume"]),
  expectedStateRevision: z.number().int().positive().optional(),
  reasonCode: z.enum(["MANUAL_PAUSE", "INCIDENT", "RATE_LIMIT", "SCHEMA_DRIFT", "AUTHORIZATION_REVIEW", "RESUME_AFTER_REVIEW"]).optional(),
});

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const results = await Promise.all([
    auth.admin.from("job_sources").select("id,health_status,last_health_checked_at,last_successful_sync_at"),
    auth.admin.from("job_source_schedules")
      .select("id,source_id,schedule_tier,enabled,next_run_at,last_enqueued_at,last_started_at,last_completed_at,consecutive_failures,paused_reason,result_bound,page_bound,request_bound,response_byte_bound,duration_ms_bound,host_concurrency_bound,quota_unit_bound,state_revision"),
    auth.admin.from("job_source_runs")
      .select("id,source_id,status,enumeration_status,response_classification,projection_status,started_at,completed_at,fetched_count,accepted_count,persisted_count,verified_count,quota_units,error_code")
      .neq("trigger_kind", "legacy").order("started_at", { ascending: false }).limit(100),
    auth.admin.from("ap_source_authorization_heads").select("source_id,current_authorization_id,revision"),
    auth.admin.from("ap_source_authorizations").select("id,source_id,state,access_method,authorization_version,allowed_actions,allowed_hosts,verified_at"),
    auth.admin.from("job_source_candidates").select("status,quarantine_reason").limit(1000),
  ]);
  if (results.some((result) => result.error)) {
    return NextResponse.json({ error: "Source operations data is unavailable. Check database migrations and connectivity." },
      { status: 503, headers: { "cache-control": "no-store, private" } });
  }
  const [{ data: health }, { data: schedules }, { data: runs }, { data: heads }, { data: authorizations }, { data: candidates }] = results;
  const byId = new Map((health || []).map((row) => [row.id, row]));
  const scheduleBySource = new Map((schedules || []).map((row) => [row.source_id, row]));
  const headBySource = new Map((heads || []).map((row) => [row.source_id, row]));
  const authorizationById = new Map((authorizations || []).map((row) => [row.id, row]));
  const candidateSummary = (candidates || []).reduce<Record<string, number>>((summary, candidate) => {
    const key = candidate.status === "QUARANTINED" && candidate.quarantine_reason
      ? `QUARANTINED:${candidate.quarantine_reason}` : candidate.status;
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
  return NextResponse.json({
    sources: jobSources.map((source) => {
      const head = headBySource.get(source.id);
      return {
        ...source,
        health: byId.get(source.id) || null,
        schedule: scheduleBySource.get(source.id) || null,
        policy: head ? { headRevision: head.revision, authorization: authorizationById.get(head.current_authorization_id) || null } : null,
      };
    }),
    affiliateDirectories,
    recentRuns: runs || [],
    candidateSummary,
  }, { headers: { "cache-control": "no-store, private" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This source request was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a registered source and action." }, { status: 400 });
  const source = getSource(parsed.data.sourceId);
  if (!source || !source.isActive) return NextResponse.json({ error: "Unknown or inactive source." }, { status: 404 });
  const { data: schedule } = await auth.admin.from("job_source_schedules")
    .select("id,source_authorization_id,authorization_head_revision,enabled,paused_reason,state_revision")
    .eq("source_id", source.id).maybeSingle();
  if (!schedule) {
    if (parsed.data.action === "health") return NextResponse.json({
      health: {
        sourceId: source.id,
        status: "disabled",
        checkedAt: new Date().toISOString(),
        httpStatus: null,
        message: "No reviewed employer-specific source schedule is configured.",
      },
    });
    return NextResponse.json({ error: "A reviewed employer-specific source schedule is required." }, { status: 409 });
  }
  if (parsed.data.action === "pause" || parsed.data.action === "resume") {
    const expectedRevision = parsed.data.expectedStateRevision;
    const reasonCode = parsed.data.reasonCode;
    const reasonMatches = parsed.data.action === "resume"
      ? reasonCode === "RESUME_AFTER_REVIEW"
      : Boolean(reasonCode && reasonCode !== "RESUME_AFTER_REVIEW");
    if (!expectedRevision || !reasonCode || !reasonMatches) {
      return NextResponse.json({ error: "A current schedule revision and valid reason code are required." }, { status: 400 });
    }
    const changed = await auth.admin.rpc("ap_set_job_source_schedule_state", {
      p_schedule_id: schedule.id,
      p_enabled: parsed.data.action === "resume",
      p_expected_state_revision: expectedRevision,
      p_reason_code: reasonCode,
      p_actor_id: auth.user.id,
    });
    if (changed.error || !changed.data) {
      return NextResponse.json({ error: "The schedule state changed or current authorization does not permit this action." }, { status: 409 });
    }
    return NextResponse.json({ sourceId: source.id, enabled: parsed.data.action === "resume", stateRevision: changed.data });
  }
  if (parsed.data.action === "sync") {
    if (process.env.APP_JOB_SOURCE_SYNC_ENABLED !== "true") {
      return NextResponse.json({ error: "Automated source synchronization is disabled by configuration." }, { status: 409 });
    }
    const requestKey = request.headers.get("idempotency-key")?.trim();
    if (!requestKey || requestKey.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(requestKey)) {
      return NextResponse.json({ error: "A valid Idempotency-Key header is required." }, { status: 400 });
    }
    const queued = await auth.admin.rpc("ap_enqueue_job_source_sync", {
      p_schedule_id: schedule.id,
      p_request_key: requestKey,
    });
    if (queued.error || !queued.data) {
      return NextResponse.json({ error: "The source refresh could not be queued under the current authorization." }, { status: 409 });
    }
    return NextResponse.json({
      sourceId: source.id,
      scheduledJobId: queued.data,
      status: "queued",
    }, { status: 202 });
  }

  const [{ data: head }, { data: authorization }] = await Promise.all([
    auth.admin.from("ap_source_authorization_heads").select("current_authorization_id,revision").eq("source_id", source.id).maybeSingle(),
    auth.admin.from("ap_source_authorizations")
      .select("id,source_id,state,access_method,authorization_version,allowed_actions,allowed_hosts")
      .eq("id", schedule.source_authorization_id).maybeSingle(),
  ]);
  if (
    !head
    || !authorization
    || head.current_authorization_id !== authorization.id
    || head.revision !== schedule.authorization_head_revision
  ) return NextResponse.json({ error: "Current employer-specific source authorization is required." }, { status: 409 });
  const runtimeAuthorization: RuntimeSourceAuthorization = {
    id: authorization.id,
    sourceId: authorization.source_id,
    state: authorization.state as RuntimeSourceAuthorization["state"],
    accessMethod: authorization.access_method,
    authorizationVersion: authorization.authorization_version,
    allowedActions: authorization.allowed_actions,
    allowedHosts: authorization.allowed_hosts,
  };
  try {
    const health = await createSourceAdapter(source.id, runtimeAuthorization).healthCheck();
    await auth.admin.from("job_sources").update({
      health_status: health.status,
      last_health_checked_at: health.checkedAt,
      updated_at: health.checkedAt,
    }).eq("id", source.id);
    return NextResponse.json({ health });
  } catch {
    return NextResponse.json({ error: "The authorized source health check failed." }, { status: 502 });
  }
}

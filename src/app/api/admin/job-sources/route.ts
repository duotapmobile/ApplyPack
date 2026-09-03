import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createSourceAdapter } from "@/lib/jobs/adapters";
import { deduplicateJobs } from "@/lib/jobs/deduplicate";
import { normalizeJob } from "@/lib/jobs/normalize";
import { persistNormalizedJob } from "@/lib/jobs/persistence";
import { affiliateDirectories, getSource, jobSources } from "@/lib/jobs/source-registry";
import { isSameOriginRequest } from "@/lib/security/origin";

export const dynamic = "force-dynamic";

const schema = z.object({
  sourceId: z.string().trim().min(1).max(100),
  action: z.enum(["health", "sync"]),
});

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { data: health } = await auth.admin.from("job_sources").select("id,health_status,last_health_checked_at,last_successful_sync_at");
  const byId = new Map((health || []).map((row) => [row.id, row]));
  return NextResponse.json({
    sources: jobSources.map((source) => ({ ...source, health: byId.get(source.id) || null })),
    affiliateDirectories,
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
  const adapter = createSourceAdapter(source.id);
  const health = await adapter.healthCheck();
  await auth.admin.from("job_sources").update({
    health_status: health.status,
    last_health_checked_at: health.checkedAt,
    updated_at: health.checkedAt,
  }).eq("id", source.id);
  if (parsed.data.action === "health") return NextResponse.json({ health });
  if (process.env.APP_JOB_SOURCE_SYNC_ENABLED !== "true") {
    return NextResponse.json({ error: "Automated source synchronization is disabled by configuration.", health }, { status: 409 });
  }
  if (source.automationStatus !== "automated") {
    await auth.admin.from("job_source_runs").insert({ source_id: source.id, status: "link_only", completed_at: new Date().toISOString() });
    return NextResponse.json({ sourceId: source.id, status: "official_link_only", fetched: 0, accepted: 0 });
  }

  const { data: run, error: runError } = await auth.admin.from("job_source_runs").insert({ source_id: source.id, status: "started" }).select("id").single();
  if (runError || !run) return NextResponse.json({ error: "Source run could not be recorded." }, { status: 502 });
  try {
    const raw = await adapter.fetchJobs();
    const normalized = raw.map((job) => normalizeJob(job));
    const accepted = deduplicateJobs(normalized.filter((job) => !job.rejectionReason && job.isActive));
    const rejectedCount = normalized.length - accepted.length;
    const seenReferenceIds: string[] = [];
    for (const item of accepted) {
      const jobId = await persistNormalizedJob(auth.admin, item.job);
      seenReferenceIds.push(jobId);
    }
    await deactivateMissingSourceReferences(auth.admin, source.id, new Set(seenReferenceIds));
    const completedAt = new Date().toISOString();
    await auth.admin.from("job_source_runs").update({
      status: "succeeded", completed_at: completedAt, fetched_count: raw.length,
      accepted_count: accepted.length, rejected_count: rejectedCount,
    }).eq("id", run.id);
    await auth.admin.from("job_sources").update({ health_status: "healthy", last_successful_sync_at: completedAt, updated_at: completedAt }).eq("id", source.id);
    return NextResponse.json({ sourceId: source.id, status: "succeeded", fetched: raw.length, accepted: accepted.length, rejected: rejectedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Source synchronization failed.";
    await auth.admin.from("job_source_runs").update({ status: message.includes("rate limit") ? "rate_limited" : "failed", completed_at: new Date().toISOString(), error_code: "source_sync_failed", error_message: message }).eq("id", run.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function deactivateMissingSourceReferences(admin: SupabaseClient, sourceId: string, seenJobIds: Set<string>) {
  const { data: references, error } = await admin.from("job_source_references").select("id,job_id").eq("source_id", sourceId).eq("is_active", true);
  if (error) throw error;
  for (const reference of references || []) {
    if (seenJobIds.has(reference.job_id)) continue;
    const checkedAt = new Date().toISOString();
    const { error: updateError } = await admin.from("job_source_references").update({ is_active: false, last_verified_at: checkedAt }).eq("id", reference.id);
    if (updateError) throw updateError;
    const { count } = await admin.from("job_source_references").select("id", { count: "exact", head: true }).eq("job_id", reference.job_id).eq("is_active", true);
    if (!count) await admin.from("jobs").update({ is_active: false, listing_status: "closed", source_freshness_status: "stale" }).eq("id", reference.job_id);
  }
}

import "server-only";
import { z } from "zod";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeJob } from "@/lib/jobs/normalize";
import type { RawJobPosting } from "@/lib/jobs/types";
import { preparationStates } from "./research-preparation";
import { parseListingRequirements } from "./listing-parser";

type Admin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
export type PreparedListing = { projectionId: string; company: string; title: string; listingUrl: string;
  applicationUrl: string; capturedText: string; observedAt: string; admitted: boolean; parserReviewRequired: boolean };
export const preparedSourceStates = ["WAITING", "COMPLETE", "EMPTY", "PARTIAL", "FAILED", "RATE_LIMITED", "STALE", "SOURCE_CHANGED", "DISABLED"] as const;
export type PreparedSource = { id: string; state: typeof preparedSourceStates[number]; observedCount: number | null };
export type PreparationReview = { preparationId: string | null; state: string; reason: string | null; current: boolean; listings: PreparedListing[]; sources: PreparedSource[] };
function ensure(value: unknown): asserts value { if (!value) throw new Error("research_review_unavailable"); }

const runSchema = z.object({ status: z.enum(["started", "succeeded", "partial", "failed", "rate_limited", "link_only"]), enumeration_status: z.string().nullable(),
  completed_at: z.iso.datetime({ offset: true }).nullable(), fetched_count: z.number().int().min(0), checkpoint_start: z.unknown() }).strict();
export function preparedSourceOutcome(raw: unknown, now = new Date()): Pick<PreparedSource, "state" | "observedCount"> {
  if (raw === null) return { state: "WAITING", observedCount: null };
  const run = runSchema.parse(raw), completed = run.completed_at ? Date.parse(run.completed_at) : null;
  if (completed !== null && (completed > now.getTime() || completed < now.getTime() - 86_400_000)) return { state: "STALE", observedCount: run.fetched_count };
  if (run.status === "started") return { state: "WAITING", observedCount: run.fetched_count };
  if (run.status === "rate_limited") return { state: "RATE_LIMITED", observedCount: run.fetched_count };
  if (run.status === "failed") return { state: "FAILED", observedCount: run.fetched_count };
  if (run.status !== "succeeded" || run.enumeration_status !== "complete" || run.checkpoint_start !== null || completed === null) return { state: "PARTIAL", observedCount: run.fetched_count };
  return { state: run.fetched_count ? "COMPLETE" : "EMPTY", observedCount: run.fetched_count };
}

export async function loadPreparationReview(admin: Admin, snapshotId: string, signal?: AbortSignal): Promise<PreparationReview> {
  z.uuid().parse(snapshotId);
  const read = admin.from("ap_research_preparations").select("id,state,reason,plan_id").eq("snapshot_id", snapshotId);
  const result = await (signal ? read.abortSignal(signal) : read).maybeSingle();
  ensure(!result.error);
  if (!result.data) return { preparationId: null, state: "NOT_PREPARED", reason: null, current: false, listings: [], sources: [] };
  const prep = z.object({ id: z.uuid(), state: z.enum(preparationStates), reason: z.string().max(80).nullable(), plan_id: z.uuid().nullable() }).strict().parse(result.data);
  const currentQuery = admin.rpc("ap_research_snapshot_current", { p_snapshot_id: snapshotId });
  const current = await (signal ? currentQuery.abortSignal(signal) : currentQuery);
  ensure(!current.error && typeof current.data === "boolean");
  if (!current.data) return { preparationId: prep.id, state: "STALE", reason: "SNAPSHOT_CHANGED", current: false, listings: [], sources: [] };
  const sources = await admin.from("ap_research_preparation_sources").select("id,source_run_id,schedule_id,source_authorization_id,authorization_head_revision").eq("preparation_id", prep.id).limit(6);
  ensure(!sources.error);
  const bindings = z.array(z.object({ id: z.uuid(), source_run_id: z.uuid().nullable(), schedule_id: z.uuid(), source_authorization_id: z.uuid(), authorization_head_revision: z.number().int().positive() }).strict()).max(5).parse(sources.data);
  const progress: PreparedSource[] = [];
  for (const binding of bindings) {
    signal?.throwIfAborted();
    const schedule = await admin.from("job_source_schedules").select("source_id,source_authorization_id,authorization_head_revision,enabled,paused_reason").eq("id", binding.schedule_id).maybeSingle();
    ensure(!schedule.error && schedule.data);
    const head = await admin.from("ap_source_authorization_heads").select("current_authorization_id,revision").eq("source_id", schedule.data.source_id).maybeSingle();
    ensure(!head.error && head.data);
    if (schedule.data.source_authorization_id !== binding.source_authorization_id || schedule.data.authorization_head_revision !== binding.authorization_head_revision
      || head.data.current_authorization_id !== binding.source_authorization_id || head.data.revision !== binding.authorization_head_revision) {
      progress.push({ id: binding.id, state: "SOURCE_CHANGED", observedCount: null }); continue;
    }
    if (!schedule.data.enabled || schedule.data.paused_reason) { progress.push({ id: binding.id, state: "DISABLED", observedCount: null }); continue; }
    const query = admin.from("job_source_runs").select("status,enumeration_status,completed_at,fetched_count,checkpoint_start");
    const run = await (binding.source_run_id ? query.eq("id", binding.source_run_id) : query.eq("schedule_id", binding.schedule_id)
      .eq("source_authorization_id", binding.source_authorization_id).eq("authorization_head_revision", binding.authorization_head_revision)
      .order("started_at", { ascending: false }).limit(1)).maybeSingle();
    ensure(!run.error); progress.push({ id: binding.id, ...preparedSourceOutcome(run.data) });
  }
  const runIds = [...new Set(bindings.flatMap(row => row.source_run_id ? [row.source_run_id] : []))];
  if (!runIds.length) {
    const recheck = await admin.rpc("ap_research_snapshot_current", { p_snapshot_id: snapshotId });
    ensure(!recheck.error && recheck.data === true); signal?.throwIfAborted();
    return { preparationId: prep.id, state: prep.state, reason: prep.reason, current: true, listings: [], sources: progress };
  }
  const [projections, observations, plan] = await Promise.all([
    admin.from("job_source_listing_projections").select("id,run_id,listing_key").in("run_id", runIds).order("id").limit(101),
    admin.from("job_source_run_listings").select("run_id,listing_key,captured_listing,observed_at").in("run_id", runIds).limit(101),
    admin.from("ap_feasibility_coverage_plans").select("inventory_version_id").eq("id", prep.plan_id).maybeSingle(),
  ]);
  ensure(!projections.error && !observations.error && !plan.error && plan.data && projections.data && observations.data
    && projections.data.length <= 100 && observations.data.length <= 100);
  const members = await admin.from("ap_inventory_members").select("job_snapshot_id").eq("inventory_version_id", plan.data.inventory_version_id).limit(101);
  const verifications = projections.data.length ? await admin.from("ap_source_verifications").select("projection_id,job_snapshot_id")
    .in("projection_id", projections.data.map(row => row.id)).limit(101) : { data: [], error: null };
  ensure(!members.error && !verifications.error && members.data && verifications.data && members.data.length <= 100 && verifications.data.length <= 100);
  const admitted = new Set(verifications.data.filter(row => members.data.some(member => member.job_snapshot_id === row.job_snapshot_id)).map(row => row.projection_id));
  const listings = projections.data.map(projection => {
    const observation = observations.data.find(row => row.run_id === projection.run_id && row.listing_key === projection.listing_key);
    ensure(observation);
    const posting = observation.captured_listing as RawJobPosting, job = normalizeJob(posting);
    // Matching normalization deliberately flattens whitespace for hashing. The
    // reviewed source keeps its real line boundaries for evidence and parsing.
    const capturedText = typeof posting.description === "string" ? posting.description.normalize("NFKC").replace(/\0/gu, "").trim() : "";
    ensure(!job.rejectionReason && job.officialApplicationUrl && capturedText && capturedText.length <= 100_000);
    return { projectionId: z.uuid().parse(projection.id), company: job.employerDisplayName, title: job.rawTitle,
      listingUrl: z.url().startsWith("https://").parse(job.sourceJobUrl), applicationUrl: z.url().startsWith("https://").parse(job.officialApplicationUrl),
      capturedText, observedAt: z.iso.datetime({ offset: true }).parse(observation.observed_at), admitted: admitted.has(projection.id),
      parserReviewRequired: (() => { const parsed = parseListingRequirements({ jobSnapshotId: projection.id, listingText: capturedText }); return parsed.status !== "COMPLETE" || !parsed.criteria.length; })() };
  });
  // Currentness is checked again after reading customer-associated source data.
  const recheck = await admin.rpc("ap_research_snapshot_current", { p_snapshot_id: snapshotId });
  ensure(!recheck.error && recheck.data === true); signal?.throwIfAborted();
  return { preparationId: prep.id, state: prep.state, reason: prep.reason, current: true, listings, sources: progress };
}

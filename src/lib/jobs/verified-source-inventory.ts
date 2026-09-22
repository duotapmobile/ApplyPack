import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { LISTING_PARSER_VERSION, parseListingRequirements, requirementPersistenceRows } from "@/lib/matching/listing-parser";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { stableNormalizedJobId } from "@/lib/matching/deduplication";
import { normalizeJob, normalizeUrl } from "./normalize";
import { getEmployerSource } from "./source-registry";
import { validRawSourceEvidence } from "./raw-source-evidence";
import type { RawJobPosting } from "./types";
import { sourceCompensation, sourceFieldEvidence } from "./field-evidence";
import { toJobDatabaseRow } from "./persistence";

export const sourceVerificationSchema = z.object({
  projectionId: z.string().uuid(), snapshotId: z.string().uuid(),
  checkedAt: z.iso.datetime(), officialListingUrl: z.url().regex(/^https:\/\//u),
  officialApplicationUrl: z.url().regex(/^https:\/\//u), capturedText: z.string().min(1).max(100_000),
  evidenceNotes: z.string().trim().min(20).max(3000),
  employerIdentityConfirmed: z.literal(true), applicationPathConfirmed: z.literal(true),
  listingActiveConfirmed: z.literal(true), legitimacyConfirmed: z.literal(true),
  lifecycleAction: z.enum(["UNCHANGED", "CHANGED", "REOPENED"]).optional(),
  transitionReason: z.string().trim().min(20).max(3000).optional(),
}).strict();
export type SourceVerificationInput = z.infer<typeof sourceVerificationSchema>;
export const independentSourceVerificationSchema = sourceVerificationSchema.omit({ snapshotId: true });
export type IndependentSourceVerificationInput = z.infer<typeof independentSourceVerificationSchema>;
type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export function buildVerifiedSourceInventory(input: IndependentSourceVerificationInput, posting: RawJobPosting,
  binding: { jobId: string; observedAt: string; observedHash: string; adapterVersion: string }, now = new Date()) {
  if (!validRawSourceEvidence(posting.rawSourceEvidence, binding.adapterVersion)) throw new Error("source_verification_raw_evidence_invalid");
  if (input.lifecycleAction && input.lifecycleAction !== "UNCHANGED" && !input.transitionReason) {
    throw new Error("source_transition_reason_required");
  }
  const job = normalizeJob(posting, now);
  const checked = Date.parse(input.checkedAt);
  if (!Number.isFinite(checked) || checked > now.getTime() || checked < now.getTime() - 15 * 60_000
    || checked < Date.parse(binding.observedAt)) throw new Error("source_verification_time_invalid");
  const comparable = (value: string) => value.trim().replace(/\s+/g, " ");
  if (job.rejectionReason || !job.isActive || job.contentHash !== binding.observedHash
    || normalizeUrl(input.officialListingUrl) !== job.normalizedSourceUrl
    || normalizeUrl(input.officialApplicationUrl) !== job.officialApplicationUrl
    || !job.officialApplicationUrl || comparable(input.capturedText) !== comparable(job.description || "")) {
    throw new Error("source_verification_content_or_identity_changed");
  }
  const applicationHost = new URL(job.officialApplicationUrl).hostname;
  const atsHost = /(^|\.)(lever\.co|greenhouse\.io|ashbyhq\.com|recruitee\.com|teamtailor\.com)$/u.test(applicationHost);
  const officialUrl = getEmployerSource(job.canonicalEmployerId)?.officialUrl;
  const employerHost = officialUrl && !atsHost ? new URL(officialUrl).hostname : null;
  if (!atsHost && employerHost !== applicationHost) throw new Error("source_verification_application_host_unclassified");
  const jobSnapshotId = randomUUID();
  const parser = parseListingRequirements({ jobSnapshotId, listingText: input.capturedText });
  if (parser.status !== "COMPLETE" || !parser.criteria.length) throw new Error("source_verification_parser_review_required");
  const compensation = sourceCompensation(posting);
  const capturedListing = { text: input.capturedText, parserIssues: parser.issues, rawSourceEvidence: posting.rawSourceEvidence,
    fieldEvidence: sourceFieldEvidence(posting) };
  const review = { ...input, method: "HUMAN_DIRECT_OFFICIAL_REVIEW",
    captureSha256: createHash("sha256").update(input.capturedText, "utf8").digest("hex") };
  return { review, normalized: toJobDatabaseRow(job, compensation.text), stableJobId: stableNormalizedJobId(job), requirementNodes: requirementPersistenceRows(parser, input.capturedText),
    snapshot: { id: jobSnapshotId, legacy_job_id: binding.jobId, origin: "APPLYPACK_FOUND",
      discovery_source: job.sourceId, external_job_id: job.externalJobId,
      canonical_application_url: job.officialApplicationUrl, application_host_type: atsHost ? "APPROVED_THIRD_PARTY" : "EMPLOYER_HOSTED",
      canonical_employer_listing_url: job.sourceJobUrl, source_url: job.sourceJobUrl,
      company: job.employerDisplayName, exact_title: job.rawTitle, normalized_fingerprint: job.contentHash,
      captured_listing: capturedListing, retrieved_at: binding.observedAt, posted_on: job.postedAt?.slice(0, 10) ?? null,
      posted_date_unknown: !job.postedAt, live_verified_at: input.checkedAt,
      compensation_text: compensation.text, compensation_source: compensation.source,
      location_and_work_mode: { location: job.locationText, workMode: job.workMode },
      parser_version: LISTING_PARSER_VERSION, content_sha256: canonicalSha256(capturedListing),
      first_seen_at: binding.observedAt, canonical_employer_domain: employerHost,
      requirement_completeness: 100, compensation_completeness: compensation.completeness,
      canonicalization_version: "verified-source-inventory-v1", legacy_compatibility: false } };
}

export async function verifyIndependentSourceInventory(admin: AdminClient, actorId: string, input: IndependentSourceVerificationInput) {
  const { data: projection, error } = await admin.from("job_source_listing_projections")
    .select("id,run_id,listing_key,job_id").eq("id", input.projectionId).maybeSingle();
  if (error || !projection) throw new Error("source_projection_unavailable");
  const [observation, run] = await Promise.all([
    admin.from("job_source_run_listings").select("captured_listing,content_sha256,observed_at")
      .eq("run_id", projection.run_id).eq("listing_key", projection.listing_key).maybeSingle(),
    admin.from("job_source_runs").select("adapter_version,status,enumeration_status").eq("id", projection.run_id).maybeSingle(),
  ]);
  if (observation.error || run.error || !observation.data || !run.data?.adapter_version
    || run.data.status !== "succeeded" || run.data.enumeration_status !== "complete") {
    throw new Error("source_verification_run_unavailable");
  }
  const built = buildVerifiedSourceInventory(input, observation.data.captured_listing as unknown as RawJobPosting,
    { jobId: projection.job_id, observedAt: observation.data.observed_at,
      observedHash: observation.data.content_sha256, adapterVersion: run.data.adapter_version });
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: unknown }>;
  const result = await rpc("ap_verify_source_observation", { p_projection_id: input.projectionId, p_actor_id: actorId,
    p_review: built.review, p_stable_job_id: built.stableJobId, p_job_snapshot: built.snapshot,
    p_requirement_nodes: built.requirementNodes, p_normalized: built.normalized });
  if (result.error || !result.data) throw new Error("source_independent_verification_rejected");
  return { jobSnapshotId: result.data, stableNormalizedJobId: built.stableJobId, runId: projection.run_id,
    customerVisible: false, nextStep: "ADMIT_SNAPSHOT_SEPARATELY_AND_RECONCILE_ONLY_AFTER_COMPLETE_RUN_REVIEW" };
}

export async function promoteVerifiedSourceInventory(admin: AdminClient, actorId: string, input: SourceVerificationInput) {
  const { data: projection, error: projectionError } = await admin.from("job_source_listing_projections")
    .select("id,run_id,listing_key,job_id").eq("id", input.projectionId).maybeSingle();
  if (projectionError || !projection) throw new Error("source_projection_unavailable");
  const [{ data: observation, error: observationError }, { data: run, error: runError }, { data: plan, error: planError }] = await Promise.all([
    admin.from("job_source_run_listings").select("captured_listing,content_sha256,observed_at")
      .eq("run_id", projection.run_id).eq("listing_key", projection.listing_key).maybeSingle(),
    admin.from("job_source_runs").select("adapter_version,status,enumeration_status").eq("id", projection.run_id).maybeSingle(),
    admin.from("ap_feasibility_coverage_plans").select("inventory_version_id").eq("snapshot_id", input.snapshotId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (observationError || runError || planError || !observation || !plan || !run?.adapter_version
    || run.status !== "succeeded" || run.enumeration_status !== "complete") throw new Error("source_verification_inventory_or_run_unavailable");
  const built = buildVerifiedSourceInventory(input, observation.captured_listing as unknown as RawJobPosting,
    { jobId: projection.job_id, observedAt: observation.observed_at, observedHash: observation.content_sha256, adapterVersion: run.adapter_version });
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: unknown }>;
  const result = await rpc("ap_promote_verified_source_inventory", {
    p_projection_id: input.projectionId, p_actor_id: actorId, p_criteria_snapshot_id: input.snapshotId,
    p_inventory_version_id: plan.inventory_version_id, p_review: built.review,
    p_stable_job_id: built.stableJobId, p_job_snapshot: built.snapshot, p_requirement_nodes: built.requirementNodes,
  });
  if (result.error || !result.data) throw new Error("source_verification_promotion_rejected");
  // These are the existing review/evaluation route's immutable identifiers;
  // no score, customer admission or human Top 10 release is manufactured here.
  const { data: member, error } = await admin.from("ap_inventory_members").select("id,job_snapshot_id")
    .eq("id", result.data).maybeSingle();
  if (error || !member) throw new Error("source_verified_member_unavailable");
  return { inventoryMemberId: member.id, jobSnapshotId: member.job_snapshot_id, snapshotId: input.snapshotId,
    nextStep: "RECORD_HUMAN_EVIDENCE_REVIEWS_THEN_POST_ADMIN_MATCHING_EVALUATIONS" };
}

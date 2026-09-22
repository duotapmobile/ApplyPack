import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { captureRawSourceEvidence } from "./raw-source-evidence";
import { normalizeJob } from "./normalize";
import { buildVerifiedSourceInventory, independentSourceVerificationSchema } from "./verified-source-inventory";
import type { RawJobPosting } from "./types";

export const MANUAL_SOURCE_CAPTURE_VERSION = "human-official-transcription-v1";
export const manualSourceObservationSchema = z.object({
  observationId: z.string().uuid(),
  posting: z.object({
    sourceId: z.string().trim().min(1).max(100), employerName: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(500), externalJobId: z.string().trim().min(1).max(300).nullable(),
    location: z.string().trim().max(1000).nullable().optional(),
    employmentType: z.string().trim().max(200).nullable().optional(),
    salaryMin: z.number().nonnegative().nullable().optional(), salaryMax: z.number().nonnegative().nullable().optional(),
    salaryCurrency: z.string().regex(/^[A-Z]{3}$/u).nullable().optional(),
    payPeriod: z.enum(["hour", "day", "week", "month", "year", "unknown"]).nullable().optional(),
    eligibleStates: z.array(z.string().trim().min(1).max(100)).max(60).optional(),
    eligibleCountries: z.array(z.string().trim().min(1).max(100)).max(250).optional(),
    closingAt: z.iso.datetime().nullable().optional(),
  }).strict(),
  review: independentSourceVerificationSchema.omit({ projectionId: true }).extend({
    transitionReason: z.string().trim().min(20).max(3000),
  }).strict(),
}).strict();
export type ManualSourceObservationInput = z.infer<typeof manualSourceObservationSchema>;

export function buildManualSourceInventory(input: ManualSourceObservationInput, now = new Date()) {
  const captured = { method: "HUMAN_DIRECT_OFFICIAL_TRANSCRIPTION", ...input.posting,
    sourceJobUrl: input.review.officialListingUrl, officialApplicationUrl: input.review.officialApplicationUrl,
    description: input.review.capturedText, observedAt: input.review.checkedAt };
  const posting: RawJobPosting = { ...input.posting, sourceJobUrl: captured.sourceJobUrl,
    officialApplicationUrl: captured.officialApplicationUrl, description: captured.description,
    lastVerifiedAt: input.review.checkedAt,
    rawSourceEvidence: captureRawSourceEvidence(MANUAL_SOURCE_CAPTURE_VERSION, captured) };
  const normalized = normalizeJob(posting, now);
  const built = buildVerifiedSourceInventory({ ...input.review, projectionId: input.observationId }, posting,
    { jobId: randomUUID(), observedAt: input.review.checkedAt, observedHash: normalized.contentHash,
      adapterVersion: MANUAL_SOURCE_CAPTURE_VERSION }, now);
  for (const field of Object.values(built.snapshot.captured_listing.fieldEvidence)) {
    if (field.method === "PROVIDER_STRUCTURED_FIELD") field.method = "HUMAN_DIRECT_OFFICIAL_TRANSCRIPTION";
  }
  // Keep the snapshot digest bound to the corrected, explicitly human provenance.
  built.snapshot.content_sha256 = canonicalSha256(built.snapshot.captured_listing);
  return { ...built, posting };
}

export async function recordManualSourceInventory(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  actorId: string, input: ManualSourceObservationInput) {
  const built = buildManualSourceInventory(input);
  const { projectionId: _projectionId, ...review } = built.review;
  void _projectionId;
  const rpc = admin.rpc.bind(admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: unknown }>;
  const result = await rpc("ap_verify_manual_source_observation", { p_observation_id: input.observationId,
    p_actor_id: actorId, p_source_id: input.posting.sourceId, p_posting: built.posting, p_review: review,
    p_stable_job_id: built.stableJobId, p_job_snapshot: built.snapshot,
    p_requirement_nodes: built.requirementNodes, p_normalized: built.normalized });
  if (result.error || !result.data) throw new Error("manual_source_verification_rejected");
  return { jobSnapshotId: result.data, stableNormalizedJobId: built.stableJobId,
    customerVisible: false, automatedEnumeration: false, closureEligible: false,
    nextStep: "ADMIT_VERIFIED_SNAPSHOT_SEPARATELY_THEN_EVALUATE_CUSTOMER_CRITERIA" };
}

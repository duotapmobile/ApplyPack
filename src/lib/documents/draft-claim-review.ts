import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DRAFT_RENDER_SOURCE_VERSION, serializeDraftRenderSource, type DraftRenderSource } from "./draft-render-source";
import { DRAFT_REFERENCE_FIELDS } from "./draft-reference-source";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const draftClaimReviewRequestSchema = z.object({
  versionId: uuid, packetSha256: hash, sourceSha256: hash,
  claims: z.array(z.object({ claimId: uuid, wordingSha256: hash, decision: z.literal("APPROVED") }).strict()).min(1).max(250),
}).strict();
export type DraftClaimReviewRequest = z.infer<typeof draftClaimReviewRequestSchema>;
export type DraftClaimReviewBinding = { versionId: string; packetSha256: string; sourceSha256: string;
  customerId: string; materialLineId: string; revisionId: string };
const metadataSchema = z.object({
  claimId: uuid, wordingSha256: hash, decision: z.literal("APPROVED"),
  kind: z.enum(["CANDIDATE_FACT", "JOB_EVIDENCE", "MIXED", "NARRATIVE", "REFERENCE_PERMISSION"]),
  qualification: z.enum(["EXACT", "QUALIFIED_TRANSFER", "NONFACTUAL"]),
  factRefs: z.array(z.object({ factId: uuid, attributionFactId: uuid, field: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}(\.[0-9]{1,3})?$/), valueSha256: hash }).strict()).max(40),
  jobEvidenceIds: z.array(uuid).max(40), referencePermissionIds: z.array(uuid).max(3),
  referenceBinding: z.object({ permissionId: uuid, recordVersionId: uuid, payloadId: uuid, contentSha256: hash,
    field: z.enum(DRAFT_REFERENCE_FIELDS) }).strict().optional(),
}).strict();
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function requireThat(value: unknown): asserts value { if (!value) throw new Error("DRAFT_CLAIM_REVIEW_STALE_OR_INCOMPLETE"); }

/** The source and binding come from the authenticated server's exact saved
 * version. Only IDs, wording digests and explicit decisions come from the owner.
 * This prepares an encrypted review payload; the DB still checks current facts,
 * ownership and version under locks before accepting the review. */
export function prepareDraftClaimReview(input: { source: DraftRenderSource; binding: DraftClaimReviewBinding;
  reviewerId: string; request: unknown }, now = new Date()) {
  const request = draftClaimReviewRequestSchema.parse(input.request);
  const reviewerId = uuid.parse(input.reviewerId), source = input.source, binding = input.binding;
  serializeDraftRenderSource(source);
  requireThat(Number.isFinite(now.getTime()) && Date.parse(source.validUntil) > now.getTime()
    && source.schemaVersion === DRAFT_RENDER_SOURCE_VERSION && source.state === "OWNER_REVIEW_REQUIRED" && !source.deliveryAuthorized
    && source.expected.customerId === binding.customerId && source.expected.materialLineId === binding.materialLineId
    && source.expected.revisionId === binding.revisionId && source.packetSha256 === binding.packetSha256
    && source.renderSourceSha256 === binding.sourceSha256 && request.versionId === binding.versionId
    && request.packetSha256 === binding.packetSha256 && request.sourceSha256 === binding.sourceSha256);
  const decisions = new Map(request.claims.map((decision) => [decision.claimId, decision]));
  requireThat(decisions.size === request.claims.length && decisions.size === source.ownerReviewClaims.length
    && new Set(source.ownerReviewClaims.map((claim) => claim.claimId)).size === decisions.size);
  const metadata = source.ownerReviewClaims.map((claim) => {
    const decision = decisions.get(claim.claimId);
    requireThat(decision?.decision === "APPROVED" && decision.wordingSha256 === claim.wordingSha256
      && digest(claim.text) === claim.wordingSha256 && claim.state === "OWNER_REVIEW_REQUIRED");
    requireThat(claim.kind === "REFERENCE_PERMISSION" ? claim.origin === "LOCAL_REFERENCE" && claim.qualification === "EXACT"
      && claim.referenceBinding && claim.referencePermissionIds.length === 1 && claim.referencePermissionIds[0] === claim.referenceBinding.permissionId
      && claim.factRefs.length === 0 && claim.jobEvidenceIds.length === 0
      : claim.origin !== "LOCAL_REFERENCE" && claim.referenceBinding === undefined && claim.referencePermissionIds.length === 0);
    return metadataSchema.parse({ claimId: claim.claimId, wordingSha256: claim.wordingSha256, decision: decision.decision,
      kind: claim.kind, qualification: claim.qualification, factRefs: claim.factRefs,
      jobEvidenceIds: claim.jobEvidenceIds, referencePermissionIds: claim.referencePermissionIds,
      ...(claim.kind === "REFERENCE_PERMISSION" ? { referenceBinding: claim.referenceBinding } : {}) });
  });
  requireThat(Buffer.byteLength(JSON.stringify(metadata), "utf8") <= 200_000);
  const body = JSON.stringify({ schemaVersion: "applypack-owner-wording-review-v1", versionId: binding.versionId,
    packetSha256: binding.packetSha256, sourceSha256: binding.sourceSha256, reviewerId, reviewedAt: now.toISOString(),
    claims: source.ownerReviewClaims.map((claim) => ({ ...claim, decision: "APPROVED" as const })) });
  requireThat(Buffer.byteLength(body, "utf8") <= 4 * 1024 * 1024);
  return { body, reviewSha256: digest(body), metadata, versionId: binding.versionId, packetSha256: binding.packetSha256,
    sourceSha256: binding.sourceSha256, reviewerId };
}

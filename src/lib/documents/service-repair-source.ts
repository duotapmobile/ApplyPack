import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { bindServiceRepairOriginals, type ServiceRepairOriginalMember } from "@/lib/materials/service-repair-contract";
import { serviceErrorCanonicalJson } from "@/lib/materials/service-error-contract";
import { validateServiceRepairInspection } from "@/lib/materials/service-repair-workflow";
import { readBoundDraftRenderEvidence } from "./draft-render-source-storage";
import { serializeDraftRenderSource, type DraftRenderSource, type DraftRenderText } from "./draft-render-source";
import { serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "./drafting-evidence";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const exact = serviceErrorCanonicalJson;
const same = (a: unknown, b: unknown) => exact(a) === exact(b);
const envelopeSchema = z.object({ schemaVersion: z.literal("applypack-service-repair-source-v1"),
  caseId: uuid, customerId: uuid, materialLineId: uuid, repairVersionId: uuid, acceptedScopeSha256: hash,
  contextSha256: hash, createdAt: time,
  members: z.array(z.object({ repairMode: z.enum(["SOURCE_CORRECTION", "SOURCE_PRESERVING_RERENDER"]), originalFileVersionId: uuid, originalSourceSha256: hash, packetSha256: hash,
    renderSourceSha256: hash, source: z.unknown() }).strict()).min(1).max(3),
}).strict();
export type ServiceRepairSourceEnvelope = z.infer<typeof envelopeSchema>;
export type ServiceRepairOriginalInput = { member: ServiceRepairOriginalMember; packet: DraftingEvidencePacket;
  packetBytes: Buffer; sourceBytes: Buffer };
export type ServiceRepairBoundMember = Readonly<{ original: ServiceRepairOriginalMember; packet: DraftingEvidencePacket;
  source: DraftRenderSource; artifactType: ServiceRepairOriginalMember["artifactType"]; repairMode: ServiceRepairSourceEnvelope["members"][number]["repairMode"];
  serviceRepair: { schemaVersion: "applypack-service-repair-render-binding-v1"; repairVersionId: string;
    repairSourceSha256: string; acceptedScopeSha256: string; originalFileVersionId: string; originalSourceSha256: string } }>;
const boundMembers = new WeakSet<object>();
export type ServiceRepairReviewMember = Readonly<Omit<ServiceRepairBoundMember, "serviceRepair"> & {
  reviewBinding: { repairVersionId: string; sourceSha256: string; contextSha256: string; acceptedScopeSha256: string };
}>;
const reviewMembers = new WeakSet<object>();
export class ServiceRepairSourceError extends Error {
  constructor(readonly code: string) { super(`SERVICE_REPAIR_SOURCE_${code}`); }
}
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceRepairSourceError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown, code: string): T {
  const result = schema.safeParse(raw); ensure(result.success, code); return result.data;
}
function decode(bytes: Buffer, expected: string, maximum = 6_000_000): { body: string; value: unknown } {
  ensure(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum && digest(bytes) === expected, "BYTES_INVALID");
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes), value: unknown = JSON.parse(body);
    ensure(exact(value) === body, "JSON_INVALID"); return { body, value };
  } catch { throw new ServiceRepairSourceError("JSON_INVALID"); }
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const prefix = (artifact: ServiceRepairOriginalMember["artifactType"]) => artifact === "RESUME" ? "resume" : artifact === "COVER_LETTER" ? "coverLetter" : "referenceSheet";
export function selectedServiceRepairClaims(source: DraftRenderSource, artifact: ServiceRepairOriginalMember["artifactType"]) {
  return source.ownerReviewClaims.filter((claim) => claim.placement.startsWith(`${prefix(artifact)}.`));
}
export function serviceRepairClaimReviewMetadata(claim: DraftRenderText) {
  return { claimId: claim.claimId, placement: claim.placement, wordingSha256: claim.wordingSha256, decision: "APPROVED",
    kind: claim.kind, qualification: claim.qualification, factRefs: claim.factRefs, jobEvidenceIds: claim.jobEvidenceIds,
    referencePermissionIds: claim.referencePermissionIds,
    ...(claim.kind === "REFERENCE_PERMISSION" ? { referenceBinding: claim.referenceBinding } : {}) };
}

/** Authoring/storage helper only. Corrected wording still requires a separate
 * explicit099 owner review. It does not author facts, grant a lease or approve. */
export function serializeServiceRepairEnvelope(input: ServiceRepairSourceEnvelope) {
  const envelope = parse(envelopeSchema, input, "ENVELOPE_INVALID"), body = exact(envelope);
  ensure(Buffer.byteLength(body, "utf8") <= 6_000_000, "ENVELOPE_TOO_LARGE");
  return { body, sourceSha256: digest(body) };
}

/** Read-only capability for the exact accepted saved source. This deliberately
 * requires neither a worker lease nor a fabricated wording-review receipt. */
export function readServiceRepairSourceForReview(input: {
  caseId: string; materialLineId: string; versionId: string;
  inspection: unknown; envelopeBytes: Buffer; originals: ServiceRepairOriginalInput[];
}, now = new Date()) {
  const identity = parse(z.object({ caseId: uuid, materialLineId: uuid, versionId: uuid }).strict(),
    { caseId: input.caseId, materialLineId: input.materialLineId, versionId: input.versionId }, "IDENTITY_INVALID");
  const clock = now.getTime(); ensure(Number.isFinite(clock), "CLOCK_INVALID");
  const inspected = validateServiceRepairInspection(input.inspection, { caseId: identity.caseId, materialLineId: identity.materialLineId }), { version, job } = inspected;
  ensure(version && job && version.id === identity.versionId && version.invalidated_at === null && version.release_id === null
    && job.active_version_id === version.id
    && version.accepted_scope_sha256 === inspected.scope.acceptedScopeSha256 && version.context_sha256 === inspected.contextSha256
    && same(version.originals, inspected.originals) && version.encrypted_payload_id && version.source_sha256, "AUTHORITY_STALE");
  const originals = input.originals.map((entry) => ({ ...entry, packet: structuredClone(entry.packet) }));
  const originalPlan = bindServiceRepairOriginals({ caseId: identity.caseId, customerId: inspected.scope.customerId,
    materialLineId: identity.materialLineId, acceptedScopeSha256: inspected.scope.acceptedScopeSha256,
    acceptedRows: inspected.acceptedRows, originals }, now);
  ensure(same(originals.map((entry) => entry.member).sort((a, b) => a.fileVersionId.localeCompare(b.fileVersionId)),
    [...inspected.originals].sort((a, b) => a.fileVersionId.localeCompare(b.fileVersionId))), "ORIGINALS_CHANGED");
  const saved = decode(input.envelopeBytes, version.source_sha256), envelope = parse(envelopeSchema, saved.value, "ENVELOPE_INVALID");
  ensure(envelope.caseId === identity.caseId && envelope.customerId === inspected.scope.customerId && envelope.materialLineId === identity.materialLineId
    && envelope.repairVersionId === version.id && envelope.contextSha256 === version.context_sha256
    && envelope.acceptedScopeSha256 === version.accepted_scope_sha256 && Date.parse(envelope.createdAt) >= Date.parse(version.created_at)
    && Date.parse(envelope.createdAt) <= clock
    && envelope.members.length === originals.length && new Set(envelope.members.map((member) => member.originalFileVersionId)).size === originals.length,
  "ENVELOPE_BINDING_INVALID");
  const members = envelope.members.map((entry): ServiceRepairReviewMember => {
    const original = originals.find((item) => item.member.fileVersionId === entry.originalFileVersionId);
    ensure(original && entry.originalSourceSha256 === original.member.sourceSha256 && entry.packetSha256 === original.member.packetSha256, "MEMBER_NOT_ACCEPTED");
    const { packet, member } = original;
    ensure(serializeDraftingEvidencePacket(packet) === decode(original.packetBytes, member.packetSha256, 2_000_000).body, "PACKET_CHANGED");
    const originalSaved = decode(original.sourceBytes, member.sourceSha256, 2_000_000);
    const prior = readBoundDraftRenderEvidence(originalSaved, member.sourceSha256, packet, () => now);
    const source = readBoundDraftRenderEvidence({ body: exact(entry.source), value: entry.source }, entry.renderSourceSha256, packet, () => now);
    ensure(source.validUntil === prior.validUntil && source.proposalSourceSha256 === prior.proposalSourceSha256, "SOURCE_LINEAGE_INVALID");
    if (entry.repairMode === "SOURCE_PRESERVING_RERENDER") {
      ensure(entry.renderSourceSha256 === member.sourceSha256 && exact(entry.source) === originalSaved.body, "RERENDER_SOURCE_CHANGED");
    } else ensure(source.renderSourceSha256 !== prior.renderSourceSha256 && Date.parse(source.finalVersionAt) >= Date.parse(version.created_at)
      && Date.parse(source.finalVersionAt) <= clock, "SOURCE_LINEAGE_INVALID");
    const artifact = prefix(member.artifactType);
    for (const other of ["resume", "coverLetter", "referenceSheet"] as const) {
      if (other !== artifact) ensure(same(source[other] ?? null, prior[other] ?? null), "UNSELECTED_CONTENT_CHANGED");
    }
    ensure(same(source.ownerReviewClaims.filter((claim) => !claim.placement.startsWith(`${artifact}.`)),
      prior.ownerReviewClaims.filter((claim) => !claim.placement.startsWith(`${artifact}.`))), "UNSELECTED_CONTENT_CHANGED");
    const claims = selectedServiceRepairClaims(source, member.artifactType);
    ensure(claims.length > 0 && (entry.repairMode === "SOURCE_PRESERVING_RERENDER" || !same(claims, selectedServiceRepairClaims(prior, member.artifactType))), "NO_MEMBER_CORRECTION");
    const bound = freeze({ original: structuredClone(member), packet, source, artifactType: member.artifactType, repairMode: entry.repairMode,
      reviewBinding: { repairVersionId: version.id, sourceSha256: version.source_sha256!, contextSha256: version.context_sha256,
        acceptedScopeSha256: version.accepted_scope_sha256 } });
    reviewMembers.add(bound); return bound;
  });
  return { members, originalPlan, contextSha256: version.context_sha256, sourceSha256: version.source_sha256,
    acceptedScopeSha256: version.accepted_scope_sha256, createdAt: envelope.createdAt,
    state: "OWNER_REVIEW_REQUIRED" as const, renderingAuthorized: false as const, deliveryAuthorized: false as const };
}

export function assertServiceRepairReviewMember(value: ServiceRepairReviewMember): void {
  ensure(reviewMembers.has(value), "REVIEW_MEMBER_UNBOUND");
  ensure(serializeDraftRenderSource(value.source) && serializeDraftingEvidencePacket(value.packet), "MEMBER_CHANGED");
}

/** Only the complete recorded owner review and a current worker lease can
 * promote read evidence into the separate rendering capability. */
export function bindServiceRepairRenderSource(input: {
  caseId: string; materialLineId: string; versionId: string; leaseToken: string;
  inspection: unknown; envelopeBytes: Buffer; originals: ServiceRepairOriginalInput[];
}, now = new Date()) {
  const identity = parse(z.object({ caseId: uuid, materialLineId: uuid, versionId: uuid, leaseToken: uuid }).strict(),
    { caseId: input.caseId, materialLineId: input.materialLineId, versionId: input.versionId, leaseToken: input.leaseToken }, "IDENTITY_INVALID");
  const clock = now.getTime(); ensure(Number.isFinite(clock), "CLOCK_INVALID");
  const inspected = validateServiceRepairInspection(input.inspection, { caseId: identity.caseId, materialLineId: identity.materialLineId }), { version, job } = inspected;
  ensure(version && job && version.id === identity.versionId && version.invalidated_at === null && version.release_id === null
    && job.active_version_id === version.id && job.lease_token === identity.leaseToken && job.lease_owner !== null
    && job.lease_expires_at !== null && Date.parse(job.lease_expires_at) > clock && Date.parse(job.lease_expires_at) <= clock + 300_000
    && version.accepted_scope_sha256 === inspected.scope.acceptedScopeSha256 && version.context_sha256 === inspected.contextSha256
    && same(version.originals, inspected.originals) && version.encrypted_payload_id && version.source_sha256
    && version.claim_review_encrypted_payload_id && version.claim_review_sha256 && version.claim_review_metadata
    && version.claims_reviewed_by && version.claims_reviewed_at && Date.parse(version.claims_reviewed_at) <= clock
    && Date.parse(version.claims_reviewed_at) >= Date.parse(version.created_at)
    && version.member_set_sha256 === null && version.approval_sha256 === null, "AUTHORITY_STALE");
  const read = readServiceRepairSourceForReview(input, now), reviewedAt = version.claims_reviewed_at, review = version.claim_review_metadata;
  ensure(Date.parse(read.createdAt) <= Date.parse(reviewedAt), "ENVELOPE_BINDING_INVALID");
  ensure(review.length === read.members.length, "WORDING_REVIEW_INCOMPLETE");
  const members = read.members.map((member): ServiceRepairBoundMember => {
    ensure(member.repairMode === "SOURCE_PRESERVING_RERENDER" || Date.parse(member.source.finalVersionAt) <= Date.parse(reviewedAt), "SOURCE_LINEAGE_INVALID");
    const expected = { originalFileVersionId: member.original.fileVersionId, renderSourceSha256: member.source.renderSourceSha256,
      claims: selectedServiceRepairClaims(member.source, member.artifactType).map(serviceRepairClaimReviewMetadata) };
    ensure(review.filter(value => same(value, expected)).length === 1, "WORDING_REVIEW_INCOMPLETE");
    const bound = freeze({ original: member.original, packet: member.packet, source: member.source, artifactType: member.artifactType, repairMode: member.repairMode,
      serviceRepair: { schemaVersion: "applypack-service-repair-render-binding-v1" as const, repairVersionId: version.id,
        repairSourceSha256: version.source_sha256!, acceptedScopeSha256: version.accepted_scope_sha256,
        originalFileVersionId: member.original.fileVersionId, originalSourceSha256: member.original.sourceSha256 } });
    boundMembers.add(bound); return bound;
  });
  return { members, originalPlan: read.originalPlan, contextSha256: version.context_sha256, sourceSha256: version.source_sha256,
    acceptedScopeSha256: version.accepted_scope_sha256, leaseExpiresAt: job.lease_expires_at,
    state: "OWNER_REVIEW_REQUIRED" as const, deliveryAuthorized: false as const };
}

/** Only objects returned by the complete binding above enter repair layout. */
export function assertBoundServiceRepairMember(value: ServiceRepairBoundMember): void {
  ensure(boundMembers.has(value), "MEMBER_UNBOUND");
  ensure(serializeDraftRenderSource(value.source) && serializeDraftingEvidencePacket(value.packet), "MEMBER_CHANGED");
}

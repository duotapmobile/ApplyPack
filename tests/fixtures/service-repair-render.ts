import { createHash } from "node:crypto";
import { serviceRepairAcceptedScope, type ServiceRepairOriginalMember } from "@/lib/materials/service-repair-contract";
import type { ServiceRepairVersion } from "@/lib/materials/service-repair-workflow";
import { serviceErrorCanonicalJson } from "@/lib/materials/service-error-contract";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { serializeDraftRenderSource, type DraftRenderSource } from "@/lib/documents/draft-render-source";
import { serializeServiceRepairEnvelope } from "@/lib/documents/service-repair-source";
import { draftReferenceFixture } from "./draft-reference";
import { draftFixtureNow } from "./draft-document";

export const repairFixtureNow = new Date(draftFixtureNow.getTime() + 40 * 86_400_000);
const id = (value: number) => `7b000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function serviceRepairRenderFixture(repairMode: "SOURCE_CORRECTION" | "SOURCE_PRESERVING_RERENDER" = "SOURCE_CORRECTION") {
  const document = draftReferenceFixture(3), packet = document.input.packet, prior = document.build();
  const original: ServiceRepairOriginalMember = { materialLineId: packet.expected.materialLineId, sourceSnapshotId: packet.binding.snapshotId,
    artifactId: id(1), fileVersionId: id(2), releaseId: id(3), artifactType: "COVER_LETTER", checksumSha256: "a".repeat(64),
    draftVersionId: id(4), draftJobId: id(5), packetPayloadId: id(6), packetSha256: packet.packetSha256,
    sourcePayloadId: id(7), sourceSha256: prior.renderSourceSha256, revisionId: packet.expected.revisionId,
    revisionVersion: packet.expected.revisionVersion, bindingSha256: packet.expected.bindingSha256,
    approvedAt: new Date(draftFixtureNow.getTime() + 60_000).toISOString(), deliveredAt: new Date(draftFixtureNow.getTime() + 120_000).toISOString() };
  const acceptedRows = [{ id: id(8), case_id: id(9), decision_id: id(10), customer_id: packet.expected.customerId,
    material_line_id: original.materialLineId, source_snapshot_id: original.sourceSnapshotId, artifact_id: original.artifactId,
    file_version_id: original.fileVersionId, release_id: original.releaseId, member_kind: "ACCEPTED_ERROR" as const }];
  const { acceptances: _acceptances, ...scope } = serviceRepairAcceptedScope({ caseId: id(9), customerId: packet.expected.customerId }, acceptedRows); void _acceptances;
  const versionCreated = new Date(repairFixtureNow.getTime() - 60_000).toISOString(), correctedAt = new Date(repairFixtureNow.getTime() - 30_000).toISOString();
  const source = structuredClone(prior) as { -readonly [K in keyof DraftRenderSource]: DraftRenderSource[K] };
  const corrected = "I organized schedules for community events.";
  const placement = "coverLetter.body.0.sentences.0";
  if (repairMode === "SOURCE_CORRECTION") {
  for (const claim of [source.coverLetter.body[0][0], source.ownerReviewClaims.find((claim) => claim.placement === placement)!]) {
    claim.text = corrected; claim.wordingSha256 = digest(corrected); claim.origin = "OWNER_EDIT";
  }
  source.finalVersionAt = correctedAt;
  source.ownerEdit = { schemaVersion: "applypack-owner-draft-edit-v1", requestId: id(11), requestSha256: "b".repeat(64),
    priorVersionId: original.draftVersionId, priorSourceSha256: prior.renderSourceSha256, originalProposalSourceSha256: prior.proposalSourceSha256,
    reviewerId: id(12), editedAt: correctedAt, validatedOutputSha256: "c".repeat(64), changedPlacements: [placement] };
  const { renderSourceSha256: _hash, ...sourceBody } = source; void _hash;
  source.renderSourceSha256 = digest(serviceErrorCanonicalJson(sourceBody));
  }
  const envelope = { schemaVersion: "applypack-service-repair-source-v1" as const, caseId: scope.caseId, customerId: scope.customerId,
    materialLineId: original.materialLineId, repairVersionId: id(13), acceptedScopeSha256: scope.acceptedScopeSha256,
    contextSha256: "d".repeat(64), createdAt: correctedAt, members: [{ repairMode, originalFileVersionId: original.fileVersionId,
      originalSourceSha256: original.sourceSha256, packetSha256: original.packetSha256, renderSourceSha256: source.renderSourceSha256,
      source: JSON.parse(serializeDraftRenderSource(source)) as unknown }] };
  const serialized = serializeServiceRepairEnvelope(envelope);
  const review = { originalFileVersionId: original.fileVersionId, renderSourceSha256: source.renderSourceSha256,
    claims: source.ownerReviewClaims.filter((claim) => claim.placement.startsWith("coverLetter.")).map((claim) => ({
      claimId: claim.claimId, placement: claim.placement, wordingSha256: claim.wordingSha256, decision: "APPROVED",
      kind: claim.kind, qualification: claim.qualification, factRefs: claim.factRefs, jobEvidenceIds: claim.jobEvidenceIds,
      referencePermissionIds: claim.referencePermissionIds,
    })) };
  const version: ServiceRepairVersion = { id: id(13), request_id: id(14), job_id: id(15), case_id: scope.caseId,
    customer_id: scope.customerId, material_line_id: original.materialLineId, version: 1, supersedes_id: null,
    accepted_scope_sha256: scope.acceptedScopeSha256, originals: [original], context_sha256: envelope.contextSha256,
    encrypted_payload_id: id(16), source_sha256: serialized.sourceSha256, claim_review_encrypted_payload_id: id(17),
    claim_review_sha256: "e".repeat(64), claim_review_metadata: [review], claims_reviewed_by: id(12),
    claims_reviewed_at: new Date(repairFixtureNow.getTime() - 5000).toISOString(), member_set_sha256: null,
    approval_sha256: null, review_checklist: null, approved_by: null, approved_at: null, release_id: null,
    invalidated_at: null, created_by: id(12), created_at: versionCreated };
  const identity = { caseId: scope.caseId, materialLineId: original.materialLineId, versionId: version.id, leaseToken: id(18) };
  const inspection = { scope, acceptedRows, originals: [original], contextSha256: envelope.contextSha256, version,
    job: { id: version.job_id, case_id: scope.caseId, customer_id: scope.customerId, material_line_id: original.materialLineId,
      active_version_id: version.id, lease_owner: id(19), lease_token: identity.leaseToken, lease_generation: 1,
      lease_expires_at: new Date(repairFixtureNow.getTime() + 240_000).toISOString(), created_at: versionCreated }, latestRepairs: [], feedback: [] };
  const evidence = () => ({ envelopeBytes: Buffer.from(serialized.body), originals: [{ member: structuredClone(original),
    packet: structuredClone(packet), packetBytes: Buffer.from(serializeDraftingEvidencePacket(packet)), sourceBytes: Buffer.from(serializeDraftRenderSource(prior)) }] });
  return { document, packet, prior, source, envelope, serialized, original, identity, inspection, reviewerId: id(12), evidence };
}

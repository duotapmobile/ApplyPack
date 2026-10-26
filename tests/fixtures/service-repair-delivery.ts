import { serviceRepairAcceptedScope } from "@/lib/materials/service-repair-contract";
import { repairReviewLabels, type RepairDeliveryAction } from "@/lib/materials/service-repair-delivery-client";
import type { ServiceRepairVersion } from "@/lib/materials/service-repair-workflow";
export const repairId = (n: number) => `99200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function repairDeliveryFixture() {
  const caseId = repairId(1), line = repairId(2), customer = repairId(3), reviewer = repairId(4), time = "2026-10-25T12:00:00Z";
  const acceptedRows = [{ id: repairId(5), case_id: caseId, decision_id: repairId(6), customer_id: customer, material_line_id: line,
    source_snapshot_id: repairId(7), artifact_id: repairId(8), file_version_id: repairId(9), release_id: repairId(10), member_kind: "ACCEPTED_ERROR" as const }];
  const scope = serviceRepairAcceptedScope({ caseId, customerId: customer }, acceptedRows);
  const original = { ...scope.members[0], artifactType: "COVER_LETTER" as const, checksumSha256: "a".repeat(64), draftVersionId: repairId(11), draftJobId: repairId(12),
    packetPayloadId: repairId(13), packetSha256: "b".repeat(64), sourcePayloadId: repairId(14), sourceSha256: "c".repeat(64), revisionId: repairId(15), revisionVersion: 1,
    bindingSha256: "d".repeat(64), approvedAt: time, deliveredAt: time };
  const v: ServiceRepairVersion = { id: repairId(17), request_id: repairId(16), job_id: repairId(18), case_id: caseId, customer_id: customer, material_line_id: line,
    version: 1, supersedes_id: null, accepted_scope_sha256: scope.acceptedScopeSha256, context_sha256: "e".repeat(64), originals: [original],
    encrypted_payload_id: repairId(19), source_sha256: "f".repeat(64), claim_review_encrypted_payload_id: repairId(20), claim_review_sha256: "a".repeat(64), claim_review_metadata: [],
    claims_reviewed_by: reviewer, claims_reviewed_at: time, member_set_sha256: "b".repeat(64), approval_sha256: null, review_checklist: null, approved_by: null,
    approved_at: null, release_id: null, invalidated_at: null, created_by: reviewer, created_at: time };
  const prefix = `${customer}/materials/${line}/repairs/${v.id}/`;
  const file = { id: repairId(21), repair_version_id: v.id, customer_id: customer, material_line_id: line, artifact_id: original.artifactId,
    original_file_version_id: original.fileVersionId, source_snapshot_id: original.sourceSnapshotId, artifact_type: original.artifactType,
    storage_bucket: "customer-deliveries", storage_path: prefix + "letter.pdf", safe_filename: "Example_Application.pdf", checksum_sha256: "c".repeat(64),
    render_source_sha256: "d".repeat(64), preview_bucket: "operator-render-previews", preview_path: prefix + "letter-preview.pdf", preview_sha256: "e".repeat(64),
    editable_bucket: "operator-drafts", editable_path: prefix + "letter.docx", editable_sha256: "f".repeat(64) };
  const expected = { caseId, materialLineId: line, versionId: v.id, sourceSha256: v.source_sha256!, acceptedScopeSha256: scope.acceptedScopeSha256,
    contextSha256: v.context_sha256, memberSetSha256: v.member_set_sha256!, members: [{ fileVersionId: file.id, originalFileVersionId: file.original_file_version_id,
      artifactId: file.artifact_id, artifactType: file.artifact_type, checksumSha256: file.checksum_sha256, renderSourceSha256: file.render_source_sha256,
      previewSha256: file.preview_sha256, editableSha256: file.editable_sha256 }] };
  const checklist = Object.fromEntries(Object.keys(repairReviewLabels).map(key => [key, true])) as Extract<RepairDeliveryAction, { action: "APPROVE" }>["checklist"];
  const approve: RepairDeliveryAction = { action: "APPROVE", expected, checklist };
  const approvalSha256 = "1".repeat(64), releaseId = repairId(22), outboxId = repairId(23);
  const send: RepairDeliveryAction = { action: "SEND", expected, approvalSha256, releaseId, outboxId };
  const job = { id: v.job_id, case_id: caseId, customer_id: customer, material_line_id: line, active_version_id: v.id,
    lease_owner: null, lease_token: null, lease_generation: 1, lease_expires_at: null, created_at: time };
  const inspection = { scope: { schemaVersion: scope.schemaVersion, caseId, customerId: customer, members: scope.members, acceptedScopeSha256: scope.acceptedScopeSha256 },
    acceptedRows, originals: [original], contextSha256: v.context_sha256, job, version: v, latestRepairs: [], feedback: [] };
  const release = { id: releaseId, repair_version_id: v.id, case_id: caseId, customer_id: customer, material_line_id: line, outbox_id: outboxId,
    accepted_scope_sha256: scope.acceptedScopeSha256, member_set_sha256: v.member_set_sha256, approval_sha256: approvalSha256, approved_by: reviewer };
  const summary = { caseId, materialLineId: line, state: "REVIEW_REQUIRED" as const, expected, approvalSha256: null as string | null, canSend: false, releaseId: null as string | null,
    files: [{ fileVersionId: file.id, originalFileVersionId: file.original_file_version_id, artifactType: file.artifact_type, filename: file.safe_filename,
      previewUrl: `/api/admin/service-errors/${caseId}/repairs/${line}/delivery?versionId=${v.id}&previewFileId=${file.id}` }] };
  return { caseId, line, customer, reviewer, time, version: v, file, expected, approve, send, approvalSha256, release, inspection, summary };
}

import type { RepairAuthoringRequest, RepairAuthoringView } from "@/lib/materials/service-repair-authoring-client";
export const authoringId = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function repairAuthoringFixture(): RepairAuthoringView {
  const claim = { text: "Helped customers with routine questions.", sourceAtomIds: ["c".repeat(64)], jobEvidenceIds: [], questionIds: [], relation: "DIRECT" as const };
  return { caseId: authoringId(1), materialLineId: authoringId(2), versionId: authoringId(3), acceptedScopeSha256: "a".repeat(64), contextSha256: "b".repeat(64), sourceSaved: false,
    members: [{ originalFileVersionId: authoringId(4), artifactType: "COVER_LETTER", originalSourceSha256: "d".repeat(64), title: "Example employer — Office assistant",
      model: { output: { schemaVersion: "applypack-draft-proposal-v1", language: "en-US", resume: { summary: [structuredClone(claim)], skills: [],
        sections: [{ anchorFactId: authoringId(5), bullets: [structuredClone(claim)] }], educationFactIds: [authoringId(6)] }, coverLetter: { body: [{ sentences: [structuredClone(claim)] }] } },
      sections: [{ anchorFactId: authoringId(5), label: "Example shop · Assistant · 2022–2023" }], sources: [
        { id: "c".repeat(64), factId: authoringId(5), parentFactId: null, label: "Customer support duties", value: "Helped customers with routine questions.", disposition: "CONFIRMED_SOURCE_NOT_APPROVED_PROSE", localOnly: false },
        { id: "e".repeat(64), factId: authoringId(5), parentFactId: null, label: "Recorded software limit", value: "Still learning spreadsheets", disposition: "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE", localOnly: false },
        { id: "f".repeat(64), factId: authoringId(5), parentFactId: null, label: "Historical title", value: "Assistant", disposition: "CONFIRMED_SOURCE_NOT_APPROVED_PROSE", localOnly: true },
        { id: "1".repeat(64), factId: authoringId(5), parentFactId: null, label: "Not confirmed", value: "No supervisory experience", disposition: "NEGATIVE_DO_NOT_ASSERT", localOnly: false },
      ] } }] };
}
export function repairAuthoringReceipt(request: RepairAuthoringRequest, state: "WORDING_REVIEW_REQUIRED" | "SOURCE_STORED" | "NOT_SAVED" = "WORDING_REVIEW_REQUIRED") {
  return { caseId: request.caseId, materialLineId: request.materialLineId, versionId: request.versionId, requestId: request.requestId,
    acceptedScopeSha256: request.acceptedScopeSha256, contextSha256: request.contextSha256, sourceSha256: "9".repeat(64),
    state, retryAllowed: state !== "WORDING_REVIEW_REQUIRED", replayed: state === "SOURCE_STORED", renderingAuthorized: false, deliveryAuthorized: false };
}

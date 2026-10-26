import { repairCaseStateBody, repairCaseStateReceiptSchema, repairFeedbackBody, repairFeedbackReceiptSchema, repairFollowupCanonicalJson,
  type RepairCaseStateRequest, type RepairFeedbackRequest } from "./service-repair-followup";
async function digest(body: unknown) {
  const bytes = new TextEncoder().encode(repairFollowupCanonicalJson(body));
  try { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join(""); }
  finally { bytes.fill(0); }
}
export async function matchesRepairFeedback(value: unknown, request: RepairFeedbackRequest) {
  const parsed = repairFeedbackReceiptSchema.safeParse(value); if (!parsed.success) return false; const row = parsed.data;
  return row.requestId === request.requestId && row.caseId === request.caseId && row.materialLineId === request.materialLineId
    && row.releaseId === request.releaseId && row.contentSha256 === await digest(repairFeedbackBody(request))
    && repairFollowupCanonicalJson(row.members) === repairFollowupCanonicalJson(request.items.map(({ artifactId, fileVersionId }) => ({ artifactId, fileVersionId })));
}
export async function matchesRepairCaseState(value: unknown, request: RepairCaseStateRequest) {
  const parsed = repairCaseStateReceiptSchema.safeParse(value); if (!parsed.success) return false; const row = parsed.data;
  return row.requestId === request.requestId && row.caseId === request.caseId && row.action === request.action
    && row.acceptedScopeSha256 === request.acceptedScopeSha256 && row.contentSha256 === await digest(repairCaseStateBody(request));
}

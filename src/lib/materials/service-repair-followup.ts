import { z } from "zod";

// Browser-safe protocol. Private wording appears only in the encrypted request
// body; these receipts are not acceptance, rendering, approval or Send authority.
export const REPAIR_FEEDBACK_PURPOSE = "SERVICE_REPAIR_FEEDBACK" as const;
export const REPAIR_CASE_EVENT_PURPOSE = "SERVICE_REPAIR_CASE_EVENT" as const;
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const repairFollowupMemberSchema = z.object({ artifactId: uuid, fileVersionId: uuid }).strict();
export const repairFeedbackRequestSchema = z.object({
  requestId: uuid, caseId: uuid, materialLineId: uuid, releaseId: uuid,
  items: z.array(repairFollowupMemberSchema.extend({ concern: z.string().trim().min(10).max(3000) }).strict()).min(1).max(3),
  sameAcceptedIssue: z.literal(true),
}).strict().superRefine((value, context) => {
  if (new Set(value.items.map((item) => item.fileVersionId)).size !== value.items.length)
    context.addIssue({ code: "custom", message: "Describe each affected repaired file once." });
});
export type RepairFeedbackRequest = z.infer<typeof repairFeedbackRequestSchema>;
export const repairCaseStateRequestSchema = z.object({
  requestId: uuid, caseId: uuid, acceptedScopeSha256: hash, expectedReviewContextSha256: hash,
  action: z.enum(["RESOLVED", "REOPENED"]), explanation: z.string().trim().min(10).max(4000),
  reviewedRepairFiles: z.literal(true), reviewedFeedback: z.literal(true),
}).strict();
export type RepairCaseStateRequest = z.infer<typeof repairCaseStateRequestSchema>;
export const repairFeedbackReceiptSchema = z.object({ requestId: uuid, caseId: uuid, materialLineId: uuid,
  releaseId: uuid, contentSha256: hash, members: z.array(repairFollowupMemberSchema).min(1).max(3), createdAt: time }).strict();
export type RepairFeedbackReceipt = z.infer<typeof repairFeedbackReceiptSchema>;
export const repairCaseStateReceiptSchema = z.object({ requestId: uuid, caseId: uuid, materialLineId: uuid,
  action: z.enum(["RESOLVED", "REOPENED"]), acceptedScopeSha256: hash, contentSha256: hash, reviewerId: uuid, createdAt: time }).strict();
export type RepairCaseStateReceipt = z.infer<typeof repairCaseStateReceiptSchema>;
export const repairFeedbackFileSchema = z.object({ caseId: uuid, artifactId: uuid, fileVersionId: uuid, originalFileVersionId: uuid,
  artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), safeFilename: z.string().min(1).max(255).regex(/^[^/\\\x00-\x1f]+$/),
  checksumSha256: hash, releaseId: uuid, deliveredAt: time, accessExpiresAt: time }).strict();
export const repairFeedbackContextSchema = z.object({ materialLineId: uuid, files: z.array(repairFeedbackFileSchema).max(3) }).strict();
export type RepairFeedbackContext = z.infer<typeof repairFeedbackContextSchema>;
export const repairCaseReviewSchema = z.object({ schemaVersion: z.literal("applypack-service-repair-case-review-v1"),
  caseId: uuid, customerId: uuid, materialLineId: uuid, acceptedScopeSha256: hash, reviewContextSha256: hash,
  state: z.enum(["OPEN", "RESOLVED"]), canResolve: z.boolean(),
  members: z.array(z.object({ materialLineId: uuid, sourceSnapshotId: uuid, artifactId: uuid, fileVersionId: uuid, releaseId: uuid,
    artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), completed: z.boolean() }).strict()).min(1).max(30),
  feedback: z.array(repairFeedbackReceiptSchema).max(3000), events: z.array(repairCaseStateReceiptSchema).max(3000),
}).strict();
export type RepairCaseReview = z.infer<typeof repairCaseReviewSchema>;

export function repairFollowupCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(repairFollowupCanonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, entry]) => `${JSON.stringify(key)}:${repairFollowupCanonicalJson(entry)}`).join(",")}}`;
  const serialized = JSON.stringify(value); if (serialized === undefined) throw new Error("Invalid follow-up body"); return serialized;
}
export function repairFeedbackBody(raw: unknown) { return { schemaVersion: "applypack-service-repair-feedback-v1" as const, ...repairFeedbackRequestSchema.parse(raw) }; }
export function repairCaseStateBody(raw: unknown) { return { schemaVersion: "applypack-service-repair-case-event-v1" as const, ...repairCaseStateRequestSchema.parse(raw) }; }
export const repairArtifactLabel = { RESUME: "Resume", COVER_LETTER: "Cover letter", REFERENCE_SHEET: "Reference sheet" } as const;

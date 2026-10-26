import { z } from "zod";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const repairReviewLabels = {
  acceptedErrorScopeReviewed: "I checked that these are exactly the files affected by the accepted ApplyPack error.",
  confirmedInputsReviewed: "I compared the corrections with the customer's original confirmed information.",
  originalInstructionsReviewed: "I checked the original employer instructions and requested file formats.",
  secureFilesConfirmed: "I checked that the private files belong to this customer and repair.",
  unchangedFilesPreserved: "I checked that unaffected files and the original paid delivery are preserved.",
  visualReviewed: "I opened every repaired file preview and checked its layout and readability.",
  wordingReviewed: "I reviewed the exact corrected wording and its factual evidence.",
} as const;
export type RepairReviewKey = keyof typeof repairReviewLabels;
export const repairReviewChecklistSchema = z.object({ acceptedErrorScopeReviewed: z.literal(true), confirmedInputsReviewed: z.literal(true),
  originalInstructionsReviewed: z.literal(true), secureFilesConfirmed: z.literal(true), unchangedFilesPreserved: z.literal(true),
  visualReviewed: z.literal(true), wordingReviewed: z.literal(true) }).strict();
export const repairDeliveryIdentitySchema = z.object({ caseId: uuid, materialLineId: uuid }).strict();
export const repairDeliveryMemberSchema = z.object({ fileVersionId: uuid, originalFileVersionId: uuid, artifactId: uuid,
  artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), checksumSha256: hash, renderSourceSha256: hash,
  previewSha256: hash, editableSha256: hash }).strict();
export const repairDeliveryExpectedSchema = repairDeliveryIdentitySchema.extend({ versionId: uuid, sourceSha256: hash,
  acceptedScopeSha256: hash, contextSha256: hash, memberSetSha256: hash, members: z.array(repairDeliveryMemberSchema).min(1).max(3) }).strict();
export const repairDeliveryActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE"), expected: repairDeliveryExpectedSchema, checklist: repairReviewChecklistSchema }).strict(),
  z.object({ action: z.literal("SEND"), expected: repairDeliveryExpectedSchema, approvalSha256: hash, releaseId: uuid, outboxId: uuid }).strict(),
]);
export const repairDeliveryRequestSchema = z.object({ operation: z.enum(["SUBMIT", "CHECK"]), request: repairDeliveryActionSchema }).strict();
export type RepairDeliveryAction = z.infer<typeof repairDeliveryActionSchema>;
export type RepairDeliveryExpected = z.infer<typeof repairDeliveryExpectedSchema>;
export const repairDeliveryResultSchema = z.object({ status: z.enum(["RECORDED", "ABSENT"]), action: z.enum(["APPROVE", "SEND"]),
  expected: repairDeliveryExpectedSchema, approvalSha256: hash.nullable(), releaseId: uuid.nullable(), outboxId: uuid.nullable() }).strict();
export const repairDeliverySummarySchema = repairDeliveryIdentitySchema.extend({ state: z.enum(["NOT_READY", "STALE", "REVIEW_REQUIRED", "APPROVED", "SENT"]),
  expected: repairDeliveryExpectedSchema.nullable(), approvalSha256: hash.nullable(), canSend: z.boolean(), releaseId: uuid.nullable(),
  files: z.array(z.object({ fileVersionId: uuid, originalFileVersionId: uuid, artifactType: repairDeliveryMemberSchema.shape.artifactType,
    filename: z.string().min(1).max(180), previewUrl: z.string().startsWith("/api/admin/service-errors/").max(500) }).strict()).max(3) }).strict();
export type RepairDeliverySummary = z.infer<typeof repairDeliverySummarySchema>;
export type RepairDeliveryResult = z.infer<typeof repairDeliveryResultSchema>;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function matchesRepairDeliveryResult(raw: unknown, request: RepairDeliveryAction): raw is RepairDeliveryResult {
  const parsed = repairDeliveryResultSchema.safeParse(raw);
  if (!parsed.success || parsed.data.action !== request.action || !equal(parsed.data.expected, repairDeliveryExpectedSchema.parse(request.expected))) return false;
  const value = parsed.data;
  if (value.status === "ABSENT") return value.approvalSha256 === null && value.releaseId === null && value.outboxId === null;
  return request.action === "APPROVE" ? value.approvalSha256 !== null && value.releaseId === null && value.outboxId === null
    : value.approvalSha256 === request.approvalSha256 && value.releaseId === request.releaseId && value.outboxId === request.outboxId;
}
export function readRepairDeliverySummary(raw: unknown, identity: z.infer<typeof repairDeliveryIdentitySchema>) {
  const value = repairDeliverySummarySchema.parse(raw);
  if (value.caseId !== identity.caseId || value.materialLineId !== identity.materialLineId
    || value.expected && (value.expected.caseId !== identity.caseId || value.expected.materialLineId !== identity.materialLineId)
    || new Set(value.files.map(file => file.fileVersionId)).size !== value.files.length
    || value.expected && (value.files.length !== value.expected.members.length || value.files.some(file => !value.expected!.members.some(member =>
      member.fileVersionId === file.fileVersionId && member.originalFileVersionId === file.originalFileVersionId && member.artifactType === file.artifactType)))) throw new Error("Repair delivery identity mismatch");
  return value;
}

import { z } from "zod";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const serviceRepairReceiptSchema = z.object({
  id: uuid, requestId: uuid, caseId: uuid, materialLineId: uuid, supersedesId: uuid.nullable(),
  acceptedScopeSha256: hash, contextSha256: hash, version: z.number().int().positive(),
}).strict();
export const serviceRepairSummarySchema = z.object({
  caseId: uuid, materialLineId: uuid, acceptedScopeSha256: hash, contextSha256: hash,
  originals: z.array(z.object({ artifactId: uuid, fileVersionId: uuid,
    artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), deliveredAt: time }).strict()).min(1).max(3),
  current: serviceRepairReceiptSchema.extend({ sourceSaved: z.boolean(), invalidatedAt: time.nullable(),
    approvedAt: time.nullable(), releaseId: uuid.nullable() }).strict().nullable(),
}).strict();
export type ServiceRepairSummary = z.infer<typeof serviceRepairSummarySchema>;
export type ServiceRepairReceipt = z.infer<typeof serviceRepairReceiptSchema>;
export type ServiceRepairBrowserRequest = { requestId: string; caseId: string; materialLineId: string;
  expectedVersionId: string | null; acceptedScopeSha256: string; contextSha256: string };

/** An exact saved opening is evidence of that request only, never approval to
 * generate or send files. No private wording is persisted in browser storage. */
export function matchesServiceRepairReceipt(raw: unknown, request: ServiceRepairBrowserRequest): raw is ServiceRepairReceipt {
  const parsed = serviceRepairReceiptSchema.safeParse(raw);
  return parsed.success && parsed.data.requestId === request.requestId && parsed.data.caseId === request.caseId
    && parsed.data.materialLineId === request.materialLineId && parsed.data.supersedesId === request.expectedVersionId
    && parsed.data.acceptedScopeSha256 === request.acceptedScopeSha256 && parsed.data.contextSha256 === request.contextSha256;
}

export function readServiceRepairSummary(raw: unknown, caseId: string, materialLineId: string): ServiceRepairSummary {
  const value = serviceRepairSummarySchema.parse(raw);
  if (value.caseId !== caseId || value.materialLineId !== materialLineId
    || new Set(value.originals.map(member => member.fileVersionId)).size !== value.originals.length
    || value.current && (value.current.caseId !== caseId || value.current.materialLineId !== materialLineId)) throw new Error("Repair identity mismatch");
  return value;
}

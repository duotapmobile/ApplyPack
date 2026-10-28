import { z } from "zod";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const repairFileIdentitySchema = z.object({ caseId: uuid, materialLineId: uuid, versionId: uuid }).strict();
export const repairFileExpectedSchema = repairFileIdentitySchema.extend({ sourceSha256: hash, reviewSha256: hash,
  acceptedScopeSha256: hash, contextSha256: hash, members: z.array(z.object({ originalFileVersionId: uuid,
    artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), originalSourceSha256: hash, packetSha256: hash,
    renderSourceSha256: hash }).strict()).min(1).max(3) }).strict();
export const repairFileRequestSchema = z.object({ requestId: uuid, expected: repairFileExpectedSchema }).strict();
export const repairFileHttpSchema = z.object({ operation: z.enum(["RENDER", "CHECK"]), request: repairFileRequestSchema }).strict();
export const repairFileViewSchema = repairFileIdentitySchema.extend({ status: z.enum(["WORDING_REQUIRED", "DISABLED", "BUSY", "READY", "REVIEW_READY"]),
  expected: repairFileExpectedSchema.nullable(), busyUntil: time.nullable(), memberSetSha256: hash.nullable(), deliveryAuthorized: z.literal(false) }).strict();
export const repairFileResultSchema = z.object({ status: z.enum(["REVIEW_READY", "BUSY", "DISABLED", "RESULT_UNKNOWN", "ABSENT"]),
  requestId: uuid, expected: repairFileExpectedSchema, memberSetSha256: hash.nullable(), busyUntil: time.nullable(),
  retryAllowed: z.boolean(), renderingAuthorized: z.literal(false), deliveryAuthorized: z.literal(false) }).strict();
export type RepairFileExpected = z.infer<typeof repairFileExpectedSchema>;
export type RepairFileRequest = z.infer<typeof repairFileRequestSchema>;
export type RepairFileView = z.infer<typeof repairFileViewSchema>;
export type RepairFileResult = z.infer<typeof repairFileResultSchema>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function distinct(value: RepairFileExpected) { return new Set(value.members.map(member => member.originalFileVersionId)).size === value.members.length; }
export function readRepairFileView(raw: unknown, identity: z.infer<typeof repairFileIdentitySchema>): RepairFileView {
  const value = repairFileViewSchema.parse(raw);
  if (value.caseId !== identity.caseId || value.materialLineId !== identity.materialLineId || value.versionId !== identity.versionId
    || value.expected && (value.expected.caseId !== identity.caseId || value.expected.materialLineId !== identity.materialLineId
      || value.expected.versionId !== identity.versionId || !distinct(value.expected))
    || (value.status === "WORDING_REQUIRED") !== (value.expected === null)
    || (value.status === "REVIEW_READY") !== (value.memberSetSha256 !== null)
    || (value.status === "BUSY") !== (value.busyUntil !== null)) throw new Error("REPAIR_FILE_VIEW_CHANGED");
  return value;
}
export function matchesRepairFileResult(raw: unknown, request: RepairFileRequest): raw is RepairFileResult {
  const result = repairFileResultSchema.safeParse(raw); if (!result.success) return false;
  const value = result.data;
  return value.requestId === request.requestId && same(value.expected, request.expected) && distinct(value.expected)
    && (value.status === "REVIEW_READY") === (value.memberSetSha256 !== null)
    && (value.status === "BUSY") === (value.busyUntil !== null)
    && value.retryAllowed === (value.status === "BUSY" || value.status === "DISABLED");
}

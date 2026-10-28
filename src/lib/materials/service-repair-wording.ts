import { z } from "zod";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const repairWordingIdentitySchema = z.object({ caseId: uuid, materialLineId: uuid, versionId: uuid }).strict();
const claimIdentity = z.object({ claimId: uuid, wordingSha256: hash }).strict();
export const repairWordingExpectedSchema = repairWordingIdentitySchema.extend({ sourceSha256: hash, acceptedScopeSha256: hash,
  contextSha256: hash, members: z.array(z.object({ originalFileVersionId: uuid, renderSourceSha256: hash,
    claims: z.array(claimIdentity).min(1).max(250) }).strict()).min(1).max(3) }).strict();
export const repairWordingRequestSchema = z.object({ requestId: uuid, expected: repairWordingExpectedSchema,
  decisions: z.array(z.object({ originalFileVersionId: uuid, claimId: claimIdentity.shape.claimId,
    wordingSha256: hash, decision: z.literal("APPROVED") }).strict()).min(1).max(750) }).strict();
export const repairWordingHttpSchema = z.object({ operation: z.enum(["SUBMIT", "CHECK"]), request: repairWordingRequestSchema }).strict();
const evidence = z.object({ label: z.string().max(400), value: z.string().max(16000) }).strict();
export const repairWordingViewSchema = z.object({ expected: repairWordingExpectedSchema, reviewed: z.boolean(),
  members: z.array(z.object({ originalFileVersionId: uuid, artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]),
    claims: z.array(claimIdentity.extend({ placement: z.string().max(200), text: z.string().max(16000), qualification: z.string().max(100),
      sources: z.array(evidence).max(750), jobEvidence: z.array(z.string().max(16000)).max(40),
      questions: z.array(z.object({ id: z.string().max(200), prompt: z.string().max(16000) }).strict()).max(100) }).strict()).min(1).max(250)
  }).strict()).min(1).max(3), renderingAuthorized: z.literal(false), deliveryAuthorized: z.literal(false) }).strict();
export const repairWordingResultSchema = z.object({ status: z.enum(["RECORDED", "ABSENT"]), requestId: uuid,
  expected: repairWordingExpectedSchema, reviewSha256: hash.nullable(), renderingAuthorized: z.literal(false), deliveryAuthorized: z.literal(false) }).strict();
export type RepairWordingExpected = z.infer<typeof repairWordingExpectedSchema>;
export type RepairWordingRequest = z.infer<typeof repairWordingRequestSchema>;
export type RepairWordingView = z.infer<typeof repairWordingViewSchema>;
export type RepairWordingResult = z.infer<typeof repairWordingResultSchema>;
export function matchesRepairWordingResult(raw: unknown, request: RepairWordingRequest): raw is RepairWordingResult {
  const value = repairWordingResultSchema.safeParse(raw);
  return value.success && value.data.requestId === request.requestId && JSON.stringify(value.data.expected) === JSON.stringify(request.expected)
    && (value.data.status === "RECORDED" ? value.data.reviewSha256 !== null : value.data.reviewSha256 === null);
}
export function readRepairWordingView(raw: unknown, identity: z.infer<typeof repairWordingIdentitySchema>): RepairWordingView {
  const view = repairWordingViewSchema.parse(raw), expected = view.expected;
  if (expected.caseId !== identity.caseId || expected.materialLineId !== identity.materialLineId || expected.versionId !== identity.versionId
    || new Set(expected.members.map(member => member.originalFileVersionId)).size !== expected.members.length
    || view.members.length !== expected.members.length || view.members.some((member, index) => member.originalFileVersionId !== expected.members[index].originalFileVersionId
      || JSON.stringify(member.claims.map(({ claimId, wordingSha256 }) => ({ claimId, wordingSha256 }))) !== JSON.stringify(expected.members[index].claims)
      || new Set(member.claims.map(claim => claim.claimId)).size !== member.claims.length)) throw new Error("REPAIR_WORDING_VIEW_CHANGED");
  return view;
}

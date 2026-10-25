import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { draftingEvidenceExpectationSchema, type DraftingEvidencePacket } from "./drafting-evidence";
import { serializeDraftRenderSource } from "./draft-render-source";
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export class DraftRenderSourceStorageError extends Error {
 constructor(readonly code: string) { super(`DRAFT_RENDER_STORAGE_${code}`); }
}
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftRenderSourceStorageError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T { const result = schema.safeParse(value); ensure(result.success, code); return result.data; }
const factRefSchema = z.object({ factId: uuid, field: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}(\.[0-9]{1,3})?$/), valueSha256: hash, attributionFactId: uuid }).strict();
export const renderClaimSchema = z.object({ claimId: uuid, placement: z.string().min(1).max(180), text: z.string().min(1).max(3000), wordingSha256: hash,
  kind: z.enum(["CANDIDATE_FACT", "JOB_EVIDENCE", "MIXED", "NARRATIVE"]),
  origin: z.enum(["MODEL_PROPOSAL", "LOCAL_FACT", "LOCAL_JOB", "LOCAL_CONTACT", "CUSTOMER_PRESENTATION", "FIXED_PRESENTATION"]),
  qualification: z.enum(["EXACT", "QUALIFIED_TRANSFER", "NONFACTUAL"]), factRefs: z.array(factRefSchema).max(40), jobEvidenceIds: z.array(uuid).max(40), referencePermissionIds: z.array(uuid).max(3),
  contactBinding: z.object({ payloadId: uuid, contentSha256: hash, fields: z.array(z.string().min(1).max(60)).max(6) }).strict().nullable(),
  questionInsights: z.array(z.object({ questionId: uuid, observationId: uuid, promptSha256: hash,
    interpretation: z.literal("POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION") }).strict()).max(8), state: z.literal("OWNER_REVIEW_REQUIRED") }).strict();
const claims = z.array(renderClaimSchema).max(250);
const renderSourceSchema = z.object({ schemaVersion: z.literal("applypack-draft-render-source-v1"), expected: draftingEvidenceExpectationSchema,
  packetSha256: hash, proposalSourceSha256: hash, contactPayloadId: uuid, contactSha256: hash, finalVersionAt: time, validUntil: time, language: z.literal("en-US"),
  outputRules: z.object({ formats: z.array(z.enum(["PDF", "DOCX"])).min(1).max(2), resumePageLimit: z.number().int().positive().nullable(), letterPageLimit: z.number().int().positive().nullable() }).strict(),
  resume: z.object({ header: claims, summary: claims, skills: claims,
    sections: z.array(z.object({ heading: z.string().min(1).max(120), anchorFactId: uuid, header: claims, bullets: claims }).strict()).max(30),
    education: z.array(z.object({ heading: z.literal("Education and credentials"), anchorFactId: uuid, header: claims }).strict()).max(20),
    careerBreak: z.object({ choice: z.string().min(1).max(60), sourceFactId: uuid, selection: z.enum(["OWNER_SELECTED", "UNIQUE_CONFIRMED_SOURCE"]), label: renderClaimSchema, dates: renderClaimSchema }).strict().nullable() }).strict(),
  coverLetter: z.object({ header: claims, date: z.string().min(1).max(80), recipient: renderClaimSchema, subject: renderClaimSchema, salutation: z.literal("Dear Hiring Team,"),
    introduction: renderClaimSchema, body: z.array(claims).min(1).max(3), closing: renderClaimSchema, signoff: z.literal("Sincerely,"), signature: renderClaimSchema }).strict(),
  ownerReviewClaims: claims, state: z.literal("OWNER_REVIEW_REQUIRED"), deliveryAuthorized: z.literal(false) }).strict();
function exact(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exact).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${exact(object[key])}`).join(",")}}`;
  }
  throw new DraftRenderSourceStorageError("JSON_INVALID");
}


/** Strict decoding shared by owner actions and the private read model. A digest alone is never a shape or factual approval. */
export function readStoredDraftRenderSource(saved: { body: string; value: unknown }, sourceSha256: string, packet: DraftingEvidencePacket, now: () => Date) {
    const source = { ...parse(renderSourceSchema, saved.value, "SOURCE_INVALID"), renderSourceSha256: sourceSha256 };
    ensure(serializeDraftRenderSource(source) === saved.body && exact(source.expected) === exact(packet.expected)
      && source.packetSha256 === packet.packetSha256 && source.contactPayloadId === packet.binding.contactPayloadId && source.contactSha256 === packet.binding.contactSha256
      && exact(source.outputRules) === exact(packet.providerView.outputRules) && Date.parse(source.validUntil) === Date.parse(packet.validUntil)
      && Date.parse(source.validUntil) > now().getTime() && Date.parse(source.finalVersionAt) <= now().getTime(), "SOURCE_STALE");
    const visibleClaims = [...source.resume.header, ...source.resume.summary, ...source.resume.skills, ...source.resume.sections.flatMap((section) => [...section.header, ...section.bullets]),
      ...source.resume.education.flatMap((section) => section.header), ...(source.resume.careerBreak ? [source.resume.careerBreak.label, source.resume.careerBreak.dates] : []),
      ...source.coverLetter.header, source.coverLetter.recipient, source.coverLetter.subject, source.coverLetter.introduction, ...source.coverLetter.body.flat(), source.coverLetter.closing, source.coverLetter.signature];
    const byId = new Map(source.ownerReviewClaims.map((claim) => [claim.claimId, claim]));
    ensure(byId.size === source.ownerReviewClaims.length && visibleClaims.length === byId.size && new Set(visibleClaims.map((claim) => claim.claimId)).size === byId.size
      && visibleClaims.every((claim) => exact(claim) === exact(byId.get(claim.claimId)) && digest(claim.text) === claim.wordingSha256), "CLAIM_SET_INVALID");
    return source;
  }

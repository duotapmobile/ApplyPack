import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { draftingEvidenceExpectationSchema, type DraftingEvidencePacket } from "./drafting-evidence";
import { serializeDraftRenderSource } from "./draft-render-source";
import { DRAFT_REFERENCE_FIELDS, draftReferenceBindingSchema } from "./draft-reference-source";
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export class DraftRenderSourceStorageError extends Error {
 constructor(readonly code: string) { super(`DRAFT_RENDER_STORAGE_${code}`); }
}
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftRenderSourceStorageError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T { const result = schema.safeParse(value); ensure(result.success, code); return result.data; }
const factRefSchema = z.object({ factId: uuid, field: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}(\.[0-9]{1,3})?$/), valueSha256: hash, attributionFactId: uuid }).strict();
export const renderClaimSchema = z.object({ claimId: uuid, placement: z.string().min(1).max(180), text: z.string().min(1).max(3000), wordingSha256: hash,
  kind: z.enum(["CANDIDATE_FACT", "JOB_EVIDENCE", "MIXED", "NARRATIVE", "REFERENCE_PERMISSION"]),
  origin: z.enum(["MODEL_PROPOSAL", "OWNER_EDIT", "LOCAL_FACT", "LOCAL_JOB", "LOCAL_CONTACT", "CUSTOMER_PRESENTATION", "FIXED_PRESENTATION", "LOCAL_REFERENCE"]),
  qualification: z.enum(["EXACT", "QUALIFIED_TRANSFER", "NONFACTUAL"]), factRefs: z.array(factRefSchema).max(40), jobEvidenceIds: z.array(uuid).max(40), referencePermissionIds: z.array(uuid).max(3),
  contactBinding: z.object({ payloadId: uuid, contentSha256: hash, fields: z.array(z.string().min(1).max(60)).max(6) }).strict().nullable(),
  referenceBinding: z.object({ permissionId: uuid, recordVersionId: uuid, payloadId: uuid, contentSha256: hash, field: z.enum(DRAFT_REFERENCE_FIELDS) }).strict().optional(),
  questionInsights: z.array(z.object({ questionId: uuid, observationId: uuid, promptSha256: hash,
    interpretation: z.literal("POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION") }).strict()).max(8), state: z.literal("OWNER_REVIEW_REQUIRED") }).strict();
const claims = z.array(renderClaimSchema).max(250);
const renderSourceSchema = z.object({ schemaVersion: z.literal("applypack-draft-render-source-v1"), expected: draftingEvidenceExpectationSchema,
  ownerEdit: z.object({ schemaVersion: z.literal("applypack-owner-draft-edit-v1"), requestId: uuid, requestSha256: hash,
    priorVersionId: uuid, priorSourceSha256: hash, originalProposalSourceSha256: hash, reviewerId: uuid, editedAt: time,
    validatedOutputSha256: hash, changedPlacements: z.array(z.string().regex(/^(?:resume\.(?:summary\.\d+|skills\.\d+|sections\.\d+\.bullets\.\d+)|coverLetter\.body\.\d+\.sentences\.\d+)$/)).min(1).max(250) }).strict().optional(),
  packetSha256: hash, proposalSourceSha256: hash, contactPayloadId: uuid, contactSha256: hash, finalVersionAt: time, validUntil: time, language: z.literal("en-US"),
  outputRules: z.object({ formats: z.array(z.enum(["PDF", "DOCX"])).min(1).max(2), resumePageLimit: z.number().int().positive().nullable(), letterPageLimit: z.number().int().positive().nullable() }).strict(),
  resume: z.object({ header: claims, summary: claims, skills: claims,
    sections: z.array(z.object({ heading: z.string().min(1).max(120), anchorFactId: uuid, header: claims, bullets: claims }).strict()).max(30),
    education: z.array(z.object({ heading: z.literal("Education and credentials"), anchorFactId: uuid, header: claims }).strict()).max(20),
    careerBreak: z.object({ choice: z.string().min(1).max(60), sourceFactId: uuid, selection: z.enum(["OWNER_SELECTED", "UNIQUE_CONFIRMED_SOURCE"]), label: renderClaimSchema, dates: renderClaimSchema }).strict().nullable() }).strict(),
  coverLetter: z.object({ header: claims, date: z.string().min(1).max(80), recipient: renderClaimSchema, subject: renderClaimSchema, salutation: z.literal("Dear Hiring Team,"),
    introduction: renderClaimSchema, body: z.array(claims).min(1).max(3), closing: renderClaimSchema, signoff: z.literal("Sincerely,"), signature: renderClaimSchema }).strict(),
  referenceSheet: z.object({ header: claims, records: z.array(z.object({ permissionId: uuid, recordVersionId: uuid, payloadId: uuid, contentSha256: hash,
    fields: z.array(renderClaimSchema).min(6).max(7) }).strict()).min(1).max(3) }).strict().optional(),
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
    const permissions = packet.binding.referencePermissions;
    ensure(!source.ownerReviewClaims.some((claim) => claim.origin === "OWNER_EDIT") || source.ownerEdit, "OWNER_EDIT_LINEAGE_MISSING");
    if (source.ownerEdit) ensure(source.ownerEdit.originalProposalSourceSha256 === source.proposalSourceSha256
      && source.ownerEdit.editedAt === source.finalVersionAt && Date.parse(source.ownerEdit.editedAt) <= now().getTime()
      && source.ownerEdit.priorSourceSha256 !== sourceSha256 && new Set(source.ownerEdit.changedPlacements).size === source.ownerEdit.changedPlacements.length
      && source.ownerReviewClaims.filter((claim) => claim.origin === "OWNER_EDIT").every((claim) => claim.contactBinding === null && !claim.referenceBinding
        && claim.factRefs.length > 0 && /^(?:resume\.(?:summary\.|skills\.|sections\.\d+\.bullets\.)|coverLetter\.body\.\d+\.sentences\.)/.test(claim.placement)), "OWNER_EDIT_LINEAGE_INVALID");
    ensure(Boolean(source.referenceSheet) === Boolean(permissions.length), "REFERENCE_SCOPE_INVALID");
    if (source.referenceSheet) {
      const rawBindings = "referenceBindings" in packet.ownerEvidence ? packet.ownerEvidence.referenceBindings : undefined;
      const bindings = parse(z.array(draftReferenceBindingSchema).min(1).max(3), rawBindings, "REFERENCE_BINDING_INVALID");
      ensure(bindings.length === permissions.length && source.referenceSheet.records.length === bindings.length
        && new Set(source.referenceSheet.records.map((row) => row.permissionId)).size === bindings.length
        && source.referenceSheet.header.every((claim) => claim.origin === "LOCAL_CONTACT" && !claim.referenceBinding), "REFERENCE_SCOPE_INVALID");
      source.referenceSheet.records.forEach((row, index) => {
        const binding = bindings.find((entry) => entry.permissionId === row.permissionId), permission = permissions.find((entry) => entry.id === row.permissionId);
        ensure(binding && permission && permission.reference_record_version_id === binding.recordVersionId
          && binding.recordVersionId === row.recordVersionId && binding.payloadId === row.payloadId && binding.contentSha256 === row.contentSha256
          && binding.deliveredReleaseId === permission.delivered_release_id && binding.jobSnapshotId === packet.binding.jobSnapshotId
          && binding.jobSha256 === packet.binding.jobSha256 && Date.parse(binding.permissionConfirmedAt) <= now().getTime(), "REFERENCE_BINDING_INVALID");
        const fields = row.fields.map((claim) => claim.referenceBinding?.field);
        ensure(exact(fields) === exact(DRAFT_REFERENCE_FIELDS.slice(0, fields.length)), "REFERENCE_FIELDS_INVALID");
        ensure(row.fields.every((claim) => claim.kind === "REFERENCE_PERMISSION" && claim.origin === "LOCAL_REFERENCE" && claim.qualification === "EXACT"
          && claim.factRefs.length === 0 && claim.jobEvidenceIds.length === 0 && claim.contactBinding === null && claim.questionInsights.length === 0
          && exact(claim.referencePermissionIds) === exact([row.permissionId]) && claim.referenceBinding?.permissionId === row.permissionId
          && claim.referenceBinding.recordVersionId === row.recordVersionId && claim.referenceBinding.payloadId === row.payloadId
          && claim.referenceBinding.contentSha256 === row.contentSha256 && claim.placement === `referenceSheet.records.${index}.${claim.referenceBinding.field}`), "REFERENCE_CLAIM_INVALID");
      });
    }
    const visibleClaims = [...source.resume.header, ...source.resume.summary, ...source.resume.skills, ...source.resume.sections.flatMap((section) => [...section.header, ...section.bullets]),
      ...source.resume.education.flatMap((section) => section.header), ...(source.resume.careerBreak ? [source.resume.careerBreak.label, source.resume.careerBreak.dates] : []),
      ...source.coverLetter.header, source.coverLetter.recipient, source.coverLetter.subject, source.coverLetter.introduction, ...source.coverLetter.body.flat(), source.coverLetter.closing, source.coverLetter.signature,
      ...(source.referenceSheet ? [...source.referenceSheet.header, ...source.referenceSheet.records.flatMap((row) => row.fields)] : [])];
    const byId = new Map(source.ownerReviewClaims.map((claim) => [claim.claimId, claim]));
    ensure(byId.size === source.ownerReviewClaims.length && visibleClaims.length === byId.size && new Set(visibleClaims.map((claim) => claim.claimId)).size === byId.size
      && visibleClaims.every((claim) => exact(claim) === exact(byId.get(claim.claimId)) && digest(claim.text) === claim.wordingSha256), "CLAIM_SET_INVALID");
    ensure(source.ownerReviewClaims.every((claim) => Boolean(claim.referenceBinding) === (claim.origin === "LOCAL_REFERENCE")
      && (claim.origin === "LOCAL_REFERENCE" || claim.kind !== "REFERENCE_PERMISSION" && claim.referencePermissionIds.length === 0)), "REFERENCE_CLAIM_INVALID");
    return source;
  }

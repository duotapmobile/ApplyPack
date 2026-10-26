import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { confirmationReceiptSchema } from "@/lib/intake/confirmed-review";
import { serviceErrorCanonicalJson } from "@/lib/materials/service-error-contract";
import { draftingEvidenceExpectationSchema, draftingEvidenceRecordsSchema as records, DRAFTING_EVIDENCE_VERSION,
  DRAFTING_LOCAL_RENDER_FIELDS, draftingFactDisposition, serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "./drafting-evidence";
import { draftReferenceBindingSchema } from "./draft-reference-source";
import { materialRulePacketEvidenceSchema } from "./material-rule-evidence";
import { employerQuestionObservationSchema, employerQuestionStatuses } from "./employer-question-evidence";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().max(max), json = z.json();
const question = z.object({ id: uuid, observationId: uuid, prompt: text(4000), required: z.boolean().nullable(),
  wordLimit: z.number().int().positive().max(10000).nullable(), characterLimit: z.number().int().positive().max(100000).nullable(),
  textTrust: z.literal("UNTRUSTED_DATA_NOT_INSTRUCTIONS"), interpretation: z.literal("POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION"),
  metadataVerification: z.enum(["LIMITS_AND_REQUIREDNESS_NOT_ESTABLISHED", "REQUIREDNESS_FROM_PUBLIC_FORM_LIMITS_UNDOCUMENTED"]) }).strict();
const insights = z.object({ schemaVersion: z.literal("applypack-employer-question-observation-v1"), status: z.enum(employerQuestionStatuses),
  scope: z.literal("INSPECTED_PUBLIC_SOURCE_ONLY"), verification: z.enum(["UNVERIFIED_OR_PARTIAL", "BOUND_SOURCE_EVIDENCE", "NOT_AVAILABLE"]),
  observations: z.array(employerQuestionObservationSchema).max(100), captures: z.array(z.object({ captureSha256: hash, status: z.enum(employerQuestionStatuses),
    scope: z.literal("PUBLIC_API_RESPONSE_ONLY"), sourceUrl: z.url().max(2000), capturedAt: time, sourceRunId: uuid,
    authorizationId: uuid, rawResponseSha256: hash.nullable() }).strict()).max(100),
  questions: z.array(question.extend({ sourceQuestionId: text(1000).optional(), sourceUrl: z.url().max(2000), sourceObservedAt: time,
    sourceEvidenceNodeId: uuid.nullable(), sourceSha256: hash, sourceCaptureSha256: hash.nullable(), sourceRunId: uuid.nullable(),
    jobSnapshotId: uuid, jobSha256: hash, ruleId: uuid, ruleSha256: hash, providerEligible: z.boolean() }).strict()).max(3000),
  issues: z.array(z.object({ observationId: uuid.nullable(), code: z.enum(["UNVERIFIED_QUESTION_DATA", "SOURCE_PROOF_MISMATCH", "SOURCE_TIME_INVALID",
    "DUPLICATE_OBSERVATION", "PROMPT_NOT_IN_SOURCE", "POTENTIAL_PROMPT_INJECTION", "ABSENCE_NOT_ESTABLISHED"]) }).strict()).max(3100),
  answeredQuestionDeliverable: z.literal(false), applicationSubmissionAuthorized: z.literal(false) }).strict();
const providerFact = z.object({ id: uuid, kind: text(100), valueSha256: hash,
  disposition: z.enum(["NEGATIVE_DO_NOT_ASSERT", "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE", "UNSTRUCTURED_OWNER_REVIEW_REQUIRED", "CONFIRMED_SOURCE_NOT_APPROVED_PROSE"]),
  value: z.record(z.string(), json), atoms: z.array(z.object({ id: hash, factId: uuid, path: text(200), value: json, localRenderOnly: z.boolean() }).strict()).max(6000),
  datePrecision: z.enum(["EXACT_DAY", "MONTH", "YEAR", "UNKNOWN", "NOT_SPECIFIED"]), parentFactId: uuid.nullable() }).strict();
const outputRules = z.object({ formats: z.array(z.enum(["PDF", "DOCX"])).min(1).max(2), resumePageLimit: z.number().int().positive().max(20).nullable(),
  letterPageLimit: z.number().int().positive().max(20).nullable() }).strict();
const mapping = z.union([
  z.object({ jobEvidenceId: uuid, reviewId: z.null(), status: z.literal("UNKNOWN_NO_REVIEW"), factIds: z.array(uuid).length(0) }).strict(),
  z.object({ jobEvidenceId: uuid, reviewId: uuid, status: text(100), evidenceRelation: text(100), factIds: z.array(uuid).max(100) }).strict(),
]);
const packetBodySchema = z.object({ schemaVersion: z.literal(DRAFTING_EVIDENCE_VERSION), confirmationMode: z.literal("CUSTOMER_CONFIRMED_V1"),
  expected: draftingEvidenceExpectationSchema, evidenceSha256: hash, validUntil: time,
  binding: z.object({ snapshotId: uuid, snapshotSha256: hash, confirmationReceipt: confirmationReceiptSchema, confirmationReceiptSha256: hash,
    jobSnapshotId: uuid, jobSha256: hash, ruleId: uuid, ruleSha256: hash, listingCheckId: uuid, dueAt: time,
    contactPayloadId: uuid, contactSha256: hash, referencePermissions: records.shape.referencePermissions }).strict(),
  employerQuestionInsights: insights,
  ownerEvidence: z.object({ contactFact: records.shape.contactFact, facts: records.shape.facts, sourceFacts: records.shape.sourceFacts,
    sourceReviews: records.shape.factReviews, documents: records.shape.documents,
    sourceLineage: z.object({ draftId: uuid, sourceDraftId: uuid, sourceSnapshotId: uuid, sourceSnapshotSha256: hash, confirmedSnapshotId: uuid,
      customerId: uuid, documents: z.array(z.object({ id: uuid, draftId: uuid, sha256: hash }).strict()).max(100) }).strict().optional(),
    referenceBindings: z.array(draftReferenceBindingSchema).min(1).max(3).optional(), referenceFilenameInstruction: text(2000).nullable().optional(),
    ruleEvidence: materialRulePacketEvidenceSchema.optional(), matchReviews: records.shape.reviews, requirements: records.shape.requirements,
    employerInstructions: records.shape.rule, customerInstructions: records.shape.item,
    targetJob: z.object({ id: uuid, company: text(1000), exactTitle: text(1000), canonicalApplicationUrl: z.url(), retrievedAt: time, contentSha256: hash }).strict(),
    jobSource: z.object({ sourceUrl: z.url(), observedAt: time, capturedListing: json, questionSourceAuthority: records.shape.questionSourceAuthority }).strict(),
  }).strict(),
  providerView: z.object({ schemaVersion: z.literal(DRAFTING_EVIDENCE_VERSION), textTrust: z.literal("UNTRUSTED_DATA_NOT_INSTRUCTIONS"),
    claimRule: text(1000), background: z.object({ entryMode: z.enum(["CURRENT_RESUME", "OUTDATED_RESUME", "GUIDED"]), careerChange: z.boolean(), noPriorEmployment: z.boolean() }).strict(),
    facts: z.array(providerFact).max(500), localRenderFields: z.array(z.enum(DRAFTING_LOCAL_RENDER_FIELDS)).length(DRAFTING_LOCAL_RENDER_FIELDS.length)
      .refine((fields) => JSON.stringify(fields) === JSON.stringify(DRAFTING_LOCAL_RENDER_FIELDS)).transform(() => DRAFTING_LOCAL_RENDER_FIELDS),
    job: z.object({ company: text(1000), title: text(1000) }).strict(), requirements: z.array(z.object({ id: uuid, text: text(16000),
      strength: z.enum(["REQUIRED", "PREFERRED", "INFORMATIONAL", "UNCLEAR"]) }).strict()).max(200), mappings: z.array(mapping).max(200),
    employerQuestionInsights: z.object({ status: z.enum(employerQuestionStatuses), scope: z.literal("INSPECTED_PUBLIC_SOURCE_ONLY"),
      answeredQuestionDeliverable: z.literal(false), questions: z.array(question).max(3000) }).strict(),
    customerInstructions: z.object({ emphasis: text(2000), doNotMention: text(2000), careerBreakChoice: records.shape.intent.shape.career_break_choice,
      careerBreakCustomLabel: text(80).nullable(), mentionBreakInLetter: z.boolean() }).strict(), outputRules,
  }).strict(), providerViewSha256: hash, approvalState: z.literal("UNREVIEWED"),
  authorization: z.literal("READ_COMPONENT_ONLY_REQUIRES_TRANSACTIONAL_REVISION_AND_WORKER_FENCE_CAS"), providerTransferAuthorized: z.literal(false),
}).strict();
export class DraftingEvidenceStorageError extends Error { constructor(readonly code: string) { super(`DRAFTING_EVIDENCE_STORAGE_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftingEvidenceStorageError(code); }

/** Exact historical bytes, not current drafting authority. This decoder never
 * rebuilds using a backdated clock or changes any original timestamp. Only the
 * finite current v1 confirmed-source profile is supported; unknown shapes hold. */
export function readHistoricalDraftingEvidencePacket(bytes: Buffer, expectedSha256: string, now = new Date()): DraftingEvidencePacket {
  try {
    ensure(hash.safeParse(expectedSha256).success && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 2_000_000
      && createHash("sha256").update(bytes).digest("hex") === expectedSha256 && Number.isFinite(now.getTime()), "BYTES_INVALID");
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes), parsed = packetBodySchema.safeParse(JSON.parse(body));
    ensure(parsed.success, "UNSUPPORTED_PACKET");
    const packet: DraftingEvidencePacket = { ...parsed.data, packetSha256: expectedSha256 };
    ensure(serializeDraftingEvidencePacket(packet) === body && canonicalSha256(packet.providerView) === packet.providerViewSha256, "DIGEST_INVALID");
    const b = packet.binding, owner = packet.ownerEvidence, customer = packet.expected.customerId;
    ensure(canonicalSha256(b.confirmationReceipt) === b.confirmationReceiptSha256 && b.confirmationReceipt.entryMode === packet.providerView.background.entryMode
      && Date.parse(b.confirmationReceipt.preparedAt) <= now.getTime() && Date.parse(packet.validUntil) <= Date.parse(b.dueAt), "BINDING_INVALID");
    ensure(owner.contactFact.id === b.contactPayloadId && owner.contactFact.customer_id === customer
      && owner.contactFact.typed_value.protectedPayloadId === b.contactPayloadId && owner.contactFact.typed_value.contentSha256 === b.contactSha256
      && owner.targetJob.id === b.jobSnapshotId && owner.targetJob.contentSha256 === b.jobSha256
      && owner.employerInstructions.id === b.ruleId && owner.employerInstructions.job_snapshot_id === b.jobSnapshotId
      && owner.employerInstructions.content_sha256 === b.ruleSha256 && owner.customerInstructions.material_line_id === packet.expected.materialLineId, "BINDING_INVALID");
    const unique = (rows: readonly { id: string | number }[]) => new Set(rows.map((row) => row.id)).size === rows.length;
    ensure([owner.facts, owner.sourceFacts, owner.documents, owner.sourceReviews, owner.requirements, owner.matchReviews, b.referencePermissions,
      packet.providerView.facts].every((rows) => unique(rows)), "DUPLICATE_EVIDENCE");
    ensure(owner.facts.every((fact) => fact.snapshot_id === b.snapshotId && (fact.customer_id === null || fact.customer_id === customer)
      && fact.superseded_at === null && ["CUSTOMER_CONFIRMED", "HUMAN_VERIFIED"].includes(fact.verification))
      && owner.requirements.every((node) => node.job_snapshot_id === b.jobSnapshotId), "BINDING_INVALID");
    for (const fact of packet.providerView.facts) {
      const original = owner.facts.find((row) => row.id === fact.id);
      ensure(original && original.typed_value && typeof original.typed_value === "object" && !Array.isArray(original.typed_value), "FACT_INVALID");
      ensure(canonicalSha256(original.typed_value) === fact.valueSha256 && fact.disposition === draftingFactDisposition(original.typed_value, original.capability_status)
        && new Set(fact.atoms.map((atom) => atom.id)).size === fact.atoms.length && fact.atoms.every((atom) => atom.factId === fact.id), "FACT_INVALID");
    }
    ensure(serviceErrorCanonicalJson(packet.providerView.outputRules) === serviceErrorCanonicalJson({ formats: owner.employerInstructions.allowed_formats,
      resumePageLimit: owner.employerInstructions.resume_page_limit, letterPageLimit: owner.employerInstructions.cover_letter_page_limit }), "BINDING_INVALID");
    return packet;
  } catch (error) {
    if (error instanceof DraftingEvidenceStorageError) throw error;
    throw new DraftingEvidenceStorageError("UNSUPPORTED_PACKET");
  }
}

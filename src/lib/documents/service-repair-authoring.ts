import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { draftOutputSchema, validateRecordedDraftOutput } from "./draft-output";
import { buildRecordedDraftOwnerEditModel, exactOwnerEditJson } from "./draft-owner-edit";
import { serializeDraftRenderSource, type DraftRenderSource, type DraftRenderText } from "./draft-render-source";
import type { DraftingEvidencePacket } from "./drafting-evidence";
import { readBoundDraftRenderEvidence } from "./draft-render-source-storage";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const serviceRepairAuthoringRequestSchema = z.object({ requestId: uuid, repairVersionId: uuid,
  originalFileVersionId: uuid, originalDraftVersionId: uuid, expectedSourceSha256: hash,
  artifactType: z.enum(["RESUME", "COVER_LETTER"]), output: draftOutputSchema }).strict();
export type ServiceRepairAuthoringRequest = z.infer<typeof serviceRepairAuthoringRequestSchema>;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const same = (a: unknown, b: unknown) => exactOwnerEditJson(a) === exactOwnerEditJson(b);
export class ServiceRepairAuthoringError extends Error { constructor(readonly code: string) { super(`SERVICE_REPAIR_AUTHORING_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceRepairAuthoringError(code); }
const prefix = (type: ServiceRepairAuthoringRequest["artifactType"]) => type === "RESUME" ? "resume" : "coverLetter";

/** Local, selected-prose authoring only. The connected owner adapter must bind
 * request/version/file IDs to the current accepted099 inspection and immutable
 * original source before saving an encrypted envelope. Local identity, dates,
 * credentials, contact, references and all unselected content remain unchanged.
 * Unsupported original claims may be removed; replacement claims must satisfy
 * the same negative/unknown/attribution/number/question fences as new drafts. */
export function buildServiceRepairAuthoredSource(input: { request: unknown; source: DraftRenderSource;
  packet: DraftingEvidencePacket; reviewerId: string }, now = new Date()): DraftRenderSource {
  try {
    const request = serviceRepairAuthoringRequestSchema.parse(input.request), reviewerId = uuid.parse(input.reviewerId);
    ensure(Number.isFinite(now.getTime()), "CLOCK_INVALID");
    const body = serializeDraftRenderSource(input.source);
    const source = readBoundDraftRenderEvidence({ body, value: JSON.parse(body) }, request.expectedSourceSha256, input.packet, () => now);
    ensure(source.renderSourceSha256 === request.expectedSourceSha256, "SOURCE_CHANGED");
    const prior = buildRecordedDraftOwnerEditModel(source, input.packet).output, artifact = prefix(request.artifactType);
    ensure(same(request.output[artifact === "resume" ? "coverLetter" : "resume"], prior[artifact === "resume" ? "coverLetter" : "resume"]), "UNSELECTED_CONTENT_CHANGED");
    ensure(same(request.output.resume.sections.map(section => section.anchorFactId), prior.resume.sections.map(section => section.anchorFactId))
      && same(request.output.resume.educationFactIds, prior.resume.educationFactIds), "LOCAL_FIELDS_IMMUTABLE");
    ensure(!same(request.output[artifact], prior[artifact]), "NO_CHANGES");
    const proposal = validateRecordedDraftOutput(request.output, input.packet, now, source.changeRequest);
    const reviews = new Map(proposal.reviews.map(review => [review.placement, review]));
    const facts = new Map(input.packet.ownerEvidence.facts.map(fact => [fact.id, fact]));
    const previous = new Map(source.ownerReviewClaims.map(claim => [claim.placement, claim]));
    const changed = new Set<string>();
    const requestSha256 = sha(exactOwnerEditJson(request));
    function prose(placement: string): DraftRenderText {
      const review = reviews.get(placement); ensure(review, "CLAIM_MISSING");
      const factRefs = review.sources.map(ref => {
        const field = ref.path.replace(/^\//, "").replaceAll("/", "."), fact = facts.get(ref.factId);
        ensure(fact && /^[A-Za-z][A-Za-z0-9_]{0,59}(\.[0-9]{1,3})?$/.test(field), "SOURCE_INVALID");
        const value = field.split(".").reduce<unknown>((parent, key) => parent && typeof parent === "object" ? (parent as Record<string, unknown>)[key] : undefined, fact.typed_value);
        ensure(typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) && !/[eE]/.test(JSON.stringify(value)), "SOURCE_INVALID");
        return { factId: ref.factId, field, valueSha256: sha(JSON.stringify(value)), attributionFactId: review.attributionFactId ?? ref.factId };
      });
      const digest = sha(`${requestSha256}:${placement}`), old = previous.get(placement);
      const next: DraftRenderText = { claimId: `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
        placement, text: review.text, wordingSha256: sha(review.text), kind: review.jobEvidenceIds.length ? "MIXED" : "CANDIDATE_FACT",
        origin: "OWNER_EDIT", qualification: review.relation === "DIRECT" ? "EXACT" : "QUALIFIED_TRANSFER", factRefs,
        jobEvidenceIds: [...review.jobEvidenceIds], referencePermissionIds: [], contactBinding: null,
        questionInsights: review.questionInsights, state: "OWNER_REVIEW_REQUIRED" };
      const comparable = (claim: DraftRenderText) => ({ text: claim.text, qualification: claim.qualification, factRefs: claim.factRefs,
        jobEvidenceIds: claim.jobEvidenceIds, questionInsights: claim.questionInsights });
      if (old && same(comparable(old), comparable(next))) return structuredClone(old);
      changed.add(placement); return next;
    }
    const detached: { -readonly [K in keyof Omit<DraftRenderSource, "renderSourceSha256">]: Omit<DraftRenderSource, "renderSourceSha256">[K] } = JSON.parse(body);
    const generated: DraftRenderText[] = [];
    const collect = (placement: string) => { const claim = prose(placement); generated.push(claim); return claim; };
    if (artifact === "resume") {
      detached.resume = { ...detached.resume, summary: proposal.output.resume.summary.map((_, index) => collect(`resume.summary.${index}`)),
        skills: proposal.output.resume.skills.map((_, index) => collect(`resume.skills.${index}`)),
        sections: detached.resume.sections.map((section, index) => ({ ...section,
          bullets: proposal.output.resume.sections[index].bullets.map((_, item) => collect(`resume.sections.${index}.bullets.${item}`)) })) };
    } else detached.coverLetter = { ...detached.coverLetter, body: proposal.output.coverLetter.body.map((paragraph, index) =>
      paragraph.sentences.map((_, item) => collect(`coverLetter.body.${index}.sentences.${item}`))) };
    const isSelectedProse = (claim: DraftRenderText) => claim.placement.startsWith(`${artifact}.`) && ["MODEL_PROPOSAL", "OWNER_EDIT"].includes(claim.origin);
    const replacements = new Map(generated.map(claim => [claim.placement, claim]));
    // Preserve every unaffected claim and its order/ID. Replace selected prose
    // in place and append newly added placements in document order.
    detached.ownerReviewClaims = source.ownerReviewClaims.flatMap(claim => {
      if (!isSelectedProse(claim)) return [structuredClone(claim)];
      const replacement = replacements.get(claim.placement); replacements.delete(claim.placement);
      if (!replacement) changed.add(claim.placement);
      return replacement ? [replacement] : [];
    }).concat([...replacements.values()]);
    ensure(changed.size > 0 && detached.ownerReviewClaims.length <= 250, "NO_CHANGES");
    detached.finalVersionAt = now.toISOString();
    detached.ownerEdit = { schemaVersion: "applypack-owner-draft-edit-v1", requestId: request.requestId, requestSha256,
      priorVersionId: request.originalDraftVersionId, priorSourceSha256: source.renderSourceSha256,
      originalProposalSourceSha256: source.proposalSourceSha256, reviewerId, editedAt: now.toISOString(),
      validatedOutputSha256: proposal.sourceSha256, changedPlacements: [...changed].sort() };
    const result = { ...detached, renderSourceSha256: sha(exactOwnerEditJson(detached)) };
    const serialized = serializeDraftRenderSource(result);
    return readBoundDraftRenderEvidence({ body: serialized, value: JSON.parse(serialized) }, result.renderSourceSha256, input.packet, () => now);
  } catch (error) {
    if (error instanceof ServiceRepairAuthoringError) throw error;
    throw new ServiceRepairAuthoringError("INVALID");
  }
}

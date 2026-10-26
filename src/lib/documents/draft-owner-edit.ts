import { createHash } from "node:crypto";
import { z } from "zod";
import { draftOutputSchema, validateDraftOutput, type DraftOutput, type DraftProseClaim } from "./draft-output";
import { buildDraftRenderSource, serializeDraftRenderSource, type DraftRenderSource, type DraftRenderText } from "./draft-render-source";
import { serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "./drafting-evidence";
import type { DraftReferenceInput } from "./draft-reference-source";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const draftOwnerEditRequestSchema = z.object({ jobId: uuid, expectedVersionId: uuid, expectedSourceSha256: hash,
  requestId: uuid, output: draftOutputSchema }).strict();
export type DraftOwnerEditRequest = z.infer<typeof draftOwnerEditRequestSchema>;
export type DraftOwnerEditModel = { output: DraftOutput; sections: { anchorFactId: string; label: string }[];
  sources: { id: string; factId: string; parentFactId: string | null; label: string; value: string; disposition: string; localOnly: boolean }[] };
export class DraftOwnerEditError extends Error { constructor(readonly code: string) { super(`DRAFT_OWNER_EDIT_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftOwnerEditError(code); }
export function exactOwnerEditJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exactOwnerEditJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${exactOwnerEditJson(object[key])}`).join(",")}}`;
  }
  throw new DraftOwnerEditError("JSON_INVALID");
}
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
export const ownerEditRequestSha256 = (request: DraftOwnerEditRequest) => digest(exactOwnerEditJson(request));
const field = (path: string) => path.replace(/^\//, "").replaceAll("/", ".");
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
const isProse = (claim: DraftRenderText) => claim.origin === "MODEL_PROPOSAL" || claim.origin === "OWNER_EDIT";

/** The browser receives prose and confirmed source choices, never writable identity,
 * dates, education credentials, contact or reference fields. Source pointers are
 * still not factual approval; the entire successor needs a new wording review. */
export function buildDraftOwnerEditModel(source: DraftRenderSource, packet: DraftingEvidencePacket, now = new Date()): DraftOwnerEditModel {
  return buildEditModel(source, packet, now, true);
}

/** Displays original recorded wording for a scoped repair. Historical wording
 * may itself contain the error being investigated; new wording must pass the
 * full content validator before storage. This grants no repair authority. */
export function buildRecordedDraftOwnerEditModel(source: DraftRenderSource, packet: DraftingEvidencePacket): DraftOwnerEditModel {
  return buildEditModel(source, packet, new Date(), false);
}

function buildEditModel(source: DraftRenderSource, packet: DraftingEvidencePacket, now: Date, requireCurrent: boolean): DraftOwnerEditModel {
  serializeDraftRenderSource(source); serializeDraftingEvidencePacket(packet);
  ensure(source.packetSha256 === packet.packetSha256 && exactOwnerEditJson(source.expected) === exactOwnerEditJson(packet.expected), "PACKET_MISMATCH");
  const facts = packet.providerView.facts, atoms = facts.flatMap((fact) => fact.atoms.map((atom) => ({ fact, atom })));
  const convert = (claim: DraftRenderText): DraftProseClaim => {
    ensure(isProse(claim) && claim.contactBinding === null && !claim.referenceBinding && !claim.referencePermissionIds.length, "PROSE_REQUIRED");
    const sourceAtomIds = claim.factRefs.map((ref) => {
      const matches = atoms.filter(({ fact, atom }) => fact.id === ref.factId && field(atom.path) === ref.field);
      ensure(matches.length === 1, "SOURCE_UNKNOWN");
      const owner = packet.ownerEvidence.facts.find((fact) => fact.id === ref.factId);
      let value: unknown = owner?.typed_value;
      for (const key of ref.field.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
      ensure(value !== undefined && digest(JSON.stringify(value)) === ref.valueSha256, "SOURCE_CHANGED");
      return matches[0].atom.id;
    });
    const adjacent = claim.jobEvidenceIds.some((id) => packet.providerView.mappings.some((mapping) => mapping.jobEvidenceId === id && "evidenceRelation" in mapping && mapping.evidenceRelation === "ADJACENT"));
    return { text: claim.text, sourceAtomIds: [...new Set(sourceAtomIds)], jobEvidenceIds: [...claim.jobEvidenceIds],
      questionIds: claim.questionInsights.map((question) => question.questionId), relation: adjacent ? "TRANSFERABLE" : claim.qualification === "EXACT" ? "DIRECT" : "QUALIFIED" };
  };
  const output: DraftOutput = { schemaVersion: "applypack-draft-proposal-v1", language: "en-US", resume: {
    summary: source.resume.summary.map(convert), skills: source.resume.skills.map(convert),
    sections: source.resume.sections.map((section) => ({ anchorFactId: section.anchorFactId, bullets: section.bullets.map(convert) })),
    educationFactIds: source.resume.education.map((section) => section.anchorFactId),
  }, coverLetter: { body: source.coverLetter.body.map((sentences) => ({ sentences: sentences.map(convert) })) } };
  if (requireCurrent) validateDraftOutput(output, packet, now);
  else draftOutputSchema.parse(output);
  return { output, sections: source.resume.sections.map((section) => ({ anchorFactId: section.anchorFactId, label: section.header.map((part) => part.text).join(" · ") })),
    sources: atoms.filter(({ atom }) => typeof atom.value === "string" && atom.value.trim()).map(({ fact, atom }) => ({ id: atom.id,
      factId: fact.id, parentFactId: fact.parentFactId, label: `${label(fact.kind)} · ${label(field(atom.path))}`, value: String(atom.value),
      disposition: fact.disposition, localOnly: atom.localRenderOnly })) };
}

/** A local editing operation: this does not call a provider or approve wording.
 * The existing output validator supplies the same negative/unknown/role fences.
 * Its intermediate proposal is validation evidence only, never provider authorship. */
export function buildOwnerEditedDraftSource(input: { request: unknown; source: DraftRenderSource; packet: DraftingEvidencePacket;
  reviewerId: string; contact: { payloadId: string; plaintext: Uint8Array }; references?: readonly DraftReferenceInput[] }, now = new Date()): DraftRenderSource {
  const request = draftOwnerEditRequestSchema.parse(input.request), reviewerId = uuid.parse(input.reviewerId);
  const source = input.source, packet = input.packet, prior = buildDraftOwnerEditModel(source, packet, now).output;
  ensure(request.expectedSourceSha256 === source.renderSourceSha256, "SOURCE_STALE");
  ensure(exactOwnerEditJson(request.output.resume.sections.map((section) => section.anchorFactId)) === exactOwnerEditJson(prior.resume.sections.map((section) => section.anchorFactId))
    && exactOwnerEditJson(request.output.resume.educationFactIds) === exactOwnerEditJson(prior.resume.educationFactIds), "LOCAL_FIELDS_IMMUTABLE");
  ensure(exactOwnerEditJson(request.output) !== exactOwnerEditJson(prior), "NO_CHANGES");
  const proposal = validateDraftOutput(request.output, packet, now, source.changeRequest);
  const generated = buildDraftRenderSource({ packet, proposal, contact: input.contact, references: input.references,
    finalVersionAt: now.toISOString(), ...(source.resume.careerBreak ? { careerBreakFactId: source.resume.careerBreak.sourceFactId } : {}) }, now);
  const detached = JSON.parse(serializeDraftRenderSource(generated)) as Omit<DraftRenderSource, "renderSourceSha256">;
  const old = new Map(source.ownerReviewClaims.map((claim) => [claim.placement, claim]));
  const changedPlacements: string[] = [];
  function update(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if ("claimId" in value && "origin" in value) {
      const claim = value as DraftRenderText;
      const previous = old.get(claim.placement);
      const comparable = (entry: DraftRenderText) => ({ text: entry.text, qualification: entry.qualification, factRefs: entry.factRefs, jobEvidenceIds: entry.jobEvidenceIds, questionInsights: entry.questionInsights });
      const changed = !previous || exactOwnerEditJson(comparable(claim)) !== exactOwnerEditJson(comparable(previous));
      if (!isProse(claim)) {
        ensure(previous && !changed && previous.origin === claim.origin && exactOwnerEditJson(previous.contactBinding) === exactOwnerEditJson(claim.contactBinding)
          && exactOwnerEditJson(previous.referenceBinding ?? null) === exactOwnerEditJson(claim.referenceBinding ?? null), "LOCAL_FIELDS_IMMUTABLE");
        claim.claimId = previous.claimId; return;
      }
      claim.origin = changed ? "OWNER_EDIT" : previous!.origin;
      if (!changed) claim.claimId = previous!.claimId;
      if (changed) changedPlacements.push(claim.placement);
      return;
    }
    Object.values(value).forEach(update);
  }
  update(detached);
  // Removed prose is recorded too; references and local headings cannot be removed.
  const newPlacements = new Set(detached.ownerReviewClaims.map((claim) => claim.placement));
  source.ownerReviewClaims.filter(isProse).forEach((claim) => { if (!newPlacements.has(claim.placement)) changedPlacements.push(claim.placement); });
  ensure(changedPlacements.length > 0, "NO_CHANGES");
  const body = { ...detached, proposalSourceSha256: source.proposalSourceSha256,
    ownerEdit: { schemaVersion: "applypack-owner-draft-edit-v1" as const, requestId: request.requestId, requestSha256: ownerEditRequestSha256(request),
      priorVersionId: request.expectedVersionId, priorSourceSha256: source.renderSourceSha256, originalProposalSourceSha256: source.proposalSourceSha256,
      reviewerId, editedAt: now.toISOString(), validatedOutputSha256: proposal.sourceSha256, changedPlacements: [...new Set(changedPlacements)].sort() } };
  const result = { ...body, renderSourceSha256: digest(exactOwnerEditJson(body)) };
  serializeDraftRenderSource(result);
  return result;
}

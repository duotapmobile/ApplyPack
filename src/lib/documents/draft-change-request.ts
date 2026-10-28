import { createHash } from "node:crypto";
import { z } from "zod";
import { draftChangeRequestSchema, draftChangeLineageSchema, type DraftChangeRequest } from "./draft-change-contract";
import { draftOutputSchema, validateDraftOutput } from "./draft-output";
import { buildDraftOwnerEditModel, exactOwnerEditJson } from "./draft-owner-edit";
import { serializeDraftRenderSource, type DraftRenderSource } from "./draft-render-source";
import type { DraftingEvidencePacket } from "./drafting-evidence";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
export const draftChangeRequestSha256 = (raw: DraftChangeRequest) => sha(exactOwnerEditJson(draftChangeRequestSchema.parse(raw)));
export const draftChangeProviderContextSchema = z.object({
  textTrust: z.literal("OWNER_REVISION_REQUEST_UNTRUSTED_DATA_NOT_CANDIDATE_FACTS"),
  instructions: z.string().min(1).max(2400), previousOutput: draftOutputSchema,
}).strict();
export type DraftChangeProviderContext = z.infer<typeof draftChangeProviderContextSchema>;
export const draftChangePayloadSchema = z.object({ schemaVersion: z.literal("applypack-draft-change-request-v1"),
  request: draftChangeRequestSchema, customerId: uuid, materialLineId: uuid, reviewerId: uuid,
  packetSha256: hash, contextSha256: hash, priorProposalSourceSha256: hash,
  priorOutput: draftOutputSchema, providerContext: draftChangeProviderContextSchema,
}).strict();
export type DraftChangePayload = z.infer<typeof draftChangePayloadSchema>;
export class DraftChangeRequestError extends Error { constructor(readonly code: string) { super(`DRAFT_CHANGE_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftChangeRequestError(code); }

/** This minimizes common and exact known local identity spellings; it does not
 * claim exhaustive PII detection. Local contact/reference fields never enter
 * previousOutput, and the request never becomes a source of candidate facts. */
export function minimizeDraftChangeText(text: string, localValues: readonly string[]) {
  let value = text;
  for (const local of [...localValues].sort((a, b) => b.length - a.length)) {
    if (local.trim().length < 3) continue;
    const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(escaped, "giu"), "[local identity removed]");
    const digits = local.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) value = value.replace(new RegExp(digits.split("").join("[\\s().+-]*"), "g"), "[local phone removed]");
  }
  return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[email removed]")
    .replace(/https?:\/\/[^\s]+/giu, "[link removed]")
    .replace(/(?<!\d)(?:\+?\d[\s().-]*){10,15}(?!\d)/gu, "[phone removed]");
}

export function buildDraftChangePayload(input: { request: unknown; source: DraftRenderSource; packet: DraftingEvidencePacket;
  contextSha256: string; reviewerId: string; localIdentityValues: readonly string[] }, now = new Date()) {
  const request = draftChangeRequestSchema.parse(input.request), source = input.source, packet = input.packet;
  serializeDraftRenderSource(source);
  ensure(source.renderSourceSha256 === request.expectedSourceSha256, "SOURCE_STALE");
  const priorOutput = buildDraftOwnerEditModel(source, packet, now).output;
  const previousOutput = structuredClone(priorOutput);
  const claims = [...previousOutput.resume.summary, ...previousOutput.resume.skills,
    ...previousOutput.resume.sections.flatMap((section) => section.bullets),
    ...previousOutput.coverLetter.body.flatMap((paragraph) => paragraph.sentences)];
  for (const claim of claims) claim.text = minimizeDraftChangeText(claim.text, input.localIdentityValues);
  const payload = draftChangePayloadSchema.parse({ schemaVersion: "applypack-draft-change-request-v1", request,
    customerId: packet.expected.customerId, materialLineId: packet.expected.materialLineId, reviewerId: input.reviewerId,
    packetSha256: packet.packetSha256, contextSha256: input.contextSha256, priorProposalSourceSha256: source.proposalSourceSha256,
    priorOutput, providerContext: { textTrust: "OWNER_REVISION_REQUEST_UNTRUSTED_DATA_NOT_CANDIDATE_FACTS",
      instructions: minimizeDraftChangeText(request.instructions, input.localIdentityValues), previousOutput } });
  const body = exactOwnerEditJson(payload);
  ensure(Buffer.byteLength(body, "utf8") <= 384_000, "TOO_LARGE");
  return { payload, body, payloadSha256: sha(body), requestSha256: draftChangeRequestSha256(request) };
}

/** Only use after decrypting the exact owned ACTIVE payload and reading its
 * immutable request row. Stored notes cannot authorize a generation attempt. */
export function readDraftChangePayload(body: string, expected: { requestId: string; requestSha256: string; payloadSha256: string;
  jobId: string; customerId: string; materialLineId: string; parentVersionId: string; parentSourceSha256: string;
  parentProposalSha256: string; packetSha256: string; contextSha256: string; reviewerId: string }, packet: DraftingEvidencePacket, now = new Date()) {
  ensure(Buffer.byteLength(body, "utf8") <= 384_000 && sha(body) === expected.payloadSha256, "PAYLOAD_DIGEST_INVALID");
  let raw: unknown; try { raw = JSON.parse(body); } catch { throw new DraftChangeRequestError("PAYLOAD_INVALID"); }
  const result = draftChangePayloadSchema.safeParse(raw); ensure(result.success, "PAYLOAD_INVALID"); const payload = result.data;
  ensure(exactOwnerEditJson(payload) === body && payload.request.requestId === expected.requestId
    && draftChangeRequestSha256(payload.request) === expected.requestSha256 && payload.request.jobId === expected.jobId
    && payload.request.expectedVersionId === expected.parentVersionId && payload.request.expectedSourceSha256 === expected.parentSourceSha256
    && payload.customerId === expected.customerId && payload.materialLineId === expected.materialLineId && payload.reviewerId === expected.reviewerId
    && payload.priorProposalSourceSha256 === expected.parentProposalSha256 && payload.packetSha256 === expected.packetSha256
    && payload.contextSha256 === expected.contextSha256
    && packet.expected.customerId === expected.customerId && packet.expected.materialLineId === expected.materialLineId, "PAYLOAD_BINDING_INVALID");
  // A separately approved packet refresh may supply newer current evidence.
  // The immutable request still names its original packet; validate its actual
  // prior prose against the current confirmed facts instead of backdating it.
  validateDraftOutput(payload.priorOutput, packet, now);
  const lineage = draftChangeLineageSchema.parse({ schemaVersion: "applypack-draft-change-lineage-v1", requestId: expected.requestId,
    requestSha256: expected.requestSha256, requestPayloadSha256: expected.payloadSha256, priorVersionId: expected.parentVersionId,
    priorSourceSha256: expected.parentSourceSha256, priorProposalSourceSha256: expected.parentProposalSha256 });
  return { payload, lineage, providerContext: payload.providerContext };
}

import { z } from "zod";
import type { DraftOutput } from "@/lib/documents/draft-output";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const claim = z.object({ text: z.string().min(1).max(1200), sourceAtomIds: z.array(hash).min(1).max(12),
  jobEvidenceIds: z.array(uuid).max(6), questionIds: z.array(uuid).max(8), relation: z.enum(["DIRECT", "TRANSFERABLE", "QUALIFIED"]) }).strict();
// Browser shape checks only. Server validators retain factual and source authority.
const output = z.object({ schemaVersion: z.literal("applypack-draft-proposal-v1"), language: z.literal("en-US"),
  resume: z.object({ summary: z.array(claim).max(3), skills: z.array(claim).max(20),
    sections: z.array(z.object({ anchorFactId: uuid, bullets: z.array(claim).max(10) }).strict()).max(30), educationFactIds: z.array(uuid).max(20) }).strict(),
  coverLetter: z.object({ body: z.array(z.object({ sentences: z.array(claim).min(1).max(4) }).strict()).min(1).max(3) }).strict() }).strict();
const model = z.object({ output, sections: z.array(z.object({ anchorFactId: uuid, label: z.string().max(5000) }).strict()).max(30),
  sources: z.array(z.object({ id: hash, factId: uuid, parentFactId: uuid.nullable(), label: z.string().max(2000), value: z.string().max(16000),
    disposition: z.enum(["NEGATIVE_DO_NOT_ASSERT", "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE", "UNSTRUCTURED_OWNER_REVIEW_REQUIRED", "CONFIRMED_SOURCE_NOT_APPROVED_PROSE"]),
    localOnly: z.boolean() }).strict()).max(6000) }).strict();
export const repairAuthoringIdentitySchema = z.object({ caseId: uuid, materialLineId: uuid, versionId: uuid }).strict();
const viewSchema = repairAuthoringIdentitySchema.extend({ acceptedScopeSha256: hash, contextSha256: hash, sourceSaved: z.boolean(),
  members: z.array(z.object({ originalFileVersionId: uuid, artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]),
    originalSourceSha256: hash, title: z.string().max(4000), model: model.nullable() }).strict()).min(1).max(3) }).strict();
export type RepairAuthoringView = z.infer<typeof viewSchema>;
export type RepairAuthoringChoice = { repairMode: "SOURCE_CORRECTION" | "SOURCE_PRESERVING_RERENDER" | ""; output: DraftOutput | null };
export const repairAuthoringRequestSchema = repairAuthoringIdentitySchema.extend({ requestId: uuid, acceptedScopeSha256: hash, contextSha256: hash,
  members: z.array(z.discriminatedUnion("repairMode", [
    z.object({ originalFileVersionId: uuid, repairMode: z.literal("SOURCE_CORRECTION"), output }).strict(),
    z.object({ originalFileVersionId: uuid, repairMode: z.literal("SOURCE_PRESERVING_RERENDER") }).strict(),
  ])).min(1).max(3) }).strict();
export type RepairAuthoringRequest = z.infer<typeof repairAuthoringRequestSchema>;
const receiptSchema = repairAuthoringIdentitySchema.extend({ requestId: uuid, acceptedScopeSha256: hash, contextSha256: hash, sourceSha256: hash,
  state: z.enum(["WORDING_REVIEW_REQUIRED", "SOURCE_STORED", "NOT_SAVED"]), retryAllowed: z.boolean(), replayed: z.boolean(),
  renderingAuthorized: z.literal(false), deliveryAuthorized: z.literal(false) }).strict();
export type RepairAuthoringReceipt = z.infer<typeof receiptSchema>;
export class RepairAuthoringSizeError extends Error {
  constructor() { super("This repair request is too long to save or check safely. Shorten the affected prose or reduce source selections, then confirm it again. Nothing was sent."); }
}
export function repairAuthoringPostBody(action: "SAVE" | "CHECK", request: RepairAuthoringRequest): string {
  const body = JSON.stringify({ action, request });
  if (new TextEncoder().encode(body).byteLength > 96 * 1024) throw new RepairAuthoringSizeError();
  return body;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function readRepairAuthoringView(raw: unknown, expected: z.infer<typeof repairAuthoringIdentitySchema>): RepairAuthoringView {
  const value = viewSchema.parse(raw);
  if (value.caseId !== expected.caseId || value.materialLineId !== expected.materialLineId || value.versionId !== expected.versionId
    || new Set(value.members.map(member => member.originalFileVersionId)).size !== value.members.length) throw new Error("Repair source changed");
  for (const member of value.members) {
    if ((member.artifactType === "REFERENCE_SHEET") !== (member.model === null)) throw new Error("Repair source unavailable");
    if (member.model && (new Set(member.model.sources.map(source => source.id)).size !== member.model.sources.length
      || !same(member.model.sections.map(section => section.anchorFactId), member.model.output.resume.sections.map(section => section.anchorFactId)))) throw new Error("Repair source changed");
  }
  return value;
}
export function buildRepairAuthoringRequest(view: RepairAuthoringView, choices: readonly RepairAuthoringChoice[], requestId: string): RepairAuthoringRequest {
  if (view.sourceSaved || choices.length !== view.members.length) throw new Error("Reload the current repair version.");
  const members = view.members.map((member, index) => {
    const choice = choices[index];
    if (choice.repairMode === "SOURCE_PRESERVING_RERENDER") return { originalFileVersionId: member.originalFileVersionId, repairMode: choice.repairMode };
    if (choice.repairMode !== "SOURCE_CORRECTION" || !member.model || !choice.output) throw new Error("Choose how to repair every affected file.");
    const next = output.parse(choice.output), prior = member.model.output, part = member.artifactType === "RESUME" ? "resume" : "coverLetter", other = part === "resume" ? "coverLetter" : "resume";
    if (!same(next[other], prior[other]) || !same(next.resume.sections.map(section => section.anchorFactId), prior.resume.sections.map(section => section.anchorFactId))
      || !same(next.resume.educationFactIds, prior.resume.educationFactIds) || same(next[part], prior[part])) throw new Error("Change only the affected wording, or choose an unchanged-source rerender.");
    const sources = new Map(member.model.sources.map(source => [source.id, source]));
    const check = (entry: z.infer<typeof claim>, anchor?: string) => {
      const selected = entry.sourceAtomIds.map(id => sources.get(id));
      if (!entry.text.trim() || new Set(entry.sourceAtomIds).size !== entry.sourceAtomIds.length || !selected.some(source => source && !source.localOnly)
        || selected.some(source => !source || source.disposition === "NEGATIVE_DO_NOT_ASSERT" || anchor && source.factId !== anchor && source.parentFactId !== anchor
          || source.disposition === "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE" && entry.relation !== "QUALIFIED")) throw new Error("Select the supporting confirmed facts and preserve any recorded limits.");
    };
    if (part === "resume") { next.resume.summary.forEach(entry => check(entry)); next.resume.skills.forEach(entry => check(entry)); next.resume.sections.forEach(section => section.bullets.forEach(entry => check(entry, section.anchorFactId))); }
    else next.coverLetter.body.forEach(paragraph => paragraph.sentences.forEach(entry => check(entry)));
    return { originalFileVersionId: member.originalFileVersionId, repairMode: choice.repairMode, output: next };
  });
  const request = repairAuthoringRequestSchema.parse({ caseId: view.caseId, materialLineId: view.materialLineId, versionId: view.versionId,
    acceptedScopeSha256: view.acceptedScopeSha256, contextSha256: view.contextSha256, requestId, members });
  // CHECK has one more byte than SAVE. Every accepted save must remain eligible
  // for the same bounded read-only reconciliation request after a lost reply.
  repairAuthoringPostBody("CHECK", request);
  return request;
}
export function readRepairAuthoringReceipt(raw: unknown, request: RepairAuthoringRequest, knownSourceSha256?: string): RepairAuthoringReceipt {
  const value = receiptSchema.parse(raw);
  for (const key of ["caseId", "materialLineId", "versionId", "requestId", "acceptedScopeSha256", "contextSha256"] as const) if (value[key] !== request[key]) throw new Error("Repair result changed");
  if (knownSourceSha256 && value.sourceSha256 !== knownSourceSha256 || value.retryAllowed !== (value.state !== "WORDING_REVIEW_REQUIRED")) throw new Error("Repair result changed");
  return value;
}
export async function readRepairAuthoringJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error("Repair response unavailable");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }); let count = 0, body = "";
  let cancel: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => { cancel = () => reject(new Error("Repair response interrupted"));
    if (signal?.aborted) cancel(); else signal?.addEventListener("abort", cancel, { once: true }); });
  try { return await Promise.race([aborted, (async () => {
    for (;;) { if (signal?.aborted) throw new Error("Repair response interrupted");
      const chunk = await reader.read(); if (chunk.done) break; count += chunk.value.byteLength;
      if (count > 6_000_000) throw new Error("Repair response too large"); body += decoder.decode(chunk.value, { stream: true }); }
    return JSON.parse(body + decoder.decode()) as unknown;
  })()]);
  } finally { signal?.removeEventListener("abort", cancel); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { materialContactSchema } from "@/lib/materials/server";
import { prepareServiceRepairDocx } from "./draft-docx";
import { draftPdfExpectation } from "./draft-pdf-validation";
import { assertDraftRenderResult } from "./draft-render";
import { renderDocumentForQa, type DocumentRenderInput, type DocumentRenderResult } from "./renderer";
import { validateDraftReferenceSource, type DraftReferenceInput } from "./draft-reference-source";
import { bindServiceRepairRenderSource, type ServiceRepairBoundMember, type ServiceRepairOriginalInput } from "./service-repair-source";

const uuid = z.uuid(), digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const identitySchema = z.object({ caseId: uuid, materialLineId: uuid, versionId: uuid, leaseToken: uuid }).strict();
export type ServiceRepairRenderIdentity = z.infer<typeof identitySchema>;
export type ServiceRepairRenderEvidence = { envelopeBytes: Buffer; originals: ServiceRepairOriginalInput[] };
export type ServiceRepairRenderPort = {
  requireReviewer(reviewerId: string, signal: AbortSignal): Promise<unknown>;
  readCurrent(identity: ServiceRepairRenderIdentity, reviewerId: string, signal: AbortSignal): Promise<unknown>;
  loadEvidence(identity: ServiceRepairRenderIdentity, inspection: unknown, signal: AbortSignal): Promise<ServiceRepairRenderEvidence>;
  // These loaders must perform the established ACTIVE/ownership/hash/consent
  // checks before and after decrypting. Returned buffers transfer to this caller.
  loadContact(member: ServiceRepairBoundMember, signal: AbortSignal): Promise<Buffer>;
  loadReferences(member: ServiceRepairBoundMember, signal: AbortSignal): Promise<DraftReferenceInput[]>;
};
export class ServiceRepairRenderError extends Error {
  constructor(readonly code: string) { super(`SERVICE_REPAIR_RENDER_${code}`); }
}
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceRepairRenderError(code); }
function clearEvidence(evidence: ServiceRepairRenderEvidence) {
  evidence.envelopeBytes?.fill(0);
  evidence.originals?.forEach((entry) => { entry.packetBytes?.fill(0); entry.sourceBytes?.fill(0); });
}
function clearRendered(result: DocumentRenderResult) {
  result.searchablePdf?.fill(0); result.pageImages?.forEach((page) => page.bytes?.fill(0));
}

/** A separate repair-only rendering pipeline. It reads the current099 scope and
 * lease before every dispatch and after each result. All output still needs
 * exact registration, visual approval and a separate atomic Send. No provider
 * drafting, storage upload or customer delivery occurs in this component. */
export async function prepareServiceRepairRender(port: ServiceRepairRenderPort, trustedReviewerId: string, raw: unknown,
  options: { signal?: AbortSignal; timeoutMs?: number; now?: () => Date;
    render?: (input: DocumentRenderInput, signal: AbortSignal) => Promise<DocumentRenderResult> } = {}) {
  const identity = identitySchema.parse(raw), reviewerId = uuid.parse(trustedReviewerId), clock = options.now ?? (() => new Date());
  const timeout = options.timeoutMs ?? 150_000;
  ensure(Number.isInteger(timeout) && timeout > 0 && timeout <= 150_000, "TIMEOUT_INVALID");
  const controller = new AbortController(), signal = controller.signal, cancel = () => controller.abort();
  const owned: Buffer[] = []; let evidence: ServiceRepairRenderEvidence | undefined;
  const stop = () => { owned.forEach((bytes) => bytes.fill(0)); if (evidence) clearEvidence(evidence); };
  const check = () => ensure(!signal.aborted, "CANCELED");
  let removeAbort = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    const onAbort = () => { stop(); reject(new ServiceRepairRenderError("CANCELED")); };
    signal.addEventListener("abort", onAbort, { once: true }); removeAbort = () => signal.removeEventListener("abort", onAbort);
  });
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeout);
  try {
    return await Promise.race([(async () => {
      check(); ensure(await port.requireReviewer(reviewerId, signal) === true, "REVIEWER_UNCONFIRMED"); check();
      const initial = await port.readCurrent(identity, reviewerId, signal); check();
      const transferred = await port.loadEvidence(identity, initial, signal);
      try {
        check();
        const copy = (bytes: Buffer) => { const cloned = Buffer.from(bytes); owned.push(cloned); return cloned; };
        evidence = { envelopeBytes: copy(transferred.envelopeBytes), originals: [] };
        for (const entry of transferred.originals) {
          const member = structuredClone(entry.member), packet = structuredClone(entry.packet);
          const packetBytes = copy(entry.packetBytes), sourceBytes = copy(entry.sourceBytes);
          evidence.originals.push({ member, packet, packetBytes, sourceBytes });
        }
      } finally { clearEvidence(transferred); }
      const bound = () => bindServiceRepairRenderSource({ ...identity, inspection: initial, ...evidence! }, clock());
      const original = bound();
      const current = async () => {
        check(); const inspection = await port.readCurrent(identity, reviewerId, signal); check();
        const latest = bindServiceRepairRenderSource({ ...identity, inspection, ...evidence! }, clock());
        ensure(latest.sourceSha256 === original.sourceSha256 && latest.contextSha256 === original.contextSha256
          && latest.acceptedScopeSha256 === original.acceptedScopeSha256, "AUTHORITY_CHANGED");
        return latest;
      };
      const results = [];
      for (const originalMember of original.members) {
        const before = await current(), member = before.members.find((entry) => entry.original.fileVersionId === originalMember.original.fileVersionId);
        ensure(member, "MEMBER_CHANGED");
        const contactBytes = await port.loadContact(member, signal);
        try {
          check(); ensure(Buffer.isBuffer(contactBytes) && contactBytes.length > 0 && contactBytes.length <= 8192
            && digest(contactBytes) === member.packet.binding.contactSha256, "CONTACT_CHANGED");
          const contact = materialContactSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contactBytes)));
          const prefix = member.artifactType === "RESUME" ? "resume." : member.artifactType === "COVER_LETTER" ? "coverLetter." : "referenceSheet.";
          for (const claim of member.source.ownerReviewClaims.filter((claim) => claim.placement.startsWith(prefix) && claim.origin === "LOCAL_CONTACT")) {
            ensure(claim.contactBinding?.payloadId === member.packet.binding.contactPayloadId
              && claim.contactBinding.contentSha256 === member.packet.binding.contactSha256 && claim.contactBinding.fields.length === 1, "CONTACT_CHANGED");
            const field = claim.contactBinding.fields[0]; ensure(Object.hasOwn(contact, field) && claim.text === contact[field as keyof typeof contact], "CONTACT_CHANGED");
          }
        } finally { contactBytes.fill(0); }
        if (member.artifactType === "REFERENCE_SHEET") {
          const references = await port.loadReferences(member, signal);
          try { check(); validateDraftReferenceSource(member.source.referenceSheet, member.packet.ownerEvidence.referenceBindings, references, clock()); }
          finally { references.forEach((reference) => reference.plaintext.fill(0)); }
        }
        await current(); check();
        const artifact = await prepareServiceRepairDocx(member); owned.push(artifact.buffer); check();
        const expectation = await draftPdfExpectation(artifact.buffer, member.artifactType, member.source.renderSourceSha256); check();
        await current(); check();
        const renderInput: DocumentRenderInput = { docx: Buffer.from(artifact.buffer), expectedPages: artifact.expectedPageCount,
          expectedExtractedTextSha256: artifact.inspection.extractedTextSha256, artifactType: member.artifactType,
          expectedMetadata: structuredClone(artifact.metadata), draftPdf: expectation };
        let result: DocumentRenderResult;
        try {
          const returned = await (options.render ?? renderDocumentForQa)(renderInput, signal);
          try {
            check(); const metadata = structuredClone({ ...returned, searchablePdf: undefined, pageImages: undefined });
            const searchablePdf = Buffer.from(returned.searchablePdf); owned.push(searchablePdf);
            const pageImages = returned.pageImages.map((page) => { const bytes = Buffer.from(page.bytes); owned.push(bytes); return { sha256: page.sha256, bytes }; });
            result = { ...metadata, searchablePdf, pageImages };
          } finally { clearRendered(returned); }
        } finally { renderInput.docx.fill(0); }
        check(); assertDraftRenderResult(result, expectation, renderInput); await current(); check();
        results.push({ originalFileVersionId: member.original.fileVersionId, artifactType: member.artifactType, repairMode: member.repairMode, ...artifact,
          render: result, pdfFilename: artifact.filename.replace(/\.docx$/u, ".pdf"),
          qa: { packageQaSha256: artifact.inspection.packageQaSha256, pdf: result.draftPdf!, generatorVersion: artifact.provenance.generatorVersion },
          state: "OWNER_REVIEW_REQUIRED" as const, deliveryAuthorized: false as const });
      }
      await current(); check();
      return { versionId: identity.versionId, sourceSha256: original.sourceSha256, acceptedScopeSha256: original.acceptedScopeSha256,
        contextSha256: original.contextSha256, members: results, state: "OWNER_REVIEW_REQUIRED" as const, deliveryAuthorized: false as const };
    })().catch((error: unknown) => { stop(); throw error; }), interrupted]);
  } catch (error) {
    stop();
    if (error instanceof ServiceRepairRenderError) throw error;
    throw new ServiceRepairRenderError("EVIDENCE_INVALID");
  } finally { clearTimeout(timer); removeAbort(); options.signal?.removeEventListener("abort", cancel); if (evidence) clearEvidence(evidence); }
}

import "server-only";
import { createHash } from "node:crypto";
import { prepareDraftDocx } from "./draft-docx";
import { draftPdfExpectation, type DraftPdfExpectation } from "./draft-pdf-validation";
import type { DraftRenderSource } from "./draft-render-source";
import type { DraftingEvidencePacket } from "./drafting-evidence";
import { renderDocumentForQa, type DocumentRenderInput, type DocumentRenderResult } from "./renderer";
import { DOCUMENT_FONT_CONTRACT } from "./requirements";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fail(): never { throw new Error("draft_render_evidence_invalid"); }
type Input = { source: DraftRenderSource; packet: DraftingEvidencePacket };
type Ports = { render?: (input: DocumentRenderInput) => Promise<DocumentRenderResult>; now?: () => Date };

function assertResult(result: DocumentRenderResult, expectation: DraftPdfExpectation, input: DocumentRenderInput) {
  const receipt = result.draftPdf;
  if (!receipt || !result.searchablePdf.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || result.searchablePdfSha256 !== hash(result.searchablePdf) || receipt.searchablePdfSha256 !== result.searchablePdfSha256
    || !result.rendererIdentity || result.pageCount !== input.expectedPages || !result.taggedPdf || !result.metadataVerified || !result.documentFontResolved
    || result.extractedTextSha256 !== input.expectedExtractedTextSha256
    || result.documentFontFamily !== DOCUMENT_FONT_CONTRACT.family || result.documentFontVersion !== DOCUMENT_FONT_CONTRACT.version
    || result.documentFontManifestSha256 !== DOCUMENT_FONT_CONTRACT.manifestSha256 || result.documentFontSha256 !== DOCUMENT_FONT_CONTRACT.styles.regular
    || JSON.stringify(result.documentFontStyleSha256) !== JSON.stringify(DOCUMENT_FONT_CONTRACT.styles)
    || result.pageImages.length !== result.pageCount || result.pageImages.some((page) => !page.bytes.length || page.sha256 !== hash(page.bytes))) fail();
  for (const key of ["schemaVersion", "generatorVersion", "artifact", "renderSourceSha256", "docxSha256", "expectationSha256"] as const) {
    if (receipt[key] !== expectation[key]) fail();
  }
  if (receipt.paragraphCount !== expectation.paragraphs.length || receipt.listItemCount !== expectation.paragraphs.filter((row) => row.kind === "BULLET").length
    || receipt.linkCount !== expectation.paragraphs.flatMap((row) => row.links).length
    || ![receipt.structureTextSha256, receipt.linkXmlSha256, result.structureTreeSha256].every((value) => /^[a-f0-9]{64}$/u.test(value))) fail();
}

/** Prepares two inspected, rendered artifacts for later atomic registration.
 * No approval, registration, upload, provider drafting, or delivery occurs here. */
export async function prepareDraftRender(callerInput: Input, ports: Ports = {}) {
  const input = structuredClone(callerInput), clock = ports.now ?? (() => new Date()), render = ports.render ?? renderDocumentForQa;
  if (input.packet.binding.referencePermissions.length) throw new Error("draft_render_reference_sheet_requires_separate_generator");
  const prepared = await prepareDraftDocx(input, clock());
  const owned = [prepared.resume.buffer, prepared.coverLetter.buffer];
  const fresh = () => { if (!Number.isFinite(clock().getTime()) || Date.parse(input.source.validUntil) <= clock().getTime()) throw new Error("draft_render_evidence_expired"); };
  try {
    const pair = [];
    for (const artifact of [prepared.resume, prepared.coverLetter]) {
      fresh();
      const expectation = await draftPdfExpectation(artifact.buffer, artifact.provenance.artifact as "RESUME" | "COVER_LETTER", prepared.renderSourceSha256);
      const renderInput: DocumentRenderInput = { docx: Buffer.from(artifact.buffer), expectedPages: artifact.expectedPageCount,
        expectedExtractedTextSha256: artifact.inspection.extractedTextSha256, artifactType: artifact.provenance.artifact,
        expectedMetadata: structuredClone(artifact.metadata), draftPdf: expectation };
      let result: DocumentRenderResult;
      try {
        const returned = await render(renderInput);
        // A renderer transfers its output buffers to this caller. Keep detached
        // return values and clear the transferred originals even if cloning fails.
        const transferred = [returned.searchablePdf, ...(Array.isArray(returned.pageImages) ? returned.pageImages.map((page) => page?.bytes) : [])].filter(Buffer.isBuffer);
        try {
          const metadata = structuredClone({ ...returned, searchablePdf: undefined, pageImages: undefined });
          const searchablePdf = Buffer.from(returned.searchablePdf); owned.push(searchablePdf);
          const pageImages = returned.pageImages.map((page) => { const bytes = Buffer.from(page.bytes); owned.push(bytes); return { sha256: page.sha256, bytes }; });
          result = { ...metadata, searchablePdf, pageImages };
        } finally { transferred.forEach((buffer) => buffer.fill(0)); }
      } finally { renderInput.docx.fill(0); }
      fresh(); assertResult(result, expectation, renderInput);
      pair.push({ ...artifact, render: result, pdfFilename: artifact.filename.replace(/\.docx$/u, ".pdf"),
        qa: { packageQaSha256: artifact.inspection.packageQaSha256, pdf: result.draftPdf!, generatorVersion: prepared.generatorVersion },
        state: "OWNER_REVIEW_REQUIRED" as const, deliveryAuthorized: false as const });
    }
    return { resume: pair[0], coverLetter: pair[1], generatorVersion: prepared.generatorVersion, renderSourceSha256: prepared.renderSourceSha256,
      state: "OWNER_REVIEW_REQUIRED" as const, deliveryAuthorized: false as const };
  } catch (error) { owned.forEach((buffer) => buffer.fill(0)); throw error; }
}

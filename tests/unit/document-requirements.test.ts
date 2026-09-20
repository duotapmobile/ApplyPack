import { describe, expect, it } from "vitest";

import { pdfStructureIsValid, pdfCatalogLanguageMatches } from "@/lib/documents/pdf-validation";
import {
  DOCUMENT_GENERATOR_VERSION,
  DOCUMENT_REQUIREMENTS,
  DOCUMENT_VERSIONS,
  isCurrentDocumentGeneratorVersion,
} from "@/lib/documents/requirements";

describe("versioned document requirements", () => {
  it("reads language from the catalog, never page text or an unrelated object", () => {
    const valid = Buffer.from("%PDF-1.7\n1 0 obj\n<</Type/Catalog /Lang(en-US)>>\nendobj\ntrailer<</Root 1 0 R>>");
    expect(pdfCatalogLanguageMatches(valid, "en-US")).toBe(true);
    expect(pdfCatalogLanguageMatches(valid, "fr-FR")).toBe(false);
    expect(pdfCatalogLanguageMatches(Buffer.from("%PDF\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Lang(en-US)>>endobj\ntrailer<</Root 1 0 R>>"), "en-US")).toBe(false);
  });
  it("binds content, template, and tagged-PDF exporter versions into one cache key", () => {
    expect(DOCUMENT_GENERATOR_VERSION).toContain(`content=${DOCUMENT_VERSIONS.content}`);
    expect(DOCUMENT_GENERATOR_VERSION).toContain(`template=${DOCUMENT_VERSIONS.template}`);
    expect(DOCUMENT_GENERATOR_VERSION).toContain(`exporter=${DOCUMENT_VERSIONS.exporter}`);
    expect(isCurrentDocumentGeneratorVersion(DOCUMENT_GENERATOR_VERSION)).toBe(true);
    expect(isCurrentDocumentGeneratorVersion("applypack-evidence-bound-v2")).toBe(false);
  });

  it("keeps the exact LibreOffice tagged-PDF filter as one argument", () => {
    expect(DOCUMENT_REQUIREMENTS.pdfExportFilter).toBe(
      'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}',
    );
  });

  it("requires semantic PDF structure appropriate to each artifact", () => {
    const resume = "Structure:\nDocument\n  H1\n  P\n  L\n    LI";
    const letter = "Structure:\nDocument\n  P\n  P";
    expect(pdfStructureIsValid(resume, "RESUME")).toBe(true);
    expect(pdfStructureIsValid(letter, "COVER_LETTER")).toBe(true);
    expect(pdfStructureIsValid(letter, "RESUME")).toBe(false);
    expect(pdfStructureIsValid("Document\nH1\nL\nLI", "RESUME")).toBe(false);
  });
});

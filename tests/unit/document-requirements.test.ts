import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { pdfStructureIsValid, pdfCatalogLanguageMatches } from "@/lib/documents/pdf-validation";
import {
  DOCUMENT_GENERATOR_VERSION,
  DOCUMENT_REQUIREMENTS,
  DOCUMENT_STANDARD_SHA256,
  DOCUMENT_VERSIONS,
  LEGACY_DOCUMENT_GENERATOR_VERSION,
  isCurrentDocumentGeneratorVersion,
  isSupportedDocumentGeneratorVersion,
  selectDocumentOutputFormat,
  supportedDocumentFontFamily,
} from "@/lib/documents/requirements";

describe("versioned document requirements", () => {
  it("reads language from the catalog, never page text or an unrelated object", () => {
    const valid = Buffer.from("%PDF-1.7\n1 0 obj\n<</Type/Catalog /Lang(en-US)>>\nendobj\ntrailer<</Root 1 0 R>>");
    expect(pdfCatalogLanguageMatches(valid, "en-US")).toBe(true);
    expect(pdfCatalogLanguageMatches(valid, "fr-FR")).toBe(false);
    expect(pdfCatalogLanguageMatches(Buffer.from("%PDF\n1 0 obj<</Type/Catalog>>endobj\n2 0 obj<</Lang(en-US)>>endobj\ntrailer<</Root 1 0 R>>"), "en-US")).toBe(false);
  });
  it("binds the locked instructions, content, template, and tagged-PDF exporter into one version", () => {
    expect(DOCUMENT_GENERATOR_VERSION).toContain(`instructions=${DOCUMENT_VERSIONS.instructions}`);
    expect(DOCUMENT_GENERATOR_VERSION).toContain(`standardSha256=${DOCUMENT_STANDARD_SHA256}`);
    expect(DOCUMENT_GENERATOR_VERSION).toContain(`content=${DOCUMENT_VERSIONS.content}`);
    expect(DOCUMENT_GENERATOR_VERSION).toContain(`template=${DOCUMENT_VERSIONS.template}`);
    expect(DOCUMENT_GENERATOR_VERSION).toContain(`exporter=${DOCUMENT_VERSIONS.exporter}`);
    expect(isCurrentDocumentGeneratorVersion(DOCUMENT_GENERATOR_VERSION)).toBe(true);
    expect(isCurrentDocumentGeneratorVersion("applypack-evidence-bound-v2")).toBe(false);
    expect(isCurrentDocumentGeneratorVersion(LEGACY_DOCUMENT_GENERATOR_VERSION)).toBe(false);
    expect(isSupportedDocumentGeneratorVersion(DOCUMENT_GENERATOR_VERSION)).toBe(true);
    expect(isSupportedDocumentGeneratorVersion(LEGACY_DOCUMENT_GENERATOR_VERSION)).toBe(true);
    expect(isSupportedDocumentGeneratorVersion("applypack-evidence-bound-v2")).toBe(false);
    expect(supportedDocumentFontFamily(DOCUMENT_GENERATOR_VERSION)).toBe("Arial");
    expect(supportedDocumentFontFamily(LEGACY_DOCUMENT_GENERATOR_VERSION)).toBe("Liberation Sans");
    expect(supportedDocumentFontFamily("applypack-evidence-bound-v2")).toBeNull();
  });

  it("pins the exact tracked October 3 authority bytes", () => {
    const normalized = readFileSync(resolve(process.cwd(), "docs/applypack/13_UNIVERSAL_RESUME_AND_COVER_LETTER_STANDARD.txt"), "utf8")
      .replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(normalized, "utf8").digest("hex")).toBe(DOCUMENT_STANDARD_SHA256);
  });

  it("uses the locked Arial and PDF-first delivery defaults", () => {
    expect(DOCUMENT_REQUIREMENTS.font).toBe("Arial");
    expect(DOCUMENT_REQUIREMENTS.normalDeliveryFormat).toBe("PDF");
    expect(DOCUMENT_REQUIREMENTS.editableFallbackFormat).toBe("DOCX");
    expect(selectDocumentOutputFormat(["DOCX", "PDF"], ["DOCX", "PDF"])).toBe("PDF");
    expect(selectDocumentOutputFormat(["DOCX"], ["DOCX", "PDF"])).toBe("DOCX");
    expect(selectDocumentOutputFormat(["PDF"], ["DOCX"])).toBeNull();
  });

  it("keeps the exact LibreOffice tagged-PDF filter as one argument", () => {
    expect(DOCUMENT_REQUIREMENTS.pdfExportFilter).toBe(
      'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}',
    );
  });

  it("requires semantic PDF structure appropriate to each artifact", () => {
    const resume = "Structure:\nDocument\n  P\n    Link\n  H1\n  P\n  P\n  L\n    LI\n      Lbl\n      LBody\n        P";
    const letter = "Structure:\nDocument\n  P\n    Link\n  P\n  P\n  P\n  P\n  P\n  P\n  P";
    expect(pdfStructureIsValid(resume, "RESUME")).toBe(true);
    expect(pdfStructureIsValid(letter, "COVER_LETTER")).toBe(true);
    expect(pdfStructureIsValid(letter, "RESUME")).toBe(false);
    expect(pdfStructureIsValid("Document\n  P\n    Link\n  H1\n  L\n    LI", "RESUME")).toBe(false);
    expect(pdfStructureIsValid("Document\n  P\n    Link\n  H1\n  P\n  L\n    LI\n      LBody\n        P", "RESUME")).toBe(false);
  });
});

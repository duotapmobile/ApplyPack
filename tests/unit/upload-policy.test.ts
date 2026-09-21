import { describe, expect, it } from "vitest";
import { MAX_SOURCE_DOCUMENT_BYTES, validSourceDocumentCardinality, validateSourceDocumentMetadata } from "@/lib/files/upload-policy";

describe("source-document upload policy", () => {
  it("accepts only matching PDF/DOCX metadata and signatures", () => {
    expect(validateSourceDocumentMetadata({ name: "resume.pdf", size: 100, claimedMimeType: "application/pdf", signatureMatches: true }).allowed).toBe(true);
    expect(validateSourceDocumentMetadata({ name: "resume.docx", size: 100, claimedMimeType: "application/pdf", signatureMatches: true }).code).toBe("MIME_EXTENSION_MISMATCH");
    expect(validateSourceDocumentMetadata({ name: "resume.pdf", size: 100, claimedMimeType: "application/pdf", signatureMatches: false }).code).toBe("MIME_SIGNATURE_MISMATCH");
    expect(validateSourceDocumentMetadata({ name: "resume.doc", size: 100, claimedMimeType: "application/msword", signatureMatches: true }).code).toBe("UNSUPPORTED_MIME");
    expect(validateSourceDocumentMetadata({ name: "resume.pdf", size: MAX_SOURCE_DOCUMENT_BYTES + 1, claimedMimeType: "application/pdf", signatureMatches: true }).code).toBe("FILE_TOO_LARGE");
  });

  it("requires exactly one resume and permits at most one prior cover letter", () => {
    expect(validSourceDocumentCardinality({ resume: 1, priorCoverLetter: 0 })).toBe(true);
    expect(validSourceDocumentCardinality({ resume: 1, priorCoverLetter: 1 })).toBe(true);
    expect(validSourceDocumentCardinality({ resume: 2, priorCoverLetter: 1 })).toBe(false);
    expect(validSourceDocumentCardinality({ resume: 1, priorCoverLetter: 2 })).toBe(false);
  });
});

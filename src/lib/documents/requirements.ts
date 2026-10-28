/**
 * Versioned source of truth for every generated ApplyPack resume, cover letter,
 * reference sheet, rendered preview, and customer download.
 *
 * Changing content, layout, or export behavior must increment the matching
 * version. The composite generator version is persisted with artifacts and is
 * used to reject output created under an older contract.
 */
export const DOCUMENT_STANDARD_SHA256 = "2133e3e315191bde8b05eba43cba552c7339f29d3ee19bae998dde7ffeda7778";

export const DOCUMENT_FONT_CONTRACT = Object.freeze({
  family: "Liberation Sans",
  version: "2.1.5",
  license: "SIL Open Font License 1.1",
  upstreamArchiveSha256: "7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0",
  manifestSha256: "d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb",
  styles: Object.freeze({
    regular: "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8",
    bold: "788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173",
    italic: "e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0",
    boldItalic: "698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee",
  }),
});

export const DOCUMENT_VERSIONS = Object.freeze({
  instructions: "applypack-universal-document-standard-2026-10-19.1",
  content: "applypack-content-2026-10-19.1",
  template: "applypack-template-2026-10-19.1",
  exporter: "libreoffice-tagged-pdf-2026-10-19.1",
});

export const DOCUMENT_GENERATOR_VERSION = [
  "applypack-documents",
  `instructions=${DOCUMENT_VERSIONS.instructions}`,
  `standardSha256=${DOCUMENT_STANDARD_SHA256}`,
  `content=${DOCUMENT_VERSIONS.content}`,
  `template=${DOCUMENT_VERSIONS.template}`,
  `exporter=${DOCUMENT_VERSIONS.exporter}`,
].join("|");

// A separate acceptance profile: the default legacy renderer's bytes and
// version remain unchanged. SQL093 also requires the exact source-aware QA.
export const SOURCE_AWARE_DOCUMENT_GENERATOR_VERSION = [
  "applypack-documents",
  `instructions=${DOCUMENT_VERSIONS.instructions}`,
  `standardSha256=${DOCUMENT_STANDARD_SHA256}`,
  "content=applypack-content-2026-10-25.1",
  "template=applypack-template-2026-10-25.1",
  `exporter=${DOCUMENT_VERSIONS.exporter}`,
].join("|");

// Previously released files remain customer-accessible by their immutable
// quality evidence. This compatibility allowlist must never be used to approve
// or release new work under an older contract.
export const PREVIOUS_DOCUMENT_GENERATOR_VERSION = [
  "applypack-documents",
  "instructions=applypack-universal-document-standard-2026-10-03.1",
  "standardSha256=1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf",
  "content=applypack-content-2026-10-03.1",
  "template=applypack-template-2026-10-03.1",
  "exporter=libreoffice-tagged-pdf-2026-10-03.1",
].join("|");

export const LEGACY_DOCUMENT_GENERATOR_VERSION = [
  "applypack-documents",
  "content=applypack-content-2026-09-22.1",
  "template=applypack-template-2026-09-22.1",
  "exporter=libreoffice-tagged-pdf-2026-09-22.1",
].join("|");

export const SUPPORTED_DOCUMENT_GENERATOR_VERSIONS = Object.freeze([
  DOCUMENT_GENERATOR_VERSION,
  SOURCE_AWARE_DOCUMENT_GENERATOR_VERSION,
  PREVIOUS_DOCUMENT_GENERATOR_VERSION,
  LEGACY_DOCUMENT_GENERATOR_VERSION,
]);

export const DOCUMENT_REQUIREMENTS = Object.freeze({
  language: "en-US",
  font: DOCUMENT_FONT_CONTRACT.family,
  normalDeliveryFormat: "PDF",
  editableFallbackFormat: "DOCX",
  page: {
    widthTwips: 12_240,
    heightTwips: 15_840,
    marginTopBottomInches: 0.55,
    marginLeftRightInches: 0.7,
  },
  typographyHalfPoints: {
    name: 36,
    body: 21,
    contact: 19,
    bullet: 20,
    descriptor: 19,
  },
  spacingTwips: {
    nameAfter: 180,
    resumeContactAfter: 360,
    coverContactAfter: 340,
    headingAfter: 120,
    skillsHeadingBefore: 360,
    experienceHeadingBefore: 280,
    educationHeadingBefore: 200,
    subsequentJobBefore: 200,
    descriptorAfter: 100,
    educationAfter: 60,
    coverBlockAfter: 80,
    coverSubjectAfter: 200,
    coverParagraphAfter: 180,
    signoffBefore: 160,
    signoffAfter: 80,
  },
  lineSpacingTwips: {
    summary: 252,
    skills: 252,
    bullets: 276,
    coverLetter: 269,
  },
  sectionRule: {
    sizeEighthPoints: 12,
    color: "4A4A4A",
    spacePoints: 2,
  },
  coverLetter: {
    paragraphMinimum: 3,
    paragraphMaximum: 4,
    normalWordMinimum: 250,
    supportedWordMaximum: 350,
    humanApprovedWordMaximum: 400,
  },
  pdfExportFilter: 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}',
});

export function isCurrentDocumentGeneratorVersion(value: unknown) {
  return value === DOCUMENT_GENERATOR_VERSION || value === SOURCE_AWARE_DOCUMENT_GENERATOR_VERSION;
}

export function supportedDocumentFontFamily(value: unknown): "Arial" | "Liberation Sans" | null {
  if (value === DOCUMENT_GENERATOR_VERSION || value === SOURCE_AWARE_DOCUMENT_GENERATOR_VERSION) return "Liberation Sans";
  if (value === PREVIOUS_DOCUMENT_GENERATOR_VERSION) return "Arial";
  if (value === LEGACY_DOCUMENT_GENERATOR_VERSION) return "Liberation Sans";
  return null;
}

export function isSupportedDocumentGeneratorVersion(value: unknown) {
  return supportedDocumentFontFamily(value) !== null;
}

export function selectDocumentOutputFormat(allowed: unknown, approved: unknown): "PDF" | "DOCX" | null {
  return selectDocumentDelivery(allowed, approved, false)?.format || null;
}

export type DocumentDeliveryDecision = {
  format: "PDF" | "DOCX";
  reason: "DEFAULT_PDF" | "EMPLOYER_REQUIREMENT" | "APPLICANT_REQUEST";
};

export function selectDocumentDelivery(
  allowed: unknown,
  approved: unknown,
  applicantWordRequested: boolean,
): DocumentDeliveryDecision | null {
  const employer = Array.isArray(allowed) ? allowed : [];
  const configured = Array.isArray(approved) ? approved : [];
  if (applicantWordRequested) {
    return employer.includes("DOCX") && configured.includes("DOCX")
      ? { format: "DOCX", reason: "APPLICANT_REQUEST" }
      : null;
  }
  if (employer.includes("PDF") && configured.includes("PDF")) {
    return { format: "PDF", reason: "DEFAULT_PDF" };
  }
  if (employer.includes("DOCX") && configured.includes("DOCX")) {
    return { format: "DOCX", reason: "EMPLOYER_REQUIREMENT" };
  }
  return null;
}

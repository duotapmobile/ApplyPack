/**
 * Versioned source of truth for every generated ApplyPack resume, cover letter,
 * reference sheet, rendered preview, and customer download.
 *
 * Changing content, layout, or export behavior must increment the matching
 * version. The composite generator version is persisted with artifacts and is
 * used to reject output created under an older contract.
 */
export const DOCUMENT_STANDARD_SHA256 = "1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf";

export const DOCUMENT_VERSIONS = Object.freeze({
  instructions: "applypack-universal-document-standard-2026-10-03.1",
  content: "applypack-content-2026-10-03.1",
  template: "applypack-template-2026-10-03.1",
  exporter: "libreoffice-tagged-pdf-2026-10-03.1",
});

export const DOCUMENT_GENERATOR_VERSION = [
  "applypack-documents",
  `instructions=${DOCUMENT_VERSIONS.instructions}`,
  `standardSha256=${DOCUMENT_STANDARD_SHA256}`,
  `content=${DOCUMENT_VERSIONS.content}`,
  `template=${DOCUMENT_VERSIONS.template}`,
  `exporter=${DOCUMENT_VERSIONS.exporter}`,
].join("|");

// Previously released files remain customer-accessible by their immutable
// quality evidence. This compatibility allowlist must never be used to approve
// or release new work under an older contract.
export const LEGACY_DOCUMENT_GENERATOR_VERSION = [
  "applypack-documents",
  "content=applypack-content-2026-09-22.1",
  "template=applypack-template-2026-09-22.1",
  "exporter=libreoffice-tagged-pdf-2026-09-22.1",
].join("|");

export const SUPPORTED_DOCUMENT_GENERATOR_VERSIONS = Object.freeze([
  DOCUMENT_GENERATOR_VERSION,
  LEGACY_DOCUMENT_GENERATOR_VERSION,
]);

export const DOCUMENT_REQUIREMENTS = Object.freeze({
  language: "en-US",
  font: "Arial",
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
  return value === DOCUMENT_GENERATOR_VERSION;
}

export function supportedDocumentFontFamily(value: unknown): "Arial" | "Liberation Sans" | null {
  if (value === DOCUMENT_GENERATOR_VERSION) return "Arial";
  if (value === LEGACY_DOCUMENT_GENERATOR_VERSION) return "Liberation Sans";
  return null;
}

export function isSupportedDocumentGeneratorVersion(value: unknown) {
  return supportedDocumentFontFamily(value) !== null;
}

export function selectDocumentOutputFormat(allowed: unknown, approved: unknown): "PDF" | "DOCX" | null {
  const employer = Array.isArray(allowed) ? allowed : [];
  const configured = Array.isArray(approved) ? approved : [];
  if (employer.includes("PDF") && configured.includes("PDF")) return "PDF";
  if (employer.includes("DOCX") && configured.includes("DOCX")) return "DOCX";
  return null;
}

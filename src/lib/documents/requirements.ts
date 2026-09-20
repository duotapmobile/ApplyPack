/**
 * Versioned source of truth for every generated ApplyPack resume, cover letter,
 * reference sheet, rendered preview, and customer download.
 *
 * Changing content, layout, or export behavior must increment the matching
 * version. The composite generator version is persisted with artifacts and is
 * used to reject output created under an older contract.
 */
export const DOCUMENT_VERSIONS = Object.freeze({
  content: "applypack-content-2026-09-20.1",
  template: "applypack-template-2026-09-20.1",
  exporter: "libreoffice-tagged-pdf-2026-09-13.1",
});

export const DOCUMENT_GENERATOR_VERSION = [
  "applypack-documents",
  `content=${DOCUMENT_VERSIONS.content}`,
  `template=${DOCUMENT_VERSIONS.template}`,
  `exporter=${DOCUMENT_VERSIONS.exporter}`,
].join("|");

export const DOCUMENT_REQUIREMENTS = Object.freeze({
  language: "en-US",
  font: "Arial",
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
    supportedWordMinimum: 250,
    supportedWordMaximum: 350,
    humanApprovedWordMaximum: 400,
  },
  pdfExportFilter: 'pdf:writer_pdf_Export:{"UseTaggedPDF":{"type":"boolean","value":"true"}}',
  candidatePresentationProfiles: {
    marissaWright: {
      displayName: "Marissa Wright",
      employer: "PRIVATE-LABEL AMAZON E-COMMERCE",
      historicalTitle: "Amazon Marketplace & Operations Specialist",
      forbiddenDefaultTitles: ["Founder", "CEO", "Owner"],
    },
  },
});

export function isCurrentDocumentGeneratorVersion(value: unknown) {
  return value === DOCUMENT_GENERATOR_VERSION;
}

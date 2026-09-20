import { createHash } from "node:crypto";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from "docx";
import JSZip from "jszip";
import { isNonfactualNarrative } from "./claim-validation";
import { DOCUMENT_REQUIREMENTS, DOCUMENT_VERSIONS } from "@/lib/documents/requirements";
import {
  MATERIAL_GENERATOR_VERSION,
  assertDeliverableText,
  careerBreakPresentation,
  cleanUntrustedDocumentText,
  containsPromptInjection,
  materialFilename,
  type CareerBreakChoice,
} from "@/lib/materials/contract";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const PAGE_WIDTH = DOCUMENT_REQUIREMENTS.page.widthTwips;
const PAGE_HEIGHT = DOCUMENT_REQUIREMENTS.page.heightTwips;
const MARGIN_TOP_BOTTOM = convertInchesToTwip(DOCUMENT_REQUIREMENTS.page.marginTopBottomInches);
const MARGIN_LEFT_RIGHT = convertInchesToTwip(DOCUMENT_REQUIREMENTS.page.marginLeftRightInches);
const HEADING_BORDER = {
  style: BorderStyle.SINGLE,
  size: DOCUMENT_REQUIREMENTS.sectionRule.sizeEighthPoints,
  color: DOCUMENT_REQUIREMENTS.sectionRule.color,
  space: DOCUMENT_REQUIREMENTS.sectionRule.spacePoints,
};
const ONE_PAGE_FIT_UNITS = 65;
const TWO_PAGE_FIT_UNITS = 150;

export type EvidenceSentence = {
  text: string;
  candidateFactIds?: string[];
  jobEvidenceIds?: string[];
  narrative?: boolean;
  priority?: number;
  essential?: boolean;
};

export type VerifiedExperience = {
  historicalTitle: string;
  employer: string;
  dates: string;
  location?: string;
  descriptor?: EvidenceSentence;
  headerCandidateFactIds: string[];
  bullets: EvidenceSentence[];
};

export type VerifiedEducation = {
  degree: string;
  detail: string;
  candidateFactIds: string[];
};

export type ReferenceSheetRecord = {
  permissionId: string;
  name: string;
  titleAndOrganization: string;
  relationship: string;
  email: string;
  phone: string;
  approvedContext?: string;
};

export type EmployerDocumentRules = {
  outputFormat: "DOCX" | "PDF";
  resumePageLimit: 1 | 2;
  resumeFilenameInstruction?: string | null;
  coverLetterFilenameInstruction?: string | null;
  referenceFilenameInstruction?: string | null;
};

export type RequirementClassification = "DIRECT_EVIDENCE" | "TRANSFERABLE_EVIDENCE" | "GAP" | "UNKNOWN";

export type RequirementMapping = {
  jobEvidenceId: string;
  classification: RequirementClassification;
  candidateFactIds: string[];
};

export type DocumentMetadata = {
  title: string;
  author: string;
  subject: string;
  language: string;
  keywords: "";
};

export type EvidenceBoundMaterialInput = {
  contact: {
    displayName: string;
    email: string;
    phone: string;
    cityState: string;
    linkedInOrPortfolio?: string | null;
    candidateFactIds: string[];
  };
  job: {
    exactTitle: string;
    employer: string;
    location?: string | null;
    requisitionId?: string | null;
    postingContentSha256: string;
    jobEvidenceIds: string[];
  };
  professionalSummary: EvidenceSentence;
  requirementMappings: RequirementMapping[];
  documentLanguage?: string;
  coreSkills: EvidenceSentence[];
  experiences: VerifiedExperience[];
  experienceOrder?: "REVERSE_CHRONOLOGICAL" | "PRESERVE_APPROVED_HYBRID";
  educationAndCertifications?: VerifiedEducation[];
  coverLetterParagraphs: EvidenceSentence[];
  verifiedHiringManager?: string | null;
  finalVersionAt: string;
  careerBreak: {
    choice: CareerBreakChoice;
    customLabel?: string | null;
    start?: string | null;
    end?: string | null;
    mentionInCoverLetter: boolean;
    candidateFactIds: string[];
  };
  rules: EmployerDocumentRules;
  references?: ReferenceSheetRecord[];
  humanApprovedTwoPageException?: boolean;
  humanApprovedLongLetter?: boolean;
};

export type ClaimProvenanceEntry = {
  placement: string;
  kind: "CANDIDATE_FACT" | "JOB_EVIDENCE" | "MIXED" | "NARRATIVE" | "REFERENCE_PERMISSION";
  candidateFactIds: string[];
  jobEvidenceIds: string[];
  referencePermissionIds: string[];
  visibleTextSha256: string;
};

export type ArtifactProvenance = {
  schemaVersion: "applypack-claim-provenance-v1";
  generatorVersion: string;
  artifact: "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET";
  sourceBinding: {
    candidateFactIds: string[];
    jobEvidenceIds: string[];
    referencePermissionIds: string[];
  };
  claims: ClaimProvenanceEntry[];
  fitActions: string[];
  requirementMappings: RequirementMapping[];
  postingContentSha256: string;
  versions: typeof DOCUMENT_VERSIONS;
};

export type GeneratedArtifact = {
  buffer: Buffer;
  filename: string;
  mimeType: typeof DOCX_MIME;
  provenance: ArtifactProvenance;
  expectedPageCount: 1 | 2;
  metadata: DocumentMetadata;
  versions: typeof DOCUMENT_VERSIONS;
};

export type GeneratedMaterialSet = {
  resume: GeneratedArtifact;
  coverLetter: GeneratedArtifact;
  referenceSheet?: GeneratedArtifact;
  generatorVersion: string;
};

export type EvidenceBoundReferenceInput = Pick<EvidenceBoundMaterialInput,
  "contact" | "job" | "requirementMappings" | "documentLanguage"> & {
  references: ReferenceSheetRecord[];
  rules: Pick<EmployerDocumentRules, "referenceFilenameInstruction">;
};

export async function generateEvidenceBoundReferenceSheet(input: EvidenceBoundReferenceInput): Promise<GeneratedArtifact> {
  if (!input.contact.candidateFactIds.length || input.contact.candidateFactIds.some((id) => !UUID.test(id))) {
    throw new Error("document_contact_fact_binding_required");
  }
  if (!input.job.jobEvidenceIds.length || input.job.jobEvidenceIds.some((id) => !UUID.test(id))) {
    throw new Error("job_evidence_binding_required");
  }
  validateJobBindings(input);
  if (input.references.length < 1 || input.references.length > 3) throw new Error("reference_sheet_count_invalid");
  const claims: ClaimProvenanceEntry[] = [];
  const document = buildReferenceSheet(input, claims);
  const metadata = metadataFor(input, "REFERENCE_SHEET");
  return {
    buffer: await packCleanDocument(document, metadata),
    filename: materialFilename({
      displayName: input.contact.displayName,
      artifact: "References",
      company: input.job.employer,
      position: input.job.exactTitle,
      extension: "docx",
      employerInstruction: input.rules.referenceFilenameInstruction,
      collisionLocation: input.job.location,
      requisitionId: input.job.requisitionId,
    }),
    mimeType: DOCX_MIME,
    provenance: provenance("REFERENCE_SHEET", claims, [], input),
    expectedPageCount: 1,
    metadata,
    versions: DOCUMENT_VERSIONS,
  };
}

export async function generateEvidenceBoundMaterials(input: EvidenceBoundMaterialInput): Promise<GeneratedMaterialSet> {
  validateRootBindings(input);
  const fitted = fitResume(input);
  const resumeClaims: ClaimProvenanceEntry[] = [];
  const coverClaims: ClaimProvenanceEntry[] = [];
  const referenceClaims: ClaimProvenanceEntry[] = [];
  const resumeDocument = buildResume(input, fitted, resumeClaims);
  const resumeMetadata = metadataFor(input, "RESUME");
  const coverMetadata = metadataFor(input, "COVER_LETTER");
  const referenceMetadata = metadataFor(input, "REFERENCE_SHEET");
  const coverDocument = buildCoverLetter(input, coverClaims, fitted.retainedBulletText);
  const extension = "docx" as const;
  const resumeFilename = materialFilename({
    displayName: input.contact.displayName,
    artifact: "Resume",
    company: input.job.employer,
    position: input.job.exactTitle,
    extension,
    employerInstruction: input.rules.resumeFilenameInstruction,
    collisionLocation: input.job.location,
    requisitionId: input.job.requisitionId,
  });
  const coverFilename = materialFilename({
    displayName: input.contact.displayName,
    artifact: "Cover_Letter",
    company: input.job.employer,
    position: input.job.exactTitle,
    extension,
    employerInstruction: input.rules.coverLetterFilenameInstruction,
    collisionLocation: input.job.location,
    requisitionId: input.job.requisitionId,
  });
  const [resumeBuffer, coverBuffer] = await Promise.all([
    packCleanDocument(resumeDocument, resumeMetadata),
    packCleanDocument(coverDocument, coverMetadata),
  ]);
  const result: GeneratedMaterialSet = {
    resume: {
      buffer: resumeBuffer,
      filename: resumeFilename,
      mimeType: DOCX_MIME,
      provenance: provenance("RESUME", resumeClaims, fitted.actions, input),
      expectedPageCount: fitted.expectedPages,
      metadata: resumeMetadata,
      versions: DOCUMENT_VERSIONS,
    },
    coverLetter: {
      buffer: coverBuffer,
      filename: coverFilename,
      mimeType: DOCX_MIME,
      provenance: provenance("COVER_LETTER", coverClaims, [], input),
      expectedPageCount: 1,
      metadata: coverMetadata,
      versions: DOCUMENT_VERSIONS,
    },
    generatorVersion: MATERIAL_GENERATOR_VERSION,
  };
  if (input.references?.length) {
    const referenceDocument = buildReferenceSheet(input, referenceClaims);
    const referenceBuffer = await packCleanDocument(referenceDocument, referenceMetadata);
    result.referenceSheet = {
      buffer: referenceBuffer,
      filename: materialFilename({
        displayName: input.contact.displayName,
        artifact: "References",
        company: input.job.employer,
        position: input.job.exactTitle,
        extension,
        employerInstruction: input.rules.referenceFilenameInstruction,
        collisionLocation: input.job.location,
        requisitionId: input.job.requisitionId,
      }),
      mimeType: DOCX_MIME,
      provenance: provenance("REFERENCE_SHEET", referenceClaims, [], input),
      expectedPageCount: 1,
      metadata: referenceMetadata,
      versions: DOCUMENT_VERSIONS,
    };
  }
  return result;
}

function metadataFor(
  input: Pick<EvidenceBoundMaterialInput, "contact" | "job" | "documentLanguage">,
  artifact: ArtifactProvenance["artifact"],
): DocumentMetadata {
  const name = displayPersonName(input.contact.displayName);
  const company = assertDeliverableText(input.job.employer);
  const target = assertDeliverableText(input.job.exactTitle);
  const artifactTitle = artifact === "RESUME" ? "Resume"
    : artifact === "COVER_LETTER" ? "Cover Letter" : "Professional References";
  return {
    title: `${name} - ${artifactTitle} - ${company}`,
    author: name,
    subject: `${target} application`,
    language: input.documentLanguage || DOCUMENT_REQUIREMENTS.language,
    keywords: "",
  };
}
function validateJobBindings(input: Pick<EvidenceBoundMaterialInput, "job" | "requirementMappings">) {
  if (!/^[0-9a-f]{64}$/i.test(input.job.postingContentSha256)) {
    throw new Error("job_posting_content_hash_required");
  }
  const jobEvidenceIds = unique(input.job.jobEvidenceIds);
  if (jobEvidenceIds.length !== input.job.jobEvidenceIds.length) {
    throw new Error("duplicate_job_evidence_binding");
  }
  const mappings = input.requirementMappings;
  const mappedIds = mappings.map((mapping) => mapping.jobEvidenceId);
  if (mappings.length !== jobEvidenceIds.length || unique(mappedIds).length !== mappedIds.length
    || !jobEvidenceIds.every((id) => mappedIds.includes(id))) {
    throw new Error("complete_requirement_mapping_required");
  }
  for (const mapping of mappings) {
    if (!UUID.test(mapping.jobEvidenceId) || mapping.candidateFactIds.some((id) => !UUID.test(id))) {
      throw new Error("requirement_mapping_identifier_invalid");
    }
    if (!(["DIRECT_EVIDENCE", "TRANSFERABLE_EVIDENCE", "GAP", "UNKNOWN"] as string[])
      .includes(mapping.classification)) {
      throw new Error("requirement_mapping_classification_invalid");
    }
    const supported = mapping.classification === "DIRECT_EVIDENCE" || mapping.classification === "TRANSFERABLE_EVIDENCE";
    if (supported !== Boolean(mapping.candidateFactIds.length)) {
      throw new Error("requirement_mapping_evidence_conflict");
    }
  }
}

function validateCandidatePresentation(input: EvidenceBoundMaterialInput) {
  const profile = DOCUMENT_REQUIREMENTS.candidatePresentationProfiles.marissaWright;
  if (normalizeForComparison(displayPersonName(input.contact.displayName))
    !== normalizeForComparison(profile.displayName)) return;
  for (const experience of input.experiences) {
    if (normalizeForComparison(experience.employer) !== normalizeForComparison(profile.employer)) continue;
    if (experience.historicalTitle !== profile.historicalTitle
      || profile.forbiddenDefaultTitles.some((title) => normalizeForComparison(experience.historicalTitle)
        === normalizeForComparison(title))) {
      throw new Error("candidate_historical_title_preference_conflict");
    }
  }
}

function validateRootBindings(input: EvidenceBoundMaterialInput) {
  if (!input.contact.candidateFactIds.length || input.contact.candidateFactIds.some((id) => !UUID.test(id))) {
    throw new Error("document_contact_fact_binding_required");
  }
  if (!input.job.jobEvidenceIds.length || input.job.jobEvidenceIds.some((id) => !UUID.test(id))) {
    throw new Error("job_evidence_binding_required");
  }
  validateJobBindings(input);
  validateCandidatePresentation(input);
  [
    input.contact.displayName,
    input.contact.email,
    input.contact.phone,
    input.contact.cityState,
    input.job.exactTitle,
    input.job.employer,
  ].forEach(assertDeliverableText);
  if (input.rules.outputFormat !== "DOCX") {
    throw new Error("pdf_renderer_must_generate_and_verify_searchable_output");
  }
  if (input.references && (input.references.length < 1 || input.references.length > 3)) {
    throw new Error("reference_sheet_count_invalid");
  }
  const breakEntry = careerBreakPresentation(input.careerBreak);
  if (breakEntry && (!input.careerBreak.start || !input.careerBreak.end
    || !input.careerBreak.candidateFactIds.length
    || input.careerBreak.candidateFactIds.some((id) => !UUID.test(id)))) {
    throw new Error("career_break_dates_and_fact_binding_required");
  }
}

function provenance(
  artifact: ArtifactProvenance["artifact"],
  claims: ClaimProvenanceEntry[],
  fitActions: string[],
  input: Pick<EvidenceBoundMaterialInput, "job" | "requirementMappings">,
): ArtifactProvenance {
  return {
    schemaVersion: "applypack-claim-provenance-v1",
    generatorVersion: MATERIAL_GENERATOR_VERSION,
    artifact,
    sourceBinding: {
      candidateFactIds: unique(claims.flatMap((claim) => claim.candidateFactIds)),
      jobEvidenceIds: unique(claims.flatMap((claim) => claim.jobEvidenceIds)),
      referencePermissionIds: unique(claims.flatMap((claim) => claim.referencePermissionIds)),
    },
    claims,
    fitActions,
    requirementMappings: input.requirementMappings,
    postingContentSha256: input.job.postingContentSha256,
    versions: DOCUMENT_VERSIONS,
  };
}

function recordClaim(claims: ClaimProvenanceEntry[], placement: string, sentence: EvidenceSentence) {
  const text = assertDeliverableText(sentence.text);
  if (sentence.narrative && !isNonfactualNarrative(text)) throw new Error("document_narrative_contains_unverified_claim");
  const candidateFactIds = unique(sentence.candidateFactIds || []);
  const jobEvidenceIds = unique(sentence.jobEvidenceIds || []);
  if (candidateFactIds.some((id) => !UUID.test(id)) || jobEvidenceIds.some((id) => !UUID.test(id))) {
    throw new Error("claim_provenance_identifier_invalid");
  }
  if (!sentence.narrative && !candidateFactIds.length && !jobEvidenceIds.length) {
    throw new Error("factual_claim_missing_provenance");
  }
  const kind = sentence.narrative && !candidateFactIds.length && !jobEvidenceIds.length ? "NARRATIVE"
    : candidateFactIds.length && jobEvidenceIds.length ? "MIXED"
      : candidateFactIds.length ? "CANDIDATE_FACT" : "JOB_EVIDENCE";
  claims.push({
    placement,
    kind,
    candidateFactIds,
    jobEvidenceIds,
    referencePermissionIds: [],
    visibleTextSha256: sha256(text),
  });
  return text;
}

function recordFixedBinding(
  claims: ClaimProvenanceEntry[],
  placement: string,
  text: string,
  candidateFactIds: string[],
  jobEvidenceIds: string[],
) {
  return recordClaim(claims, placement, { text, candidateFactIds, jobEvidenceIds });
}

function buildResume(
  input: EvidenceBoundMaterialInput,
  fitted: ReturnType<typeof fitResume>,
  claims: ClaimProvenanceEntry[],
) {
  const children: Paragraph[] = [
    ...candidateHeader(input, claims, "resume"),
    majorHeading("PROFESSIONAL SUMMARY", 0),
    paragraph(recordFixedBinding(claims, "resume.targetRole",
      `Target role: ${assertDeliverableText(input.job.exactTitle)}`, [], input.job.jobEvidenceIds),
    { line: DOCUMENT_REQUIREMENTS.lineSpacingTwips.summary, after: 0, size: 21 }),
    paragraph(recordClaim(claims, "resume.summary", fitted.summary), { line: DOCUMENT_REQUIREMENTS.lineSpacingTwips.summary, after: 0, size: 21 }),
  ];
  if (fitted.skills.length) {
    children.push(
      majorHeading("CORE SKILLS", DOCUMENT_REQUIREMENTS.spacingTwips.skillsHeadingBefore),
      paragraph(fitted.skills.map((skill, index) =>
        recordClaim(claims, `resume.skill.${index + 1}`, skill).replace(/ /g, "\u00a0")).join(" | "), { line: DOCUMENT_REQUIREMENTS.lineSpacingTwips.skills, after: 0, size: 21 }),
    );
  }
  children.push(majorHeading("WORK EXPERIENCE", DOCUMENT_REQUIREMENTS.spacingTwips.experienceHeadingBefore));
  fitted.experiences.forEach((experience, experienceIndex) => {
    const title = assertDeliverableText(experience.historicalTitle);
    const employer = assertDeliverableText(experience.employer);
    const dates = assertDeliverableText(experience.dates);
    const location = experience.location ? assertDeliverableText(experience.location) : "";
    const headerText = [title, employer, dates, location].filter(Boolean).join("\n");
    recordFixedBinding(claims, `resume.experience.${experienceIndex + 1}.header`, headerText,
      experience.headerCandidateFactIds, []);
    children.push(
      paragraph(title, {
        before: experienceIndex ? DOCUMENT_REQUIREMENTS.spacingTwips.subsequentJobBefore : 0,
        after: 20,
        size: 21,
        bold: true,
        keepNext: true,
        keepLines: true,
      }),
      paragraph(employer, { after: 20, size: 20, keepNext: true, keepLines: true }),
      paragraph([dates, location].filter(Boolean).join(" | "), {
        after: 40,
        size: 19,
        italics: true,
        keepNext: true,
        keepLines: true,
      }),
    );
    if (experience.descriptor) {
      children.push(paragraph(recordClaim(claims, `resume.experience.${experienceIndex + 1}.descriptor`,
        experience.descriptor), { after: 100, size: 19, italics: true, keepNext: true, keepLines: true }));
    }
    experience.bullets.forEach((bullet, bulletIndex) => {
      children.push(new Paragraph({
        numbering: { reference: "resume-bullets", level: 0 },
        keepLines: true,
        spacing: { line: DOCUMENT_REQUIREMENTS.lineSpacingTwips.bullets, after: 0 },
        children: [new TextRun({
          text: recordClaim(claims, `resume.experience.${experienceIndex + 1}.bullet.${bulletIndex + 1}`, bullet),
          font: "Arial",
          size: 20,
        })],
      }));
    });
  });
  const breakEntry = careerBreakPresentation(input.careerBreak);
  if (breakEntry) {
    const text = [breakEntry.label, breakEntry.dates].filter(Boolean).join(" | ");
    children.push(majorHeading("CAREER BREAK", DOCUMENT_REQUIREMENTS.spacingTwips.educationHeadingBefore));
    children.push(paragraph(recordClaim(claims, "resume.careerBreak", {
      text,
      candidateFactIds: input.careerBreak.candidateFactIds,
    }), { after: 0, size: 21 }));
  }
  if (input.educationAndCertifications?.length) {
    children.push(majorHeading("EDUCATION & CERTIFICATIONS", DOCUMENT_REQUIREMENTS.spacingTwips.educationHeadingBefore));
    input.educationAndCertifications.forEach((education, index) => {
      const text = `${assertDeliverableText(education.degree)} | ${assertDeliverableText(education.detail)}`;
      recordFixedBinding(claims, `resume.education.${index + 1}`, text, education.candidateFactIds, []);
      children.push(new Paragraph({
        spacing: { before: 0, after: index === input.educationAndCertifications!.length - 1 ? 0 : 60 },
        children: [
          new TextRun({ text: assertDeliverableText(education.degree), bold: true, font: "Arial", size: 21 }),
          new TextRun({ text: " | " + assertDeliverableText(education.detail), font: "Arial", size: 21 }),
        ],
      }));
    });
  }
  return documentWith(children, metadataFor(input, "RESUME"));
}

function buildCoverLetter(
  input: EvidenceBoundMaterialInput,
  claims: ClaimProvenanceEntry[],
  resumeBullets: string[],
) {
  const paragraphs = input.coverLetterParagraphs.map((item, index) =>
    recordClaim(claims, `cover.paragraph.${index + 1}`, item));
  if (paragraphs.length < 3 || paragraphs.length > 4) throw new Error("cover_letter_paragraph_count_invalid");
  const wordCount = paragraphs.join(" ").trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < DOCUMENT_REQUIREMENTS.coverLetter.supportedWordMinimum
    || wordCount > DOCUMENT_REQUIREMENTS.coverLetter.humanApprovedWordMaximum
    || (wordCount > DOCUMENT_REQUIREMENTS.coverLetter.supportedWordMaximum && !input.humanApprovedLongLetter)) {
    throw new Error("cover_letter_word_count_invalid");
  }
  if (paragraphs.some((text) => /[\u2013\u2014]/u.test(text))) {
    throw new Error("cover_letter_dash_punctuation_not_allowed");
  }
  if (/^(?:I am writing to express my interest|I am excited to apply|I am thrilled to apply|With my extensive background|I believe I would be an excellent fit)/i.test(paragraphs[0])) {
    throw new Error("generic_cover_letter_opening");
  }
  assertCoverLetterTargetConsistency(paragraphs, input.job.exactTitle, input.job.employer);
  assertNoExcessiveRepetition(paragraphs);
  const evidencePoints = unique(input.coverLetterParagraphs.flatMap((item) => item.candidateFactIds || []));
  if (evidencePoints.length < 2 || evidencePoints.length > 4) throw new Error("cover_letter_evidence_point_count_invalid");
  if (paragraphs.some((text) => resumeBullets.some((bullet) => normalizeForComparison(text) === normalizeForComparison(bullet)))) {
    throw new Error("cover_letter_repeats_resume");
  }
  if (!input.careerBreak.mentionInCoverLetter && paragraphs.some((text) => /career break|family caregiving/i.test(text))) {
    throw new Error("unauthorized_career_break_mention");
  }
  const recipient = input.verifiedHiringManager
    ? assertDeliverableText(input.verifiedHiringManager)
    : `${assertDeliverableText(input.job.employer)} Hiring Team`;
  const salutation = input.verifiedHiringManager ? `Dear ${recipient},` : `Dear ${recipient},`;
  recordFixedBinding(claims, "cover.recipient", recipient, [], input.job.jobEvidenceIds);
  recordFixedBinding(claims, "cover.subject", input.job.exactTitle, [], input.job.jobEvidenceIds);
  const children: Paragraph[] = [
    ...candidateHeader(input, claims, "cover"),
    paragraph(easternDate(input.finalVersionAt), { before: 0, after: DOCUMENT_REQUIREMENTS.spacingTwips.coverBlockAfter, size: 21 }),
    paragraph(recipient, { before: 0, after: DOCUMENT_REQUIREMENTS.spacingTwips.coverBlockAfter, size: 21 }),
    new Paragraph({
      spacing: { before: 0, after: DOCUMENT_REQUIREMENTS.spacingTwips.coverSubjectAfter },
      children: [
        new TextRun({ text: "Re: ", bold: true, font: "Arial", size: 21 }),
        new TextRun({ text: assertDeliverableText(input.job.exactTitle), bold: true, font: "Arial", size: 21 }),
      ],
    }),
    paragraph(salutation, { after: DOCUMENT_REQUIREMENTS.spacingTwips.coverParagraphAfter, size: 21 }),
    ...paragraphs.map((text) => paragraph(text, {
      line: DOCUMENT_REQUIREMENTS.lineSpacingTwips.coverLetter,
      after: DOCUMENT_REQUIREMENTS.spacingTwips.coverParagraphAfter,
      size: 21 })),
    paragraph("Sincerely,", { before: DOCUMENT_REQUIREMENTS.spacingTwips.signoffBefore, after: DOCUMENT_REQUIREMENTS.spacingTwips.signoffAfter, size: 21 }),
    paragraph(displayPersonName(input.contact.displayName), { after: 0, size: 21 }),
  ];
  return documentWith(children, metadataFor(input, "COVER_LETTER"));
}

function buildReferenceSheet(input: Pick<EvidenceBoundMaterialInput, "contact" | "job"> & { references?: ReferenceSheetRecord[] }, claims: ClaimProvenanceEntry[]) {
  const records = input.references || [];
  const children: Paragraph[] = [
    ...candidateHeader(input, claims, "references"),
    majorHeading("PROFESSIONAL REFERENCES", 0),
  ];
  records.forEach((record, index) => {
    if (!UUID.test(record.permissionId)) throw new Error("reference_permission_identifier_invalid");
    const displayed = [record.name, record.titleAndOrganization, record.relationship, record.email, record.phone,
      record.approvedContext || ""].map((value) => value ? assertDeliverableText(value) : "").filter(Boolean);
    claims.push({
      placement: `references.record.${index + 1}`,
      kind: "REFERENCE_PERMISSION",
      candidateFactIds: [],
      jobEvidenceIds: input.job.jobEvidenceIds,
      referencePermissionIds: [record.permissionId],
      visibleTextSha256: sha256(displayed.join("\n")),
    });
    children.push(new Paragraph({
      spacing: { before: 0, after: 40 },
      children: [new TextRun({ text: assertDeliverableText(record.name), font: "Arial", size: 21 })],
    }));
    [record.titleAndOrganization, record.relationship, record.email, record.phone, record.approvedContext]
      .filter((value): value is string => Boolean(value))
      .forEach((value, valueIndex, values) => children.push(paragraph(assertDeliverableText(value), {
        before: 0,
        after: valueIndex === values.length - 1 ? 200 : 40,
        size: 21,
      })));
  });
  return documentWith(children, metadataFor(input, "REFERENCE_SHEET"));
}

function candidateHeader(
  input: Pick<EvidenceBoundMaterialInput, "contact" | "job">,
  claims: ClaimProvenanceEntry[],
  prefix: string,
) {
  const name = displayPersonName(input.contact.displayName);
  const primaryContact = [input.contact.phone, input.contact.email, input.contact.cityState]
    .filter((value): value is string => Boolean(value))
    .map(assertDeliverableText)
    .join(" | ");
  const portfolio = input.contact.linkedInOrPortfolio
    ? assertDeliverableText(input.contact.linkedInOrPortfolio) : null;
  const contact = [primaryContact, portfolio].filter(Boolean).join("\n");
  const contactAfter = prefix === "cover" ? DOCUMENT_REQUIREMENTS.spacingTwips.coverContactAfter
    : DOCUMENT_REQUIREMENTS.spacingTwips.resumeContactAfter;
  recordFixedBinding(claims, `${prefix}.header.name`, name, input.contact.candidateFactIds, []);
  recordFixedBinding(claims, `${prefix}.header.contact`, contact, input.contact.candidateFactIds, []);
  return [
    paragraph(name, { alignment: AlignmentType.CENTER, size: 36, after: DOCUMENT_REQUIREMENTS.spacingTwips.nameAfter }),
    paragraph(primaryContact, { alignment: AlignmentType.CENTER, size: 19, after: portfolio ? 35 : contactAfter }),
    ...(portfolio ? [paragraph(portfolio, { alignment: AlignmentType.CENTER, size: 19, after: contactAfter })] : []),
  ];
}

function documentWith(children: Paragraph[], metadata: DocumentMetadata) {
  return new Document({
    creator: metadata.author,
    title: metadata.title,
    subject: metadata.subject,
    description: "",
    keywords: metadata.keywords,
    lastModifiedBy: "",
    revision: 1,
    numbering: {
      config: [{
        reference: "resume-bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "•",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.17), hanging: convertInchesToTwip(0.11) } } },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 21, color: "000000", language: { value: metadata.language } },
          paragraph: { spacing: { before: 0, after: 0, line: 240 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: {
            top: MARGIN_TOP_BOTTOM,
            bottom: MARGIN_TOP_BOTTOM,
            left: MARGIN_LEFT_RIGHT,
            right: MARGIN_LEFT_RIGHT,
            header: 0,
            footer: 0,
            gutter: 0,
          },
        },
      },
      children,
    }],
  });
}

async function packCleanDocument(document: Document, metadata: DocumentMetadata) {
  const packed = await Packer.toBuffer(document);
  const zip = await JSZip.loadAsync(packed);
  [
    "word/comments.xml",
    "word/_rels/comments.xml.rels",
    "docProps/custom.xml",
  ].forEach((name) => zip.remove(name));
  const relationships = zip.file("word/_rels/document.xml.rels");
  if (relationships) {
    const xml = await relationships.async("string");
    zip.file("word/_rels/document.xml.rels", xml.replace(/<Relationship\b[^>]*\bTarget="comments\.xml"[^>]*\/>/giu, ""));
  }
  const contentTypes = zip.file("[Content_Types].xml");
  if (contentTypes) {
    const xml = await contentTypes.async("string");
    zip.file("[Content_Types].xml", xml
      .replace(/<Override\b[^>]*\bPartName="\/word\/comments\.xml"[^>]*\/>/giu, "")
      .replace(/<Override\b[^>]*\bPartName="\/docProps\/custom\.xml"[^>]*\/>/giu, ""));
  }
  const packageRelationships = zip.file("_rels/.rels");
  if (packageRelationships) {
    const xml = await packageRelationships.async("string");
    zip.file("_rels/.rels", xml.replace(/<Relationship\b[^>]*\bTarget="docProps\/custom\.xml"[^>]*\/>/giu, ""));
  }
  const core = zip.file("docProps/core.xml");
  if (core) {
    const xml = await core.async("string");
    const withoutEditor = xml
      .replace(/<cp:lastModifiedBy(?:\s[^>]*)?>[\s\S]*?<\/cp:lastModifiedBy>/iu, "<cp:lastModifiedBy/>");
    const language = escapeXml(metadata.language);
    const withLanguage = /<dc:language(?:\s[^>]*)?>/iu.test(withoutEditor)
      ? withoutEditor.replace(/<dc:language(?:\s[^>]*)?>[\s\S]*?<\/dc:language>/iu, `<dc:language>${language}</dc:language>`)
      : withoutEditor.replace(/<\/cp:coreProperties>/iu, `<dc:language>${language}</dc:language></cp:coreProperties>`);
    zip.file("docProps/core.xml", withLanguage);
  }
  const cleaned = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  packed.fill(0);
  return cleaned;
}

function majorHeading(text: string, before: number) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    outlineLevel: 0,
    keepNext: true,
    keepLines: true,
    spacing: { before, after: DOCUMENT_REQUIREMENTS.spacingTwips.headingAfter },
    border: { bottom: HEADING_BORDER },
    children: [new TextRun({ text, bold: true, font: "Arial", size: 21 })],
  });
}

function paragraph(text: string, options: {
  before?: number;
  after?: number;
  line?: number;
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  size?: number;
  bold?: boolean;
  italics?: boolean;
  keepNext?: boolean;
  keepLines?: boolean;
}) {
  return new Paragraph({
    alignment: options.alignment || AlignmentType.LEFT,
    keepNext: options.keepNext,
    keepLines: options.keepLines,
    spacing: { before: options.before || 0, after: options.after || 0, line: options.line || 240 },
    children: [new TextRun({
      text: assertDeliverableText(text),
      font: "Arial",
      size: options.size || 21,
      bold: options.bold,
      italics: options.italics,
      color: "000000",
    })],
  });
}

function fitResume(input: EvidenceBoundMaterialInput) {
  const experiences = input.experiences.map((experience, originalIndex) => ({
    ...experience,
    bullets: [...experience.bullets],
    originalIndex,
  }));
  if (input.experienceOrder !== "PRESERVE_APPROVED_HYBRID") {
    experiences.sort((left, right) => experienceEndSortKey(right.dates) - experienceEndSortKey(left.dates)
      || left.originalIndex - right.originalIndex);
  }
  const skills = [...input.coreSkills];
  const summary = { ...input.professionalSummary };
  const actions: string[] = [];
  if (experiences.some((experience, index) => experience.originalIndex !== index)) {
    actions.push("ordered_experience_reverse_chronological");
  }
  const units = () => 14
    + Math.ceil(summary.text.length / 85)
    + skills.length
    + experiences.reduce((total, experience) => total + 5
      + experience.bullets.reduce((sum, bullet) => sum + Math.max(1, Math.ceil(bullet.text.length / 90)), 0), 0)
    + (input.educationAndCertifications?.length || 0) * 2;
  if (units() > ONE_PAGE_FIT_UNITS) {
    const leastRelevant = experiences.flatMap((experience, experienceIndex) =>
      experience.bullets.map((bullet, bulletIndex) => ({ experience, experienceIndex, bullet, bulletIndex })))
      .filter((entry) => !entry.bullet.essential && entry.experience.bullets.length > 1)
      .sort((left, right) => (right.bullet.priority || 3) - (left.bullet.priority || 3)
        || right.experienceIndex - left.experienceIndex || right.bulletIndex - left.bulletIndex)[0];
    if (leastRelevant) {
      leastRelevant.experience.bullets.splice(leastRelevant.bulletIndex, 1);
      actions.push("removed_least_relevant_bullet");
    }
  }
  if (units() > ONE_PAGE_FIT_UNITS) {
    const seenBullets = new Set<string>();
    let redundant = false;
    experiences.forEach((experience) => {
      experience.bullets = experience.bullets.filter((bullet) => {
        const key = normalizeForComparison(bullet.text);
        if (!bullet.essential && seenBullets.has(key) && experience.bullets.length > 1) {
          redundant = true;
          return false;
        }
        seenBullets.add(key);
        return true;
      });
    });
    const seenSkills = new Set<string>();
    const deduplicatedSkills = skills.filter((skill) => {
      const key = normalizeForComparison(skill.text);
      if (!skill.essential && seenSkills.has(key)) {
        redundant = true;
        return false;
      }
      seenSkills.add(key);
      return true;
    });
    skills.splice(0, skills.length, ...deduplicatedSkills);
    if (redundant) actions.push("shortened_redundancy");
  }
  while (units() > ONE_PAGE_FIT_UNITS) {
    const removableSkill = skills.map((skill, index) => ({ skill, index }))
      .filter(({ skill }) => !skill.essential)
      .sort((left, right) => (right.skill.priority || 3) - (left.skill.priority || 3))[0];
    if (!removableSkill) break;
    skills.splice(removableSkill.index, 1);
    if (!actions.includes("removed_low_priority_skill")) actions.push("removed_low_priority_skill");
  }
  if (units() > ONE_PAGE_FIT_UNITS && summary.text.length > 240) {
    const sentences = summary.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((value) => value.trim()).filter(Boolean) || [];
    if (sentences.length >= 3) {
      summary.text = sentences.slice(0, 2).join(" ");
      actions.push("tightened_summary");
    }
  }
  while (units() > ONE_PAGE_FIT_UNITS) {
    const olderDetail = experiences.flatMap((experience, experienceIndex) =>
      experienceIndex === 0 ? [] : experience.bullets.map((bullet, bulletIndex) => ({ experience, experienceIndex, bullet, bulletIndex })))
      .filter((entry) => !entry.bullet.essential && entry.experience.bullets.length > 1)
      .sort((left, right) => right.experienceIndex - left.experienceIndex
        || (right.bullet.priority || 3) - (left.bullet.priority || 3))[0];
    if (!olderDetail) break;
    olderDetail.experience.bullets.splice(olderDetail.bulletIndex, 1);
    if (!actions.includes("reduced_older_role_detail")) actions.push("reduced_older_role_detail");
  }
  if (units() > TWO_PAGE_FIT_UNITS) throw new Error("resume_content_exceeds_two_page_limit");
  const expectedPages = units() <= ONE_PAGE_FIT_UNITS ? 1 : 2;
  if (expectedPages === 2 && input.rules.resumePageLimit !== 2) {
    throw new Error("resume_content_exceeds_employer_page_limit");
  }
  const marissaProfile = DOCUMENT_REQUIREMENTS.candidatePresentationProfiles.marissaWright;
  const isMarissa = normalizeForComparison(displayPersonName(input.contact.displayName))
    === normalizeForComparison(marissaProfile.displayName);
  if (expectedPages === 2 && isMarissa && !input.humanApprovedTwoPageException) {
    throw new Error("resume_content_requires_human_approved_two_page_exception");
  }
  if (expectedPages === 2) actions.push(isMarissa ? "human_approved_two_page_exception" : "substantive_two_page_resume");
  return {
    experiences,
    skills,
    summary,
    actions,
    expectedPages: expectedPages as 1 | 2,
    retainedBulletText: experiences.flatMap((experience) => experience.bullets.map((bullet) => cleanUntrustedDocumentText(bullet.text))),
  };
}

function easternDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("final_version_date_invalid");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function normalizeForComparison(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function displayPersonName(value: string) {
  const name = assertDeliverableText(value);
  if (/\p{Ll}/u.test(name)) return name;
  return name.toLocaleLowerCase("en-US").replace(/(^|[\s'’\-])\p{L}/gu, (letter) => letter.toLocaleUpperCase("en-US"));
}

function experienceEndSortKey(value: string) {
  const normalized = assertDeliverableText(value);
  if (/\b(?:present|current|now)\b/i.test(normalized)) return Number.MAX_SAFE_INTEGER;
  const years = [...normalized.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  return years.length ? Math.max(...years) : Number.NEGATIVE_INFINITY;
}

function assertCoverLetterTargetConsistency(paragraphs: string[], jobTitleValue: string, employerValue: string) {
  const jobTitle = normalizeForComparison(assertDeliverableText(jobTitleValue));
  const employer = normalizeForComparison(assertDeliverableText(employerValue));
  const opening = normalizeForComparison(paragraphs[0]);
  if (!opening.includes(jobTitle) && !opening.includes(employer)) {
    throw new Error("cover_letter_target_not_specific");
  }
  for (const paragraphText of paragraphs) {
    const normalized = normalizeForComparison(paragraphText);
    const patterns = [
      new RegExp(`\\bthe (.+?) role at ${escapeRegExp(employer)} calls for\\b`, "g"),
      /\bthe (.{1,80}?) (?:role|position) calls for\b/g,
    ];
    for (const pattern of patterns) {
      for (const match of normalized.matchAll(pattern)) {
        if (match[1] !== jobTitle) {
          throw new Error("cover_letter_target_role_mismatch");
        }
      }
    }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoExcessiveRepetition(paragraphs: string[]) {
  const words = normalizeForComparison(paragraphs.join(" ")).split(" ").filter(Boolean);
  const seen = new Map<string, number>();
  const windowSize = 8;
  for (let index = 0; index <= words.length - windowSize; index += 1) {
    const phrase = words.slice(index, index + windowSize).join(" ");
    const count = (seen.get(phrase) || 0) + 1;
    if (count >= 3) throw new Error("cover_letter_excessive_repetition");
    seen.set(phrase, count);
  }
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export type DocxPackageInspection = {
  passed: boolean;
  checks: Record<string, boolean>;
  extractedText: string;
  extractedTextSha256: string;
  packageQaSha256: string;
  relationships: string[];
  entries: string[];
};

export async function inspectDocxPackage(
  buffer: Buffer,
  artifact: ArtifactProvenance["artifact"],
): Promise<DocxPackageInspection> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort();
  const read = async (name: string) => zip.file(name)?.async("string") || "";
  const [documentXml, stylesXml, numberingXml, coreXml, relationshipsXml] = await Promise.all([
    read("word/document.xml"),
    read("word/styles.xml"),
    read("word/numbering.xml"),
    read("docProps/core.xml"),
    read("word/_rels/document.xml.rels"),
  ]);
  const allXml = (await Promise.all(entries.filter((name) => name.endsWith(".xml") || name.endsWith(".rels"))
    .map(read))).join("\n");
  const relationships = [...relationshipsXml.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*>/g)]
    .map((match) => match[1]).sort();
  const extractedText = [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXml(match[1])).join(" ").replace(/\s+/g, " ").trim();
  const forbiddenEntries = entries.some((name) => /(?:vbaProject|macros|comments|people\.xml|customXml\/|embeddings\/|word\/media\/|word\/header\d*\.xml|word\/footer\d*\.xml)/i.test(name));
  const checks: Record<string, boolean> = {
    packageSignature: buffer.subarray(0, 2).toString() === "PK",
    requiredParts: entries.includes("word/document.xml") && entries.includes("word/styles.xml"),
    noForbiddenParts: !forbiddenEntries,
    noExternalRelationships: !/\bTargetMode="External"/i.test(relationshipsXml),
    singleColumnLinearLayout: !/<w:(?:tbl|txbxContent|drawing|pict)\b/i.test(documentXml)
      && !/<w:cols\b[^>]*\bw:num="(?:[2-9]|\d{2,})"/i.test(documentXml),
    noTrackedChangesOrComments: !/<w:(?:ins|del|moveFrom|moveTo|commentRangeStart|commentRangeEnd|commentReference)\b/i.test(allXml),
    noHiddenOrWhiteText: !/<w:(?:vanish|webHidden)\b/i.test(allXml)
      && !/<w:color\b[^>]*\bw:val="(?:FFFFFF|ffffff|white)"/i.test(allXml),
    noCustomOrGeneratorMetadata: !entries.includes("docProps/custom.xml")
      && !/(applypack-claim-provenance|candidateFactIds|jobEvidenceIds|referencePermissionIds)/i.test(allXml),
    metadataPresent: /<dc:title>\s*[^<\s][\s\S]*?<\/dc:title>/i.test(coreXml)
      && /<dc:creator>\s*[^<\s][\s\S]*?<\/dc:creator>/i.test(coreXml)
      && /<dc:subject>\s*[^<\s][\s\S]*?<\/dc:subject>/i.test(coreXml),
    languageMetadata: /<dc:language>en-US<\/dc:language>/i.test(coreXml),
    keywordsEmpty: !/<cp:keywords>\s*[^<\s][\s\S]*?<\/cp:keywords>/i.test(coreXml),
    editorIdentityEmpty: !/<cp:lastModifiedBy>\s*[^<\s][\s\S]*?<\/cp:lastModifiedBy>/i.test(coreXml),
    usLetter: /<w:pgSz\b[^>]*\bw:w="12240"[^>]*\bw:h="15840"/i.test(documentXml),
    exactMargins: /<w:pgMar\b[^>]*\bw:top="792"[^>]*\bw:right="1008"[^>]*\bw:bottom="792"[^>]*\bw:left="1008"/i.test(documentXml),
    arial: /w:(?:ascii|hAnsi|cs)="Arial"/i.test(stylesXml + documentXml),
    nativeBullets: artifact !== "RESUME" || (Boolean(numberingXml) && /<w:numPr>/i.test(documentXml)),
    semanticSectionHeadings: artifact === "COVER_LETTER" || /<w:pStyle\b[^>]*\bw:val="Heading1"/i.test(documentXml),
    keepHeadingsWithContent: artifact === "COVER_LETTER" || /<w:keepNext\b/i.test(documentXml),
    noPlaceholdersOrPromptArtifacts: Boolean(extractedText)
      && !/\[[^\]]+\]|\b(?:TBD|TODO|PLACEHOLDER|INSERT (?:NAME|DATE|COMPANY|TITLE)|YOUR NAME)\b/i.test(extractedText)
      && !containsPromptInjection(extractedText),
    noVisibleInternalIdentifiers: !UUID_ANY.test(extractedText)
      && !/\b(?:candidate|job|reference)(?:Fact|Evidence|Permission)Ids?\b/i.test(extractedText),
  };
  const packageQaSha256 = sha256(JSON.stringify({
    artifact,
    checks,
    entries,
    relationships,
    extractedTextSha256: sha256(extractedText),
  }));
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    extractedText,
    extractedTextSha256: sha256(extractedText),
    packageQaSha256,
    relationships,
    entries,
  };
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

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
const PAGE_WIDTH = 12_240;
const PAGE_HEIGHT = 15_840;
const MARGIN_TOP_BOTTOM = convertInchesToTwip(0.55);
const MARGIN_LEFT_RIGHT = convertInchesToTwip(0.7);
const HEADING_BORDER = { style: BorderStyle.SINGLE, size: 12, color: "4A4A4A", space: 2 };
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
    jobEvidenceIds: string[];
  };
  professionalSummary: EvidenceSentence;
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
};

export type GeneratedArtifact = {
  buffer: Buffer;
  filename: string;
  mimeType: typeof DOCX_MIME;
  provenance: ArtifactProvenance;
  expectedPageCount: 1 | 2;
};

export type GeneratedMaterialSet = {
  resume: GeneratedArtifact;
  coverLetter: GeneratedArtifact;
  referenceSheet?: GeneratedArtifact;
  generatorVersion: string;
};

export type EvidenceBoundReferenceInput = Pick<EvidenceBoundMaterialInput, "contact" | "job"> & {
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
  if (input.references.length < 1 || input.references.length > 3) throw new Error("reference_sheet_count_invalid");
  const claims: ClaimProvenanceEntry[] = [];
  const document = buildReferenceSheet(input, claims);
  return {
    buffer: await packCleanDocument(document),
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
    provenance: provenance("REFERENCE_SHEET", claims, []),
    expectedPageCount: 1,
  };
}

export async function generateEvidenceBoundMaterials(input: EvidenceBoundMaterialInput): Promise<GeneratedMaterialSet> {
  validateRootBindings(input);
  const fitted = fitResume(input);
  const resumeClaims: ClaimProvenanceEntry[] = [];
  const coverClaims: ClaimProvenanceEntry[] = [];
  const referenceClaims: ClaimProvenanceEntry[] = [];
  const resumeDocument = buildResume(input, fitted, resumeClaims);
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
    packCleanDocument(resumeDocument),
    packCleanDocument(coverDocument),
  ]);
  const result: GeneratedMaterialSet = {
    resume: {
      buffer: resumeBuffer,
      filename: resumeFilename,
      mimeType: DOCX_MIME,
      provenance: provenance("RESUME", resumeClaims, fitted.actions),
      expectedPageCount: fitted.expectedPages,
    },
    coverLetter: {
      buffer: coverBuffer,
      filename: coverFilename,
      mimeType: DOCX_MIME,
      provenance: provenance("COVER_LETTER", coverClaims, []),
      expectedPageCount: 1,
    },
    generatorVersion: MATERIAL_GENERATOR_VERSION,
  };
  if (input.references?.length) {
    const referenceDocument = buildReferenceSheet(input, referenceClaims);
    const referenceBuffer = await packCleanDocument(referenceDocument);
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
      provenance: provenance("REFERENCE_SHEET", referenceClaims, []),
      expectedPageCount: 1,
    };
  }
  return result;
}

function validateRootBindings(input: EvidenceBoundMaterialInput) {
  if (!input.contact.candidateFactIds.length || input.contact.candidateFactIds.some((id) => !UUID.test(id))) {
    throw new Error("document_contact_fact_binding_required");
  }
  if (!input.job.jobEvidenceIds.length || input.job.jobEvidenceIds.some((id) => !UUID.test(id))) {
    throw new Error("job_evidence_binding_required");
  }
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
  };
}

function recordClaim(claims: ClaimProvenanceEntry[], placement: string, sentence: EvidenceSentence) {
  const text = assertDeliverableText(sentence.text);
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
    paragraph(recordClaim(claims, "resume.summary", fitted.summary), { line: 252, after: 0, size: 21 }),
  ];
  if (fitted.skills.length) {
    children.push(
      majorHeading("CORE SKILLS", 360),
      paragraph(fitted.skills.map((skill, index) =>
        recordClaim(claims, `resume.skill.${index + 1}`, skill)).join(" | "), { line: 240, after: 0, size: 21 }),
    );
  }
  children.push(majorHeading("WORK EXPERIENCE", 280));
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
        before: experienceIndex ? 160 : 60,
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
        spacing: { line: 288, after: 140 },
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
    const text = [`${breakEntry.label} (non-employment timeline note)`, breakEntry.dates].filter(Boolean).join(" | ");
    children.push(majorHeading("CAREER TIMELINE NOTE", 200));
    children.push(paragraph(recordClaim(claims, "resume.careerBreak", {
      text,
      candidateFactIds: input.careerBreak.candidateFactIds,
    }), { after: 0, size: 21, bold: true }));
  }
  if (input.educationAndCertifications?.length) {
    children.push(majorHeading("EDUCATION & CERTIFICATIONS", 200));
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
  return documentWith(children);
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
  if (wordCount < 250 || wordCount > 400 || (wordCount > 350 && !input.humanApprovedLongLetter)) {
    throw new Error("cover_letter_word_count_invalid");
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
    paragraph(easternDate(input.finalVersionAt), { before: 0, after: 80, size: 21 }),
    paragraph(recipient, { before: 0, after: 80, size: 21 }),
    new Paragraph({
      spacing: { before: 0, after: 200 },
      children: [
        new TextRun({ text: "Re: ", bold: true, font: "Arial", size: 21 }),
        new TextRun({ text: assertDeliverableText(input.job.exactTitle), bold: true, font: "Arial", size: 21 }),
      ],
    }),
    paragraph(salutation, { after: 180, size: 21 }),
    ...paragraphs.map((text) => paragraph(text, { line: 269, after: 180, size: 21 })),
    paragraph("Sincerely,", { before: 160, after: 80, size: 21 }),
    paragraph(assertDeliverableText(input.contact.displayName), { after: 0, size: 21, bold: true }),
  ];
  return documentWith(children);
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
      children: [new TextRun({ text: assertDeliverableText(record.name), bold: true, font: "Arial", size: 21 })],
    }));
    [record.titleAndOrganization, record.relationship, record.email, record.phone, record.approvedContext]
      .filter((value): value is string => Boolean(value))
      .forEach((value, valueIndex, values) => children.push(paragraph(assertDeliverableText(value), {
        before: 0,
        after: valueIndex === values.length - 1 ? 200 : 40,
        size: 21,
      })));
  });
  return documentWith(children);
}

function candidateHeader(
  input: Pick<EvidenceBoundMaterialInput, "contact" | "job">,
  claims: ClaimProvenanceEntry[],
  prefix: string,
) {
  const name = assertDeliverableText(input.contact.displayName).toUpperCase();
  const target = assertDeliverableText(input.job.exactTitle).toUpperCase();
  const contact = [input.contact.phone, input.contact.email, input.contact.cityState, input.contact.linkedInOrPortfolio]
    .filter((value): value is string => Boolean(value))
    .map(assertDeliverableText)
    .join(" | ");
  recordFixedBinding(claims, `${prefix}.header.name`, name, input.contact.candidateFactIds, []);
  recordFixedBinding(claims, `${prefix}.header.target`, target, [], input.job.jobEvidenceIds);
  recordFixedBinding(claims, `${prefix}.header.contact`, contact, input.contact.candidateFactIds, []);
  return [
    paragraph(name, { alignment: AlignmentType.CENTER, size: 36, bold: true, after: 180 }),
    paragraph(target, { alignment: AlignmentType.CENTER, size: 23, bold: true, after: 60 }),
    paragraph(contact, { alignment: AlignmentType.CENTER, size: 19, after: 360 }),
  ];
}

function documentWith(children: Paragraph[]) {
  return new Document({
    creator: "",
    title: "",
    subject: "",
    description: "",
    keywords: "",
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
          run: { font: "Arial", size: 21, color: "000000" },
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

async function packCleanDocument(document: Document) {
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
    zip.file("docProps/core.xml", xml
      .replace(/<dc:creator(?:\s[^>]*)?>[\s\S]*?<\/dc:creator>/iu, "<dc:creator/>")
      .replace(/<cp:lastModifiedBy(?:\s[^>]*)?>[\s\S]*?<\/cp:lastModifiedBy>/iu, "<cp:lastModifiedBy/>"));
  }
  const cleaned = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  packed.fill(0);
  return cleaned;
}

function majorHeading(text: string, before: number) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    keepNext: true,
    keepLines: true,
    spacing: { before, after: 120 },
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
  if (expectedPages === 2 && (!input.humanApprovedTwoPageException || input.rules.resumePageLimit !== 2)) {
    throw new Error("resume_content_requires_human_approved_two_page_exception");
  }
  if (expectedPages === 2) actions.push("human_approved_two_page_exception");
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
      && !/<dc:creator>\s*[^<\s][\s\S]*?<\/dc:creator>/i.test(coreXml)
      && !/<cp:lastModifiedBy>\s*[^<\s][\s\S]*?<\/cp:lastModifiedBy>/i.test(coreXml)
      && !/(applypack-claim-provenance|candidateFactIds|jobEvidenceIds|referencePermissionIds)/i.test(allXml),
    usLetter: /<w:pgSz\b[^>]*\bw:w="12240"[^>]*\bw:h="15840"/i.test(documentXml),
    exactMargins: /<w:pgMar\b[^>]*\bw:top="792"[^>]*\bw:right="1008"[^>]*\bw:bottom="792"[^>]*\bw:left="1008"/i.test(documentXml),
    arial: /w:(?:ascii|hAnsi|cs)="Arial"/i.test(stylesXml + documentXml),
    nativeBullets: artifact !== "RESUME" || (Boolean(numberingXml) && /<w:numPr>/i.test(documentXml)),
    semanticSectionHeadings: artifact === "COVER_LETTER" || /<w:pStyle\b[^>]*\bw:val="Heading2"/i.test(documentXml),
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

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export type DocumentDraftInput = {
  fullName: string;
  email: string;
  location: string;
  jobTitle: string;
  employer: string;
  direction: string;
  backgroundDetails: string;
  backgroundTypes: string[];
  tools: string;
  credentials: string;
  emphasisNotes: string;
};

/** Compatibility boundary for the pre-corrected fulfillment workflow. */
export async function generateApplyPackDrafts(input: DocumentDraftInput) {
  const fullName = assertDeliverableText(input.fullName);
  const jobTitle = assertDeliverableText(input.jobTitle);
  const employer = assertDeliverableText(input.employer);
  const contact = [input.email, input.location].map(assertDeliverableText).join(" | ");
  const facts = [input.backgroundDetails, ...input.backgroundTypes, input.tools, input.credentials]
    .map((value) => value.trim()).filter(Boolean).map(assertDeliverableText);
  if (!facts.length) throw new Error("document_source_data_missing");
  const resume = documentWith([
    paragraph(fullName.toUpperCase(), { alignment: AlignmentType.CENTER, size: 36, bold: true, after: 180 }),
    paragraph(jobTitle.toUpperCase(), { alignment: AlignmentType.CENTER, size: 23, bold: true, after: 60 }),
    paragraph(contact, { alignment: AlignmentType.CENTER, size: 19, after: 360 }),
    majorHeading("PROFESSIONAL SUMMARY", 0),
    paragraph(facts[0], { line: 252, after: 0, size: 21 }),
    majorHeading("CORE SKILLS", 360),
    paragraph(facts.slice(1).join(" | ") || assertDeliverableText(input.direction), { line: 240, after: 0, size: 21 }),
    majorHeading("WORK EXPERIENCE", 280),
    paragraph(facts.join(" "), { line: 288, after: 0, size: 20 }),
  ]);
  const coverLetter = documentWith([
    paragraph(fullName.toUpperCase(), { alignment: AlignmentType.CENTER, size: 36, bold: true, after: 180 }),
    paragraph(contact, { alignment: AlignmentType.CENTER, size: 19, after: 360 }),
    paragraph(`${employer} Hiring Team`, { after: 200, size: 21 }),
    paragraph(`Re: ${jobTitle}`, { after: 200, size: 21, bold: true }),
    paragraph(`Dear ${employer} Hiring Team,`, { after: 180, size: 21 }),
    paragraph(`${facts.join(" ")} This background is relevant to the ${jobTitle} opportunity and the customer's stated ${assertDeliverableText(input.direction)} direction.`, { line: 269, after: 180, size: 21 }),
    paragraph("Sincerely,", { before: 160, after: 80, size: 21 }),
    paragraph(fullName, { after: 0, size: 21, bold: true }),
  ]);
  const [resumeBuffer, coverLetterBuffer] = await Promise.all([
    Packer.toBuffer(resume),
    Packer.toBuffer(coverLetter),
  ]);
  return {
    resume: resumeBuffer,
    coverLetter: coverLetterBuffer,
    generatorVersion: "first-party-structured-v1",
  };
}

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  generateEvidenceBoundMaterials,
  inspectDocxPackage,
  type EvidenceBoundMaterialInput,
  type GeneratedArtifact,
} from "@/lib/documents/generate";
import {
  documentRendererConfiguration,
  renderDocumentLocallyForQa,
} from "@/lib/documents/renderer";

const FACT_CONTACT = "10000000-0000-4000-8000-000000000001";
const FACT_ONE = "10000000-0000-4000-8000-000000000002";
const FACT_TWO = "10000000-0000-4000-8000-000000000003";
const FACT_HEADER = "10000000-0000-4000-8000-000000000004";
const FACT_BREAK = "10000000-0000-4000-8000-000000000005";
const JOB_EVIDENCE = "20000000-0000-4000-8000-000000000001";
const REFERENCE_PERMISSION = "30000000-0000-4000-8000-000000000001";

type RenderRecord = {
  scenario: string;
  artifact: "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET";
  expectedPages: 1 | 2;
  actualPages: 1 | 2;
  docxSha256: string;
  packageQaSha256: string;
  extractedTextSha256: string;
  searchablePdfSha256: string;
  pageImageSha256: string[];
  rendererIdentity: string;
  arialFontSha256: string;
  arialResolved: true;
};

function hash(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function coverParagraph(opening: string, factId: string) {
  const words = "coordinated accurate customer records across changing priorities while communicating clearly with colleagues and resolving practical workflow problems through careful follow through".split(" ");
  const text = [opening, ...Array.from({ length: 52 }, (_, index) => words[index % words.length])].join(" ") + ".";
  return { text, candidateFactIds: [factId], jobEvidenceIds: [JOB_EVIDENCE] };
}

function baseFixture(): EvidenceBoundMaterialInput {
  return {
    contact: {
      displayName: "Synthetic Candidate",
      email: "candidate@example.invalid",
      phone: "555-010-2026",
      cityState: "Richmond, VA",
      linkedInOrPortfolio: "https://example.invalid/candidate",
      candidateFactIds: [FACT_CONTACT],
    },
    job: {
      exactTitle: "Operations Coordinator",
      employer: "Example Services",
      location: "Richmond, VA",
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    professionalSummary: {
      text: "Operations professional who coordinates accurate records and clear customer communication.",
      candidateFactIds: [FACT_ONE],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    coreSkills: [
      { text: "Document coordination", candidateFactIds: [FACT_ONE], priority: 1, essential: true },
      { text: "Customer communication", candidateFactIds: [FACT_TWO], priority: 2 },
    ],
    experiences: [{
      historicalTitle: "Administrative Specialist",
      employer: "Community Example",
      dates: "2021 to 2026",
      location: "Richmond, VA",
      headerCandidateFactIds: [FACT_HEADER],
      bullets: [
        { text: "Coordinated customer records and reviewed documents for accuracy.", candidateFactIds: [FACT_ONE], priority: 1, essential: true },
        { text: "Communicated status updates and resolved routine workflow questions.", candidateFactIds: [FACT_TWO], priority: 2 },
      ],
    }],
    coverLetterParagraphs: [
      coverParagraph("The Operations Coordinator role calls for dependable records and practical customer support", FACT_ONE),
      coverParagraph("My recent work required careful coordination when priorities shifted", FACT_TWO),
      coverParagraph("Colleagues relied on my clear updates and consistent review habits", FACT_ONE),
      coverParagraph("I would welcome the opportunity to bring that verified approach to this work", FACT_TWO),
    ],
    verifiedHiringManager: null,
    finalVersionAt: "2026-09-07T14:00:00.000Z",
    careerBreak: { choice: "KEEP_EXISTING_TIMELINE", mentionInCoverLetter: false, candidateFactIds: [] },
    rules: { outputFormat: "DOCX", resumePageLimit: 1 },
    references: [{
      permissionId: REFERENCE_PERMISSION,
      name: "Synthetic Reference",
      titleAndOrganization: "Program Lead, Example Organization",
      relationship: "Former project lead",
      email: "reference@example.invalid",
      phone: "555-010-3030",
      approvedContext: "Observed document coordination and customer communication.",
    }],
  };
}

function careerChangeFixture() {
  const input = baseFixture();
  input.contact.displayName = "Synthetic Career Changer";
  input.job.exactTitle = "Customer Support Coordinator";
  input.job.employer = "Example Health Services";
  input.professionalSummary.text = "Customer support professional who transfers verified coordination and communication experience into service operations.";
  input.careerBreak = {
    choice: "CAREER_BREAK",
    start: "2019",
    end: "2020",
    mentionInCoverLetter: false,
    candidateFactIds: [FACT_BREAK],
  };
  input.references = undefined;
  return input;
}

function seniorTwoPageFixture() {
  const input = baseFixture();
  input.contact.displayName = "Synthetic Senior Candidate";
  input.job.exactTitle = "Senior Program Coordinator";
  input.job.employer = "Example Civic Programs";
  input.rules.resumePageLimit = 2;
  input.humanApprovedTwoPageException = true;
  input.references = undefined;
  input.experiences = Array.from({ length: 7 }, (_, experienceIndex) => ({
    historicalTitle: `Verified Role ${experienceIndex + 1}`,
    employer: `Verified Employer ${experienceIndex + 1}`,
    dates: `${2012 + experienceIndex} to ${2013 + experienceIndex}`,
    headerCandidateFactIds: [FACT_HEADER],
    bullets: Array.from({ length: experienceIndex === 6 ? 3 : 7 }, (_, bulletIndex) => ({
      text: `Coordinated verified program responsibility ${experienceIndex + 1}.${bulletIndex + 1} with accurate records and clear updates.`,
      candidateFactIds: [bulletIndex % 2 ? FACT_ONE : FACT_TWO],
      essential: true,
      priority: 1,
    })),
  }));
  return input;
}

function outputDirectory() {
  const configured = process.env.APPLYPACK_RENDER_EVIDENCE_DIR?.trim() || "";
  if (!configured || !isAbsolute(configured)) throw new Error("render_evidence_absolute_directory_required");
  const resolved = resolve(configured);
  if (!basename(resolved).startsWith("applypack-chunk5-render-")) {
    throw new Error("render_evidence_directory_name_invalid");
  }
  return resolved;
}

async function renderArtifact(
  directory: string,
  scenario: string,
  artifactType: RenderRecord["artifact"],
  artifact: GeneratedArtifact,
): Promise<RenderRecord> {
  const inspection = await inspectDocxPackage(artifact.buffer, artifactType);
  expect(inspection.passed).toBe(true);
  const stem = `${scenario}-${artifactType.toLowerCase().replace("_", "-")}`;
  await Promise.all([
    writeFile(resolve(directory, `${stem}.docx`), artifact.buffer, { flag: "wx" }),
    writeFile(resolve(directory, `${stem}-expected.txt`), inspection.extractedText + "\n", { flag: "wx" }),
  ]);
  const rendered = await renderDocumentLocallyForQa({
    docx: artifact.buffer,
    expectedPages: artifact.expectedPageCount,
    expectedExtractedTextSha256: inspection.extractedTextSha256,
  });
  await Promise.all([
    writeFile(resolve(directory, `${stem}.pdf`), rendered.searchablePdf, { flag: "wx" }),
    ...rendered.pageImages.map((page, index) =>
      writeFile(resolve(directory, `${stem}-page-${index + 1}.png`), page.bytes, { flag: "wx" })),
  ]);
  return {
    scenario,
    artifact: artifactType,
    expectedPages: artifact.expectedPageCount,
    actualPages: rendered.pageCount,
    docxSha256: hash(artifact.buffer),
    packageQaSha256: inspection.packageQaSha256,
    extractedTextSha256: inspection.extractedTextSha256,
    searchablePdfSha256: rendered.searchablePdfSha256,
    pageImageSha256: rendered.pageImages.map((page) => page.sha256),
    rendererIdentity: rendered.rendererIdentity,
    arialFontSha256: rendered.arialFontSha256,
    arialResolved: rendered.arialResolved,
  };
}

describe("Chunk 5 real document rendering", () => {
  it("renders representative one- and two-page DOCX artifacts with exact text and Arial", async () => {
    const configuration = documentRendererConfiguration();
    expect(configuration.ready).toBe(true);
    const directory = outputDirectory();
    await mkdir(directory, { recursive: false });
    const scenarios = [
      { id: "returning-operations", input: baseFixture() },
      { id: "career-change-support", input: careerChangeFixture() },
      { id: "senior-program", input: seniorTwoPageFixture() },
    ];
    const records: RenderRecord[] = [];
    for (const scenario of scenarios) {
      const generated = await generateEvidenceBoundMaterials(scenario.input);
      records.push(await renderArtifact(directory, scenario.id, "RESUME", generated.resume));
      records.push(await renderArtifact(directory, scenario.id, "COVER_LETTER", generated.coverLetter));
      if (generated.referenceSheet) {
        records.push(await renderArtifact(directory, scenario.id, "REFERENCE_SHEET", generated.referenceSheet));
      }
    }
    expect(records).toHaveLength(7);
    expect(records.reduce((total, record) => total + record.actualPages, 0)).toBe(8);
    expect(records.every((record) => record.expectedPages === record.actualPages && record.arialResolved)).toBe(true);
    const report = {
      schemaVersion: "applypack-chunk5-render-evidence-v1",
      createdAt: new Date().toISOString(),
      scenarioCount: scenarios.length,
      artifactCount: records.length,
      pageCount: records.reduce((total, record) => total + record.actualPages, 0),
      rendererIdentity: configuration.identity,
      toolSha256: {
        office: configuration.tools.office.sha256,
        pdfInfo: configuration.tools.pdfInfo.sha256,
        pdfFonts: configuration.tools.pdfFonts.sha256,
        pdfText: configuration.tools.pdfText.sha256,
        pdfPpm: configuration.tools.pdfPpm.sha256,
        arial: configuration.arialFont.sha256,
      },
      records,
    };
    await writeFile(resolve(directory, "render-report.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  }, 180_000);
});

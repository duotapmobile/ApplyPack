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
const FACT_EDUCATION = "10000000-0000-4000-8000-000000000006";
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

type PackageRecord = {
  scenario: string;
  artifact: "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET";
  expectedPages: 1 | 2;
  filename: string;
  docxSha256: string;
  packageQaSha256: string;
  extractedTextSha256: string;
};

function hash(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function realisticCoverLetter(jobTitle: string, employer: string) {
  return [
    {
      text: `The ${jobTitle} role at ${employer} calls for careful records, responsive communication, and dependable follow-through. In my administrative work, I coordinated customer files, reviewed documents for accuracy, and kept colleagues informed when priorities changed. That combination of practical organization and clear service is the verified experience I would bring to this opportunity. I am especially prepared for work where details must remain understandable as an item moves between customers and coworkers.`,
      candidateFactIds: [FACT_ONE],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    {
      text: "One recurring responsibility involved checking incoming information before it moved to the next person. I compared details, corrected routine discrepancies, and documented the current status so others could act with confidence. When a question required additional review, I explained what was known, identified what was still needed, and followed the item through resolution. This approach reduced ambiguity at handoff points and gave the next person a practical record of the action already completed.",
      candidateFactIds: [FACT_TWO],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    {
      text: "I also supported customers and coworkers during schedule changes and competing requests. I organized the work by urgency, maintained accurate notes, and provided concise updates rather than allowing requests to disappear between handoffs. Those habits helped me contribute steady support while respecting established procedures and the limits of my role. I learned to ask focused questions, confirm the requested outcome, and close the loop when the work was finished.",
      candidateFactIds: [FACT_ONE, FACT_TWO],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    {
      text: `I would welcome the opportunity to discuss how this documented background could support the ${jobTitle} team at ${employer}. I value work that depends on accuracy, respectful communication, and consistent completion. Thank you for considering the experience described here and for the opportunity to explain how I approach service and coordination.`,
      candidateFactIds: [FACT_TWO],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
  ];
}

function baseFixture(): EvidenceBoundMaterialInput {
  const input: EvidenceBoundMaterialInput = {
    contact: {
      displayName: "Jordan Bennett",
      email: "jordan.bennett@example.invalid",
      phone: "555-010-2026",
      cityState: "Richmond, VA",
      linkedInOrPortfolio: "https://jordan-bennett.example.invalid",
      candidateFactIds: [FACT_CONTACT],
    },
    job: {
      exactTitle: "Operations Coordinator",
      employer: "Lakeview Service Partners",
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
      employer: "Riverton Member Services",
      dates: "March 2021 to August 2026",
      location: "Richmond, VA",
      headerCandidateFactIds: [FACT_HEADER],
      bullets: [
        { text: "Coordinated customer records and reviewed documents for accuracy.", candidateFactIds: [FACT_ONE], priority: 1, essential: true },
        { text: "Communicated status updates and resolved routine workflow questions.", candidateFactIds: [FACT_TWO], priority: 2 },
      ],
    }],
    coverLetterParagraphs: [],
    verifiedHiringManager: null,
    finalVersionAt: "2026-09-07T14:00:00.000Z",
    careerBreak: { choice: "KEEP_EXISTING_TIMELINE", mentionInCoverLetter: false, candidateFactIds: [] },
    rules: { outputFormat: "DOCX", resumePageLimit: 1 },
    references: [{
      permissionId: REFERENCE_PERMISSION,
      name: "Taylor Brooks",
      titleAndOrganization: "Program Director, Riverton Member Services",
      relationship: "Former project lead",
      email: "taylor.brooks@example.invalid",
      phone: "555-010-3030",
      approvedContext: "Observed document coordination and customer communication.",
    }],
  };
  input.coverLetterParagraphs = realisticCoverLetter(input.job.exactTitle, input.job.employer);
  return input;
}

function careerChangeFixture() {
  const input = baseFixture();
  input.contact.displayName = "María Alvarez";
  input.contact.email = "maria.alvarez@example.invalid";
  input.contact.linkedInOrPortfolio = "https://maria-alvarez.example.invalid";
  input.job.exactTitle = "Customer Support Coordinator";
  input.job.employer = "Harborstone Health Services";
  input.professionalSummary.text = "Customer support professional who transfers verified coordination and communication experience into service operations.";
  input.careerBreak = {
    choice: "CAREER_BREAK",
    start: "2019",
    end: "2020",
    mentionInCoverLetter: false,
    candidateFactIds: [FACT_BREAK],
  };
  input.references = undefined;
  input.coverLetterParagraphs = realisticCoverLetter(input.job.exactTitle, input.job.employer);
  return input;
}

function seniorTwoPageFixture() {
  const input = baseFixture();
  input.contact.displayName = "Darius Morgan";
  input.contact.email = "darius.morgan@example.invalid";
  input.contact.linkedInOrPortfolio = "https://darius-morgan.example.invalid";
  input.job.exactTitle = "Senior Program Coordinator";
  input.job.employer = "Fairmont Civic Programs";
  input.rules.resumePageLimit = 2;
  input.humanApprovedTwoPageException = true;
  input.references = undefined;
  const roles = [
    ["Program Assistant", "Marlowe Community Center", "January 2012 to December 2013", "registration", "community workshops", "participants", "attendance", "event"],
    ["Service Coordinator", "Alder Grove Support Network", "February 2014 to August 2015", "referral", "service appointments", "clients", "referral", "intake"],
    ["Operations Specialist", "Cedar Lane Family Services", "September 2015 to June 2017", "vendor", "office operations", "vendors", "purchasing", "vendor"],
    ["Project Coordinator", "Blue Willow Learning Collaborative", "July 2017 to November 2019", "project", "training sessions", "facilitators", "milestone", "project"],
    ["Program Operations Manager", "Summit Bridge Resource Center", "December 2019 to May 2022", "grant", "funded programs", "partners", "grant", "reporting"],
    ["Portfolio Coordinator", "Riverbend Civic Alliance", "June 2022 to January 2024", "portfolio", "cross-team initiatives", "stakeholders", "portfolio", "handoff"],
    ["Senior Program Coordinator", "Northstar Civic Initiatives", "February 2024 to Present", "program", "regional initiatives", "community partners", "performance", "review"],
  ] as const;
  input.experiences = roles.map(([historicalTitle, employer, dates, focus, programArea, audience, reportType, process]) => ({
    historicalTitle,
    employer,
    dates,
    headerCandidateFactIds: [FACT_HEADER],
    bullets: [
      `Reviewed ${focus} records for completeness and corrected routine inconsistencies before reporting.`,
      `Coordinated schedules and materials for ${programArea}, documenting each change for the responsible colleague.`,
      `Answered questions from ${audience}, confirmed next steps, and followed unresolved requests through closure.`,
      `Prepared ${reportType} summaries that helped supervisors compare open items with completed work.`,
      `Improved ${process} transitions by organizing shared files and using consistent status notes.`,
    ].map((text, bulletIndex) => ({
      text,
      candidateFactIds: [bulletIndex % 2 ? FACT_ONE : FACT_TWO],
      essential: true,
      priority: 1,
    })),
  }));
  input.educationAndCertifications = [{
    degree: "Bachelor of Arts in Public Administration",
    detail: "Commonwealth College, 2011",
    candidateFactIds: [FACT_EDUCATION],
  }];
  input.coverLetterParagraphs = realisticCoverLetter(input.job.exactTitle, input.job.employer);
  return input;
}

function evidenceScenarios() {
  return [
    { id: "returning-operations", input: baseFixture() },
    { id: "career-change-support", input: careerChangeFixture() },
    { id: "senior-program", input: seniorTwoPageFixture() },
  ];
}

function packageOutputDirectory() {
  const configured = process.env.APPLYPACK_PACKAGE_EVIDENCE_DIR?.trim() || "";
  if (!configured || !isAbsolute(configured)) throw new Error("package_evidence_absolute_directory_required");
  const resolved = resolve(configured);
  if (!basename(resolved).startsWith("applypack-chunk5-package-")) {
    throw new Error("package_evidence_directory_name_invalid");
  }
  return resolved;
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
  const packageEvidence = process.env.APPLYPACK_PACKAGE_EVIDENCE_DIR ? it : it.skip;

  packageEvidence("writes structurally verified DOCX review artifacts without claiming rendered proof", async () => {
    const directory = packageOutputDirectory();
    await mkdir(directory, { recursive: false });
    const records: PackageRecord[] = [];
    for (const scenario of evidenceScenarios()) {
      const generated = await generateEvidenceBoundMaterials(scenario.input);
      const artifacts = [
        { type: "RESUME" as const, artifact: generated.resume },
        { type: "COVER_LETTER" as const, artifact: generated.coverLetter },
        ...(generated.referenceSheet ? [{ type: "REFERENCE_SHEET" as const, artifact: generated.referenceSheet }] : []),
      ];
      for (const { type, artifact } of artifacts) {
        const inspection = await inspectDocxPackage(artifact.buffer, type);
        expect(inspection.passed).toBe(true);
        const stem = `${scenario.id}-${type.toLowerCase().replace("_", "-")}`;
        await Promise.all([
          writeFile(resolve(directory, `${stem}.docx`), artifact.buffer, { flag: "wx" }),
          writeFile(resolve(directory, `${stem}-expected.txt`), inspection.extractedText + "\n", { flag: "wx" }),
        ]);
        records.push({
          scenario: scenario.id,
          artifact: type,
          expectedPages: artifact.expectedPageCount,
          filename: artifact.filename,
          docxSha256: hash(artifact.buffer),
          packageQaSha256: inspection.packageQaSha256,
          extractedTextSha256: inspection.extractedTextSha256,
        });
      }
    }
    await writeFile(resolve(directory, "package-report.json"), JSON.stringify({
      schemaVersion: "applypack-chunk5-package-evidence-v2",
      createdAt: new Date().toISOString(),
      records,
    }, null, 2) + "\n", { flag: "wx" });
    expect(records).toHaveLength(7);
  });

  it("renders representative one- and two-page DOCX artifacts with exact text and Arial", async () => {
    const configuration = documentRendererConfiguration();
    expect(configuration.ready).toBe(true);
    const directory = outputDirectory();
    await mkdir(directory, { recursive: false });
    const scenarios = evidenceScenarios();
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
  }, 360_000);
});

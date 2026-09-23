import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  generateEvidenceBoundMaterials,
  inspectDocxPackage,
  type EvidenceBoundMaterialInput,
} from "@/lib/documents/generate";
import { documentFixture } from "../fixtures/document";

const CAREER_BREAK_FACT = "10000000-0000-4000-8000-000000000005";

function retarget(input: EvidenceBoundMaterialInput, title: string, employer: string) {
  const oldTitle = input.job.exactTitle;
  const oldEmployer = input.job.employer;
  input.job.exactTitle = title;
  input.job.employer = employer;
  input.coverLetterParagraphs = input.coverLetterParagraphs.map((paragraph) => ({
    ...paragraph,
    text: paragraph.text.replaceAll(oldTitle, title).replaceAll(oldEmployer, employer),
  }));
  return input;
}

function paragraphRecords(xml: string) {
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => ({
    xml: match[0],
    text: [...match[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((text) => text[1]).join("").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(),
  }));
}

async function resumeXml(input: EvidenceBoundMaterialInput) {
  const generated = await generateEvidenceBoundMaterials(input);
  const zip = await JSZip.loadAsync(generated.resume.buffer);
  return {
    generated,
    zip,
    xml: await zip.file("word/document.xml")!.async("string"),
    styles: await zip.file("word/styles.xml")!.async("string"),
    numbering: await zip.file("word/numbering.xml")!.async("string"),
  };
}

function fixtures() {
  const generic = documentFixture();

  const marissa = retarget(documentFixture(), "Operations Associate", "Sentinel Group");
  marissa.contact.displayName = "MARISSA WRIGHT";
  marissa.experiences[0] = {
    ...marissa.experiences[0],
    historicalTitle: "Amazon Marketplace & Operations Specialist",
    employer: "PRIVATE-LABEL AMAZON E-COMMERCE",
    dates: "2019–Present",
  };

  const longName = documentFixture();
  longName.contact.displayName = "Alexandra Elizabeth Montgomery-Washington";

  const accentedName = documentFixture();
  accentedName.contact.displayName = "José Núñez Álvarez";

  const longEmployer = documentFixture();
  longEmployer.experiences[0].employer = "Metropolitan Community Operations and Customer Support Cooperative";

  const wrappedSkills = documentFixture();
  wrappedSkills.coreSkills.push({
    text: "Cross-functional document review and customer handoff coordination",
    candidateFactIds: wrappedSkills.coreSkills[0].candidateFactIds,
    priority: 2,
  });

  const wrappedBullet = documentFixture();
  wrappedBullet.experiences[0].bullets[0].text = "Coordinated detailed customer records across multiple handoff points, reviewed each document for accuracy, and communicated the verified current status to the responsible colleague before the next step.";

  const careerBreak = documentFixture();
  careerBreak.careerBreak = {
    choice: "CAREER_BREAK",
    start: "2019",
    end: "2020",
    mentionInCoverLetter: false,
    candidateFactIds: [CAREER_BREAK_FACT],
  };
  careerBreak.educationAndCertifications = [{
    degree: "Certificate in Office Administration",
    detail: "Example College, 2018",
    candidateFactIds: [CAREER_BREAK_FACT],
  }];

  return { generic, marissa, longName, accentedName, longEmployer, wrappedSkills, wrappedBullet, careerBreak };
}

describe("validated ATS-safe document architecture", () => {
  it.each(Object.entries(fixtures()))("keeps %s recoverable, semantic, single-column, and correctly bound", async (_name, input) => {
    const { generated, xml, styles, numbering } = await resumeXml(input);
    const inspection = await inspectDocxPackage(generated.resume.buffer, "RESUME", generated.resume.metadata);
    expect(inspection.passed, Object.entries(inspection.checks).filter(([, passed]) => !passed).map(([key]) => key).join(", ")).toBe(true);
    expect(inspection.extractedText).toContain(input.contact.displayName === "MARISSA WRIGHT" ? "Marissa Wright" : input.contact.displayName);
    expect(inspection.extractedText).toContain(input.contact.phone);
    expect(inspection.extractedText).toContain(input.contact.email);
    expect(inspection.extractedText).toContain(input.contact.cityState);
    expect(inspection.semanticHeadings).toEqual(expect.arrayContaining(["PROFESSIONAL SUMMARY", "CORE SKILLS", "WORK EXPERIENCE"]));
    expect(inspection.listParagraphCount).toBeGreaterThanOrEqual(1);
    expect(inspection.extractedText).not.toMatch(/[–—]/u);
    expect(xml).not.toMatch(/<w:(?:tbl|txbxContent|drawing|pict)\b/i);
    expect(styles).toMatch(/<w:style[^>]*w:styleId="Heading1"[\s\S]*?<w:rFonts[^>]*w:ascii="Arial"/i);
    expect(numbering).toMatch(/<w:numFmt[^>]*w:val="bullet"/i);

    for (const experience of input.experiences) {
      const records = paragraphRecords(xml);
      const titleIndex = records.findIndex((paragraph) => paragraph.text === experience.historicalTitle);
      expect(titleIndex).toBeGreaterThan(-1);
      expect(records[titleIndex + 1].text).toContain(experience.employer);
      expect(records[titleIndex + 1].text).toMatch(/\|\s*(?:[A-Za-z]+\s+)?\d{4}-/);
      expect(records.slice(titleIndex + 2).some((paragraph) => /<w:numPr\b/i.test(paragraph.xml))).toBe(true);
    }

    expect(generated.resume.metadata).toEqual({
      title: `${input.contact.displayName === "MARISSA WRIGHT" ? "Marissa Wright" : input.contact.displayName} Resume - ${input.job.employer}`,
      author: input.contact.displayName === "MARISSA WRIGHT" ? "Marissa Wright" : input.contact.displayName,
      subject: `Application for ${input.job.exactTitle} at ${input.job.employer}`,
      language: "en-US",
      keywords: "",
    });
  });

  it("keeps Marissa's approved historical title and natural presentation", async () => {
    const { marissa } = fixtures();
    const { generated } = await resumeXml(marissa);
    const inspection = await inspectDocxPackage(generated.resume.buffer, "RESUME", generated.resume.metadata);
    expect(inspection.extractedText).toContain("Marissa Wright");
    expect(inspection.extractedText).toContain("Amazon Marketplace & Operations Specialist");
    expect(inspection.extractedText).toContain("PRIVATE-LABEL AMAZON E-COMMERCE | 2019-Present");
    expect(inspection.extractedText).toContain("Operations professional who coordinates accurate records and clear customer communication, targeting an Operations Associate role.");
    expect(inspection.extractedText).not.toMatch(/\b(?:Founder|CEO|Owner)\b/);
  });

  it("keeps target-role summaries natural for common third-person verbs", async () => {
    const input = retarget(documentFixture(), "Customer Support Coordinator", "Harborstone Health Services");
    input.professionalSummary.text = "Customer support professional who transfers verified coordination experience into service operations.";
    const { generated } = await resumeXml(input);
    const inspection = await inspectDocxPackage(generated.resume.buffer, "RESUME", generated.resume.metadata);
    expect(inspection.extractedText).toContain("Customer support professional who transfers verified coordination experience into service operations, targeting a Customer Support Coordinator role.");
  });

  it.each([
    "Customer service professional skilled in complex case coordination.",
    "Customer service professional known for careful handoffs.",
    "Customer service professional led a verified service transition.",
    "10 years of verified customer service experience.",
  ])("preserves reviewed summary prose without invented inflection: %s", async (summary) => {
    const input = retarget(documentFixture(), "Customer Support Coordinator", "Harborstone Health Services");
    input.professionalSummary.text = summary;
    const { generated } = await resumeXml(input);
    const inspection = await inspectDocxPackage(generated.resume.buffer, "RESUME", generated.resume.metadata);
    expect(inspection.extractedText).toContain(summary.slice(0, -1));
    expect(inspection.extractedText).toContain("Customer Support Coordinator role");
    expect(inspection.extractedText).not.toMatch(/skilleding|knowning|leding|experience in 10 years/i);
  });

  it("fails structural QA for typed bullets, detached dates, and framework metadata", async () => {
    const input = documentFixture();
    const { generated, zip, xml } = await resumeXml(input);
    const firstList = /<w:p\b[\s\S]*?<w:numPr\b[\s\S]*?<\/w:p>/i.exec(xml)?.[0];
    expect(firstList).toBeTruthy();
    const typed = firstList!.replace(/<w:numPr\b[\s\S]*?<\/w:numPr>/i, "")
      .replace(/(<w:t(?:\s[^>]*)?>)/i, "$1• ");
    zip.file("word/document.xml", xml.replace(firstList!, typed));
    const typedInspection = await inspectDocxPackage(await zip.generateAsync({ type: "nodebuffer" }), "RESUME", generated.resume.metadata);
    expect(typedInspection.checks.nativeBullets).toBe(false);

    const detachedZip = await JSZip.loadAsync(generated.resume.buffer);
    const detachedXml = xml.replace("Community Example | 2021-2026 | Richmond, VA", "2021-2026 | Richmond, VA");
    detachedZip.file("word/document.xml", detachedXml);
    const detachedInspection = await inspectDocxPackage(await detachedZip.generateAsync({ type: "nodebuffer" }), "RESUME", generated.resume.metadata);
    expect(detachedInspection.checks.stackedJobGrouping).toBe(false);

    const metadataZip = await JSZip.loadAsync(generated.resume.buffer);
    const core = await metadataZip.file("docProps/core.xml")!.async("string");
    metadataZip.file("docProps/core.xml", core.replace(/<dc:creator>[\s\S]*?<\/dc:creator>/i, "<dc:creator>python-docx</dc:creator>"));
    const metadataInspection = await inspectDocxPackage(await metadataZip.generateAsync({ type: "nodebuffer" }), "RESUME", generated.resume.metadata);
    expect(metadataInspection.checks.metadataMatchesExpected).toBe(false);
    expect(metadataInspection.checks.noFrameworkAuthor).toBe(false);
  });

  it("isolates concurrent candidates and same-company different-role applications", async () => {
    const first = retarget(documentFixture(), "Operations Coordinator", "Shared Example Company");
    first.contact.displayName = "Candidate Alpha";
    first.contact.email = "alpha@example.invalid";
    const second = retarget(documentFixture(), "Customer Support Specialist", "Shared Example Company");
    second.contact.displayName = "Candidate Beta";
    second.contact.email = "beta@example.invalid";
    const [alpha, beta] = await Promise.all([
      generateEvidenceBoundMaterials(first),
      generateEvidenceBoundMaterials(second),
    ]);
    const [alphaResume, betaResume, alphaLetter, betaLetter] = await Promise.all([
      inspectDocxPackage(alpha.resume.buffer, "RESUME", alpha.resume.metadata),
      inspectDocxPackage(beta.resume.buffer, "RESUME", beta.resume.metadata),
      inspectDocxPackage(alpha.coverLetter.buffer, "COVER_LETTER", alpha.coverLetter.metadata),
      inspectDocxPackage(beta.coverLetter.buffer, "COVER_LETTER", beta.coverLetter.metadata),
    ]);
    expect(alphaResume.extractedText + alphaLetter.extractedText).toContain("Operations Coordinator");
    expect(alphaResume.extractedText + alphaLetter.extractedText).not.toMatch(/Candidate Beta|beta@example\.invalid|Customer Support Specialist/);
    expect(betaResume.extractedText + betaLetter.extractedText).toContain("Customer Support Specialist");
    expect(betaResume.extractedText + betaLetter.extractedText).not.toMatch(/Candidate Alpha|alpha@example\.invalid|Operations Coordinator/);
    expect(alpha.resume.filename).toBe("Candidate_Alpha_Resume_Shared_Example_Company.docx");
    expect(beta.resume.filename).toBe("Candidate_Beta_Resume_Shared_Example_Company.docx");
    expect(alpha.resume.metadata.subject).not.toBe(beta.resume.metadata.subject);
  });
});

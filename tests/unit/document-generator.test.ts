import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { generateApplyPackDrafts } from "@/lib/documents/generate";
import { DOCUMENT_GENERATOR_VERSION } from "@/lib/documents/requirements";

describe("first-party document drafting", () => {
  it("creates two valid DOCX packages from only supplied facts", async () => {
    const drafts = await generateApplyPackDrafts({
      fullName: "Test Customer",
      email: "test@example.com",
      location: "Richmond, VA",
      jobTitle: "Support Coordinator",
      employer: "Example Employer",
      direction: "Customer operations",
      backgroundDetails: "Processed customer documents and maintained accurate records.",
      backgroundTypes: ["Administrative support"],
      tools: "Microsoft Excel",
      credentials: "Customer-provided training",
      emphasisNotes: "Emphasize document accuracy.",
    });
    expect(drafts.resume.subarray(0, 2).toString()).toBe("PK");
    expect(drafts.coverLetter.subarray(0, 2).toString()).toBe("PK");
    expect(drafts.generatorVersion).toBe(DOCUMENT_GENERATOR_VERSION);
  });

  it("normalizes an all-caps parsed name and leaves the closing name unbolded", async () => {
    const drafts = await generateApplyPackDrafts({
      fullName: "MARISSA WRIGHT",
      email: "test@example.com",
      location: "Richmond, VA",
      jobTitle: "Support Coordinator",
      employer: "Example Employer",
      direction: "Customer operations",
      backgroundDetails: "Processed customer documents and maintained accurate records.",
      backgroundTypes: ["Administrative support"],
      tools: "Microsoft Excel",
      credentials: "Customer-provided training",
      emphasisNotes: "Emphasize document accuracy.",
    });
    const zip = await JSZip.loadAsync(drafts.coverLetter);
    const xml = await zip.file("word/document.xml")!.async("string");
    const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => match[0]);
    const nameParagraphs = paragraphs.filter((paragraphXml) => paragraphXml.includes("Marissa Wright"));

    expect(xml).not.toContain("MARISSA WRIGHT");
    expect(nameParagraphs).toHaveLength(2);
    expect(nameParagraphs[0]).not.toMatch(/<w:b\b/);
    expect(nameParagraphs[1]).not.toMatch(/<w:b\b/);
  });
});

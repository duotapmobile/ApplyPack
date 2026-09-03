import { describe, expect, it } from "vitest";
import { generateApplyPackDrafts } from "@/lib/documents/generate";
import { scanBuffer } from "@/lib/files/scanner";
import { validateDocumentBytes } from "@/lib/files/document-safety";
import { docxMimeType } from "@/lib/files/signatures";

const integration = process.env.SCANNER_INTEGRATION === "true" ? describe : describe.skip;

integration("generated DOCX security scanning", () => {
  it("creates two editable packages that pass the real private scanner", async () => {
    const drafts = await generateApplyPackDrafts({
      fullName: "Synthetic Customer",
      email: "synthetic@example.invalid",
      location: "Virginia",
      jobTitle: "Support Coordinator",
      employer: "Synthetic Employer",
      direction: "Customer operations",
      backgroundDetails: "Maintained customer records and processed documents.",
      backgroundTypes: ["Administrative support"],
      tools: "Spreadsheet software",
      credentials: "",
      emphasisNotes: "",
    });
    const resumeSafety = validateDocumentBytes(drafts.resume, docxMimeType);
    const coverSafety = validateDocumentBytes(drafts.coverLetter, docxMimeType);
    expect(resumeSafety).toEqual({ safe: true });
    expect(coverSafety).toEqual({ safe: true });
    await expect(scanBuffer(drafts.resume, { structureValidated: resumeSafety.safe })).resolves.toMatchObject({ status: "clean" });
    await expect(scanBuffer(drafts.coverLetter, { structureValidated: coverSafety.safe })).resolves.toMatchObject({ status: "clean" });
  });
});

import { describe, expect, it } from "vitest";
import { generateApplyPackDrafts } from "@/lib/documents/generate";

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
    expect(drafts.generatorVersion).toBe("first-party-structured-v1");
  });
});

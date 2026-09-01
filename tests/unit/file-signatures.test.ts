import { describe, expect, it } from "vitest";
import { extensionMatchesMimeType, hasExpectedFileSignature } from "@/lib/files/signatures";

describe("file signature validation", () => {
  it("accepts a PDF whose extension, MIME type, and bytes agree", async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "resume.pdf", { type: "application/pdf" });
    expect(extensionMatchesMimeType(file.name, file.type)).toBe(true);
    await expect(hasExpectedFileSignature(file)).resolves.toBe(true);
  });

  it("rejects executable bytes renamed as a PDF", async () => {
    const file = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "resume.pdf", { type: "application/pdf" });
    await expect(hasExpectedFileSignature(file)).resolves.toBe(false);
  });

  it("rejects a MIME and extension mismatch", () => {
    expect(extensionMatchesMimeType("resume.exe", "application/pdf")).toBe(false);
  });

  it("accepts a DOCX ZIP signature", async () => {
    const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "resume.docx", { type });
    await expect(hasExpectedFileSignature(file)).resolves.toBe(true);
  });
});

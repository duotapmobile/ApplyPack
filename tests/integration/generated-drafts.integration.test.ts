import { documentFixture } from "../fixtures/document";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateEvidenceBoundMaterials } from "@/lib/documents/generate";
import { scanBuffer } from "@/lib/files/scanner";
import { validateDocumentBytes } from "@/lib/files/document-safety";
import { docxMimeType } from "@/lib/files/signatures";

describe("generated DOCX structural validation and quarantine", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("keeps structurally valid editable packages quarantined until malware scanning", async () => {
    vi.stubEnv("APP_FILE_SCAN_MODE", "document_validation");
    vi.stubEnv("APP_MALWARE_SCANNER_IDENTITY", "applypack-local-structural-test");
    const drafts = await generateEvidenceBoundMaterials(documentFixture());
    const resumeSafety = validateDocumentBytes(drafts.resume.buffer, docxMimeType);
    const coverSafety = validateDocumentBytes(drafts.coverLetter.buffer, docxMimeType);
    expect(resumeSafety).toEqual({ safe: true });
    expect(coverSafety).toEqual({ safe: true });
    await expect(scanBuffer(drafts.resume.buffer, { structureValidated: resumeSafety.safe })).resolves.toMatchObject({ status: "pending", errorCode: "malware_scan_required" });
    await expect(scanBuffer(drafts.coverLetter.buffer, { structureValidated: coverSafety.safe })).resolves.toMatchObject({ status: "pending", errorCode: "malware_scan_required" });
  });
});

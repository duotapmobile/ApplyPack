import { describe, expect, it } from "vitest";
import { pdfFontTableUsesApprovedFont } from "@/lib/documents/font-validation";
describe("current PDF font policy", () => {
  it("accepts only Liberation Sans including subset and bold variants", () => {
    expect(pdfFontTableUsesApprovedFont("LiberationSans TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("ABCDEF+LiberationSans-Bold TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("name type encoding emb sub uni object ID\n---- ---- ---- --- --- --- ----\nABCDEF+LiberationSans TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("ArialMT TrueType WinAnsi yes yes yes")).toBe(false);
    expect(pdfFontTableUsesApprovedFont("LiberationSansish TrueType WinAnsi yes yes yes")).toBe(false);
    expect(pdfFontTableUsesApprovedFont("LiberationSans TrueType WinAnsi yes yes yes\nArialMT TrueType WinAnsi yes yes yes")).toBe(false);
  });
});

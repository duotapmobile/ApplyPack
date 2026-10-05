import { describe, expect, it } from "vitest";
import { pdfFontTableUsesApprovedFont } from "@/lib/documents/font-validation";
describe("current PDF font policy", () => {
  it("accepts only Arial including subset and PostScript bold variants", () => {
    expect(pdfFontTableUsesApprovedFont("ArialMT TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("ABCDEF+Arial-BoldMT TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("name type encoding emb sub uni object ID\n---- ---- ---- --- --- --- ----\nABCDEF+ArialMT TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("LiberationSans TrueType WinAnsi yes yes yes")).toBe(false);
    expect(pdfFontTableUsesApprovedFont("Arialish TrueType WinAnsi yes yes yes")).toBe(false);
    expect(pdfFontTableUsesApprovedFont("ArialMT TrueType WinAnsi yes yes yes\nLiberationSans TrueType WinAnsi yes yes yes")).toBe(false);
  });
});

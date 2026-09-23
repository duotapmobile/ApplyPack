import { describe, expect, it } from "vitest";
import { pdfFontNames, pdfFontRecords, pdfFontTableUsesApprovedFont } from "@/lib/documents/font-validation";
describe("current PDF font policy", () => {
  it("accepts requested Arial and the explicitly approved Liberation Sans substitute", () => {
    expect(pdfFontTableUsesApprovedFont("LiberationSans TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("ABCDEF+LiberationSans-Bold TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("name type encoding emb sub uni object ID\n---- ---- ---- --- --- --- ----\nABCDEF+LiberationSans TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("ArialMT TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesApprovedFont("ABCDEF+Arial-BoldMT TrueType WinAnsi yes yes yes", ["Arial"])).toBe(true);
    expect(pdfFontTableUsesApprovedFont("ArialMT TrueType WinAnsi yes yes yes", ["Liberation Sans"])).toBe(false);
    expect(pdfFontTableUsesApprovedFont("LiberationSansish TrueType WinAnsi yes yes yes")).toBe(false);
    expect(pdfFontTableUsesApprovedFont("LiberationSans TrueType WinAnsi yes yes yes\nArialMT TrueType WinAnsi yes yes yes", ["Arial"])).toBe(false);
    expect(pdfFontTableUsesApprovedFont("ArialMT TrueType WinAnsi no no yes", ["Arial"])).toBe(false);
    expect(pdfFontTableUsesApprovedFont("ArialMT TrueType WinAnsi yes yes no", ["Arial"])).toBe(false);
    expect(pdfFontTableUsesApprovedFont("ArialMT TrueType WinAnsi yes no yes", ["Arial"])).toBe(true);
    expect(pdfFontTableUsesApprovedFont("ArialMT TrueType WinAnsi yes yes yes\nmalformed-font-row", ["Arial"])).toBe(false);
    expect(pdfFontNames("name type encoding emb sub uni object ID\nABCDEF+ArialMT TrueType WinAnsi yes yes yes"))
      .toEqual(["ABCDEF+ArialMT"]);
    expect(pdfFontRecords("ABCDEF+ArialMT TrueType WinAnsi yes yes yes 12 0")).toEqual([{
      name: "ABCDEF+ArialMT", embedded: true, subset: true, unicodeMapped: true,
    }]);
  });
});

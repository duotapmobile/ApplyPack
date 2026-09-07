import { describe, expect, it } from "vitest";

import { pdfFontTableUsesArial } from "@/lib/documents/font-validation";

describe("PDF Arial validation", () => {
  it("accepts Arial names emitted with or without a PDF subset prefix", () => {
    expect(pdfFontTableUsesArial("ArialMT TrueType WinAnsi yes yes yes")).toBe(true);
    expect(pdfFontTableUsesArial("BAAAAA+Arial-BoldMT TrueType WinAnsi yes yes yes")).toBe(true);
  });

  it("rejects fallback and lookalike font names", () => {
    expect(pdfFontTableUsesArial("LiberationSans TrueType WinAnsi yes yes yes")).toBe(false);
    expect(pdfFontTableUsesArial("Arialish TrueType WinAnsi yes yes yes")).toBe(false);
    expect(pdfFontTableUsesArial("ABCDEF+LiberationSans TrueType WinAnsi yes yes yes")).toBe(false);
  });
});

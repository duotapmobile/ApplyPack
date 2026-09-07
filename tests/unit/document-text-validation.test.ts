import { describe, expect, it } from "vitest";

import { normalizeRenderedDocumentText } from "@/lib/documents/text-validation";

describe("rendered document text normalization", () => {
  it("ignores automatic bullet markers at the start of rendered lines", () => {
    expect(normalizeRenderedDocumentText("Heading\n \u2022 First item\n\u2022 Second item"))
      .toBe("Heading First item Second item");
  });

  it("preserves inline and content-owned bullets", () => {
    expect(normalizeRenderedDocumentText("Budget \u2022 finance\n \u2022 \u2022 literal bullet"))
      .toBe("Budget \u2022 finance \u2022 literal bullet");
  });
});

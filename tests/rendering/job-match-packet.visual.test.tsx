import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfcnJobMatchPacketRenderer } from "@/lib/documents/job-match-packet/renderer";
import { jobMatchPacketFixture } from "../fixtures/job-match-packet";

const cases = [
  ["short", jobMatchPacketFixture()],
  ["long-fields-and-warnings", jobMatchPacketFixture({ long: true })],
  ["maximum-content", jobMatchPacketFixture({ maximum: true })],
] as const;

describe("job-match packet visual fixtures", () => {
  it.each(cases)("renders and validates %s", async (name, content) => {
    const output = await new PdfcnJobMatchPacketRenderer().render(content);
    const pdf = await getDocument({ data: Uint8Array.from(output.bytes), useSystemFonts: false }).promise;
    expect(pdf.numPages).toBeGreaterThan(1);
    expect(pdf.numPages).toBeLessThanOrEqual(45);
    const pageTexts: string[] = [];
    const links: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = await page.getTextContent();
      pageTexts.push(text.items.map((item) => "str" in item ? item.str : "").join(" "));
      for (const annotation of await page.getAnnotations()) if (typeof annotation.url === "string") links.push(annotation.url);
    }
    const normalizedText = pageTexts.join(" ").replace(/\s+/gu, " ");
    content.jobs.forEach((job) => {
      expect(normalizedText).toContain(job.positionTitle);
      expect(normalizedText).toContain(job.employerName);
      expect(links).toContain(job.directApplicationUrl);
    });
    expect(normalizedText).toMatch(/Page 1 of \d+/u);
    expect(normalizedText).toMatch(new RegExp(`Page ${pdf.numPages} of ${pdf.numPages}`));
    const outputDirectory = process.env.APPLYPACK_PDFCN_VISUAL_DIR;
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(join(outputDirectory, `${name}.pdf`), output.bytes);
      await writeFile(join(outputDirectory, `${name}.json`), JSON.stringify({
        checksumSha256: output.checksumSha256,
        durationMs: output.metadata.durationMs,
        pageCount: pdf.numPages,
        sizeBytes: output.bytes.byteLength,
      }, null, 2));
    }
    await pdf.destroy();
  });
});

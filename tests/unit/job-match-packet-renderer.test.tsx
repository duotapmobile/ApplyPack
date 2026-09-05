// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PdfcnJobMatchPacketRenderer } from "@/lib/documents/job-match-packet/renderer";
import { jobMatchPacketFixture } from "../fixtures/job-match-packet";

async function inspect(bytes: Uint8Array) {
  const document = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false }).promise;
  const pages: string[] = [];
  const links: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    pages.push(text.items.map((item) => "str" in item ? item.str : "").join(" "));
    const annotations = await page.getAnnotations();
    for (const annotation of annotations) if (typeof annotation.url === "string") links.push(annotation.url);
  }
  const metadata = await document.getMetadata();
  await document.destroy();
  return { pageCount: pages.length, pages, text: pages.join("\n"), links, info: metadata.info as Record<string, unknown> };
}

describe("pdfcn/Takumi job-match packet renderer", () => {
  it("renders a tagged, searchable Letter PDF with all 10 jobs, links, page numbers, and metadata", async () => {
    const renderedAt = "2026-09-04T20:30:00.000Z";
    const content = jobMatchPacketFixture({ long: true });
    const output = await new PdfcnJobMatchPacketRenderer(undefined, () => new Date(renderedAt)).render(content);
    expect(Buffer.from(output.bytes.subarray(0, 8)).toString("latin1")).toMatch(/^%PDF-1\.[0-9]/u);
    const pdf = await inspect(output.bytes);
    const normalizedText = pdf.text.replace(/\s+/gu, " ");
    expect(pdf.pageCount).toBeGreaterThanOrEqual(3);
    expect(pdf.pageCount).toBeLessThanOrEqual(20);
    content.jobs.forEach((job) => {
      expect(normalizedText).toContain(job.positionTitle);
      expect(normalizedText).toContain(job.employerName);
      expect(pdf.links).toContain(job.directApplicationUrl);
    });
    expect(normalizedText).toContain("Health benefits: Not confirmed");
    expect(normalizedText).toContain("Travel requirements: Not stated");
    expect(normalizedText).toMatch(/Page 1 of \d+/u);
    expect(String(pdf.info.Title)).toContain("ApplyPack Job Matches");
    expect(String(pdf.info.Creator)).toContain("pdfcn-");
    expect(output.customerFilename).toBe("Synthetic_Customer_ApplyPack_Job_Matches.pdf");
    expect(output.metadata.renderedAt).toBe(renderedAt);
  }, 30_000);

  it("renders hostile markup and instruction-like content only as selectable text", async () => {
    const output = await new PdfcnJobMatchPacketRenderer().render(jobMatchPacketFixture({ malicious: true }));
    const pdf = await inspect(output.bytes);
    expect(pdf.text).toContain("<script>do-not-run()</script>");
    expect(pdf.text).toContain("<img src=x onerror=alert(1)>");
    expect(pdf.links.every((url) => url.startsWith("https://jobs.example.invalid/"))).toBe(true);
  }, 30_000);

  it("is byte-stable for identical versioned input", async () => {
    const renderer = new PdfcnJobMatchPacketRenderer();
    const first = await renderer.render(jobMatchPacketFixture());
    const second = await renderer.render(jobMatchPacketFixture());
    expect(second.contentIdentity).toBe(first.contentIdentity);
    expect(second.checksumSha256).toBe(first.checksumSha256);
    expect(Buffer.compare(Buffer.from(first.bytes), Buffer.from(second.bytes))).toBe(0);
  }, 30_000);
});

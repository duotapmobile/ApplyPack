import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareDraftRender } from "@/lib/documents/draft-render";
import { renderDocumentLocallyForQa } from "@/lib/documents/renderer";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";

describe("actual reviewed draft DOCX to searchable PDF", () => {
  it.each(["VOLUNTEER", "EDUCATION_CERTIFICATION"] as const)("renders exact %s source with paragraph/list/link evidence and approved fonts", async (kind) => {
    const directory = process.env.APPLYPACK_RENDER_EVIDENCE_DIR;
    if (!directory || !isAbsolute(directory)) throw new Error("absolute_render_evidence_directory_required");
    const fixture = draftDocumentFixture(kind, kind === "EDUCATION_CERTIFICATION" ? "IN_PROGRESS" : "Completed", false, "YEAR", "OMIT_ENTRY", "https://portfolio.example.test/casey");
    const result = await prepareDraftRender({ source: fixture.build(), packet: fixture.input.packet }, { now: () => draftFixtureNow, render: renderDocumentLocallyForQa });
    await mkdir(directory, { recursive: true });
    for (const [name, artifact] of Object.entries({ resume: result.resume, coverLetter: result.coverLetter })) {
      expect(artifact.render.draftPdf?.linkCount).toBe(2);
      expect(artifact.render.documentFontResolved).toBe(true);
      expect(artifact.render.pageCount).toBe(1);
      expect(artifact.deliveryAuthorized).toBe(false);
      if (kind === "EDUCATION_CERTIFICATION") expect(artifact.render.draftPdf?.listItemCount).toBe(0);
      const stem = `draft-${kind.toLowerCase()}-${name}`;
      await writeFile(join(directory, `${stem}.docx`), artifact.buffer);
      await writeFile(join(directory, `${stem}.pdf`), artifact.render.searchablePdf);
      await writeFile(join(directory, `${stem}-qa.json`), JSON.stringify(artifact.qa, null, 2));
      for (const [index, page] of artifact.render.pageImages.entries()) await writeFile(join(directory, `${stem}-page-${index + 1}.png`), page.bytes);
    }
  }, 180_000);
});

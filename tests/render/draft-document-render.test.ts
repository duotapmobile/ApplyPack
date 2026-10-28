import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareDraftRender } from "@/lib/documents/draft-render";
import { renderDocumentLocallyForQa } from "@/lib/documents/renderer";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";
import { draftReferenceFixture } from "../fixtures/draft-reference";
import { buildDraftOwnerEditModel, buildOwnerEditedDraftSource } from "@/lib/documents/draft-owner-edit";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";

describe("actual reviewed draft DOCX to searchable PDF", () => {
  it("renders owner-edited wording with new source evidence while preserving selected references", async () => {
    const directory = process.env.APPLYPACK_RENDER_EVIDENCE_DIR;
    if (!directory || !isAbsolute(directory)) throw new Error("absolute_render_evidence_directory_required");
    const fixture = draftReferenceFixture(3), prior = fixture.build(), packet = fixture.input.packet;
    const output = buildDraftOwnerEditModel(prior, packet, draftFixtureNow).output;
    output.coverLetter.body[0].sentences[0].text = "I organized schedules for community events.";
    const source = buildOwnerEditedDraftSource({ source: prior, packet, contact: fixture.input.contact, references: fixture.references,
      reviewerId: "79000000-0000-4000-8000-000000000004", request: { jobId: "79000000-0000-4000-8000-000000000001",
        expectedVersionId: "79000000-0000-4000-8000-000000000002", expectedSourceSha256: prior.renderSourceSha256,
        requestId: "79000000-0000-4000-8000-000000000003", output } }, draftFixtureNow);
    expect(source.coverLetter.body[0][0]).toMatchObject({ origin: "OWNER_EDIT", text: output.coverLetter.body[0].sentences[0].text });
    expect(source.referenceSheet).toEqual(prior.referenceSheet); expect(source.renderSourceSha256).not.toBe(prior.renderSourceSha256);
    const result = await prepareDraftRender({ source, packet }, { now: () => draftFixtureNow, render: renderDocumentLocallyForQa });
    expect(result.referenceSheet).toBeDefined(); expect(result.deliveryAuthorized).toBe(false);
    const artifacts = { resume: result.resume, coverLetter: result.coverLetter, referenceSheet: result.referenceSheet! };
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "draft-owner-edited-source.json"), serializeDraftRenderSource(source));
      for (const [name, artifact] of Object.entries(artifacts)) {
        expect(artifact.qa.pdf.renderSourceSha256).toBe(source.renderSourceSha256);
        expect(artifact.render.documentFontResolved).toBe(true); expect(artifact.render.pageCount).toBe(1); expect(artifact.deliveryAuthorized).toBe(false);
        const stem = `draft-owner-edited-${name}`;
        await writeFile(join(directory, `${stem}.docx`), artifact.buffer);
        await writeFile(join(directory, `${stem}.pdf`), artifact.render.searchablePdf);
        await writeFile(join(directory, `${stem}-qa.json`), JSON.stringify(artifact.qa, null, 2));
        for (const [index, page] of artifact.render.pageImages.entries()) await writeFile(join(directory, `${stem}-page-${index + 1}.png`), page.bytes);
      }
    } finally {
      for (const artifact of Object.values(artifacts)) {
        artifact.buffer.fill(0); artifact.render.searchablePdf.fill(0); artifact.render.pageImages.forEach((page) => page.bytes.fill(0));
      }
    }
  }, 180_000);
  it("renders the full three-member set with three authorized references and exact email links", async () => {
    const directory = process.env.APPLYPACK_RENDER_EVIDENCE_DIR;
    if (!directory || !isAbsolute(directory)) throw new Error("absolute_render_evidence_directory_required");
    const fixture = draftReferenceFixture(3), result = await prepareDraftRender({ source: fixture.build(), packet: fixture.input.packet }, { now: () => draftFixtureNow, render: renderDocumentLocallyForQa });
    expect(result.referenceSheet).toBeDefined();
    expect(result.referenceSheet!.render.draftPdf).toMatchObject({ artifact: "REFERENCE_SHEET", listItemCount: 0, linkCount: 5 });
    await mkdir(directory, { recursive: true });
    for (const [name, artifact] of Object.entries({ resume: result.resume, coverLetter: result.coverLetter, referenceSheet: result.referenceSheet! })) {
      expect(artifact.render.documentFontResolved).toBe(true); expect(artifact.render.pageCount).toBe(1); expect(artifact.deliveryAuthorized).toBe(false);
      const stem = `draft-three-member-${name}`;
      await writeFile(join(directory, `${stem}.docx`), artifact.buffer);
      await writeFile(join(directory, `${stem}.pdf`), artifact.render.searchablePdf);
      await writeFile(join(directory, `${stem}-qa.json`), JSON.stringify(artifact.qa, null, 2));
      for (const [index, page] of artifact.render.pageImages.entries()) await writeFile(join(directory, `${stem}-page-${index + 1}.png`), page.bytes);
    }
  }, 180_000);
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

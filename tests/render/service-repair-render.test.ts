import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prepareServiceRepairRender, type ServiceRepairRenderPort } from "@/lib/documents/service-repair-render";
import { prepareDraftDocx } from "@/lib/documents/draft-docx";
import { renderDocumentLocallyForQa } from "@/lib/documents/renderer";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { repairFixtureNow, serviceRepairRenderFixture } from "../fixtures/service-repair-render";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
describe("actual selected-member service-error repair rendering", () => {
  it.each(["SOURCE_CORRECTION", "SOURCE_PRESERVING_RERENDER"] as const)("renders only the affected letter using %s and unchanged expired original evidence", async (mode) => {
    const directory = process.env.APPLYPACK_RENDER_EVIDENCE_DIR;
    if (!directory || !isAbsolute(directory)) throw new Error("absolute_render_evidence_directory_required");
    const f = serviceRepairRenderFixture(mode), stem = mode === "SOURCE_CORRECTION" ? "repair-cover-letter" : "rerender-cover-letter";
    const originalPacket = serializeDraftingEvidencePacket(f.packet), originalSource = serializeDraftRenderSource(f.prior);
    await expect(prepareDraftDocx({ source: f.source, packet: f.packet }, repairFixtureNow)).rejects.toThrow("EVIDENCE_EXPIRED");
    const port: ServiceRepairRenderPort = {
      requireReviewer: async () => true,
      readCurrent: async () => structuredClone(f.inspection),
      loadEvidence: async () => f.evidence(),
      loadContact: async () => Buffer.from(f.document.input.contact.plaintext),
      loadReferences: vi.fn(async () => { throw new Error("unaffected_reference_payload_must_not_be_loaded"); }),
    };
    const render = vi.fn(renderDocumentLocallyForQa);
    const result = await prepareServiceRepairRender(port, f.reviewerId, f.identity, { now: () => repairFixtureNow, render });
    try {
      expect(render).toHaveBeenCalledTimes(1); expect(render.mock.calls[0][0].artifactType).toBe("COVER_LETTER");
      expect(port.loadReferences).not.toHaveBeenCalled(); expect(result.members).toHaveLength(1);
      const artifact = result.members[0];
      expect(artifact.artifactType).toBe("COVER_LETTER"); expect(artifact.render.pageCount).toBe(1);
      expect(artifact.render.documentFontResolved).toBe(true); expect(artifact.deliveryAuthorized).toBe(false);
      expect(artifact.render.draftPdf?.renderSourceSha256).toBe(f.source.renderSourceSha256);
      expect(artifact.provenance.serviceRepair).toMatchObject({ repairSourceSha256: f.serialized.sourceSha256,
        originalFileVersionId: f.original.fileVersionId, originalSourceSha256: f.prior.renderSourceSha256 });
      expect(serializeDraftingEvidencePacket(f.packet)).toBe(originalPacket);
      expect(serializeDraftRenderSource(f.prior)).toBe(originalSource);
      expect(f.source.validUntil).toBe(f.prior.validUntil);
      expect(artifact.repairMode).toBe(mode);
      if (mode === "SOURCE_PRESERVING_RERENDER") {
        expect(serializeDraftRenderSource(f.source)).toBe(originalSource);
        expect(f.source.finalVersionAt).toBe(f.prior.finalVersionAt);
      }
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${stem}.docx`), artifact.buffer);
      await writeFile(join(directory, `${stem}.pdf`), artifact.render.searchablePdf);
      await writeFile(join(directory, `${stem}-qa.json`), JSON.stringify(artifact.qa, null, 2));
      await writeFile(join(directory, `${stem}-synthetic-envelope.json`), f.serialized.body);
      await writeFile(join(directory, `${stem}-evidence.json`), JSON.stringify({
        evidenceKind: "SYNTHETIC_LOCAL_RENDER_ONLY", renderedArtifacts: [artifact.artifactType],
        repairMode: mode,
        originalPacketSha256: hash(originalPacket), originalSourceSha256: hash(originalSource),
        originalValidUntil: f.prior.validUntil, repairRenderAt: repairFixtureNow.toISOString(),
        originalBytesUnchanged: true, unselectedReferenceLoads: 0, deliveryAuthorized: false,
      }, null, 2));
      for (const [index, page] of artifact.render.pageImages.entries()) {
        await writeFile(join(directory, `${stem}-page-${index + 1}.png`), page.bytes);
      }
    } finally {
      for (const artifact of result.members) {
        artifact.buffer.fill(0); artifact.render.searchablePdf.fill(0);
        artifact.render.pageImages.forEach((page) => page.bytes.fill(0));
      }
    }
  }, 180_000);
});

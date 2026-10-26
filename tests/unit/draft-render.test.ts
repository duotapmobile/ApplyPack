import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prepareDraftRender } from "@/lib/documents/draft-render";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
import type { DocumentRenderInput, DocumentRenderResult } from "@/lib/documents/renderer";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";
import { draftReferenceFixture } from "../fixtures/draft-reference";
vi.mock("server-only", () => ({}));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Boundary unit double only. Actual DOCX→PDF proof is tests/render/draft-document-render.test.ts.
function rendered(input: DocumentRenderInput): DocumentRenderResult {
  const pdf = Buffer.from("%PDF-unit-double"), image = Buffer.from("unit-image"), expectation = input.draftPdf!;
  const { paragraphs, ...identity } = expectation;
  return { rendererIdentity: "unit-double-not-provider-proof", documentFontFamily: DOCUMENT_FONT_CONTRACT.family,
    documentFontVersion: DOCUMENT_FONT_CONTRACT.version, documentFontManifestSha256: DOCUMENT_FONT_CONTRACT.manifestSha256,
    documentFontSha256: DOCUMENT_FONT_CONTRACT.styles.regular, documentFontStyleSha256: DOCUMENT_FONT_CONTRACT.styles,
    pageCount: input.expectedPages, documentFontResolved: true, extractedTextSha256: input.expectedExtractedTextSha256,
    taggedPdf: true, metadataVerified: true, structureTreeSha256: "a".repeat(64), searchablePdf: pdf, searchablePdfSha256: hash(pdf),
    pageImages: [{ bytes: image, sha256: hash(image) }], draftPdf: { ...identity, searchablePdfSha256: hash(pdf),
      structureTextSha256: "b".repeat(64), linkXmlSha256: "c".repeat(64), paragraphCount: paragraphs.length,
      listItemCount: paragraphs.filter((row) => row.kind === "BULLET").length, linkCount: paragraphs.flatMap((row) => row.links).length } };
}
describe("draft pair render preparation boundary", () => {
  it("rejects forged selected reference scope before rendering", async () => {
    const fixture = draftDocumentFixture(), packet = structuredClone(fixture.input.packet), render = vi.fn();
    packet.binding.referencePermissions.push({ id: "78000000-0000-4000-8000-000000000099", customer_id: packet.expected.customerId,
      delivered_release_id: "78000000-0000-4000-8000-000000000013", job_snapshot_id: packet.binding.jobSnapshotId,
      job_snapshot_hash: packet.binding.jobSha256, reference_record_version_id: "78000000-0000-4000-8000-000000000098", revoked_at: null, contact_version_changed_at: null });
    await expect(prepareDraftRender({ source: fixture.build(), packet }, { now: () => draftFixtureNow, render })).rejects.toThrow(/DIGEST_INVALID/);
    expect(render).not.toHaveBeenCalled();
  });
  it("renders all three members for selected references and binds exact zero-list reference evidence", async () => {
    const fixture = draftReferenceFixture(3), seen: DocumentRenderInput[] = [];
    const result = await prepareDraftRender({ source: fixture.build(), packet: fixture.input.packet }, { now: () => draftFixtureNow, render: async (input) => { seen.push(input); return rendered(input); } });
    expect(seen.map((input) => input.artifactType)).toEqual(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]);
    expect(result.referenceSheet?.render.draftPdf).toMatchObject({ artifact: "REFERENCE_SHEET", listItemCount: 0, linkCount: 5 });
    expect(result.referenceSheet?.provenance.sourceBinding.referencePermissionIds).toEqual(fixture.references.map((input) => input.permissionId));
    expect(result.referenceSheet?.state).toBe("OWNER_REVIEW_REQUIRED"); expect(result.referenceSheet?.deliveryAuthorized).toBe(false);
  });
  it("fails the complete set and clears transferred originals when the third render fails", async () => {
    const fixture = draftReferenceFixture(), returned: DocumentRenderResult[] = [];
    await expect(prepareDraftRender({ source: fixture.build(), packet: fixture.input.packet }, { now: () => draftFixtureNow, render: async (input) => {
      if (input.artifactType === "REFERENCE_SHEET") throw new Error("reference render failed");
      const output = rendered(input); returned.push(output); return output;
    } })).rejects.toThrow("reference render failed");
    expect(returned).toHaveLength(2);
    expect(returned.every((output) => output.searchablePdf.every((byte) => byte === 0) && output.pageImages[0].bytes.every((byte) => byte === 0))).toBe(true);
  });
  it("binds both DOCX and PDF evidence to exact source and leaves approval/delivery pending", async () => {
    const fixture = draftDocumentFixture(), source = fixture.build(), seen: DocumentRenderInput[] = [];
    const result = await prepareDraftRender({ source, packet: fixture.input.packet }, { now: () => draftFixtureNow, render: async (input) => { seen.push(input); return rendered(input); } });
    expect(result.state).toBe("OWNER_REVIEW_REQUIRED"); expect(result.deliveryAuthorized).toBe(false);
    expect(result.resume.render.draftPdf?.docxSha256).toBe(hash(result.resume.buffer));
    expect(result.coverLetter.render.draftPdf?.renderSourceSha256).toBe(source.renderSourceSha256);
    expect(seen).toHaveLength(2); expect(seen.every((input) => input.docx.every((byte) => byte === 0))).toBe(true);
    expect(result.resume.ownerReviewClaims.length).toBeGreaterThan(0);
  });
  it.each(["source", "generator", "pdf", "image", "missing"])("rejects mismatched %s render evidence", async (kind) => {
    const fixture = draftDocumentFixture();
    await expect(prepareDraftRender({ source: fixture.build(), packet: fixture.input.packet }, { now: () => draftFixtureNow, render: async (input) => {
      const result = rendered(input);
      if (kind === "source") result.draftPdf!.renderSourceSha256 = "f".repeat(64);
      if (kind === "generator") result.draftPdf!.generatorVersion = "legacy-generator";
      if (kind === "pdf") result.searchablePdf[5] = 65;
      if (kind === "image") result.pageImages[0].sha256 = "f".repeat(64);
      if (kind === "missing") delete result.draftPdf;
      return result;
    } })).rejects.toThrow(/evidence_invalid/);
  });
  it("owns caller inputs across asynchronous rendering and detaches output claims", async () => {
    const fixture = draftDocumentFixture(), source = structuredClone(fixture.build()), original = source.ownerReviewClaims[0].text;
    fixture.input.packet = structuredClone(fixture.input.packet);
    let calls = 0;
    const result = await prepareDraftRender({ source, packet: fixture.input.packet }, { now: () => draftFixtureNow, render: async (input) => {
      if (++calls === 1) { source.ownerReviewClaims[0].text = "caller changed while rendering"; fixture.input.packet.ownerEvidence.targetJob.company = "changed"; }
      return rendered(input);
    } });
    const matching = result.resume.ownerReviewClaims.find((claim) => claim.claimId === source.ownerReviewClaims[0].claimId)!;
    expect(matching.text).toBe(original);
    matching.text = "new owner object";
    expect(source.ownerReviewClaims[0].text).toBe("caller changed while rendering");
  });
  it("fails the pair if evidence expires during the first render", async () => {
    const fixture = draftDocumentFixture(); let now = draftFixtureNow;
    const render = vi.fn(async (input: DocumentRenderInput) => { now = new Date("2026-10-27T12:00:00Z"); return rendered(input); });
    await expect(prepareDraftRender({ source: fixture.build(), packet: fixture.input.packet }, { now: () => now, render })).rejects.toThrow(/evidence_expired/);
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("clears renderer-transferred originals on success while keeping detached return copies intact", async () => {
    const fixture = draftDocumentFixture(), returned: DocumentRenderResult[] = [];
    const result = await prepareDraftRender({ source: fixture.build(), packet: fixture.input.packet }, { now: () => draftFixtureNow, render: async (input) => {
      const output = rendered(input); returned.push(output); return output;
    } });
    expect(returned.every((output) => output.searchablePdf.every((byte) => byte === 0) && output.pageImages.every((page) => page.bytes.every((byte) => byte === 0)))).toBe(true);
    expect(result.resume.render.searchablePdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.coverLetter.render.pageImages[0].bytes.toString()).toBe("unit-image");
  });
  it.each(["second-render", "clone", "shape"])("clears transferred private originals after %s failure", async (failure) => {
    const fixture = draftDocumentFixture(), returned: DocumentRenderResult[] = [];
    await expect(prepareDraftRender({ source: fixture.build(), packet: fixture.input.packet }, { now: () => draftFixtureNow, render: async (input) => {
      if (failure === "second-render" && returned.length) throw new Error("second render failed");
      const output = rendered(input); returned.push(output);
      if (failure === "clone") Object.assign(output, { cannotClone: () => undefined });
      if (failure === "shape") output.pageImages.push(null as never);
      return output;
    } })).rejects.toThrow();
    expect(returned).toHaveLength(1);
    expect(returned[0].searchablePdf.every((byte) => byte === 0)).toBe(true);
    expect(returned[0].pageImages[0].bytes.every((byte) => byte === 0)).toBe(true);
  });
});

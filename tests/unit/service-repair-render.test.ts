import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { bindServiceRepairRenderSource, serializeServiceRepairEnvelope, type ServiceRepairBoundMember } from "@/lib/documents/service-repair-source";
import { prepareServiceRepairRender, type ServiceRepairRenderPort } from "@/lib/documents/service-repair-render";
import { prepareDraftDocx, prepareServiceRepairDocx } from "@/lib/documents/draft-docx";
import * as docx from "@/lib/documents/draft-docx";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { readStoredDraftRenderSource } from "@/lib/documents/draft-render-source-storage";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
import { serviceErrorCanonicalJson } from "@/lib/materials/service-error-contract";
import type { DocumentRenderInput, DocumentRenderResult } from "@/lib/documents/renderer";
import { repairFixtureNow, serviceRepairRenderFixture } from "../fixtures/service-repair-render";
vi.mock("server-only", () => ({}));
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
function rendered(input: DocumentRenderInput): DocumentRenderResult {
  const pdf = Buffer.from("%PDF-unit-boundary-only"), image = Buffer.from("synthetic-image"), { paragraphs, ...identity } = input.draftPdf!;
  return { rendererIdentity: "unit-double-not-render-proof", documentFontFamily: DOCUMENT_FONT_CONTRACT.family,
    documentFontVersion: DOCUMENT_FONT_CONTRACT.version, documentFontManifestSha256: DOCUMENT_FONT_CONTRACT.manifestSha256,
    documentFontSha256: DOCUMENT_FONT_CONTRACT.styles.regular, documentFontStyleSha256: DOCUMENT_FONT_CONTRACT.styles,
    pageCount: input.expectedPages, documentFontResolved: true, extractedTextSha256: input.expectedExtractedTextSha256,
    taggedPdf: true, metadataVerified: true, structureTreeSha256: "a".repeat(64), searchablePdf: pdf, searchablePdfSha256: hash(pdf),
    pageImages: [{ bytes: image, sha256: hash(image) }], draftPdf: { ...identity, searchablePdfSha256: hash(pdf),
      structureTextSha256: "b".repeat(64), linkXmlSha256: "c".repeat(64), paragraphCount: paragraphs.length,
      listItemCount: paragraphs.filter((row) => row.kind === "BULLET").length, linkCount: paragraphs.flatMap((row) => row.links).length } };
}
function fixture() {
  const f = serviceRepairRenderFixture();
  const port = { requireReviewer: vi.fn(async (): Promise<unknown> => true), readCurrent: vi.fn(async () => structuredClone(f.inspection)),
    loadEvidence: vi.fn(async () => f.evidence()), loadContact: vi.fn(async () => Buffer.from(f.document.input.contact.plaintext)),
    loadReferences: vi.fn(async () => { throw new Error("unselected references must not be loaded"); }),
  } satisfies ServiceRepairRenderPort;
  const render = vi.fn(async (input: DocumentRenderInput) => rendered(input));
  return { ...f, port, render, run: (options: { signal?: AbortSignal; timeoutMs?: number } = {}) =>
    prepareServiceRepairRender(port, f.reviewerId, f.identity, { now: () => repairFixtureNow, render, ...options }),
    bind: () => bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...f.evidence() }, repairFixtureNow) };
}

describe("099 repair source authority", () => {
  it("binds exact expired original bytes without refreshing their dates", () => {
    const f = fixture(), packet = serializeDraftingEvidencePacket(f.packet), source = serializeDraftRenderSource(f.prior), bound = f.bind();
    expect(bound.members).toHaveLength(1); expect(bound.members[0].artifactType).toBe("COVER_LETTER");
    expect(bound.members[0].source.validUntil).toBe(f.prior.validUntil);
    expect(Date.parse(f.prior.validUntil)).toBeLessThan(repairFixtureNow.getTime());
    expect(serializeDraftingEvidencePacket(f.packet)).toBe(packet); expect(serializeDraftRenderSource(f.prior)).toBe(source);
    expect(bound.sourceSha256).not.toBe(bound.members[0].source.renderSourceSha256);
  });
  it("keeps ordinary paid paths closed for exactly the same expired evidence", async () => {
    const f = fixture();
    await expect(prepareDraftDocx({ source: f.source, packet: f.packet }, repairFixtureNow)).rejects.toThrow("EVIDENCE_EXPIRED");
    const body = serializeDraftRenderSource(f.source);
    expect(() => readStoredDraftRenderSource({ body, value: JSON.parse(body) }, f.source.renderSourceSha256, f.packet, () => repairFixtureNow)).toThrow("SOURCE_STALE");
  });
  it("permits a separately reviewed rerender of exact correct original source without inventing a text edit", () => {
    const f = serviceRepairRenderFixture("SOURCE_PRESERVING_RERENDER");
    const result = bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...f.evidence() }, repairFixtureNow);
    expect(result.members[0].repairMode).toBe("SOURCE_PRESERVING_RERENDER");
    expect(serializeDraftRenderSource(result.members[0].source)).toBe(serializeDraftRenderSource(f.prior));
    expect(result.members[0].source.finalVersionAt).toBe(f.prior.finalVersionAt);
    expect(result.sourceSha256).not.toBe(f.prior.renderSourceSha256);
  });
  it("does not let a source correction claim the source-preserving mode", () => {
    const f = fixture(); f.envelope.members[0].repairMode = "SOURCE_PRESERVING_RERENDER";
    const saved = serializeServiceRepairEnvelope(f.envelope); f.inspection.version.source_sha256 = saved.sourceSha256;
    expect(() => bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...f.evidence(),
      envelopeBytes: Buffer.from(saved.body) }, repairFixtureNow)).toThrow("RERENDER_SOURCE_CHANGED");
  });
  it("requires a fresh selected-member review for an unchanged-source rerender", () => {
    const f = serviceRepairRenderFixture("SOURCE_PRESERVING_RERENDER");
    f.inspection.version.claims_reviewed_at = f.original.approvedAt;
    expect(() => bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...f.evidence() }, repairFixtureNow)).toThrow("AUTHORITY_STALE");
  });
  it.each(["lease", "expired", "released", "context", "review", "source"])("rejects changed %s authority", (kind) => {
    const f = fixture();
    if (kind === "lease") f.inspection.job.lease_token = "7b000000-0000-4000-8000-000000000099";
    if (kind === "expired") f.inspection.job.lease_expires_at = repairFixtureNow.toISOString();
    if (kind === "released") f.inspection.version.release_id = "7b000000-0000-4000-8000-000000000099";
    if (kind === "context") f.inspection.contextSha256 = "0".repeat(64);
    if (kind === "review") f.inspection.version.claim_review_metadata = [];
    if (kind === "source") f.inspection.version.source_sha256 = "0".repeat(64);
    expect(() => f.bind()).toThrow();
  });
  it("does not discard an earlier accepted member when the latest decision has one member", () => {
    const f = fixture(); f.inspection.acceptedRows.push({ ...f.inspection.acceptedRows[0], id: "7b000000-0000-4000-8000-000000000091",
      decision_id: "7b000000-0000-4000-8000-000000000092", file_version_id: "7b000000-0000-4000-8000-000000000093" });
    expect(() => f.bind()).toThrow("SCOPE_CHANGED");
  });
  it("rejects unknown original IDs even with a recomputed envelope hash", () => {
    const f = fixture(); f.envelope.members[0].originalFileVersionId = "7b000000-0000-4000-8000-000000000099";
    const saved = serializeServiceRepairEnvelope(f.envelope); f.inspection.version.source_sha256 = saved.sourceSha256;
    expect(() => bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...f.evidence(), envelopeBytes: Buffer.from(saved.body) }, repairFixtureNow)).toThrow("MEMBER_NOT_ACCEPTED");
  });
  it("rejects modified original bytes and forged direct layout authorization", async () => {
    const f = fixture(), evidence = f.evidence(); evidence.originals[0].sourceBytes[3] ^= 1;
    expect(() => bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...evidence }, repairFixtureNow)).toThrow();
    await expect(prepareServiceRepairDocx({ source: f.source, packet: f.packet, artifactType: "RESUME" } as ServiceRepairBoundMember)).rejects.toThrow("MEMBER_UNBOUND");
    await expect(prepareServiceRepairDocx(structuredClone(f.bind().members[0]))).rejects.toThrow("MEMBER_UNBOUND");
  });
  it("requires every exact reviewed wording hash and placement, not a generic approval", () => {
    const f = fixture(), review = structuredClone(f.inspection.version.claim_review_metadata) as Array<{ claims: Array<{ placement: string }> }>;
    review[0].claims[0].placement = "resume.contact.displayName"; f.inspection.version.claim_review_metadata = review;
    expect(() => f.bind()).toThrow("WORDING_REVIEW_INCOMPLETE");
  });
  it("rejects an unselected resume edit even when all source and envelope hashes are recomputed", () => {
    const f = fixture(), source = structuredClone(f.source), changed = source.resume.sections[0].bullets[0];
    const text = `${changed.text} Additional wording.`;
    for (const claim of [changed, source.ownerReviewClaims.find((entry) => entry.claimId === changed.claimId)!]) {
      claim.text = text; claim.wordingSha256 = hash(Buffer.from(text));
    }
    const { renderSourceSha256: _hash, ...body } = source; void _hash;
    const renderSourceSha256 = hash(Buffer.from(serviceErrorCanonicalJson(body)));
    f.envelope.members[0].source = body; f.envelope.members[0].renderSourceSha256 = renderSourceSha256;
    const saved = serializeServiceRepairEnvelope(f.envelope); f.inspection.version.source_sha256 = saved.sourceSha256;
    expect(() => bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...f.evidence(),
      envelopeBytes: Buffer.from(saved.body) }, repairFixtureNow)).toThrow("UNSELECTED_CONTENT_CHANGED");
  });
});

describe("099 selected repair render pipeline", () => {
  it("constructs only the accepted cover letter and never loads reference payloads", async () => {
    const f = fixture(), result = await f.run();
    expect(f.render).toHaveBeenCalledTimes(1); expect(f.render.mock.calls[0][0].artifactType).toBe("COVER_LETTER");
    expect(f.port.loadReferences).not.toHaveBeenCalled(); expect(f.port.loadContact).toHaveBeenCalledTimes(1);
    expect(f.port.readCurrent.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(result.members).toHaveLength(1); expect(result.members[0].provenance.serviceRepair).toMatchObject({
      repairSourceSha256: f.serialized.sourceSha256, originalSourceSha256: f.prior.renderSourceSha256, originalFileVersionId: f.original.fileVersionId });
    expect(result.members[0].render.draftPdf?.renderSourceSha256).toBe(f.source.renderSourceSha256);
    expect(result.deliveryAuthorized).toBe(false);
  });
  it.each([false, null, {}, "true"])("rejects malformed reviewer response %s before private reads", async (value) => {
    const f = fixture(); f.port.requireReviewer.mockResolvedValue(value);
    await expect(f.run()).rejects.toThrow("REVIEWER_UNCONFIRMED"); expect(f.port.loadEvidence).not.toHaveBeenCalled();
  });
  it("rejects changed original contact before renderer dispatch and clears returned bytes", async () => {
    const f = fixture(), bytes = Buffer.from("private invalid contact"); f.port.loadContact.mockResolvedValue(bytes);
    await expect(f.run()).rejects.toThrow("CONTACT_CHANGED"); expect(f.render).not.toHaveBeenCalled(); expect(bytes.every((value) => value === 0)).toBe(true);
  });
  it("rejects an authority change after rendering and clears output instead of returning files", async () => {
    const f = fixture(); let returned: DocumentRenderResult | undefined;
    f.render.mockImplementation(async (input) => { returned = rendered(input); f.inspection.contextSha256 = "0".repeat(64); return returned; });
    await expect(f.run()).rejects.toThrow("EVIDENCE_INVALID"); expect(returned!.searchablePdf.every((value) => value === 0)).toBe(true);
    expect(returned!.pageImages[0].bytes.every((value) => value === 0)).toBe(true);
  });
  it("clears a late contact result after caller cancellation", async () => {
    const f = fixture(), controller = new AbortController(); let finish!: (value: Buffer<ArrayBuffer>) => void;
    f.port.loadContact.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const result = f.run({ signal: controller.signal });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function")); controller.abort();
    await expect(result).rejects.toThrow("CANCELED"); const late = Buffer.from(f.document.input.contact.plaintext); finish(late);
    await vi.waitFor(() => expect(late.every((value) => value === 0)).toBe(true)); expect(f.render).not.toHaveBeenCalled();
  });
  it("clears late renderer files after cancellation without returning a partial repair", async () => {
    const f = fixture(), controller = new AbortController(); let finish!: (value: DocumentRenderResult) => void;
    let input!: DocumentRenderInput;
    f.render.mockImplementation((value) => { input = value; return new Promise((resolve) => { finish = resolve; }); });
    const result = f.run({ signal: controller.signal });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function")); controller.abort();
    await expect(result).rejects.toThrow("CANCELED"); const late = rendered(input); finish(late);
    await vi.waitFor(() => expect(late.searchablePdf.every((value) => value === 0)).toBe(true));
    expect(late.pageImages[0].bytes.every((value) => value === 0)).toBe(true);
    expect(input.docx.every((value) => value === 0)).toBe(true);
  });
  it("clears earlier private clones when a later original cannot be detached", async () => {
    const f = fixture(), transferred = f.evidence(), bad = structuredClone(transferred.originals[0]);
    Object.defineProperty(bad.member, "uncloneable", { enumerable: true, value: () => undefined });
    transferred.originals.push(bad); f.port.loadEvidence.mockResolvedValue(transferred);
    const captured: Buffer[] = [], originalFrom = Buffer.from;
    const tracked: Buffer[] = [transferred.envelopeBytes, transferred.originals[0].packetBytes, transferred.originals[0].sourceBytes];
    const spy = vi.spyOn(Buffer, "from").mockImplementation(((...args: Parameters<typeof Buffer.from>) => {
      const cloned = Reflect.apply(originalFrom, Buffer, args) as Buffer;
      if (tracked.includes(args[0] as Buffer)) captured.push(cloned);
      return cloned;
    }) as typeof Buffer.from);
    try {
      await expect(f.run()).rejects.toThrow("EVIDENCE_INVALID");
      expect(captured).toHaveLength(3); expect(captured.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
      expect(f.port.loadContact).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it("clears a DOCX which arrives after the repair deadline has timed out", async () => {
    const f = fixture(), artifact = await prepareServiceRepairDocx(f.bind().members[0]);
    let finish!: (value: typeof artifact) => void;
    const spy = vi.spyOn(docx, "prepareServiceRepairDocx").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    try {
      const result = f.run({ timeoutMs: 1000 });
      await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
      await expect(result).rejects.toThrow("CANCELED"); finish(artifact);
      await vi.waitFor(() => expect(artifact.buffer.every((value) => value === 0)).toBe(true));
      expect(f.render).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); artifact.buffer.fill(0); }
  });
});

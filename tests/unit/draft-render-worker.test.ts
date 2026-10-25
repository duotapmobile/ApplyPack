import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDraftForClaim, type DraftRenderServices, type DraftRenderState, type DraftRenderedPair } from "@/lib/documents/draft-render-worker";
import { prepareDraftRender } from "@/lib/documents/draft-render";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
import type { DocumentRenderInput, DocumentRenderResult } from "@/lib/documents/renderer";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";
vi.mock("server-only", () => ({}));
const id = (n: number) => `77000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Actual DOCX preparation/inspection, with a rendering-boundary double. This is
// not provider or PDF proof; the real render suite is a separate required gate.
function rendered(input: DocumentRenderInput): DocumentRenderResult {
  const searchablePdf = Buffer.from("%PDF-unit-render"), image = Buffer.from("unit-image"), { paragraphs, ...identity } = input.draftPdf!;
  return { rendererIdentity: "fixture-renderer", documentFontFamily: DOCUMENT_FONT_CONTRACT.family, documentFontVersion: DOCUMENT_FONT_CONTRACT.version,
    documentFontManifestSha256: DOCUMENT_FONT_CONTRACT.manifestSha256, documentFontSha256: DOCUMENT_FONT_CONTRACT.styles.regular, documentFontStyleSha256: DOCUMENT_FONT_CONTRACT.styles,
    pageCount: input.expectedPages, documentFontResolved: true, extractedTextSha256: input.expectedExtractedTextSha256, taggedPdf: true, metadataVerified: true,
    structureTreeSha256: "a".repeat(64), searchablePdf, searchablePdfSha256: hash(searchablePdf), pageImages: [{ bytes: image, sha256: hash(image) }],
    draftPdf: { ...identity, searchablePdfSha256: hash(searchablePdf), structureTextSha256: "b".repeat(64), linkXmlSha256: "c".repeat(64), paragraphCount: paragraphs.length,
      listItemCount: paragraphs.filter((row) => row.kind === "BULLET").length, linkCount: paragraphs.flatMap((row) => row.links).length } };
}
function fixture() {
  const f = draftDocumentFixture(), source = f.build(), packet = f.input.packet, claim = { jobId: id(1), ownerId: id(2), leaseToken: id(3) };
  const state: DraftRenderState = { ...claim, customerId: packet.expected.customerId, materialLineId: packet.expected.materialLineId,
    revisionId: packet.expected.revisionId, revisionVersion: packet.expected.revisionVersion, bindingSha256: packet.expected.bindingSha256,
    snapshotId: packet.binding.snapshotId, jobSnapshotId: packet.binding.jobSnapshotId, ruleId: packet.binding.ruleId, dueAt: packet.binding.dueAt,
    leaseGeneration: 1, leaseExpiresAt: new Date(draftFixtureNow.getTime() + 300_000).toISOString(), versionId: id(4), packetPayloadId: id(5),
    packetSha256: packet.packetSha256, contextSha256: "d".repeat(64), sourcePayloadId: id(6), sourceSha256: source.renderSourceSha256,
    reviewPayloadId: id(7), reviewSha256: "e".repeat(64), reviewerId: id(8), reviewedAt: draftFixtureNow.toISOString(), selectedReferenceSheet: false,
    rendererIdentity: "fixture-renderer", existingArtifactIds: { RESUME: null, COVER_LETTER: null }, delivery: { format: "PDF", reason: "DEFAULT_PDF", employerRuleId: packet.binding.ruleId, applicantRequestId: null, requestReferenceSha256: null } };
  let clock = draftFixtureNow, pair: DraftRenderedPair | undefined;
  const events: string[] = [];
  const services = { enabled: vi.fn(() => true), readState: vi.fn(async () => structuredClone(state)), loadEvidence: vi.fn(async () => ({ source, packet })),
    renewLease: vi.fn(async () => new Date(clock.getTime() + 300_000).toISOString()), recheck: vi.fn(async () => true),
    render: vi.fn(async (input) => { events.push("render"); pair = await prepareDraftRender(input, { now: () => clock, render: async (value) => rendered(value) }); return pair; }),
    persistUploadIntents: vi.fn<DraftRenderServices["persistUploadIntents"]>(async () => { events.push("intents"); }), upload: vi.fn(async (input) => { expect(input.bytes.some((byte: number) => byte !== 0)).toBe(true); events.push(`upload:${input.bucket}`); }),
    commit: vi.fn<DraftRenderServices["commit"]>(async () => { events.push("commit"); return { draftVersionId: state.versionId, memberSetSha256: "f".repeat(64), members: [], replayed: false }; }),
    readCommitted: vi.fn(async () => ({ jobId: state.jobId, versionId: state.versionId, packetSha256: state.packetSha256, sourceSha256: state.sourceSha256,
      reviewSha256: state.reviewSha256, memberSetSha256: "f".repeat(64), current: true })) } satisfies DraftRenderServices;
  return { source, packet, claim, state, services, events, pair: () => pair!, setClock: (value: Date) => { clock = value; },
    run: (options: { enabled?: boolean; signal?: AbortSignal } = {}) => renderDraftForClaim(services, claim, { enabled: options.enabled ?? true, signal: options.signal, now: () => clock }) };
}
afterEach(() => vi.useRealTimers());
describe("claimed reviewed-pair render registration worker", () => {
  it("does nothing unless both independent switches are enabled", async () => {
    const f = fixture(); expect(await f.run({ enabled: false })).toEqual({ status: "DISABLED" }); f.services.enabled.mockReturnValue(false);
    expect(await f.run()).toEqual({ status: "DISABLED" }); expect(f.services.readState).not.toHaveBeenCalled();
  });
  it("records all six exact cleanup paths before uploads and registers exactly one complete source-aware pair", async () => {
    const f = fixture(), result = await f.run(); expect(result).toMatchObject({ status: "REVIEW_READY", jobId: f.claim.jobId, versionId: f.state.versionId, ownerReviewRequired: true, deliveryAuthorized: false, reconciled: false });
    expect(f.events).toEqual(["render", "intents", "upload:operator-drafts", "upload:operator-render-previews", "upload:customer-deliveries", "upload:operator-drafts", "upload:operator-render-previews", "upload:customer-deliveries", "commit"]);
    expect(f.services.persistUploadIntents.mock.calls[0][0]).toHaveLength(6); expect(f.services.commit).toHaveBeenCalledOnce();
    const registrations = f.services.commit.mock.calls[0][1]; expect(registrations.map((row) => row.p_artifact_type)).toEqual(["RESUME", "COVER_LETTER"]);
    for (const row of registrations) { expect(row.p_reviewer_id).toBeNull(); expect(row.p_reference_regeneration_id).toBeNull();
      const artifact = row.p_artifact_type === "RESUME" ? f.pair().resume : f.pair().coverLetter;
      expect(row.p_claim_provenance).toMatchObject({ sourceAwareQa: { metadataSha256: hash(Buffer.from(JSON.stringify(artifact.metadata))) } });
      expect(row.p_malware_scanner_identity).toBe("NOT_SCANNED:generated-structural-v1");
      expect(row.p_claim_provenance).toMatchObject({ draftPair: { versionId: f.state.versionId, sourceSha256: f.state.sourceSha256, claimReviewSha256: f.state.reviewSha256 }, sourceAwareQa: { schemaVersion: "applypack-source-aware-document-qa-v1", pdf: { renderSourceSha256: f.source.renderSourceSha256 } } });
    }
    for (const artifact of [f.pair().resume, f.pair().coverLetter]) expect([artifact.buffer, artifact.render.searchablePdf, ...artifact.render.pageImages.map((page) => page.bytes)].every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it("reuses the same revision artifact identities for a second saved version while creating fresh file versions", async () => {
    const f = fixture(); expect(await f.run()).toMatchObject({ status: "REVIEW_READY" });
    const original = f.services.commit.mock.calls[0][1]; f.state.versionId = id(40); f.state.reviewSha256 = "7".repeat(64);
    expect(await f.run()).toMatchObject({ status: "REVIEW_READY", versionId: id(40) });
    const next = f.services.commit.mock.calls[1][1];
    expect(next.map((row) => row.p_artifact_id)).toEqual(original.map((row) => row.p_artifact_id));
    expect(next.map((row) => row.p_file_version_id)).not.toEqual(original.map((row) => row.p_file_version_id));
  });
  it("retains arbitrary previously registered artifact IDs rather than imposing generated IDs on history", async () => {
    const f = fixture(); f.state.existingArtifactIds = { RESUME: id(87), COVER_LETTER: id(88) };
    expect(await f.run()).toMatchObject({ status: "REVIEW_READY" });
    expect(f.services.commit.mock.calls[0][1].map((row) => row.p_artifact_id)).toEqual([id(87), id(88)]);
  });
  it("uses the applicant Word decision and exact DOCX digest without losing the PDF preview", async () => {
    const f = fixture(); f.state.delivery = { ...f.state.delivery, format: "DOCX", reason: "APPLICANT_REQUEST", applicantRequestId: id(9), requestReferenceSha256: "1".repeat(64) };
    expect(await f.run()).toMatchObject({ status: "REVIEW_READY" });
    for (const row of f.services.commit.mock.calls[0][1]) { expect(row.p_safe_filename).toMatch(/\.docx$/); expect(row.p_mime_type).toContain("wordprocessingml");
      expect(row.p_claim_provenance).toMatchObject({ sourceAwareQa: { pdf: { docxSha256: row.p_checksum_sha256, searchablePdfSha256: row.p_render_preview_sha256 } }, deliveryFormatDecision: f.state.delivery }); }
  });
  it.each(["owner", "lease", "expired", "reference"])("holds changed %s before rendering", async (mode) => {
    const f = fixture(); if (mode === "owner") f.state.ownerId = id(99); if (mode === "lease") f.state.leaseToken = id(99);
    if (mode === "expired") f.state.leaseExpiresAt = draftFixtureNow.toISOString(); if (mode === "reference") f.state.selectedReferenceSheet = true;
    expect(await f.run()).toMatchObject({ status: "HELD" }); expect(f.services.render).not.toHaveBeenCalled(); expect(f.services.persistUploadIntents).not.toHaveBeenCalled();
  });
  it("does not upload after state changes during rendering", async () => {
    const f = fixture(); f.services.recheck.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await f.run()).toEqual({ status: "HELD", code: "CLAIM_STALE" }); expect(f.services.persistUploadIntents).not.toHaveBeenCalled(); expect(f.pair().resume.buffer.every((byte) => byte === 0)).toBe(true);
  });
  it("does not register when freshness expires during uploads", async () => {
    const f = fixture(); f.services.upload.mockImplementationOnce(async () => { f.setClock(new Date(f.source.validUntil)); });
    expect(await f.run()).toEqual({ status: "HELD", code: "EVIDENCE_STALE" }); expect(f.services.commit).not.toHaveBeenCalled(); expect(f.services.persistUploadIntents).toHaveBeenCalledOnce();
  });
  it("does not upload if durable cleanup persistence is unconfirmed", async () => {
    const f = fixture(); f.services.persistUploadIntents.mockRejectedValue(new Error("private database detail"));
    expect(await f.run()).toEqual({ status: "HELD", code: "UPLOAD_UNCONFIRMED" }); expect(f.services.upload).not.toHaveBeenCalled();
  });
  it("preserves intents and stops without a half registration after a lost upload response", async () => {
    const f = fixture(); f.services.upload.mockRejectedValueOnce(new Error("private storage detail"));
    expect(await f.run()).toEqual({ status: "HELD", code: "UPLOAD_UNCONFIRMED" }); expect(f.services.upload).toHaveBeenCalledOnce(); expect(f.services.commit).not.toHaveBeenCalled();
  });
  it("reconciles one lost atomic-commit response without retrying the mutation", async () => {
    const f = fixture(); f.services.commit.mockRejectedValue(new Error("private lost response"));
    expect(await f.run()).toMatchObject({ status: "REVIEW_READY", reconciled: true }); expect(f.services.commit).toHaveBeenCalledOnce(); expect(f.services.readCommitted).toHaveBeenCalledOnce();
  });
  it.each(["missing", "different", "malformed acknowledgement"])("reports unknown for %s registration evidence without retry or deletion", async (mode) => {
    const f = fixture(); if (mode === "missing") f.services.readCommitted.mockRejectedValue(new Error("missing"));
    if (mode === "different") f.services.readCommitted.mockImplementation(async () => ({ jobId: id(99), versionId: f.state.versionId, packetSha256: f.state.packetSha256, sourceSha256: f.state.sourceSha256, reviewSha256: f.state.reviewSha256, memberSetSha256: "f".repeat(64), current: true }));
    if (mode === "malformed acknowledgement") f.services.commit.mockImplementation(async () => ({ draftVersionId: id(99), memberSetSha256: "f".repeat(64), members: [], replayed: false }));
    expect(await f.run()).toEqual({ status: "RESULT_UNKNOWN", code: "REGISTRATION_UNCONFIRMED" }); expect(f.services.commit).toHaveBeenCalledOnce();
  });
  it("clears a late render result and never uploads after cancellation", async () => {
    const f = fixture(); let finish: (pair: DraftRenderedPair) => void = () => undefined;
    const prepared = await prepareDraftRender({ source: f.source, packet: f.packet }, { now: () => draftFixtureNow, render: async (input) => rendered(input) });
    f.services.render.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController(), pending = f.run({ signal: controller.signal }); await vi.waitFor(() => expect(f.services.render).toHaveBeenCalled());
    controller.abort(); expect(await pending).toEqual({ status: "HELD", code: "INTERRUPTED" }); finish(prepared);
    await vi.waitFor(() => expect(prepared.resume.buffer.every((byte) => byte === 0)).toBe(true)); expect(f.services.upload).not.toHaveBeenCalled();
  });
});

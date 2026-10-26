import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { DocumentRenderInput, DocumentRenderResult } from "@/lib/documents/renderer";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ draft: vi.fn(), repair: vi.fn(), contact: vi.fn(), references: vi.fn() }));
vi.mock("@/lib/documents/draft-packet-worker", () => ({ readEncryptedDraftPayload: mocks.draft }));
vi.mock("@/lib/materials/service-repair-payload", () => ({ readServiceRepairPayload: mocks.repair }));
vi.mock("@/lib/documents/draft-owner-contact", () => ({ readConfirmedDraftContact: mocks.contact }));
vi.mock("@/lib/documents/draft-owner-references", () => ({ readServiceRepairReferences: mocks.references }));
import { createServiceRepairRenderServer, loadServiceRepairOriginalEvidence } from "@/lib/documents/service-repair-render-server";
import { bindServiceRepairRenderSource } from "@/lib/documents/service-repair-source";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
import { repairFixtureNow, serviceRepairRenderFixture } from "../fixtures/service-repair-render";
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const signal = () => new AbortController().signal;
const other = "99000000-0000-4000-8000-000000000099";
function render(input: DocumentRenderInput): DocumentRenderResult {
  const pdf = Buffer.from("%PDF-unit-boundary-only"), image = Buffer.from("synthetic-image"), { paragraphs, ...identity } = input.draftPdf!;
  return { rendererIdentity: "unit-protocol-only", documentFontFamily: DOCUMENT_FONT_CONTRACT.family,
    documentFontVersion: DOCUMENT_FONT_CONTRACT.version, documentFontManifestSha256: DOCUMENT_FONT_CONTRACT.manifestSha256,
    documentFontSha256: DOCUMENT_FONT_CONTRACT.styles.regular, documentFontStyleSha256: DOCUMENT_FONT_CONTRACT.styles,
    pageCount: input.expectedPages, documentFontResolved: true, extractedTextSha256: input.expectedExtractedTextSha256,
    taggedPdf: true, metadataVerified: true, structureTreeSha256: "a".repeat(64), searchablePdf: pdf, searchablePdfSha256: hash(pdf),
    pageImages: [{ bytes: image, sha256: hash(image) }], draftPdf: { ...identity, searchablePdfSha256: hash(pdf),
      structureTextSha256: "b".repeat(64), linkXmlSha256: "c".repeat(64), paragraphCount: paragraphs.length,
      listItemCount: paragraphs.filter((row) => row.kind === "BULLET").length, linkCount: paragraphs.flatMap((row) => row.links).length } };
}
function fixture(mode: "SOURCE_CORRECTION" | "SOURCE_PRESERVING_RERENDER" = "SOURCE_CORRECTION") {
  const f = serviceRepairRenderFixture(mode), calls: { name: string; args: unknown; signal?: AbortSignal }[] = [], allocated: Buffer[] = [];
  let permission: unknown = true, inspect = () => structuredClone(f.inspection);
  const rpc = vi.fn((name: string, args: unknown) => {
    const call = { name, args, signal: undefined as AbortSignal | undefined };
    const query = { abortSignal: (value: AbortSignal) => { call.signal = value; return query; },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(() => {
        calls.push(call); if (call.signal?.aborted) throw new Error("ABORTED");
        expect(["ap_require_material_reviewer", "ap_inspect_service_repair"]).toContain(name);
        return { data: name === "ap_require_material_reviewer" ? permission : inspect(), error: null };
      }).then(resolve, reject) }; return query;
  });
  const admin = { rpc } as unknown as SupabaseClient<Database>, bytes = (value: Uint8Array | string) => { const b = Buffer.from(value); allocated.push(b); return b; };
  const evidence = f.evidence();
  mocks.draft.mockImplementation(async (_admin, input) => {
    expect(input.customerId).toBe(f.packet.expected.customerId); expect(input.jobId).toBe(f.original.draftJobId);
    if (input.payloadId === f.original.packetPayloadId) { expect(input.purpose).toBe("MATERIAL_DRAFT_PACKET"); expect(input.sha256).toBe(f.original.packetSha256); return bytes(evidence.originals[0].packetBytes); }
    expect(input.payloadId).toBe(f.original.sourcePayloadId); expect(input.purpose).toBe("MATERIAL_DRAFT_SOURCE"); expect(input.sha256).toBe(f.original.sourceSha256); return bytes(evidence.originals[0].sourceBytes);
  });
  mocks.repair.mockImplementation(async (_admin, input) => {
    expect(input).toMatchObject({ customerId: f.packet.expected.customerId, caseId: f.identity.caseId, repairVersionId: f.identity.versionId });
    if (input.purpose === "SERVICE_REPAIR_SOURCE") { expect(input.payloadId).toBe(f.inspection.version.encrypted_payload_id); expect(input.sha256).toBe(f.inspection.version.source_sha256); return bytes(evidence.envelopeBytes); }
    expect(input.purpose).toBe("SERVICE_REPAIR_CLAIM_REVIEW"); expect(input.payloadId).toBe(f.inspection.version.claim_review_encrypted_payload_id); return bytes("fictional review");
  });
  mocks.contact.mockImplementation(async (_admin, input) => { expect(input).toEqual({ customerId: f.packet.expected.customerId, payloadId: f.packet.binding.contactPayloadId, sha256: f.packet.binding.contactSha256 }); return bytes(f.document.input.contact.plaintext); });
  mocks.references.mockRejectedValue(new Error("unselected reference read"));
  const server = createServiceRepairRenderServer(admin, f.reviewerId, { now: () => repairFixtureNow });
  const originalIdentity = { caseId: f.identity.caseId, materialLineId: f.identity.materialLineId, versionId: f.identity.versionId };
  return { ...f, admin, server, calls, allocated, bytes, originalIdentity, rpc,
    setPermission: (value: unknown) => { permission = value; }, setInspect: (value: typeof inspect) => { inspect = value; },
    originals: (external = signal()) => loadServiceRepairOriginalEvidence(admin, f.reviewerId, originalIdentity, external, { now: () => repairFixtureNow }),
    load: () => server.port.loadEvidence(f.identity, f.inspection, signal()) };
}
beforeEach(() => vi.resetAllMocks()); afterEach(() => vi.useRealTimers());
describe("actual099 repair rendering adapter", () => {
  it("has no construction I/O and uses only exact reviewer/inspection RPCs with abort signals", async () => {
    const f = fixture(); expect(f.calls).toHaveLength(0); expect(mocks.draft).not.toHaveBeenCalled();
    const evidence = await f.load();
    const bound = bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...evidence }, repairFixtureNow);
    expect(bound.members[0].source.renderSourceSha256).toBe(f.source.renderSourceSha256);
    expect(f.calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
    expect(f.calls.filter((call) => call.name === "ap_inspect_service_repair").every((call) => JSON.stringify(call.args) === JSON.stringify({
      p_case_id: f.identity.caseId, p_material_line_id: f.identity.materialLineId, p_reviewer_id: f.reviewerId }))).toBe(true);
    evidence.envelopeBytes.fill(0); evidence.originals.forEach((row) => { row.packetBytes.fill(0); row.sourceBytes.fill(0); });
    expect(f.allocated.every((b) => b.every((v) => v === 0))).toBe(true);
  });
  it.each(["SOURCE_CORRECTION", "SOURCE_PRESERVING_RERENDER"] as const)("connects expired original %s through strict storage decode to only the accepted letter", async (mode) => {
    const f = fixture(mode), dispatch = vi.fn(async (input: DocumentRenderInput) => render(input));
    const result = await f.server.prepare(f.identity, { render: dispatch });
    expect(dispatch).toHaveBeenCalledOnce(); expect(result.members[0].artifactType).toBe("COVER_LETTER");
    expect(result.members[0].repairMode).toBe(mode); expect(result.deliveryAuthorized).toBe(false);
    expect(mocks.references).not.toHaveBeenCalled(); expect(f.allocated.every((b) => b.every((v) => v === 0))).toBe(true);
    result.members.forEach((member) => { member.buffer.fill(0); member.render.searchablePdf.fill(0); member.render.pageImages.forEach((page) => page.bytes.fill(0)); });
  });
  it("loads historical source before corrected payloads, review or lease exist but grants no opaque rendering member", async () => {
    const f = fixture(); Object.assign(f.inspection.version, { encrypted_payload_id: null, source_sha256: null, claim_review_encrypted_payload_id: null,
      claim_review_sha256: null, claim_review_metadata: null, claims_reviewed_by: null, claims_reviewed_at: null });
    Object.assign(f.inspection.job, { lease_owner: null, lease_token: null, lease_expires_at: null });
    const loaded = await f.originals(); expect(loaded.originals[0].source).toEqual(f.prior);
    expect(loaded.originals[0].packet.validUntil).toBe(f.packet.validUntil); expect(mocks.repair).not.toHaveBeenCalled();
    await expect(f.load()).rejects.toThrow("VERSION_STALE"); loaded.originals.forEach((row) => { row.packetBytes.fill(0); row.sourceBytes.fill(0); });
  });
  it.each([false, null, "true", {}])("requires literal reviewer true before private reads: %j", async (value) => {
    const f = fixture(); f.setPermission(value); await expect(f.originals()).rejects.toThrow("REVIEWER_UNCONFIRMED");
    expect(f.calls).toHaveLength(1); expect(mocks.draft).not.toHaveBeenCalled(); expect(mocks.repair).not.toHaveBeenCalled();
  });
  it.each(["version", "context", "lease", "review", "released"])("rejects changed %s before repair private reads", async (kind) => {
    const f = fixture();
    if (kind === "version") f.inspection.job.active_version_id = other;
    if (kind === "context") f.inspection.contextSha256 = "0".repeat(64);
    if (kind === "lease") f.inspection.job.lease_token = other;
    if (kind === "review") f.inspection.version.claims_reviewed_at = f.original.approvedAt;
    if (kind === "released") f.inspection.version.release_id = other;
    await expect(f.load()).rejects.toThrow(); expect(mocks.repair).not.toHaveBeenCalled(); expect(mocks.draft).not.toHaveBeenCalled();
  });
  it("rejects a stale displayed inspection before reading its envelope", async () => {
    const f = fixture(), displayed = structuredClone(f.inspection); displayed.job.lease_generation++;
    await expect(f.server.port.loadEvidence(f.identity, displayed, signal())).rejects.toThrow("INSPECTION_CHANGED"); expect(mocks.repair).not.toHaveBeenCalled();
  });
  it("clears all loaded bytes if original identity or current context changes during reads", async () => {
    const f = fixture(); let calls = 0;
    f.setInspect(() => { const copy = structuredClone(f.inspection); if (++calls > 1) copy.contextSha256 = "0".repeat(64); return copy; });
    await expect(f.originals()).rejects.toThrow(); expect(f.allocated).toHaveLength(2);
    expect(f.allocated.every((b) => b.every((v) => v === 0))).toBe(true);
  });
  it("rejects altered actual packet bytes and clears the failed private read", async () => {
    const f = fixture(), bad = f.bytes(f.evidence().originals[0].packetBytes); bad[8] ^= 1; mocks.draft.mockResolvedValueOnce(bad);
    await expect(f.originals()).rejects.toThrow("UNCONFIRMED"); expect(bad.every((v) => v === 0)).toBe(true);
  });
  it("rejects original revision ownership mismatches even when stored bytes are intact", async () => {
    const f = fixture(); f.inspection.originals[0].revisionId = other; f.inspection.version.originals[0].revisionId = other;
    await expect(f.originals()).rejects.toThrow("ORIGINAL_BINDING_CHANGED"); expect(f.allocated.every((b) => b.every((v) => v === 0))).toBe(true);
  });
  it("clears a late source payload after caller cancellation without reading or dispatching further", async () => {
    const f = fixture(), controller = new AbortController(); let finish!: (bytes: Buffer) => void;
    mocks.draft.mockImplementationOnce(() => new Promise<Buffer>((resolve) => { finish = resolve; }));
    const pending = f.originals(controller.signal), failed = expect(pending).rejects.toThrow("ABORTED");
    await vi.waitFor(() => expect(mocks.draft).toHaveBeenCalledOnce()); controller.abort(); await failed;
    const late = f.bytes(f.evidence().originals[0].packetBytes); finish(late);
    await vi.waitFor(() => expect(late.every((v) => v === 0)).toBe(true)); expect(mocks.contact).not.toHaveBeenCalled();
  });
  it("rejects a foreign reviewer or already-canceled call without database I/O", async () => {
    const f = fixture(); await expect(f.server.port.requireReviewer(other, signal())).rejects.toThrow("REVIEWER_MISMATCH");
    const controller = new AbortController(); controller.abort(); await expect(f.originals(controller.signal)).rejects.toThrow(); expect(f.calls).toHaveLength(0);
  });
  it("rechecks current099 context after original contact decryption and clears bytes on change", async () => {
    const f = fixture(), evidence = await f.load(), member = bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...evidence }, repairFixtureNow).members[0];
    const contact = f.bytes(f.document.input.contact.plaintext);
    mocks.contact.mockImplementationOnce(async () => { f.inspection.contextSha256 = "0".repeat(64); return contact; });
    await expect(f.server.port.loadContact(member, signal())).rejects.toThrow(); expect(contact.every((value) => value === 0)).toBe(true);
    evidence.envelopeBytes.fill(0); evidence.originals.forEach((row) => { row.packetBytes.fill(0); row.sourceBytes.fill(0); });
  });
  it("bounds a stalled database request without initiating any private read", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.rpc.mockImplementationOnce(() => {
      const query = { abortSignal: () => query, then: () => new Promise<never>(() => undefined) }; return query;
    });
    const pending = f.originals(), rejected = expect(pending).rejects.toThrow("ABORTED");
    await vi.advanceTimersByTimeAsync(20_001); await rejected; expect(mocks.draft).not.toHaveBeenCalled();
  });
});

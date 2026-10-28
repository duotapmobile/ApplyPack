// @vitest-environment node
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { createServiceRepairFiles } from "@/lib/documents/service-repair-file-server";
import { prepareServiceRepairRender } from "@/lib/documents/service-repair-render";
import type { DocumentRenderInput, DocumentRenderResult } from "@/lib/documents/renderer";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
import { matchesRepairFileResult, type RepairFileRequest } from "@/lib/materials/service-repair-file-client";
import { repairFixtureNow, serviceRepairRenderFixture } from "../fixtures/service-repair-render";
vi.mock("server-only", () => ({}));
const id = (n: number) => `5c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Rendered = Awaited<ReturnType<typeof prepareServiceRepairRender>>;
let actual: Rendered, preserving: Rendered;
function rendered(input: DocumentRenderInput): DocumentRenderResult {
  const pdf = Buffer.from("%PDF-fictional-registration-test"), image = Buffer.from("fictional-image"), { paragraphs, ...identity } = input.draftPdf!;
  return { rendererIdentity: "fixture-renderer-not-hosted-proof", documentFontFamily: DOCUMENT_FONT_CONTRACT.family,
    documentFontVersion: DOCUMENT_FONT_CONTRACT.version, documentFontManifestSha256: DOCUMENT_FONT_CONTRACT.manifestSha256,
    documentFontSha256: DOCUMENT_FONT_CONTRACT.styles.regular, documentFontStyleSha256: DOCUMENT_FONT_CONTRACT.styles,
    pageCount: input.expectedPages, documentFontResolved: true, extractedTextSha256: input.expectedExtractedTextSha256,
    taggedPdf: true, metadataVerified: true, structureTreeSha256: "a".repeat(64), searchablePdf: pdf, searchablePdfSha256: sha(pdf),
    pageImages: [{ bytes: image, sha256: sha(image) }], draftPdf: { ...identity, searchablePdfSha256: sha(pdf),
      structureTextSha256: "b".repeat(64), linkXmlSha256: "c".repeat(64), paragraphCount: paragraphs.length,
      listItemCount: paragraphs.filter(row => row.kind === "BULLET").length, linkCount: paragraphs.flatMap(row => row.links).length } };
}
async function realPackage(mode: "SOURCE_CORRECTION" | "SOURCE_PRESERVING_RERENDER") {
  const f = serviceRepairRenderFixture(mode);
  return prepareServiceRepairRender({ requireReviewer: async () => true, readCurrent: async () => structuredClone(f.inspection),
    loadEvidence: async () => f.evidence(), loadContact: async () => Buffer.from(f.document.input.contact.plaintext),
    loadReferences: async () => { throw new Error("Unselected references"); } }, f.reviewerId, f.identity,
  { now: () => repairFixtureNow, render: async input => rendered(input) });
}
beforeAll(async () => { actual = await realPackage("SOURCE_CORRECTION"); preserving = await realPackage("SOURCE_PRESERVING_RERENDER"); });
beforeEach(() => { vi.stubEnv("APP_MATERIAL_DRAFT_RENDERING_ENABLED", "true"); });
function copied(value: Rendered): Rendered {
  const detached = structuredClone(value);
  return { ...detached, members: detached.members.map(member => ({ ...member, buffer: Buffer.from(member.buffer),
    render: { ...member.render, searchablePdf: Buffer.from(member.render.searchablePdf), pageImages: member.render.pageImages.map(page => ({ ...page, bytes: Buffer.from(page.bytes) })) } })) };
}
function fixture(mode: "SOURCE_CORRECTION" | "SOURCE_PRESERVING_RERENDER" = "SOURCE_CORRECTION") {
  const f = serviceRepairRenderFixture(mode), inspection = structuredClone(f.inspection);
  inspection.job.lease_expires_at = new Date(repairFixtureNow.getTime() - 1000).toISOString();
  const expected = { caseId: f.identity.caseId, materialLineId: f.identity.materialLineId, versionId: f.identity.versionId,
    sourceSha256: f.serialized.sourceSha256, reviewSha256: inspection.version.claim_review_sha256!,
    acceptedScopeSha256: inspection.scope.acceptedScopeSha256, contextSha256: inspection.contextSha256,
    members: [{ originalFileVersionId: f.original.fileVersionId, artifactType: f.original.artifactType,
      originalSourceSha256: f.original.sourceSha256, packetSha256: f.original.packetSha256, renderSourceSha256: f.source.renderSourceSha256 }] };
  const request: RepairFileRequest = { requestId: id(20), expected }, events: string[] = [], queries: Array<{ name: string; args: unknown; signal?: AbortSignal }> = [];
  let reviewer: unknown = true, files: Array<Record<string, unknown>> = [], intents: Array<Record<string, unknown>> = [];
  let lostRegistration = false, wrongRegistrationReply = false, failIntents = false, malformedClaim = false, hangIntents = false;
  const originalFile = { id: f.original.fileVersionId, artifact_id: f.original.artifactId, checksum_sha256: f.original.checksumSha256,
    binding_sha256: f.original.bindingSha256, mime_type: "application/pdf" };
  const originalArtifact = { id: f.original.artifactId, customer_id: inspection.scope.customerId, material_line_id: f.original.materialLineId,
    job_snapshot_id: f.packet.binding.jobSnapshotId, claim_provenance: { postingContentSha256: f.packet.binding.jobSha256,
      jobBinding: actual.members[0].provenance.jobBinding, deliveryFormatDecision: { format: "PDF", reason: "DEFAULT_PDF",
      employerRuleId: f.packet.binding.ruleId, applicantRequestId: null, requestReferenceSha256: null } } };
  type Query = { name: string; args: unknown; select?: string; signal?: AbortSignal; upsert?: unknown };
  async function execute(q: Query) {
    queries.push(q); events.push(q.name);
    if (q.name === "ap_require_material_reviewer") return { data: reviewer, error: null };
    if (q.name === "ap_inspect_service_repair") return { data: structuredClone(inspection), error: null };
    if (q.name === "ap_service_repair_versions") return { data: structuredClone(inspection.version), error: null };
    if (q.name === "ap_claim_service_repair") {
      const args = q.args as { p_version_id: string; p_owner: string };
      inspection.job.lease_owner = args.p_owner; inspection.job.lease_token = id(21); inspection.job.lease_generation++;
      inspection.job.lease_expires_at = new Date(repairFixtureNow.getTime() + 300_000).toISOString();
      return { data: malformedClaim ? { ...inspection.job, customer_id: id(98) } : structuredClone(inspection.job), error: null };
    }
    if (q.name === "ap_generated_file_versions") return { data: structuredClone(originalFile), error: null };
    if (q.name === "ap_generated_artifacts") return { data: structuredClone(originalArtifact), error: null };
    if (q.name === "storage_cleanup_queue") {
      if (q.upsert) { if (hangIntents) return new Promise<never>(() => undefined);
        if (failIntents) return { data: null, error: { message: "private error" } }; intents = structuredClone(q.upsert) as Array<Record<string, unknown>>; return { data: null, error: null }; }
      return { data: intents.slice(0, 1).map(row => ({ storage_path: row.storage_path })), error: null };
    }
    if (q.name === "ap_service_repair_files") return { data: structuredClone(files), error: null };
    if (q.name === "ap_register_service_repair_files") {
      const args = q.args as { p_registrations: Array<{ originalFileVersionId: string; registration: Record<string, unknown> }> };
      files = args.p_registrations.map(entry => {
        const r = entry.registration, p = r.p_claim_provenance as { draftPair: { sourceSha256: string }; editableSource: { checksumSha256: string } };
        return { id: r.p_file_version_id, repair_version_id: f.identity.versionId, customer_id: inspection.scope.customerId,
          material_line_id: f.original.materialLineId, artifact_id: f.original.artifactId, original_file_version_id: entry.originalFileVersionId,
          source_snapshot_id: f.original.sourceSnapshotId, artifact_type: r.p_artifact_type, checksum_sha256: r.p_checksum_sha256,
          render_source_sha256: p.draftPair.sourceSha256, preview_sha256: r.p_render_preview_sha256, editable_sha256: p.editableSource.checksumSha256,
          registration: structuredClone(r) };
      });
      inspection.version.member_set_sha256 = "f".repeat(64);
      return { data: wrongRegistrationReply ? "0".repeat(64) : "f".repeat(64), error: lostRegistration ? { message: "lost reply" } : null };
    }
    throw new Error(`Unexpected query ${q.name}`);
  }
  function query(name: string, args: unknown) {
    const q: Query = { name, args }, chain = {
      select(value: string) { q.select = value; return chain; }, eq() { return chain; }, order() { return chain; }, limit() { return chain; }, like() { return chain; },
      abortSignal(signal: AbortSignal) { q.signal = signal; return chain; }, single() { return chain; },
      upsert(value: unknown) { q.upsert = value; return chain; }, then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return execute(q).then(resolve, reject); },
    }; return chain;
  }
  const admin = { rpc: (name: string, args: unknown) => query(name, args), from: (name: string) => query(name, null) } as unknown as SupabaseClient<Database>;
  const outputs: Rendered[] = [], prepare = vi.fn(async () => { events.push("prepare"); const output = copied(mode === "SOURCE_CORRECTION" ? actual : preserving); outputs.push(output); return output; });
  const ready = vi.fn(async () => true);
  const upload = vi.fn(async (bucket: string, path: string, bytes: Uint8Array) => {
    events.push("upload"); expect(bytes.length).toBeGreaterThan(0); expect(intents).toHaveLength(3); return { data: { path, id: id(30), fullPath: `${bucket}/${path}` }, error: null };
  });
  const uploadClientFactory = vi.fn((signal: AbortSignal) => ({ storage: { from: (bucket: string) => ({ upload: async (path: string, bytes: Uint8Array, opts: unknown) => {
    expect(opts).toEqual({ contentType: bucket === "operator-drafts" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : originalFile.mime_type, cacheControl: "0", upsert: false });
    expect(signal.aborted).toBe(false); return upload(bucket, path, bytes);
  } }) } }) as unknown as SupabaseClient<Database>);
  const server = createServiceRepairFiles(admin, f.reviewerId, { now: () => repairFixtureNow, ready, prepare, uploadClientFactory });
  return { f, inspection, request, server, events, queries, originalFile, originalArtifact, ready, prepare, upload, outputs, uploadClientFactory,
    setReviewer(value: unknown) { reviewer = value; }, loseReply() { lostRegistration = true; }, wrongReply() { wrongRegistrationReply = true; },
    failIntents() { failIntents = true; }, malformedClaim() { malformedClaim = true; }, files: () => files, intents: () => intents,
    hangIntents() { hangIntents = true; },
    run: (signal = new AbortController().signal) => server.render(request, signal) };
}

describe("typed099 owner repair file registration", () => {
  it("loads current metadata through the actual strict inspection validator without private rendering", async () => {
    const f = fixture(), { caseId, materialLineId, versionId } = f.f.identity;
    expect(await f.server.inspect({ caseId, materialLineId, versionId }, new AbortController().signal)).toMatchObject({ status: "READY", expected: f.request.expected });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.events).not.toContain("ap_claim_service_repair");
    f.inspection.version.claim_review_sha256 = null;
    expect(await f.server.inspect({ caseId, materialLineId, versionId }, new AbortController().signal)).toMatchObject({ status: "WORDING_REQUIRED", expected: null });
  });
  it.each(["SOURCE_CORRECTION", "SOURCE_PRESERVING_RERENDER"] as const)("registers only the accepted member with exact %s source and separate envelope hashes", async mode => {
    const f = fixture(mode), result = await f.run(); expect(result.status).toBe("REVIEW_READY"); expect(matchesRepairFileResult(result, f.request)).toBe(true);
    expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.upload).toHaveBeenCalledTimes(3);
    const registration = f.files()[0].registration as Record<string, unknown>, provenance = registration.p_claim_provenance as Record<string, unknown>;
    expect(registration).toMatchObject({ p_artifact_type: "COVER_LETTER", p_artifact_id: f.f.original.artifactId,
      p_source_line_revision_id: f.f.original.revisionId, p_source_snapshot_id: f.f.original.sourceSnapshotId, p_mime_type: "application/pdf" });
    expect(provenance.draftPair).toEqual({ versionId: f.f.identity.versionId, packetSha256: f.f.original.packetSha256,
      sourceSha256: f.f.source.renderSourceSha256, claimReviewSha256: f.request.expected.reviewSha256 });
    expect(provenance.serviceRepair).toMatchObject({ repairSourceSha256: f.f.serialized.sourceSha256, originalSourceSha256: f.f.original.sourceSha256 });
    expect(f.intents().every(row => row.reason === "material_sensitive_upload_intent" && Date.parse(String(row.not_before)) === repairFixtureNow.getTime() + 3_600_000)).toBe(true);
    expect(f.events.indexOf("storage_cleanup_queue")).toBeLessThan(f.events.indexOf("upload"));
    expect(f.queries.every(query => query.signal instanceof AbortSignal)).toBe(true);
    expect(f.outputs[0].members[0].buffer.every(byte => byte === 0)).toBe(true); expect(f.outputs[0].members[0].render.searchablePdf.every(byte => byte === 0)).toBe(true);
    expect(f.events).not.toContain("ap_approve_service_repair"); expect(f.events).not.toContain("ap_send_service_repair");
  });
  it("reports a live authoring lease without claiming, loading or rendering", async () => {
    const f = fixture(); f.inspection.job.lease_expires_at = new Date(repairFixtureNow.getTime() + 50_000).toISOString();
    const result = await f.run(); expect(result).toMatchObject({ status: "BUSY", retryAllowed: true, busyUntil: f.inspection.job.lease_expires_at });
    expect(f.events).not.toContain("ap_claim_service_repair"); expect(f.prepare).not.toHaveBeenCalled();
  });
  it("does not reacquire even an expired lease belonging to the same uncertain request", async () => {
    const f = fixture(); f.inspection.job.lease_owner = f.request.requestId;
    expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN", retryAllowed: false }); expect(f.prepare).not.toHaveBeenCalled();
  });
  it("stays disabled before claiming when the runtime or renderer approval is unavailable", async () => {
    const f = fixture(); vi.stubEnv("APP_MATERIAL_DRAFT_RENDERING_ENABLED", "false");
    expect(await f.run()).toMatchObject({ status: "DISABLED", retryAllowed: true }); expect(f.ready).not.toHaveBeenCalled();
    vi.stubEnv("APP_MATERIAL_DRAFT_RENDERING_ENABLED", "true"); f.ready.mockResolvedValue(false);
    expect(await f.run()).toMatchObject({ status: "DISABLED" }); expect(f.events).not.toContain("ap_claim_service_repair");
  });
  it.each([false, null, {}, "true"])("rejects malformed reviewer authority %j before private reads", async value => {
    const f = fixture(); f.setReviewer(value); expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN" });
    expect(f.events).not.toContain("ap_inspect_service_repair"); expect(f.prepare).not.toHaveBeenCalled();
  });
  it("CHECK is read-only and absence never grants retry", async () => {
    const f = fixture(), result = await f.server.check(f.request, new AbortController().signal);
    expect(result).toMatchObject({ status: "ABSENT", retryAllowed: false }); expect(f.events).not.toContain("ap_claim_service_repair"); expect(f.ready).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });
  it.each(["source", "review", "scope", "context", "member"])("rejects changed expected %s without dispatch", async kind => {
    const f = fixture(); if (kind === "source") f.request.expected.sourceSha256 = "0".repeat(64);
    if (kind === "review") f.request.expected.reviewSha256 = "0".repeat(64);
    if (kind === "scope") f.request.expected.acceptedScopeSha256 = "0".repeat(64);
    if (kind === "context") f.request.expected.contextSha256 = "0".repeat(64);
    if (kind === "member") f.request.expected.members[0].originalFileVersionId = id(90);
    expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN" }); expect(f.prepare).not.toHaveBeenCalled();
  });
  it("rejects malformed claim ownership before rendering", async () => {
    const f = fixture(); f.malformedClaim(); expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN" }); expect(f.prepare).not.toHaveBeenCalled();
  });
  it("rejects original format or checksum identity changes before claiming", async () => {
    const f = fixture(); f.originalFile.checksum_sha256 = "0".repeat(64); expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN" });
    expect(f.events).not.toContain("ap_claim_service_repair");
  });
  it("rejects mismatched original job provenance before upload instead of marking a nonempty URL as bound", async () => {
    const f = fixture(); f.originalArtifact.claim_provenance.postingContentSha256 = "0".repeat(64);
    expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN" }); expect(f.upload).not.toHaveBeenCalled();
    expect(f.outputs[0].members[0].buffer.every(byte => byte === 0)).toBe(true);
  });
  it("fails before upload if durable private cleanup intents cannot be saved", async () => {
    const f = fixture(); f.failIntents(); expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN" });
    expect(f.upload).not.toHaveBeenCalled(); expect(f.events).not.toContain("ap_register_service_repair_files"); expect(f.outputs[0].members[0].buffer.every(byte => byte === 0)).toBe(true);
  });
  it("rejects an echoed path-only storage success and leaves intents for guarded cleanup", async () => {
    const f = fixture(); f.upload.mockImplementation(async (_bucket, path) => ({ data: { path } as { path: string; id: string; fullPath: string }, error: null }));
    expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN" }); expect(f.intents()).toHaveLength(3); expect(f.events).not.toContain("ap_register_service_repair_files");
  });
  it("rechecks changed context after upload before registration", async () => {
    const f = fixture(); f.upload.mockImplementation(async (bucket, path) => { f.inspection.contextSha256 = "0".repeat(64); return { data: { path, id: id(30), fullPath: `${bucket}/${path}` }, error: null }; });
    expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN" }); expect(f.events).not.toContain("ap_register_service_repair_files");
  });
  it("resolves a lost registration reply once and reconciles future checks without render or register", async () => {
    const f = fixture(); f.loseReply(); const first = await f.run(); expect(first.status).toBe("REVIEW_READY");
    const second = await f.server.check(f.request, new AbortController().signal); expect(second).toEqual(first);
    expect(await f.run()).toEqual(first); expect(f.prepare).toHaveBeenCalledTimes(1); expect(f.events.filter(name => name === "ap_register_service_repair_files")).toHaveLength(1);
    const other = structuredClone(f.request); other.requestId = id(91);
    await expect(f.server.check(other, new AbortController().signal)).rejects.toThrow();
  });
  it("does not report success from a contradictory commit acknowledgement", async () => {
    const f = fixture(); f.wrongReply(); expect(await f.run()).toMatchObject({ status: "RESULT_UNKNOWN" });
    expect(await f.server.check(f.request, new AbortController().signal)).toMatchObject({ status: "REVIEW_READY" });
  });
  it("reconciles an exact immutable registration after a later Send without authorizing another render", async () => {
    const f = fixture(); const first = await f.run(); expect(first.status).toBe("REVIEW_READY");
    f.inspection.version.release_id = id(95); f.inspection.version.invalidated_at = repairFixtureNow.toISOString();
    f.inspection.job.active_version_id = id(96);
    expect(await f.server.check(f.request, new AbortController().signal)).toEqual(first);
    expect(await f.run()).toEqual(first); expect(f.prepare).toHaveBeenCalledTimes(1);
  });
  it("clears rendered private buffers and never registers a late aborted upload", async () => {
    const f = fixture(), controller = new AbortController(); let complete!: () => void;
    f.upload.mockImplementation((bucket, path) => new Promise(resolve => { complete = () => resolve({ data: { path, id: id(30), fullPath: `${bucket}/${path}` }, error: null }); }));
    const pending = f.run(controller.signal); await vi.waitFor(() => expect(f.upload).toHaveBeenCalledTimes(3)); controller.abort();
    expect(await pending).toMatchObject({ status: "RESULT_UNKNOWN" }); complete();
    await vi.waitFor(() => expect(f.outputs[0].members[0].buffer.every(byte => byte === 0)).toBe(true)); expect(f.events).not.toContain("ap_register_service_repair_files");
  });
  it("clears output immediately when an aborted database intent write never settles", async () => {
    const f = fixture(), controller = new AbortController(); f.hangIntents();
    const pending = f.run(controller.signal); await vi.waitFor(() => expect(f.queries.some(query => query.name === "storage_cleanup_queue" && "upsert" in query)).toBe(true));
    controller.abort(); expect(await pending).toMatchObject({ status: "RESULT_UNKNOWN" });
    expect(f.outputs[0].members[0].buffer.every(byte => byte === 0)).toBe(true);
    expect(f.outputs[0].members[0].render.searchablePdf.every(byte => byte === 0)).toBe(true); expect(f.upload).not.toHaveBeenCalled();
  });
});

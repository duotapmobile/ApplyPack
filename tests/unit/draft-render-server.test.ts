import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { readStoredDraftRenderSource } from "@/lib/documents/draft-render-source-storage";
import { prepareDraftClaimReview } from "@/lib/documents/draft-claim-review";
import { prepareDraftRender } from "@/lib/documents/draft-render";
import { renderDraftForClaim, type DraftRenderRegistration, type DraftRenderState } from "@/lib/documents/draft-render-worker";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
import type { DocumentRenderInput, DocumentRenderResult } from "@/lib/documents/renderer";
vi.mock("server-only", () => ({}));
const dependency = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), contact: vi.fn(), ready: vi.fn() }));
vi.mock("@/lib/documents/draft-packet-worker", () => ({ readEncryptedDraftPayload: dependency.read }));
vi.mock("@/lib/documents/drafting-evidence-server", () => ({ loadDraftingEvidencePacket: dependency.load }));
vi.mock("@/lib/documents/draft-owner-contact", () => ({ readConfirmedDraftContact: dependency.contact }));
vi.mock("@/lib/operations/renderer-readiness", () => ({ checkDocumentRendererReadiness: dependency.ready }));
import { createDraftRenderServer } from "@/lib/documents/draft-render-server";
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const signal = () => new AbortController().signal;
type Row = Record<string, unknown>;
type Receipt = { data: unknown; error: unknown };
type Call = { name: string; kind: "table" | "rpc"; columns?: string; args?: Row; filters: Array<[string, unknown]>; signal?: AbortSignal; upsert?: Row[] };
// Real source, review, DOCX and registration serialization; database, encryption
// and rendering boundaries are doubles. Actual SQL and PDF proof run separately.
function rendered(input: DocumentRenderInput): DocumentRenderResult {
  const searchablePdf = Buffer.from("%PDF-fictional"), image = Buffer.from("fictional-image"), { paragraphs, ...identity } = input.draftPdf!;
  return { rendererIdentity: "fixture-renderer", documentFontFamily: DOCUMENT_FONT_CONTRACT.family, documentFontVersion: DOCUMENT_FONT_CONTRACT.version,
    documentFontManifestSha256: DOCUMENT_FONT_CONTRACT.manifestSha256, documentFontSha256: DOCUMENT_FONT_CONTRACT.styles.regular, documentFontStyleSha256: DOCUMENT_FONT_CONTRACT.styles,
    pageCount: input.expectedPages, documentFontResolved: true, extractedTextSha256: input.expectedExtractedTextSha256, taggedPdf: true, metadataVerified: true,
    structureTreeSha256: "a".repeat(64), searchablePdf, searchablePdfSha256: digest(searchablePdf), pageImages: [{ bytes: image, sha256: digest(image) }],
    draftPdf: { ...identity, searchablePdfSha256: digest(searchablePdf), structureTextSha256: "b".repeat(64), linkXmlSha256: "c".repeat(64), paragraphCount: paragraphs.length,
      listItemCount: paragraphs.filter((row) => row.kind === "BULLET").length, linkCount: paragraphs.flatMap((row) => row.links).length } };
}
function database() {
  const base = draftDocumentFixture(), packet = base.input.packet, built = base.build(), body = serializeDraftRenderSource(built);
  const source = readStoredDraftRenderSource({ body, value: JSON.parse(body) }, built.renderSourceSha256, packet, () => draftFixtureNow);
  const claim = { jobId: id(1), ownerId: id(2), leaseToken: id(3) }, versionId = id(4), reviewerId = id(8);
  const review = prepareDraftClaimReview({ source, reviewerId, binding: { ...source.expected, versionId, packetSha256: packet.packetSha256, sourceSha256: source.renderSourceSha256 },
    request: { versionId, packetSha256: packet.packetSha256, sourceSha256: source.renderSourceSha256,
      claims: source.ownerReviewClaims.map((entry) => ({ claimId: entry.claimId, wordingSha256: entry.wordingSha256, decision: "APPROVED" })) } }, draftFixtureNow);
  const job: Row = { id: claim.jobId, customer_id: packet.expected.customerId, material_line_id: packet.expected.materialLineId, line_revision_id: packet.expected.revisionId,
    source_snapshot_id: packet.binding.snapshotId, state: "SOURCE_READY", active_version_id: versionId, lease_owner: claim.ownerId, lease_token: claim.leaseToken,
    lease_generation: 1, lease_expires_at: new Date(draftFixtureNow.getTime() + 300_000).toISOString() };
  const version: Row = { id: versionId, job_id: claim.jobId, customer_id: job.customer_id, material_line_id: job.material_line_id,
    packet_encrypted_payload_id: id(5), packet_sha256: packet.packetSha256, context_sha256: "d".repeat(64), encrypted_payload_id: id(6), source_sha256: source.renderSourceSha256,
    invalidated_at: null, member_set_sha256: null, claim_review_encrypted_payload_id: id(7), claim_review_sha256: review.reviewSha256,
    claim_review_metadata: review.metadata, claims_reviewed_by: reviewerId, claims_reviewed_at: draftFixtureNow.toISOString() };
  const configuration: Row = { singleton: true, material_output_formats: ["PDF", "DOCX"], document_renderer_identity: "fixture-renderer" };
  const tables: Record<string, Row[]> = { ap_material_draft_jobs: [job], ap_material_draft_versions: [version], ap_material_line_revisions: [base.r.revision],
    ap_material_lines: [base.r.line], ap_employer_submission_rules: [base.r.rule], ap_commerce_configuration: [configuration], ap_applicant_document_format_requests: [],
    ap_generated_artifacts: [], ap_generated_file_versions: [], ap_artifact_quality_reviews: [], ap_material_draft_members: [], storage_cleanup_queue: [] };
  const bodies = new Map([[id(5), serializeDraftingEvidencePacket(packet)], [id(6), serializeDraftRenderSource(source)], [id(7), review.body]]);
  const calls: Call[] = [], buffers: Buffer[] = [], uploads: Row[] = [], overrides = new Map<string, Array<(call: Call) => Receipt | Promise<Receipt>>>();
  let currentContext = version.context_sha256, lostCommit = false, uploadAck = true, uploadWait: Promise<void> | undefined;
  let finishUpload: () => void = () => undefined;
  function registered(args: Row) {
    const registrations = args.p_registrations as DraftRenderRegistration[];
    for (const r of registrations) {
      const provenance = r.p_claim_provenance as Row, editable = provenance.editableSource as Row;
      tables.ap_material_draft_members.push({ customer_id: job.customer_id, material_line_id: job.material_line_id, draft_version_id: versionId, artifact_type: r.p_artifact_type,
        artifact_id: r.p_artifact_id, file_version_id: r.p_file_version_id, file_sha256: r.p_checksum_sha256, preview_sha256: r.p_render_preview_sha256,
        source_sha256: version.source_sha256, editable_source_sha256: editable.checksumSha256,
        editable_source_path_sha256: digest(`[${JSON.stringify(editable.storageBucket)}, ${JSON.stringify(editable.storagePath)}]`) });
      const artifact = { id: r.p_artifact_id, customer_id: job.customer_id, material_line_id: job.material_line_id, source_line_revision_id: r.p_source_line_revision_id,
        source_snapshot_id: r.p_source_snapshot_id, job_snapshot_id: r.p_job_snapshot_id, artifact_type: r.p_artifact_type, generator_version: r.p_generator_version,
        claim_provenance: r.p_claim_provenance, current_file_version: 1 };
      tables.ap_generated_artifacts = tables.ap_generated_artifacts.filter((row) => row.id !== artifact.id).concat(artifact);
      tables.ap_generated_file_versions.push({ id: r.p_file_version_id, artifact_id: r.p_artifact_id, version: 1, checksum_sha256: r.p_checksum_sha256,
        storage_bucket: r.p_storage_bucket, storage_path: r.p_storage_path, safe_filename: r.p_safe_filename, mime_type: r.p_mime_type, size_bytes: r.p_size_bytes,
        package_qa_sha256: r.p_package_qa_sha256, binding_sha256: r.p_binding_sha256, superseded_at: null, downloads_revoked_at: null });
      tables.ap_artifact_quality_reviews.push({ file_version_id: r.p_file_version_id, automated_passed_at: draftFixtureNow.toISOString(), invalidated_at: null,
        render_preview_bucket: r.p_render_preview_bucket, render_preview_path: r.p_render_preview_path, render_preview_sha256: r.p_render_preview_sha256,
        extracted_text_sha256: r.p_extracted_text_sha256, structural_checks: r.p_structural_checks, provenance_checks: r.p_provenance_checks });
    }
    job.state = "REVIEW_READY"; version.member_set_sha256 = "f".repeat(64);
    if (lostCommit) throw new Error("PRIVATE_LOST_RESPONSE");
    return { data: { draftVersionId: versionId, memberSetSha256: version.member_set_sha256 }, error: null };
  }
  function rpc(call: Call): Receipt {
    if (call.name === "ap_require_material_reviewer") return { data: true, error: null };
    if (call.name === "ap_material_draft_context_sha256") return { data: currentContext, error: null };
    if (call.name === "ap_renew_material_draft_lease") return { data: job.lease_expires_at, error: null };
    if (call.name === "ap_commit_material_draft_pair") return registered(call.args!);
    throw new Error(`Unexpected fictional RPC: ${call.name}`);
  }
  function queryFor(call: Call) {
    calls.push(call);
    async function run(single = false): Promise<Receipt> {
      const override = overrides.get(call.name)?.shift(); if (override) return override(call);
      if (call.kind === "rpc") return rpc(call);
      if (call.upsert) { tables[call.name].push(...structuredClone(call.upsert)); return { data: null, error: null }; }
      const rows = tables[call.name].filter((row) => call.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
      const projected = rows.map((row) => Object.fromEntries(call.columns!.split(",").map((key) => [key, row[key]])));
      return { data: structuredClone(single ? projected[0] ?? null : projected), error: single && projected.length > 1 ? { code: "MULTIPLE_ROWS" } : null };
    }
    const query = { select: (columns: string) => { call.columns = columns; return query; }, eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      in: (key: string, value: unknown[]) => { call.filters.push([key, value]); return query; }, abortSignal: (value: AbortSignal) => { call.signal = value; return query; },
      single: () => run(true), maybeSingle: () => run(true), upsert: (value: Row[]) => { call.upsert = value; return query; },
      then: (resolve: (value: Receipt) => unknown, reject?: (error: unknown) => unknown) => run().then(resolve, reject) };
    return query;
  }
  const admin = { from: (name: string) => queryFor({ name, kind: "table", filters: [] }), rpc: (name: string, args: Row) => queryFor({ name, args, kind: "rpc", filters: [] }),
    storage: { from: (bucket: string) => ({ upload: async (path: string, bytes: Buffer, options: Row) => {
      expect(tables.storage_cleanup_queue.some((row) => row.bucket === bucket && row.storage_path === path)).toBe(true);
      uploads.push({ bucket, path, bytesSha256: digest(bytes), ...options }); if (uploadWait) await uploadWait;
      return { data: uploadAck ? { path, id: id(90), fullPath: `${bucket}/${path}` } : { path }, error: null };
    } }) } } as unknown as SupabaseClient<Database>;
  dependency.ready.mockResolvedValue(true); dependency.load.mockImplementation(async () => structuredClone(packet));
  dependency.read.mockImplementation(async (_admin, binding: { payloadId: string }) => { const bytes = Buffer.from(bodies.get(binding.payloadId)!); buffers.push(bytes); return bytes; });
  dependency.contact.mockImplementation(async () => { const bytes = Buffer.from(base.input.contact.plaintext); buffers.push(bytes); return bytes; });
  const uploadSignals: AbortSignal[] = [];
  const services = createDraftRenderServer(admin, { now: () => draftFixtureNow, uploadClientFactory: (child) => { uploadSignals.push(child); return admin; } });
  services.render = async (input) => prepareDraftRender(input, { now: () => draftFixtureNow, render: async (value) => rendered(value) });
  const state = async () => await services.readState(claim, signal()) as DraftRenderState;
  return { base, packet, source, claim, job, version, configuration, tables, bodies, calls, buffers, uploads, uploadSignals, overrides, services, state,
    context: (value: string) => { currentContext = value; }, loseCommit: () => { lostCommit = true; }, malformedUpload: () => { uploadAck = false; },
    delayUpload: () => { uploadWait = new Promise<void>((resolve) => { finishUpload = resolve; }); }, finishUpload: () => finishUpload(),
    run: () => renderDraftForClaim(services, claim, { enabled: true, now: () => draftFixtureNow }) };
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("APP_MATERIAL_DRAFT_RENDERING_ENABLED", "true"); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("actual reviewed rendering database/storage ports", () => {
  it("constructs without I/O and remains disabled by default", async () => {
    vi.stubEnv("APP_MATERIAL_DRAFT_RENDERING_ENABLED", ""); const f = database(); expect(f.calls).toEqual([]);
    expect(await f.run()).toEqual({ status: "DISABLED" }); expect(f.calls).toEqual([]);
  });
  it("registers and independently reads back the actual pair, without approval or send", async () => {
    const f = database(); await f.services.loadEvidence(await f.state(), signal()); f.buffers.length = 0;
    expect(await f.run()).toMatchObject({ status: "REVIEW_READY", ownerReviewRequired: true, deliveryAuthorized: false });
    expect(f.uploads).toHaveLength(6); expect(f.tables.storage_cleanup_queue).toHaveLength(6);
    expect(f.uploads.every((row) => row.upsert === false && row.cacheControl === "0")).toBe(true);
    expect(f.uploadSignals).toHaveLength(6); expect(f.uploadSignals.every((child) => child.aborted)).toBe(true);
    const commits = f.calls.filter((call) => call.name === "ap_commit_material_draft_pair"); expect(commits).toHaveLength(1);
    expect(commits[0].args).toMatchObject({ p_job_id: f.claim.jobId, p_lease_token: f.claim.leaseToken, p_source_sha256: f.source.renderSourceSha256 });
    expect(f.calls.every((call) => call.signal && call.columns !== "*")).toBe(true);
    expect(f.calls.some((call) => /approve|send|delete/i.test(call.name))).toBe(false);
    expect(f.buffers).toHaveLength(4); expect(f.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it.each(["wrong owner", "lease expired", "review missing", "wrong source", "context changed", "false reviewer", "readiness"])("rejects %s before private reads", async (mode) => {
    const f = database(); if (mode === "wrong owner") f.job.lease_owner = id(99); if (mode === "lease expired") f.job.lease_expires_at = draftFixtureNow.toISOString();
    if (mode === "review missing") f.version.claim_review_encrypted_payload_id = null; if (mode === "wrong source") f.job.source_snapshot_id = id(99);
    if (mode === "context changed") f.context("0".repeat(64)); if (mode === "false reviewer") f.overrides.set("ap_require_material_reviewer", [() => ({ data: false, error: null })]);
    if (mode === "readiness") dependency.ready.mockResolvedValue(false);
    expect(await f.run()).toMatchObject({ status: "HELD" }); expect(dependency.read).not.toHaveBeenCalled(); expect(f.uploads).toEqual([]);
  });
  it("preserves arbitrary historical artifact IDs and rejects new aliases appearing after state read", async () => {
    const f = database(), old = { id: id(80), customer_id: f.job.customer_id, material_line_id: f.job.material_line_id, source_line_revision_id: f.job.line_revision_id,
      source_snapshot_id: f.job.source_snapshot_id, job_snapshot_id: f.packet.binding.jobSnapshotId, artifact_type: "RESUME" };
    f.tables.ap_generated_artifacts.push(old); const state = await f.state(); expect(state.existingArtifactIds.RESUME).toBe(id(80));
    f.tables.ap_generated_artifacts.push({ ...old, id: id(81), artifact_type: "COVER_LETTER" });
    await expect(f.services.recheck(state, signal())).rejects.toThrow(); expect(f.uploads).toEqual([]);
  });
  it.each(["duplicate", "wrong customer", "wrong snapshot"])("rejects %s in the existing artifact binding", async (mode) => {
    const f = database(), row = { id: id(80), customer_id: f.job.customer_id, material_line_id: f.job.material_line_id, source_line_revision_id: f.job.line_revision_id,
      source_snapshot_id: f.job.source_snapshot_id, job_snapshot_id: f.packet.binding.jobSnapshotId, artifact_type: "RESUME" };
    if (mode === "wrong customer") row.customer_id = id(99); if (mode === "wrong snapshot") row.source_snapshot_id = id(99);
    f.tables.ap_generated_artifacts.push(row); if (mode === "duplicate") f.tables.ap_generated_artifacts.push({ ...row, id: id(81) });
    await expect(f.state()).rejects.toThrow(); expect(dependency.read).not.toHaveBeenCalled();
  });
  it.each(["packet bytes", "source bytes", "review metadata", "contact text", "context after decrypt"])("rejects %s and clears all owned decrypted buffers", async (mode) => {
    const f = database(), state = await f.state();
    if (mode === "packet bytes") f.bodies.set(state.packetPayloadId, f.bodies.get(state.packetPayloadId)! + " ");
    if (mode === "source bytes") f.bodies.set(state.sourcePayloadId, f.bodies.get(state.sourcePayloadId)! + " ");
    if (mode === "review metadata") f.version.claim_review_metadata = [];
    if (mode === "contact text") dependency.contact.mockImplementation(async () => { const contact = JSON.parse(f.base.input.contact.plaintext.toString()); contact.displayName = "Different person"; const bytes = Buffer.from(JSON.stringify(contact)); f.buffers.push(bytes); return bytes; });
    if (mode === "context after decrypt") dependency.contact.mockImplementation(async () => { f.context("0".repeat(64)); const bytes = Buffer.from(f.base.input.contact.plaintext); f.buffers.push(bytes); return bytes; });
    await expect(f.services.loadEvidence(state, signal())).rejects.toThrow(); expect(f.buffers.length).toBeGreaterThan(0);
    expect(f.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it("clears a decrypted payload arriving after an aborted operation", async () => {
    const f = database(), state = await f.state(), controller = new AbortController(); let finish: (bytes: Buffer) => void = () => undefined;
    dependency.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = f.services.loadEvidence(state, controller.signal); await vi.waitFor(() => expect(dependency.read).toHaveBeenCalled()); controller.abort();
    await expect(pending).rejects.toThrow(); const bytes = Buffer.from(f.bodies.get(state.packetPayloadId)!); finish(bytes);
    await vi.waitFor(() => expect(bytes.every((byte) => byte === 0)).toBe(true)); expect(f.uploads).toEqual([]);
  });
  it("will not invent an employer DOCX requirement from a production configuration restriction", async () => {
    const f = database(); f.configuration.material_output_formats = ["DOCX"]; f.base.r.rule.allowed_formats = ["PDF", "DOCX"];
    await expect(f.state()).rejects.toThrow(); expect(dependency.read).not.toHaveBeenCalled();
  });
  it("uses an exact owned applicant Word request, and rejects a mismatched owner", async () => {
    const f = database(); f.base.r.rule.allowed_formats = ["PDF", "DOCX"];
    f.tables.ap_applicant_document_format_requests.push({ id: id(70), customer_id: f.job.customer_id, material_line_id: f.job.material_line_id, delivery_format: "DOCX", request_reference_sha256: "9".repeat(64), recorded_at: draftFixtureNow.toISOString() });
    expect((await f.state()).delivery).toMatchObject({ format: "DOCX", reason: "APPLICANT_REQUEST", applicantRequestId: id(70) });
    f.tables.ap_applicant_document_format_requests[0].customer_id = id(99); await expect(f.state()).rejects.toThrow();
  });
  it("keeps upload intents and never commits after a malformed storage acknowledgement", async () => {
    const f = database(); f.malformedUpload(); expect(await f.run()).toEqual({ status: "HELD", code: "UPLOAD_UNCONFIRMED" });
    expect(f.tables.storage_cleanup_queue).toHaveLength(6); expect(f.calls.some((call) => call.name === "ap_commit_material_draft_pair")).toBe(false);
  });
  it("reconciles a lost actual commit response with exact immutable/current records only once", async () => {
    const f = database(); f.loseCommit(); expect(await f.run()).toMatchObject({ status: "REVIEW_READY", reconciled: true });
    expect(f.calls.filter((call) => call.name === "ap_commit_material_draft_pair")).toHaveLength(1);
  });
  it("cannot register a late upload after timeout; preserves delayed cleanup intents and clears render buffers", async () => {
    const f = database(), pair = await prepareDraftRender({ source: f.source, packet: f.packet }, { now: () => draftFixtureNow, render: async (input) => rendered(input) });
    f.services.render = async () => pair; f.delayUpload(); vi.useFakeTimers();
    const pending = f.run(); await vi.waitFor(() => expect(f.uploads).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(20_001); expect(await pending).toEqual({ status: "HELD", code: "UPLOAD_UNCONFIRMED" });
    expect(f.uploadSignals).toHaveLength(1); expect(f.uploadSignals[0].aborted).toBe(true);
    expect(f.tables.storage_cleanup_queue).toHaveLength(6);
    expect(f.tables.storage_cleanup_queue.every((row) => row.not_before === new Date(draftFixtureNow.getTime() + 3_600_000).toISOString())).toBe(true);
    for (const artifact of [pair.resume, pair.coverLetter]) expect([artifact.buffer, artifact.render.searchablePdf, ...artifact.render.pageImages.map((page) => page.bytes)].every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    f.finishUpload(); await vi.advanceTimersByTimeAsync(1);
    expect(f.calls.some((call) => call.name === "ap_commit_material_draft_pair")).toBe(false); expect(f.uploads).toHaveLength(1);
  });
  it.each(["file alias", "preview", "source alias", "provenance", "version", "context", "review payload", "version customer", "job revision"])("refuses a false completion after changed %s", async (mode) => {
    const f = database(); expect(await f.run()).toMatchObject({ status: "REVIEW_READY" });
    const commit = f.calls.find((call) => call.name === "ap_commit_material_draft_pair")!, registrations = commit.args!.p_registrations as DraftRenderRegistration[];
    const state = { ...await (async () => { f.job.state = "SOURCE_READY"; f.version.member_set_sha256 = null; const s = await f.state(); f.job.state = "REVIEW_READY"; f.version.member_set_sha256 = "f".repeat(64); return s; })() };
    if (mode === "file alias") f.tables.ap_generated_file_versions[0].storage_path = "another/private.pdf";
    if (mode === "preview") f.tables.ap_artifact_quality_reviews[0].render_preview_sha256 = "0".repeat(64);
    if (mode === "source alias") f.tables.ap_material_draft_members[0].editable_source_path_sha256 = "0".repeat(64);
    if (mode === "provenance") f.tables.ap_generated_artifacts[0].claim_provenance = {};
    if (mode === "version") f.job.active_version_id = id(99); if (mode === "context") f.context("0".repeat(64));
    if (mode === "review payload") f.version.claim_review_encrypted_payload_id = id(99);
    if (mode === "version customer") f.version.customer_id = id(99); if (mode === "job revision") f.job.line_revision_id = id(99);
    await expect(f.services.readCommitted(state, registrations, signal())).rejects.toThrow();
    expect(f.calls.filter((call) => call.name === "ap_commit_material_draft_pair")).toHaveLength(1);
  });
});

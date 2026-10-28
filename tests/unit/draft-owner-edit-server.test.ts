import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { buildDraftOwnerEditModel } from "@/lib/documents/draft-owner-edit";
import { draftDocumentFixture, draftFixtureNow as now } from "../fixtures/draft-document";
import { draftReferenceFixture } from "../fixtures/draft-reference";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ read: vi.fn(), store: vi.fn(), load: vi.fn(), contact: vi.fn(), references: vi.fn() }));
vi.mock("@/lib/documents/draft-packet-worker", () => ({ readEncryptedDraftPayload: mock.read, storeEncryptedDraftPayload: mock.store }));
vi.mock("@/lib/documents/drafting-evidence-server", () => ({ loadDraftingEvidencePacket: mock.load }));
vi.mock("@/lib/documents/draft-owner-contact", () => ({ readConfirmedDraftContact: mock.contact }));
vi.mock("@/lib/documents/draft-owner-references", async (original) => ({ ...await original<typeof import("@/lib/documents/draft-owner-references")>(), readConfirmedDraftReferences: mock.references }));
import { createDraftOwnerEditServer } from "@/lib/documents/draft-owner-edit-server";
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (body: string) => createHash("sha256").update(body).digest("hex");
type Call = { name: string; kind: "table" | "rpc"; args?: Record<string, unknown>; filters: [string, unknown][]; columns?: string; signal?: AbortSignal };
type Receipt = { data: unknown; error: unknown };
function fixture(base = draftDocumentFixture(), initialState = "SOURCE_READY") {
  const source = base.build(), packet = base.input.packet, reviewer = id(90), jobId = id(91), oldId = id(92), packetId = id(93), payloadId = id(94);
  const job = { id: jobId, customer_id: packet.expected.customerId, material_line_id: packet.expected.materialLineId, line_revision_id: packet.expected.revisionId,
    source_snapshot_id: packet.binding.snapshotId, state: initialState, active_version_id: oldId };
  const prior = { id: oldId, job_id: jobId, customer_id: job.customer_id, material_line_id: job.material_line_id, version: 1, supersedes_id: null as string | null,
    packet_encrypted_payload_id: packetId, packet_sha256: packet.packetSha256, context_sha256: "c".repeat(64), encrypted_payload_id: payloadId, source_sha256: source.renderSourceSha256,
    invalidated_at: null as string | null, member_set_sha256: initialState === "SOURCE_READY" ? null : "a".repeat(64), claim_review_sha256: initialState === "SOURCE_READY" ? null : "b".repeat(64),
    approval_sha256: initialState === "APPROVED" ? "d".repeat(64) : null, release_id: null as string | null };
  const revision = { id: base.r.revision.id, line_id: job.material_line_id, source_snapshot_id: job.source_snapshot_id, version: 1, binding_sha256: base.r.revision.binding_sha256, due_at: base.r.revision.due_at, superseded_at: null };
  const versions = new Map([[oldId, prior]]), bodies = new Map([[packetId, serializeDraftingEvidencePacket(packet)], [payloadId, serializeDraftRenderSource(source)]]);
  const calls: Call[] = [], buffers: Uint8Array[] = [], overrides = new Map<string, ((call: Call) => Receipt | Promise<Receipt>)[]>();
  let context = prior.context_sha256, lost = false, commit = true, clock = now;
  const query = (call: Call) => {
    calls.push(call);
    const run = async (): Promise<Receipt> => {
      const override = overrides.get(call.name)?.shift(); if (override) return override(call);
      if (call.kind === "rpc") {
        if (call.name === "ap_require_material_reviewer") return { data: true, error: null };
        if (call.name === "ap_material_draft_context_sha256") return { data: context, error: null };
        if (call.name === "ap_revise_material_draft_source") {
          const args = call.args!, old = versions.get(String(args.p_version_id))!;
          const next = { ...old, id: id(100), version: old.version + 1, supersedes_id: old.id, encrypted_payload_id: String(args.p_source_payload_id), source_sha256: String(args.p_source_sha256),
            invalidated_at: null, member_set_sha256: null, claim_review_sha256: null, approval_sha256: null };
          if (commit) { old.invalidated_at = now.toISOString(); versions.set(next.id, next); job.active_version_id = next.id; job.state = "SOURCE_READY"; }
          if (lost) throw new Error("PRIVATE PROVIDER DETAIL"); return { data: next.id, error: null };
        }
        throw new Error("Unexpected RPC");
      }
      const key = call.filters.find(([key]) => key === "id")?.[1];
      const row = call.name === "ap_material_draft_jobs" ? job : call.name === "ap_material_draft_versions" ? versions.get(String(key)) : call.name === "ap_material_line_revisions" ? revision : undefined;
      return { data: row && call.columns ? structuredClone(Object.fromEntries(call.columns.split(",").map((column) => [column, (row as Record<string, unknown>)[column]]))) : null, error: null };
    };
    const q = { select: (columns: string) => { call.columns = columns; return q; }, eq: (key: string, value: unknown) => { call.filters.push([key, value]); return q; },
      abortSignal: (signal: AbortSignal) => { call.signal = signal; return q; }, single: run, then: (resolve: (value: Receipt) => unknown, reject?: (error: unknown) => unknown) => run().then(resolve, reject) }; return q;
  };
  const admin = { from: (name: string) => query({ name, kind: "table", filters: [] }), rpc: (name: string, args: Record<string, unknown>) => query({ name, args, kind: "rpc", filters: [] }) } as unknown as SupabaseClient<Database>;
  mock.load.mockResolvedValue(packet);
  mock.read.mockImplementation(async (_, request) => { const buffer = Buffer.from(bodies.get(request.payloadId)!); buffers.push(buffer); return buffer; });
  mock.contact.mockImplementation(async () => { const buffer = Buffer.from(base.input.contact.plaintext); buffers.push(buffer); return buffer; });
  mock.references.mockImplementation(async () => "references" in base ? (base as ReturnType<typeof draftReferenceFixture>).references.map((row) => { const plaintext = Buffer.from(row.plaintext); buffers.push(plaintext); return { ...row, plaintext }; }) : []);
  mock.store.mockImplementation(async (_, args) => { expect(sha(args.body)).toBe(args.sha256); bodies.set(args.payloadId, args.body); return { payloadId: args.payloadId, sha256: args.sha256 }; });
  const request = { jobId, expectedVersionId: oldId, expectedSourceSha256: prior.source_sha256, requestId: id(98), output: buildDraftOwnerEditModel(source, packet, now).output };
  request.output.coverLetter.body[0].sentences[0].text = "I organized schedules for community events.";
  const service = createDraftOwnerEditServer(admin, reviewer, { now: () => clock }), save = (raw: unknown = request, signal = new AbortController().signal) => service.saveEdit(raw, signal);
  return { source, packet, base, job, prior, revision, versions, bodies, calls, buffers, overrides, request, save, reviewer, admin,
    lose: () => { lost = true; }, noCommit: () => { commit = false; }, changeContext: () => { context = "e".repeat(64); }, setClock: (value: Date) => { clock = value; } };
}
beforeEach(() => vi.clearAllMocks()); afterEach(() => vi.useRealTimers());
describe("owner edit append-only adapter", () => {
  it.each(["SOURCE_READY", "REVIEW_READY", "APPROVED"])("saves from %s, with fresh local evidence and no copied approval", async (state) => {
    const f = fixture(draftDocumentFixture(), state), result = await f.save();
    expect(result).toMatchObject({ jobId: f.job.id, versionId: id(100), requestId: f.request.requestId, state: "OWNER_REVIEW_REQUIRED", deliveryAuthorized: false, reconciled: false });
    expect(f.versions.get(id(100))).toMatchObject({ supersedes_id: f.prior.id, member_set_sha256: null, claim_review_sha256: null, approval_sha256: null });
    const call = f.calls.find((call) => call.name === "ap_revise_material_draft_source")!;
    expect(call.args).toEqual({ p_version_id: f.prior.id, p_expected_source_sha256: f.request.expectedSourceSha256, p_source_payload_id: f.versions.get(id(100))!.encrypted_payload_id, p_source_sha256: result.sourceSha256, p_reviewer_id: f.reviewer });
    expect(f.buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
    expect(f.calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
    expect(f.calls.some((call) => /approve|send|release|delete/.test(call.name))).toBe(false);
  });
  it("authorizes reviewer before private reads and rejects client reviewer/unknown input", async () => {
    const f = fixture(); expect(f.calls).toEqual([]); await expect(f.save({ ...f.request, reviewerId: id(99) })).rejects.toThrow("INPUT_INVALID"); expect(f.calls).toEqual([]);
    f.overrides.set("ap_require_material_reviewer", [() => ({ data: null, error: {} })]); await expect(f.save()).rejects.toThrow(); expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(["RELEASED", "RENDERING", "RESULT_UNKNOWN", "CANCELED"])("does not edit %s", async (state) => {
    const f = fixture(draftDocumentFixture(), state); await expect(f.save()).rejects.toThrow(); expect(mock.store).not.toHaveBeenCalled();
  });
  it.each([false, null, {}, "true"])("rejects malformed reviewer success %j before private reads", async (data) => {
    const f = fixture(); f.overrides.set("ap_require_material_reviewer", [() => ({ data, error: null })]);
    await expect(f.save()).rejects.toThrow("REVIEWER_UNCONFIRMED"); expect(f.calls).toHaveLength(1); expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(["customer_id", "material_line_id", "job_id"] as const)("rejects mixed %s before decryption", async (field) => {
    const f = fixture(); f.prior[field] = id(80); await expect(f.save()).rejects.toThrow("VERSION_STALE"); expect(mock.read).not.toHaveBeenCalled();
  });
  it("rejects changed context and deadline before private reads", async () => {
    const f = fixture(); f.changeContext(); await expect(f.save()).rejects.toThrow("CONTEXT_STALE"); expect(mock.read).not.toHaveBeenCalled();
    const g = fixture(); g.setClock(new Date(g.revision.due_at)); await expect(g.save()).rejects.toThrow("REVISION_STALE");
  });
  it("rejects changed context after encrypted storage without revising or deleting", async () => {
    const f = fixture(); mock.store.mockImplementation(async (_, args) => { f.changeContext(); return { payloadId: args.payloadId, sha256: args.sha256 }; });
    await expect(f.save()).rejects.toThrow("CONTEXT_STALE"); expect(f.calls.some((call) => /revise|delete/.test(call.name))).toBe(false);
  });
  it("reconciles a committed lost response and the exact same request without another write", async () => {
    const f = fixture(); f.lose(); const result = await f.save(); expect(result.reconciled).toBe(true);
    expect(await f.save()).toEqual(result); expect(mock.store).toHaveBeenCalledTimes(1);
    expect(f.calls.filter((call) => call.name === "ap_revise_material_draft_source")).toHaveLength(1);
  });
  it("does not recognize a different edit or request ID as a replay", async () => {
    const f = fixture(); await f.save(); await expect(f.save({ ...f.request, requestId: id(99) })).rejects.toThrow("VERSION_STALE");
    const changed = structuredClone(f.request); changed.output.coverLetter.body[0].sentences[0].text = "Another wording.";
    await expect(f.save(changed)).rejects.toThrow("VERSION_STALE"); expect(mock.store).toHaveBeenCalledTimes(1);
  });
  it("does not retry or delete after an unconfirmed mutation", async () => {
    const f = fixture(); f.lose(); f.noCommit(); await expect(f.save()).rejects.toThrow("RESULT_UNKNOWN");
    expect(f.calls.filter((call) => call.name === "ap_revise_material_draft_source")).toHaveLength(1); expect(mock.store).toHaveBeenCalledTimes(1);
  });
  it("reports invalid prose as a definite pre-write rejection", async () => {
    const f = fixture(); f.request.output.coverLetter.body[0].sentences[0].text = "Managed 999 schedules.";
    await expect(f.save()).rejects.toThrow("EDIT_INVALID"); expect(mock.store).not.toHaveBeenCalled();
    expect(f.calls.some((call) => call.name === "ap_revise_material_draft_source")).toBe(false);
  });
  it("rechecks actual reference fields and zeroes every returned buffer", async () => {
    const f = fixture(draftReferenceFixture(3)); await f.save(); expect(mock.references).toHaveBeenCalledTimes(1); expect(f.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it("rejects changed reference bytes before storing", async () => {
    const f = fixture(draftReferenceFixture()); const bad = Buffer.from("private invalid reference"); mock.references.mockResolvedValue([{ ...(f.base as ReturnType<typeof draftReferenceFixture>).references[0], plaintext: bad }]);
    await expect(f.save()).rejects.toThrow("UNCONFIRMED"); expect(bad.every((byte) => byte === 0)).toBe(true); expect(mock.store).not.toHaveBeenCalled();
  });
  it("bounds hung metadata and redacts provider errors", async () => {
    vi.useFakeTimers(); const f = fixture(); f.overrides.set("ap_material_draft_jobs", [() => new Promise(() => {})]);
    const outcome = f.save().catch((error: Error) => error.message); await vi.advanceTimersByTimeAsync(60_001); expect(await outcome).toBe("DRAFT_OWNER_EDIT_SERVER_ABORTED"); expect(mock.store).not.toHaveBeenCalled();
  });
  it("clears late contact plaintext after caller cancellation without storage", async () => {
    const f = fixture(), controller = new AbortController(); let resolve!: (value: Buffer) => void;
    mock.contact.mockImplementation(() => new Promise<Buffer>((done) => { resolve = done; }));
    const outcome = f.save(f.request, controller.signal).catch((error: Error) => error.message);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function")); controller.abort(); expect(await outcome).toContain("ABORTED");
    const late = Buffer.from(f.base.input.contact.plaintext); resolve(late); await vi.waitFor(() => expect(late.every((byte) => byte === 0)).toBe(true)); expect(mock.store).not.toHaveBeenCalled();
  });
  it("detaches the submitted content before awaits", async () => {
    const f = fixture(); let proceed!: () => void;
    f.overrides.set("ap_require_material_reviewer", [() => new Promise<Receipt>((resolve) => { proceed = () => resolve({ data: true, error: null }); })]);
    const saving = f.save(); await vi.waitFor(() => expect(proceed).toBeTypeOf("function")); f.request.output.coverLetter.body[0].sentences[0].text = "Injected late caller mutation"; proceed();
    const result = await saving, body = JSON.parse(f.bodies.get(f.versions.get(result.versionId)!.encrypted_payload_id)!);
    expect(body.coverLetter.body[0][0].text).toBe("I organized schedules for community events.");
  });
});

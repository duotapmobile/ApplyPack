import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import type { DraftChangePort, DraftChangeRecord } from "@/lib/documents/draft-change-port";
import { draftDocumentFixture, draftFixtureNow as now } from "../fixtures/draft-document";
import { draftReferenceFixture } from "../fixtures/draft-reference";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ read: vi.fn(), store: vi.fn(), load: vi.fn(), contact: vi.fn(), references: vi.fn() }));
vi.mock("@/lib/documents/draft-packet-worker", () => ({ readEncryptedDraftPayload: mock.read, storeEncryptedDraftPayload: mock.store }));
vi.mock("@/lib/documents/drafting-evidence-server", () => ({ loadDraftingEvidencePacket: mock.load }));
vi.mock("@/lib/documents/draft-owner-contact", () => ({ readConfirmedDraftContact: mock.contact }));
vi.mock("@/lib/documents/draft-owner-references", async (original) => ({ ...await original<typeof import("@/lib/documents/draft-owner-references")>(), readConfirmedDraftReferences: mock.references }));
import { createDraftChangeServer } from "@/lib/documents/draft-change-server";
import { createDraftChangePort } from "@/lib/documents/draft-change-supabase";
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Call = { name: string; args?: Record<string, unknown>; columns?: string; filters: [string, unknown][]; signal?: AbortSignal };
function fixture(base = draftDocumentFixture(), initialState = "SOURCE_READY", concretePort = false) {
  const source = base.build(), packet = base.input.packet, reviewer = id(90), jobId = id(91), oldId = id(92), packetId = id(93), sourceId = id(94);
  const job = { id: jobId, customer_id: packet.expected.customerId, material_line_id: packet.expected.materialLineId, line_revision_id: packet.expected.revisionId,
    source_snapshot_id: packet.binding.snapshotId, state: initialState, active_version_id: oldId };
  const prior = { id: oldId, job_id: jobId, customer_id: job.customer_id, material_line_id: job.material_line_id, version: 1, supersedes_id: null as string | null,
    packet_encrypted_payload_id: packetId, packet_sha256: packet.packetSha256, context_sha256: "c".repeat(64), encrypted_payload_id: sourceId as string | null,
    source_sha256: source.renderSourceSha256 as string | null, invalidated_at: null as string | null, release_id: null as string | null };
  const revision = { id: base.r.revision.id, line_id: job.material_line_id, source_snapshot_id: job.source_snapshot_id, version: 1,
    binding_sha256: base.r.revision.binding_sha256, due_at: base.r.revision.due_at, superseded_at: null };
  const versions = new Map([[oldId, prior]]), bodies = new Map([[packetId, serializeDraftingEvidencePacket(packet)], [sourceId, serializeDraftRenderSource(source)]]);
  const calls: Call[] = [], buffers: Uint8Array[] = [];
  let clock = now, context = prior.context_sha256, reviewerReceipt: unknown = true, record: DraftChangeRecord | null = null, lost = false, commit = true;
  const query = (call: Call) => {
    calls.push(call);
    const run = async () => {
      if (call.name === "ap_require_material_reviewer") return { data: reviewerReceipt, error: null };
      if (call.name === "ap_material_draft_context_sha256") return { data: context, error: null };
      if (call.name === "ap_material_draft_change_evidence") return { data: record, error: null };
      if (call.name === "ap_request_material_draft_changes") return { data: await port.commit(call.args as Parameters<DraftChangePort["commit"]>[0], call.signal!), error: null };
      const key = call.filters.find(([key]) => key === "id")?.[1];
      const row = call.name === "ap_material_draft_jobs" ? job : call.name === "ap_material_draft_versions" ? versions.get(String(key)) : call.name === "ap_material_line_revisions" ? revision : call.name === "ap_material_draft_change_requests" ? record : undefined;
      return { data: row && call.columns ? structuredClone(Object.fromEntries(call.columns.split(",").map((column) => [column, (row as Record<string, unknown>)[column]]))) : null, error: null };
    };
    const q = { select: (columns: string) => { call.columns = columns; return q; }, eq: (key: string, value: unknown) => { call.filters.push([key, value]); return q; },
      abortSignal: (signal: AbortSignal) => { call.signal = signal; return q; }, single: run, maybeSingle: run, then: (resolve: (value: Awaited<ReturnType<typeof run>>) => unknown, reject?: (error: unknown) => unknown) => run().then(resolve, reject) }; return q;
  };
  const admin = { from: (name: string) => query({ name, filters: [] }), rpc: (name: string, args: Record<string, unknown>) => query({ name, args, filters: [] }) } as unknown as SupabaseClient<Database>;
  const port: DraftChangePort = { readRequest: vi.fn(async () => record && structuredClone(record)), readEvidence: vi.fn(async () => record), reserve: vi.fn(),
    commit: vi.fn(async (args) => {
      if (commit) {
        const successor = { ...prior, id: id(100), version: 2, supersedes_id: prior.id, encrypted_payload_id: null, source_sha256: null, invalidated_at: null };
        record = { id: args.p_request_id, customer_id: job.customer_id, material_line_id: job.material_line_id, job_id: job.id,
          parent_version_id: prior.id, successor_version_id: successor.id, encrypted_payload_id: args.p_payload_id,
          request_sha256: args.p_request_sha256, payload_sha256: args.p_payload_sha256, parent_source_sha256: args.p_expected_source_sha256,
          parent_proposal_sha256: args.p_parent_proposal_sha256, packet_sha256: prior.packet_sha256, context_sha256: prior.context_sha256,
          reviewer_id: args.p_reviewer_id, created_at: clock.toISOString() };
        prior.invalidated_at = clock.toISOString(); versions.set(successor.id, successor); job.active_version_id = successor.id; job.state = "READY";
      }
      if (lost) throw new Error("PRIVATE PROVIDER DETAIL"); return id(100);
    }) };
  mock.load.mockResolvedValue(packet);
  mock.read.mockImplementation(async (_, request) => { const buffer = Buffer.from(bodies.get(request.payloadId)!); buffers.push(buffer); return buffer; });
  mock.contact.mockImplementation(async () => { const buffer = Buffer.from(base.input.contact.plaintext); buffers.push(buffer); return buffer; });
  mock.references.mockImplementation(async () => "references" in base ? (base as ReturnType<typeof draftReferenceFixture>).references.map((row) => { const plaintext = Buffer.from(row.plaintext); buffers.push(plaintext); return { ...row, plaintext }; }) : []);
  mock.store.mockImplementation(async (_, args) => { bodies.set(args.payloadId, args.body); return { payloadId: args.payloadId, sha256: args.sha256 }; });
  const request = { jobId, expectedVersionId: oldId, expectedSourceSha256: source.renderSourceSha256, requestId: id(98), instructions: "Make the scheduling example more concise without adding any facts." };
  const service = createDraftChangeServer(admin, reviewer, concretePort ? createDraftChangePort(admin) : port, { now: () => clock }), save = (raw: unknown = request, signal = new AbortController().signal) => service.requestChanges(raw, signal);
  return { source, packet, base, job, prior, revision, versions, calls, buffers, request, save, port, bodies,
    setReviewer: (value: unknown) => { reviewerReceipt = value; }, lose: () => { lost = true; }, noCommit: () => { commit = false; },
    changeContext: () => { context = "e".repeat(64); }, setClock: (value: Date) => { clock = value; } };
}
beforeEach(() => vi.clearAllMocks()); afterEach(() => vi.useRealTimers());
describe("durable internal owner request changes", () => {
  it("connects the actual097 adapter through encrypted save and exact lost-response reconciliation", async () => {
    const f = fixture(draftDocumentFixture(), "APPROVED", true); f.lose();
    expect(await f.save()).toMatchObject({ recorded: true, reconciled: true, current: true, versionId: id(100), deliveryAuthorized: false });
    expect(f.calls.filter((call) => call.name === "ap_request_material_draft_changes")).toHaveLength(1);
    f.setClock(new Date("2027-01-01T00:00:00Z")); f.changeContext();
    expect(await f.save()).toMatchObject({ recorded: true, reconciled: true });
    expect(f.calls.filter((call) => call.name === "ap_request_material_draft_changes")).toHaveLength(1);
    expect(mock.store).toHaveBeenCalledTimes(1); expect(f.buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
    expect(f.calls.every((call) => call.name !== "ap_begin_material_draft_request_with_changes")).toBe(true);
  });
  it.each(["SOURCE_READY", "REVIEW_READY", "APPROVED"])("queues an unapproved successor from %s using encrypted exact instructions", async (state) => {
    const f = fixture(draftDocumentFixture(), state), result = await f.save();
    expect(result).toMatchObject({ recorded: true, current: true, state: "CHANGES_REQUESTED", deliveryAuthorized: false, versionId: id(100), reconciled: false });
    expect(mock.store.mock.calls[0][1]).toMatchObject({ customerId: f.job.customer_id, jobId: f.job.id, purpose: "MATERIAL_DRAFT_CHANGE_REQUEST" });
    const body = JSON.parse(mock.store.mock.calls[0][1].body); expect(body.request).toEqual(f.request); expect(body.priorProposalSourceSha256).toBe(f.source.proposalSourceSha256);
    expect(f.port.reserve).not.toHaveBeenCalled(); expect(f.buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
    expect(f.calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
  });
  it.each([false, null, {}, "true"])("rejects reviewer receipt %j before private reads", async (value) => {
    const f = fixture(); f.setReviewer(value); await expect(f.save()).rejects.toThrow("REVIEWER_UNCONFIRMED"); expect(mock.read).not.toHaveBeenCalled(); expect(f.port.readRequest).not.toHaveBeenCalled();
  });
  it.each(["RELEASED", "RENDERING", "RESULT_UNKNOWN", "CANCELED"])("does not queue from %s", async (state) => {
    const f = fixture(draftDocumentFixture(), state); await expect(f.save()).rejects.toThrow("PARENT_STALE"); expect(mock.store).not.toHaveBeenCalled();
  });
  it("reconciles exact lost-response request after evidence/deadline expires without any new decrypt, store or dispatch", async () => {
    const f = fixture(); f.lose(); const first = await f.save(); expect(first.reconciled).toBe(true);
    const reads = mock.read.mock.calls.length; f.setClock(new Date("2027-01-01T00:00:00Z")); f.changeContext();
    expect(await f.save()).toEqual(first); expect(mock.read).toHaveBeenCalledTimes(reads); expect(mock.store).toHaveBeenCalledTimes(1); expect(f.port.commit).toHaveBeenCalledTimes(1);
    await expect(f.save({ ...f.request, instructions: "Make a different change to the wording." })).rejects.toThrow("REQUEST_CONFLICT");
  });
  it("never retries or deletes after an unconfirmed commit", async () => {
    const f = fixture(); f.lose(); f.noCommit(); await expect(f.save()).rejects.toThrow("RESULT_UNKNOWN"); expect(f.port.commit).toHaveBeenCalledTimes(1);
    expect(f.calls.some((call) => /delete|approve|send/.test(call.name))).toBe(false);
  });
  it("blocks currentness changes after encrypted storage", async () => {
    const f = fixture(); mock.store.mockImplementation(async (_, args) => { f.changeContext(); return { payloadId: args.payloadId, sha256: args.sha256 }; });
    await expect(f.save()).rejects.toThrow("CONTEXT_STALE"); expect(f.port.commit).not.toHaveBeenCalled();
  });
  it("validates and clears selected reference bytes without adding reference contact details to model data", async () => {
    const base = draftReferenceFixture(3), f = fixture(base); await f.save();
    expect(mock.references).toHaveBeenCalledOnce(); expect(f.buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
    expect(JSON.stringify(JSON.parse(mock.store.mock.calls[0][1].body).providerContext)).not.toMatch(/Morgan Reference|sharedWorkContext|capabilitiesCanVerify/);
  });
  it("bounds a hung request and clears plaintext that arrives after cancellation", async () => {
    vi.useFakeTimers(); const f = fixture(); let finish: ((value: Buffer) => void) | undefined;
    mock.contact.mockImplementation(() => new Promise<Buffer>((resolve) => { finish = resolve; }));
    const pending = f.save(), rejection = expect(pending).rejects.toThrow("ABORTED");
    await vi.advanceTimersByTimeAsync(60_001); await rejection;
    const bytes = Buffer.from(f.base.input.contact.plaintext); finish!(bytes); await vi.advanceTimersByTimeAsync(1);
    expect(bytes.every((value) => value === 0)).toBe(true); expect(f.port.commit).not.toHaveBeenCalled();
  });
});

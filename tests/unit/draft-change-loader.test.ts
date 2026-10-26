import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { buildDraftChangePayload } from "@/lib/documents/draft-change-request";
import type { DraftChangePort, DraftChangeRecord } from "@/lib/documents/draft-change-port";
import { draftDocumentFixture, draftFixtureNow as now } from "../fixtures/draft-document";
vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/documents/draft-packet-worker", () => ({ readEncryptedDraftPayload: mock.read }));
import { loadDraftChangeForVersion } from "@/lib/documents/draft-change-loader";
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const base = draftDocumentFixture(), source = base.build(), packet = base.input.packet;
  const request = { jobId: id(1), expectedVersionId: id(2), expectedSourceSha256: source.renderSourceSha256, requestId: id(3), instructions: "Make the scheduling example more concise." };
  const built = buildDraftChangePayload({ request, source, packet, contextSha256: "d".repeat(64), reviewerId: id(4), localIdentityValues: [] }, now);
  const record: DraftChangeRecord = { id: request.requestId, customer_id: packet.expected.customerId, material_line_id: packet.expected.materialLineId,
    job_id: request.jobId, parent_version_id: request.expectedVersionId, successor_version_id: id(5), encrypted_payload_id: id(6),
    request_sha256: built.requestSha256, payload_sha256: built.payloadSha256, parent_source_sha256: source.renderSourceSha256,
    parent_proposal_sha256: source.proposalSourceSha256, packet_sha256: packet.packetSha256, context_sha256: "d".repeat(64), reviewer_id: id(4), created_at: now.toISOString() };
  const port: DraftChangePort = { readRequest: vi.fn(), commit: vi.fn(), reserve: vi.fn(), readEvidence: vi.fn(async () => structuredClone(record)) };
  const bytes = Buffer.from(built.body); mock.read.mockResolvedValue(bytes);
  const binding = { jobId: id(1), versionId: id(7), customerId: packet.expected.customerId, materialLineId: packet.expected.materialLineId };
  const controller = new AbortController(), admin = {} as SupabaseClient<Database>;
  const load = () => loadDraftChangeForVersion(admin, port, binding, packet, controller.signal, () => now);
  return { base, source, packet, built, record, port, bytes, binding, controller, load };
}
beforeEach(() => vi.clearAllMocks());
describe("private request instructions for the exact immutable version ancestry", () => {
  it("reads the exact purpose/hash, rechecks immutable ancestry and clears plaintext", async () => {
    const f = fixture(), result = await f.load();
    expect(result?.ownerInstructions).toBe("Make the scheduling example more concise.");
    expect(result?.lineage).toMatchObject({ requestId: f.record.id, priorVersionId: f.record.parent_version_id, requestPayloadSha256: f.record.payload_sha256 });
    expect(mock.read).toHaveBeenCalledWith(expect.anything(), { customerId: f.binding.customerId, jobId: f.binding.jobId,
      payloadId: f.record.encrypted_payload_id, sha256: f.record.payload_sha256, purpose: "MATERIAL_DRAFT_CHANGE_REQUEST" }, { signal: f.controller.signal });
    expect(f.port.readEvidence).toHaveBeenCalledTimes(2); expect(f.bytes.every((byte) => byte === 0)).toBe(true);
    expect(f.port.commit).not.toHaveBeenCalled(); expect(f.port.reserve).not.toHaveBeenCalled();
  });
  it("returns ordinary no-request versions without decrypting or inventing lineage", async () => {
    const f = fixture(); vi.mocked(f.port.readEvidence).mockResolvedValue(null); expect(await f.load()).toBeNull(); expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(["job_id", "customer_id", "material_line_id"] as const)("rejects mixed %s before decrypting", async (field) => {
    const f = fixture(); f.record[field] = id(99); await expect(f.load()).rejects.toThrow("BINDING_INVALID"); expect(mock.read).not.toHaveBeenCalled();
  });
  it("rejects malformed or future metadata before private reads", async () => {
    const f = fixture(); f.record.created_at = new Date(now.getTime() + 1).toISOString(); await expect(f.load()).rejects.toThrow("BINDING_INVALID"); expect(mock.read).not.toHaveBeenCalled();
    vi.mocked(f.port.readEvidence).mockResolvedValue({ ...f.record, privateText: "not permitted" }); await expect(f.load()).rejects.toThrow(); expect(mock.read).not.toHaveBeenCalled();
  });
  it("does not substitute retired payloads or skip the owned ACTIVE payload reader", async () => {
    const f = fixture(); mock.read.mockRejectedValue(new Error("DRAFT_PAYLOAD_INACTIVE")); await expect(f.load()).rejects.toThrow("INACTIVE");
    expect(f.port.readEvidence).toHaveBeenCalledOnce(); expect(f.port.commit).not.toHaveBeenCalled();
  });
  it("rejects altered bytes and zeroes them even if the metadata hash looks valid", async () => {
    const f = fixture(); f.bytes[20] ^= 1; await expect(f.load()).rejects.toThrow("DIGEST_INVALID"); expect(f.bytes.every((byte) => byte === 0)).toBe(true);
  });
  it("rejects an ancestry change during decryption and clears the returned bytes", async () => {
    const f = fixture(); vi.mocked(f.port.readEvidence).mockResolvedValueOnce(structuredClone(f.record)).mockResolvedValueOnce({ ...f.record, successor_version_id: id(98) });
    await expect(f.load()).rejects.toThrow("RECORD_CHANGED"); expect(f.bytes.every((byte) => byte === 0)).toBe(true);
  });
  it("stops before metadata for an already aborted request", async () => {
    const f = fixture(); f.controller.abort(); await expect(f.load()).rejects.toThrow("ABORTED"); expect(f.port.readEvidence).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled();
  });
  it("clears a late plaintext result after caller cancellation", async () => {
    const f = fixture(); let resolve!: (value: Buffer) => void; mock.read.mockImplementation(() => new Promise<Buffer>((done) => { resolve = done; }));
    const operation = f.load(); await vi.waitFor(() => expect(mock.read).toHaveBeenCalledOnce()); f.controller.abort(); resolve(f.bytes);
    await expect(operation).rejects.toThrow("ABORTED"); expect(f.bytes.every((byte) => byte === 0)).toBe(true); expect(f.port.readEvidence).toHaveBeenCalledOnce();
  });
});

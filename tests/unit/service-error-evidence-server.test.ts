import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
vi.mock("server-only", () => ({}));
const privateReads = vi.hoisted(() => ({ draft: vi.fn(), contact: vi.fn() }));
vi.mock("@/lib/documents/draft-packet-worker", () => ({ readEncryptedDraftPayload: privateReads.draft }));
vi.mock("@/lib/documents/draft-owner-contact", () => ({ readConfirmedDraftContact: privateReads.contact }));
import { draftDocumentFixture } from "../fixtures/draft-document";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { createServiceErrorEvidenceReader } from "@/lib/materials/service-error-evidence";
const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const f = draftDocumentFixture(), source = f.build(), member = { artifactId: id(1), fileVersionId: id(2), releaseId: id(3) };
  const tables: Record<string, Record<string, unknown>[]> = {
    ap_material_draft_members: [{ customer_id: f.r.purchase.customer_id, material_line_id: f.r.line.id, draft_version_id: id(4), artifact_type: "RESUME",
      artifact_id: member.artifactId, file_version_id: member.fileVersionId, file_sha256: "1".repeat(64), preview_sha256: "2".repeat(64), source_sha256: source.renderSourceSha256 }],
    ap_material_draft_versions: [{ id: id(4), job_id: id(5), customer_id: f.r.purchase.customer_id, material_line_id: f.r.line.id,
      packet_encrypted_payload_id: id(6), packet_sha256: f.input.packet.packetSha256, encrypted_payload_id: id(7), source_sha256: source.renderSourceSha256,
      release_id: member.releaseId, approved_at: "2026-10-25T12:05:00Z", approved_by: id(8) }],
    ap_generated_artifacts: [{ id: member.artifactId, customer_id: f.r.purchase.customer_id, material_line_id: f.r.line.id,
      source_line_revision_id: f.r.revision.id, source_snapshot_id: f.r.snapshot.id, artifact_type: "RESUME", retention_state: "ACTIVE" }],
    ap_generated_file_versions: [{ id: member.fileVersionId, artifact_id: member.artifactId, checksum_sha256: "1".repeat(64),
      safe_filename: "Casey_Resume.pdf", version: 1, binding_sha256: f.r.revision.binding_sha256 }],
    ap_releases: [{ id: member.releaseId, customer_id: f.r.purchase.customer_id, material_line_id: f.r.line.id, committed_at: "2026-10-25T12:06:00Z", version_bundle: {} }],
    ap_release_members: [{ release_id: member.releaseId, member_type: "GENERATED_ARTIFACT", member_id: member.artifactId }],
    ap_artifact_quality_reviews: [{ file_version_id: member.fileVersionId, render_preview_bucket: "operator-render-previews", render_preview_sha256: "2".repeat(64) }],
  };
  let role: unknown = true;
  const rpc = vi.fn(() => ({ abortSignal: async () => ({ data: role, error: null }) })), from = vi.fn((table: string) => {
    let columns = "", single = false, count = Infinity; const predicates: ((row: Record<string, unknown>) => boolean)[] = [];
    const query = { select: (value: string) => { columns = value; return query; }, eq: (key: string, value: unknown) => { predicates.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { predicates.push((row) => values.includes(row[key])); return query; }, limit: (value: number) => { count = value; return query; },
      single: () => { single = true; return query; }, abortSignal: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => {
        const rows = tables[table].filter((row) => predicates.every((check) => check(row))).slice(0, count).map((row) => Object.fromEntries(columns.split(",").map((key) => [key, row[key]])));
        return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
      }).then(resolve, reject) }; return query;
  });
  const buffers: Buffer[] = []; privateReads.draft.mockImplementation(async (_admin, input) => {
    const bytes = Buffer.from(input.purpose === "MATERIAL_DRAFT_PACKET" ? serializeDraftingEvidencePacket(f.input.packet) : serializeDraftRenderSource(source)); buffers.push(bytes); return bytes;
  });
  privateReads.contact.mockImplementation(async () => { const bytes = Buffer.from(f.input.contact.plaintext); buffers.push(bytes); return bytes; });
  const admin = { from, rpc } as unknown as SupabaseClient<Database>, reader = createServiceErrorEvidenceReader(admin, id(8));
  return { f, tables, member, buffers, rpc, from, role: (value: unknown) => { role = value; },
    read: () => reader(f.r.purchase.customer_id, member, new AbortController().signal) };
}
beforeEach(() => vi.clearAllMocks());
describe("exact historical delivered file reader", () => {
  it("binds the actual released member, private sources and preview then rereads role and state", async () => {
    const f = fixture(), result = await f.read(); expect(result.filename).toBe("Casey_Resume.pdf");
    expect(result.evidence.renderingAuthorized).toBe(false); expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.buffers.length).toBe(3); expect(f.buffers.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  });
  it.each([false, null, "true"])("does not return private evidence after reviewer revocation or malformed role (%j)", async (role) => {
    const f = fixture(); privateReads.contact.mockImplementation(async () => { f.role(role); const bytes = Buffer.from(f.f.input.contact.plaintext); f.buffers.push(bytes); return bytes; });
    await expect(f.read()).rejects.toThrow("DELIVERY_EVIDENCE_UNAVAILABLE"); expect(f.rpc).toHaveBeenCalledTimes(2);
    expect(f.buffers.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  });
  it.each([["ap_material_draft_members", "material_line_id", id(99)], ["ap_material_draft_versions", "release_id", id(99)],
    ["ap_generated_artifacts", "customer_id", id(99)], ["ap_artifact_quality_reviews", "render_preview_sha256", "f".repeat(64)]])("rejects mismatched %s.%s before decrypt", async (table, field, value) => {
    const f = fixture(); f.tables[table][0][field] = value;
    await expect(f.read()).rejects.toThrow("DELIVERY_EVIDENCE_UNAVAILABLE"); expect(privateReads.draft).not.toHaveBeenCalled();
  });
  it("rejects a file alias changing during decryption and clears all private bytes", async () => {
    const f = fixture(); privateReads.contact.mockImplementation(async () => { f.tables.ap_generated_file_versions[0].safe_filename = "Changed.pdf";
      const bytes = Buffer.from(f.f.input.contact.plaintext); f.buffers.push(bytes); return bytes; });
    await expect(f.read()).rejects.toThrow("DELIVERY_EVIDENCE_CHANGED"); expect(f.buffers.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  });
});

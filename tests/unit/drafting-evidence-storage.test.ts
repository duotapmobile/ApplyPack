import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { canonicalSha256 } from "@/lib/domain/foundation";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { readHistoricalDraftingEvidencePacket } from "@/lib/documents/drafting-evidence-storage";
import { serviceErrorCanonicalJson } from "@/lib/materials/service-error-contract";
import { draftDocumentFixture } from "../fixtures/draft-document";
import { draftReferenceFixture } from "../fixtures/draft-reference";
import { repairFixtureNow, serviceRepairRenderFixture } from "../fixtures/service-repair-render";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function packetBytes(packet: ReturnType<typeof draftDocumentFixture>["input"]["packet"]) { return Buffer.from(serializeDraftingEvidencePacket(packet)); }
function altered(change: (body: Record<string, any>) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const body = JSON.parse(packetBytes(draftDocumentFixture().input.packet).toString()); change(body);
  const bytes = Buffer.from(serviceErrorCanonicalJson(body)); return { bytes, digest: sha(bytes) };
}
describe("exact historical confirmed drafting packet decoding", () => {
  it.each(["VOLUNTEER", "EDUCATION_CERTIFICATION", "PROJECT", "CAREGIVING"] as const)("preserves expired %s evidence and old timestamps without granting current authority", (kind) => {
    const original = draftDocumentFixture(kind).input.packet, bytes = packetBytes(original);
    const read = readHistoricalDraftingEvidencePacket(bytes, original.packetSha256, repairFixtureNow);
    expect(read).toEqual(original); expect(serializeDraftingEvidencePacket(read)).toBe(bytes.toString());
    expect(Date.parse(read.validUntil)).toBeLessThan(repairFixtureNow.getTime());
    expect(read.providerTransferAuthorized).toBe(false); expect(read.approvalState).toBe("UNREVIEWED");
  });
  it("supports the selected-reference historical profile without changing its optional fields", () => {
    const original = draftReferenceFixture(3).input.packet, bytes = packetBytes(original);
    expect(readHistoricalDraftingEvidencePacket(bytes, original.packetSha256, repairFixtureNow)).toEqual(original);
  });
  it("preserves exact public source text and verifies the existing raw question capture profile", () => {
    const original = draftDocumentFixture("VOLUNTEER", "Completed", true).input.packet, bytes = packetBytes(original);
    expect(readHistoricalDraftingEvidencePacket(bytes, original.packetSha256, repairFixtureNow)).toEqual(original);
  });
  it.each([
    ["unknown schema", (body: Record<string, any>) => { body.schemaVersion = "future-v99"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["legacy masquerading as confirmed", (body: Record<string, any>) => { body.confirmationMode = "LEGACY"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["unknown authority field", (body: Record<string, any>) => { body.approved = true; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["missing actual fact evidence", (body: Record<string, any>) => { body.ownerEvidence.facts = []; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["mixed customer contact", (body: Record<string, any>) => { body.ownerEvidence.contactFact.customer_id = "99000000-0000-4000-8000-000000000001"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["changed local job", (body: Record<string, any>) => { body.ownerEvidence.targetJob.contentSha256 = "0".repeat(64); }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["mixed fact snapshot", (body: Record<string, any>) => { body.ownerEvidence.facts[0].snapshot_id = "99000000-0000-4000-8000-000000000002"; }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["duplicate fact", (body: Record<string, any>) => { body.ownerEvidence.facts.push(body.ownerEvidence.facts[0]); }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["provider positive upgrade", (body: Record<string, any>) => { body.providerView.facts[0].disposition = "NEGATIVE_DO_NOT_ASSERT"; body.providerViewSha256 = canonicalSha256(body.providerView); }], // eslint-disable-line @typescript-eslint/no-explicit-any
    ["future confirmation", (body: Record<string, any>) => { body.binding.confirmationReceipt.preparedAt = "2099-01-01T00:00:00.000Z"; body.binding.confirmationReceiptSha256 = canonicalSha256(body.binding.confirmationReceipt); }], // eslint-disable-line @typescript-eslint/no-explicit-any
  ] as const)("rejects %s even with a recomputed outer byte digest", (_name, change) => {
    const input = altered(change); expect(() => readHistoricalDraftingEvidencePacket(input.bytes, input.digest, repairFixtureNow)).toThrow(/^DRAFTING_EVIDENCE_STORAGE_/);
  });
  it("rejects changed bytes, malformed UTF8, over-limit payload and noncanonical byte representations", () => {
    const f = serviceRepairRenderFixture(), bytes = f.evidence().originals[0].packetBytes;
    expect(() => readHistoricalDraftingEvidencePacket(Buffer.concat([bytes, Buffer.from(" ")]), f.packet.packetSha256, repairFixtureNow)).toThrow("BYTES_INVALID");
    for (const changed of [Buffer.from([0xff]), Buffer.alloc(2_000_001), Buffer.from(JSON.stringify(JSON.parse(bytes.toString()), null, 2))]) {
      expect(() => readHistoricalDraftingEvidencePacket(changed, sha(changed), repairFixtureNow)).toThrow(/^DRAFTING_EVIDENCE_STORAGE_/);
    }
  });
});

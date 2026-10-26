import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { draftDocumentFixture } from "../fixtures/draft-document";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { readHistoricalServiceErrorEvidence } from "@/lib/materials/service-error-evidence";
import { serviceErrorCanonicalJson, serviceErrorSha256 } from "@/lib/materials/service-error-contract";
function fixture() {
  const f = draftDocumentFixture(), source = f.build(), packetBytes = Buffer.from(serializeDraftingEvidencePacket(f.input.packet));
  const sourceBytes = Buffer.from(serializeDraftRenderSource(source));
  const input = { packetBytes, sourceBytes, packetSha256: f.input.packet.packetSha256, sourceSha256: source.renderSourceSha256,
    customerId: f.r.purchase.customer_id, materialLineId: f.r.line.id, revisionId: f.r.revision.id, bindingSha256: f.r.revision.binding_sha256,
    snapshotId: f.r.snapshot.id, contactBytes: Buffer.from(f.input.contact.plaintext), artifactType: "RESUME" as const };
  return { f, input, read: () => readHistoricalServiceErrorEvidence(input) };
}
describe("original delivered evidence for service-error investigation", () => {
  it("keeps original expired evidence visible without refreshing or granting rendering authority", () => {
    const f = fixture(), result = f.read();
    expect(result.evidenceMode).toBe("HISTORICAL_DELIVERY_REVIEW"); expect(result.renderingAuthorized).toBe(false);
    expect(result.originalEvidenceValidUntil).toBe(f.f.input.packet.validUntil);
    expect(result.contact.displayName).toBe("Casey Example"); expect(result.facts).toEqual(f.f.input.packet.ownerEvidence.facts);
    expect(result.claims.length).toBeGreaterThan(0); expect(result.claims.every((claim) => claim.placement.startsWith("resume."))).toBe(true);
  });
  it.each(["customerId", "materialLineId", "revisionId", "snapshotId", "bindingSha256"])("rejects mismatched %s even when bytes have valid digests", (field) => {
    const f = fixture(); Object.assign(f.input, { [field]: field.endsWith("Sha256") ? "f".repeat(64) : "96000000-0000-4000-8000-000000000099" });
    expect(f.read).toThrow("DELIVERY_EVIDENCE_UNAVAILABLE");
  });
  it("cannot replace contact facts with a customer's current profile", () => {
    const f = fixture(); f.input.contactBytes = Buffer.from(JSON.stringify({ ...JSON.parse(f.f.input.contact.plaintext.toString("utf8")), displayName: "Changed account name" }));
    expect(f.read).toThrow("DELIVERY_EVIDENCE_UNAVAILABLE");
  });
  it("rejects a changed source body and a self-hashed unsupported wording claim", () => {
    const f = fixture(); f.input.sourceBytes[10] ^= 1; expect(f.read).toThrow("DELIVERY_EVIDENCE_UNAVAILABLE");
    const g = fixture(), value = JSON.parse(g.input.sourceBytes.toString("utf8")); value.ownerReviewClaims[0].text = "Different person";
    g.input.sourceBytes = Buffer.from(serviceErrorCanonicalJson(value)); g.input.sourceSha256 = serviceErrorSha256(g.input.sourceBytes);
    expect(g.read).toThrow("DELIVERY_EVIDENCE_UNAVAILABLE");
  });
  it("does not show another document's prose as evidence for the selected member", () => {
    const f = fixture(); Object.assign(f.input, { artifactType: "COVER_LETTER" });
    const result = f.read(); expect(result.claims.length).toBeGreaterThan(0);
    expect(result.claims.every((claim) => claim.placement.startsWith("coverLetter."))).toBe(true);
  });
  it("preserves source values and parser review records instead of adopting report claims", () => {
    const f = fixture(), value = f.read();
    expect(value.confirmation).toEqual(f.f.input.packet.binding.confirmationReceipt);
    expect(value.sourceReviews).toEqual(f.f.input.packet.ownerEvidence.sourceReviews);
    expect(value.documents).toEqual(f.f.input.packet.ownerEvidence.documents);
    expect(f.input.packetBytes.some((value) => value !== 0)).toBe(true);
  });
});

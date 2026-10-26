import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { draftDocumentFixture } from "../fixtures/draft-document";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { serviceErrorCanonicalJson, serviceErrorSha256 } from "@/lib/materials/service-error-contract";
import { bindServiceRepairOriginals, serviceRepairAcceptedScope, type ServiceRepairAcceptedRow,
  type ServiceRepairOriginalMember } from "@/lib/materials/service-repair-contract";

const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-28T12:00:00.000Z");
function fixture(pair = false) {
  const f = draftDocumentFixture(), source = f.build();
  const acceptedRows: ServiceRepairAcceptedRow[] = [{ id: id(1), case_id: id(2), decision_id: id(3),
    customer_id: f.r.purchase.customer_id, material_line_id: f.r.line.id, source_snapshot_id: f.r.snapshot.id,
    artifact_id: id(4), file_version_id: id(5), release_id: id(6), member_kind: "ACCEPTED_ERROR" }];
  const member: ServiceRepairOriginalMember = { materialLineId: f.r.line.id, sourceSnapshotId: f.r.snapshot.id,
    artifactId: id(4), fileVersionId: id(5), releaseId: id(6), artifactType: "RESUME", checksumSha256: "f".repeat(64),
    draftVersionId: id(7), draftJobId: id(8), packetPayloadId: id(9), packetSha256: f.input.packet.packetSha256,
    sourcePayloadId: id(10), sourceSha256: source.renderSourceSha256, revisionId: f.r.revision.id,
    revisionVersion: f.r.revision.version, bindingSha256: f.r.revision.binding_sha256,
    approvedAt: "2026-10-25T12:02:00.000Z", deliveredAt: "2026-10-25T12:03:00.000Z" };
  const original = { member, packetBytes: Buffer.from(serializeDraftingEvidencePacket(f.input.packet)), sourceBytes: Buffer.from(serializeDraftRenderSource(source)) };
  const originals = [original];
  if (pair) {
    acceptedRows.push({ ...acceptedRows[0], id: id(11), artifact_id: id(12), file_version_id: id(13) });
    originals.push({ member: { ...member, artifactId: id(12), fileVersionId: id(13), artifactType: "COVER_LETTER" },
      packetBytes: Buffer.from(original.packetBytes), sourceBytes: Buffer.from(original.sourceBytes) });
  }
  const identity = { caseId: id(2), customerId: f.r.purchase.customer_id };
  const input = { ...identity, materialLineId: f.r.line.id, acceptedScopeSha256: serviceRepairAcceptedScope(identity, acceptedRows).acceptedScopeSha256, acceptedRows, originals };
  return { f, source, input, read: () => bindServiceRepairOriginals(input, now),
    refreshScope: () => { input.acceptedScopeSha256 = serviceRepairAcceptedScope(identity, input.acceptedRows).acceptedScopeSha256; } };
}

describe("accepted service-error scope", () => {
  it("rejects a wider identity DTO rather than silently accepting extra authority fields", () => {
    const f = fixture(true);
    expect(() => serviceRepairAcceptedScope(f.input, f.input.acceptedRows)).toThrow("SERVICE_REPAIR_SCOPE_INVALID");
  });
  it("is stable across row ordering and repeated acceptance while retaining both receipt IDs", () => {
    const f = fixture(true), identity = { caseId: f.input.caseId, customerId: f.input.customerId };
    const initial = serviceRepairAcceptedScope(identity, f.input.acceptedRows);
    f.input.acceptedRows.push({ ...f.input.acceptedRows[0], id: id(20), decision_id: id(21) });
    const expanded = serviceRepairAcceptedScope(identity, [...f.input.acceptedRows].reverse());
    expect(expanded.acceptedScopeSha256).toBe(initial.acceptedScopeSha256);
    expect(expanded.members).toEqual(initial.members);
    expect(expanded.acceptances.find((entry) => entry.fileVersionId === id(5))?.records).toEqual([
      { affectedMemberId: id(1), decisionId: id(3) }, { affectedMemberId: id(20), decisionId: id(21) },
    ]);
  });
  it("cannot substitute only the newest decision for the full accepted union", () => {
    const f = fixture(true); f.input.acceptedRows.pop(); f.input.originals.pop();
    expect(f.read).toThrow("SERVICE_REPAIR_SCOPE_CHANGED");
  });
  it("includes accepted work on another line in the case digest without loading its private bytes", () => {
    const f = fixture(), other = { ...f.input.acceptedRows[0], id: id(30), material_line_id: id(31), source_snapshot_id: id(32), artifact_id: id(33), file_version_id: id(34) };
    f.input.acceptedRows.push(other); f.refreshScope();
    const result = f.read(); expect(result.members).toHaveLength(1);
    f.input.acceptedRows.pop(); expect(f.read).toThrow("SERVICE_REPAIR_SCOPE_CHANGED");
  });
  it.each(["customer_id", "case_id"])("rejects cross-owner %s rows", (key) => {
    const f = fixture(); Object.assign(f.input.acceptedRows[0], { [key]: id(99) });
    expect(f.read).toThrow("SERVICE_REPAIR_SCOPE_OWNER_MISMATCH");
  });
  it.each(["id", "decision"])("rejects duplicate %s rows", (mode) => {
    const f = fixture(); f.input.acceptedRows.push({ ...f.input.acceptedRows[0], ...(mode === "id" ? {} : { id: id(99) }) });
    expect(f.read).toThrow("SERVICE_REPAIR_SCOPE_DUPLICATE");
  });
  it("rejects inconsistent history for the same file instead of selecting a convenient row", () => {
    const f = fixture(); f.input.acceptedRows.push({ ...f.input.acceptedRows[0], id: id(98), decision_id: id(99), source_snapshot_id: id(97) });
    expect(f.read).toThrow("SERVICE_REPAIR_SCOPE_MEMBER_CONFLICT");
  });
  it("does not let a reported or denied request become accepted authority", () => {
    const f = fixture(); Object.assign(f.input.acceptedRows[0], { member_kind: "REPORTED", decision_id: null });
    expect(f.read).toThrow("SERVICE_REPAIR_SCOPE_INVALID");
  });
});

describe("original bytes for a separately authorized service repair", () => {
  it("binds expired original evidence without renewing the packet or paid due time", () => {
    const f = fixture(), packetBefore = Buffer.from(f.input.originals[0].packetBytes), sourceBefore = Buffer.from(f.input.originals[0].sourceBytes);
    const plan = f.read();
    expect(Date.parse(plan.members[0].originalEvidenceValidUntil)).toBeLessThan(now.getTime());
    expect(plan.members[0].originalEvidenceValidUntil).toBe(f.f.input.packet.validUntil);
    expect(plan).toMatchObject({ state: "OWNER_REVIEW_REQUIRED", renderingAuthorized: false, approvalAuthorized: false,
      deliveryAuthorized: false, paidDeadlineChanged: false, accessRefreshed: false });
    expect(f.input.originals[0].packetBytes.equals(packetBefore)).toBe(true);
    expect(f.input.originals[0].sourceBytes.equals(sourceBefore)).toBe(true);
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("Casey Example"); expect(serialized).not.toContain("casey@example.test");
    expect(serialized).not.toContain("Organized event schedules");
    expect(plan.originalBindingSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("binds only affected artifact claims and does not include an unaffected letter", () => {
    const f = fixture(), plan = f.read();
    expect(plan.members).toHaveLength(1); expect(plan.members[0].artifactType).toBe("RESUME");
    expect(plan.members[0].originalClaimIds).toEqual(f.source.ownerReviewClaims.filter((claim) => claim.placement.startsWith("resume.")).map((claim) => claim.claimId));
  });
  it("requires each accepted member exactly once even when two members share one original source", () => {
    const f = fixture(true); expect(f.read().members).toHaveLength(2);
    f.input.originals[1] = f.input.originals[0]; expect(f.read).toThrow("SERVICE_REPAIR_MEMBERS_INCOMPLETE");
  });
  it.each(["missing", "extra"])("rejects %s loaded members", (mode) => {
    const f = fixture(); if (mode === "missing") f.input.originals = []; else f.input.originals.push(f.input.originals[0]);
    expect(f.read).toThrow("SERVICE_REPAIR_MEMBERS_INCOMPLETE");
  });
  it.each(["artifactId", "fileVersionId", "releaseId", "materialLineId", "sourceSnapshotId"])("binds the exact accepted %s", (key) => {
    const f = fixture(); Object.assign(f.input.originals[0].member, { [key]: id(99) });
    expect(f.read).toThrow("SERVICE_REPAIR_MEMBER_NOT_ACCEPTED");
  });
  it.each(["packetBytes", "sourceBytes"] as const)("rejects changed %s before parsing", (key) => {
    const f = fixture(); f.input.originals[0][key][20] ^= 1;
    expect(f.read).toThrow("SERVICE_REPAIR_ORIGINAL_HASH_MISMATCH");
  });
  it.each(["revisionId", "bindingSha256", "revisionVersion"])("rejects independently valid bytes from another %s", (key) => {
    const f = fixture(); Object.assign(f.input.originals[0].member, { [key]: key === "bindingSha256" ? "d".repeat(64) : key === "revisionVersion" ? 2 : id(99) });
    expect(f.read).toThrow("SERVICE_REPAIR_ORIGINAL_BINDING_MISMATCH");
  });
  it("rejects a substituted contact binding even when the altered source hash is supplied", () => {
    const f = fixture(), original = f.input.originals[0], source = JSON.parse(original.sourceBytes.toString("utf8"));
    source.contactPayloadId = id(99); original.sourceBytes = Buffer.from(serviceErrorCanonicalJson(source)); original.member.sourceSha256 = serviceErrorSha256(original.sourceBytes);
    expect(f.read).toThrow("SERVICE_REPAIR_ORIGINAL_BINDING_MISMATCH");
  });
  it("rejects source text that no longer matches its immutable wording hash", () => {
    const f = fixture(), original = f.input.originals[0], source = JSON.parse(original.sourceBytes.toString("utf8"));
    source.ownerReviewClaims[0].text = "Newly claimed team lead"; original.sourceBytes = Buffer.from(serviceErrorCanonicalJson(source)); original.member.sourceSha256 = serviceErrorSha256(original.sourceBytes);
    expect(f.read).toThrow("SERVICE_REPAIR_ORIGINAL_CLAIMS_INVALID");
  });
  it("cannot label a pair-only source as an affected reference sheet", () => {
    const f = fixture(); f.input.originals[0].member.artifactType = "REFERENCE_SHEET";
    expect(f.read).toThrow("SERVICE_REPAIR_ORIGINAL_ARTIFACT_MISSING");
  });
  it.each(["approval-before-source", "delivery-before-approval", "future-delivery"])("rejects %s chronology", (mode) => {
    const f = fixture(); Object.assign(f.input.originals[0].member, mode === "approval-before-source" ? { approvedAt: "2026-10-24T00:00:00.000Z" }
      : mode === "delivery-before-approval" ? { deliveredAt: "2026-10-25T12:01:00.000Z" } : { deliveredAt: "2026-10-29T00:00:00.000Z" });
    expect(f.read).toThrow("SERVICE_REPAIR_ORIGINAL_TIMELINE_INVALID");
  });
  it("rejects inconsistent payload identities for members of the same saved version", () => {
    const f = fixture(true); f.input.originals[1].member.packetPayloadId = id(99);
    expect(f.read).toThrow("SERVICE_REPAIR_ORIGINAL_VERSION_CONFLICT");
  });
  it("keeps distinct accepted historical sources without silently dropping an older affected version", () => {
    const f = fixture(true); f.input.originals[1].member.draftVersionId = id(99);
    expect(f.read().members.map((member) => member.draftVersionId)).toEqual([id(7), id(99)]);
  });
  it("returns detached metadata and preserves caller buffers on failure", () => {
    const f = fixture(), result = f.read(); f.input.acceptedRows[0].id = id(99); f.input.originals[0].member.artifactId = id(98);
    expect(result.members[0].artifactId).toBe(id(4)); expect(result.members[0].acceptances[0].affectedMemberId).toBe(id(1));
    expect(f.input.originals[0].sourceBytes.some((byte) => byte !== 0)).toBe(true);
    expect(f.read).toThrow(); expect(f.input.originals[0].packetBytes.some((byte) => byte !== 0)).toBe(true);
  });
  it("rejects an invalid current clock without substituting the historical clock", () => {
    const f = fixture(); expect(() => bindServiceRepairOriginals(f.input, new Date("invalid"))).toThrow("SERVICE_REPAIR_CLOCK_INVALID");
  });
});

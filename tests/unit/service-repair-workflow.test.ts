import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { serviceRepairAcceptedScope } from "@/lib/materials/service-repair-contract";
import { openServiceRepair, validateServiceRepairInspection, type ServiceRepairOpenPort,
  type ServiceRepairVersion } from "@/lib/materials/service-repair-workflow";

const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const time = "2026-10-25T12:00:00.000Z";
function fixture() {
  const acceptedRows = [{ id: id(1), case_id: id(2), decision_id: id(3), customer_id: id(4), material_line_id: id(5),
    source_snapshot_id: id(6), artifact_id: id(7), file_version_id: id(8), release_id: id(9), member_kind: "ACCEPTED_ERROR" as const }];
  const normalized = serviceRepairAcceptedScope({ caseId: id(2), customerId: id(4) }, acceptedRows);
  const scope = { schemaVersion: normalized.schemaVersion, caseId: normalized.caseId, customerId: normalized.customerId,
    members: normalized.members, acceptedScopeSha256: normalized.acceptedScopeSha256 };
  const original = { ...scope.members[0], artifactType: "RESUME" as const, checksumSha256: "a".repeat(64), draftVersionId: id(10),
    draftJobId: id(11), packetPayloadId: id(12), packetSha256: "b".repeat(64), sourcePayloadId: id(13), sourceSha256: "c".repeat(64),
    revisionId: id(14), revisionVersion: 1, bindingSha256: "d".repeat(64), approvedAt: time, deliveredAt: time };
  const inspection = { scope, acceptedRows, originals: [original], contextSha256: "e".repeat(64), job: null, version: null,
    latestRepairs: [] as Array<{ originalFileVersionId: string; fileVersionId: string; releaseId: string; artifactId: string; artifactType: "RESUME";
      checksumSha256: string; renderSourceSha256: string; repairVersionId: string; sourcePayloadId: string; sourceSha256: string; approvedAt: string; deliveredAt: string }>, feedback: [] };
  const reviewer = id(15), request = { requestId: id(16), caseId: scope.caseId, materialLineId: id(5), expectedVersionId: null,
    acceptedScopeSha256: scope.acceptedScopeSha256, contextSha256: inspection.contextSha256 };
  const version: ServiceRepairVersion = { id: id(17), request_id: request.requestId, job_id: id(18), case_id: request.caseId,
    customer_id: scope.customerId, material_line_id: request.materialLineId, version: 1, supersedes_id: null,
    accepted_scope_sha256: scope.acceptedScopeSha256, originals: [original], context_sha256: inspection.contextSha256,
    encrypted_payload_id: null, source_sha256: null, claim_review_encrypted_payload_id: null, claim_review_sha256: null,
    claim_review_metadata: null, claims_reviewed_by: null, claims_reviewed_at: null, member_set_sha256: null,
    approval_sha256: null, review_checklist: null, approved_by: null, approved_at: null, release_id: null,
    invalidated_at: null, created_by: reviewer, created_at: time };
  let stored: unknown = null;
  const port = {
    requireReviewer: vi.fn(async () => true), inspect: vi.fn(async () => inspection),
    readVersion: vi.fn(async () => stored), open: vi.fn(async () => { stored = structuredClone(version); return version.id; }),
  } satisfies ServiceRepairOpenPort;
  return { acceptedRows, inspection, request, version, reviewer, port, store: (value: unknown) => { stored = value; },
    run: (signal?: AbortSignal) => openServiceRepair(port, reviewer, request, { signal }) };
}

describe("repair authority projection", () => {
  it("recomputes the complete accepted union without discarding older accepted rows", () => {
    const f = fixture(); expect(validateServiceRepairInspection(f.inspection, { caseId: id(2), materialLineId: id(5) }).scope).toEqual(f.inspection.scope);
    f.acceptedRows.push({ ...f.acceptedRows[0], id: id(30), decision_id: id(31), file_version_id: id(32), artifact_id: id(33) });
    expect(() => validateServiceRepairInspection(f.inspection, { caseId: id(2), materialLineId: id(5) })).toThrow("SCOPE_CHANGED");
  });
  it("rejects foreign, missing, extra and duplicated original members", () => {
    for (const alter of [
      (f: ReturnType<typeof fixture>) => { f.inspection.originals[0].sourceSnapshotId = id(99); },
      (f: ReturnType<typeof fixture>) => { f.inspection.originals.length = 0; },
      (f: ReturnType<typeof fixture>) => { f.inspection.originals.push({ ...f.inspection.originals[0] }); },
    ]) {
      const f = fixture(); alter(f);
      expect(() => validateServiceRepairInspection(f.inspection, { caseId: id(2), materialLineId: id(5) })).toThrow();
    }
  });
  it("does not accept a caller's fabricated render or payment authority", () => {
    const f = fixture();
    expect(() => validateServiceRepairInspection({ ...f.inspection, renderingAuthorized: true }, { caseId: id(2), materialLineId: id(5) })).toThrow("RECEIPT_INVALID");
  });
  it("keeps latest repaired bytes separate from the original confirmed-source identity", () => {
    const f = fixture(); f.inspection.latestRepairs.push({ originalFileVersionId: id(8), fileVersionId: id(40), releaseId: id(41), artifactId: id(7), artifactType: "RESUME",
      checksumSha256: "0".repeat(64), renderSourceSha256: "2".repeat(64), repairVersionId: id(42), sourcePayloadId: id(43), sourceSha256: "1".repeat(64), approvedAt: time, deliveredAt: time });
    const checked = validateServiceRepairInspection(f.inspection, { caseId: id(2), materialLineId: id(5) });
    expect(checked.originals[0].fileVersionId).toBe(id(8)); expect(checked.latestRepairs[0].fileVersionId).toBe(id(40));
    f.inspection.latestRepairs[0].originalFileVersionId = id(99);
    expect(() => validateServiceRepairInspection(f.inspection, { caseId: id(2), materialLineId: id(5) })).toThrow("LATEST_REPAIR_MISMATCH");
  });
});

describe("owner repair opening and uncertain-response reconciliation", () => {
  it("opens once, proves the recorded identities, and grants neither render nor delivery", async () => {
    const f = fixture(), result = await f.run();
    expect(result).toEqual({ version: f.version, replayed: false, renderingAuthorized: false, deliveryAuthorized: false });
    expect(f.port.open).toHaveBeenCalledExactlyOnceWith({ ...f.request, reviewerId: f.reviewer }, expect.any(AbortSignal));
    expect(f.port.readVersion).toHaveBeenCalledTimes(2);
  });
  it("reconciles the exact same request after a lost commit response without a second mutation", async () => {
    const f = fixture(); f.port.open.mockImplementation(async () => { f.store(structuredClone(f.version)); throw new Error("private database body"); });
    expect((await f.run()).version.id).toBe(f.version.id);
    expect((await f.run()).replayed).toBe(true);
    expect(f.port.open).toHaveBeenCalledTimes(1);
  });
  it("returns historical same-ID evidence even after later release without refreshing source clocks", async () => {
    const f = fixture(), historical = { ...f.version, release_id: id(22), invalidated_at: "2026-11-30T12:00:00Z" };
    f.store(historical); f.port.inspect.mockImplementation(async () => { throw new Error("stale context"); });
    expect(await f.run()).toEqual({ version: historical, replayed: true, renderingAuthorized: false, deliveryAuthorized: false });
    expect(f.port.inspect).not.toHaveBeenCalled(); expect(f.port.open).not.toHaveBeenCalled();
  });
  it.each([false, null, {}, "true"])("rejects malformed reviewer success %s before private reads", async (value) => {
    const f = fixture(); f.port.requireReviewer.mockResolvedValue(value as never);
    await expect(f.run()).rejects.toThrow("REVIEWER_UNCONFIRMED"); expect(f.port.readVersion).not.toHaveBeenCalled();
  });
  it("rejects a stale scope/context before mutation", async () => {
    const f = fixture(); f.request.contextSha256 = "0".repeat(64);
    await expect(f.run()).rejects.toThrow("CONTEXT_CHANGED"); expect(f.port.open).not.toHaveBeenCalled();
  });
  it.each(["request_id", "case_id", "material_line_id", "created_by"])("rejects conflicting same-ID receipt %s", async (field) => {
    const f = fixture(); f.store({ ...f.version, [field]: id(99) });
    await expect(f.run()).rejects.toThrow("REQUEST_CONFLICT"); expect(f.port.open).not.toHaveBeenCalled();
  });
  it.each(["customer_id", "originals", "version"])("rejects mixed new receipt %s", async (field) => {
    const f = fixture(); f.port.open.mockImplementation(async () => {
      f.store({ ...f.version, [field]: field === "version" ? 2 : field === "originals" ? [{ ...f.version.originals[0], artifactId: id(99) }] : id(99) });
      return f.version.id;
    });
    await expect(f.run()).rejects.toThrow("RECEIPT_INVALID"); expect(f.port.open).toHaveBeenCalledTimes(1);
  });
  it("does not treat an echoed UUID as committed when exact readback is missing", async () => {
    const f = fixture(); f.port.open.mockImplementation(async () => f.version.id);
    await expect(f.run()).rejects.toThrow("UNCONFIRMED"); expect(f.port.open).toHaveBeenCalledTimes(1);
  });
  it("redacts a transport error and never blindly retries", async () => {
    const f = fixture(); f.port.open.mockRejectedValue(new Error("candidate private phone 5551234567"));
    await expect(f.run()).rejects.toThrow("SERVICE_REPAIR_UNCONFIRMED"); expect(f.port.open).toHaveBeenCalledTimes(1);
  });
  it("cancels a hung transport and prevents its late continuation from mutating", async () => {
    const f = fixture(); let release!: (value: boolean) => void;
    f.port.requireReviewer.mockImplementation(() => new Promise<boolean>((resolve) => { release = resolve; }));
    const controller = new AbortController(), running = f.run(controller.signal); controller.abort();
    await expect(running).rejects.toThrow("UNCONFIRMED"); release(true); await Promise.resolve(); await Promise.resolve();
    expect(f.port.readVersion).not.toHaveBeenCalled(); expect(f.port.open).not.toHaveBeenCalled();
  });
  it("has a bounded default-independent deadline for a transport that ignores abort", async () => {
    const f = fixture(); f.port.readVersion.mockImplementation(() => new Promise(() => {}));
    await expect(openServiceRepair(f.port, f.reviewer, f.request, { timeoutMs: 10 })).rejects.toThrow("UNCONFIRMED");
    expect(f.port.open).not.toHaveBeenCalled();
  });
});

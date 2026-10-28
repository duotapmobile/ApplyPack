import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createServiceRepairStore } from "@/lib/materials/service-repair-store";
import { serviceRepairAcceptedScope } from "@/lib/materials/service-repair-contract";
import { openServiceRepair, type ServiceRepairVersion } from "@/lib/materials/service-repair-workflow";

const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const signal = () => new AbortController().signal, time = "2026-10-25T12:00:00.000Z";
type Result = { data: unknown; error: unknown };
type Call = { name: string; args: Record<string, unknown>; signal?: AbortSignal };
function fixture() {
  const acceptedRows = [{ id: id(1), case_id: id(2), decision_id: id(3), customer_id: id(4), material_line_id: id(5),
    source_snapshot_id: id(6), artifact_id: id(7), file_version_id: id(8), release_id: id(9), member_kind: "ACCEPTED_ERROR" as const }];
  const normalized = serviceRepairAcceptedScope({ caseId: id(2), customerId: id(4) }, acceptedRows);
  const scope = { schemaVersion: normalized.schemaVersion, caseId: normalized.caseId, customerId: normalized.customerId,
    members: normalized.members, acceptedScopeSha256: normalized.acceptedScopeSha256 };
  const original = { ...scope.members[0], artifactType: "COVER_LETTER" as const, checksumSha256: "a".repeat(64), draftVersionId: id(10),
    draftJobId: id(11), packetPayloadId: id(12), packetSha256: "b".repeat(64), sourcePayloadId: id(13), sourceSha256: "c".repeat(64),
    revisionId: id(14), revisionVersion: 1, bindingSha256: "d".repeat(64), approvedAt: time, deliveredAt: time };
  const inspection = { scope, acceptedRows, originals: [original], contextSha256: "e".repeat(64), job: null, version: null, latestRepairs: [], feedback: [] };
  const reviewer = id(15), request = { requestId: id(16), caseId: scope.caseId, materialLineId: id(5), expectedVersionId: null,
    acceptedScopeSha256: scope.acceptedScopeSha256, contextSha256: inspection.contextSha256 };
  const version: ServiceRepairVersion = { id: id(17), request_id: request.requestId, job_id: id(18), case_id: request.caseId,
    customer_id: scope.customerId, material_line_id: request.materialLineId, version: 1, supersedes_id: null,
    accepted_scope_sha256: scope.acceptedScopeSha256, originals: [original], context_sha256: inspection.contextSha256,
    encrypted_payload_id: null, source_sha256: null, claim_review_encrypted_payload_id: null, claim_review_sha256: null,
    claim_review_metadata: null, claims_reviewed_by: null, claims_reviewed_at: null, member_set_sha256: null,
    approval_sha256: null, review_checklist: null, approved_by: null, approved_at: null, release_id: null,
    invalidated_at: null, created_by: reviewer, created_at: time };
  const calls: Call[] = []; let stored: unknown = null;
  const normal = async (call: Call): Promise<Result> => {
    if (call.name === "ap_require_material_reviewer") return { data: true, error: null };
    if (call.name === "ap_inspect_service_repair") return { data: structuredClone(inspection), error: null };
    if (call.name === "ap_read_service_repair_version") return { data: stored, error: null };
    if (call.name === "ap_open_service_repair") { stored = structuredClone(version); return { data: version.id, error: null }; }
    throw Error("unexpected RPC");
  };
  let respond = normal;
  const admin = { rpc: (name: string, args: Record<string, unknown>) => {
    const call: Call = { name, args }; calls.push(call);
    const query = { abortSignal: (value: AbortSignal) => { call.signal = value; return query; },
      then: (resolve: (value: Result) => unknown, reject?: (value: unknown) => unknown) => respond(call).then(resolve, reject) };
    return query;
  } } as unknown as SupabaseClient<Database>;
  const store = createServiceRepairStore(admin);
  return { calls, store, inspection, request, version, reviewer, normal,
    set: (fn: typeof normal) => { respond = fn; }, stored: (value: unknown) => { stored = value; },
    open: () => store.open({ ...request, reviewerId: reviewer }, signal()),
    run: () => openServiceRepair(store, reviewer, request) };
}
afterEach(() => vi.useRealTimers());

describe("generated099 repair transport", () => {
  it("does no work during construction and binds the exact reviewer RPC", async () => {
    const f = fixture(); expect(f.calls).toEqual([]);
    expect(await f.store.requireReviewer(f.reviewer, signal())).toBe(true);
    expect(f.calls[0]).toMatchObject({ name: "ap_require_material_reviewer", args: { p_reviewer_id: f.reviewer }, signal: expect.any(AbortSignal) });
  });
  it.each([false, null, "true", {}])("rejects malformed reviewer success %# before opening or reading private work", async (value) => {
    const f = fixture(); f.set(async () => ({ data: value, error: null }));
    await expect(f.run()).rejects.toThrow("SERVICE_REPAIR_UNCONFIRMED");
    expect(f.calls.map(call => call.name)).toEqual(["ap_require_material_reviewer"]);
  });
  it("checks the authoritative complete union rather than accepting a truncated inspection", async () => {
    const f = fixture();
    expect(await f.store.inspect(f.request.caseId, f.request.materialLineId, f.reviewer, signal())).toEqual(f.inspection);
    expect(f.calls[0]).toMatchObject({ name: "ap_inspect_service_repair", args: { p_case_id: f.request.caseId,
      p_material_line_id: f.request.materialLineId, p_reviewer_id: f.reviewer } });
    f.set(async () => ({ data: { ...f.inspection, acceptedRows: [] }, error: null }));
    await expect(f.store.inspect(f.request.caseId, f.request.materialLineId, f.reviewer, signal())).rejects.toThrow("RECEIPT_INVALID");
  });
  it("rejects a structurally valid inspection of a different case", async () => {
    const f = fixture();
    await expect(f.store.inspect(id(99), f.request.materialLineId, f.reviewer, signal())).rejects.toThrow("RECEIPT_INVALID");
  });
  it("preserves exact request absence and validates the returned immutable request identity", async () => {
    const f = fixture();
    expect(await f.store.readVersion(f.request.requestId, f.reviewer, signal())).toBeNull();
    f.stored(f.version); expect(await f.store.readVersion(f.request.requestId, f.reviewer, signal())).toEqual(f.version);
    f.stored({ ...f.version, request_id: id(99) });
    await expect(f.store.readVersion(f.request.requestId, f.reviewer, signal())).rejects.toThrow("RECEIPT_INVALID");
  });
  it("sends real SQL NULL for the initial predecessor and never omits it", async () => {
    const f = fixture(); expect(await f.open()).toBe(f.version.id);
    expect(f.calls).toEqual([{ name: "ap_open_service_repair", args: {
      p_case_id: f.request.caseId, p_material_line_id: f.request.materialLineId, p_request_id: f.request.requestId,
      p_expected_version_id: null, p_scope_sha256: f.request.acceptedScopeSha256, p_context_sha256: f.request.contextSha256,
      p_reviewer_id: f.reviewer,
    }, signal: expect.any(AbortSignal) }]);
  });
  it("passes an existing predecessor exactly and detaches the caller's mutable request", async () => {
    const f = fixture(), request = { ...f.request, expectedVersionId: id(30), reviewerId: f.reviewer };
    const running = f.store.open(request, signal()); request.expectedVersionId = id(31); request.reviewerId = id(32);
    await running; expect(f.calls[0].args).toMatchObject({ p_expected_version_id: id(30), p_reviewer_id: f.reviewer });
  });
  it.each([null, false, {}, "not-a-uuid"])("rejects malformed mutation acknowledgement %# with no retry", async (value) => {
    const f = fixture(); f.set(async () => ({ data: value, error: null }));
    await expect(f.open()).rejects.toThrow("RECEIPT_INVALID"); expect(f.calls).toHaveLength(1);
  });
  it("reconciles a commit followed by a lost response through exact request reads only", async () => {
    const f = fixture(); f.set(async (call) => {
      const result = await f.normal(call);
      if (call.name === "ap_open_service_repair") throw new Error("private provider response");
      return result;
    });
    const result = await f.run(); expect(result).toMatchObject({ version: f.version, replayed: false, renderingAuthorized: false, deliveryAuthorized: false });
    expect(f.calls.map(call => call.name)).toEqual(["ap_require_material_reviewer", "ap_read_service_repair_version",
      "ap_inspect_service_repair", "ap_open_service_repair", "ap_read_service_repair_version"]);
    expect((await f.run()).replayed).toBe(true);
    expect(f.calls.filter(call => call.name === "ap_open_service_repair")).toHaveLength(1);
  });
  it("does not accept an acknowledgement without a persisted receipt", async () => {
    const f = fixture(); f.set(async call => call.name === "ap_open_service_repair" ? { data: f.version.id, error: null } : f.normal(call));
    await expect(f.run()).rejects.toThrow("UNCONFIRMED");
    expect(f.calls.filter(call => call.name === "ap_open_service_repair")).toHaveLength(1);
  });
  it("sanitizes SQL errors, rejects unexpected authority fields and validates before I/O", async () => {
    const f = fixture();
    await expect(f.store.open({ ...f.request, reviewerId: f.reviewer, approved: true } as typeof f.request & { reviewerId: string }, signal())).rejects.toThrow("INPUT_INVALID");
    await expect(f.store.readVersion("invalid", f.reviewer, signal())).rejects.toThrow("INPUT_INVALID"); expect(f.calls).toEqual([]);
    f.set(async () => ({ data: null, error: { message: "private customer phone", code: "P0001" } }));
    await expect(f.open()).rejects.toThrow(/^SERVICE_REPAIR_TRANSPORT_UNCONFIRMED$/); expect(f.calls).toHaveLength(1);
  });
  it("cancels a hung transport within twenty seconds without another mutation", async () => {
    vi.useFakeTimers(); const f = fixture(); f.set(() => new Promise(() => undefined));
    const running = expect(f.open()).rejects.toThrow("ABORTED");
    await vi.advanceTimersByTimeAsync(20_001); await running;
    expect(f.calls).toHaveLength(1); expect(f.calls[0].signal?.aborted).toBe(true);
  });
  it("rejects pre-cancellation without I/O and ignores success arriving after cancellation", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.store.open({ ...f.request, reviewerId: f.reviewer }, controller.signal)).rejects.toThrow("ABORTED"); expect(f.calls).toEqual([]);
    const active = new AbortController(); f.set(async () => { active.abort(); return { data: f.version.id, error: null }; });
    await expect(f.store.open({ ...f.request, reviewerId: f.reviewer }, active.signal)).rejects.toThrow("ABORTED"); expect(f.calls).toHaveLength(1);
  });
});

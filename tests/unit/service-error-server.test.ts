import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
vi.mock("server-only", () => ({}));
const payload = vi.hoisted(() => ({ read: vi.fn(), store: vi.fn() }));
vi.mock("@/lib/materials/service-error-payload", async (original) => ({ ...await original<typeof import("@/lib/materials/service-error-payload")>(),
  readServiceErrorPayload: payload.read, storeServiceErrorPayload: payload.store }));
import { createCustomerServiceErrors, createOwnerServiceErrors } from "@/lib/materials/service-error-server";
import { serviceErrorReportPayload, serviceErrorSha256 } from "@/lib/materials/service-error-contract";
const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const customerId = id(1), reviewerId = id(2), caseId = id(3), materialLineId = id(4);
  const members = [{ artifactId: id(5), fileVersionId: id(6), releaseId: id(7) }];
  const body = { requestId: id(8), materialLineId, items: [{ ...members[0], field: "Name", documentText: "Wrong name", expectedFact: "Confirmed name" }] };
  const originalBytes = serviceErrorReportPayload(body), report = { caseId, requestId: body.requestId, customerId, materialLineId,
    payloadId: id(9), reportSha256: serviceErrorSha256(originalBytes), reportDeadline: "2026-10-28T12:00:00Z", reportedAt: "2026-10-25T12:00:00Z",
    state: "OPEN", latestDecisionId: null, members };
  const contract = { materialLineId, customerId, purchaseId: id(10), sourceSnapshotId: id(11), legalReceiptId: id(12), intakeReviewId: id(13),
    intakeReviewSha256: "a".repeat(64), contractVersion: "service-error-only-v1", termsVersion: "manual-launch-terms-2026-10-25-v4",
    termsContentSha256: "b".repeat(64), privacyVersion: "privacy-2026-10-25-v4", privacyContentSha256: "c".repeat(64),
    confirmedIntakeVersion: "applypack-confirmed-intake-v1", reportingTimeZone: "America/New_York", boundAt: "2026-10-20T12:00:00Z" };
  const inspection = { report, contract, decisions: [] }, calls: { name: string; args: unknown; signal: AbortSignal }[] = [];
  let reviewer: unknown = true, after: (() => void) | undefined;
  const rpc = vi.fn((name: string, args: unknown) => ({ abortSignal: async (signal: AbortSignal) => {
    calls.push({ name, args, signal });
    const result = name === "ap_require_material_reviewer" ? reviewer : name === "ap_inspect_material_service_error" ? structuredClone(inspection)
      : name === "ap_read_material_service_error_report" ? structuredClone(report) : null;
    after?.(); return { data: result, error: null };
  } }));
  const admin = { rpc } as unknown as SupabaseClient<Database>, buffers: Buffer[] = [];
  payload.read.mockImplementation(async () => { const bytes = Buffer.from(originalBytes); buffers.push(bytes); return bytes; });
  return { customerId, reviewerId, materialLineId, caseId, members, body, report, contract, inspection, calls, rpc, admin, buffers,
    role: (value: unknown) => { reviewer = value; }, change: (callback: () => void) => { after = callback; },
    owner: createOwnerServiceErrors(admin, reviewerId), customer: createCustomerServiceErrors(admin, customerId) };
}
beforeEach(() => vi.clearAllMocks());
describe("service-error authenticated database adapter", () => {
  it("performs no I/O at construction", () => { const f = fixture(); expect(f.rpc).not.toHaveBeenCalled(); expect(payload.read).not.toHaveBeenCalled(); });
  it.each([false, null, {}, "true"])("requires the exact reviewer receipt before private reads (%j)", async (value) => {
    const f = fixture(); f.role(value); await expect(f.owner.inspect(f.caseId, new AbortController().signal)).rejects.toThrow("REVIEWER_UNCONFIRMED");
    expect(payload.read).not.toHaveBeenCalled(); expect(f.calls.map((call) => call.name)).toEqual(["ap_require_material_reviewer"]);
  });
  it("reads a purpose-bound original report and rechecks the case before displaying it", async () => {
    const f = fixture(), value = await f.owner.inspect(f.caseId, new AbortController().signal);
    expect(value.reportBody).toEqual(f.body); expect(value.repairAuthorized).toBe(false);
    expect(payload.read).toHaveBeenCalledWith(f.admin, expect.objectContaining({ customerId: f.customerId, materialLineId: f.materialLineId,
      requestId: f.body.requestId, payloadId: f.report.payloadId, purpose: "MATERIAL_SERVICE_ERROR_REPORT", sha256: f.report.reportSha256 }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(f.calls.filter((call) => call.name === "ap_inspect_material_service_error")).toHaveLength(2);
    expect(f.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it("rejects a case changed after decryption and clears all owned buffers", async () => {
    const f = fixture(); payload.read.mockImplementation(async () => { f.report.state = "RESOLVED"; const bytes = serviceErrorReportPayload(f.body); f.buffers.push(bytes); return bytes; });
    await expect(f.owner.inspect(f.caseId, new AbortController().signal)).rejects.toThrow("CASE_CHANGED");
    expect(f.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it("rejects a valid private payload belonging to different document details", async () => {
    const f = fixture(); payload.read.mockImplementation(async () => { const bytes = serviceErrorReportPayload({ ...f.body, materialLineId: id(99) }); f.buffers.push(bytes); return bytes; });
    await expect(f.owner.inspect(f.caseId, new AbortController().signal)).rejects.toThrow("REPORT_PAYLOAD_INVALID");
    expect(f.buffers[0].every((byte) => byte === 0)).toBe(true);
  });
  it("binds customer reads to trusted server identity and rejects a foreign receipt", async () => {
    const f = fixture(); expect(await f.customer.receipt(f.body.requestId, new AbortController().signal)).toEqual(f.report);
    expect(f.calls[0].args).toEqual({ p_customer_id: f.customerId, p_request_id: f.body.requestId });
    f.report.customerId = id(99); await expect(f.customer.receipt(f.body.requestId, new AbortController().signal)).rejects.toThrow("OWNERSHIP_MISMATCH");
  });
  it("preserves first-decision NULL and structured evidence in the actual generated RPC boundary", async () => {
    const f = fixture(), decision = { requestId: id(20), caseId: f.caseId, expectedDecisionId: null,
      classification: "CONFIRMED_SERVICE_ERROR", reasonCode: "CONFIRMED_SOURCE_MISMATCH",
      explanation: "The delivered name differs from the exact confirmed contact.",
      evidence: [{ ...f.members[0], sourceSnapshotId: f.contract.sourceSnapshotId, sourceFactIds: [], documentVersionIds: [] }],
      affected: f.members, confirmedValuesReviewed: true, deliveredVersionReviewed: true, parserProvenanceReviewed: true };
    payload.store.mockImplementation(async (_admin, input) => ({ payloadId: input.payloadId, sha256: input.sha256 }));
    // The fixture deliberately supplies no durable decision receipt: reaching
    // the mutation must not turn its missing response into claimed completion.
    await expect(f.owner.decide(decision, new AbortController().signal)).rejects.toThrow("DECISION_RESULT_UNKNOWN");
    const calls = f.calls.filter((call) => call.name === "ap_record_material_service_error_decision");
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toMatchObject({ p_previous_decision_id: null, p_evidence: decision.evidence, p_affected: decision.affected });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });
});

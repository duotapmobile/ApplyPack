// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ origin: vi.fn(), user: vi.fn(), admin: vi.fn(), requireAdmin: vi.fn(), rate: vi.fn(), customer: vi.fn(), owner: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.rate }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/materials/service-error-server", () => ({ createCustomerServiceErrors: mocks.customer, createOwnerServiceErrors: mocks.owner }));
vi.mock("@/lib/materials/service-error-evidence", () => ({ createServiceErrorEvidenceReader: () => mocks.read }));
import { GET as customerGET, POST as customerPOST } from "@/app/api/customer/material-lines/[id]/service-errors/route";
import { GET as ownerGET, POST as ownerPOST } from "@/app/api/admin/service-errors/[id]/route";
import { readServiceErrorInput, serviceErrorFailure } from "@/lib/materials/service-error-http";
import { ServiceErrorContractError } from "@/lib/materials/service-error-contract";
const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = { artifactId: id(1), fileVersionId: id(2), releaseId: id(3) }, line = id(4), caseId = id(5), customerId = id(6), reviewerId = id(7);
const report = { requestId: id(8), materialLineId: line, items: [{ ...member, field: "Name", documentText: "Wrong", expectedFact: "Confirmed" }] };
const decision = { requestId: id(9), caseId, expectedDecisionId: null, classification: "EVIDENCE_INVESTIGATION", reasonCode: "EVIDENCE_MISSING", explanation: "Original evidence needs review.",
  evidence: [{ ...member, sourceSnapshotId: id(10), sourceFactIds: [], documentVersionIds: [] }], affected: [], confirmedValuesReviewed: true, deliveredVersionReviewed: true, parserProvenanceReviewed: true };
const route = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown, path = `customer/material-lines/${line}/service-errors`) => new Request(`https://applypack.work/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const privateResponse = (response: Response) => { expect(response.headers.get("Cache-Control")).toBe("no-store, private"); expect(response.headers.get("Referrer-Policy")).toBe("no-referrer"); };
let customer: { report: ReturnType<typeof vi.fn>; context: ReturnType<typeof vi.fn>; receipt: ReturnType<typeof vi.fn> }, owner: { inspect: ReturnType<typeof vi.fn>; decide: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks(); mocks.origin.mockReturnValue(true); mocks.user.mockResolvedValue({ data: { user: { id: customerId } }, error: null }); mocks.admin.mockReturnValue({ admin: true });
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: reviewerId }, admin: { admin: true } }); mocks.rate.mockResolvedValue({ configured: true, allowed: true });
  customer = { report: vi.fn().mockResolvedValue({ status: "REPORTED", replayed: false, deliveryAuthorized: false }), context: vi.fn().mockResolvedValue({ reportDeadline: "2026-10-28T12:00:00Z", contract: { reportingTimeZone: "America/New_York", legalReceiptId: id(20) }, files: [member], existingReport: null }), receipt: vi.fn().mockResolvedValue(null) };
  owner = { inspect: vi.fn().mockResolvedValue({ report: { caseId, customerId, members: [member] }, decisions: [{ affected: [member] }] }), decide: vi.fn().mockResolvedValue({ status: "RECORDED", deliveryAuthorized: false }) };
  mocks.customer.mockReturnValue(customer); mocks.owner.mockReturnValue(owner); mocks.read.mockResolvedValue({ ...member, evidence: "fictional" });
});
afterEach(() => vi.useRealTimers());
describe("service-error customer and owner HTTP boundaries", () => {
  it("rejects cross-origin mutations before authentication or private work", async () => {
    mocks.origin.mockReturnValue(false);
    for (const response of [await customerPOST(request(report), route(line)), await ownerPOST(request(decision), route(caseId))]) { expect(response.status).toBe(403); privateResponse(response); }
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.requireAdmin).not.toHaveBeenCalled(); expect(mocks.customer).not.toHaveBeenCalled();
  });
  it("requires verified customer identity and fresh staff authorization before private reads", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null }); mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response("MFA required", { status: 403 }) });
    const a = await customerGET(new Request(`https://applypack.work/api/customer/material-lines/${line}/service-errors`), route(line)), b = await ownerGET(new Request(`https://applypack.work/api/admin/service-errors/${caseId}`), route(caseId));
    expect(a.status).toBe(401); expect(b.status).toBe(403); privateResponse(a); privateResponse(b); expect(mocks.customer).not.toHaveBeenCalled(); expect(mocks.owner).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("uses server identity, strict body/path binding and enabled rate limits", async () => {
    expect((await customerPOST(request({ ...report, customerId: id(99) }), route(line))).status).toBe(400);
    expect((await customerPOST(request({ ...report, materialLineId: id(99) }), route(line))).status).toBe(400); expect(customer.report).not.toHaveBeenCalled();
    mocks.rate.mockResolvedValue({ configured: false, allowed: true }); expect((await customerPOST(request(report), route(line))).status).toBe(503);
    mocks.rate.mockResolvedValue({ configured: true, allowed: false }); expect((await customerPOST(request(report), route(line))).status).toBe(429);
    mocks.rate.mockResolvedValue({ configured: true, allowed: true }); const response = await customerPOST(request(report), route(line)); expect(response.status).toBe(201); privateResponse(response);
    expect(mocks.customer).toHaveBeenLastCalledWith({ admin: true }, customerId); expect(customer.report).toHaveBeenCalledExactlyOnceWith(report, expect.any(AbortSignal));
  });
  it("redacts internal receipt bindings from customer context and rejects a cross-line replay receipt", async () => {
    const response = await customerGET(new Request(`https://applypack.work/api/customer/material-lines/${line}/service-errors`), route(line));
    expect(await response.json()).toEqual({ materialLineId: line, reportDeadline: "2026-10-28T12:00:00Z", reportingTimeZone: "America/New_York", files: [member], existingReport: null });
    customer.receipt.mockResolvedValue({ materialLineId: id(99) }); expect((await customerGET(new Request(`https://applypack.work/api/customer/material-lines/${line}/service-errors?requestId=${id(8)}`), route(line))).status).toBe(404);
  });
  it("loads each exact historical file once under the authorized reviewer, then only records the submitted decision", async () => {
    const response = await ownerGET(new Request(`https://applypack.work/api/admin/service-errors/${caseId}`), route(caseId)); expect(response.status).toBe(200); privateResponse(response);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(customerId, member, expect.any(AbortSignal)); expect(mocks.owner).toHaveBeenCalledWith({ admin: true }, reviewerId);
    expect((await ownerPOST(request({ ...decision, confirmedValuesReviewed: false }), route(caseId))).status).toBe(400);
    expect((await ownerPOST(request({ ...decision, caseId: id(99) }), route(caseId))).status).toBe(400); expect(owner.decide).not.toHaveBeenCalled();
    expect((await ownerPOST(request(decision), route(caseId))).status).toBe(200); expect(owner.decide).toHaveBeenCalledExactlyOnceWith(decision, expect.any(AbortSignal));
  });
  it("never returns internal provider/error text", async () => {
    owner.inspect.mockRejectedValue(new Error("fictional secret/provider context")); const response = await ownerGET(new Request(`https://applypack.work/api/admin/service-errors/${caseId}`), route(caseId));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("fictional secret"); privateResponse(response);
    expect(serviceErrorFailure(new ServiceErrorContractError("REPORT_WINDOW_CLOSED")).status).toBe(409);
  });
});
describe("bounded private JSON body decoding", () => {
  it("rejects wrong media type and malformed or oversized bodies", async () => {
    expect(await readServiceErrorInput(new Request("https://applypack.work", { method: "POST", body: "{}" }))).toBeNull();
    expect(await readServiceErrorInput(new Request("https://applypack.work", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).toBeNull();
    expect(await readServiceErrorInput(request({ text: "x".repeat(100000) }))).toBeNull();
  });
  it("clears streamed source bytes after parsing", async () => {
    const bytes = new TextEncoder().encode('{"text":"fictional private text"}'); const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    const value = await readServiceErrorInput(new Request("https://applypack.work", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit));
    expect(value).toEqual({ text: "fictional private text" }); expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
  it("cancels stalled streams at five seconds and produces no parsed body", async () => {
    vi.useFakeTimers(); const cancel = vi.fn(), stream = new ReadableStream({ cancel });
    const pending = readServiceErrorInput(new Request("https://applypack.work", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" } as RequestInit));
    await vi.advanceTimersByTimeAsync(5001); expect(await pending).toBeNull(); expect(cancel).toHaveBeenCalledOnce();
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ origin: vi.fn(), user: vi.fn(), admin: vi.fn(), rate: vi.fn(), customer: vi.fn() }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.rate }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("@/lib/materials/service-repair-followup-server", () => ({ createCustomerRepairFollowups: mocks.customer }));
import { GET, POST } from "@/app/api/customer/material-lines/[id]/repair-feedback/route";
const id = (n: number) => `a1020000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lineId = id(1), customerId = id(2), path = `https://applypack.work/api/customer/material-lines/${lineId}/repair-feedback`;
const body = { requestId: id(3), caseId: id(4), materialLineId: lineId, releaseId: id(5),
  items: [{ artifactId: id(6), fileVersionId: id(7), concern: "The previously accepted phone error remains." }], sameAcceptedIssue: true };
const route = { params: Promise.resolve({ id: lineId }) };
const request = (value: unknown) => new Request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const service = { report: vi.fn(), context: vi.fn(), receipt: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks(); mocks.origin.mockReturnValue(true); mocks.user.mockResolvedValue({ data: { user: { id: customerId } }, error: null });
  mocks.admin.mockReturnValue({ admin: true }); mocks.rate.mockResolvedValue({ configured: true, allowed: true }); mocks.customer.mockReturnValue(service);
  service.context.mockResolvedValue({ materialLineId: lineId, files: [] }); service.receipt.mockResolvedValue(null);
  service.report.mockResolvedValue({ status: "RECORDED", replayed: false, receipt: { requestId: body.requestId } });
});
describe("private repaired-file feedback route", () => {
  it("rejects cross-origin mutation before authentication", async () => {
    mocks.origin.mockReturnValue(false); expect((await POST(request(body), route)).status).toBe(403); expect(mocks.user).not.toHaveBeenCalled();
  });
  it("requires signed-in identity before any private context", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null }); expect((await GET(new Request(path), route)).status).toBe(401); expect(mocks.customer).not.toHaveBeenCalled();
  });
  it.each([{ customerId: id(99) }, { materialLineId: id(99) }, { sameAcceptedIssue: false }])("refuses untrusted identity/scope %j", async (change) => {
    expect((await POST(request({ ...body, ...change }), route)).status).toBe(400); expect(service.report).not.toHaveBeenCalled();
  });
  it("requires configured rate limits and passes trusted customer identity", async () => {
    mocks.rate.mockResolvedValueOnce({ configured: false, allowed: true }); expect((await POST(request(body), route)).status).toBe(503);
    mocks.rate.mockResolvedValueOnce({ configured: true, allowed: false }); expect((await POST(request(body), route)).status).toBe(429);
    expect(service.report).not.toHaveBeenCalled(); const response = await POST(request(body), route); expect(response.status).toBe(201);
    expect(mocks.customer).toHaveBeenLastCalledWith({ admin: true }, customerId); expect(service.report).toHaveBeenCalledExactlyOnceWith(body, expect.any(AbortSignal));
    expect(response.headers.get("cache-control")).toBe("no-store, private"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("reconciles a fixed ID with a read-only line-bound receipt lookup", async () => {
    const response = await GET(new Request(`${path}?requestId=${body.requestId}`), route);
    expect(await response.json()).toEqual({ receipt: null }); expect(service.receipt).toHaveBeenCalledExactlyOnceWith(lineId, body.requestId, expect.any(AbortSignal));
    expect(service.context).not.toHaveBeenCalled(); expect(service.report).not.toHaveBeenCalled();
  });
  it("does not expose unexpected private/provider error text", async () => {
    service.report.mockRejectedValue(new Error("private fake provider evidence")); const response = await POST(request(body), route);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private fake provider evidence");
  });
});

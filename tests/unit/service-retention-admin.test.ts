import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), sameOrigin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.sameOrigin }));
import { GET, POST } from "@/app/api/admin/service-retention/route";
const orderId = "10000000-0000-4000-8000-000000000001";
const holdId = "10000000-0000-4000-8000-000000000002";
const input = { orderId, reasonCode: "SUPPORT_REVIEW", holdId: null, release: false, reviewed: true };
const request = (body: unknown = input) => new Request("https://applypack.work/api/admin/service-retention", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.sameOrigin.mockReturnValue(true);
  mocks.requireAdmin.mockResolvedValue({ ok: true, role: "admin", user: { id: "verified-admin" }, admin: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: holdId, error: null });
});
describe("reviewed service retention hold administration", () => {
  it("requires fresh administrator authorization before reading status", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET()).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin hold changes before authority lookup", async () => {
    mocks.sameOrigin.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403); expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });
  it("does not let an operator change holds", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, role: "operator", admin: { rpc: mocks.rpc } });
    expect((await POST(request())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ ...input, reviewed: false }, { ...input, reasonCode: "PRIVATE_FREEFORM" }, { ...input, release: true }, { ...input, actorId: "spoofed" }])("rejects missing review, freeform reasons and spoofed authority", async (body) => {
    expect((await POST(request(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("binds the actor to fresh authentication and calls only the hold RPC", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("ap_set_service_retention_hold", { p_order_id: orderId, p_actor_id: "verified-admin", p_reason_code: "SUPPORT_REVIEW", p_hold_id: null, p_release: false });
  });
  it("requires the exact existing hold when releasing it", async () => {
    expect((await POST(request({ ...input, holdId, release: true }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_set_service_retention_hold", expect.objectContaining({ p_hold_id: holdId, p_release: true }));
  });
  it("rejects malformed status rather than displaying an unverified cleanup result", async () => {
    mocks.rpc.mockResolvedValue({ data: { policyVersion: "one_off_30d_v1", orders: [], privatePayload: "not allowed" }, error: null });
    expect((await GET()).status).toBe(503);
  });
  it("keeps provider errors private and leaves uncertain hold outcomes explicit", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "secret provider detail" } });
    const result = await POST(request());
    expect(result.status).toBe(409); expect(JSON.stringify(await result.json())).not.toContain("secret provider detail");
  });
});

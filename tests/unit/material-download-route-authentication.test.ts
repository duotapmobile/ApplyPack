import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: { id: "customer-a" } } }),
  getSession: async () => ({ data: { session: { access_token: "untrusted-cookie-token" } } }),
  getClaims: mocks.getClaims,
} }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
import { GET } from "@/app/api/customer/artifacts/[id]/download/route";
const artifact = "10000000-0000-4000-8000-000000000001";
const file = "10000000-0000-4000-8000-000000000002";
const request = () => new Request(`https://example.test/api/customer/artifacts/${artifact}/download?fileVersionId=${file}`);
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: null, error: null }); });
describe("download requires verified authentication events", () => {
  it("rejects invalid token verification before download authorization", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: { message: "invalid signature" } });
    expect((await GET(request(), { params: Promise.resolve({ id: artifact }) })).status).toBe(401);
    expect(mocks.getClaims).toHaveBeenCalledWith("untrusted-cookie-token");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not treat verified fresh iat as reauthentication", async () => {
    const seconds = Math.floor(Date.now() / 1000);
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "customer-a", iat: seconds, amr: [{ method: "otp", timestamp: seconds - 3600 }] } }, error: null });
    expect((await GET(request(), { params: Promise.resolve({ id: artifact }) })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes only verified recent authentication time into database authorization", async () => {
    const seconds = Math.floor(Date.now() / 1000) - 60;
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "customer-a", amr: [{ method: "otp", timestamp: seconds }] } }, error: null });
    await GET(request(), { params: Promise.resolve({ id: artifact }) });
    expect(mocks.rpc).toHaveBeenCalledWith("ap_authorize_material_download", expect.objectContaining({ p_customer_id: "customer-a", p_reauthenticated_at: new Date(seconds * 1000).toISOString() }));
  });
});

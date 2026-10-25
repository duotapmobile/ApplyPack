import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), rpc: vi.fn(), from: vi.fn(), signed: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: { id: "customer-a" } } }),
  getSession: async () => ({ data: { session: { access_token: "untrusted-cookie-token" } } }),
  getClaims: mocks.getClaims,
} }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from,
  storage: { from: () => ({ createSignedUrl: mocks.signed }) },
}) }));
vi.mock("@/lib/documents/requirements", () => ({ isSupportedDocumentGeneratorVersion: () => true }));
import { GET } from "@/app/api/customer/artifacts/[id]/download/route";
const artifact = "10000000-0000-4000-8000-000000000001";
const file = "10000000-0000-4000-8000-000000000002";
const request = () => new Request(`https://example.test/api/customer/artifacts/${artifact}/download?fileVersionId=${file}`);
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.invalid"); mocks.rpc.mockResolvedValue({ data: null, error: null }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });
const signedUrl = (exp: number) => `https://storage.example.invalid/storage/v1/object/sign/customer-deliveries/customer/file.docx?token=e30.${Buffer.from(JSON.stringify({ exp, url: "customer-deliveries/customer/file.docx" })).toString("base64url")}.c2ln`;
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
  it("caps a successful signed download at the database-authorized service expiry", async () => {
    const seconds = Math.floor(Date.now() / 1000) - 60;
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "customer-a", amr: [{ method: "otp", timestamp: seconds }] } }, error: null });
    mocks.rpc.mockResolvedValue({ data: { bucket: "customer-deliveries", path: "customer/file.docx", filename: "resume.docx", expiresAt: new Date(Date.now() + 30_000).toISOString() }, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { generator_version: "supported" } }) }) }) });
    mocks.signed.mockResolvedValue({ data: { signedUrl: signedUrl(Math.floor((Date.now() + 29_000) / 1_000)) }, error: null });
    expect((await GET(request(), { params: Promise.resolve({ id: artifact }) })).status).toBe(303);
    const lifetime = mocks.signed.mock.calls[0][1];
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(30);
  });
  it("never signs a file after the database rejects the service access window", async () => {
    const seconds = Math.floor(Date.now() / 1000) - 60;
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "customer-a", amr: [{ method: "otp", timestamp: seconds }] } }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "service_retention_access_expired" } });
    const response = await GET(request(), { params: Promise.resolve({ id: artifact }) });
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: expect.stringContaining("30-day private access") });
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it("does not redirect when a delayed provider issues a token beyond the absolute service deadline", async () => {
    let clock = Date.parse("2026-10-24T12:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(clock);
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "customer-a", amr: [{ method: "otp", timestamp: clock / 1000 - 60 }] } }, error: null });
    mocks.rpc.mockResolvedValue({ data: { bucket: "customer-deliveries", path: "customer/file.docx", filename: "resume.docx", expiresAt: new Date(clock + 2_000).toISOString() }, error: null });
    mocks.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { generator_version: "supported" } }) }) }) });
    mocks.signed.mockImplementation(async (_path, duration) => { clock += 1_000; vi.setSystemTime(clock); return { data: { signedUrl: signedUrl(clock / 1000 + duration) }, error: null }; });
    const response = await GET(request(), { params: Promise.resolve({ id: artifact }) });
    expect(response.status).toBe(502); expect(response.headers.get("location")).toBeNull();
  });
});

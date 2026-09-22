import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ consumeRateLimit: vi.fn(), createSupabaseServerClient: vi.fn(), signInWithOtp: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.consumeRateLimit }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createSupabaseServerClient }));
import { POST } from "@/app/api/auth/magic-link/route";
describe("legacy magic link origin boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://applypack.work");
    mocks.consumeRateLimit.mockResolvedValue({ configured: true, allowed: true });
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { signInWithOtp: mocks.signInWithOtp } });
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([{}, { origin: "https://foreign.invalid" }, { origin: "https://applypack.work", "sec-fetch-site": "cross-site" }])("rejects unsafe origin before rate/provider work", async (headers) => {
    const request = new Request("http://internal:3000/api/auth/magic-link", { method: "POST", headers: headers as HeadersInit, body: JSON.stringify({ email: "synthetic@example.test" }) });
    expect((await POST(request)).status).toBe(403);
    expect(mocks.consumeRateLimit).not.toHaveBeenCalled(); expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
  });
  it("accepts configured public origin behind Railway proxy", async () => {
    const request = new Request("http://internal:3000/api/auth/magic-link", { method: "POST", headers: { origin: "https://applypack.work" }, body: JSON.stringify({ email: "synthetic@example.test" }) });
    expect((await POST(request)).status).toBe(200);
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({ email: "synthetic@example.test", options: { emailRedirectTo: "https://applypack.work/auth/callback?next=/get-started" } });
  });
});

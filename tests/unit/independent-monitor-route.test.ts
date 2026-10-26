import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { readSnapshot } = vi.hoisted(() => ({ readSnapshot: vi.fn() }));
vi.mock("@/lib/operations/independent-monitor-server", () => ({ readIndependentMonitorSnapshot: readSnapshot }));
import { GET } from "@/app/api/internal/operations-monitor/route";

const release = "a".repeat(40), nonce = "b".repeat(64), secret = "S".repeat(43);
const req = (authorization = `Bearer ${secret}`, suffix = `?nonce=${nonce}`) => new Request(`https://applypack.work/api/internal/operations-monitor${suffix}`, { headers: { authorization } });
beforeEach(() => {
  vi.stubEnv("APP_OPERATIONS_MONITOR_ENABLED", "true"); vi.stubEnv("APP_OPERATIONS_MONITOR_SECRET", secret);
  vi.stubEnv("APP_DEPLOYMENT_ENV", "production"); vi.stubEnv("APP_EXPECTED_RELEASE_SHA", release); vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", release);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://spjaaxndiduhrcleazwb.supabase.co");
  readSnapshot.mockResolvedValue({ schemaVersion: "applypack-independent-monitor-v1", nonce, checks: { maintenance: { state: "UNKNOWN", ageSeconds: null } } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("private operations observer route", () => {
  it("authenticates before metadata reads and returns no-store even when unhealthy", async () => {
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(readSnapshot).toHaveBeenCalledWith({ environment: "production", releaseSha: release }, nonce, expect.any(AbortSignal));
    expect((await response.json()).checks.maintenance.state).toBe("UNKNOWN");
  });
  it("does not query on wrong credentials or a malformed nonce", async () => {
    expect((await GET(req("wrong"))).status).toBe(401);
    expect((await GET(req(undefined, "?nonce=x"))).status).toBe(400);
    expect(readSnapshot).not.toHaveBeenCalled();
  });
  it("fails closed while disabled or the expected release differs", async () => {
    vi.stubEnv("APP_OPERATIONS_MONITOR_ENABLED", "false");
    expect((await GET(req())).status).toBe(503);
    vi.stubEnv("APP_OPERATIONS_MONITOR_ENABLED", "true"); vi.stubEnv("APP_EXPECTED_RELEASE_SHA", "c".repeat(40));
    expect((await GET(req())).status).toBe(503);
    expect(readSnapshot).not.toHaveBeenCalled();
  });
  it("never reflects provider failures or private text", async () => {
    readSnapshot.mockRejectedValue(new Error(`provider token ${secret} private customer`));
    const response = await GET(req());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Operations monitor unavailable." });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

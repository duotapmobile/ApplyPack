import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), review: vi.fn(), promote: vi.fn(), rpc: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.client }));
vi.mock("@/lib/matching/research-preparation-review", () => ({ loadPreparationReview: mocks.review }));
vi.mock("@/lib/jobs/verified-source-inventory", async original => ({ ...await original<Record<string, unknown>>(), promoteVerifiedSourceInventory: mocks.promote }));
import { GET, POST } from "@/app/api/admin/research-preparation/route";
const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://applypack.work";
const coverage = { action: "COMPLETE_COVERAGE", preparationId: id(1), snapshotId: id(2), reviewed: true, notes: "Actual owner reviewed every fictional captured result." };
function request(body: unknown, options: RequestInit = {}) {
  return new Request(`${origin}/api/admin/research-preparation`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body), ...options });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  const q = { select: () => q, eq: () => q, maybeSingle: mocks.profile };
  mocks.client.mockReturnValue({ rpc: mocks.rpc, from: () => q });
  mocks.auth.mockResolvedValue({ ok: true, user: { id: id(3) }, admin: {} });
  mocks.profile.mockResolvedValue({ data: { role: "operator" }, error: null });
  mocks.review.mockResolvedValue({ preparationId: id(1), current: true, state: "OWNER_REVIEW", listings: [] });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.promote.mockResolvedValue({ inventoryMemberId: id(4), jobSnapshotId: id(5), snapshotId: id(2) });
});
describe("prepared research owner HTTP boundary", () => {
  it("denies unauthorized reads before any evidence client is made", async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET(new Request(`${origin}/api/admin/research-preparation?snapshotId=${id(2)}`))).status).toBe(403);
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes before authentication or mutations", async () => {
    expect((await POST(request(coverage, { headers: { origin: "https://other.invalid", "content-type": "application/json" } }))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns private evidence only while the operator still has a role", async () => {
    const response = await GET(new Request(`${origin}/api/admin/research-preparation?snapshotId=${id(2)}`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.client.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    mocks.profile.mockResolvedValue({ data: { role: "customer" }, error: null });
    expect((await GET(new Request(`${origin}/api/admin/research-preparation?snapshotId=${id(2)}`))).status).toBe(409);
  });
  it.each([{}, { ...coverage, reviewed: false }, { ...coverage, automaticApproval: true }, { ...coverage, notes: "short" }])("rejects incomplete or extra authority %j", async body => {
    expect((await POST(request(body))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("bounds input before parsing and never persists oversized evidence", async () => {
    expect((await POST(request({ ...coverage, notes: "a".repeat(260_000) }))).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("requires the exact still-current preparation before coverage", async () => {
    mocks.review.mockResolvedValue({ preparationId: id(99), current: true });
    expect((await POST(request(coverage))).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, "true", false])("rejects malformed coverage acknowledgement %j without retry", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request(coverage))).status).toBe(409); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("records human coverage but grants no release authority", async () => {
    const response = await POST(request(coverage)); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "READY_FOR_FEASIBILITY", customerReleaseAuthorized: false });
    expect(mocks.rpc).toHaveBeenCalledWith("ap_complete_prepared_research_review", { p_preparation_id: id(1), p_actor_id: id(3), p_notes: coverage.notes });
  });
  it("does not retry a lost coverage response or expose database details", async () => {
    mocks.rpc.mockRejectedValue(new Error("private source content"));
    const response = await POST(request(coverage)); expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("private source content"); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});

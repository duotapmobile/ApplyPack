import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const access = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: access }));
import { POST } from "@/app/api/admin/search-checkout-invitations/route";
const id = (n: number) => `a1030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), draft = id(2), snapshotId = id(3), origin = "https://applypack.example";
const getUserById = vi.fn(), rpc = vi.fn(), from = vi.fn();
let snapshot: { data: unknown; error: unknown }, identity: { data: unknown; error: unknown };
const user = (email: string) => ({ data: { user: { id: owner, email, email_confirmed_at: "2026-10-27T00:00:00Z", is_anonymous: false } }, error: null });
const request = () => new Request(`${origin}/api/admin/search-checkout-invitations`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ draftId: draft, snapshotId, assessmentId: id(4), rationale: "Reviewed current evidence and confirmed daily capacity." }) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  snapshot = { data: { access_email_normalized: "old-document@example.invalid" }, error: null };
  identity = { data: { claimed: true, customerId: owner, rootDraftId: draft }, error: null };
  from.mockImplementation(() => { const q = { select: vi.fn(() => q), eq: vi.fn(() => q), maybeSingle: async () => snapshot }; return q; });
  rpc.mockImplementation(async (name: string) => name === "ap_intake_payment_identity" ? identity : { data: null, error: null });
  getUserById.mockResolvedValue(user("current@example.invalid"));
  access.mockResolvedValue({ ok: true, user: { id: id(5) }, admin: { from, rpc, auth: { admin: { getUserById } } } });
});
afterEach(() => vi.unstubAllEnvs());
describe("invitation issue recipient verification", () => {
  it("returns the latest verified recipient with the fragment-only private invitation", async () => {
    getUserById.mockResolvedValueOnce(user("before@example.invalid")).mockResolvedValueOnce(user("after@example.invalid"));
    const response = await POST(request()), body = await response.json();
    expect(response.status).toBe(201); expect(body.recipientEmail).toBe("after@example.invalid");
    const url = new URL(body.url); expect(url.search).toBe(""); expect(url.pathname).toBe("/get-started");
    expect(new URLSearchParams(url.hash.slice(1)).get("invitationSecret")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rpc).toHaveBeenCalledWith("ap_intake_payment_identity", { p_draft_id: draft, p_snapshot_id: snapshotId });
    expect(rpc.mock.calls.filter(([name]) => name === "ap_issue_search_checkout_invitation")).toHaveLength(1);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });
  it("does not reserve an invitation when the claimed account is unavailable", async () => {
    getUserById.mockResolvedValue({ data: { user: null }, error: { message: "private unavailable" } });
    const response = await POST(request()); expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("private unavailable");
    expect(rpc.mock.calls.some(([name]) => name === "ap_issue_search_checkout_invitation")).toBe(false);
  });
  it("withholds the secret and reports a possible reservation when final recipient verification fails", async () => {
    getUserById.mockResolvedValueOnce(user("before@example.invalid")).mockResolvedValueOnce({ data: { user: null }, error: { message: "unavailable" } });
    const response = await POST(request()), body = await response.json();
    expect(response.status).toBe(409); expect(body.url).toBeUndefined(); expect(body.error).toContain("may be reserved");
    expect(rpc.mock.calls.filter(([name]) => name === "ap_issue_search_checkout_invitation")).toHaveLength(1);
  });
  it("preserves historical contact only for an explicit unclaimed source", async () => {
    identity.data = { claimed: false, customerId: null, rootDraftId: null };
    const response = await POST(request()); expect(response.status).toBe(201);
    expect((await response.json()).recipientEmail).toBe("old-document@example.invalid"); expect(getUserById).not.toHaveBeenCalled();
  });
  it("does not bypass the existing staff authorization response", async () => {
    access.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request())).status).toBe(403); expect(rpc).not.toHaveBeenCalled(); expect(from).not.toHaveBeenCalled();
  });
});

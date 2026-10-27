// Actual checkout handler and ownership adapter; provider/database boundaries are fictional.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ context: vi.fn(), authorize: vi.fn(), rate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/drafts/anonymous-server", () => ({ anonymousDraftContext: boundary.context, anonymousDraftError: () => ({ body: { error: "unavailable" }, status: 404 }) }));
vi.mock("@/lib/commerce/checkout-authorization", () => ({ authorizeCheckout: boundary.authorize }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: boundary.rate }));
vi.mock("@/lib/stripe/server", () => ({ createStripeSearchClient: () => ({}), assertConfiguredPrice: vi.fn() }));
import { POST } from "@/app/api/checkout/search/route";
const id = (n: number) => `a1030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://applypack.example", owner = id(1), draft = id(2), snapshot = id(3), assessment = id(4);
let identity: { data: unknown; error: unknown };
const rpc = vi.fn(), from = vi.fn();
const request = () => new Request(`${origin}/api/checkout/search`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ snapshotId: snapshot, assessmentId: assessment, invitationId: id(5), invitationSecret: "a".repeat(43) }) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("STRIPE_JOB_SEARCH_PRICE_ID", "price_fixture");
  identity = { data: { claimed: true, customerId: owner, rootDraftId: draft }, error: null };
  rpc.mockImplementation(async (name: string) => {
    if (name === "ap_read_current_feasibility") return { data: { snapshotId: snapshot, assessmentId: assessment, state: "COMPLETE", outcome: "LIKELY", checkoutEligible: true }, error: null };
    if (name === "ap_intake_payment_identity") return identity;
    throw new Error("Unexpected command");
  });
  boundary.context.mockResolvedValue({ customerId: owner, admin: { rpc, from }, capability: { draftId: draft }, secretHash: "fictional" });
  boundary.rate.mockResolvedValue({ configured: true, allowed: true });
  boundary.authorize.mockResolvedValue(null); // Stop at the existing locked-release boundary.
});
afterEach(() => vi.unstubAllEnvs());
describe("verified search checkout ownership", () => {
  it("authorizes only the exact selected intake's stable account, without any email lookup", async () => {
    expect((await POST(request())).status).toBe(503);
    expect(rpc).toHaveBeenCalledWith("ap_intake_payment_identity", { p_draft_id: draft, p_snapshot_id: snapshot });
    expect(boundary.authorize).toHaveBeenCalledWith(expect.anything(), "SEARCH", { customerId: owner, resourceId: draft });
    expect(from).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some(([name]) => name === "ap_find_customer_by_access_email")).toBe(false);
  });
  it.each([
    { claimed: false, customerId: null, rootDraftId: null },
    { claimed: true, customerId: id(9), rootDraftId: draft },
  ])("rejects unclaimed or foreign ownership before release authorization: %j", async (data) => {
    identity.data = data;
    expect((await POST(request())).status).toBe(403);
    expect(boundary.authorize).not.toHaveBeenCalled();
  });
  it.each([null, { claimed: false }, { claimed: true, customerId: owner }])("fails closed on malformed ownership: %j", async (data) => {
    identity.data = data;
    expect((await POST(request())).status).toBe(503); expect(boundary.authorize).not.toHaveBeenCalled();
  });
  it("does not trust a partial receipt when the database reports an error", async () => {
    identity.error = { message: "private diagnostics" };
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private diagnostics"); expect(boundary.authorize).not.toHaveBeenCalled();
  });
});

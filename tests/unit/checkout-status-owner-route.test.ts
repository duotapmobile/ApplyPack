import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ cookie: "", user: null as unknown, rpc: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: boundary.cookie }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: boundary.rpc, from: boundary.from }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: boundary.user }, error: null }) } }) }));
import { GET, POST } from "@/app/api/checkout/search/status/route";
import { createCapabilitySecret, hashCapabilitySecret, serializeCheckoutCapability } from "@/lib/commerce/server";
const id = (n: number) => `b1030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://intake.example.invalid", user = { id: id(1), email: "current@example.invalid", email_confirmed_at: "2026-10-26T12:00:00Z", is_anonymous: false };
const post = (requestOrigin = origin) => new Request(`${origin}/api/checkout/search/status`, { method: "POST", headers: { origin: requestOrigin } });
function database() {
  const secret = createCapabilitySecret(); boundary.cookie = serializeCheckoutCapability({ checkoutAttemptId: id(2), secret });
  const state = { identity: { claimed: true, customerId: id(1), rootDraftId: id(3) } as unknown, error: null as unknown, cancel: true,
    tables: { ap_checkout_attempts: { id: id(2), draft_id: id(3), quote_id: id(4) }, ap_quotes: { id: id(4), draft_id: id(3), snapshot_id: id(5) },
      ap_intake_snapshots: { id: id(5), draft_id: id(3), finalized_at: "2026-10-26T12:00:00Z" } } as Record<string, unknown> };
  const eq = vi.fn();
  boundary.from.mockImplementation((table: string) => { const query = { select: () => query, eq: (...args: unknown[]) => { eq(table, ...args); return query; }, maybeSingle: async () => ({ data: state.tables[table], error: null }) }; return query; });
  boundary.rpc.mockImplementation(async (name: string) => name === "ap_intake_payment_identity" ? { data: state.identity, error: state.error }
    : name === "ap_read_checkout_status" ? { data: { state: "SEARCH_ACTIVE", searchActive: true, orderId: id(6), deliveryDueAt: "2026-10-28T12:00:00Z" }, error: null }
      : { data: state.cancel, error: null });
  return { state, eq, secret };
}
beforeEach(() => { vi.resetAllMocks(); boundary.user = user; vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); });
afterEach(() => vi.unstubAllEnvs());
describe("checkout capability plus stable claimed owner", () => {
  it("allows the same verified UUID after account email changes and binds exact cookie→quote→snapshot", async () => {
    const db = database(); expect((await GET()).status).toBe(200);
    expect(db.eq).toHaveBeenCalledWith("ap_checkout_attempts", "browser_capability_secret_hash", hashCapabilitySecret(db.secret));
    expect(boundary.rpc).toHaveBeenCalledWith("ap_intake_payment_identity", { p_draft_id: id(3), p_snapshot_id: id(5) });
    expect(boundary.rpc).toHaveBeenCalledWith("ap_read_checkout_status", { p_checkout_attempt_id: id(2), p_browser_secret_hash: hashCapabilitySecret(db.secret) });
  });
  it.each([null, { ...user, id: id(9) }, { ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }])("rejects signed-out, foreign, unverified or anonymous access without read/cancel (%#)", async account => {
    database(); boundary.user = account; expect((await GET()).status).toBe(404); const response = await POST(post()); expect(response.status).toBe(404);
    expect(response.headers.has("set-cookie")).toBe(false); expect(boundary.rpc.mock.calls.every(([name]) => name === "ap_intake_payment_identity")).toBe(true);
  });
  it("preserves historical capability access only for an explicit unclaimed identity", async () => {
    const db = database(); db.state.identity = { claimed: false, customerId: null, rootDraftId: null }; boundary.user = null;
    expect((await GET()).status).toBe(200); const response = await POST(post()); expect(response.status).toBe(200); expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it.each([null, {}, { claimed: false }, { claimed: false, customerId: id(1), rootDraftId: null }, { claimed: true, customerId: id(1), rootDraftId: id(3), email: "stale@example.invalid" }])("never falls back for malformed identity (%#)", async identity => {
    const db = database(); db.state.identity = identity; expect((await GET()).status).toBe(404); expect((await POST(post())).status).toBe(404);
    expect(boundary.rpc.mock.calls.every(([name]) => name === "ap_intake_payment_identity")).toBe(true);
  });
  it.each(["ap_checkout_attempts", "ap_quotes", "ap_intake_snapshots"])("fails closed on missing or mismatched binding %s", async table => {
    const db = database(); db.state.tables[table] = null; expect((await GET()).status).toBe(404); expect(boundary.rpc).not.toHaveBeenCalled();
  });
  it("does not treat a different draft's quote as proof of ownership", async () => {
    const db = database(); db.state.tables.ap_quotes = { id: id(4), draft_id: id(9), snapshot_id: id(5) };
    expect((await POST(post())).status).toBe(404); expect(boundary.rpc).not.toHaveBeenCalled();
  });
  it("does not claim cancellation or clear the capability when the locked operation returns false", async () => {
    const db = database(); db.state.cancel = false; const response = await POST(post()); expect(response.status).toBe(409); expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("rejects cross-origin cancellation before private lookup", async () => {
    database(); expect((await POST(post("https://other.invalid"))).status).toBe(403); expect(boundary.from).not.toHaveBeenCalled(); expect(boundary.rpc).not.toHaveBeenCalled();
  });
});

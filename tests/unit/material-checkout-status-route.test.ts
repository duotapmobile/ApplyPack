import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ user: null as unknown, authError: null as unknown, from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: boundary.user }, error: boundary.authError }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: boundary.from }) }));
import { GET } from "@/app/api/checkout/apply-packs/[id]/status/route";
const id = (n: number) => `a1150000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = { id: id(1), email: "owner@example.invalid", is_anonymous: false, email_confirmed_at: "2026-10-27T01:00:00Z" };
const request = (key = id(2), query = "") => GET(new Request(`https://applypack.work/api/checkout/apply-packs/${key}/status${query}`), { params: Promise.resolve({ id: key }) });
function database() {
  const intent = { id: id(2), customer_id: id(1), delivered_order_id: id(3), purchase_id: id(4), payment_attempt_id: id(5),
    provider_checkout_session_id: "cs_test_pack", state: "COMPLETED", amount_cents: 799, currency: "USD", line_count: 1, completed_at: "2026-10-27T02:00:00Z" };
  const payment = { id: id(5), customer_id: id(1), provider: "stripe", provider_payment_id: "pi_pack", provider_checkout_session_id: "cs_test_pack",
    settlement: "PAID", payment_verified_at: "2026-10-27T02:00:00Z", immediate_charge_verified: true, amount_cents: 799, currency: "USD" };
  const purchase = { id: id(4), customer_id: id(1), checkout_intent_id: id(2), payment_attempt_id: id(5), amount_cents: 799, currency: "USD" };
  const rows: Record<string, unknown> = { ap_material_checkout_intents: intent, orders: { id: id(3), customer_id: id(1) }, ap_payment_attempts: payment, ap_material_purchases: purchase };
  const calls: unknown[][] = [], errors: Record<string, unknown> = {};
  boundary.from.mockImplementation((table: string) => { const query = { select: () => query, eq: (...args: unknown[]) => { calls.push([table, ...args]); return query; },
    abortSignal: () => query, maybeSingle: async () => ({ data: rows[table], error: errors[table] || null }) }; return query; });
  const pending = () => { Object.assign(intent, { state: "OPEN", completed_at: null }); Object.assign(payment, { settlement: "UNPAID", payment_verified_at: null, immediate_charge_verified: false, provider_payment_id: null }); };
  return { rows, errors, calls, intent, payment, purchase, pending };
}
beforeEach(() => { vi.resetAllMocks(); boundary.user = user; boundary.authError = null; });
afterEach(() => vi.unstubAllEnvs());
describe("authenticated Apply Pack checkout status", () => {
  it("binds the current verified UID to exact intent, order, purchase and payment, without returning provider or contact secrets", async () => {
    const db = database(); boundary.user = { ...user, email: "changed@example.invalid" };
    const response = await request(), result = await response.json();
    expect(response.status).toBe(200); expect(result).toEqual({ checkoutIntentId: id(2), state: "PAYMENT_VERIFIED", orderId: id(3), lineCount: 1, amountCents: 799, currency: "USD" });
    for (const table of Object.keys(db.rows)) expect(db.calls).toContainEqual([table, "customer_id", id(1)]);
    expect(JSON.stringify(result)).not.toMatch(/cs_test|pi_pack|@|secret|payload/);
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it.each([null, { ...user, is_anonymous: true }, { ...user, email_confirmed_at: null }, { ...user, id: "not-uuid" }])("rejects absent, anonymous or unverified identity (%#)", async account => {
    database(); boundary.user = account; expect((await request()).status).toBe(401); expect(boundary.from).not.toHaveBeenCalled();
  });
  it("does not trust a user returned alongside an authentication error", async () => { database(); boundary.authError = new Error("internal"); expect((await request()).status).toBe(401); });
  it.each(["", "not-an-id", `${id(2)}/extra`])("rejects malformed locator without lookup %s", async key => { database(); expect((await request(key)).status).toBe(404); expect(boundary.from).not.toHaveBeenCalled(); });
  it.each(["ap_material_checkout_intents", "orders", "ap_payment_attempts", "ap_material_purchases"])("rejects missing or foreign %s", async table => {
    const db = database(); db.rows[table] = { ...(db.rows[table] as object), customer_id: id(9) }; expect((await request()).status).toBe(404);
    db.rows[table] = null; expect((await request()).status).toBe(404);
  });
  it.each([
    ["ap_material_checkout_intents", "id", id(9)], ["ap_material_checkout_intents", "provider_checkout_session_id", "not-session"],
    ["ap_payment_attempts", "provider_checkout_session_id", "cs_test_other"], ["ap_payment_attempts", "amount_cents", 1],
    ["ap_material_purchases", "checkout_intent_id", id(9)], ["ap_material_purchases", "payment_attempt_id", id(9)],
    ["ap_material_purchases", "currency", "EUR"], ["orders", "id", id(9)],
  ])("rejects mismatched graph %s.%s", async (table, key, value) => { const db = database(); (db.rows[table] as Record<string, unknown>)[key] = value; expect((await request()).status).toBe(404); });
  it.each(["payment_verified_at", "provider_payment_id", "immediate_charge_verified"])("never claims payment verified without %s", async key => {
    const db = database(); (db.payment as Record<string, unknown>)[key] = key === "immediate_charge_verified" ? false : null; expect((await request()).status).toBe(503);
  });
  it("keeps success/cancel flags read-only and pending until actual settlement, then safely rereads the same receipt", async () => {
    const db = database(); db.pending();
    expect(await (await request(id(2), "?cancelled=1&success=1")).json()).toMatchObject({ state: "CONFIRMING_PAYMENT" });
    expect(await (await request()).json()).toMatchObject({ state: "CONFIRMING_PAYMENT" });
    Object.assign(db.intent, { state: "COMPLETED", completed_at: "2026-10-27T02:00:00Z" });
    Object.assign(db.payment, { settlement: "PAID", payment_verified_at: "2026-10-27T02:00:00Z", immediate_charge_verified: true, provider_payment_id: "pi_pack" });
    expect(await (await request(id(2), "?cancelled=1")).json()).toMatchObject({ state: "PAYMENT_VERIFIED" });
  });
  it.each(["EXPIRED", "FAILED"])("reports database %s without inferring a refund", async state => {
    const db = database(); db.pending(); db.intent.state = state; expect(await (await request()).json()).toMatchObject({ state });
  });
  it("rejects a missing OPEN provider binding and contradictory completed/unpaid state", async () => {
    const db = database(); db.pending(); Object.assign(db.intent, { provider_checkout_session_id: null }); Object.assign(db.payment, { provider_checkout_session_id: null });
    expect((await request()).status).toBe(404); db.intent.state = "COMPLETED"; expect((await request()).status).toBe(404);
  });
  it("handles a failed read and a retry without exposing internal diagnostics or performing writes", async () => {
    const db = database(); db.errors.ap_material_checkout_intents = { message: "private diagnostic" };
    expect(await (await request()).text()).not.toContain("private diagnostic"); delete db.errors.ap_material_checkout_intents;
    expect((await request()).status).toBe(200);
  });
});

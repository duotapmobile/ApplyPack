// @vitest-environment node
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  stripe: null as Stripe | null,
  admin: null as unknown,
  sendReceipt: vi.fn(),
  boardEvent: vi.fn(),
  workflow: vi.fn(),
  bindSession: vi.fn(),
  observeSession: vi.fn(),
  after: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: dependencies.after,
}));
vi.mock("@/lib/stripe/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/stripe/server")>(),
  createStripeOperationalClient: () => dependencies.stripe,
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => dependencies.admin }));
vi.mock("@/lib/email/send", () => ({ sendOrderReceipt: dependencies.sendReceipt }));
vi.mock("@/lib/job-board/stripe-events", () => ({ processBoardStripeEvent: dependencies.boardEvent }));
vi.mock("@/lib/workflow/process", () => ({ processWorkflowTasks: dependencies.workflow }));
vi.mock("@/lib/commerce/checkout-initiation", () => ({
  bindCheckoutSession: dependencies.bindSession,
  observeCheckoutSession: dependencies.observeSession,
}));

import { POST } from "@/app/api/stripe/webhook/route";
import { checkoutConfiguration } from "@/lib/stripe/mode";

const expectedAccount = "acct_sandboxFixture";
const signingSecret = "whsec_local_signature_fixture";
const signer = new Stripe("sk_test_local_signature_fixture");
const products = {
  search: { kind: "job_search", name: "Job Match Search", amount: 2_000,
    legacyPrice: "price_legacy_search", currentPrice: "price_current_search" },
  pack: { kind: "apply_pack", name: "Tailored Resume + Cover Letter", amount: 800,
    legacyPrice: "price_legacy_pack", currentPrice: "price_current_pack" },
} as const;
type Product = keyof typeof products;

function setup() {
  const events = new Map<string, { processed_at: string | null; processing_status: string }>();
  const from = vi.fn((table: string) => {
    let update: Record<string, unknown> | null = null;
    const filters: Record<string, unknown> = {};
    const result = () => {
      if (table === "email_events") return { data: null, error: null };
      if (table !== "webhook_events") throw new Error(`Unexpected database table: ${table}`);
      const row = events.get(String(filters.provider_event_id));
      if (update && row) {
        Object.assign(row, update);
        return { data: { id: "webhook-row" }, error: null };
      }
      return { data: row ? { ...row } : null, error: null };
    };
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = (name: string, value: unknown) => { filters[name] = value; return chain; };
    chain.update = (value: Record<string, unknown>) => { update = value; return chain; };
    chain.maybeSingle = async () => result();
    chain.then = (resolve: (value: ReturnType<typeof result>) => unknown,
      reject?: (reason: unknown) => unknown) => Promise.resolve().then(result).then(resolve, reject);
    chain.insert = async (value: { provider_event_id: string }) => {
      if (table !== "webhook_events") throw new Error(`Unexpected database insert: ${table}`);
      if (events.has(value.provider_event_id)) return { error: { code: "23505" } };
      events.set(value.provider_event_id, { processed_at: null, processing_status: "pending" });
      return { error: null };
    };
    chain.upsert = async () => ({ error: null });
    return chain;
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_stripe_webhook") return { data: true, error: null };
    if (["complete_paid_checkout", "complete_apply_pack_cart"].includes(name)) {
      return { data: { customer_id: "customer-fixture" }, error: null };
    }
    throw new Error(`Unexpected database command: ${name}`);
  });
  dependencies.admin = { from, rpc, auth: { admin: {
    getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "customer@example.test" } }, error: null }),
  } } };
  const account = vi.fn().mockResolvedValue({ id: expectedAccount });
  const retrieveSession = vi.fn();
  const retrievePrice = vi.fn();
  // Only signature handling is the real SDK. Every network-capable surface
  // available to this fixture is a mock, so these tests cannot contact Stripe.
  dependencies.stripe = {
    webhooks: signer.webhooks,
    accounts: { retrieveCurrent: account },
    prices: { retrieve: retrievePrice },
    checkout: { sessions: { retrieve: retrieveSession } },
  } as unknown as Stripe;
  function checkout(kind: Product) {
    const product = products[kind];
    const session = {
      id: `cs_test_legacy_${kind}`, object: "checkout.session", mode: "payment",
      status: "complete", payment_status: "paid", currency: "usd", amount_total: product.amount,
      payment_intent: `pi_legacy_${kind}`, livemode: false,
      metadata: { product_kind: product.kind, capacity_reservation_id: "reservation-fixture",
        ...(kind === "search" ? { order_id: "order-fixture" } : { cart_id: "cart-fixture" }) },
      line_items: { data: [{ quantity: 1, price: { id: product.legacyPrice } }] },
    } as unknown as Stripe.Checkout.Session;
    retrieveSession.mockResolvedValue(session);
    retrievePrice.mockResolvedValue({ id: product.legacyPrice, active: false, type: "one_time",
      currency: "usd", unit_amount: product.amount, livemode: false,
      product: { active: false, name: product.name, livemode: false } });
    return session;
  }
  return { from, rpc, account, retrieveSession, retrievePrice, checkout, session: checkout("search") };
}

let fixture: ReturnType<typeof setup>;
function event(session = fixture.session, overrides: Record<string, unknown> = {}) {
  return { id: "evt_signed_fixture", object: "event", type: "checkout.session.completed",
    livemode: false, created: Math.floor(Date.now() / 1_000), data: { object: session }, ...overrides };
}
function signedRequest(value = event(), options: { tamper?: boolean; secret?: string } = {}) {
  const payload = JSON.stringify(value, null, 2);
  const signature = signer.webhooks.generateTestHeaderString({ payload, secret: options.secret || signingSecret });
  return new Request("https://applypack-staging-staging.up.railway.app/api/stripe/webhook", {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature },
    body: options.tamper ? `${payload} ` : payload,
  });
}
function expectNoDatabaseAccess() {
  expect(fixture.from).not.toHaveBeenCalled();
  expect(fixture.rpc).not.toHaveBeenCalled();
  expect(dependencies.sendReceipt).not.toHaveBeenCalled();
  expect(dependencies.after).not.toHaveBeenCalled();
}

describe("signed Stripe webhook account boundary", () => {
  beforeEach(() => {
    for (const mock of [dependencies.sendReceipt, dependencies.boardEvent, dependencies.workflow,
      dependencies.bindSession, dependencies.observeSession, dependencies.after]) mock.mockReset();
    dependencies.sendReceipt.mockResolvedValue({ skipped: false, providerMessageId: "message-fixture" });
    dependencies.boardEvent.mockResolvedValue(false);
    dependencies.workflow.mockResolvedValue({ processed: 0 });
    const environment = {
      APP_DEPLOYMENT_ENV: "staging", APP_PAYMENT_MODE: "test", STRIPE_SECRET_KEY: "sk_test_runtime_fixture",
      STRIPE_EXPECTED_ACCOUNT_ID: expectedAccount, STRIPE_WEBHOOK_SECRET: signingSecret,
      STRIPE_JOB_SEARCH_PRICE_ID: products.search.currentPrice, STRIPE_APPLY_PACK_PRICE_ID: products.pack.currentPrice,
      STRIPE_LEGACY_JOB_SEARCH_PRICE_ID: products.search.legacyPrice, STRIPE_LEGACY_APPLY_PACK_PRICE_ID: products.pack.legacyPrice,
      APP_CHECKOUT_ENABLED: "false", APP_CANARY_CHECKOUT_ENABLED: "false", APP_REHEARSAL_CHECKOUT_ENABLED: "false",
      APP_LIVE_PAYMENTS_ENABLED: "false", APP_JOB_BOARD_CHECKOUT_ENABLED: "false", APP_JOB_SOURCE_SYNC_ENABLED: "false",
      NEXT_PUBLIC_APP_URL: "https://applypack-staging-staging.up.railway.app",
      NEXT_PUBLIC_SUPABASE_URL: "https://fmugizadzdnqfckujqlw.supabase.co",
      APP_RELEASE_SHA: "a".repeat(40), APP_EXPECTED_RELEASE_SHA: "a".repeat(40), RAILWAY_GIT_COMMIT_SHA: "",
    };
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    fixture = setup();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a changed raw body before any account lookup or database access", async () => {
    expect((await POST(signedRequest(event(), { tamper: true }))).status).toBe(400);
    expect(fixture.account).not.toHaveBeenCalled();
    expectNoDatabaseAccess();
  });

  it("rejects a different signing secret before any account lookup or database access", async () => {
    expect((await POST(signedRequest(event(), { secret: "whsec_wrong_fixture" }))).status).toBe(400);
    expect(fixture.account).not.toHaveBeenCalled();
    expectNoDatabaseAccess();
  });

  it("rejects a signed live event before any account lookup or database access", async () => {
    expect((await POST(signedRequest(event(fixture.session, { livemode: true })))).status).toBe(409);
    expect(fixture.account).not.toHaveBeenCalled();
    expectNoDatabaseAccess();
  });

  it.each(["", "acct_invalid value"])("fails closed for missing or malformed expected account %j", async (account) => {
    vi.stubEnv("STRIPE_EXPECTED_ACCOUNT_ID", account);
    expect((await POST(signedRequest())).status).toBe(503);
    expect(fixture.account).not.toHaveBeenCalled();
    expectNoDatabaseAccess();
  });

  it("rejects a validly signed test event when the credential belongs to another account", async () => {
    fixture.account.mockResolvedValue({ id: "acct_wrongSandbox" });
    expect((await POST(signedRequest())).status).toBe(503);
    expect(fixture.account).toHaveBeenCalledOnce();
    expectNoDatabaseAccess();
  });

  it("rejects a present connected-account mismatch before writing a webhook receipt", async () => {
    expect((await POST(signedRequest(event(fixture.session, { account: "acct_otherConnected" })))).status).toBe(503);
    expect(fixture.account).toHaveBeenCalledOnce();
    expectNoDatabaseAccess();
  });

  it("returns a retryable generic response when the account lookup is unavailable", async () => {
    fixture.account.mockRejectedValue(new Error("private provider request detail"));
    const response = await POST(signedRequest());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider request detail");
    expectNoDatabaseAccess();
  });

  it.each(["search", "pack"] as const)("settles an inactive historical %s price while checkout is locked", async (kind) => {
    expect(checkoutConfiguration()).toMatchObject({ state: "LOCKED_STAGING", ready: false });
    const session = fixture.checkout(kind);
    const response = await POST(signedRequest(event(session)));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(fixture.account).toHaveBeenCalledOnce();
    expect(fixture.retrievePrice).toHaveBeenCalledWith(products[kind].legacyPrice, { expand: ["product"] });
    expect(fixture.rpc).toHaveBeenCalledWith(kind === "search" ? "complete_paid_checkout" : "complete_apply_pack_cart",
      expect.objectContaining({ p_amount_cents: products[kind].amount, p_payment_id: `pi_legacy_${kind}` }));
    expect(dependencies.sendReceipt).toHaveBeenCalledOnce();
  });

  it.each(["search", "pack"] as const)("rejects a current price substituted into a historical %s session", async (kind) => {
    const session = fixture.checkout(kind);
    session.line_items!.data[0].price!.id = products[kind].currentPrice;
    expect((await POST(signedRequest(event(session)))).status).toBe(500);
    expect(fixture.retrievePrice).not.toHaveBeenCalled();
    expect(fixture.rpc.mock.calls.filter(([name]) => name.startsWith("complete_"))).toHaveLength(0);
    expect(dependencies.sendReceipt).not.toHaveBeenCalled();
  });

  it.each(["search", "pack"] as const)("does not substitute current pricing when the historical %s price is missing", async (kind) => {
    vi.stubEnv(kind === "search" ? "STRIPE_LEGACY_JOB_SEARCH_PRICE_ID" : "STRIPE_LEGACY_APPLY_PACK_PRICE_ID", "");
    expect((await POST(signedRequest(event(fixture.checkout(kind))))).status).toBe(500);
    expect(fixture.retrievePrice).not.toHaveBeenCalled();
    expect(fixture.rpc.mock.calls.filter(([name]) => name.startsWith("complete_"))).toHaveLength(0);
    expect(dependencies.sendReceipt).not.toHaveBeenCalled();
  });

  it("acknowledges a replay without repeating fulfillment, receipt email, or post-response work", async () => {
    const value = event();
    expect((await POST(signedRequest(value))).status).toBe(200);
    const replay = await POST(signedRequest(value));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(fixture.rpc.mock.calls.filter(([name]) => name === "complete_paid_checkout")).toHaveLength(1);
    expect(fixture.retrieveSession).toHaveBeenCalledOnce();
    expect(dependencies.sendReceipt).toHaveBeenCalledOnce();
    expect(dependencies.after).toHaveBeenCalledOnce();
  });
});

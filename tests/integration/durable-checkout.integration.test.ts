// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const fixture = vi.hoisted(() => ({ mode: "REHEARSAL" as string | null, stripe: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/stripe/mode", () => ({ checkoutConfiguration: () => ({
  sessionCreationAllowed: fixture.mode !== null, acceptingOrders: fixture.mode === "PUBLIC", restrictedMode: fixture.mode,
}) }));
vi.mock("@/lib/stripe/server", () => ({ createStripeOperationalClient: () => fixture.stripe }));

import { bindCheckoutSession, createOrResumeCheckoutSession, observeCheckoutSession, reconcileCheckoutInitiations } from "@/lib/commerce/checkout-initiation";

const sha = "a".repeat(40);
const id = "00000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-10-23T00:00:00Z");
function setup() {
  const attempt = {
    id, mode: "REHEARSAL", release_sha: sha, authorization_id: "authorization", payment_attempt_id: "payment-attempt",
    provider_session_id: null as string | null, provider_idempotency_key: "persisted-command-key",
    provider_session_deadline: new Date(now + 35 * 60_000).toISOString(),
    initiated_at: new Date(now).toISOString(), state: "INITIATED",
  };
  const authorization = { revoked_at: null as string | null, expires_at: new Date(now + 2 * 60_000).toISOString() };
  const payment = { settlement: "UNPAID", payment_verified_at: null as string | null };
  const databaseMode = { mode: "REHEARSAL", release_sha: sha };
  const query = (table: string) => {
    const data = () => table === "ap_checkout_mode_configuration" ? databaseMode
      : table === "ap_checkout_initiations" ? attempt : table === "ap_payment_attempts" ? payment : authorization;
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
      insert: () => Promise.resolve({ error: null }),
      limit: () => Promise.resolve({ data: [attempt], error: null }),
      single: () => Promise.resolve({ data: { ...data() }, error: null }),
      maybeSingle: () => Promise.resolve({ data: { ...data() }, error: null }),
    };
    return chain;
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "ap_checkout_initiations_requiring_reconciliation") {
      const pending = ["INITIATED", "OPEN", "EXPIRATION_REQUIRED"].includes(attempt.state)
        || (attempt.state === "PAID" && (payment.settlement !== "PAID" || !payment.payment_verified_at));
      return { data: pending ? [{ ...attempt }] : [], error: null };
    }
    if (name === "ap_bind_checkout_initiation") {
      if (attempt.provider_session_id && attempt.provider_session_id !== args.p_provider_session_id) return { error: "conflict", data: null };
      attempt.provider_session_id = String(args.p_provider_session_id);
      if (attempt.state === "INITIATED") attempt.state = "OPEN";
      return { data: { expirationRequired: Boolean(authorization.revoked_at) || attempt.state === "EXPIRATION_REQUIRED" }, error: null };
    }
    if (name === "ap_reconcile_checkout_initiation") {
      if (args.p_payment_status === "paid") attempt.state = "PAID";
      else if (args.p_provider_status === "expired") attempt.state = "EXPIRED";
    }
    if (name === "ap_reconcile_checkout_initiation_absence") attempt.state = "EXPIRED";
    return { data: true, error: null };
  });
  const session = {
    id: "cs_test_durable", url: "https://checkout.stripe.com/fixture", status: "open", payment_status: "unpaid",
    expires_at: Math.floor(Date.parse(attempt.provider_session_deadline) / 1_000), metadata: { initiation_id: id },
  };
  let providerCreated = false;
  const providerKeys = new Set<string>();
  const create = vi.fn(async (_params: unknown, options: { idempotencyKey: string }) => {
    providerKeys.add(options.idempotencyKey); providerCreated = true; return { ...session };
  });
  const retrieve = vi.fn(async () => ({ ...session }));
  const expire = vi.fn(async () => { session.status = "expired"; return { ...session }; });
  const list = vi.fn(async () => ({ data: providerCreated ? [{ ...session }] : [], has_more: false, lastResponse: { requestId: "req_fixture" } }));
  const stripe = { checkout: { sessions: { create, retrieve, expire, list } } };
  fixture.stripe = stripe;
  return { admin: { from: query, rpc } as never, stripe: stripe as unknown as Stripe,
    attempt, authorization, payment, databaseMode, session, create, retrieve, expire, list, rpc, providerKeys };
}
const params = { mode: "payment", payment_method_types: ["card"], line_items: [{ price: "price_fixed", quantity: 1 }] } satisfies Stripe.Checkout.SessionCreateParams;

describe("durable database and Stripe checkout boundary", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); fixture.mode = "REHEARSAL";
    vi.stubEnv("APP_RELEASE_SHA", sha); vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "");
  });
  it("uses the persisted key and separate 35-minute Session deadline for simultaneous retries", async () => {
    const f = setup();
    const sessions = await Promise.all([createOrResumeCheckoutSession(f.admin, f.stripe, id, params), createOrResumeCheckoutSession(f.admin, f.stripe, id, params)]);
    expect(sessions.map((session) => session.id)).toEqual(["cs_test_durable", "cs_test_durable"]);
    expect([...f.providerKeys]).toEqual(["persisted-command-key"]);
    expect(f.create.mock.calls[0][0]).toMatchObject({ expires_at: Math.floor((now + 35 * 60_000) / 1_000), metadata: { initiation_id: id } });
    expect(f.attempt.provider_session_id).toBe("cs_test_durable");
  });
  it("retries a lost create response with identical parameters and key", async () => {
    const f = setup();
    f.create.mockRejectedValueOnce(new Error("response lost"));
    await expect(createOrResumeCheckoutSession(f.admin, f.stripe, id, params)).rejects.toThrow("response lost");
    await createOrResumeCheckoutSession(f.admin, f.stripe, id, params);
    expect(f.create.mock.calls[0]).toEqual(f.create.mock.calls[1]);
  });
  it("delayed initiation near authorization expiry retains a valid independent Session lifetime", async () => {
    const f = setup();
    f.authorization.expires_at = new Date(now + 1_000).toISOString();
    await createOrResumeCheckoutSession(f.admin, f.stripe, id, params);
    expect(f.create.mock.calls[0][0]).toMatchObject({ expires_at: Math.floor((now + 35 * 60_000) / 1_000) });
  });
  it("never changes the deadline or creates a new session once the Stripe minimum lifetime has elapsed", async () => {
    const f = setup();
    f.authorization.expires_at = new Date(now + 30 * 60_000).toISOString();
    vi.setSystemTime(now + 6 * 60_000);
    await expect(createOrResumeCheckoutSession(f.admin, f.stripe, id, params)).rejects.toThrow("requires_reconciliation");
    expect(f.create).not.toHaveBeenCalled(); expect(f.list).toHaveBeenCalledOnce();
    expect(f.attempt.state).toBe("INITIATED");
  });
  it("expires a session when authorization is revoked during its create call", async () => {
    const f = setup();
    f.create.mockImplementationOnce(async () => { f.authorization.revoked_at = new Date(now).toISOString(); return { ...f.session }; });
    await expect(createOrResumeCheckoutSession(f.admin, f.stripe, id, params)).rejects.toThrow("authorization_closed");
    expect(f.expire).toHaveBeenCalledOnce(); expect(f.attempt.state).toBe("EXPIRED");
  });
  it("preserves a paid-in-the-meantime result while locking the route", async () => {
    const f = setup();
    f.create.mockImplementationOnce(async () => { fixture.mode = null; f.session.status = "complete"; f.session.payment_status = "paid"; return { ...f.session }; });
    await expect(createOrResumeCheckoutSession(f.admin, f.stripe, id, params)).rejects.toThrow("authorization_closed");
    expect(f.expire).not.toHaveBeenCalled(); expect(f.attempt.state).toBe("PAID");
  });
  it("binds webhook-before-response and late paid evidence without checking current authorization", async () => {
    const f = setup(); fixture.mode = null;
    f.authorization.revoked_at = new Date(now).toISOString(); vi.setSystemTime(now + 60 * 60_000);
    const session = { ...f.session, status: "complete", payment_status: "paid" } as unknown as Stripe.Checkout.Session;
    await bindCheckoutSession(f.admin, id, session);
    await observeCheckoutSession(f.admin, id, session);
    expect(f.attempt.state).toBe("PAID"); expect(f.create).not.toHaveBeenCalled();
  });
  it("reconciles known sessions while all modes are locked", async () => {
    const f = setup(); fixture.mode = null; f.attempt.provider_session_id = f.session.id;
    const result = await reconcileCheckoutInitiations(f.admin);
    expect(result).toEqual({ processed: 1, unresolved: 0 }); expect(f.expire).toHaveBeenCalledOnce(); expect(f.create).not.toHaveBeenCalled();
  });
  it("keeps provider-paid attempts actionable across sweeps until verified webhook settlement", async () => {
    const f = setup(); fixture.mode = null;
    f.attempt.provider_session_id = f.session.id;
    f.session.status = "complete"; f.session.payment_status = "paid";
    expect(await reconcileCheckoutInitiations(f.admin)).toEqual({ processed: 0, unresolved: 1 });
    expect(f.attempt.state).toBe("PAID");
    expect(await reconcileCheckoutInitiations(f.admin)).toEqual({ processed: 0, unresolved: 1 });
    f.payment.settlement = "PAID";
    expect(await reconcileCheckoutInitiations(f.admin)).toEqual({ processed: 0, unresolved: 1 });
    f.payment.payment_verified_at = new Date(now).toISOString();
    expect(await reconcileCheckoutInitiations(f.admin)).toEqual({ processed: 0, unresolved: 0 });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("reports payment winning an expiration race as unresolved until webhook settlement", async () => {
    const f = setup(); fixture.mode = null; f.attempt.provider_session_id = f.session.id;
    f.expire.mockImplementationOnce(async () => {
      f.session.status = "complete"; f.session.payment_status = "paid"; throw Error("already complete");
    });
    expect(await reconcileCheckoutInitiations(f.admin)).toEqual({ processed: 0, unresolved: 1 });
    expect(f.attempt.state).toBe("PAID"); expect(f.create).not.toHaveBeenCalled();
  });
  it("an old instance cannot create after the authoritative database mode locks", async () => {
    const f = setup(); f.databaseMode.mode = "LOCKED";
    await expect(createOrResumeCheckoutSession(f.admin, f.stripe, id, params)).rejects.toThrow("requires_reconciliation");
    expect(f.create).not.toHaveBeenCalled();
  });
  it("bounds provider scanning and leaves an unknown outcome unresolved", async () => {
    const f = setup(); fixture.mode = null;
    f.list.mockResolvedValue({ data: [{ ...f.session, id: "unrelated", metadata: { initiation_id: "other" } }], has_more: true, lastResponse: { requestId: "req_fixture" } });
    const result = await reconcileCheckoutInitiations(f.admin);
    expect(f.list).toHaveBeenCalledTimes(3); expect(result.unresolved).toBe(1); expect(f.attempt.state).toBe("INITIATED");
  });
  it("closes a crash-before-provider attempt only after the deadline grace and exhaustive provider absence proof", async () => {
    const f = setup(); fixture.mode = null; vi.setSystemTime(now + 41 * 60_000);
    const result = await reconcileCheckoutInitiations(f.admin);
    expect(result).toEqual({ processed: 1, unresolved: 0 }); expect(f.attempt.state).toBe("EXPIRED");
    expect(f.rpc).toHaveBeenCalledWith("ap_reconcile_checkout_initiation_absence", expect.objectContaining({
      p_attempt_id: id, p_evidence_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(f.list).toHaveBeenCalledWith(expect.objectContaining({ created: {
      gte: Math.floor(now / 1_000) - 5, lte: Math.floor((now + 35 * 60_000) / 1_000),
    } }));
    await bindCheckoutSession(f.admin, id, { ...f.session, status: "complete", payment_status: "paid" } as unknown as Stripe.Checkout.Session);
    await observeCheckoutSession(f.admin, id, { ...f.session, status: "complete", payment_status: "paid" } as unknown as Stripe.Checkout.Session);
    expect(f.attempt.state).toBe("PAID");
  });
  it("does not close an absent attempt before the grace or without a provider receipt", async () => {
    const f = setup(); fixture.mode = null;
    vi.setSystemTime(now + 39 * 60_000);
    expect((await reconcileCheckoutInitiations(f.admin)).unresolved).toBe(1);
    vi.setSystemTime(now + 41 * 60_000);
    f.list.mockResolvedValue({ data: [], has_more: false, lastResponse: { requestId: "" } });
    expect((await reconcileCheckoutInitiations(f.admin)).unresolved).toBe(1);
    expect(f.rpc.mock.calls.some(([name]) => name === "ap_reconcile_checkout_initiation_absence")).toBe(false);
  });
});

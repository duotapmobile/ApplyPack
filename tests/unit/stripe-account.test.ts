// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
vi.mock("server-only", () => ({}));
import { assertConfiguredPrice, assertStripeAccount, createStripeOperationalClient, createStripeSearchClient } from "@/lib/stripe/server";

const accountId = "acct_1UTeOMJBHv2xRTvu";
const expectedPrice = { unitAmount: 1_899, productName: "Job Match Search" };
function provider(id = accountId) {
  const retrieveCurrent = vi.fn().mockResolvedValue({ id });
  const retrieve = vi.fn().mockResolvedValue({ active: true, type: "one_time", currency: "usd", unit_amount: 1_899,
    product: { active: true, name: "Job Match Search" } });
  const stripe = { accounts: { retrieveCurrent }, prices: { retrieve } } as unknown as Stripe;
  return { stripe, retrieveCurrent, retrieve };
}

describe("Stripe credential account identity", () => {
  beforeEach(() => vi.stubEnv("STRIPE_EXPECTED_ACCOUNT_ID", accountId));
  afterEach(() => vi.unstubAllEnvs());

  it("verifies the credential's own account before retrieving a new-checkout price", async () => {
    const f = provider();
    await expect(assertConfiguredPrice(f.stripe, "price_search", expectedPrice)).resolves.toMatchObject({ unit_amount: 1_899 });
    expect(f.retrieveCurrent).toHaveBeenCalledOnce();
    expect(f.retrieveCurrent.mock.invocationCallOrder[0]).toBeLessThan(f.retrieve.mock.invocationCallOrder[0]);
  });

  it("rejects a different sandbox even if its catalog matches the required product", async () => {
    const f = provider("acct_1Sx9HmHIQhVBusrZ");
    await expect(assertConfiguredPrice(f.stripe, "price_search", expectedPrice)).rejects.toThrow("does not match");
    expect(f.retrieve).not.toHaveBeenCalled();
  });

  it.each(["", "acct_", "acct_bad/value", "sk_test_wrong"])("rejects invalid account configuration %s without provider calls", async (id) => {
    vi.stubEnv("STRIPE_EXPECTED_ACCOUNT_ID", id);
    const f = provider();
    await expect(assertStripeAccount(f.stripe)).rejects.toThrow("not configured");
    expect(f.retrieveCurrent).not.toHaveBeenCalled();
  });

  it("fails closed on unavailable or denied account lookup and permits a later verified retry", async () => {
    const f = provider();
    f.retrieveCurrent.mockRejectedValueOnce(new Error("provider permission denied"));
    await expect(assertConfiguredPrice(f.stripe, "price_search", expectedPrice)).rejects.toThrow();
    expect(f.retrieve).not.toHaveBeenCalled();
    await expect(assertStripeAccount(f.stripe)).resolves.toBe(accountId);
  });

  it("rechecks changed account configuration instead of trusting a prior successful lookup", async () => {
    const f = provider();
    await assertStripeAccount(f.stripe);
    vi.stubEnv("STRIPE_EXPECTED_ACCOUNT_ID", "acct_other");
    await expect(assertStripeAccount(f.stripe)).rejects.toThrow("does not match");
  });

  it("keeps the operational client available while new checkout is locked", () => {
    vi.stubEnv("APP_PAYMENT_MODE", "test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
    vi.stubEnv("APP_CHECKOUT_ENABLED", "false");
    vi.stubEnv("APP_REHEARSAL_CHECKOUT_ENABLED", "false");
    vi.stubEnv("APP_CANARY_CHECKOUT_ENABLED", "false");
    expect(createStripeOperationalClient()).not.toBeNull();
    expect(createStripeSearchClient()).toBeNull();
  });

  it("does not apply new-checkout account permission to historical price reconciliation", async () => {
    vi.stubEnv("STRIPE_EXPECTED_ACCOUNT_ID", "");
    const f = provider();
    f.retrieve.mockResolvedValue({ active: false, type: "one_time", currency: "usd", unit_amount: 2_000,
      product: { active: false, name: "Job Match Search" } });
    await expect(assertConfiguredPrice(f.stripe, "price_historical", {
      unitAmount: 2_000, productName: "Job Match Search", historicalReconciliation: true,
    })).resolves.toMatchObject({ active: false });
    expect(f.retrieveCurrent).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
vi.mock("server-only", () => ({}));
import { assertConfiguredPrice } from "@/lib/stripe/server";

describe("historical Stripe price reconciliation", () => {
  beforeEach(() => vi.stubEnv("STRIPE_EXPECTED_ACCOUNT_ID", "acct_historicalfixture"));
  afterEach(() => vi.unstubAllEnvs());
  const price = { active: false, type: "one_time", currency: "usd", unit_amount: 2_000,
    product: { active: false, name: "Job Match Search" } };
  const stripe = (value = price) => ({
    accounts: { retrieveCurrent: vi.fn().mockResolvedValue({ id: "acct_historicalfixture" }) },
    prices: { retrieve: vi.fn().mockResolvedValue(value) },
  }) as unknown as Stripe;
  it("keeps inactive historical products unavailable for new checkout", async () => {
    await expect(assertConfiguredPrice(stripe(), "price_retired", { unitAmount: 2_000, productName: "Job Match Search" })).rejects.toThrow();
  });
  it("verifies immutable legacy semantics for delayed signed payment events after price retirement", async () => {
    await expect(assertConfiguredPrice(stripe(), "price_retired", { unitAmount: 2_000, productName: "Job Match Search", historicalReconciliation: true })).resolves.toEqual(price);
  });
  it("still rejects the wrong amount even on historical reconciliation", async () => {
    await expect(assertConfiguredPrice(stripe(), "price_retired", { unitAmount: 1_899, productName: "Job Match Search", historicalReconciliation: true })).rejects.toThrow();
  });
});

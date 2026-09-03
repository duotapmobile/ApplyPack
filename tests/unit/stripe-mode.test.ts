import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkoutConfiguration, stripeCredentialMode, stripeEventMatchesConfiguredMode } from "@/lib/stripe/mode";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

describe("Stripe payment-mode guard", () => {
  it("recognizes secret and restricted test/live credentials", () => {
    expect(stripeCredentialMode("sk_test_example")).toBe("test");
    expect(stripeCredentialMode("rk_test_example")).toBe("test");
    expect(stripeCredentialMode("sk_live_example")).toBe("live");
    expect(stripeCredentialMode("rk_live_example")).toBe("live");
  });

  it("defaults to disabled and cannot accept webhooks", () => {
    delete process.env.APP_PAYMENT_MODE;
    expect(checkoutConfiguration().ready).toBe(false);
    expect(stripeEventMatchesConfiguredMode(false)).toBe(false);
  });

  it("accepts only test events in a fully configured test environment", () => {
    Object.assign(process.env, {
      APP_PAYMENT_MODE: "test",
      APP_CHECKOUT_ENABLED: "true",
      APP_LIVE_PAYMENTS_ENABLED: "false",
      STRIPE_SECRET_KEY: "rk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      STRIPE_JOB_SEARCH_PRICE_ID: "price_search",
      STRIPE_APPLY_PACK_PRICE_ID: "price_apply",
    });
    expect(checkoutConfiguration().ready).toBe(true);
    expect(stripeEventMatchesConfiguredMode(false)).toBe(true);
    expect(stripeEventMatchesConfiguredMode(true)).toBe(false);
  });

  it("requires a second explicit switch before live payments are ready", () => {
    Object.assign(process.env, {
      APP_PAYMENT_MODE: "live",
      APP_CHECKOUT_ENABLED: "true",
      APP_LIVE_PAYMENTS_ENABLED: "false",
      STRIPE_SECRET_KEY: "rk_live_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      STRIPE_JOB_SEARCH_PRICE_ID: "price_search",
      STRIPE_APPLY_PACK_PRICE_ID: "price_apply",
    });
    expect(checkoutConfiguration().ready).toBe(false);
    process.env.APP_LIVE_PAYMENTS_ENABLED = "true";
    expect(checkoutConfiguration().ready).toBe(true);
  });

  it("keeps the Stripe setup product names aligned with checkout validation", () => {
    const setupScript = fs.readFileSync(path.join(process.cwd(), "scripts/configure-stripe-test-prices.mjs"), "utf8");
    expect(setupScript).toContain('productName: "Job Match Search"');
    expect(setupScript).toContain('productName: "Apply Pack"');
    expect(setupScript).toContain('expand: ["data.product"]');
    expect(setupScript).toContain("stripe.products.update");
  });
});

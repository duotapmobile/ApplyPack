import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkoutConfiguration, checkoutMode, stripeCredentialMode, stripeEventMatchesConfiguredMode } from "@/lib/stripe/mode";

const original = { ...process.env };
afterEach(() => {
  process.env = { ...original };
});

describe("Stripe payment-mode guard", () => {
  beforeEach(() => {
    Object.assign(process.env, {
      APP_DEPLOYMENT_ENV: "staging", NEXT_PUBLIC_APP_URL: "https://applypack-staging-staging.up.railway.app",
      NEXT_PUBLIC_SUPABASE_URL: "https://fmugizadzdnqfckujqlw.supabase.co", APP_RELEASE_SHA: "a".repeat(40),
      RAILWAY_GIT_COMMIT_SHA: "", APP_EXPECTED_RELEASE_SHA: "a".repeat(40),
      APP_CHECKOUT_ENABLED: "false", APP_CANARY_CHECKOUT_ENABLED: "false", APP_REHEARSAL_CHECKOUT_ENABLED: "false",
      APP_LIVE_PAYMENTS_ENABLED: "false", APP_JOB_BOARD_CHECKOUT_ENABLED: "false", APP_JOB_SOURCE_SYNC_ENABLED: "false",
      STRIPE_EXPECTED_ACCOUNT_ID: "acct_sandboxfixture",
    });
  });
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
      APP_REHEARSAL_CHECKOUT_ENABLED: "true",
      APP_LIVE_PAYMENTS_ENABLED: "false",
      STRIPE_SECRET_KEY: "rk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      STRIPE_JOB_SEARCH_PRICE_ID: "price_search",
      STRIPE_APPLY_PACK_PRICE_ID: "price_apply",
    });
    expect(checkoutConfiguration().ready).toBe(true);
    expect(checkoutConfiguration().boardReady).toBe(false);
    expect(stripeEventMatchesConfiguredMode(false)).toBe(true);
    expect(stripeEventMatchesConfiguredMode(true)).toBe(false);
  });

  it("requires a second explicit switch before live payments are ready", () => {
    Object.assign(process.env, {
      APP_DEPLOYMENT_ENV: "production", NEXT_PUBLIC_APP_URL: "https://applypack.work",
      NEXT_PUBLIC_SUPABASE_URL: `https://${"p".repeat(20)}.supabase.co`, APP_EXPECTED_SUPABASE_PROJECT_REF: "p".repeat(20),
      APP_PAYMENT_MODE: "live",
      APP_CHECKOUT_ENABLED: "true",
      APP_LIVE_PAYMENTS_ENABLED: "false",
      STRIPE_SECRET_KEY: "rk_live_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      STRIPE_JOB_SEARCH_PRICE_ID: "price_search",
      STRIPE_APPLY_PACK_PRICE_ID: "price_apply",
    });
    expect(checkoutConfiguration().ready).toBe(false);
    expect(checkoutConfiguration().commerceConfigured).toBe(true);
    process.env.APP_LIVE_PAYMENTS_ENABLED = "true";
    expect(checkoutConfiguration().ready).toBe(true);
    expect(checkoutConfiguration().boardReady).toBe(false);
  });

  it("distinguishes sandbox modes and rejects production canaries before public invitation", () => {
    Object.assign(process.env, { APP_PAYMENT_MODE: "test", STRIPE_SECRET_KEY: "sk_test_fixture" });
    expect(checkoutMode()).toBe("LOCKED_STAGING");
    process.env.APP_REHEARSAL_CHECKOUT_ENABLED = "true";
    expect(checkoutMode()).toBe("STAGING_REHEARSAL");
    process.env.APP_REHEARSAL_CHECKOUT_ENABLED = "false"; process.env.APP_CANARY_CHECKOUT_ENABLED = "true";
    expect(checkoutMode()).toBe("STAGING_CANARY");
    Object.assign(process.env, { APP_CANARY_CHECKOUT_ENABLED: "false", APP_PAYMENT_MODE: "live", STRIPE_SECRET_KEY: "sk_live_fixture",
      APP_DEPLOYMENT_ENV: "production", NEXT_PUBLIC_APP_URL: "https://applypack.work",
      NEXT_PUBLIC_SUPABASE_URL: `https://${"p".repeat(20)}.supabase.co`, APP_EXPECTED_SUPABASE_PROJECT_REF: "p".repeat(20) });
    expect(checkoutMode()).toBe("LOCKED_PRODUCTION");
    process.env.APP_CANARY_CHECKOUT_ENABLED = "true"; process.env.APP_LIVE_PAYMENTS_ENABLED = "true";
    expect(checkoutMode()).toBe("INVALID");
    expect(checkoutConfiguration()).toMatchObject({ ready: false, sessionCreationAllowed: false, restrictedMode: null });
    process.env.APP_CANARY_CHECKOUT_ENABLED = "false"; process.env.APP_CHECKOUT_ENABLED = "true";
    expect(checkoutMode()).toBe("PUBLIC_INVITATION");
  });

  it.each([undefined, "", "acct_", "acct_bad/value", " acct_sandboxfixture", "sk_test_wrong"])(
    "blocks new checkout when the expected account ID is absent or malformed: %s", (accountId) => {
      Object.assign(process.env, {
        APP_PAYMENT_MODE: "test", APP_REHEARSAL_CHECKOUT_ENABLED: "true", STRIPE_SECRET_KEY: "rk_test_example",
        STRIPE_WEBHOOK_SECRET: "whsec_example", STRIPE_JOB_SEARCH_PRICE_ID: "price_search", STRIPE_APPLY_PACK_PRICE_ID: "price_pack",
      });
      if (accountId === undefined) delete process.env.STRIPE_EXPECTED_ACCOUNT_ID;
      else process.env.STRIPE_EXPECTED_ACCOUNT_ID = accountId;
      expect(checkoutConfiguration()).toMatchObject({ accountConfigured: false, commerceConfigured: false, ready: false, searchReady: false });
    },
  );

  it.each([
    { APP_CHECKOUT_ENABLED: "true" }, { APP_LIVE_PAYMENTS_ENABLED: "true" },
    { APP_CANARY_CHECKOUT_ENABLED: "true" }, { APP_EXPECTED_RELEASE_SHA: "b".repeat(40) },
    { NEXT_PUBLIC_APP_URL: "https://unknown.example" }, { NEXT_PUBLIC_SUPABASE_URL: "https://wrong.supabase.co" },
    { APP_REHEARSAL_CHECKOUT_ENABLED: "yes" }, { APP_DEPLOYMENT_ENV: "unknown" },
    { STRIPE_SECRET_KEY: "sk_live_fixture" }, { APP_JOB_SOURCE_SYNC_ENABLED: "true" },
  ])("fails closed for a wrong or mixed rehearsal configuration: %o", (changes) => {
    Object.assign(process.env, { APP_PAYMENT_MODE: "test", STRIPE_SECRET_KEY: "sk_test_fixture", APP_REHEARSAL_CHECKOUT_ENABLED: "true" }, changes);
    expect(checkoutMode()).toBe("INVALID"); expect(checkoutConfiguration().ready).toBe(false);
  });

  it("requires every checkout switch and never advertises restricted orders as public", () => {
    Object.assign(process.env, { APP_PAYMENT_MODE: "test", STRIPE_SECRET_KEY: "sk_test_fixture", APP_REHEARSAL_CHECKOUT_ENABLED: "true",
      STRIPE_WEBHOOK_SECRET: "whsec_example", STRIPE_JOB_SEARCH_PRICE_ID: "price_search", STRIPE_APPLY_PACK_PRICE_ID: "price_pack" });
    expect(checkoutConfiguration()).toMatchObject({ ready: true, acceptingOrders: false, restrictedMode: "REHEARSAL" });
    delete process.env.APP_CANARY_CHECKOUT_ENABLED;
    expect(checkoutMode()).toBe("INVALID");
  });

  it.each(["APP_JOB_BOARD_CHECKOUT_ENABLED", "APP_JOB_SOURCE_SYNC_ENABLED"])("requires explicit false for %s", (name) => {
    Object.assign(process.env, { APP_PAYMENT_MODE: "test", STRIPE_SECRET_KEY: "sk_test_fixture" });
    expect(checkoutMode()).toBe("LOCKED_STAGING");
    delete process.env[name]; expect(checkoutMode()).toBe("INVALID");
  });

  it("keeps the Stripe setup product names aligned with checkout validation", () => {
    const setupScript = fs.readFileSync(path.join(process.cwd(), "scripts/configure-stripe-test-prices.mjs"), "utf8");
    expect(setupScript).toContain('productName: "Job Match Search"');
    expect(setupScript).toContain('productName: "Tailored Resume + Cover Letter"');
    expect(setupScript).toContain('lookupKey: "job_match_search_usd_1899_manual_launch_v2"');
    expect(setupScript).toContain('lookupKey: "apply_pack_usd_799_manual_launch_v2"');
    expect(setupScript).toContain("amount: 1_899");
    expect(setupScript).toContain("amount: 799");
    expect(setupScript).toContain("retireBoardProducts");
    expect(setupScript).not.toContain("ensureRecurringPrice");
    expect(setupScript).toContain('expand: ["data.product"]');
    expect(setupScript).toContain("stripe.products.update");
  });

  it("keeps board checkout locked even when obsolete environment values are present", () => {
    Object.assign(process.env, {
      APP_PAYMENT_MODE: "test",
      APP_CHECKOUT_ENABLED: "true",
      APP_JOB_BOARD_CHECKOUT_ENABLED: "true",
      STRIPE_SECRET_KEY: "rk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      STRIPE_JOB_SEARCH_PRICE_ID: "price_search",
      STRIPE_APPLY_PACK_PRICE_ID: "price_apply",
      STRIPE_JOB_BOARD_WEEKLY_PRICE_ID: "price_weekly",
      STRIPE_JOB_BOARD_MONTHLY_PRICE_ID: "price_monthly",
      STRIPE_JOB_BOARD_THREE_MONTH_PRICE_ID: "price_three_month",
    });
    const configuration = checkoutConfiguration();
    expect(configuration.boardPricesConfigured).toBe(false);
    expect(configuration.boardReady).toBe(false);
  });
});

export type PaymentMode = "disabled" | "test" | "live";
export type StripeCredentialMode = "missing" | "test" | "live" | "unknown";
export type CheckoutMode = "LOCKED_STAGING" | "STAGING_REHEARSAL" | "STAGING_CANARY"
  | "LOCKED_PRODUCTION" | "PUBLIC_INVITATION" | "INVALID";

export const STAGING_CHECKOUT_ORIGIN = "https://applypack-staging-staging.up.railway.app";
export const STAGING_SUPABASE_ORIGIN = "https://fmugizadzdnqfckujqlw.supabase.co";

function exactOrigin(value: string | undefined, expected: string) {
  try {
    const parsed = new URL(value || "");
    return parsed.origin === expected && !parsed.username && !parsed.password
      && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch { return false; }
}

export function checkoutMode(): CheckoutMode {
  const names = ["APP_CHECKOUT_ENABLED", "APP_CANARY_CHECKOUT_ENABLED", "APP_REHEARSAL_CHECKOUT_ENABLED",
    "APP_LIVE_PAYMENTS_ENABLED", "APP_JOB_BOARD_CHECKOUT_ENABLED", "APP_JOB_SOURCE_SYNC_ENABLED"];
  if (names.some((name) => !["true", "false"].includes(process.env[name] || ""))) return "INVALID";
  if (process.env.APP_JOB_BOARD_CHECKOUT_ENABLED !== "false" || process.env.APP_JOB_SOURCE_SYNC_ENABLED !== "false") return "INVALID";
  const publicEnabled = process.env.APP_CHECKOUT_ENABLED === "true";
  const canary = process.env.APP_CANARY_CHECKOUT_ENABLED === "true";
  const rehearsal = process.env.APP_REHEARSAL_CHECKOUT_ENABLED === "true";
  const live = process.env.APP_LIVE_PAYMENTS_ENABLED === "true";
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_RELEASE_SHA || "";
  if (!/^[0-9a-f]{40}$/.test(sha) || process.env.APP_EXPECTED_RELEASE_SHA !== sha
    || [publicEnabled, canary, rehearsal].filter(Boolean).length > 1) return "INVALID";
  const payment = configuredPaymentMode();
  if (stripeCredentialMode(process.env.STRIPE_SECRET_KEY) !== payment) return "INVALID";
  if (process.env.APP_DEPLOYMENT_ENV === "staging") {
    if (payment !== "test" || live || publicEnabled
      || !exactOrigin(process.env.NEXT_PUBLIC_APP_URL, STAGING_CHECKOUT_ORIGIN)
      || !exactOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL, STAGING_SUPABASE_ORIGIN)) return "INVALID";
    return rehearsal ? "STAGING_REHEARSAL" : canary ? "STAGING_CANARY" : "LOCKED_STAGING";
  }
  if (process.env.APP_DEPLOYMENT_ENV === "production") {
    const project = process.env.APP_EXPECTED_SUPABASE_PROJECT_REF || "";
    if (payment !== "live" || rehearsal || canary || !exactOrigin(process.env.NEXT_PUBLIC_APP_URL, "https://applypack.work")
      || !/^[a-z]{20}$/.test(project) || project === "fmugizadzdnqfckujqlw"
      || !exactOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL, `https://${project}.supabase.co`)) return "INVALID";
    if (publicEnabled) return live ? "PUBLIC_INVITATION" : "INVALID";
    return live ? "INVALID" : "LOCKED_PRODUCTION";
  }
  return "INVALID";
}

export function stripeCredentialMode(secretKey: string | undefined): StripeCredentialMode {
  if (!secretKey) return "missing";
  if (/^(?:sk|rk)_test_/.test(secretKey)) return "test";
  if (/^(?:sk|rk)_live_/.test(secretKey)) return "live";
  return "unknown";
}

export function configuredPaymentMode(value = process.env.APP_PAYMENT_MODE): PaymentMode {
  return value === "test" || value === "live" ? value : "disabled";
}

export function configuredStripeAccountId(): string | null {
  const value = process.env.STRIPE_EXPECTED_ACCOUNT_ID || "";
  return /^acct_[A-Za-z0-9]+$/.test(value) ? value : null;
}

export function checkoutConfiguration() {
  const mode = configuredPaymentMode();
  const credentialMode = stripeCredentialMode(process.env.STRIPE_SECRET_KEY);
  const checkoutEnabled = process.env.APP_CHECKOUT_ENABLED === "true";
  const livePaymentsEnabled = process.env.APP_LIVE_PAYMENTS_ENABLED === "true";
  const modeMatchesCredential = mode !== "disabled" && mode === credentialMode;
  const liveGuardSatisfied = mode !== "live" || livePaymentsEnabled;
  const pricesConfigured = Boolean(
    process.env.STRIPE_JOB_SEARCH_PRICE_ID && process.env.STRIPE_APPLY_PACK_PRICE_ID,
  );
  const searchPriceConfigured = Boolean(process.env.STRIPE_JOB_SEARCH_PRICE_ID);
  const webhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const accountConfigured = configuredStripeAccountId() !== null;
  // Provider readiness remains available while permission to create charges is locked.
  const commerceConfigured = modeMatchesCredential && pricesConfigured && webhookConfigured && accountConfigured;
  const state = checkoutMode();
  const sessionCreationAllowed = commerceConfigured && liveGuardSatisfied
    && ["STAGING_REHEARSAL", "STAGING_CANARY", "PUBLIC_INVITATION"].includes(state);
  const acceptingOrders = state === "PUBLIC_INVITATION" && sessionCreationAllowed;

  return {
    mode,
    state,
    validState: state !== "INVALID",
    sessionCreationAllowed,
    restrictedMode: state === "STAGING_REHEARSAL" ? "REHEARSAL"
      : state === "STAGING_CANARY" ? "CANARY" : null,
    credentialMode,
    checkoutEnabled,
    livePaymentsEnabled,
    modeMatchesCredential,
    liveGuardSatisfied,
    pricesConfigured,
    boardPricesConfigured: false,
    searchPriceConfigured,
    webhookConfigured,
    accountConfigured,
    commerceConfigured,
    acceptingOrders,
    searchReady: sessionCreationAllowed && searchPriceConfigured,
    ready: sessionCreationAllowed,
    boardReady: false,
  };
}

export function stripeEventMatchesConfiguredMode(livemode: boolean): boolean {
  const mode = configuredPaymentMode();
  if (mode === "disabled") return false;
  return livemode === (mode === "live");
}

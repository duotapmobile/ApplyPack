export type PaymentMode = "disabled" | "test" | "live";
export type StripeCredentialMode = "missing" | "test" | "live" | "unknown";

export function stripeCredentialMode(secretKey: string | undefined): StripeCredentialMode {
  if (!secretKey) return "missing";
  if (/^(?:sk|rk)_test_/.test(secretKey)) return "test";
  if (/^(?:sk|rk)_live_/.test(secretKey)) return "live";
  return "unknown";
}

export function configuredPaymentMode(value = process.env.APP_PAYMENT_MODE): PaymentMode {
  return value === "test" || value === "live" ? value : "disabled";
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

  return {
    mode,
    credentialMode,
    checkoutEnabled,
    livePaymentsEnabled,
    modeMatchesCredential,
    liveGuardSatisfied,
    pricesConfigured,
    ready:
      checkoutEnabled &&
      modeMatchesCredential &&
      liveGuardSatisfied &&
      pricesConfigured &&
      Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  };
}

export function stripeEventMatchesConfiguredMode(livemode: boolean): boolean {
  const mode = configuredPaymentMode();
  if (mode === "disabled") return false;
  return livemode === (mode === "live");
}

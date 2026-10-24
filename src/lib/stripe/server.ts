import "server-only";
import Stripe from "stripe";
import { checkoutConfiguration, configuredPaymentMode, configuredStripeAccountId, stripeCredentialMode } from "./mode";

function instantiateStripe(secretKey: string) {
  return new Stripe(secretKey, {
    appInfo: { name: "ApplyPack", version: "0.1.0" },
  });
}

export function createStripeOperationalClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const mode = configuredPaymentMode();
  if (!secretKey || mode === "disabled" || stripeCredentialMode(secretKey) !== mode) return null;
  return instantiateStripe(secretKey);
}

export function createStripeClient() {
  if (!checkoutConfiguration().ready) return null;
  return createStripeOperationalClient();
}

export function createStripeSearchClient() {
  if (!checkoutConfiguration().searchReady) return null;
  return createStripeOperationalClient();
}

export function createStripeMaterialsClient() {
  if (!checkoutConfiguration().ready) return null;
  return createStripeOperationalClient();
}

export function createStripeBoardClient() {
  return null;
}

export async function assertStripeAccount(stripe: Stripe): Promise<string> {
  const expectedAccountId = configuredStripeAccountId();
  if (!expectedAccountId) throw new Error("Stripe account identity is not configured.");
  // Retrieve the credential's own account, not a connected account by supplied ID.
  const account = await stripe.accounts.retrieveCurrent({}, { timeout: 5_000, maxNetworkRetries: 0 });
  if (account.id !== expectedAccountId) {
    throw new Error("Stripe credential does not match the configured account.");
  }
  return account.id;
}

export async function assertConfiguredPrice(
  stripe: Stripe,
  priceId: string,
  expected: { unitAmount: number; productName: string; historicalReconciliation?: boolean },
) {
  if (!expected.historicalReconciliation) await assertStripeAccount(stripe);
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  const product = typeof price.product === "string" ? null : price.product;
  if (
    (!price.active && !expected.historicalReconciliation) ||
    price.type !== "one_time" ||
    price.currency.toLowerCase() !== "usd" ||
    price.unit_amount !== expected.unitAmount ||
    !product ||
    product.deleted ||
    (!product.active && !expected.historicalReconciliation) ||
    product.name !== expected.productName
  ) {
    throw new Error("Configured Stripe price does not match the approved product.");
  }
  return price;
}

export async function assertConfiguredRecurringPrice(
  stripe: Stripe,
  priceId: string,
  expected: { unitAmount: number; interval: "week" | "month"; intervalCount: number },
) {
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  const product = typeof price.product === "string" ? null : price.product;
  if (!price.active || price.type !== "recurring" || price.currency.toLowerCase() !== "usd"
    || price.unit_amount !== expected.unitAmount || price.recurring?.interval !== expected.interval
    || price.recurring.interval_count !== expected.intervalCount || price.recurring.usage_type !== "licensed"
    || !product || product.deleted || !product.active) {
    throw new Error("Configured Stripe recurring price does not match the approved plan.");
  }
  return price;
}

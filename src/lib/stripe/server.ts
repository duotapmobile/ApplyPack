import "server-only";
import Stripe from "stripe";
import { checkoutConfiguration, configuredPaymentMode, stripeCredentialMode } from "./mode";

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

export async function assertConfiguredPrice(
  stripe: Stripe,
  priceId: string,
  expected: { unitAmount: number; productName: string },
) {
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  const product = typeof price.product === "string" ? null : price.product;
  if (
    !price.active ||
    price.type !== "one_time" ||
    price.currency.toLowerCase() !== "usd" ||
    price.unit_amount !== expected.unitAmount ||
    !product ||
    product.deleted ||
    !product.active ||
    product.name !== expected.productName
  ) {
    throw new Error("Configured Stripe price does not match the approved product.");
  }
  return price;
}

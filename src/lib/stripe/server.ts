import "server-only";
import Stripe from "stripe";

export function createStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey, {
    appInfo: { name: "ApplyPack", version: "0.1.0" },
  });
}

import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { canonicalSha256 } from "@/lib/domain/foundation";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createCapabilitySecret() {
  return randomBytes(32).toString("base64url");
}

export function deriveCheckoutCapability(draftSecret: string, requestKey: string, purpose: "browser" | "email") {
  if (!TOKEN_PATTERN.test(draftSecret) || !requestKey) throw new Error("invalid_checkout_capability_seed");
  return createHmac("sha256", Buffer.from(draftSecret, "utf8"))
    .update(`applypack:chunk4:${purpose}:${requestKey}`, "utf8")
    .digest("base64url");
}

export function hashCapabilitySecret(secret: string) {
  if (!TOKEN_PATTERN.test(secret)) throw new Error("invalid_access_capability");
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function deterministicUuid(value: string) {
  const hex = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

export function searchCheckoutRequestKey(input: { draftId: string; snapshotId: string; assessmentId: string }) {
  return `search:${canonicalSha256({ ...input, version: "chunk4-v1" })}`;
}

export function searchQuoteSha256(input: {
  draftId: string;
  snapshotId: string;
  assessmentId: string;
  requestKey: string;
  pricingVersion: string;
  taxVersion: string;
  termsVersion: string;
  privacyVersion: string;
}) {
  return canonicalSha256({
    ...input,
    amountCents: 2_000,
    currency: "USD",
    mode: "payment",
    paymentMethodTypes: ["card"],
    quantity: 1,
    taxInclusive: true,
    product: "SEARCH_EXACT_TEN",
  });
}

export function serializeCheckoutCapability(value: { checkoutAttemptId: string; secret: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(value.checkoutAttemptId) || !TOKEN_PATTERN.test(value.secret)) {
    throw new Error("invalid_checkout_capability");
  }
  return `${value.checkoutAttemptId}.${value.secret}`;
}

export function parseCheckoutCapability(value: string | undefined) {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator < 1 || value.indexOf(".", separator + 1) !== -1) return null;
  const checkoutAttemptId = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutAttemptId)
    || !TOKEN_PATTERN.test(secret)) return null;
  return { checkoutAttemptId, secret };
}

export function serializeOrderAccessCapability(value: { capabilityId: string; secret: string }) {
  return serializeCheckoutCapability({ checkoutAttemptId: value.capabilityId, secret: value.secret });
}

export function parseOrderAccessCapability(value: string | null | undefined) {
  const parsed = parseCheckoutCapability(value || undefined);
  return parsed ? { capabilityId: parsed.checkoutAttemptId, secret: parsed.secret } : null;
}

export function checkoutCookieSettings(environment: Partial<NodeJS.ProcessEnv> = process.env) {
  const production = environment.NODE_ENV === "production";
  return {
    httpOnly: true,
    maxAge: 15 * 60,
    name: production ? "__Host-applypack_checkout" : "applypack_checkout",
    path: "/",
    priority: "high" as const,
    sameSite: "lax" as const,
    secure: production,
  };
}

export function canonicalApplicationOrigin(environment: Partial<NodeJS.ProcessEnv> = process.env) {
  const raw = environment.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) throw new Error("canonical_site_url_missing");
  const url = new URL(raw);
  if (environment.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("canonical_site_url_insecure");
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("canonical_site_url_invalid");
  return url.origin;
}

export function immediateSearchPayment(input: {
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent;
  charge: Stripe.Charge | null;
  expectedPriceId: string;
}) {
  const line = input.session.line_items?.data?.[0];
  const type = input.charge?.payment_method_details?.type || input.paymentIntent.payment_method_types?.[0] || "";
  const valid = input.session.mode === "payment"
    && input.session.payment_status === "paid"
    && input.session.amount_total === 2_000
    && input.session.currency?.toUpperCase() === "USD"
    && input.session.line_items?.data.length === 1
    && line?.quantity === 1
    && line.price?.id === input.expectedPriceId
    && input.paymentIntent.status === "succeeded"
    && input.paymentIntent.amount_received === 2_000
    && input.paymentIntent.currency.toUpperCase() === "USD"
    && input.paymentIntent.capture_method !== "manual"
    && input.paymentIntent.amount_capturable === 0
    && input.charge?.paid === true
    && input.charge.status === "succeeded"
    && type === "card";
  return { valid, paymentMethodType: type, paymentVerifiedAt: input.charge ? new Date(input.charge.created * 1_000).toISOString() : null };
}

export const postgresBytea = (value: Uint8Array) => `\\x${Buffer.from(value).toString("hex")}`;

export function parsePostgresBytea(value: unknown) {
  if (typeof value !== "string") throw new Error("invalid_bytea");
  if (value.startsWith("\\x") && /^[0-9a-f]*$/i.test(value.slice(2))) return Buffer.from(value.slice(2), "hex");
  return Buffer.from(value, "base64");
}

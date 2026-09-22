import "server-only";

import type Stripe from "stripe";
import { z } from "zod";
import { parsePostgresBytea } from "@/lib/commerce/server";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { decryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady } from "@/lib/security/sensitive-payload";
import { MATERIAL_CURRENCY, MATERIAL_LINE_PRICE_CENTS, materialTotalCents } from "./contract";

export const materialContactSchema = z.object({
  schemaVersion: z.literal("chunk5-document-contact-v1"),
  displayName: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  phone: z.string().trim().min(7).max(40),
  cityState: z.string().trim().min(2).max(120),
  linkedInOrPortfolio: z.url().max(500).nullable(),
}).strict();

export type StoredMaterialContactEnvelope = {
  ciphertext: unknown;
  encryption_algorithm: "AES-256-GCM";
  encrypted_data_key: unknown;
  nonce: unknown;
  authentication_tag: unknown;
  content_sha256: string;
  kms_key_identity: string;
  kms_key_version: string;
  encryption_context_hash: string;
};

export async function readMaterialContact(input: {
  customerId: string;
  payloadId: string;
  envelope: StoredMaterialContactEnvelope;
}) {
  const configuration = sensitivePayloadConfiguration();
  if (!sensitivePayloadEncryptionReady(configuration)) throw new Error("material_contact_kms_not_configured");
  const plaintext = await decryptSensitivePayload({
    envelope: {
      algorithm: input.envelope.encryption_algorithm,
      ciphertext: parsePostgresBytea(input.envelope.ciphertext),
      encryptedDataKey: parsePostgresBytea(input.envelope.encrypted_data_key),
      nonce: parsePostgresBytea(input.envelope.nonce),
      authenticationTag: parsePostgresBytea(input.envelope.authentication_tag),
      contentSha256: input.envelope.content_sha256,
      keyIdentity: input.envelope.kms_key_identity,
      keyVersion: input.envelope.kms_key_version,
      encryptionContextHash: input.envelope.encryption_context_hash,
    },
    context: { customerId: input.customerId, payloadId: input.payloadId, purpose: "CHUNK5_DOCUMENT_CONTACT" },
    configuration,
    kms: remoteKmsAdapter(),
  });
  try {
    return materialContactSchema.parse(JSON.parse(plaintext.toString("utf8")));
  } finally {
    plaintext.fill(0);
  }
}

export type MaterialCheckoutSelection = {
  jobMatchId: string;
  ruleId: string;
  selectedReferenceSheet: boolean;
  referencePermissionIds: string[];
  emphasisNote: string;
  doNotMentionNote: string;
};

export function materialSelectionSha256(input: {
  customerId: string;
  deliveredOrderId: string;
  deliveredReleaseId: string;
  sourceSnapshotId: string;
  contactPayloadSha256: string;
  selections: MaterialCheckoutSelection[];
  careerBreakChoice: string;
  careerBreakCustomLabel?: string | null;
  coverLetterBreakConsent: boolean;
}) {
  const selections = [...input.selections]
    .map((selection) => ({
      ...selection,
      referencePermissionIds: [...selection.referencePermissionIds].sort(),
    }))
    .sort((left, right) => left.jobMatchId.localeCompare(right.jobMatchId));
  materialTotalCents(selections.map((selection) => selection.jobMatchId));
  return canonicalSha256({ ...input, selections, priceCents: MATERIAL_LINE_PRICE_CENTS,
    currency: MATERIAL_CURRENCY, taxInclusive: true, contractVersion: "chunk5-v1" });
}

export function materialCheckoutRequestKey(selectionSha256: string) {
  return `materials:${canonicalSha256({ selectionSha256, contractVersion: "chunk5-v1" })}`;
}

export function immediateMaterialPayment(input: {
  session: Stripe.Checkout.Session;
  paymentIntent: Stripe.PaymentIntent;
  charge: Stripe.Charge | null;
  expectedPriceId: string;
  expectedLineCount: number;
}) {
  const expectedAmount = materialTotalCents(Array.from({ length: input.expectedLineCount }, (_, index) => String(index)));
  const line = input.session.line_items?.data?.[0];
  const paymentMethodType = input.charge?.payment_method_details?.type
    || input.paymentIntent.payment_method_types?.[0] || "";
  const valid = input.session.mode === "payment"
    && input.session.payment_status === "paid"
    && input.session.amount_total === expectedAmount
    && input.session.currency?.toUpperCase() === MATERIAL_CURRENCY
    && input.session.line_items?.data.length === 1
    && line?.quantity === input.expectedLineCount
    && line.price?.id === input.expectedPriceId
    && input.paymentIntent.status === "succeeded"
    && input.paymentIntent.amount_received === expectedAmount
    && input.paymentIntent.currency.toUpperCase() === MATERIAL_CURRENCY
    && input.paymentIntent.capture_method !== "manual"
    && input.paymentIntent.amount_capturable === 0
    && input.charge?.paid === true
    && input.charge.status === "succeeded"
    && paymentMethodType === "card";
  return {
    amountCents: expectedAmount,
    paymentMethodType,
    paymentVerifiedAt: input.charge ? new Date(input.charge.created * 1_000).toISOString() : null,
    valid,
  };
}

// Call only with claims verified by the auth server/JWT verifier, never decoded cookie data.
export function verifiedAuthenticationAt(claims: unknown, customerId: string) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
  const value = claims as Record<string, unknown>;
  if (value.sub !== customerId || !Array.isArray(value.amr) || !value.amr.length) return null;
  const timestamps: number[] = [];
  for (const item of value.amr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.method !== "string" || !Number.isSafeInteger(entry.timestamp)
      || (entry.timestamp as number) <= 0 || (entry.timestamp as number) > 8_640_000_000_000) return null;
    if (entry.method === "token_refresh") continue;
    if (!["otp", "magiclink", "password", "totp"].includes(entry.method)) return null;
    timestamps.push(entry.timestamp as number);
  }
  return timestamps.length ? new Date(Math.max(...timestamps) * 1_000).toISOString() : null;
}

export function isFreshAuthentication(issuedAt: string | null, now = new Date()) {
  if (!issuedAt) return false;
  const issued = new Date(issuedAt).getTime();
  return Number.isFinite(issued) && issued <= now.getTime()
    && now.getTime() - issued <= 15 * 60 * 1_000;
}

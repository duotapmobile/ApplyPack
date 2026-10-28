import { z } from "zod";
import { STAGING_CHECKOUT_ORIGIN } from "@/lib/stripe/mode";

export const SANDBOX_ACTIVATION_CONTRACT_VERSION = "sandbox-proof-live-pilot-v1";
export const SANDBOX_VALIDATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const SANDBOX_VALIDATION_PROJECT_REF = "fmugizadzdnqfckujqlw";
export const SANDBOX_VALIDATION_ACCOUNT_ID = "acct_1UTeOMJBHv2xRTvu";

const databaseUuid = z.uuid().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const purchase = z.object({
  productKind: z.enum(["SEARCH", "MATERIALS"]),
  units: z.literal(1),
  amountCents: z.union([z.literal(1_899), z.literal(799)]),
  paymentAttemptId: databaseUuid,
  checkoutSessionId: z.string().max(255).regex(/^cs_test_[A-Za-z0-9]+$/),
  paymentIntentId: z.string().max(255).regex(/^pi_[A-Za-z0-9]+$/),
  checkoutCompletedEventId: z.string().max(255).regex(/^evt_[A-Za-z0-9]+$/),
  deliveredReleaseId: databaseUuid,
  refundId: z.string().max(255).regex(/^re_[A-Za-z0-9]+$/),
  refundAmountCents: z.union([z.literal(1_899), z.literal(799)]),
  refundStatus: z.literal("succeeded"),
}).strict().superRefine((value, context) => {
  const amount = value.productKind === "SEARCH" ? 1_899 : 799;
  if (value.amountCents !== amount || value.refundAmountCents !== amount) {
    context.addIssue({ code: "custom", message: "Each sandbox purchase requires its exact fixed total and successful full refund." });
  }
});

export const sandboxValidationSchema = z.object({
  schemaVersion: z.literal("applypack-sandbox-validation-v1"),
  sourceEnvironment: z.literal("staging"),
  sourceProjectRef: z.literal(SANDBOX_VALIDATION_PROJECT_REF),
  sourceOrigin: z.literal(STAGING_CHECKOUT_ORIGIN),
  stripeAccountId: z.literal(SANDBOX_VALIDATION_ACCOUNT_ID),
  livemode: z.literal(false),
  currency: z.literal("USD"),
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/),
  verifiedAt: z.iso.datetime().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/),
  proofBundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  purchases: z.array(purchase).length(2),
}).strict().superRefine((value, context) => {
  if (new Set(value.purchases.map((entry) => entry.productKind)).size !== 2) {
    context.addIssue({ code: "custom", message: "Sandbox validation requires one search and one Apply Pack." });
  }
  for (const key of ["paymentAttemptId", "checkoutSessionId", "paymentIntentId", "checkoutCompletedEventId", "deliveredReleaseId", "refundId"] as const) {
    if (new Set(value.purchases.map((entry) => entry[key])).size !== 2) {
      context.addIssue({ code: "custom", message: `Sandbox purchases must have distinct ${key} values.` });
    }
  }
});

export type SandboxValidationReceipt = z.infer<typeof sandboxValidationSchema>;

/** Checks reviewed evidence; this is not a Stripe-signed attestation. */
export function sandboxValidationMatchesRelease(value: unknown, releaseSha: string, activationTime = Date.now()) {
  const parsed = sandboxValidationSchema.safeParse(value);
  if (!parsed.success || parsed.data.releaseSha !== releaseSha || !Number.isFinite(activationTime)) return false;
  const verifiedAt = Date.parse(parsed.data.verifiedAt);
  return verifiedAt <= activationTime && activationTime - verifiedAt <= SANDBOX_VALIDATION_MAX_AGE_MS;
}

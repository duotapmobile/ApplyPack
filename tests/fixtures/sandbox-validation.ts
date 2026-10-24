import type { SandboxValidationReceipt } from "../../src/lib/operations/sandbox-validation";

export const sandboxReleaseSha = "a".repeat(40);
export const sandboxVerifiedAt = "2026-10-23T12:00:00.000Z";

export function sandboxValidationFixture(): SandboxValidationReceipt {
  return {
    schemaVersion: "applypack-sandbox-validation-v1",
    sourceEnvironment: "staging",
    sourceProjectRef: "fmugizadzdnqfckujqlw",
    sourceOrigin: "https://applypack-staging-staging.up.railway.app",
    stripeAccountId: "acct_1UTeOMJBHv2xRTvu",
    livemode: false,
    currency: "USD",
    releaseSha: sandboxReleaseSha,
    verifiedAt: sandboxVerifiedAt,
    proofBundleSha256: "b".repeat(64),
    purchases: [
      {
        productKind: "SEARCH", units: 1, amountCents: 1_899,
        paymentAttemptId: "00000000-0000-4000-8000-000000000001",
        checkoutSessionId: "cs_test_search", paymentIntentId: "pi_search", checkoutCompletedEventId: "evt_search",
        deliveredReleaseId: "00000000-0000-4000-8000-000000000003",
        refundId: "re_search", refundAmountCents: 1_899, refundStatus: "succeeded",
      },
      {
        productKind: "MATERIALS", units: 1, amountCents: 799,
        paymentAttemptId: "00000000-0000-4000-8000-000000000002",
        checkoutSessionId: "cs_test_pack", paymentIntentId: "pi_pack", checkoutCompletedEventId: "evt_pack",
        deliveredReleaseId: "00000000-0000-4000-8000-000000000004",
        refundId: "re_pack", refundAmountCents: 799, refundStatus: "succeeded",
      },
    ],
  };
}

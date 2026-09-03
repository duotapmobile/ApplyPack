import { configuredPaymentMode } from "@/lib/stripe/mode";

export function safeTransactionalRecipient(recipient: string): string {
  if (configuredPaymentMode() !== "test") return recipient;
  const allowed = new Set(
    (process.env.APP_SAFE_TEST_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!allowed.has(recipient.trim().toLowerCase())) {
    throw new Error("Test-mode email recipient is not allowlisted.");
  }
  return recipient;
}

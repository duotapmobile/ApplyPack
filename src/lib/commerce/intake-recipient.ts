import { z } from "zod";
import { intakePaymentIdentity } from "./intake-payment-identity";

const verifiedAccountSchema = z.object({
  id: z.uuid(), email: z.email().max(320), email_confirmed_at: z.iso.datetime({ offset: true }),
  is_anonymous: z.literal(false).optional(),
});

/** Caller must bind the ownership receipt to the exact intake before resolving its contact. */
export async function intakeRecipient(identityValue: unknown, historicalEmail: unknown, loadAccount: (customerId: string) => Promise<unknown>) {
  const identity = intakePaymentIdentity(identityValue);
  if (!identity.claimed) {
    const email = z.email().max(320).safeParse(historicalEmail);
    if (!email.success) throw new Error("intake_recipient_unavailable");
    return { email: email.data, customerId: null, basis: "HISTORICAL_ACCESS_EMAIL" as const };
  }
  const account = verifiedAccountSchema.safeParse(await loadAccount(identity.customerId));
  if (!account.success || account.data.id.toLowerCase() !== identity.customerId.toLowerCase()) {
    throw new Error("intake_recipient_unavailable");
  }
  return { email: account.data.email.trim().normalize("NFC").toLocaleLowerCase("en-US"),
    customerId: identity.customerId, basis: "VERIFIED_ACCOUNT" as const };
}

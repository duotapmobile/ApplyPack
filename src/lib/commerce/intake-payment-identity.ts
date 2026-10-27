import { z } from "zod";

const paymentIdentitySchema = z.discriminatedUnion("claimed", [
  z.object({ claimed: z.literal(true), customerId: z.uuid(), rootDraftId: z.uuid() }).strict(),
  z.object({ claimed: z.literal(false), customerId: z.null(), rootDraftId: z.null() }).strict(),
]);

/** Financial ownership survives private-content expiry; this receipt grants no private access. */
export function intakePaymentIdentity(value: unknown) {
  const parsed = paymentIdentitySchema.safeParse(value);
  if (!parsed.success) throw new Error("intake_payment_identity_invalid");
  return parsed.data;
}

/** Only an explicit unclaimed receipt permits the historical email-based reconciliation path. */
export async function intakePaymentCustomer(value: unknown, findHistoricalCustomer: () => Promise<string>) {
  const identity = intakePaymentIdentity(value);
  if (identity.claimed) return identity.customerId;
  const customerId = await findHistoricalCustomer();
  if (!z.uuid().safeParse(customerId).success) throw new Error("intake_payment_customer_invalid");
  return customerId;
}

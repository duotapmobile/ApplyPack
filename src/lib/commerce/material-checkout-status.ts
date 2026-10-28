import { z } from "zod";

export const materialCheckoutStatusSchema = z.object({
  checkoutIntentId: z.uuid(),
  state: z.enum(["CONFIRMING_PAYMENT", "PAYMENT_VERIFIED", "EXPIRED", "FAILED"]),
  orderId: z.uuid(),
  lineCount: z.number().int().min(1).max(10),
  amountCents: z.number().int().positive(),
  currency: z.literal("USD"),
}).strict();
export type MaterialCheckoutStatusResponse = z.infer<typeof materialCheckoutStatusSchema>;

export function materialCheckoutReturnUrls(origin: string, checkoutIntentId: string) {
  const id = z.uuid().parse(checkoutIntentId);
  const path = `${origin}/checkout/return?checkout_kind=apply_pack&material_checkout_id=${encodeURIComponent(id)}`;
  return { success_url: path, cancel_url: `${path}&cancelled=1` };
}

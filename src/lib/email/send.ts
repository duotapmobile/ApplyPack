import "server-only";
import { Resend } from "resend";

type ReceiptInput = {
  to: string;
  orderId: string;
  amountCents: number;
  deadline: string;
};

export async function sendOrderReceipt(input: ReceiptInput) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { skipped: true as const, providerMessageId: undefined };
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM || "orders@applypack.work";
  const deadline = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(input.deadline));
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    replyTo: process.env.EMAIL_REPLY_TO || "help@applypack.work",
    subject: "Your ApplyPack order is confirmed",
    text: [
      "Your payment is complete.",
      "Order: " + input.orderId,
      "Paid: $" + (input.amountCents / 100).toFixed(2),
      "Delivery deadline: " + deadline + " ET",
      "Sign in at " + (process.env.NEXT_PUBLIC_APP_URL || "https://applypack.work") + "/my-applypack",
    ].join("\n"),
  }, { idempotencyKey: "order-receipt/" + input.orderId });
  if (error) throw new Error(error.message);
  return { skipped: false as const, providerMessageId: data?.id };
}

export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  lines: string[];
  idempotencyKey: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { skipped: true as const, providerMessageId: undefined };
  const resend = new Resend(apiKey);
  const from = process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM || "orders@applypack.work";
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    replyTo: process.env.EMAIL_REPLY_TO || "help@applypack.work",
    subject: input.subject,
    text: [...input.lines, "", "Open My ApplyPack: " + (process.env.NEXT_PUBLIC_APP_URL || "https://applypack.work") + "/my-applypack"].join("\n"),
  }, { idempotencyKey: input.idempotencyKey });
  if (error) throw new Error(error.message);
  return { skipped: false as const, providerMessageId: data?.id };
}

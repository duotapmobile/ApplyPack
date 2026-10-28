import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { renderChunk4Email } from "./email";

export type PrepareIntakeNotification = (messageId: string, leaseOwner: string) => Promise<{ data: unknown; error: unknown }>;
export type PinIntakeNotification = (messageId: string, leaseOwner: string, payloadSha256: string) => Promise<{ data: unknown; error: unknown }>;
export type PrepareClaimedPaymentNotification = PrepareIntakeNotification;
export type PinClaimedPaymentNotification = PinIntakeNotification;
export type IntakeNotificationEnvelope = { from: string; to: string; replyTo: string; subject: string; text: string; html: string };

/** Explicit order covers exactly the object submitted to the provider. Never log this payload. */
export function intakeNotificationEnvelopeSha256(body: IntakeNotificationEnvelope) {
  return createHash("sha256").update(JSON.stringify({ from: body.from, to: body.to, replyTo: body.replyTo,
    subject: body.subject, text: body.text, html: body.html }), "utf8").digest("hex");
}

export async function pinIntakeNotificationEnvelope(pin: PinIntakeNotification | undefined, messageId: string, owner: string, body: IntakeNotificationEnvelope) {
  if (!pin) throw new Error("intake_notice_pin_unavailable");
  const payloadSha256 = intakeNotificationEnvelopeSha256(body);
  const result = await pin(messageId, owner, payloadSha256);
  if (result.error) throw new Error("intake_notice_pin_unavailable");
  const receipt = z.object({ messageId: z.uuid(), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(result.data);
  if (receipt.messageId !== messageId || receipt.payloadSha256 !== payloadSha256) throw new Error("intake_notice_pin_mismatch");
}

const messageSchema = z.object({
  id: z.uuid(), customer_id: z.uuid(), order_id: z.null(), payload_ref: z.null(),
  message_kind: z.literal("INTAKE_CLARIFICATION_REQUIRED"), recipient_ref: z.uuid(),
  provider_idempotency_key: z.string().regex(/^[A-Za-z0-9:_/-]{1,255}$/),
  first_submitted_at: z.iso.datetime({ offset: true }),
});
const contextSchema = z.object({
  messageId: z.uuid(), customerId: z.uuid(), questionId: z.uuid(), rootDraftId: z.uuid(),
  recipientEmail: z.email().max(320), providerIdempotencyKey: z.string().regex(/^[A-Za-z0-9:_/-]{1,255}$/),
  templateVersion: z.literal("intake-clarification-notice-v1"),
}).strict();

const paidContextSchema = z.discriminatedUnion("claimed", [
  z.object({ claimed: z.literal(false) }).strict(),
  z.object({ claimed: z.literal(true), messageId: z.uuid(), customerId: z.uuid(), orderId: z.uuid().nullable(), rootDraftId: z.uuid(),
    recipientEmail: z.email().max(320), providerIdempotencyKey: z.string().regex(/^[A-Za-z0-9:_/-]{1,255}$/),
    deliveryDueAt: z.iso.datetime({ offset: true }).nullable(), templateVersion: z.literal("claimed-payment-notice-v1") }).strict(),
]);

/** Only an explicit unclaimed receipt may use the unchanged historical email path. */
export function claimedPaymentNotificationContext(messageValue: unknown, contextValue: unknown, now = Date.now()) {
  const context = paidContextSchema.parse(contextValue);
  if (!context.claimed) return context;
  const message = messageSchema.extend({ order_id: z.uuid().nullable(), payload_ref: z.uuid().nullable(), message_kind: z.string().min(1) }).parse(messageValue);
  const firstSubmitted = Date.parse(message.first_submitted_at);
  if (firstSubmitted > now || now >= firstSubmitted + 24 * 60 * 60_000) throw new Error("claimed_notice_retry_window_expired");
  if (context.messageId !== message.id || context.customerId !== message.customer_id || context.orderId !== message.order_id
    || context.providerIdempotencyKey !== message.provider_idempotency_key) throw new Error("claimed_notice_context_mismatch");
  return context;
}

/** Only the leased SQL resolver may supply context; draft text is never a recipient source. */
export function intakeClarificationDelivery(messageValue: unknown, contextValue: unknown, origin: string, now = Date.now()) {
  const message = messageSchema.parse(messageValue), context = contextSchema.parse(contextValue);
  const firstSubmitted = Date.parse(message.first_submitted_at);
  if (firstSubmitted > now || now >= firstSubmitted + 24 * 60 * 60_000) throw new Error("intake_notice_retry_window_expired");
  if (context.messageId !== message.id || context.customerId !== message.customer_id
    || context.questionId !== message.recipient_ref || context.providerIdempotencyKey !== message.provider_idempotency_key) {
    throw new Error("intake_notice_context_mismatch");
  }
  const canonical = new URL(origin);
  if (canonical.origin !== origin || canonical.username || canonical.password) throw new Error("intake_notice_origin_invalid");
  return {
    recipient: context.recipientEmail,
    idempotencyKey: context.providerIdempotencyKey,
    rendered: renderChunk4Email({ kind: "INTAKE_CLARIFICATION_REQUIRED", actionUrl: `${origin}/my-applypack` }),
  };
}

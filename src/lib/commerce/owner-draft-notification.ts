import "server-only";
import { z } from "zod";
import { safeTransactionalRecipient } from "@/lib/email/safety";
import { intakeNotificationEnvelopeSha256, type IntakeNotificationEnvelope } from "./intake-notification";

export const OWNER_DRAFT_NOTICE_KIND = "OWNER_DRAFT_REVIEW_REQUIRED";
export const ownerNoticeReasons = ["VERSION_SUPERSEDED", "PHASE_COMPLETED", "OBLIGATION_INACTIVE", "NO_LONGER_READY"] as const;
const phase = z.enum(["SOURCE_READY", "REVIEW_READY"]);
const reason = z.enum(ownerNoticeReasons);
const uuid = z.uuid();
const email = z.email().max(254);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
type Result = { data: unknown; error: unknown };
export type PrepareOwnerDraftNotice = (messageId: string, leaseOwner: string, recipient: string) => Promise<Result>;
export type PinOwnerDraftNotice = (messageId: string, leaseOwner: string, recipient: string, payloadSha256: string) => Promise<Result>;
export type SuppressOwnerDraftNotice = (messageId: string, leaseOwner: string) => Promise<Result>;

/** This protected setting is the sole destination authority. No personal or customer fallback. */
export function configuredOwnerDraftRecipient(environment: Partial<NodeJS.ProcessEnv> = process.env): string | null {
  const parsed = email.safeParse(environment.APP_ADMIN_ALERT_EMAIL?.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}
export function ownerDraftNotificationReady(): boolean {
  const recipient = configuredOwnerDraftRecipient();
  if (!recipient) return false;
  try { return safeTransactionalRecipient(recipient) === recipient; } catch { return false; }
}
export function ownerDraftLeaseCurrent(value: unknown, now = Date.now()): boolean {
  const parsed = z.iso.datetime({ offset: true }).safeParse(value);
  return parsed.success && Date.parse(parsed.data) > now;
}

const messageSchema = z.object({ id: uuid, customer_id: uuid, order_id: z.null(), payload_ref: z.null(),
  message_kind: z.literal(OWNER_DRAFT_NOTICE_KIND), recipient_ref: uuid,
  provider_idempotency_key: z.string().min(1).max(255), first_submitted_at: z.iso.datetime({ offset: true }) });
const contextSchema = z.discriminatedUnion("disposition", [
  z.object({ disposition: z.literal("SEND"), messageId: uuid, customerId: uuid, jobId: uuid, draftVersionId: uuid,
    phase, recipientEmail: email, providerIdempotencyKey: z.string().min(1).max(255), templateVersion: z.literal("owner-draft-notice-v1") }).strict(),
  z.object({ disposition: z.literal("OBSOLETE"), messageId: uuid, reason }).strict(),
]);

export function ownerDraftNoticeContext(messageValue: unknown, contextValue: unknown, recipient: string, now = Date.now()) {
  const message = messageSchema.parse(messageValue), context = contextSchema.parse(contextValue);
  const submitted = Date.parse(message.first_submitted_at);
  if (submitted > now || now >= submitted + 24 * 60 * 60_000) throw new Error("owner_notice_retry_window_expired");
  if (context.messageId !== message.id) throw new Error("owner_notice_context_mismatch");
  if (context.disposition === "SEND") {
    const key = `owner-draft-ready:${context.jobId}:${context.draftVersionId}:${context.phase}:v1`;
    if (context.customerId !== message.customer_id || context.draftVersionId !== message.recipient_ref
      || context.recipientEmail !== recipient || context.providerIdempotencyKey !== key || message.provider_idempotency_key !== key) {
      throw new Error("owner_notice_context_mismatch");
    }
  }
  return context;
}

/** Historical event wording remains truthful if owner work advances during reconciliation. */
export function renderOwnerDraftNotice(noticePhase: z.infer<typeof phase>, origin: string) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) throw new Error("owner_notice_origin_invalid");
  const actionUrl = `${origin}/admin/document-drafts`;
  const event = noticePhase === "SOURCE_READY" ? "A document proposal reached owner review." : "A document file set reached owner review.";
  const guidance = "Sign in to see its current status and review any work that remains. Wording review, approval and sending documents are separate steps.";
  return { subject: "ApplyPack document review update", text: `${event}\n\n${guidance}\n\n${actionUrl}`,
    html: `<p>${event}</p><p>${guidance}</p><p><a href="${actionUrl}">Open private document review</a></p>` };
}

export async function pinOwnerDraftEnvelope(pin: PinOwnerDraftNotice | undefined, messageId: string, owner: string,
  recipient: string, envelope: IntakeNotificationEnvelope) {
  if (!pin) throw new Error("owner_notice_pin_unavailable");
  const payloadSha256 = intakeNotificationEnvelopeSha256(envelope);
  const result = await pin(messageId, owner, recipient, payloadSha256);
  if (result.error) throw new Error("owner_notice_pin_unavailable");
  const receipt = z.object({ messageId: uuid, payloadSha256: hash }).strict().parse(result.data);
  if (receipt.messageId !== messageId || receipt.payloadSha256 !== payloadSha256) throw new Error("owner_notice_pin_mismatch");
}
export function ownerDraftSuppressionReceipt(value: unknown, messageId: string) {
  const receipt = z.object({ disposition: z.literal("SUPPRESSED"), messageId: uuid, reason }).strict().parse(value);
  if (receipt.messageId !== messageId) throw new Error("owner_notice_suppression_mismatch");
  return receipt;
}

const noticeRow = z.object({ message_id: uuid, job_id: uuid, draft_version_id: uuid, phase,
  suppression_reason: reason.nullable(), suppressed_at: z.iso.datetime({ offset: true }).nullable() }).strict();
const outboxRow = z.object({ id: uuid, customer_id: uuid, message_kind: z.literal(OWNER_DRAFT_NOTICE_KIND), recipient_ref: uuid,
  state: z.enum(["QUEUED", "SENDING", "SENT", "RETRY", "DEAD_LETTER", "SUPPRESSED"]),
  provider_message_id: z.string().min(1).max(512).nullable(),
  reconciliation_state: z.enum(["NOT_REQUIRED", "REQUIRED", "IN_PROGRESS", "RECONCILED", "FAILED"]) }).strict();
export type OwnerDraftNoticeStatus = { status: "UNAVAILABLE" } | { status: "AVAILABLE"; versionId: string;
  notices: { phase: z.infer<typeof phase>; state: "QUEUED" | "SENDING" | "RETRY" | "PROVIDER_ACCEPTED" | "SUPPRESSED" | "NEEDS_RECONCILIATION"; reason: z.infer<typeof reason> | null }[] };

/** Only bounded, non-recipient fields enter the owner view. A malformed join is never an empty queue. */
export function ownerDraftNoticeStatus(noticesValue: unknown, messagesValue: unknown,
  expected: { jobId: string; versionId: string; customerId: string }): OwnerDraftNoticeStatus {
  const notices = z.array(noticeRow).max(2).parse(noticesValue), messages = z.array(outboxRow).max(2).parse(messagesValue);
  if (new Set(notices.map(item => item.phase)).size !== notices.length || new Set(notices.map(item => item.message_id)).size !== notices.length
    || new Set(messages.map(item => item.id)).size !== messages.length || messages.length !== notices.length) throw new Error("owner_notice_status_invalid");
  return { status: "AVAILABLE", versionId: expected.versionId, notices: notices.map(notice => {
    const message = messages.find(item => item.id === notice.message_id);
    if (!message || notice.job_id !== expected.jobId || notice.draft_version_id !== expected.versionId
      || message.customer_id !== expected.customerId || message.recipient_ref !== expected.versionId
      || (message.state === "SENT") !== Boolean(message.provider_message_id)
      || (message.state === "SENT" && message.reconciliation_state !== "RECONCILED")
      || (message.state === "SUPPRESSED" && message.reconciliation_state !== "NOT_REQUIRED")
      || (message.state === "SUPPRESSED") !== Boolean(notice.suppression_reason && notice.suppressed_at)
      || (message.state !== "SUPPRESSED" && (notice.suppression_reason !== null || notice.suppressed_at !== null))) throw new Error("owner_notice_status_invalid");
    const state: Extract<OwnerDraftNoticeStatus, { status: "AVAILABLE" }>["notices"][number]["state"] = message.state === "SENT" ? "PROVIDER_ACCEPTED" : message.state === "DEAD_LETTER" || message.reconciliation_state === "FAILED"
      ? "NEEDS_RECONCILIATION" : message.state;
    return { phase: notice.phase, state, reason: notice.suppression_reason };
  }).sort((a, b) => a.phase === b.phase ? 0 : a.phase === "SOURCE_READY" ? -1 : 1) };
}

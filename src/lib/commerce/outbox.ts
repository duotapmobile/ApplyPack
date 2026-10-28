import "server-only";

import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { safeTransactionalRecipient } from "@/lib/email/safety";
import { canonicalApplicationOrigin, hashCapabilitySecret, parsePostgresBytea, serializeOrderAccessCapability } from "./server";
import { decryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady } from "@/lib/security/sensitive-payload";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { renderChunk4Email, type Chunk4EmailInput, type Chunk4EmailKind } from "./email";
import { claimedPaymentNotificationContext, intakeClarificationDelivery, pinIntakeNotificationEnvelope,
  type PrepareIntakeNotification, type PinIntakeNotification, type PrepareClaimedPaymentNotification, type PinClaimedPaymentNotification } from "./intake-notification";
import { OWNER_DRAFT_NOTICE_KIND, configuredOwnerDraftRecipient, ownerDraftLeaseCurrent, ownerDraftNoticeContext, ownerDraftSuppressionReceipt,
  pinOwnerDraftEnvelope, renderOwnerDraftNotice, type PrepareOwnerDraftNotice, type PinOwnerDraftNotice, type SuppressOwnerDraftNotice } from "./owner-draft-notification";

type AdminClient = SupabaseClient<Database>;
type OutboxMessage = {
  id: string;
  customer_id: string | null;
  order_id: string | null;
  message_kind: string;
  recipient_ref: string;
  payload_ref: string | null;
  provider_idempotency_key: string;
  attempts: number;
  first_submitted_at: string | null;
};

export function outboxRetryAt(attempts: number, now = new Date()) {
  const delaySeconds = Math.min(6 * 60 * 60, 60 * (2 ** Math.max(0, attempts - 1)));
  return new Date(now.getTime() + delaySeconds * 1_000).toISOString();
}

export function outboxShouldDeadLetter(firstSubmittedAt: string | null, now = new Date()) {
  return Boolean(firstSubmittedAt && now.getTime() >= new Date(firstSubmittedAt).getTime() + 24 * 60 * 60_000);
}

function deliveryConfiguration() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromAddress = (process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_FROM || "").trim();
  const replyTo = (process.env.EMAIL_REPLY_TO || "").trim();
  const fromDomain = fromAddress.match(/<?([^<>\s]+@[^<>\s]+)>?$/)?.[1]?.split("@")[1]?.toLowerCase();
  if (!apiKey || !fromAddress || !replyTo || fromDomain !== "applypack.work") throw new Error("email_provider_not_ready");
  return { apiKey, from: fromAddress.includes("<") ? fromAddress : `ApplyPack <${fromAddress}>`, replyTo };
}

async function orderContext(admin: AdminClient, message: OutboxMessage) {
  if (message.order_id) {
    const { data: service, error } = await admin.from("ap_search_services")
      .select("id,legacy_order_id,original_snapshot_id,winning_payment_attempt_id,delivery_due_at")
      .eq("legacy_order_id", message.order_id).maybeSingle();
    if (error || !service?.original_snapshot_id) throw error || new Error("outbox_order_context_missing");
    const { data: snapshot, error: snapshotError } = await admin.from("ap_intake_snapshots")
      .select("access_email_normalized").eq("id", service.original_snapshot_id).maybeSingle();
    if (snapshotError || !snapshot?.access_email_normalized) throw snapshotError || new Error("outbox_recipient_missing");
    return { service, recipient: snapshot.access_email_normalized };
  }
  const { data: snapshot, error } = await admin.from("ap_intake_snapshots")
    .select("access_email_normalized").eq("id", message.recipient_ref).maybeSingle();
  if (error || !snapshot?.access_email_normalized) throw error || new Error("outbox_recipient_missing");
  return { service: null, recipient: snapshot.access_email_normalized };
}

async function accessAction(admin: AdminClient, message: OutboxMessage, origin: string, owner: string) {
  if (!message.payload_ref || !message.order_id) throw new Error("outbox_access_payload_missing");
  const [{ data: payload, error: payloadError }, { data: service, error: serviceError }] = await Promise.all([
    admin.from("ap_sensitive_payloads").select("draft_id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash").eq("id", message.payload_ref).maybeSingle(),
    admin.from("ap_search_services").select("winning_payment_attempt_id").eq("legacy_order_id", message.order_id).maybeSingle(),
  ]);
  if (payloadError || serviceError || !payload?.draft_id || payload.encryption_algorithm !== "AES-256-GCM" || !service?.winning_payment_attempt_id) throw payloadError || serviceError || new Error("outbox_access_context_missing");
  const { data: payment, error: paymentError } = await admin.from("ap_payment_attempts")
    .select("checkout_attempt_id").eq("id", service.winning_payment_attempt_id).maybeSingle();
  if (paymentError || !payment?.checkout_attempt_id) throw paymentError || new Error("outbox_access_checkout_missing");
  const configuration = sensitivePayloadConfiguration();
  if (!sensitivePayloadEncryptionReady(configuration)) throw new Error("kms_not_configured");
  const plaintext = await decryptSensitivePayload({
    envelope: {
      algorithm: payload.encryption_algorithm,
      ciphertext: parsePostgresBytea(payload.ciphertext),
      encryptedDataKey: parsePostgresBytea(payload.encrypted_data_key),
      nonce: parsePostgresBytea(payload.nonce),
      authenticationTag: parsePostgresBytea(payload.authentication_tag),
      contentSha256: payload.content_sha256,
      keyIdentity: payload.kms_key_identity,
      keyVersion: payload.kms_key_version,
      encryptionContextHash: payload.encryption_context_hash,
    },
    context: { draftId: payload.draft_id, checkoutAttemptId: payment.checkout_attempt_id, purpose: "CHUNK4_ORDER_ACCESS" },
    configuration,
    kms: remoteKmsAdapter(),
  });
  try {
    const decoded = JSON.parse(plaintext.toString("utf8")) as { schemaVersion?: string; emailAccessSecret?: string };
    if (decoded.schemaVersion !== "chunk4-order-access-v1" || !decoded.emailAccessSecret) throw new Error("outbox_access_payload_invalid");
    const secretHash = hashCapabilitySecret(decoded.emailAccessSecret);
    const aligned = await admin.rpc("ap_align_access_capability_to_outbox", {
      p_message_id: message.id,
      p_owner: owner,
      p_secret_hash: secretHash,
    });
    if (aligned.error || typeof aligned.data !== "string") throw aligned.error || new Error("outbox_access_capability_expired");
    const { data: capability, error } = await admin.from("ap_order_access_capabilities")
      .select("id,expires_at").eq("id", aligned.data).eq("order_id", message.order_id).eq("kind", "EMAIL_ACCESS")
      .eq("secret_hash", secretHash).eq("state", "ISSUED").gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !capability) throw error || new Error("outbox_access_capability_expired");
    const token = serializeOrderAccessCapability({ capabilityId: capability.id, secret: decoded.emailAccessSecret });
    const next = `/my-applypack?order=${encodeURIComponent(message.order_id)}`;
    return `${origin}/auth/order-access?access=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
  } finally {
    plaintext.fill(0);
  }
}

function templateKind(messageKind: string): Chunk4EmailKind {
  if (["CAPACITY_EXCEPTION_REFUND", "DUPLICATE_PAYMENT_REFUND", "STALE_PAYMENT_REFUND"].includes(messageKind)) return "CAPACITY_PAYMENT_EXCEPTION";
  if (messageKind.startsWith("PAYMENT_DISPUTE_")) return "PAYMENT_DISPUTE";
  if ([
    "PAYMENT_VERIFIED_SEARCH_STARTED", "ADJUSTMENT_REQUIRED", "ADJUSTMENT_ACCEPTED",
    "REFUND_INITIATED", "REFUND_COMPLETED", "REFUND_PROBLEM", "SEARCH_EXACT_TEN_DELIVERED",
    "SECURE_ACCESS_RESEND", "MATERIALS_PAYMENT_VERIFIED", "MATERIAL_SUBSTITUTION_ACCEPTED",
    "MATERIAL_FACT_REVISION_ACCEPTED", "MATERIALS_DELIVERED", "REFERENCE_REGENERATION_STARTED",
    "REFERENCE_REGENERATION_DELIVERED", "REFERENCE_REGENERATION_FAILED",
  ].includes(messageKind)) return messageKind as Chunk4EmailKind;
  if (messageKind === "REFUND_PROCESSING") return "REFUND_INITIATED";
  throw new Error("unsupported_chunk4_outbox_kind");
}

async function messageDetails(admin: AdminClient, message: OutboxMessage, kind: Chunk4EmailKind, dueAt: string | null) {
  const details: Chunk4EmailInput = { kind, actionUrl: "", orderId: message.order_id, deadline: dueAt };
  if (["ADJUSTMENT_REQUIRED", "ADJUSTMENT_ACCEPTED"].includes(kind)) {
    const { data, error } = await admin.from("ap_criteria_amendments")
      .select("current_valid_count,criteria_diff").eq("id", message.recipient_ref).maybeSingle();
    if (error || !data) throw error || new Error("outbox_adjustment_missing");
    details.currentValidCount = data.current_valid_count;
    details.criteriaDiff = data.criteria_diff;
  }
  if (["REFUND_INITIATED", "REFUND_COMPLETED", "REFUND_PROBLEM", "CAPACITY_PAYMENT_EXCEPTION"].includes(kind)) {
    const query = admin.from("ap_refund_operations").select("amount_cents").limit(1);
    const result = message.message_kind === "REFUND_INITIATED"
      ? await query.eq("payment_attempt_id", message.recipient_ref).order("requested_at", { ascending: false }).maybeSingle()
      : await query.eq("id", message.recipient_ref).maybeSingle();
    if (!result.error && result.data) details.refundAmountCents = result.data.amount_cents;
  }
  if (kind === "PAYMENT_DISPUTE") details.disputeState = message.message_kind.replace("PAYMENT_DISPUTE_", "");
  if (kind === "MATERIALS_PAYMENT_VERIFIED") {
    const { data, error } = await admin.from("ap_material_lines")
      .select("materials_due_at").eq("purchase_id", message.recipient_ref).order("materials_due_at");
    if (error || !data?.length) throw error || new Error("outbox_material_purchase_missing");
    details.lineCount = data.length;
    details.deadline = data[0].materials_due_at;
  }
  if (["MATERIAL_SUBSTITUTION_ACCEPTED", "MATERIAL_FACT_REVISION_ACCEPTED"].includes(kind)) {
    const { data, error } = await admin.from("ap_material_lines")
      .select("materials_due_at").eq("id", message.recipient_ref).maybeSingle();
    if (error || !data) throw error || new Error("outbox_material_line_missing");
    details.deadline = data.materials_due_at;
  }
  if (["REFERENCE_REGENERATION_STARTED", "REFERENCE_REGENERATION_FAILED"].includes(kind)) {
    const { data, error } = await admin.from("ap_reference_regenerations")
      .select("due_at").eq("id", message.recipient_ref).maybeSingle();
    if (error || !data) throw error || new Error("outbox_reference_regeneration_missing");
    details.deadline = data.due_at;
  }
  return details;
}

type NotificationAdapters = { prepareIntakeNotification?: PrepareIntakeNotification; pinIntakeNotification?: PinIntakeNotification;
  prepareClaimedPaymentNotification?: PrepareClaimedPaymentNotification; pinClaimedPaymentNotification?: PinClaimedPaymentNotification;
  prepareOwnerDraftNotice?: PrepareOwnerDraftNotice; pinOwnerDraftNotice?: PinOwnerDraftNotice; suppressOwnerDraftNotice?: SuppressOwnerDraftNotice };

async function sendOwnerDraftNotice(admin: AdminClient, message: OutboxMessage, owner: string, adapters: NotificationAdapters): Promise<"SENT" | "SUPPRESSED"> {
  const recipient = configuredOwnerDraftRecipient();
  if (!recipient || !adapters.prepareOwnerDraftNotice) throw new Error("owner_notice_configuration_unavailable");
  safeTransactionalRecipient(recipient);
  const prepare = async () => {
    if (configuredOwnerDraftRecipient() !== recipient) throw new Error("owner_notice_configuration_changed");
    const result = await adapters.prepareOwnerDraftNotice!(message.id, owner, recipient);
    if (result.error) throw new Error("owner_notice_context_unavailable");
    return ownerDraftNoticeContext(message, result.data, recipient);
  };
  const suppress = async (context: Extract<ReturnType<typeof ownerDraftNoticeContext>, { disposition: "OBSOLETE" }>) => {
    if (!adapters.suppressOwnerDraftNotice) throw new Error("owner_notice_suppression_unavailable");
    const result = await adapters.suppressOwnerDraftNotice(message.id, owner);
    if (result.error) throw new Error("owner_notice_suppression_unavailable");
    ownerDraftSuppressionReceipt(result.data, context.messageId);
    return "SUPPRESSED" as const;
  };
  const context = await prepare();
  if (context.disposition === "OBSOLETE") return suppress(context);
  const origin = canonicalApplicationOrigin(), delivery = deliveryConfiguration();
  const rendered = renderOwnerDraftNotice(context.phase, origin);
  const renewed = await admin.rpc("ap_renew_outbox_lease", { p_message_id: message.id, p_owner: owner });
  if (renewed.error || !ownerDraftLeaseCurrent(renewed.data)) throw new Error("owner_notice_lease_unavailable");
  const current = await prepare();
  if (current.disposition === "OBSOLETE") return suppress(current);
  if (JSON.stringify(current) !== JSON.stringify(context) || canonicalApplicationOrigin() !== origin
    || JSON.stringify(deliveryConfiguration()) !== JSON.stringify(delivery)) throw new Error("owner_notice_dispatch_changed");
  const envelope = { from: delivery.from, to: safeTransactionalRecipient(recipient), replyTo: delivery.replyTo, ...rendered };
  await pinOwnerDraftEnvelope(adapters.pinOwnerDraftNotice, message.id, owner, recipient, envelope);
  if (configuredOwnerDraftRecipient() !== recipient || canonicalApplicationOrigin() !== origin
    || JSON.stringify(deliveryConfiguration()) !== JSON.stringify(delivery)) throw new Error("owner_notice_dispatch_changed");
  safeTransactionalRecipient(recipient);
  ownerDraftNoticeContext(message, current, recipient);
  const result = await new Resend(delivery.apiKey).emails.send(envelope, { idempotencyKey: context.providerIdempotencyKey });
  if (result.error || typeof result.data?.id !== "string" || !result.data.id.trim()) throw new Error("owner_notice_provider_unconfirmed");
  const completed = await admin.rpc("ap_complete_outbox_message", { p_message_id: message.id, p_owner: owner, p_provider_message_id: result.data.id });
  if (completed.error || completed.data !== true) throw new Error("owner_notice_completion_unconfirmed");
  return "SENT";
}

async function sendMessage(admin: AdminClient, message: OutboxMessage, owner: string, adapters: NotificationAdapters) {
  const renewed = await admin.rpc("ap_renew_outbox_lease", { p_message_id: message.id, p_owner: owner });
  if (renewed.error) throw renewed.error;
  // Owner readiness never falls through to customer/contact/capability resolution.
  if (message.message_kind === OWNER_DRAFT_NOTICE_KIND) {
    if (!ownerDraftLeaseCurrent(renewed.data)) throw new Error("owner_notice_lease_unavailable");
    return sendOwnerDraftNotice(admin, message, owner, adapters);
  }
  const origin = canonicalApplicationOrigin();
  const delivery = deliveryConfiguration();
  let recipient: string, rendered: ReturnType<typeof renderChunk4Email>;
  let claimedContext: ReturnType<typeof claimedPaymentNotificationContext> | null = null;
  const prepareNotice = async () => {
    if (!adapters.prepareIntakeNotification) throw new Error("intake_notice_resolver_unavailable");
    const prepared = await adapters.prepareIntakeNotification(message.id, owner);
    if (prepared.error) throw new Error("intake_notice_context_unavailable");
    return intakeClarificationDelivery(message, prepared.data, origin);
  };
  const preparePaidNotice = async () => {
    if (!adapters.prepareClaimedPaymentNotification) throw new Error("claimed_notice_resolver_unavailable");
    const prepared = await adapters.prepareClaimedPaymentNotification(message.id, owner);
    if (prepared.error) throw new Error("claimed_notice_context_unavailable");
    return claimedPaymentNotificationContext(message, prepared.data);
  };
  if (message.message_kind === "INTAKE_CLARIFICATION_REQUIRED") {
    const notice = await prepareNotice();
    recipient = notice.recipient; rendered = notice.rendered;
  } else {
    const kind = templateKind(message.message_kind);
    claimedContext = await preparePaidNotice();
    if (claimedContext.claimed) {
      const details = await messageDetails(admin, message, kind, claimedContext.deliveryDueAt);
      recipient = claimedContext.recipientEmail;
      // Verified account owners use normal sign-in; no emailed bearer capability
      // may redirect access after their original contact email changes hands.
      rendered = renderChunk4Email({ ...details, accountSignIn: true, actionUrl: `${origin}/my-applypack${message.order_id ? `?order=${encodeURIComponent(message.order_id)}` : ""}` });
    } else {
      const context = await orderContext(admin, message);
      const actionUrl = ["PAYMENT_VERIFIED_SEARCH_STARTED", "SECURE_ACCESS_RESEND"].includes(kind)
        ? await accessAction(admin, message, origin, owner)
        : `${origin}/my-applypack${message.order_id ? `?order=${encodeURIComponent(message.order_id)}` : ""}`;
      const details = await messageDetails(admin, message, kind, context.service?.delivery_due_at || null);
      recipient = context.recipient; rendered = renderChunk4Email({ ...details, actionUrl });
    }
  }
  const submitLease = await admin.rpc("ap_renew_outbox_lease", { p_message_id: message.id, p_owner: owner });
  if (submitLease.error) throw submitLease.error;
  if (message.message_kind === "INTAKE_CLARIFICATION_REQUIRED") {
    const current = await prepareNotice();
    if (current.recipient !== recipient || JSON.stringify(current.rendered) !== JSON.stringify(rendered)) throw new Error("intake_notice_dispatch_changed");
  } else {
    const current = await preparePaidNotice();
    if (JSON.stringify(current) !== JSON.stringify(claimedContext)) throw new Error("claimed_notice_dispatch_changed");
  }
  const envelope = {
    from: delivery.from,
    to: safeTransactionalRecipient(recipient),
    replyTo: delivery.replyTo,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  };
  if (message.message_kind === "INTAKE_CLARIFICATION_REQUIRED") {
    await pinIntakeNotificationEnvelope(adapters.pinIntakeNotification, message.id, owner, envelope);
  } else if (claimedContext?.claimed) {
    await pinIntakeNotificationEnvelope(adapters.pinClaimedPaymentNotification, message.id, owner, envelope);
  }
  const result = await new Resend(delivery.apiKey).emails.send(envelope, { idempotencyKey: message.provider_idempotency_key });
  if (result.error || !result.data?.id) throw new Error("provider_send_failed");
  const completed = await admin.rpc("ap_complete_outbox_message", {
    p_message_id: message.id,
    p_owner: owner,
    p_provider_message_id: result.data.id,
  });
  if (completed.error) throw completed.error;
  return "SENT" as const;
}

export async function processChunk4Outbox(admin: AdminClient, owner: string, limit = 10,
  options: NotificationAdapters = {}) {
  const adapters: NotificationAdapters = {
    prepareIntakeNotification: async (messageId, leaseOwner) => admin.rpc("ap_prepare_intake_clarification_notification", {
      p_message_id: messageId, p_lease_owner: leaseOwner,
    }),
    pinIntakeNotification: async (messageId, leaseOwner, payloadSha256) => admin.rpc("ap_pin_intake_clarification_delivery", {
      p_message_id: messageId, p_lease_owner: leaseOwner, p_payload_sha256: payloadSha256,
    }),
    prepareClaimedPaymentNotification: async (messageId, leaseOwner) => admin.rpc("ap_prepare_claimed_payment_notification", {
      p_message_id: messageId, p_lease_owner: leaseOwner,
    }),
    pinClaimedPaymentNotification: async (messageId, leaseOwner, payloadSha256) => admin.rpc("ap_pin_claimed_payment_delivery", {
      p_message_id: messageId, p_lease_owner: leaseOwner, p_payload_sha256: payloadSha256,
    }),
    prepareOwnerDraftNotice: async (messageId, leaseOwner, recipient) => admin.rpc("ap_prepare_owner_draft_notification", {
      p_message_id: messageId, p_lease_owner: leaseOwner, p_recipient_email: recipient,
    }),
    pinOwnerDraftNotice: async (messageId, leaseOwner, recipient, payloadSha256) => admin.rpc("ap_pin_owner_draft_delivery", {
      p_message_id: messageId, p_lease_owner: leaseOwner, p_recipient_email: recipient, p_payload_sha256: payloadSha256,
    }),
    suppressOwnerDraftNotice: async (messageId, leaseOwner) => admin.rpc("ap_suppress_owner_draft_notification", {
      p_message_id: messageId, p_lease_owner: leaseOwner,
    }),
    ...options,
  };
  const claimed = await admin.rpc("ap_claim_outbox_messages", { p_owner: owner, p_limit: Math.max(1, Math.min(25, limit)) });
  if (claimed.error) {
    if (claimed.error.message.includes("email_provider_guarantee_unapproved")) {
      return { status: "blocked" as const, reason: "EMAIL_PROVIDER_GUARANTEE_UNAPPROVED", attempted: 0, sent: 0, suppressed: 0 };
    }
    throw claimed.error;
  }
  const messages = (Array.isArray(claimed.data) ? claimed.data : []) as OutboxMessage[];
  let sent = 0, suppressed = 0;
  for (const message of messages) {
    try {
      const outcome = await sendMessage(admin, message, owner, adapters);
      if (outcome === "SENT") sent += 1;
      else if (outcome === "SUPPRESSED") suppressed += 1;
    } catch {
      const deadLetter = outboxShouldDeadLetter(message.first_submitted_at);
      const failed = await admin.rpc("ap_fail_outbox_message", {
        p_message_id: message.id,
        p_owner: owner,
        p_error_code: message.message_kind === OWNER_DRAFT_NOTICE_KIND ? "OWNER_NOTICE_DELIVERY_UNCONFIRMED" : "OUTBOX_SEND_FAILED",
        p_retry_at: outboxRetryAt(message.attempts),
        p_dead_letter: deadLetter,
      });
      if (failed.error) throw failed.error;
    }
  }
  return { status: "enabled" as const, attempted: messages.length, sent, suppressed };
}

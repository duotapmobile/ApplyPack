import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createCapabilitySecret, hashCapabilitySecret, postgresBytea } from "@/lib/commerce/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { encryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady } from "@/lib/security/sensitive-payload";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ email: z.email().max(254) }).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ ok: true }, { status: 202 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: true }, { status: 202 });
  const email = parsed.data.email.trim().toLowerCase();
  const rate = await consumeRateLimit({ request, scope: "chunk4_access_resend", identity: email, limit: 3, windowSeconds: 60 * 60 });
  if (!rate.configured || !rate.allowed) return NextResponse.json({ ok: true }, { status: 202 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ ok: true }, { status: 202 });
  try {
    const orderLookup = await admin.rpc("ap_find_latest_access_order", { p_email: email });
    if (orderLookup.error || typeof orderLookup.data !== "string") throw orderLookup.error || new Error("order_not_found");
    const { data: service, error: serviceError } = await admin.from("ap_search_services")
      .select("winning_payment_attempt_id").eq("legacy_order_id", orderLookup.data).maybeSingle();
    if (serviceError || !service) throw serviceError || new Error("service_not_found");
    const { data: payment, error: paymentError } = await admin.from("ap_payment_attempts")
      .select("checkout_attempt_id,draft_id").eq("id", service.winning_payment_attempt_id).maybeSingle();
    if (paymentError || !payment) throw paymentError || new Error("payment_not_found");
    const configuration = sensitivePayloadConfiguration();
    if (!sensitivePayloadEncryptionReady(configuration)) throw new Error("kms_not_configured");
    const secret = createCapabilitySecret();
    const capabilityId = randomUUID();
    const payloadId = randomUUID();
    const plaintext = Buffer.from(JSON.stringify({ schemaVersion: "chunk4-order-access-v1", emailAccessSecret: secret }), "utf8");
    try {
      const envelope = await encryptSensitivePayload({
        plaintext,
        context: { draftId: payment.draft_id, checkoutAttemptId: payment.checkout_attempt_id, purpose: "CHUNK4_ORDER_ACCESS" },
        configuration,
        kms: remoteKmsAdapter(),
      });
      const inserted = await admin.from("ap_sensitive_payloads").insert({
        id: payloadId,
        draft_id: payment.draft_id,
        ciphertext: postgresBytea(envelope.ciphertext),
        encryption_algorithm: envelope.algorithm,
        encrypted_data_key: postgresBytea(envelope.encryptedDataKey),
        nonce: postgresBytea(envelope.nonce),
        authentication_tag: postgresBytea(envelope.authenticationTag),
        content_sha256: envelope.contentSha256,
        kms_key_identity: envelope.keyIdentity,
        kms_key_version: envelope.keyVersion,
        encryption_context_hash: envelope.encryptionContextHash,
      });
      if (inserted.error) throw inserted.error;
      const issued = await admin.rpc("ap_issue_order_access_capability", {
        p_order_id: orderLookup.data,
        p_secret_hash: hashCapabilitySecret(secret),
        p_capability_id: capabilityId,
        p_payload_id: payloadId,
        p_outbox_id: randomUUID(),
      });
      if (issued.error) throw issued.error;
    } finally {
      plaintext.fill(0);
    }
  } catch {
    // Deliberately indistinguishable for unknown email, throttling, KMS, and provider states.
  }
  return NextResponse.json({ ok: true }, { status: 202, headers: { "cache-control": "no-store" } });
}

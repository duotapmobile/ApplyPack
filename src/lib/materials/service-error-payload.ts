import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { parsePostgresBytea, postgresBytea } from "@/lib/commerce/server";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { decryptSensitivePayload, encryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady,
  type KmsEnvelopeAdapter, type SensitivePayloadConfiguration } from "@/lib/security/sensitive-payload";
import { ServiceErrorContractError, serviceErrorCanonicalJson, serviceErrorSha256,
  SERVICE_ERROR_REPORT_PURPOSE, SERVICE_ERROR_REVIEW_PURPOSE } from "./service-error-contract";

const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.uuid();
const inputSchema = z.object({ customerId: uuid, materialLineId: uuid, requestId: uuid, payloadId: uuid,
  purpose: z.enum([SERVICE_ERROR_REPORT_PURPOSE, SERVICE_ERROR_REVIEW_PURPOSE]), sha256: hash }).strict();
export type ServiceErrorPayloadInput = z.infer<typeof inputSchema>;
const receiptSchema = z.object({ id: uuid, customer_id: uuid, content_sha256: hash,
  retention_state: z.literal("ACTIVE"), encryption_context_hash: hash }).strict();
const receiptColumns = "id,customer_id,content_sha256,retention_state,encryption_context_hash";
type Options = { signal: AbortSignal; configuration?: SensitivePayloadConfiguration; kms?: KmsEnvelopeAdapter };
type Admin = SupabaseClient<Database>;
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceErrorContractError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value); ensure(result.success, code); return result.data;
}
function context(input: ServiceErrorPayloadInput) {
  return { customerId: input.customerId, materialLineId: input.materialLineId, requestId: input.requestId,
    payloadId: input.payloadId, purpose: input.purpose };
}
function expectedContext(input: ServiceErrorPayloadInput, configuration: SensitivePayloadConfiguration) {
  ensure(configuration.contextVersion, "ENCRYPTION_UNAVAILABLE");
  const entries = Object.entries(context(input)).map(([key, value]) => [key.normalize("NFC"), value.normalize("NFC")])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return serviceErrorSha256(Buffer.from(JSON.stringify({ contextVersion: configuration.contextVersion, entries }), "utf8"));
}

export async function boundedServiceErrorIo<T>(external: AbortSignal, operation: (signal: AbortSignal) => Promise<T>, timeout = 45_000): Promise<T> {
  ensure(!external.aborted, "ABORTED");
  const controller = new AbortController(), abort = () => controller.abort(); external.addEventListener("abort", abort, { once: true });
  if (external.aborted) controller.abort();
  let rejectInterrupted: () => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = () => reject(new ServiceErrorContractError("ABORTED"));
    controller.signal.addEventListener("abort", rejectInterrupted, { once: true }); if (controller.signal.aborted) rejectInterrupted(); });
  const timer = setTimeout(abort, timeout);
  try { const result = await Promise.race([operation(controller.signal), interrupted]); ensure(!controller.signal.aborted, "ABORTED"); return result; }
  finally { clearTimeout(timer); external.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", rejectInterrupted); controller.abort(); }
}

/** Internal authorized caller supplies the exact IDs. No delete is attempted on
 * uncertain writes. A replay reads the immutable receipt before invoking KMS. */
export async function storeServiceErrorPayload(admin: Admin, raw: ServiceErrorPayloadInput, bytes: Uint8Array, options: Options) {
  const input = parse(inputSchema, raw, "PAYLOAD_INPUT_INVALID"), plaintext = Buffer.from(bytes);
  const configuration = structuredClone(options.configuration ?? sensitivePayloadConfiguration()), kms = options.kms ?? remoteKmsAdapter();
  try {
    return await boundedServiceErrorIo(options.signal, async (signal) => {
      ensure(sensitivePayloadEncryptionReady(configuration), "ENCRYPTION_UNAVAILABLE");
      ensure(plaintext.length > 0 && plaintext.length <= 100_000 && serviceErrorSha256(plaintext) === input.sha256, "PAYLOAD_DIGEST_INVALID");
      const expectedHash = expectedContext(input, configuration);
      const inspect = async () => {
        const result = await admin.from("ap_sensitive_payloads").select(receiptColumns).eq("id", input.payloadId).abortSignal(signal).maybeSingle();
        ensure(!signal.aborted, "PERSIST_RESULT_UNKNOWN"); ensure(!result.error, "PERSIST_RESULT_UNKNOWN");
        if (result.data === null) return null;
        const receipt = parse(receiptSchema, result.data, "PERSIST_IDENTITY_MISMATCH");
        ensure(receipt.id === input.payloadId && receipt.customer_id === input.customerId && receipt.content_sha256 === input.sha256
          && receipt.encryption_context_hash === expectedHash, "PERSIST_IDENTITY_MISMATCH");
        return { payloadId: receipt.id, sha256: receipt.content_sha256 };
      };
      const existing = await inspect(); if (existing) return existing;
      const envelope = await encryptSensitivePayload({ plaintext, context: context(input), configuration, kms });
      ensure(!signal.aborted, "ABORTED"); ensure(envelope.contentSha256 === input.sha256 && envelope.encryptionContextHash === expectedHash, "ENCRYPTION_DIGEST_INVALID");
      try {
        await admin.from("ap_sensitive_payloads").insert({ id: input.payloadId, customer_id: input.customerId,
          ciphertext: postgresBytea(envelope.ciphertext), encryption_algorithm: envelope.algorithm, encrypted_data_key: postgresBytea(envelope.encryptedDataKey),
          nonce: postgresBytea(envelope.nonce), authentication_tag: postgresBytea(envelope.authenticationTag), content_sha256: envelope.contentSha256,
          kms_key_identity: envelope.keyIdentity, kms_key_version: envelope.keyVersion, encryption_context_hash: envelope.encryptionContextHash }).abortSignal(signal);
      } catch { /* The write may have committed. Exact readback alone establishes success. */ }
      ensure(!signal.aborted, "PERSIST_RESULT_UNKNOWN"); const saved = await inspect(); ensure(saved, "PERSIST_RESULT_UNKNOWN"); return saved;
    }, 20_000);
  } finally { plaintext.fill(0); }
}

/** Caller owns successful plaintext. The read rechecks ACTIVE identity after
 * KMS returns, and clears late/private output on cancellation or any mismatch. */
export async function readServiceErrorPayload(admin: Admin, raw: ServiceErrorPayloadInput, options: Options): Promise<Buffer> {
  const input = parse(inputSchema, raw, "PAYLOAD_INPUT_INVALID");
  const configuration = structuredClone(options.configuration ?? sensitivePayloadConfiguration()), kms = options.kms ?? remoteKmsAdapter();
  return boundedServiceErrorIo(options.signal, async (signal) => {
    let plaintext: Buffer | undefined, transferred = false;
    try {
      ensure(sensitivePayloadEncryptionReady(configuration), "ENCRYPTION_UNAVAILABLE");
      const bytea = (max: number) => z.string().regex(/^\\x(?:[a-fA-F0-9]{2})+$/).max(2 + max * 2);
      const rowSchema = receiptSchema.extend({ encryption_algorithm: z.literal("AES-256-GCM"), ciphertext: bytea(100_000), encrypted_data_key: bytea(16_384),
        nonce: bytea(12), authentication_tag: bytea(16), kms_key_identity: z.string().min(1).max(2048), kms_key_version: z.string().min(1).max(100) }).strict();
      const result = await admin.from("ap_sensitive_payloads").select(receiptColumns + ",encryption_algorithm,ciphertext,encrypted_data_key,nonce,authentication_tag,kms_key_identity,kms_key_version")
        .eq("id", input.payloadId).abortSignal(signal).single();
      ensure(!signal.aborted, "ABORTED"); ensure(!result.error, "PAYLOAD_UNAVAILABLE");
      const row = parse(rowSchema, result.data, "PAYLOAD_UNAVAILABLE");
      ensure(row.id === input.payloadId && row.customer_id === input.customerId && row.content_sha256 === input.sha256
        && row.encryption_context_hash === expectedContext(input, configuration), "PAYLOAD_IDENTITY_MISMATCH");
      plaintext = await decryptSensitivePayload({ configuration, kms, context: context(input), envelope: {
        algorithm: row.encryption_algorithm, ciphertext: parsePostgresBytea(row.ciphertext), encryptedDataKey: parsePostgresBytea(row.encrypted_data_key), nonce: parsePostgresBytea(row.nonce),
        authenticationTag: parsePostgresBytea(row.authentication_tag), contentSha256: row.content_sha256, keyIdentity: row.kms_key_identity,
        keyVersion: row.kms_key_version, encryptionContextHash: row.encryption_context_hash } });
      ensure(!signal.aborted, "ABORTED"); ensure(plaintext.length <= 100_000 && serviceErrorSha256(plaintext) === input.sha256, "PAYLOAD_DIGEST_INVALID");
      const reread = await admin.from("ap_sensitive_payloads").select(receiptColumns).eq("id", input.payloadId).abortSignal(signal).single();
      ensure(!signal.aborted, "ABORTED"); ensure(!reread.error, "PAYLOAD_UNAVAILABLE");
      ensure(serviceErrorCanonicalJson(parse(receiptSchema, reread.data, "PAYLOAD_UNAVAILABLE"))
        === serviceErrorCanonicalJson({ id: row.id, customer_id: row.customer_id, content_sha256: row.content_sha256,
          retention_state: row.retention_state, encryption_context_hash: row.encryption_context_hash }), "PAYLOAD_IDENTITY_MISMATCH");
      transferred = true; return plaintext;
    } finally { if (!transferred) plaintext?.fill(0); }
  }, 20_000);
}

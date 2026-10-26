import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { parsePostgresBytea, postgresBytea } from "@/lib/commerce/server";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { decryptSensitivePayload, encryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady,
  type KmsEnvelopeAdapter, type SensitivePayloadConfiguration } from "@/lib/security/sensitive-payload";
import { boundedServiceErrorIo } from "./service-error-payload";
import { serviceErrorCanonicalJson, serviceErrorSha256 } from "./service-error-contract";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema = z.object({ customerId: uuid, caseId: uuid, repairVersionId: uuid, payloadId: uuid,
  purpose: z.enum(["SERVICE_REPAIR_SOURCE", "SERVICE_REPAIR_CLAIM_REVIEW"]), sha256: hash }).strict();
export type ServiceRepairPayloadIdentity = z.infer<typeof inputSchema>;
type Admin = SupabaseClient<Database>;
type Options = { signal: AbortSignal; configuration?: SensitivePayloadConfiguration; kms?: KmsEnvelopeAdapter };
const columns = "id,customer_id,content_sha256,retention_state,encryption_context_hash";
const identitySchema = z.object({ id: uuid, customer_id: uuid, content_sha256: hash, retention_state: z.literal("ACTIVE"), encryption_context_hash: hash }).strict();
const limit = (input: ServiceRepairPayloadIdentity) => input.purpose === "SERVICE_REPAIR_SOURCE" ? 6_000_000 : 1_000_000;
export class ServiceRepairPayloadError extends Error { constructor(readonly code: string) { super(`SERVICE_REPAIR_PAYLOAD_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceRepairPayloadError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown, code: string): T { const parsed = schema.safeParse(raw); ensure(parsed.success, code); return parsed.data; }
export function serviceRepairPayloadContext(input: ServiceRepairPayloadIdentity) {
  return { customerId: input.customerId, caseId: input.caseId, repairVersionId: input.repairVersionId, payloadId: input.payloadId, purpose: input.purpose };
}
function contextHash(input: ServiceRepairPayloadIdentity, configuration: SensitivePayloadConfiguration) {
  ensure(configuration.contextVersion, "ENCRYPTION_UNAVAILABLE");
  const entries = Object.entries(serviceRepairPayloadContext(input)).map(([key, value]) => [key.normalize("NFC"), value.normalize("NFC")])
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return serviceErrorSha256(Buffer.from(JSON.stringify({ contextVersion: configuration.contextVersion, entries })));
}

/** Authorized server callers supply IDs from an immutable099 version. Success
 * returns caller-owned plaintext; every failed/late result is cleared. */
export async function readServiceRepairPayload(admin: Admin, raw: ServiceRepairPayloadIdentity, options: Options): Promise<Buffer> {
  const input = parse(inputSchema, raw, "INPUT_INVALID");
  const configuration = structuredClone(options.configuration ?? sensitivePayloadConfiguration()), kms = options.kms ?? remoteKmsAdapter();
  return boundedServiceErrorIo(options.signal, async (signal) => {
    let plaintext: Buffer | undefined, transferred = false;
    try {
      ensure(!signal.aborted && sensitivePayloadEncryptionReady(configuration), "ENCRYPTION_UNAVAILABLE");
      const bytea = (max: number) => z.string().regex(/^\\x(?:[a-fA-F0-9]{2})+$/).max(2 + max * 2);
      const rowSchema = identitySchema.extend({ encryption_algorithm: z.literal("AES-256-GCM"), ciphertext: bytea(limit(input)), encrypted_data_key: bytea(16_384),
        nonce: bytea(12), authentication_tag: bytea(16), kms_key_identity: z.string().min(1).max(2048), kms_key_version: z.string().min(1).max(100) }).strict();
      const response = await admin.from("ap_sensitive_payloads").select(columns + ",encryption_algorithm,ciphertext,encrypted_data_key,nonce,authentication_tag,kms_key_identity,kms_key_version")
        .eq("id", input.payloadId).abortSignal(signal).single();
      ensure(!signal.aborted && !response.error, "UNAVAILABLE"); const row = parse(rowSchema, response.data, "UNAVAILABLE");
      ensure(row.id === input.payloadId && row.customer_id === input.customerId && row.content_sha256 === input.sha256
        && row.encryption_context_hash === contextHash(input, configuration), "IDENTITY_MISMATCH");
      plaintext = await decryptSensitivePayload({ configuration, kms, context: serviceRepairPayloadContext(input), envelope: {
        algorithm: row.encryption_algorithm, ciphertext: parsePostgresBytea(row.ciphertext), encryptedDataKey: parsePostgresBytea(row.encrypted_data_key),
        nonce: parsePostgresBytea(row.nonce), authenticationTag: parsePostgresBytea(row.authentication_tag), contentSha256: row.content_sha256,
        keyIdentity: row.kms_key_identity, keyVersion: row.kms_key_version, encryptionContextHash: row.encryption_context_hash } });
      ensure(!signal.aborted && plaintext.length > 0 && plaintext.length <= limit(input) && serviceErrorSha256(plaintext) === input.sha256, "DIGEST_INVALID");
      const after = await admin.from("ap_sensitive_payloads").select(columns).eq("id", input.payloadId).abortSignal(signal).single();
      ensure(!signal.aborted && !after.error, "UNAVAILABLE");
      ensure(serviceErrorCanonicalJson(parse(identitySchema, after.data, "UNAVAILABLE")) === serviceErrorCanonicalJson({ id: row.id,
        customer_id: row.customer_id, content_sha256: row.content_sha256, retention_state: row.retention_state, encryption_context_hash: row.encryption_context_hash }), "IDENTITY_MISMATCH");
      transferred = true; return plaintext;
    } catch (error) { throw error instanceof ServiceRepairPayloadError ? error : new ServiceRepairPayloadError("UNAVAILABLE"); }
    finally { if (!transferred) plaintext?.fill(0); }
  }, 20_000);
}

/** Local implementation for the later explicit authoring/review action. No
 * mutation occurs until invoked. Exact readback resolves lost writes; no delete
 * or blind retry is attempted. Original draft purposes/contexts stay separate. */
export async function storeServiceRepairPayload(admin: Admin, raw: ServiceRepairPayloadIdentity, bytes: Uint8Array, options: Options) {
  const input = parse(inputSchema, raw, "INPUT_INVALID");
  ensure((Buffer.isBuffer(bytes) || bytes instanceof Uint8Array) && bytes.length > 0 && bytes.length <= limit(input), "DIGEST_INVALID");
  const plaintext = Buffer.from(bytes);
  const configuration = structuredClone(options.configuration ?? sensitivePayloadConfiguration()), kms = options.kms ?? remoteKmsAdapter();
  try {
    return await boundedServiceErrorIo(options.signal, async (signal) => {
      try {
        ensure(!signal.aborted && sensitivePayloadEncryptionReady(configuration), "ENCRYPTION_UNAVAILABLE");
        ensure(plaintext.length > 0 && plaintext.length <= limit(input) && serviceErrorSha256(plaintext) === input.sha256, "DIGEST_INVALID");
        const expected = contextHash(input, configuration);
        const inspect = async () => {
          const answer = await admin.from("ap_sensitive_payloads").select(columns).eq("id", input.payloadId).abortSignal(signal).maybeSingle();
          ensure(!signal.aborted && !answer.error, "RESULT_UNKNOWN"); if (answer.data === null) return null;
          const row = parse(identitySchema, answer.data, "IDENTITY_MISMATCH");
          ensure(row.id === input.payloadId && row.customer_id === input.customerId && row.content_sha256 === input.sha256 && row.encryption_context_hash === expected, "IDENTITY_MISMATCH");
          return { payloadId: row.id, sha256: row.content_sha256 };
        };
        const existing = await inspect(); if (existing) return existing;
        const encrypted = await encryptSensitivePayload({ plaintext, context: serviceRepairPayloadContext(input), configuration, kms });
        ensure(!signal.aborted && encrypted.contentSha256 === input.sha256 && encrypted.encryptionContextHash === expected, "DIGEST_INVALID");
        try {
          await admin.from("ap_sensitive_payloads").insert({ id: input.payloadId, customer_id: input.customerId, ciphertext: postgresBytea(encrypted.ciphertext),
            encryption_algorithm: encrypted.algorithm, encrypted_data_key: postgresBytea(encrypted.encryptedDataKey), nonce: postgresBytea(encrypted.nonce),
            authentication_tag: postgresBytea(encrypted.authenticationTag), content_sha256: encrypted.contentSha256, kms_key_identity: encrypted.keyIdentity,
            kms_key_version: encrypted.keyVersion, encryption_context_hash: encrypted.encryptionContextHash }).abortSignal(signal);
        } catch { /* An uncertain insert is resolved by its exact immutable receipt. */ }
        ensure(!signal.aborted, "RESULT_UNKNOWN"); const receipt = await inspect(); ensure(receipt, "RESULT_UNKNOWN"); return receipt;
      } catch (error) { throw error instanceof ServiceRepairPayloadError ? error : new ServiceRepairPayloadError("RESULT_UNKNOWN"); }
    }, 20_000);
  } finally { plaintext.fill(0); }
}

import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { parsePostgresBytea } from "@/lib/commerce/server";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { decryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady } from "@/lib/security/sensitive-payload";
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytea = (max: number) => z.string().regex(/^\\x(?:[a-fA-F0-9]{2})+$/).max(2 + max * 2);
const contactSchema = z.object({ id: uuid, customer_id: uuid, content_sha256: hash, retention_state: z.literal("ACTIVE"), encryption_context_hash: hash,
  encryption_algorithm: z.literal("AES-256-GCM"), ciphertext: bytea(8192), encrypted_data_key: bytea(16_384), nonce: bytea(12), authentication_tag: bytea(16),
  kms_key_identity: z.string().min(1).max(2048), kms_key_version: z.string().min(1).max(100) }).strict();
const identitySchema = contactSchema.pick({ id: true, customer_id: true, content_sha256: true, retention_state: true, encryption_context_hash: true });

export class DraftOwnerContactError extends Error { constructor(readonly code: string) { super(`DRAFT_OWNER_CONTACT_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftOwnerContactError(code); }
/** After fresh administrator authorization only. Returns owned plaintext bytes:
 * the caller must clear them in finally after strict contact parsing. */
export async function readConfirmedDraftContact(admin: SupabaseClient<Database>, requestedBinding: { customerId: string; payloadId: string; sha256: string }, external: AbortSignal): Promise<Buffer> {
  const parsedBinding = z.object({ customerId: uuid, payloadId: uuid, sha256: hash }).strict().safeParse(requestedBinding);
  ensure(parsedBinding.success, "CONTACT_BINDING_INVALID"); const binding = parsedBinding.data;
  const controller = new AbortController(), abort = () => controller.abort();
  external.addEventListener("abort", abort, { once: true }); if (external.aborted) abort();
  let interrupt: () => void = () => undefined, owned: Buffer | undefined, transferred = false;
  const stopped = new Promise<never>((_, reject) => { interrupt = () => reject(new DraftOwnerContactError("ABORTED")); controller.signal.addEventListener("abort", interrupt, { once: true }); if (controller.signal.aborted) interrupt(); });
  const timer = setTimeout(abort, 20_000);
  const operation = async () => {
    try {
      ensure(!controller.signal.aborted, "ABORTED");
      const result = await admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state,encryption_context_hash,encryption_algorithm,ciphertext,encrypted_data_key,nonce,authentication_tag,kms_key_identity,kms_key_version").eq("id", binding.payloadId).abortSignal(controller.signal).single();
      ensure(!controller.signal.aborted && !result.error, "CONTACT_UNAVAILABLE");
      const parsed = contactSchema.safeParse(result.data); ensure(parsed.success, "CONTACT_INVALID"); const row = parsed.data;
      ensure(row.id === binding.payloadId && row.customer_id === binding.customerId && row.content_sha256 === binding.sha256, "CONTACT_MISMATCH");
      const configuration = sensitivePayloadConfiguration(); ensure(sensitivePayloadEncryptionReady(configuration), "ENCRYPTION_UNAVAILABLE");
      owned = await decryptSensitivePayload({ configuration, kms: remoteKmsAdapter(), context: { customerId: binding.customerId, payloadId: row.id, purpose: "CHUNK5_DOCUMENT_CONTACT" },
        envelope: { algorithm: row.encryption_algorithm, ciphertext: parsePostgresBytea(row.ciphertext), encryptedDataKey: parsePostgresBytea(row.encrypted_data_key), nonce: parsePostgresBytea(row.nonce), authenticationTag: parsePostgresBytea(row.authentication_tag), contentSha256: row.content_sha256, keyIdentity: row.kms_key_identity, keyVersion: row.kms_key_version, encryptionContextHash: row.encryption_context_hash } });
      ensure(!controller.signal.aborted && owned.length > 0 && owned.length <= 8192 && digest(owned) === binding.sha256, "CONTACT_INVALID");
      const after = await admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state,encryption_context_hash").eq("id", binding.payloadId).abortSignal(controller.signal).single();
      ensure(!controller.signal.aborted && !after.error, "CONTACT_UNAVAILABLE");
      const current = identitySchema.safeParse(after.data); ensure(current.success, "CONTACT_INVALID");
      ensure(current.data.id === row.id && current.data.customer_id === row.customer_id && current.data.content_sha256 === row.content_sha256
        && current.data.encryption_context_hash === row.encryption_context_hash, "CONTACT_MISMATCH");
      return owned;
    } finally { if (controller.signal.aborted) owned?.fill(0); }
  };
  try { const bytes = await Promise.race([operation(), stopped]); ensure(!controller.signal.aborted, "ABORTED"); transferred = true; return bytes; }
  catch (error) { throw error instanceof DraftOwnerContactError ? error : new DraftOwnerContactError("CONTACT_UNAVAILABLE"); }
  finally { clearTimeout(timer); external.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", interrupt); controller.abort(); if (!transferred) owned?.fill(0); }
}

import "server-only";

import { z } from "zod";
import { parsePostgresBytea, postgresBytea } from "@/lib/commerce/server";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import {
  decryptSensitivePayload,
  encryptSensitivePayload,
  sensitivePayloadConfiguration,
  sensitivePayloadEncryptionReady,
} from "@/lib/security/sensitive-payload";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export const referencePayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  organization: z.string().trim().min(1).max(160),
  relationship: z.string().trim().min(1).max(160),
  email: z.email().max(254),
  phone: z.string().trim().min(7).max(40),
  sharedWorkContext: z.string().trim().min(1).max(500),
  capabilitiesCanVerify: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  approvedContextLine: z.string().trim().max(240).nullable().optional(),
}).strict();

export type ReferencePayload = z.infer<typeof referencePayloadSchema>;

export type StoredReferenceEnvelope = {
  ciphertext: unknown;
  encryption_algorithm: "AES-256-GCM";
  encrypted_data_key: unknown;
  nonce: unknown;
  authentication_tag: unknown;
  content_sha256: string;
  kms_key_identity: string;
  kms_key_version: string;
  encryption_context_hash: string;
};

export async function storeReferencePayload(input: {
  admin: AdminClient;
  customerId: string;
  payloadId: string;
  payload: ReferencePayload;
}) {
  const parsed = referencePayloadSchema.parse(input.payload);
  const plaintext = Buffer.from(JSON.stringify({
    schemaVersion: "chunk5-reference-record-v1",
    ...parsed,
    approvedContextLine: parsed.approvedContextLine || null,
  }), "utf8");
  try {
    const configuration = sensitivePayloadConfiguration();
    if (!sensitivePayloadEncryptionReady(configuration)) throw new Error("reference_kms_not_configured");
    const envelope = await encryptSensitivePayload({
      plaintext,
      context: { customerId: input.customerId, payloadId: input.payloadId, purpose: "REFERENCE_RECORD" },
      configuration,
      kms: remoteKmsAdapter(),
    });
    const inserted = await input.admin.from("ap_sensitive_payloads").insert({
      id: input.payloadId,
      customer_id: input.customerId,
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
    return { payloadSha256: envelope.contentSha256 };
  } finally {
    plaintext.fill(0);
  }
}

export async function readReferencePayload(input: {
  customerId: string;
  payloadId: string;
  envelope: StoredReferenceEnvelope;
}) {
  const configuration = sensitivePayloadConfiguration();
  if (!sensitivePayloadEncryptionReady(configuration)) throw new Error("reference_kms_not_configured");
  const plaintext = await decryptSensitivePayload({
    envelope: {
      algorithm: input.envelope.encryption_algorithm,
      ciphertext: parsePostgresBytea(input.envelope.ciphertext),
      encryptedDataKey: parsePostgresBytea(input.envelope.encrypted_data_key),
      nonce: parsePostgresBytea(input.envelope.nonce),
      authenticationTag: parsePostgresBytea(input.envelope.authentication_tag),
      contentSha256: input.envelope.content_sha256,
      keyIdentity: input.envelope.kms_key_identity,
      keyVersion: input.envelope.kms_key_version,
      encryptionContextHash: input.envelope.encryption_context_hash,
    },
    context: { customerId: input.customerId, payloadId: input.payloadId, purpose: "REFERENCE_RECORD" },
    configuration,
    kms: remoteKmsAdapter(),
  });
  try {
    const decoded = JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
    if (decoded.schemaVersion !== "chunk5-reference-record-v1") throw new Error("reference_payload_version_invalid");
    const reference = { ...decoded };
    delete reference.schemaVersion;
    return referencePayloadSchema.parse(reference);
  } finally {
    plaintext.fill(0);
  }
}

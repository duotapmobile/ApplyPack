import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "AES-256-GCM" as const;
const DATA_KEY_BYTES = 32;
const NONCE_BYTES = 12;

export type SensitivePayloadConfiguration = {
  enabled: boolean;
  keyIdentity: string | null;
  keyVersion: string | null;
  contextVersion: string | null;
};

export type KmsEnvelopeAdapter = {
  wrapDataKey(input: {
    plaintextDataKey: Uint8Array;
    keyIdentity: string;
    keyVersion: string;
    encryptionContext: Readonly<Record<string, string>>;
  }): Promise<Uint8Array>;
  unwrapDataKey(input: {
    encryptedDataKey: Uint8Array;
    keyIdentity: string;
    keyVersion: string;
    encryptionContext: Readonly<Record<string, string>>;
  }): Promise<Uint8Array>;
};

export type SensitivePayloadEnvelope = {
  algorithm: typeof ALGORITHM;
  authenticationTag: Uint8Array;
  ciphertext: Uint8Array;
  contentSha256: string;
  encryptedDataKey: Uint8Array;
  encryptionContextHash: string;
  keyIdentity: string;
  keyVersion: string;
  nonce: Uint8Array;
};

export function sensitivePayloadConfiguration(
  environment: Partial<NodeJS.ProcessEnv> = process.env,
): SensitivePayloadConfiguration {
  return {
    enabled: environment.APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED === "true",
    keyIdentity: environment.APP_KMS_KEY_IDENTITY?.trim() || null,
    keyVersion: environment.APP_KMS_KEY_VERSION?.trim() || null,
    contextVersion: environment.APP_KMS_ENCRYPTION_CONTEXT_VERSION?.trim() || null,
  };
}

export function sensitivePayloadEncryptionReady(configuration: SensitivePayloadConfiguration) {
  return configuration.enabled
    && Boolean(configuration.keyIdentity)
    && Boolean(configuration.keyVersion)
    && Boolean(configuration.contextVersion);
}

function canonicalContext(context: Readonly<Record<string, string>>, contextVersion: string) {
  const entries = Object.entries(context)
    .map(([key, value]) => [key.normalize("NFC"), value.normalize("NFC")] as const)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return JSON.stringify({ contextVersion, entries });
}

function encryptionContext(
  context: Readonly<Record<string, string>>,
  configuration: SensitivePayloadConfiguration,
) {
  if (!sensitivePayloadEncryptionReady(configuration)) {
    throw new Error("sensitive_payload_encryption_not_configured");
  }
  const canonical = canonicalContext(context, configuration.contextVersion!);
  return {
    canonical,
    hash: createHash("sha256").update(canonical, "utf8").digest("hex"),
    values: { ...context, contextVersion: configuration.contextVersion! },
  };
}

export async function encryptSensitivePayload(input: {
  plaintext: Uint8Array;
  context: Readonly<Record<string, string>>;
  configuration: SensitivePayloadConfiguration;
  kms: KmsEnvelopeAdapter;
}): Promise<SensitivePayloadEnvelope> {
  if (input.plaintext.byteLength < 1) throw new Error("sensitive_payload_empty");
  const context = encryptionContext(input.context, input.configuration);
  const dataKey = randomBytes(DATA_KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  try {
    const encryptedDataKey = Buffer.from(await input.kms.wrapDataKey({
      plaintextDataKey: dataKey,
      keyIdentity: input.configuration.keyIdentity!,
      keyVersion: input.configuration.keyVersion!,
      encryptionContext: context.values,
    }));
    if (encryptedDataKey.byteLength < 1) throw new Error("kms_wrapped_key_empty");
    const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
    cipher.setAAD(Buffer.from(context.canonical, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
    return {
      algorithm: ALGORITHM,
      authenticationTag: cipher.getAuthTag(),
      ciphertext,
      contentSha256: createHash("sha256").update(input.plaintext).digest("hex"),
      encryptedDataKey,
      encryptionContextHash: context.hash,
      keyIdentity: input.configuration.keyIdentity!,
      keyVersion: input.configuration.keyVersion!,
      nonce,
    };
  } finally {
    dataKey.fill(0);
  }
}

export async function decryptSensitivePayload(input: {
  envelope: SensitivePayloadEnvelope;
  context: Readonly<Record<string, string>>;
  configuration: SensitivePayloadConfiguration;
  kms: KmsEnvelopeAdapter;
}) {
  const context = encryptionContext(input.context, input.configuration);
  if (input.envelope.algorithm !== ALGORITHM
    || input.envelope.keyIdentity !== input.configuration.keyIdentity
    || input.envelope.keyVersion !== input.configuration.keyVersion
    || input.envelope.encryptionContextHash !== context.hash
    || input.envelope.nonce.byteLength !== NONCE_BYTES
    || input.envelope.authenticationTag.byteLength !== 16) {
    throw new Error("sensitive_payload_envelope_invalid");
  }
  const dataKey = Buffer.from(await input.kms.unwrapDataKey({
    encryptedDataKey: input.envelope.encryptedDataKey,
    keyIdentity: input.envelope.keyIdentity,
    keyVersion: input.envelope.keyVersion,
    encryptionContext: context.values,
  }));
  if (dataKey.byteLength !== DATA_KEY_BYTES) {
    dataKey.fill(0);
    throw new Error("kms_data_key_invalid");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey, input.envelope.nonce);
    decipher.setAAD(Buffer.from(context.canonical, "utf8"));
    decipher.setAuthTag(Buffer.from(input.envelope.authenticationTag));
    const plaintext = Buffer.concat([decipher.update(input.envelope.ciphertext), decipher.final()]);
    if (createHash("sha256").update(plaintext).digest("hex") !== input.envelope.contentSha256) {
      plaintext.fill(0);
      throw new Error("sensitive_payload_hash_mismatch");
    }
    return plaintext;
  } finally {
    dataKey.fill(0);
  }
}

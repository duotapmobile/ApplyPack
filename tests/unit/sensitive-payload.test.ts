import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  decryptSensitivePayload,
  encryptSensitivePayload,
  sensitivePayloadConfiguration,
  type KmsEnvelopeAdapter,
} from "@/lib/security/sensitive-payload";

const configuration = {
  enabled: true,
  keyIdentity: "synthetic-kms-key",
  keyVersion: "7",
  contextVersion: "applypack-sensitive-context-v1",
};

function syntheticKms(): KmsEnvelopeAdapter {
  const wrappingKey = Buffer.alloc(32, 0x5a);
  const transform = (bytes: Uint8Array) => Buffer.from(Uint8Array.from(bytes, (byte, index) => byte ^ wrappingKey[index % wrappingKey.length]));
  return {
    wrapDataKey: async ({ plaintextDataKey }) => transform(plaintextDataKey),
    unwrapDataKey: async ({ encryptedDataKey }) => transform(encryptedDataKey),
  };
}

describe("sensitive payload envelope encryption", () => {
  it("fails closed when the production KMS boundary is disabled or incomplete", async () => {
    expect(sensitivePayloadConfiguration({})).toEqual({ enabled: false, keyIdentity: null, keyVersion: null, contextVersion: null });
    await expect(encryptSensitivePayload({
      plaintext: Buffer.from("private correction"),
      context: { payloadId: "fixture" },
      configuration: sensitivePayloadConfiguration({ APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED: "true" }),
      kms: syntheticKms(),
    })).rejects.toThrow("sensitive_payload_encryption_not_configured");
  });

  it("stores authenticated ciphertext and round-trips only under the exact context", async () => {
    const plaintext = Buffer.from("private correction and reference contact");
    const context = { payloadId: "10000000-0000-4000-8000-000000000001", purpose: "CUSTOM_CRITERIA" };
    const envelope = await encryptSensitivePayload({ plaintext, context, configuration, kms: syntheticKms() });
    expect(envelope.algorithm).toBe("AES-256-GCM");
    expect(Buffer.from(envelope.ciphertext).equals(plaintext)).toBe(false);
    expect(envelope.encryptedDataKey).toHaveLength(32);
    expect(envelope.nonce).toHaveLength(12);
    expect(envelope.authenticationTag).toHaveLength(16);
    expect(await decryptSensitivePayload({ envelope, context, configuration, kms: syntheticKms() })).toEqual(plaintext);
    await expect(decryptSensitivePayload({ envelope, context: { ...context, purpose: "REFERENCE" }, configuration, kms: syntheticKms() })).rejects.toThrow("sensitive_payload_envelope_invalid");
  });

  it("rejects ciphertext tampering", async () => {
    const context = { payloadId: "20000000-0000-4000-8000-000000000001", purpose: "REFERENCE" };
    const envelope = await encryptSensitivePayload({ plaintext: Buffer.from("Jane Example"), context, configuration, kms: syntheticKms() });
    envelope.ciphertext[0] ^= 1;
    await expect(decryptSensitivePayload({ envelope, context, configuration, kms: syntheticKms() })).rejects.toThrow();
  });
});

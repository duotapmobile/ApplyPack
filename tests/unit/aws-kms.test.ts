import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { awsKmsAdapter, awsKmsConfiguration, type AwsKmsTransport } from "@/lib/security/aws-kms";
import { kmsProviderConfigured } from "@/lib/security/remote-kms";

const keyIdentity = "arn:aws:kms:us-east-1:123456789012:key/00000000-0000-4000-8000-000000000001";
const env = { APP_KMS_PROVIDER: "aws", APP_KMS_KEY_IDENTITY: keyIdentity, APP_KMS_KEY_VERSION: "1", APP_DEPLOYMENT_ENV: "staging", AWS_REGION: "us-east-1" };
const binding = { keyIdentity, keyVersion: "1", encryptionContext: { purpose: "candidate-contact", owner: "fictional@example.invalid" } };
const encrypted = new Uint8Array(64).fill(9);
function transport() {
  return {
    encrypt: vi.fn<AwsKmsTransport["encrypt"]>().mockResolvedValue({ KeyId: keyIdentity, EncryptionAlgorithm: "SYMMETRIC_DEFAULT", CiphertextBlob: encrypted, $metadata: {} }),
    decrypt: vi.fn<AwsKmsTransport["decrypt"]>().mockResolvedValue({ KeyId: keyIdentity, EncryptionAlgorithm: "SYMMETRIC_DEFAULT", Plaintext: new Uint8Array(32).fill(7), $metadata: {} }),
  };
}

describe("AWS KMS envelope adapter", () => {
  it("binds both operations to the exact key and identical digest context without logging customer values", async () => {
    const mock = transport();
    const adapter = awsKmsAdapter(env, mock);
    expect(await adapter.wrapDataKey({ ...binding, plaintextDataKey: new Uint8Array(32).fill(7) })).toEqual(encrypted);
    expect(await adapter.unwrapDataKey({ ...binding, encryptedDataKey: encrypted })).toEqual(new Uint8Array(32).fill(7));
    const encryptInput = mock.encrypt.mock.calls[0][0];
    const decryptInput = mock.decrypt.mock.calls[0][0];
    expect(decryptInput.EncryptionContext).toEqual(encryptInput.EncryptionContext);
    expect(JSON.stringify(encryptInput.EncryptionContext)).not.toContain("fictional@example.invalid");
    expect(encryptInput.EncryptionContext).toMatchObject({ application: "ApplyPack", deployment: "staging", keyVersion: "1" });
    expect(encryptInput.EncryptionContext?.contextSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(mock.encrypt.mock.calls[0][1].aborted).toBe(false);
  });
  it("changes the authenticated context for another owner or deployment", async () => {
    const mock = transport();
    await awsKmsAdapter(env, mock).wrapDataKey({ ...binding, plaintextDataKey: new Uint8Array(32) });
    await awsKmsAdapter(env, mock).unwrapDataKey({ ...binding, encryptionContext: { purpose: "candidate-contact", owner: "other@example.invalid" }, encryptedDataKey: encrypted });
    expect(mock.encrypt.mock.calls[0][0].EncryptionContext?.contextSha256).not.toEqual(mock.decrypt.mock.calls[0][0].EncryptionContext?.contextSha256);
  });
  it("rejects aliases, mismatched regions, missing deployments and invalid timeouts", () => {
    for (const change of [{ APP_KMS_KEY_IDENTITY: "alias/applypack" }, { AWS_REGION: "us-west-2" }, { APP_DEPLOYMENT_ENV: "" }, { APP_KMS_TIMEOUT_MS: "999999" }]) {
      expect(() => awsKmsConfiguration({ ...env, ...change })).toThrow("kms_aws_configuration_invalid");
      expect(kmsProviderConfigured({ ...env, ...change })).toBe(false);
    }
    expect(kmsProviderConfigured(env)).toBe(true);
    expect(kmsProviderConfigured({ APP_KMS_PROVIDER: "unknown" })).toBe(false);
  });
  it("rejects a changed key or version before contacting AWS", async () => {
    const mock = transport();
    await expect(awsKmsAdapter(env, mock).wrapDataKey({ ...binding, keyVersion: "2", plaintextDataKey: new Uint8Array(32) })).rejects.toThrow("kms_aws_key_binding_invalid");
    expect(mock.encrypt).not.toHaveBeenCalled();
  });
  it("rejects key mismatch and an unencrypted echo", async () => {
    const mock = transport();
    mock.encrypt.mockResolvedValueOnce({ KeyId: "wrong-key", CiphertextBlob: encrypted, EncryptionAlgorithm: "SYMMETRIC_DEFAULT", $metadata: {} });
    await expect(awsKmsAdapter(env, mock).wrapDataKey({ ...binding, plaintextDataKey: new Uint8Array(32).fill(7) })).rejects.toThrow("kms_aws_response_invalid");
    mock.encrypt.mockResolvedValueOnce({ KeyId: keyIdentity, CiphertextBlob: new Uint8Array(32).fill(7), EncryptionAlgorithm: "SYMMETRIC_DEFAULT", $metadata: {} });
    await expect(awsKmsAdapter(env, mock).wrapDataKey({ ...binding, plaintextDataKey: new Uint8Array(32).fill(7) })).rejects.toThrow("kms_aws_response_invalid");
  });
  it("clears invalid plaintext key material and sanitizes provider errors", async () => {
    const mock = transport();
    const malformed = new Uint8Array(16).fill(8);
    mock.decrypt.mockResolvedValueOnce({ KeyId: keyIdentity, Plaintext: malformed, EncryptionAlgorithm: "SYMMETRIC_DEFAULT", $metadata: {} });
    await expect(awsKmsAdapter(env, mock).unwrapDataKey({ ...binding, encryptedDataKey: encrypted })).rejects.toThrow("kms_aws_response_invalid");
    expect([...malformed]).toEqual(new Array(16).fill(0));
    mock.decrypt.mockRejectedValueOnce(new Error("private provider details"));
    await expect(awsKmsAdapter(env, mock).unwrapDataKey({ ...binding, encryptedDataKey: encrypted })).rejects.toThrow("kms_aws_unwrap_failed");
  });
});

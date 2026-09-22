import "server-only";

import { createHash } from "node:crypto";
import { DecryptCommand, EncryptCommand, KMSClient, type DecryptCommandInput, type DecryptCommandOutput, type EncryptCommandInput, type EncryptCommandOutput } from "@aws-sdk/client-kms";
import type { KmsEnvelopeAdapter } from "./sensitive-payload";

type Environment = Partial<NodeJS.ProcessEnv>;
export type AwsKmsTransport = {
  encrypt(input: EncryptCommandInput, signal: AbortSignal): Promise<EncryptCommandOutput>;
  decrypt(input: DecryptCommandInput, signal: AbortSignal): Promise<DecryptCommandOutput>;
};

export function awsKmsConfiguration(environment: Environment = process.env) {
  const keyIdentity = environment.APP_KMS_KEY_IDENTITY?.trim() || "";
  // Pin an immutable key ARN, not an alias whose target can change.
  const match = /^arn:(aws|aws-us-gov|aws-cn):kms:([a-z0-9-]+):[0-9]{12}:key\/([a-zA-Z0-9-]+)$/.exec(keyIdentity);
  const region = environment.AWS_REGION?.trim() || match?.[2];
  const deployment = environment.APP_DEPLOYMENT_ENV;
  const keyVersion = environment.APP_KMS_KEY_VERSION?.trim();
  const timeoutMs = Number(environment.APP_KMS_TIMEOUT_MS || 10_000);
  if (!match || region !== match[2] || !keyVersion || !["staging", "production"].includes(deployment || "")
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new Error("kms_aws_configuration_invalid");
  }
  return { keyIdentity, keyVersion, region: region!, deployment: deployment!, timeoutMs };
}

export function awsKmsAdapter(environment: Environment = process.env, suppliedTransport?: AwsKmsTransport): KmsEnvelopeAdapter {
  const configuration = awsKmsConfiguration(environment);
  const client = suppliedTransport ? null : new KMSClient({ region: configuration.region, maxAttempts: 2 });
  const transport = suppliedTransport || {
    encrypt: (input: EncryptCommandInput, signal: AbortSignal) => client!.send(new EncryptCommand(input), { abortSignal: signal }),
    decrypt: (input: DecryptCommandInput, signal: AbortSignal) => client!.send(new DecryptCommand(input), { abortSignal: signal }),
  };
  function context(input: { keyIdentity: string; keyVersion: string; encryptionContext: Readonly<Record<string, string>> }) {
    if (input.keyIdentity !== configuration.keyIdentity || input.keyVersion !== configuration.keyVersion) throw new Error("kms_aws_key_binding_invalid");
    // AWS logs its context. Only a digest of application context leaves this process.
    const entries = Object.entries(input.encryptionContext).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (!entries.length || entries.some(([key, value]) => !key || typeof value !== "string")) throw new Error("kms_aws_context_invalid");
    return {
      application: "ApplyPack", deployment: configuration.deployment, keyVersion: configuration.keyVersion,
      contextSha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
    };
  }
  return {
    async wrapDataKey(input) {
      const encryptionContext = context(input);
      if (input.plaintextDataKey.byteLength !== 32) throw new Error("kms_aws_data_key_invalid");
      let result: EncryptCommandOutput;
      try {
        result = await transport.encrypt({ KeyId: configuration.keyIdentity, Plaintext: input.plaintextDataKey,
          EncryptionAlgorithm: "SYMMETRIC_DEFAULT", EncryptionContext: encryptionContext }, AbortSignal.timeout(configuration.timeoutMs));
      } catch { throw new Error("kms_aws_wrap_failed"); }
      if (result.KeyId !== configuration.keyIdentity || result.EncryptionAlgorithm !== "SYMMETRIC_DEFAULT"
        || !result.CiphertextBlob?.byteLength || result.CiphertextBlob.byteLength > 6_144
        || Buffer.from(result.CiphertextBlob).equals(Buffer.from(input.plaintextDataKey))) throw new Error("kms_aws_response_invalid");
      return result.CiphertextBlob;
    },
    async unwrapDataKey(input) {
      const encryptionContext = context(input);
      if (!input.encryptedDataKey.byteLength || input.encryptedDataKey.byteLength > 6_144) throw new Error("kms_aws_ciphertext_invalid");
      let result: DecryptCommandOutput;
      try {
        result = await transport.decrypt({ KeyId: configuration.keyIdentity, CiphertextBlob: input.encryptedDataKey,
          EncryptionAlgorithm: "SYMMETRIC_DEFAULT", EncryptionContext: encryptionContext }, AbortSignal.timeout(configuration.timeoutMs));
      } catch { throw new Error("kms_aws_unwrap_failed"); }
      if (result.KeyId !== configuration.keyIdentity || result.EncryptionAlgorithm !== "SYMMETRIC_DEFAULT" || result.Plaintext?.byteLength !== 32) {
        result.Plaintext?.fill(0);
        throw new Error("kms_aws_response_invalid");
      }
      return result.Plaintext;
    },
  };
}

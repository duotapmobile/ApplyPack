import "server-only";
import { decryptSensitivePayload, encryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady } from "./sensitive-payload";
import { kmsProviderConfigured, remoteKmsAdapter } from "./remote-kms";

let cache: { identity: string; expiresAt: number; promise: Promise<boolean> } | null = null;

// Single-flight, bounded real-provider probe. Configuration presence alone is not readiness.
export function checkSensitivePayloadHealth(environment: Partial<NodeJS.ProcessEnv> = process.env): Promise<boolean> {
  const configuration = sensitivePayloadConfiguration(environment);
  if (!sensitivePayloadEncryptionReady(configuration) || !kmsProviderConfigured(environment)) return Promise.resolve(false);
  const identity = JSON.stringify([environment.APP_KMS_PROVIDER, configuration, environment.APP_DEPLOYMENT_ENV, environment.AWS_REGION,
    environment.APP_KMS_WRAP_URL, environment.APP_KMS_UNWRAP_URL]);
  if (cache?.identity === identity && cache.expiresAt > Date.now()) return cache.promise;
  const promise = (async () => {
    const plaintext = Buffer.from("ApplyPack synthetic readiness check", "utf8");
    let decoded: Uint8Array | null = null;
    try {
      const kms = remoteKmsAdapter(environment);
      const context = { purpose: "readiness-probe" };
      const envelope = await encryptSensitivePayload({ plaintext, context, configuration, kms });
      decoded = await decryptSensitivePayload({ envelope, context, configuration, kms });
      return Buffer.from(decoded).equals(plaintext);
    } catch { return false; }
    finally { plaintext.fill(0); decoded?.fill(0); }
  })();
  cache = { identity, expiresAt: Date.now() + 5 * 60_000, promise };
  return promise;
}

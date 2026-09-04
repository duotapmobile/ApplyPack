import "server-only";

import type { KmsEnvelopeAdapter } from "./sensitive-payload";

type KmsEnvironment = Partial<NodeJS.ProcessEnv>;

function endpoint(value: string | undefined) {
  if (!value) throw new Error("kms_remote_not_configured");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("kms_remote_requires_https");
  return url;
}

async function command(path: "wrap" | "unwrap", body: Record<string, unknown>, environment: KmsEnvironment) {
  const url = endpoint(path === "wrap" ? environment.APP_KMS_WRAP_URL : environment.APP_KMS_UNWRAP_URL);
  const token = environment.APP_KMS_BEARER_TOKEN?.trim();
  if (!token) throw new Error("kms_remote_not_configured");
  const timeout = Number(environment.APP_KMS_TIMEOUT_MS || 10_000);
  if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 30_000) throw new Error("kms_remote_timeout_invalid");
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`kms_remote_${path}_failed`);
  const result = await response.json().catch(() => null) as { key?: string; keyIdentity?: string; keyVersion?: string } | null;
  if (!result?.key || result.keyIdentity !== body.keyIdentity || result.keyVersion !== body.keyVersion) {
    throw new Error("kms_remote_response_invalid");
  }
  return Buffer.from(result.key, "base64");
}

export function remoteKmsAdapter(environment: KmsEnvironment = process.env): KmsEnvelopeAdapter {
  return {
    wrapDataKey: async (input) => command("wrap", {
      key: Buffer.from(input.plaintextDataKey).toString("base64"),
      keyIdentity: input.keyIdentity,
      keyVersion: input.keyVersion,
      encryptionContext: input.encryptionContext,
    }, environment),
    unwrapDataKey: async (input) => command("unwrap", {
      key: Buffer.from(input.encryptedDataKey).toString("base64"),
      keyIdentity: input.keyIdentity,
      keyVersion: input.keyVersion,
      encryptionContext: input.encryptionContext,
    }, environment),
  };
}

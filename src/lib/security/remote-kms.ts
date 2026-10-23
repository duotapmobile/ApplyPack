import "server-only";

import type { KmsEnvelopeAdapter } from "./sensitive-payload";
import { awsKmsAdapter, awsKmsConfiguration } from "./aws-kms";
import { awsWorkloadIdentityConfigured } from "./aws-workload-credentials";

type KmsEnvironment = Partial<NodeJS.ProcessEnv>;

function hostedEnvironment(environment: KmsEnvironment) {
  return environment.APP_DEPLOYMENT_ENV === "staging" || environment.APP_DEPLOYMENT_ENV === "production";
}

function localRemoteEnabled(environment: KmsEnvironment) {
  return !environment.APP_DEPLOYMENT_ENV && environment.APP_KMS_PROVIDER === "remote"
    && (environment.NODE_ENV === "development" || environment.NODE_ENV === "test");
}

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
  if (hostedEnvironment(environment) && environment.APP_KMS_PROVIDER !== "aws") {
    throw new Error("kms_hosted_requires_aws");
  }
  // The legacy adapter is an explicit local QA path, never a hosted fallback.
  if (environment.APP_KMS_PROVIDER === "aws") return awsKmsAdapter(environment);
  if (!localRemoteEnabled(environment)) throw new Error("kms_remote_local_only");
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

export function kmsProviderConfigured(environment: KmsEnvironment = process.env) {
  try {
    if (hostedEnvironment(environment) && environment.APP_KMS_PROVIDER !== "aws") return false;
    if (environment.APP_KMS_PROVIDER === "aws") {
      const configuration = awsKmsConfiguration(environment);
      return configuration.keyIdentity.split(":")[4] === environment.APP_AWS_ACCOUNT_ID
        && awsWorkloadIdentityConfigured(environment);
    }
    if (!localRemoteEnabled(environment)) return false;
    endpoint(environment.APP_KMS_WRAP_URL);
    endpoint(environment.APP_KMS_UNWRAP_URL);
    return Boolean(environment.APP_KMS_BEARER_TOKEN?.trim());
  } catch { return false; }
}

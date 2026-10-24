import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { kmsProviderConfigured, remoteKmsAdapter } from "@/lib/security/remote-kms";

afterEach(() => vi.unstubAllGlobals());

describe("remote KMS adapter", () => {
  const environment = {
    NODE_ENV: "test" as const,
    APP_KMS_PROVIDER: "remote",
    APP_KMS_WRAP_URL: "https://kms.example.invalid/wrap",
    APP_KMS_UNWRAP_URL: "https://kms.example.invalid/unwrap",
    APP_KMS_BEARER_TOKEN: "synthetic-token",
    APP_KMS_TIMEOUT_MS: "1000",
  };
  const input = { keyIdentity: "key-a", keyVersion: "7", encryptionContext: { purpose: "test" } };

  it("uses the configured HTTPS boundary and verifies returned key identity/version", async () => {
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ key: body.key, keyIdentity: body.keyIdentity, keyVersion: body.keyVersion }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrapped = await remoteKmsAdapter(environment).wrapDataKey({
      ...input,
      plaintextDataKey: Uint8Array.from([1, 2, 3]),
    });
    expect([...wrapped]).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed for missing configuration, non-HTTPS URLs, and mismatched responses", async () => {
    await expect(
      remoteKmsAdapter({ NODE_ENV: "test", APP_KMS_PROVIDER: "remote" }).wrapDataKey({ ...input, plaintextDataKey: new Uint8Array(32) }),
    ).rejects.toThrow("kms_remote_not_configured");
    await expect(
      remoteKmsAdapter({ ...environment, APP_KMS_WRAP_URL: "http://localhost/wrap" }).wrapDataKey({
        ...input,
        plaintextDataKey: new Uint8Array(32),
      }),
    ).rejects.toThrow("kms_remote_requires_https");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ key: "AQ==", keyIdentity: "wrong", keyVersion: "7" }), {
          status: 200,
        }),
      ),
    );
    await expect(
      remoteKmsAdapter(environment).wrapDataKey({ ...input, plaintextDataKey: new Uint8Array(32) }),
    ).rejects.toThrow("kms_remote_response_invalid");
  });

  it.each(["staging", "production"])("rejects legacy remote KMS in hosted %s before any request", (deployment) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const provider of ["remote", undefined]) {
      const hosted = { ...environment, APP_DEPLOYMENT_ENV: deployment, APP_KMS_PROVIDER: provider };
      expect(kmsProviderConfigured(hosted)).toBe(false);
      expect(() => remoteKmsAdapter(hosted)).toThrow("kms_hosted_requires_aws");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires explicit local QA selection and rejects unknown or missing deployment context", () => {
    expect(kmsProviderConfigured(environment)).toBe(true);
    for (const change of [{ NODE_ENV: "production" as const }, { NODE_ENV: undefined },
      { APP_DEPLOYMENT_ENV: "preview" }, { APP_KMS_PROVIDER: undefined }]) {
      expect(kmsProviderConfigured({ ...environment, ...change })).toBe(false);
      expect(() => remoteKmsAdapter({ ...environment, ...change })).toThrow("kms_remote_local_only");
    }
  });
});

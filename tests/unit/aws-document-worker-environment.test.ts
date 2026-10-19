// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { documentWorkerConfiguration } from "@/lib/files/aws-document-worker";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";

const digest = "a".repeat(64);
function workerEnvironment(deployment: "staging" | "production") {
  return {
    APP_DEPLOYMENT_ENV: deployment,
    APP_DOCUMENT_WORKER_DEPLOYMENT_ENV: deployment,
    AWS_REGION: "us-east-1",
    APP_DOCUMENT_WORKER_FUNCTION_ARN: `arn:aws:lambda:us-east-1:123456789012:function:applypack-${deployment}-document-worker:1`,
    APP_DOCUMENT_WORKER_BUCKET: `applypack-${deployment}-worker-private`,
    APP_DOCUMENT_WORKER_IDENTITY: "applypack-document-worker-v2-liberation-sans-2.1.5",
    APP_DOCUMENT_WORKER_FONT_SHA256: DOCUMENT_FONT_CONTRACT.styles.regular,
    APP_DOCUMENT_WORKER_FONT_MANIFEST_SHA256: DOCUMENT_FONT_CONTRACT.manifestSha256,
    APP_DOCUMENT_WORKER_IMAGE_DIGEST: digest,
    APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256: digest,
  };
}

describe("AWS document worker environment binding", () => {
  it.each(["staging", "production"] as const)("accepts an exact %s binding", (deployment) => {
    expect(documentWorkerConfiguration(workerEnvironment(deployment))).toMatchObject({
      deploymentEnvironment: deployment,
      workerDeploymentEnvironment: deployment,
      ready: true,
    });
  });

  it("rejects cross-environment and unqualified worker identities", () => {
    const staging = workerEnvironment("staging");
    for (const changed of [
      { APP_DOCUMENT_WORKER_DEPLOYMENT_ENV: "production" },
      { APP_DOCUMENT_WORKER_FUNCTION_ARN: "arn:aws:lambda:us-east-1:123456789012:function:applypack-production-document-worker:1" },
      { APP_DOCUMENT_WORKER_FUNCTION_ARN: "arn:aws:lambda:us-east-1:123456789012:function:applypack-document-worker:1" },
      { APP_DEPLOYMENT_ENV: "preview" },
      { APP_DEPLOYMENT_ENV: "" },
      { AWS_REGION: "us-west-2" },
    ]) {
      expect(documentWorkerConfiguration({ ...staging, ...changed }).ready).toBe(false);
    }
  });
});

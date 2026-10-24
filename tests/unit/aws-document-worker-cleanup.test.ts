// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  rpc: vi.fn(), adminClient: vi.fn(), s3Send: vi.fn(), lambdaSend: vi.fn(), s3Destroy: vi.fn(), lambdaDestroy: vi.fn(),
  events: [] as string[], intents: [] as Array<Record<string, unknown>>,
}));
vi.mock("server-only", () => ({}));
vi.mock("docx", () => ({
  Document: class {}, Paragraph: class {}, TextRun: class {},
  Packer: { toBuffer: async () => Buffer.from("synthetic probe document") },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: dependencies.adminClient }));
vi.mock("@/lib/security/aws-workload-credentials", () => ({
  awsWorkloadCredentials: () => async () => ({ accessKeyId: "mock-key", secretAccessKey: "mock-secret" }),
}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = dependencies.s3Send; destroy = dependencies.s3Destroy; },
  PutObjectCommand: class PutObjectCommand { constructor(readonly input: Record<string, unknown>) {} },
  GetObjectCommand: class GetObjectCommand { constructor(readonly input: Record<string, unknown>) {} },
  DeleteObjectCommand: class DeleteObjectCommand { constructor(readonly input: Record<string, unknown>) {} },
}));
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class { send = dependencies.lambdaSend; destroy = dependencies.lambdaDestroy; },
  InvokeCommand: class InvokeCommand { constructor(readonly input: Record<string, unknown>) {} },
}));

import { extractWithDocumentWorker, probeDocumentWorker } from "@/lib/files/aws-document-worker";
import { checkDocumentRendererReadiness } from "@/lib/operations/renderer-readiness";
import { probeDocumentIsolation } from "@/lib/files/isolated-extraction";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";

const now = new Date("2026-10-23T06:00:00.000Z");
const bucket = "applypack-838445019912-staging-document-worker-temp";
const functionArn = "arn:aws:lambda:us-east-1:838445019912:function:applypack-staging-document-worker:1";
const digest = "a".repeat(64);
let testIdentity = 0;
type Command = { input: Record<string, unknown>; constructor: { name: string } };
const kind = (command: Command) => command.constructor.name;
const sentKinds = () => dependencies.s3Send.mock.calls.map(([command]) => kind(command));

function intent(operationId: string, createdAt = now) {
  const key = `ephemeral/${operationId}`;
  return {
    operationId, createdAt: createdAt.toISOString(), notBefore: new Date(createdAt.getTime() + 600_000).toISOString(),
    bucket, keys: [key, `${key}.render.pdf`, `${key}.page-1.png`, `${key}.page-2.png`], completed: false,
  };
}

function successfulProbe() {
  return { Payload: Buffer.from(JSON.stringify({
    identity: process.env.APP_DOCUMENT_WORKER_IDENTITY, ok: true, deploymentEnvironment: "staging",
    functionVersionArn: process.env.APP_DOCUMENT_WORKER_FUNCTION_ARN,
    imageDigest: process.env.APP_DOCUMENT_WORKER_IMAGE_DIGEST, networkIsolationVerified: true,
    renderedPdfHeader: "%PDF-", docxExtractionVerified: true, renderedTextVerified: true, pageCount: 1,
    documentFontSha256: DOCUMENT_FONT_CONTRACT.styles.regular, documentFontFamily: DOCUMENT_FONT_CONTRACT.family,
    documentFontVersion: DOCUMENT_FONT_CONTRACT.version, documentFontManifestSha256: DOCUMENT_FONT_CONTRACT.manifestSha256,
    documentFontStyleSha256: DOCUMENT_FONT_CONTRACT.styles,
  })) };
}

describe("document worker durable temporary cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.clearAllMocks();
    dependencies.events.length = 0;
    dependencies.intents.length = 0;
    const environment = {
      APP_DEPLOYMENT_ENV: "staging", APP_DOCUMENT_WORKER_DEPLOYMENT_ENV: "staging",
      AWS_REGION: "us-east-1", APP_AWS_ACCOUNT_ID: "838445019912",
      APP_DOCUMENT_WORKER_FUNCTION_ARN: functionArn, APP_DOCUMENT_WORKER_BUCKET: bucket,
      APP_DOCUMENT_WORKER_TEMPORARY_PREFIX: "ephemeral/",
      APP_DOCUMENT_WORKER_IDENTITY: "applypack-document-worker-v2-liberation-sans-2.1.5",
      APP_DOCUMENT_WORKER_FONT_SHA256: DOCUMENT_FONT_CONTRACT.styles.regular,
      APP_DOCUMENT_WORKER_FONT_MANIFEST_SHA256: DOCUMENT_FONT_CONTRACT.manifestSha256,
      APP_DOCUMENT_WORKER_IMAGE_DIGEST: digest, APP_DOCUMENT_WORKER_PREFLIGHT_RECEIPT_SHA256: digest,
      APP_DOCUMENT_WORKER_PROBE_RECEIPT_SHA256: digest, APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256: digest,
      APP_RENDERER_RUNTIME_DISCOVERY_FAILED: "false",
      APP_RELEASE_SHA: String(++testIdentity).padStart(40, "0"), RAILWAY_GIT_COMMIT_SHA: "",
    };
    for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value);
    dependencies.adminClient.mockReturnValue({ rpc: dependencies.rpc });
    dependencies.rpc.mockImplementation(async (_name: string, args: { p_operation_id: string }) => {
      dependencies.events.push("persist-intent");
      const value = intent(args.p_operation_id, new Date(Date.now()));
      dependencies.intents.push(value);
      return { data: value, error: null };
    });
    dependencies.s3Send.mockImplementation(async (command: Command) => {
      dependencies.events.push(kind(command));
      return {};
    });
    dependencies.lambdaSend.mockImplementation(async () => {
      dependencies.events.push("InvokeCommand");
      return { Payload: Buffer.from(JSON.stringify({
        identity: environment.APP_DOCUMENT_WORKER_IDENTITY, ok: true, deploymentEnvironment: "staging",
        functionVersionArn: functionArn, imageDigest: digest, networkIsolationVerified: true,
        text: "Verified document text", paginationStatus: "MEASURED", pageCount: 1,
      })) };
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("persists all four exact cleanup keys before upload and invocation, retaining the delayed receipt after success", async () => {
    await expect(extractWithDocumentWorker(Buffer.from("document"), "application/pdf"))
      .resolves.toMatchObject({ text: "Verified document text", pageCount: 1 });
    expect(dependencies.events.slice(0, 3)).toEqual(["persist-intent", "PutObjectCommand", "InvokeCommand"]);
    expect(dependencies.rpc).toHaveBeenCalledOnce();
    expect(dependencies.rpc).toHaveBeenCalledWith("ap_begin_aws_temporary_cleanup", {
      p_operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/), p_deployment_environment: "staging",
    });
    expect(dependencies.intents).toHaveLength(1);
    expect(dependencies.intents[0]).toMatchObject({ notBefore: "2026-10-23T06:10:00.000Z", completed: false });
    const deletions = dependencies.s3Send.mock.calls.filter(([command]) => kind(command) === "DeleteObjectCommand");
    expect(deletions.map(([command]) => command.input.Key).sort()).toEqual(
      [...dependencies.intents[0].keys as string[]].sort(),
    );
    expect(deletions).toHaveLength(4);
    for (const [, options] of deletions) expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(dependencies.s3Destroy).toHaveBeenCalledOnce();
    expect(dependencies.lambdaDestroy).toHaveBeenCalledOnce();
  });

  it("performs no provider write when durable intent persistence fails", async () => {
    dependencies.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(extractWithDocumentWorker(Buffer.from("document"), "application/pdf")).rejects.toThrow();
    expect(dependencies.s3Send).not.toHaveBeenCalled();
    expect(dependencies.lambdaSend).not.toHaveBeenCalled();
  });

  it("retains a persisted intent when upload fails before invocation", async () => {
    dependencies.s3Send.mockImplementation(async (command: Command) => {
      if (kind(command) === "PutObjectCommand") throw new Error("upload response lost");
      return {};
    });
    await expect(extractWithDocumentWorker(Buffer.from("document"), "application/pdf")).rejects.toThrow("upload response lost");
    expect(dependencies.intents).toHaveLength(1);
    expect(dependencies.intents[0].completed).toBe(false);
    expect(dependencies.lambdaSend).not.toHaveBeenCalled();
    expect(sentKinds().filter(name => name === "DeleteObjectCommand")).toHaveLength(4);
  });

  it("retains cleanup for all possible output keys after a lost Lambda response", async () => {
    dependencies.lambdaSend.mockRejectedValue(new Error("worker response lost"));
    await expect(extractWithDocumentWorker(Buffer.from("document"), "application/pdf")).rejects.toThrow("worker response lost");
    expect(dependencies.intents[0]).toMatchObject({ completed: false, notBefore: "2026-10-23T06:10:00.000Z" });
    expect(dependencies.intents[0].keys).toHaveLength(4);
    expect(sentKinds().filter(name => name === "DeleteObjectCommand")).toHaveLength(4);
    expect(dependencies.rpc).toHaveBeenCalledOnce();
  });

  it("keeps a successful operation recoverable when every immediate deletion fails", async () => {
    dependencies.s3Send.mockImplementation(async (command: Command) => {
      if (kind(command) === "DeleteObjectCommand") throw new Error("temporary provider deletion failure");
      return {};
    });
    await expect(extractWithDocumentWorker(Buffer.from("document"), "application/pdf"))
      .resolves.toMatchObject({ text: "Verified document text" });
    expect(dependencies.intents[0].completed).toBe(false);
    expect(dependencies.rpc).toHaveBeenCalledOnce();
    expect(sentKinds().filter(name => name === "DeleteObjectCommand")).toHaveLength(4);
  });

  it("does not start Lambda when upload consumed the entire immutable submission window", async () => {
    dependencies.s3Send.mockImplementation(async (command: Command) => {
      if (kind(command) === "PutObjectCommand") vi.setSystemTime(new Date(now.getTime() + 61_000));
      return {};
    });
    await expect(extractWithDocumentWorker(Buffer.from("document"), "application/pdf")).rejects.toThrow();
    expect(dependencies.lambdaSend).not.toHaveBeenCalled();
    expect(dependencies.intents[0].createdAt).toBe(now.toISOString());
    expect(sentKinds().filter(name => name === "DeleteObjectCommand")).toHaveLength(4);
  });

  it.each([-61_000, 6_000])("rejects a persisted lease outside the permitted clock window (%i ms)", async offset => {
    dependencies.rpc.mockImplementation(async (_name: string, args: { p_operation_id: string }) => ({
      data: intent(args.p_operation_id, new Date(now.getTime() + offset)), error: null,
    }));
    await expect(extractWithDocumentWorker(Buffer.from("document"), "application/pdf")).rejects.toThrow();
    expect(sentKinds()).not.toContain("PutObjectCommand");
    expect(dependencies.lambdaSend).not.toHaveBeenCalled();
  });

  it("shares one in-flight provider probe between parser and renderer consumers", async () => {
    let finish!: (value: ReturnType<typeof successfulProbe>) => void;
    let started!: () => void;
    const invoked = new Promise<void>(resolve => { started = resolve; });
    dependencies.lambdaSend.mockImplementation(() => {
      started();
      return new Promise(resolve => { finish = resolve; });
    });
    const parser = probeDocumentIsolation();
    const renderer = probeDocumentWorker();
    await invoked;
    expect(dependencies.rpc).toHaveBeenCalledOnce();
    expect(sentKinds()).toEqual(["PutObjectCommand"]);
    finish(successfulProbe());
    expect(await Promise.all([parser, renderer])).toEqual([true, true]);
    expect(dependencies.lambdaSend).toHaveBeenCalledOnce();
    expect(dependencies.intents).toHaveLength(1);
  });

  it("reuses a successful probe for five minutes and obtains a new durable lease exactly at expiry", async () => {
    dependencies.lambdaSend.mockImplementation(async () => successfulProbe());
    expect(await probeDocumentWorker()).toBe(true);
    vi.setSystemTime(now.getTime() + 299_999);
    expect(await probeDocumentWorker()).toBe(true);
    expect(dependencies.rpc).toHaveBeenCalledOnce();
    vi.setSystemTime(now.getTime() + 300_000);
    expect(await probeDocumentWorker()).toBe(true);
    expect(dependencies.rpc).toHaveBeenCalledTimes(2);
    expect(dependencies.intents[1].createdAt).toBe("2026-10-23T06:05:00.000Z");
  });

  it("caches failed probes during an outage to bound cleanup writes and retries after expiry", async () => {
    dependencies.lambdaSend.mockRejectedValue(new Error("private provider outage"));
    expect(await probeDocumentWorker()).toBe(false);
    expect(await probeDocumentIsolation()).toBe(false);
    expect(dependencies.rpc).toHaveBeenCalledOnce();
    vi.setSystemTime(now.getTime() + 300_000);
    expect(await probeDocumentWorker()).toBe(false);
    expect(dependencies.rpc).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["APP_AWS_RA_CERTIFICATE_PEM", "rotated-fixture-certificate"],
    ["AWS_SESSION_TOKEN", "rotated-fixture-token"],
    ["NODE_TLS_REJECT_UNAUTHORIZED", "0"],
    ["APP_EXPECTED_RELEASE_SHA", "b".repeat(40)],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://changed-fixture.supabase.co"],
    ["APP_DOCUMENT_WORKER_FUNCTION_ARN", functionArn.replace(/:1$/, ":2")],
    ["APP_DOCUMENT_WORKER_IMAGE_DIGEST", "b".repeat(64)],
  ])("invalidates a healthy cached probe after %s changes", async (name, value) => {
    dependencies.lambdaSend.mockImplementation(async () => successfulProbe());
    expect(await probeDocumentIsolation()).toBe(true);
    vi.stubEnv(name, value);
    expect(await probeDocumentIsolation()).toBe(true);
    expect(dependencies.rpc).toHaveBeenCalledTimes(2);
  });

  it("does not let a cached parser result hide an invalid hosted worker configuration", async () => {
    dependencies.lambdaSend.mockImplementation(async () => successfulProbe());
    expect(await probeDocumentIsolation()).toBe(true);
    vi.stubEnv("APP_DOCUMENT_WORKER_BUCKET", "wrong-bucket");
    expect(await probeDocumentIsolation()).toBe(false);
    expect(dependencies.rpc).toHaveBeenCalledOnce();
  });

  it("re-reads renderer approval and observes revocation while the provider probe remains cached", async () => {
    dependencies.lambdaSend.mockImplementation(async () => successfulProbe());
    const approval = {
      materials_generation_approved: true, materials_generation_approval_reference: "review-fixture",
      material_output_formats: ["DOCX", "PDF"], document_renderer_identity: process.env.APP_DOCUMENT_WORKER_IDENTITY,
      document_font_family: DOCUMENT_FONT_CONTRACT.family, document_font_sha256: DOCUMENT_FONT_CONTRACT.styles.regular,
      document_font_manifest_sha256: DOCUMENT_FONT_CONTRACT.manifestSha256,
      document_worker_network_attestation_sha256: digest, document_safety_policy: "generated-structural-v1",
    };
    const maybeSingle = vi.fn(async () => ({ data: { ...approval }, error: null }));
    const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) };
    expect(await checkDocumentRendererReadiness(admin as never)).toBe(true);
    expect(await checkDocumentRendererReadiness(admin as never)).toBe(true);
    approval.materials_generation_approved = false;
    expect(await checkDocumentRendererReadiness(admin as never)).toBe(false);
    expect(maybeSingle).toHaveBeenCalledTimes(3);
    expect(dependencies.rpc).toHaveBeenCalledOnce();
  });
});

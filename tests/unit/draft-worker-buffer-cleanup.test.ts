// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ send: vi.fn(), invoke: vi.fn(), validate: vi.fn(), intent: vi.fn(), deleted: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/security/aws-workload-credentials", () => ({ awsWorkloadCredentials: () => async () => ({}) }));
vi.mock("@/lib/files/aws-temporary-cleanup", () => ({ createAwsTemporaryCleanupIntent: deps.intent, assertAwsTemporarySubmissionOpen: () => undefined }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = deps.send; destroy() {} },
  PutObjectCommand: class PutObjectCommand { constructor(readonly input: Record<string, unknown>) {} },
  GetObjectCommand: class GetObjectCommand { constructor(readonly input: Record<string, unknown>) {} },
  DeleteObjectCommand: class DeleteObjectCommand { constructor(readonly input: Record<string, unknown>) {} },
}));
vi.mock("@aws-sdk/client-lambda", () => ({ LambdaClient: class { send = deps.invoke; destroy() {} }, InvokeCommand: class { constructor(readonly input: Record<string, unknown>) {} } }));
// Cleanup boundary doubles only; real PDF/worker proof is kept in the render and image suites.
vi.mock("@/lib/documents/pdf-bounds", () => ({ pdfTextBoundsAreValid: () => true }));
vi.mock("@/lib/documents/font-validation", () => ({ pdfFontTableUsesApprovedFont: () => true }));
vi.mock("@/lib/documents/draft-pdf-validation", () => ({ assertDraftPdfExpectation: () => undefined, validateDraftPdfEvidence: deps.validate }));
import { renderWithDocumentWorker } from "@/lib/files/aws-document-worker";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
import type { DocumentRenderInput } from "@/lib/documents/renderer";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
type Command = { input: Record<string, unknown>; constructor: { name: string } };
describe("new-profile isolated-worker private buffer ownership", () => {
  let cleared: Array<{ bytes: Buffer; before: string }>, input: DocumentRenderInput, response: Record<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks(); deps.deleted.length = 0; cleared = [];
    const fill = Buffer.prototype.fill;
    vi.spyOn(Buffer.prototype, "fill").mockImplementation(function (this: Buffer, ...args) {
      if (args[0] === 0 && (this.subarray(0, 12).toString().startsWith("%PDF-private") || this.toString().startsWith("private-page"))) cleared.push({ bytes: this, before: this.toString() });
      return fill.apply(this, args);
    });
    const environment = { APP_DEPLOYMENT_ENV: "staging", APP_DOCUMENT_WORKER_DEPLOYMENT_ENV: "staging", AWS_REGION: "us-east-1", APP_AWS_ACCOUNT_ID: "838445019912",
      APP_DOCUMENT_WORKER_FUNCTION_ARN: "arn:aws:lambda:us-east-1:838445019912:function:applypack-staging-document-worker:1",
      APP_DOCUMENT_WORKER_BUCKET: "applypack-838445019912-staging-document-worker-temp", APP_DOCUMENT_WORKER_TEMPORARY_PREFIX: "ephemeral/",
      APP_DOCUMENT_WORKER_IDENTITY: "applypack-document-worker-v2-liberation-sans-2.1.5", APP_DOCUMENT_WORKER_FONT_SHA256: DOCUMENT_FONT_CONTRACT.styles.regular,
      APP_DOCUMENT_WORKER_FONT_MANIFEST_SHA256: DOCUMENT_FONT_CONTRACT.manifestSha256, APP_DOCUMENT_WORKER_IMAGE_DIGEST: "a".repeat(64),
      APP_DOCUMENT_WORKER_PREFLIGHT_RECEIPT_SHA256: "b".repeat(64), APP_DOCUMENT_WORKER_PROBE_RECEIPT_SHA256: "c".repeat(64), APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256: "d".repeat(64), APP_RENDERER_RUNTIME_DISCOVERY_FAILED: "false" };
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
    deps.intent.mockResolvedValue({ keys: ["ephemeral/test", "ephemeral/test.render.pdf", "ephemeral/test.page-1.png", "ephemeral/test.page-2.png"] });
    response = { identity: environment.APP_DOCUMENT_WORKER_IDENTITY, ok: true, deploymentEnvironment: "staging", functionVersionArn: environment.APP_DOCUMENT_WORKER_FUNCTION_ARN,
      imageDigest: environment.APP_DOCUMENT_WORKER_IMAGE_DIGEST, networkIsolationVerified: true, pageCount: 2, pdfInfo: "Tagged: yes\nTitle: Title\nAuthor: Author\nSubject: Subject", pdfMetadata: "en-US", structureTree: "structure", boundingXml: "bounds", fontInfo: "fonts", extractedText: "reviewed", structureText: "semantic structure", linkXml: "links",
      documentFontSha256: DOCUMENT_FONT_CONTRACT.styles.regular, documentFontFamily: DOCUMENT_FONT_CONTRACT.family, documentFontVersion: DOCUMENT_FONT_CONTRACT.version,
      documentFontManifestSha256: DOCUMENT_FONT_CONTRACT.manifestSha256, documentFontStyleSha256: DOCUMENT_FONT_CONTRACT.styles };
    deps.invoke.mockImplementation(async () => ({ Payload: Buffer.from(JSON.stringify(response)) }));
    deps.send.mockImplementation(async (command: Command) => {
      const key = String(command.input.Key);
      if (command.constructor.name === "DeleteObjectCommand") deps.deleted.push(key);
      if (command.constructor.name === "GetObjectCommand") return { Body: { transformToByteArray: async () => Buffer.from(key.endsWith(".pdf") ? "%PDF-private" : `private-page-${key.endsWith("2.png") ? 2 : 1}`) } };
      return {};
    });
    deps.validate.mockImplementation(() => { throw new Error("semantic/link validation failed"); });
    input = { docx: Buffer.from("caller-owned-docx"), expectedPages: 2, expectedExtractedTextSha256: hash("reviewed"), artifactType: "RESUME", expectedMetadata: { title: "Title", author: "Author", subject: "Subject", keywords: "", language: "en-US" }, draftPdf: {} as NonNullable<DocumentRenderInput["draftPdf"]> };
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it("clears every downloaded private buffer after semantic validation fails while retaining caller input", async () => {
    await expect(renderWithDocumentWorker(input)).rejects.toThrow("semantic/link validation failed");
    expect(cleared.map((row) => row.before)).toEqual(["%PDF-private", "private-page-1", "private-page-2"]);
    expect(cleared.every((row) => row.bytes.every((byte) => byte === 0))).toBe(true);
    expect(input.docx.toString()).toBe("caller-owned-docx"); expect(deps.deleted).toHaveLength(4);
  });
  it("clears completed downloads if the second image cannot be read", async () => {
    const send = deps.send.getMockImplementation()!;
    deps.send.mockImplementation(async (command: Command) => { if (command.constructor.name === "GetObjectCommand" && String(command.input.Key).endsWith("2.png")) throw new Error("second image unavailable"); return send(command); });
    await expect(renderWithDocumentWorker(input)).rejects.toThrow("second image unavailable");
    expect(cleared.map((row) => row.before)).toEqual(["%PDF-private", "private-page-1"]);
    expect(cleared.every((row) => row.bytes.every((byte) => byte === 0))).toBe(true); expect(deps.deleted).toHaveLength(4);
  });
  it("transfers successful downloaded buffers without clearing the caller's result", async () => {
    deps.validate.mockReturnValue({ schemaVersion: "unit-cleanup-only" });
    const result = await renderWithDocumentWorker(input);
    expect(result.searchablePdf.toString()).toBe("%PDF-private"); expect(result.pageImages[1].bytes.toString()).toBe("private-page-2"); expect(cleared).toHaveLength(0);
  });
});

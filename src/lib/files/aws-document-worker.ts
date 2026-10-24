import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { pdfFontTableUsesApprovedFont } from "@/lib/documents/font-validation";
import { pdfTextBoundsAreValid } from "@/lib/documents/pdf-bounds";
import { pdfCatalogLanguageMatches, pdfStructureIsValid } from "@/lib/documents/pdf-validation";
import { normalizeRenderedDocumentText } from "@/lib/documents/text-validation";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
import type { ArtifactProvenance, DocumentMetadata } from "@/lib/documents/generate";
import type { ParserLimits } from "./secure-pipeline";
import { awsWorkloadCredentials } from "@/lib/security/aws-workload-credentials";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertAwsTemporarySubmissionOpen, createAwsTemporaryCleanupIntent } from "./aws-temporary-cleanup";

type Environment = Partial<NodeJS.ProcessEnv>;
type WorkerOperation = "extract" | "probe-document" | "render-docx";
const SHA256 = /^[0-9a-f]{64}$/i;
const VERSION_ARN = /^arn:aws:lambda:us-east-1:[0-9]{12}:function:(applypack-(staging|production)-document-worker):[1-9][0-9]*$/;
const WORKER_CONFIGURATION_NAMES = [
  "APP_DOCUMENT_WORKER_DEPLOYMENT_ENV",
  "APP_DOCUMENT_WORKER_FUNCTION_ARN",
  "APP_DOCUMENT_WORKER_BUCKET",
  "APP_DOCUMENT_WORKER_TEMPORARY_PREFIX",
  "APP_DOCUMENT_WORKER_IDENTITY",
  "APP_DOCUMENT_WORKER_FONT_SHA256",
  "APP_DOCUMENT_WORKER_FONT_MANIFEST_SHA256",
  "APP_DOCUMENT_WORKER_IMAGE_DIGEST",
  "APP_DOCUMENT_WORKER_PREFLIGHT_RECEIPT_SHA256",
  "APP_DOCUMENT_WORKER_PROBE_RECEIPT_SHA256",
  "APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256",
] as const;

export function documentWorkerConfiguration(environment: Environment = process.env) {
  const region = environment.AWS_REGION?.trim();
  const deploymentEnvironment = environment.APP_DEPLOYMENT_ENV;
  const workerDeploymentEnvironment = environment.APP_DOCUMENT_WORKER_DEPLOYMENT_ENV;
  const functionArn = environment.APP_DOCUMENT_WORKER_FUNCTION_ARN?.trim();
  const account = environment.APP_AWS_ACCOUNT_ID;
  const bucket = environment.APP_DOCUMENT_WORKER_BUCKET?.trim();
  const temporaryPrefix = environment.APP_DOCUMENT_WORKER_TEMPORARY_PREFIX;
  const identity = environment.APP_DOCUMENT_WORKER_IDENTITY?.trim();
  const fontSha256 = environment.APP_DOCUMENT_WORKER_FONT_SHA256?.trim().toLowerCase();
  const fontManifestSha256 = environment.APP_DOCUMENT_WORKER_FONT_MANIFEST_SHA256?.trim().toLowerCase();
  const imageDigest = environment.APP_DOCUMENT_WORKER_IMAGE_DIGEST?.trim().toLowerCase();
  const preflightReceiptSha256 = environment.APP_DOCUMENT_WORKER_PREFLIGHT_RECEIPT_SHA256?.trim().toLowerCase();
  const probeReceiptSha256 = environment.APP_DOCUMENT_WORKER_PROBE_RECEIPT_SHA256?.trim().toLowerCase();
  const networkAttestationSha256 = environment.APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256?.trim().toLowerCase();
  const discoveryFailed = environment.APP_RENDERER_RUNTIME_DISCOVERY_FAILED === "true";
  const functionMatch = functionArn ? VERSION_ARN.exec(functionArn) : null;
  const ready = Boolean(!discoveryFailed && region === "us-east-1"
    && ["staging", "production"].includes(deploymentEnvironment || "")
    && workerDeploymentEnvironment === deploymentEnvironment
    && account === "838445019912" && functionArn?.split(":")[4] === account
    && functionMatch?.[2] === deploymentEnvironment
    && bucket === `applypack-${account}-${deploymentEnvironment}-document-worker-temp`
    && temporaryPrefix === "ephemeral/"
    && identity === "applypack-document-worker-v2-liberation-sans-2.1.5"
    && fontSha256 === DOCUMENT_FONT_CONTRACT.styles.regular
    && fontManifestSha256 === DOCUMENT_FONT_CONTRACT.manifestSha256
    && imageDigest && SHA256.test(imageDigest)
    && preflightReceiptSha256 && SHA256.test(preflightReceiptSha256)
    && probeReceiptSha256 && SHA256.test(probeReceiptSha256)
    && networkAttestationSha256 && SHA256.test(networkAttestationSha256));
  return { region, deploymentEnvironment, workerDeploymentEnvironment, functionArn, bucket, temporaryPrefix, identity,
    fontSha256, fontManifestSha256, imageDigest, preflightReceiptSha256, probeReceiptSha256, networkAttestationSha256, ready };
}

export function documentWorkerExecutionMode(environment: Environment = process.env) {
  const configuration = documentWorkerConfiguration(environment);
  const hasWorkerConfiguration = WORKER_CONFIGURATION_NAMES.some((name) => environment[name] !== undefined);
  const hostedEnvironment = configuration.deploymentEnvironment === "staging"
    || configuration.deploymentEnvironment === "production";
  if (hasWorkerConfiguration && !hostedEnvironment) return "unavailable";
  if (hostedEnvironment) return configuration.ready ? "remote" : "unavailable";
  if (configuration.deploymentEnvironment) return "unavailable";
  return !hasWorkerConfiguration && (environment.NODE_ENV === "development" || environment.NODE_ENV === "test")
    ? "local"
    : "unavailable";
}

export function workerResponseAttestationMatches(
  configuration: ReturnType<typeof documentWorkerConfiguration>,
  response: Record<string, unknown>,
) {
  return Boolean(configuration.ready
    && response.identity === configuration.identity
    && response.ok === true
    && response.deploymentEnvironment === configuration.workerDeploymentEnvironment
    && response.functionVersionArn === configuration.functionArn
    && response.imageDigest === configuration.imageDigest
    && response.networkIsolationVerified === true);
}

function boundedLimits(limits?: ParserLimits) {
  return {
    maxExpandedBytes: Math.min(limits?.maxExpandedBytes ?? 52_428_800, 52_428_800),
    maxPages: Math.min(limits?.maxPages ?? 40, 40),
    maxMilliseconds: Math.min(limits?.maxMilliseconds ?? 30_000, 30_000),
    maxMemoryBytes: Math.min(limits?.maxMemoryBytes ?? 536_870_912, 536_870_912),
  };
}

async function invokeWorker(input: {
  operation: WorkerOperation;
  bytes: Buffer;
  mimeType: string;
  limits?: ParserLimits;
  environment?: Environment;
  payload?: Record<string, unknown>;
}) {
  const environment = input.environment ?? process.env;
  const configuration = documentWorkerConfiguration(environment);
  if (!configuration.ready) throw new Error("document_worker_not_configured");
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 10 * 1024 * 1024) throw new Error("document_worker_input_bound");
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("aws_temporary_cleanup_not_configured");
  const intent = await createAwsTemporaryCleanupIntent(admin, randomUUID(), environment);
  const key = intent.keys[0];
  const outputPdfKey = `${key}.render.pdf`;
  const outputImageKeys = [`${key}.page-1.png`, `${key}.page-2.png`];
  if (configuration.functionArn!.split(":")[4] !== environment.APP_AWS_ACCOUNT_ID) {
    throw new Error("document_worker_account_binding_invalid");
  }
  const credentials = awsWorkloadCredentials(environment);
  const s3 = new S3Client({ region: configuration.region!, endpoint: "https://s3.us-east-1.amazonaws.com", credentials, maxAttempts: 2 });
  const lambda = new LambdaClient({ region: configuration.region!, endpoint: "https://lambda.us-east-1.amazonaws.com", credentials, maxAttempts: 2 });
  try {
    await credentials();
    assertAwsTemporarySubmissionOpen(intent);
    await s3.send(new PutObjectCommand({
      Bucket: configuration.bucket!, Key: key, Body: input.bytes,
      ContentType: input.mimeType, ServerSideEncryption: "AES256",
      Metadata: { purpose: "document-worker" },
    }), { abortSignal: AbortSignal.timeout(15_000) });
    assertAwsTemporarySubmissionOpen(intent);
    const response = await lambda.send(new InvokeCommand({
      FunctionName: configuration.functionArn!, InvocationType: "RequestResponse", LogType: "None",
      Payload: Buffer.from(JSON.stringify({
        schemaVersion: 1, operation: input.operation, bucket: configuration.bucket, key,
        mimeType: input.mimeType, limits: boundedLimits(input.limits), ...input.payload,
      }), "utf8"),
    }), { abortSignal: AbortSignal.timeout(35_000) });
    if (response.FunctionError || !response.Payload?.byteLength || response.Payload.byteLength > 3 * 1024 * 1024) {
      throw new Error("document_worker_failed");
    }
    const body = JSON.parse(Buffer.from(response.Payload).toString("utf8")) as Record<string, unknown>;
    if (!workerResponseAttestationMatches(configuration, body)) throw new Error("document_worker_response_invalid");
    if (input.operation === "render-docx") {
      const pageCount = Number(body.pageCount);
      if (pageCount !== 1 && pageCount !== 2) throw new Error("document_worker_response_invalid");
      body.pdfBytes = await readObject(s3, configuration.bucket!, outputPdfKey);
      body.pageImages = await Promise.all(outputImageKeys.slice(0, pageCount)
        .map((outputKey) => readObject(s3, configuration.bucket!, outputKey)));
    }
    return body;
  } finally {
    // Keep every durable intent for a delayed second deletion, including after
    // immediate success: a timed-out remote writer may finish after this process.
    await Promise.allSettled(intent.keys.map((objectKey) =>
      s3.send(new DeleteObjectCommand({ Bucket: configuration.bucket!, Key: objectKey }), {
        abortSignal: AbortSignal.timeout(15_000),
      })));
    s3.destroy();
    lambda.destroy();
  }
}

async function readObject(s3: S3Client, bucket: string, key: string) {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
    abortSignal: AbortSignal.timeout(15_000),
  });
  if (!result.Body) throw new Error("document_worker_output_missing");
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("document_worker_output_bound");
  return bytes;
}

export async function extractWithDocumentWorker(bytes: Buffer, mimeType: string, limits?: ParserLimits) {
  const result = await invokeWorker({ operation: "extract", bytes, mimeType, limits });
  if (typeof result.text !== "string" || !["MEASURED", "UNKNOWN"].includes(String(result.paginationStatus))) {
    throw new Error("document_worker_response_invalid");
  }
  return {
    text: result.text,
    pageCount: typeof result.pageCount === "number" ? result.pageCount : null,
    paginationStatus: result.paginationStatus as "MEASURED" | "UNKNOWN",
    reference: "isolated-extractor-v1",
  };
}

export async function renderWithDocumentWorker(input: {
  docx: Buffer;
  expectedPages: 1 | 2;
  expectedExtractedTextSha256: string;
  artifactType: ArtifactProvenance["artifact"];
  expectedMetadata: DocumentMetadata;
}) {
  const configuration = documentWorkerConfiguration();
  const result = await invokeWorker({
    operation: "render-docx",
    bytes: input.docx,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    limits: { maxExpandedBytes: 52_428_800, maxPages: 2, maxMilliseconds: 30_000, maxMemoryBytes: 536_870_912 },
    payload: { expectedPages: input.expectedPages, artifactType: input.artifactType },
  });
  const pageCount = Number(result.pageCount);
  const pdf = Buffer.isBuffer(result.pdfBytes) ? result.pdfBytes : null;
  const images = Array.isArray(result.pageImages) && result.pageImages.every(Buffer.isBuffer)
    ? result.pageImages as Buffer[] : null;
  const pdfInfo = stringField(result, "pdfInfo");
  const pdfMetadata = stringField(result, "pdfMetadata");
  const structureTree = stringField(result, "structureTree");
  const boundingXml = stringField(result, "boundingXml");
  const fontInfo = stringField(result, "fontInfo");
  const extractedText = stringField(result, "extractedText");
  const fontSha256 = stringField(result, "documentFontSha256").toLowerCase();
  const fontFamily = stringField(result, "documentFontFamily");
  const fontVersion = stringField(result, "documentFontVersion");
  const fontManifestSha256 = stringField(result, "documentFontManifestSha256").toLowerCase();
  const fontStyleSha256 = result.documentFontStyleSha256;
  if (!pdf || !images || pageCount !== input.expectedPages || images.length !== pageCount
    || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || result.networkIsolationVerified !== true
    || result.functionVersionArn !== configuration.functionArn
    || result.imageDigest !== configuration.imageDigest
    || fontSha256 !== configuration.fontSha256
    || fontFamily !== DOCUMENT_FONT_CONTRACT.family
    || fontVersion !== DOCUMENT_FONT_CONTRACT.version
    || fontManifestSha256 !== configuration.fontManifestSha256
    || JSON.stringify(fontStyleSha256) !== JSON.stringify(DOCUMENT_FONT_CONTRACT.styles)
    || !pdfFontTableUsesApprovedFont(fontInfo)
    || !pdfTextBoundsAreValid(boundingXml, pageCount)
    || !pdfStructureIsValid(structureTree, input.artifactType)) {
    throw new Error("document_worker_render_validation_failed");
  }
  assertPdfMetadata(pdfInfo, input.expectedMetadata);
  if (!new RegExp(`(?:>|\\b)${escapeRegExp(input.expectedMetadata.language)}(?:<|\\b)`, "i").test(pdfMetadata)
    && !pdfCatalogLanguageMatches(pdf, input.expectedMetadata.language)) {
    throw new Error("rendered_pdf_language_metadata_invalid");
  }
  const extractedTextSha256 = hash(Buffer.from(normalizeRenderedDocumentText(extractedText), "utf8"));
  if (!extractedText.trim() || extractedTextSha256 !== input.expectedExtractedTextSha256) {
    throw new Error("rendered_text_not_equivalent");
  }
  return {
    rendererIdentity: configuration.identity!,
    documentFontFamily: DOCUMENT_FONT_CONTRACT.family,
    documentFontVersion: DOCUMENT_FONT_CONTRACT.version,
    documentFontManifestSha256: DOCUMENT_FONT_CONTRACT.manifestSha256,
    documentFontSha256: fontSha256,
    documentFontStyleSha256: DOCUMENT_FONT_CONTRACT.styles,
    pageCount: pageCount as 1 | 2,
    documentFontResolved: true as const,
    extractedTextSha256,
    pageImages: images.map((bytes) => ({ bytes, sha256: hash(bytes) })),
    taggedPdf: true as const,
    metadataVerified: true as const,
    structureTreeSha256: hash(Buffer.from(structureTree, "utf8")),
    searchablePdf: pdf,
    searchablePdfSha256: hash(pdf),
  };
}

let probeCache: { key: string; expires: number; pending: Promise<boolean> } | null = null;

export async function probeDocumentWorker() {
  const environment = { ...process.env };
  const configuration = documentWorkerConfiguration(environment);
  if (!configuration.ready) return false;
  // Both parser and renderer readiness share one probe. Include credential
  // material in the in-memory hash so rotation or invalid ambient AWS inputs
  // cannot reuse a result from a different identity. Never persist this hash.
  const identity = Object.fromEntries(Object.entries(environment)
    .filter(([name]) => /^(AWS_|APP_AWS_)/.test(name) || name === "NODE_TLS_REJECT_UNAUTHORIZED")
    .sort(([left], [right]) => left.localeCompare(right)));
  const key = hash(Buffer.from(JSON.stringify({ configuration, identity,
    release: environment.RAILWAY_GIT_COMMIT_SHA || environment.APP_RELEASE_SHA,
    expectedRelease: environment.APP_EXPECTED_RELEASE_SHA,
    database: environment.NEXT_PUBLIC_SUPABASE_URL,
  })));
  if (probeCache?.key === key && probeCache.expires > Date.now()) return probeCache.pending;
  // Cache failures too: an outage must not create an unbounded cleanup backlog.
  // Database approval/revocation checks remain uncached in renderer readiness.
  const pending = performDocumentWorkerProbe(environment).catch(() => false);
  probeCache = { key, expires: Date.now() + 5 * 60_000, pending };
  return pending;
}

async function performDocumentWorkerProbe(environment: Environment) {
  const token = "ApplyPack synthetic extraction and render probe";
  const probe = await Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun(token)] })] }],
  }));
  const result = await invokeWorker({
    operation: "probe-document",
    environment,
    bytes: probe,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    limits: { maxExpandedBytes: 2_097_152, maxPages: 2, maxMilliseconds: 30_000, maxMemoryBytes: 536_870_912 },
  });
  const configuration = documentWorkerConfiguration(environment);
  return result.renderedPdfHeader === "%PDF-" && result.networkIsolationVerified === true
    && result.docxExtractionVerified === true && result.renderedTextVerified === true
    && Number(result.pageCount) >= 1 && Number(result.pageCount) <= 2
    && result.functionVersionArn === configuration.functionArn
    && result.imageDigest === configuration.imageDigest
    && result.documentFontSha256 === configuration.fontSha256
    && result.documentFontFamily === DOCUMENT_FONT_CONTRACT.family
    && result.documentFontVersion === DOCUMENT_FONT_CONTRACT.version
    && result.documentFontManifestSha256 === configuration.fontManifestSha256
    && JSON.stringify(result.documentFontStyleSha256) === JSON.stringify(DOCUMENT_FONT_CONTRACT.styles);
}

function stringField(value: Record<string, unknown>, key: string) {
  const field = value[key];
  if (typeof field !== "string" || Buffer.byteLength(field, "utf8") > 2 * 1024 * 1024) {
    throw new Error("document_worker_response_invalid");
  }
  return field;
}

function pdfInfoValue(output: string, label: string) {
  return output.match(new RegExp(`^${escapeRegExp(label)}:\\s*(.*?)\\s*$`, "im"))?.[1]?.trim() || "";
}

function assertPdfMetadata(output: string, expected: DocumentMetadata) {
  if (pdfInfoValue(output, "Title") !== expected.title
    || pdfInfoValue(output, "Author") !== expected.author
    || pdfInfoValue(output, "Subject") !== expected.subject
    || pdfInfoValue(output, "Keywords") !== expected.keywords) {
    throw new Error("rendered_pdf_metadata_invalid");
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hash(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

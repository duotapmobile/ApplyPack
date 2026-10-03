import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { pdfFontTableUsesApprovedFont } from "@/lib/documents/font-validation";
import { pdfTextBoundsAreValid } from "@/lib/documents/pdf-bounds";
import { pdfCatalogLanguageMatches, pdfStructureIsValid } from "@/lib/documents/pdf-validation";
import { normalizeRenderedDocumentText } from "@/lib/documents/text-validation";
import type { ArtifactProvenance, DocumentMetadata } from "@/lib/documents/generate";
import type { ParserLimits } from "./secure-pipeline";

type Environment = Partial<NodeJS.ProcessEnv>;
type WorkerOperation = "extract" | "probe-document" | "render-docx";
const SHA256 = /^[0-9a-f]{64}$/i;
const VERSION_ARN = /^arn:aws:lambda:us-east-1:[0-9]{12}:function:[A-Za-z0-9-_]+:[1-9][0-9]*$/;

export function documentWorkerConfiguration(environment: Environment = process.env) {
  const region = environment.AWS_REGION?.trim();
  const functionArn = environment.APP_DOCUMENT_WORKER_FUNCTION_ARN?.trim();
  const bucket = environment.APP_DOCUMENT_WORKER_BUCKET?.trim();
  const identity = environment.APP_DOCUMENT_WORKER_IDENTITY?.trim();
  const fontSha256 = environment.APP_DOCUMENT_WORKER_FONT_SHA256?.trim().toLowerCase();
  const imageDigest = environment.APP_DOCUMENT_WORKER_IMAGE_DIGEST?.trim().toLowerCase();
  const networkAttestationSha256 = environment.APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256?.trim().toLowerCase();
  const ready = Boolean(region === "us-east-1" && functionArn && VERSION_ARN.test(functionArn) && bucket
    && identity === "applypack-document-worker-v1" && fontSha256 && SHA256.test(fontSha256)
    && imageDigest && SHA256.test(imageDigest) && networkAttestationSha256 && SHA256.test(networkAttestationSha256));
  return { region, functionArn, bucket, identity, fontSha256, imageDigest, networkAttestationSha256, ready };
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
  const configuration = documentWorkerConfiguration(input.environment);
  if (!configuration.ready) throw new Error("document_worker_not_configured");
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 10 * 1024 * 1024) throw new Error("document_worker_input_bound");
  const key = `ephemeral/${randomUUID()}`;
  const outputPdfKey = `${key}.render.pdf`;
  const outputImageKeys = [`${key}.page-1.png`, `${key}.page-2.png`];
  const s3 = new S3Client({ region: configuration.region!, maxAttempts: 2 });
  const lambda = new LambdaClient({ region: configuration.region!, maxAttempts: 2 });
  try {
    await s3.send(new PutObjectCommand({
      Bucket: configuration.bucket!, Key: key, Body: input.bytes,
      ContentType: input.mimeType, ServerSideEncryption: "AES256",
      Metadata: { purpose: "document-worker" },
    }), { abortSignal: AbortSignal.timeout(15_000) });
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
    if (body.identity !== configuration.identity || body.ok !== true
      || body.functionVersionArn !== configuration.functionArn
      || body.imageDigest !== configuration.imageDigest
      || body.networkIsolationVerified !== true) throw new Error("document_worker_response_invalid");
    if (input.operation === "render-docx") {
      const pageCount = Number(body.pageCount);
      if (pageCount !== 1 && pageCount !== 2) throw new Error("document_worker_response_invalid");
      body.pdfBytes = await readObject(s3, configuration.bucket!, outputPdfKey);
      body.pageImages = await Promise.all(outputImageKeys.slice(0, pageCount)
        .map((outputKey) => readObject(s3, configuration.bucket!, outputKey)));
    }
    return body;
  } finally {
    await Promise.all([key, outputPdfKey, ...outputImageKeys].map((objectKey) =>
      s3.send(new DeleteObjectCommand({ Bucket: configuration.bucket!, Key: objectKey })).catch(() => undefined)));
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
  if (!pdf || !images || pageCount !== input.expectedPages || images.length !== pageCount
    || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || result.networkIsolationVerified !== true
    || result.functionVersionArn !== configuration.functionArn
    || result.imageDigest !== configuration.imageDigest
    || fontSha256 !== configuration.fontSha256
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
    documentFontSha256: fontSha256,
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

export async function probeDocumentWorker() {
  const token = "ApplyPack synthetic extraction and render probe";
  const probe = await Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun(token)] })] }],
  }));
  const result = await invokeWorker({
    operation: "probe-document",
    bytes: probe,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    limits: { maxExpandedBytes: 2_097_152, maxPages: 2, maxMilliseconds: 30_000, maxMemoryBytes: 536_870_912 },
  });
  const configuration = documentWorkerConfiguration();
  return result.renderedPdfHeader === "%PDF-" && result.networkIsolationVerified === true
    && result.docxExtractionVerified === true && result.renderedTextVerified === true
    && Number(result.pageCount) >= 1 && Number(result.pageCount) <= 2
    && result.functionVersionArn === configuration.functionArn
    && result.imageDigest === configuration.imageDigest
    && result.documentFontSha256 === configuration.fontSha256;
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

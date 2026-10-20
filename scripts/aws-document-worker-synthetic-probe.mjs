import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { sanitizedIdentity, writeCanonicalReceipt } from "./lib/canonical-receipt.mjs";

const REGION = "us-east-1";
const TOKEN = "ApplyPack synthetic extraction and render probe";
const IDENTITY = "applypack-document-worker-v2-liberation-sans-2.1.5";
const FONT_MANIFEST = "d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb";
const FONT_REGULAR = "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("probe_arguments_invalid");
    options[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return options;
}

function runAws(args) {
  return spawnSync("aws", [...args, "--region", REGION, "--output", "json", "--no-cli-pager"], {
    encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
}

function awsJson(args, allowFailure = false) {
  const result = runAws(args);
  if (result.status !== 0) {
    if (allowFailure) return null;
    throw new Error(`aws_probe_failed:${args[0]}:${args[1]}`);
  }
  try { return result.stdout.trim() ? JSON.parse(result.stdout) : {}; }
  catch { throw new Error(`aws_probe_json_invalid:${args[0]}:${args[1]}`); }
}

export function expectedCrossEnvironmentKmsDenial(result) {
  if (!result || result.error || result.signal || !Number.isInteger(result.status) || result.status === 0
    || typeof result.stderr !== "string") {
    throw new Error("kms_cross_environment_denial_not_proven");
  }
  const match = result.stderr.trim().match(
    /^An error occurred \((AccessDeniedException|InvalidCiphertextException)\) when calling the Decrypt operation: [^\r\n]+$/,
  );
  if (!match) throw new Error("kms_cross_environment_denial_unexpected");
  return match[1];
}

function invoke(functionArn, payload, directory, name) {
  const payloadPath = join(directory, `${name}-request.json`);
  const responsePath = join(directory, `${name}-response.json`);
  writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", flag: "wx" });
  const invocation = awsJson(["lambda", "invoke", "--function-name", functionArn, "--invocation-type", "RequestResponse",
    "--log-type", "None", "--cli-binary-format", "raw-in-base64-out", "--payload", `fileb://${payloadPath}`, responsePath]);
  if (invocation.FunctionError) throw new Error(`worker_probe_function_error:${name}`);
  const bytes = readFileSync(responsePath);
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new Error(`worker_probe_response_bound:${name}`);
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`worker_probe_response_invalid:${name}`); }
}

function assertAttestation(response, options) {
  if (response.ok !== true || response.identity !== IDENTITY || response.deploymentEnvironment !== options.environment
    || response.functionVersionArn !== options.functionVersionArn || response.imageDigest !== options.imageDigest
    || response.networkIsolationVerified !== true) throw new Error("worker_probe_attestation_mismatch");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!new Set(["staging", "production"]).has(options.environment)
    || !/^arn:aws:lambda:us-east-1:\d{12}:function:applypack-(staging|production)-document-worker:[1-9]\d*$/.test(options.functionVersionArn || "")
    || !/^arn:aws:kms:us-east-1:\d{12}:key\/[A-Za-z0-9-]+$/.test(options.kmsKeyArn || "")
    || !/^[A-Za-z0-9._:-]{1,64}$/.test(options.kmsKeyVersion || "")
    || !/^[a-z0-9.-]{3,63}$/.test(options.bucket || "") || !/^[0-9a-f]{64}$/.test(options.imageDigest || "")
    || !/^[0-9a-f]{64}$/.test(options.preflightReceiptSha256 || "") || !/^[0-9a-f]{40}$/.test(options.sourceCommitSha || "")
    || !options.outputDirectory || !options.functionVersionArn.includes(`:applypack-${options.environment}-document-worker:`)) {
    throw new Error("probe_required_arguments_invalid");
  }
  const work = mkdtempSync(join(tmpdir(), "applypack-aws-worker-probe-"));
  const key = `ephemeral/synthetic-probe-${randomUUID()}`;
  const keys = [key, `${key}.render.pdf`, `${key}.page-1.png`, `${key}.page-2.png`];
  let receipt;
  let cleanupComplete = false;
  try {
    const docx = await Packer.toBuffer(new Document({
      sections: [{ children: [
        new Paragraph({ children: [new TextRun({ text: "Synthetic Candidate", bold: true })] }),
        new Paragraph({ children: [new TextRun("Synthetic operations record. No customer data.")] }),
        new Paragraph({ children: [new TextRun(TOKEN)] }),
      ] }],
    }));
    const sourcePath = join(work, "synthetic.docx");
    writeFileSync(sourcePath, docx, { flag: "wx" });
    awsJson(["s3api", "put-object", "--bucket", options.bucket, "--key", key, "--body", sourcePath,
      "--content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "--server-side-encryption", "AES256", "--metadata", "purpose=applypack-synthetic-probe"]);
    const common = {
      schemaVersion: 1, bucket: options.bucket, key,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      limits: { maxExpandedBytes: 2_097_152, maxPages: 2, maxMilliseconds: 30_000, maxMemoryBytes: 536_870_912 },
    };
    const extracted = invoke(options.functionVersionArn, { ...common, operation: "extract" }, work, "extract");
    assertAttestation(extracted, options);
    if (typeof extracted.text !== "string" || !extracted.text.includes(TOKEN) || extracted.paginationStatus !== "UNKNOWN") {
      throw new Error("worker_extraction_probe_failed");
    }
    const probed = invoke(options.functionVersionArn, { ...common, operation: "probe-document" }, work, "probe");
    assertAttestation(probed, options);
    if (probed.docxExtractionVerified !== true || probed.renderedTextVerified !== true
      || probed.renderedPdfHeader !== "%PDF-" || probed.documentFontManifestSha256 !== FONT_MANIFEST
      || probed.documentFontSha256 !== FONT_REGULAR) throw new Error("worker_network_render_probe_failed");
    const rendered = invoke(options.functionVersionArn,
      { ...common, operation: "render-docx", expectedPages: 1, artifactType: "RESUME" }, work, "render");
    assertAttestation(rendered, options);
    if (rendered.pageCount !== 1 || rendered.documentFontManifestSha256 !== FONT_MANIFEST
      || rendered.documentFontSha256 !== FONT_REGULAR || typeof rendered.extractedText !== "string"
      || !rendered.extractedText.includes(TOKEN)) throw new Error("worker_render_probe_failed");
    const pdfPath = join(work, "render.pdf");
    const pngPath = join(work, "page-1.png");
    awsJson(["s3api", "get-object", "--bucket", options.bucket, "--key", `${key}.render.pdf`, pdfPath]);
    awsJson(["s3api", "get-object", "--bucket", options.bucket, "--key", `${key}.page-1.png`, pngPath]);
    if (!readFileSync(pdfPath).subarray(0, 5).equals(Buffer.from("%PDF-"))
      || !readFileSync(pngPath).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
      throw new Error("worker_render_object_probe_failed");
    }
    const context = `application=ApplyPack,deployment=${options.environment},keyVersion=${options.kmsKeyVersion}`;
    const wrongEnvironment = options.environment === "staging" ? "production" : "staging";
    const plaintextPath = join(work, "kms-plaintext.bin");
    const ciphertextPath = join(work, "kms-ciphertext.bin");
    const plaintext = Buffer.from("ApplyPack synthetic KMS probe; no customer data.", "utf8");
    writeFileSync(plaintextPath, plaintext, { flag: "wx" });
    const encrypted = awsJson(["kms", "encrypt", "--key-id", options.kmsKeyArn, "--plaintext", `fileb://${plaintextPath}`,
      "--encryption-context", context]);
    if (typeof encrypted.CiphertextBlob !== "string") throw new Error("kms_encrypt_probe_failed");
    writeFileSync(ciphertextPath, Buffer.from(encrypted.CiphertextBlob, "base64"), { flag: "wx" });
    const decrypted = awsJson(["kms", "decrypt", "--key-id", options.kmsKeyArn,
      "--ciphertext-blob", `fileb://${ciphertextPath}`, "--encryption-context", context]);
    if (typeof decrypted.Plaintext !== "string" || !Buffer.from(decrypted.Plaintext, "base64").equals(plaintext)) {
      throw new Error("kms_decrypt_probe_failed");
    }
    const crossEnvironmentDenialCode = expectedCrossEnvironmentKmsDenial(runAws(["kms", "decrypt", "--key-id", options.kmsKeyArn,
      "--ciphertext-blob", `fileb://${ciphertextPath}`, "--encryption-context",
      `application=ApplyPack,deployment=${wrongEnvironment},keyVersion=${options.kmsKeyVersion}`]));
    receipt = {
      schema: "applypack.aws-document-worker-synthetic-probe.v1",
      checkedAt: new Date().toISOString(),
      environment: options.environment,
      region: REGION,
      sourceCommitSha: options.sourceCommitSha,
      preflightReceiptSha256: options.preflightReceiptSha256,
      identities: {
        bucketIdentitySha256: sanitizedIdentity(options.bucket),
        functionVersionIdentitySha256: sanitizedIdentity(options.functionVersionArn),
        kmsKeyIdentitySha256: sanitizedIdentity(options.kmsKeyArn),
      },
      worker: { identity: IDENTITY, imageDigest: options.imageDigest, fontManifestSha256: FONT_MANIFEST },
      checks: {
        syntheticUpload: true,
        extraction: true,
        render: true,
        exactFontManifest: true,
        immutableFunctionVersion: true,
        networkIsolation: true,
        kmsRoundTrip: true,
        kmsCrossEnvironmentDenied: true,
        kmsCrossEnvironmentDenialCode: crossEnvironmentDenialCode,
      },
    };
  } finally {
    const cleanup = keys.map((objectKey) => awsJson(["s3api", "delete-object", "--bucket", options.bucket, "--key", objectKey], true));
    cleanupComplete = cleanup.every(Boolean);
    rmSync(work, { recursive: true, force: true });
  }
  if (!receipt || !cleanupComplete) throw new Error("synthetic_probe_cleanup_failed");
  receipt.checks.cleanupComplete = true;
  const written = writeCanonicalReceipt(options.outputDirectory,
    `aws-document-worker-synthetic-probe-${options.environment}`, receipt);
  process.stdout.write(`PROBE_RECEIPT_SHA256=${written.digest}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "probe_failed"}\n`); process.exitCode = 1; });
}

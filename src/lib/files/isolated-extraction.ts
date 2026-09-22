import "server-only";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipelineConfiguration, runSecureDocumentPipeline, type ParserLimits } from "./secure-pipeline";
import { validateDocumentBytes } from "./document-safety";

let activeExtractions = 0;
type IsolationFailureCode = "unsupported_platform" | "source_unavailable" | "executable_unavailable" | "namespace_or_permission_denied" | "timeout" | "malformed_output" | "process_exit" | "processing_busy" | "probe_failed";
class IsolationFailure extends Error {
  constructor(readonly reason: IsolationFailureCode) { super("isolated_document_processing_failed"); }
}
function processFailureReason(stderr: Buffer, errorCode?: string): IsolationFailureCode {
  if (errorCode === "ENOENT") return "executable_unavailable";
  if (errorCode === "EACCES" || errorCode === "EPERM") return "namespace_or_permission_denied";
  // Only classify known launcher diagnostics. Never retain or expose their text.
  const diagnostic = stderr.toString("utf8");
  if (/^(?:bwrap|prlimit):[^\r\n]*(?:Operation not permitted|Permission denied|No permissions to create new namespace|Creating new namespace failed)/im.test(diagnostic)) return "namespace_or_permission_denied";
  if (/^(?:bwrap|prlimit):[^\r\n]*(?:exec|execute)[^\r\n]*No such file or directory/im.test(diagnostic)) return "executable_unavailable";
  return "process_exit";
}
export const STRUCTURAL_POLICY = "isolated-structural-v1";
export async function extractIsolatedDocument(bytes: Buffer, mimeType: string, limits?: ParserLimits) {
  if (bytes.length > 10 * 1024 * 1024 || !validateDocumentBytes(bytes, mimeType).safe) throw new Error("document_structure_rejected");
  if (process.platform !== "linux") throw new IsolationFailure("unsupported_platform");
  // Only the interpreter/system libraries are exposed. No application files, keys,
  // home directory, sockets or network namespace are inherited.
  const script = await readFile(join(process.cwd(), "src/lib/files/isolated-extract.py"), "utf8").catch(() => { throw new IsolationFailure("source_unavailable"); });
  const memory = Math.min(limits?.maxMemoryBytes || 536870912, 536870912);
  const milliseconds = Math.min(limits?.maxMilliseconds || 30000, 30000);
  const maxExpandedBytes = Math.min(limits?.maxExpandedBytes ?? 52428800, 52428800);
  const maxPages = Math.min(limits?.maxPages ?? 40, 40);
  if (!Number.isSafeInteger(maxExpandedBytes) || maxExpandedBytes < 1 || !Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error("invalid_parser_limits");
  const args = [`--as=${memory}`, `--cpu=${Math.max(1, Math.ceil(milliseconds / 1000))}`, "--fsize=52428800", "--nproc=32", "--", "/usr/bin/bwrap",
    "--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--setenv", "PATH", "/usr/bin",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind-try", "/lib64", "/lib64",
    "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--chdir", "/tmp", "/usr/bin/python3", "-I", "-c", script, JSON.stringify({ maxExpandedBytes, maxPages })];
  if (activeExtractions >= 2) throw new IsolationFailure("processing_busy");
  activeExtractions++;
  return new Promise<{ text: string; pageCount: number | null; paginationStatus: "MEASURED" | "UNKNOWN"; reference: string }>((resolve, reject) => {
    const child = spawn("/usr/bin/prlimit", args, { stdio: ["pipe", "pipe", "pipe"], env: { NODE_ENV: "production" }, detached: true });
    const chunks: Buffer[] = []; let count = 0; let failed = false;
    let stderr = Buffer.alloc(0);
    const fail = (reason: IsolationFailureCode) => { if (failed) return; failed = true; try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {} reject(new IsolationFailure(reason)); };
    const timeout = setTimeout(() => fail("timeout"), milliseconds);
    child.on("error", (error: NodeJS.ErrnoException) => { clearTimeout(timeout); fail(processFailureReason(stderr, error.code)); });
    child.stdin.on("error", () => { /* Wait for close/error/timeout to classify the launcher failure. */ });
    child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 4096) stderr = Buffer.concat([stderr, chunk.subarray(0, 4096 - stderr.length)]); });
    child.stdout.on("data", (chunk: Buffer) => { count += chunk.length; if (count > 3 * 1024 * 1024) fail("malformed_output"); else chunks.push(chunk); });
    child.on("close", (code) => { clearTimeout(timeout); if (failed) return; if (code !== 0) return fail(processFailureReason(stderr));
      try { const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const validPages = mimeType === "application/pdf"
          ? Number.isInteger(result.pageCount) && result.pageCount >= 1 && result.pageCount <= maxPages && result.paginationStatus === "MEASURED"
          : result.pageCount === null && result.paginationStatus === "UNKNOWN";
        if (typeof result.text !== "string" || Buffer.byteLength(result.text) > Math.min(maxExpandedBytes, 2097152) || !validPages || result.reference !== "isolated-extractor-v1") return fail("malformed_output");
        resolve(result);
      } catch { fail("malformed_output"); }
    });
    child.stdin.end(bytes);
  }).finally(() => { activeExtractions--; });
}
export async function processSourceForReview(bytes: Buffer, mimeType: string) {
  const configuration = pipelineConfiguration();
  return runSecureDocumentPipeline(bytes, { ...configuration, safetyPolicy: STRUCTURAL_POLICY }, {
    malwareScan: async () => ({ verdict: "NOT_SCANNED", reference: null }),
    parseLocally: async (_bytes, limits) => extractIsolatedDocument(bytes, mimeType, limits),
  });
}

export async function persistAnonymousDocumentReview(admin: import("@supabase/supabase-js").SupabaseClient, draftId: string, documentId: string, bytes: Buffer, mimeType: string) {
  const result = await processSourceForReview(bytes, mimeType).catch(() => null);
  if (!result || result.errorCode || result.stage !== "OPERATOR_REVIEW" || !result.modelInput) {
    await admin.from("ap_document_versions").update({ processing_state: "FAILED", failure_code: "isolated_processing_unavailable_or_rejected" }).eq("id", documentId).eq("draft_id", draftId).eq("is_current", true);
    return false;
  }
  const lines = result.modelInput.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 200 || lines.some((line) => line.length > 2000)) {
    await admin.from("ap_document_versions").update({ processing_state: "FAILED", failure_code: "document_review_bounds_exceeded" }).eq("id", documentId).eq("draft_id", draftId).eq("is_current", true);
    return false;
  }
  const { error } = await admin.rpc("ap_record_isolated_document_review", { p_draft_id: draftId, p_document_id: documentId,
    p_sha256: result.sha256, p_parser_identity: result.parserReference, p_lines: lines });
  return !error;
}

let isolationProbe: { at: number; ready: boolean } | null = null;
let probeInFlight: Promise<boolean> | null = null;
export async function probeDocumentIsolation(): Promise<boolean> {
  if (probeInFlight) return probeInFlight;
  probeInFlight = runIsolationProbe().finally(() => { probeInFlight = null; });
  return probeInFlight;
}
async function runIsolationProbe(): Promise<boolean> {
  if (isolationProbe && Date.now() - isolationProbe.at < 60_000) return isolationProbe.ready;
  let ready = false;
  let reason: IsolationFailureCode = "probe_failed";
  try {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
    zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Isolation probe</w:t></w:r></w:p></w:body></w:document>');
    const result = await extractIsolatedDocument(await zip.generateAsync({ type: "nodebuffer" }), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", {
      maxMilliseconds: 5000, maxExpandedBytes: 2097152, maxPages: 40, maxMemoryBytes: 536870912,
    });
    ready = result.text.trim() === "Isolation probe";
    if (!ready) reason = "malformed_output";
  } catch (error) { ready = false; if (error instanceof IsolationFailure) reason = error.reason; }
  if (!ready) console.warn("document_isolation_probe_failed", { reason });
  isolationProbe = { at: Date.now(), ready }; return ready;
}

export async function processPendingDocumentExtractions(admin: import("@supabase/supabase-js").SupabaseClient, limit = 2) {
  if (!pipelineConfiguration().enabled) return { processed: 0, succeeded: 0 };
  const claimed = await admin.rpc("ap_claim_document_processing", { p_limit: Math.min(2, Math.max(1, limit)) });
  if (claimed.error) throw new Error("document_processing_claim_failed");
  let succeeded = 0;
  for (const job of claimed.data || []) {
    let success = false;
    try {
      const source = await admin.storage.from("customer-source-documents").download(job.storage_path);
      if (source.data && source.data.size <= 10 * 1024 * 1024) success = await persistAnonymousDocumentReview(admin, job.draft_id, job.document_id, Buffer.from(await source.data.arrayBuffer()), job.verified_mime_type);
    } catch { success = false; }
    const completed = await admin.rpc("ap_complete_document_processing", { p_document_id: job.document_id, p_lease_token: job.lease_token, p_succeeded: success });
    if (completed.error) throw new Error("document_processing_completion_failed");
    if (success) succeeded++;
  }
  return { processed: (claimed.data || []).length, succeeded };
}

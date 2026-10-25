// @vitest-environment node
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), list: vi.fn(), remove: vi.fn(), execute: vi.fn(), validate: vi.fn(), work: "" }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({ readFile: deps.read, writeFile: deps.write, readdir: deps.list, rm: deps.remove, mkdtemp: async () => deps.work }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const execFile = Object.assign(() => undefined, {
    [promisify.custom]: async (path: string, args: string[]) => ({ stdout: deps.execute(path, args), stderr: "" }),
  });
  return { execFile };
});
// These doubles isolate allocation/cleanup. Real font and PDF proof remains the
// actual render suite; no mocked success is represented as that proof.
vi.mock("@/lib/documents/requirements", async (original) => {
  const actual = await original<typeof import("@/lib/documents/requirements")>();
  const digest = (await import("node:crypto")).createHash("sha256").update("tool").digest("hex");
  return { ...actual, DOCUMENT_FONT_CONTRACT: { ...actual.DOCUMENT_FONT_CONTRACT, styles: { regular: digest, bold: digest, italic: digest, boldItalic: digest } } };
});
vi.mock("@/lib/documents/pdf-bounds", () => ({ pdfTextBoundsAreValid: () => true }));
vi.mock("@/lib/documents/font-validation", () => ({ pdfFontTableUsesApprovedFont: () => true }));
vi.mock("@/lib/documents/draft-pdf-validation", () => ({ assertDraftPdfExpectation: () => undefined, validateDraftPdfEvidence: deps.validate }));
import { renderDocumentLocallyForQa, type DocumentRenderInput } from "@/lib/documents/renderer";
import { DOCUMENT_FONT_CONTRACT } from "@/lib/documents/requirements";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("new-profile local render private buffer ownership", () => {
  let buffers: Buffer[], input: DocumentRenderInput, stem: string, pages: number;
  beforeEach(() => {
    vi.clearAllMocks(); buffers = []; pages = 1; stem = ""; deps.work = join(tmpdir(), "applypack-render-owned-test");
    for (const name of ["APP_LIBREOFFICE_EXECUTABLE", "APP_PDFINFO_EXECUTABLE", "APP_PDFFONTS_EXECUTABLE", "APP_PDFTOTEXT_EXECUTABLE", "APP_PDFTOPPM_EXECUTABLE", "APP_PDFTOHTML_EXECUTABLE", "APP_DOCUMENT_FONT_FILE", "APP_DOCUMENT_FONT_BOLD_FILE", "APP_DOCUMENT_FONT_ITALIC_FILE", "APP_DOCUMENT_FONT_BOLD_ITALIC_FILE"]) {
      vi.stubEnv(name, join(tmpdir(), name)); vi.stubEnv(`${name}_SHA256`, hash("tool"));
    }
    vi.stubEnv("APP_DOCUMENT_RENDERER_IDENTITY", "unit-buffer-boundary"); vi.stubEnv("APP_DOCUMENT_FONT_MANIFEST_SHA256", DOCUMENT_FONT_CONTRACT.manifestSha256); vi.stubEnv("APP_RENDERER_RUNTIME_DISCOVERY_FAILED", "false");
    input = { docx: Buffer.from("caller-owned-docx"), expectedPages: 1, expectedExtractedTextSha256: hash("reviewed"), artifactType: "RESUME",
      expectedMetadata: { title: "Title", author: "Author", subject: "Subject", keywords: "", language: "en-US" }, draftPdf: {} as NonNullable<DocumentRenderInput["draftPdf"]> };
    deps.write.mockImplementation(async (path: string) => { stem = basename(path).replace(/\.docx$/u, ""); });
    deps.list.mockImplementation(async () => Array.from({ length: pages }, (_, index) => `${stem}-page-${index + 1}.png`));
    deps.read.mockImplementation(async (path: string) => {
      if (path.endsWith(".pdf") || path.endsWith(".png")) { const bytes = Buffer.from(path.endsWith(".pdf") ? "%PDF-private" : "private-page"); buffers.push(bytes); return bytes; }
      return Buffer.from(path.endsWith(".txt") ? "reviewed" : "tool");
    });
    deps.execute.mockImplementation((_path, args: string[]) => args.includes("-meta") ? "en-US" : `Tagged: yes\nTitle: Title\nAuthor: Author\nSubject: Subject\nPages: ${pages}`);
    deps.validate.mockImplementation(() => { throw new Error("semantic/link validation failed"); });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("zeroes loaded PDF and page bytes after semantic/link validation failure and removes the owned directory", async () => {
    await expect(renderDocumentLocallyForQa(input)).rejects.toThrow("semantic/link validation failed");
    expect(buffers).toHaveLength(2); expect(buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect(input.docx.toString()).toBe("caller-owned-docx");
    expect(deps.remove).toHaveBeenCalledWith(deps.work, expect.objectContaining({ recursive: true, force: true }));
  });
  it("awaits each image read and clears earlier pages when a later read fails", async () => {
    pages = 2; input.expectedPages = 2;
    const read = deps.read.getMockImplementation()!;
    deps.read.mockImplementation(async (path: string) => { if (path.endsWith("page-2.png")) throw new Error("image read failed"); return read(path); });
    await expect(renderDocumentLocallyForQa(input)).rejects.toThrow("image read failed");
    expect(buffers).toHaveLength(1); expect(buffers[0].every((byte) => byte === 0)).toBe(true);
  });
  it("transfers successful result bytes intact to its caller", async () => {
    deps.validate.mockReturnValue({ schemaVersion: "unit-cleanup-only" });
    const result = await renderDocumentLocallyForQa(input);
    expect(result.searchablePdf.toString()).toBe("%PDF-private"); expect(result.pageImages[0].bytes.toString()).toBe("private-page");
  });
  it("clears prepared output if temporary directory cleanup prevents a successful return", async () => {
    deps.validate.mockReturnValue({ schemaVersion: "unit-cleanup-only" });
    deps.remove.mockRejectedValueOnce(new Error("temporary cleanup failed"));
    await expect(renderDocumentLocallyForQa(input)).rejects.toThrow("temporary cleanup failed");
    expect(buffers).toHaveLength(2); expect(buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
});

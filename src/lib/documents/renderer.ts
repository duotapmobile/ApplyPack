import "server-only";

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const SHA256 = /^[0-9a-f]{64}$/i;

type LocalTool = { path: string; sha256: string };

export type LocalRenderResult = {
  rendererIdentity: string;
  arialFontSha256: string;
  pageCount: 1 | 2;
  arialResolved: true;
  extractedTextSha256: string;
  pageImages: Array<{ bytes: Buffer; sha256: string }>;
  searchablePdf: Buffer;
  searchablePdfSha256: string;
};

export function documentRendererConfiguration(environment: Partial<NodeJS.ProcessEnv> = process.env) {
  const tool = (pathName: string, hashName: string): LocalTool => ({
    path: environment[pathName]?.trim() || "",
    sha256: environment[hashName]?.trim().toLowerCase() || "",
  });
  const tools = {
    office: tool("APP_LIBREOFFICE_EXECUTABLE", "APP_LIBREOFFICE_EXECUTABLE_SHA256"),
    pdfInfo: tool("APP_PDFINFO_EXECUTABLE", "APP_PDFINFO_EXECUTABLE_SHA256"),
    pdfFonts: tool("APP_PDFFONTS_EXECUTABLE", "APP_PDFFONTS_EXECUTABLE_SHA256"),
    pdfText: tool("APP_PDFTOTEXT_EXECUTABLE", "APP_PDFTOTEXT_EXECUTABLE_SHA256"),
    pdfPpm: tool("APP_PDFTOPPM_EXECUTABLE", "APP_PDFTOPPM_EXECUTABLE_SHA256"),
  };
  const arialFont = tool("APP_ARIAL_FONT_FILE", "APP_ARIAL_FONT_FILE_SHA256");
  const identity = environment.APP_DOCUMENT_RENDERER_IDENTITY?.trim() || "";
  const values = Object.values(tools);
  return {
    identity,
    tools,
    arialFont,
    ready: identity.length >= 3
      && values.every((value) => isAbsolute(value.path) && SHA256.test(value.sha256))
      && isAbsolute(arialFont.path) && SHA256.test(arialFont.sha256),
  } as const;
}

export async function renderDocumentLocallyForQa(input: {
  docx: Buffer;
  expectedPages: 1 | 2;
  expectedExtractedTextSha256: string;
}): Promise<LocalRenderResult> {
  const configuration = documentRendererConfiguration();
  if (!configuration.ready) throw new Error("approved_local_document_renderer_not_configured");
  await Promise.all(Object.values(configuration.tools).map(verifyTool));
  await verifyTool(configuration.arialFont);
  const work = await mkdtemp(join(tmpdir(), "applypack-render-"));
  const resolvedWork = resolve(work);
  const safeRoot = resolve(tmpdir()) + sep;
  if (!resolvedWork.startsWith(safeRoot)) throw new Error("renderer_temp_boundary_invalid");
  const stem = `artifact-${randomUUID()}`;
  const inputPath = join(work, `${stem}.docx`);
  const pdfPath = join(work, `${stem}.pdf`);
  const textPath = join(work, `${stem}.txt`);
  const imageStem = join(work, `${stem}-page`);
  try {
    await writeFile(inputPath, input.docx, { flag: "wx" });
    await execute(configuration.tools.office.path, ["--headless", "--nologo", "--nodefault", "--nolockcheck", "--norestore", "--convert-to", "pdf", "--outdir", work, inputPath], 45_000);
    const pdfInfo = await execute(configuration.tools.pdfInfo.path, [pdfPath], 10_000);
    const pageMatch = pdfInfo.match(/^Pages:\s+(\d+)\s*$/im);
    const pageCount = Number(pageMatch?.[1]);
    if (pageCount !== input.expectedPages || ![1, 2].includes(pageCount)) throw new Error("rendered_page_count_invalid");
    const fontInfo = await execute(configuration.tools.pdfFonts.path, [pdfPath], 10_000);
    if (!/(?:^|\s)Arial(?:MT|[-, ]|\s)/im.test(fontInfo)) throw new Error("arial_font_not_resolved");
    await execute(configuration.tools.pdfText.path, ["-layout", "-nopgbrk", pdfPath, textPath], 10_000);
    const extractedText = normalizeExtractedText((await readFile(textPath)).toString("utf8"));
    const extractedTextSha256 = hash(Buffer.from(extractedText, "utf8"));
    if (!extractedText || extractedTextSha256 !== input.expectedExtractedTextSha256) {
      throw new Error("rendered_text_not_equivalent");
    }
    await execute(configuration.tools.pdfPpm.path, ["-png", "-r", "144", pdfPath, imageStem], 30_000);
    const imageNames = (await readdir(work)).filter((name) => name.startsWith(basename(imageStem)) && name.endsWith(".png")).sort();
    if (imageNames.length !== pageCount) throw new Error("rendered_page_images_incomplete");
    const pageImages = await Promise.all(imageNames.map(async (name) => {
      const bytes = await readFile(join(work, name));
      return { bytes, sha256: hash(bytes) };
    }));
    const searchablePdf = await readFile(pdfPath);
    if (!searchablePdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("rendered_pdf_invalid");
    return {
      rendererIdentity: configuration.identity,
      arialFontSha256: configuration.arialFont.sha256,
      pageCount: pageCount as 1 | 2,
      arialResolved: true,
      extractedTextSha256,
      pageImages,
      searchablePdf,
      searchablePdfSha256: hash(searchablePdf),
    };
  } finally {
    if (resolve(work).startsWith(safeRoot)) await rm(work, { recursive: true, force: true });
  }
}

async function verifyTool(tool: LocalTool) {
  const bytes = await readFile(tool.path);
  if (hash(bytes) !== tool.sha256) throw new Error("renderer_executable_identity_mismatch");
}

async function execute(file: string, args: string[], timeout: number) {
  const result = await runFile(file, args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function normalizeExtractedText(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function hash(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

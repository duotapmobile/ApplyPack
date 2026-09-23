// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { rendererApprovalMatches, rendererFilesMatch } from "@/lib/operations/renderer-readiness";
import { documentRendererConfiguration } from "@/lib/documents/renderer";
const bytes = Buffer.from("approved tool");
const sha256 = createHash("sha256").update(bytes).digest("hex");
function runtime(identity = "renderer-v1", path = "/runtime/approved-tool") {
 const tool = { path, sha256 };
 return { identity, ready: true, documentFont: tool, documentFontFamily: "Arial",
 tools: { office: tool, pdfInfo: tool, pdfFonts: tool, pdfText: tool, pdfPpm: tool } } as ReturnType<typeof documentRendererConfiguration>;
}
const approval = { materials_generation_approved: true, materials_generation_approval_reference: "review-v1",
 material_output_formats: ["DOCX", "PDF"], document_renderer_identity: "renderer-v1", document_font_family: "Arial",
 document_font_sha256: sha256, document_safety_policy: "generated-structural-v1" };
describe("renderer readiness uses current approval and actual pins", () => {
 it("rejects revoked approval, wrong policy, wrong font, missing PDF and changed runtime", () => {
  expect(rendererApprovalMatches(approval, runtime())).toBe(true);
  for (const changed of [{ materials_generation_approved: false }, { document_safety_policy: "malware-clean" },
   { document_font_family: "Liberation Sans" }, { material_output_formats: ["DOCX"] }, { document_renderer_identity: "old-renderer" },
   { document_font_sha256: "0".repeat(64) }]) expect(rendererApprovalMatches({ ...approval, ...changed }, runtime())).toBe(false);
 });
 it("reads configured files and rejects substituted bytes", async () => {
  const work = await mkdtemp(join(tmpdir(), "applypack-renderer-readiness-"));
  try {
   const path = join(work, "approved-tool");
   await writeFile(path, bytes);
   expect(await rendererFilesMatch(runtime("all-valid", path))).toBe(true);
   await writeFile(path, Buffer.from("unexpected executable"));
   expect(await rendererFilesMatch(runtime("changed-files", path))).toBe(false);
  } finally { await rm(work, { recursive: true, force: true }); }
 });
 it("does not turn a missing tool into readiness", async () => {
  const work = await mkdtemp(join(tmpdir(), "applypack-renderer-readiness-"));
  try { expect(await rendererFilesMatch(runtime("missing", join(work, "missing-tool")))).toBe(false); }
  finally { await rm(work, { recursive: true, force: true }); }
 });
});

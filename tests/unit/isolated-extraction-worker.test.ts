import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
const worker = readFileSync("src/lib/files/isolated-extract.py", "utf8");
const python = process.platform === "win32" ? "python" : "python3";
async function document(external = false) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types/>');
  zip.file("_rels/.rels", external ? '<Relationships><Relationship TargetMode="External" Target="https://example.invalid"/></Relationships>' : '<Relationships/>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Maintained records &amp; schedules.</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({ type: "nodebuffer" });
}
describe("actual isolated worker parser (unit execution is not sandbox proof)", () => {
  it("extracts DOCX XML text without inventing facts", async () => {
    const result = JSON.parse(execFileSync(python, ["-I", "-c", worker], { input: await document(), timeout: 5000, maxBuffer: 3 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"] }).toString());
    expect(result.text).toBe("Maintained records & schedules.");
    expect(result.reference).toBe("isolated-extractor-v1");
    expect(result.pageCount).toBeNull();
    expect(result.paginationStatus).toBe("UNKNOWN");
  });
  it("enforces a caller's stricter expanded-container bound", async () => {
    const input = await document();
    expect(() => execFileSync(python, ["-I", "-c", worker, JSON.stringify({ maxExpandedBytes: 32, maxPages: 2 })], { input, timeout: 5000, stdio: ["pipe", "pipe", "ignore"] })).toThrow();
  });
  it("rejects external relationships rather than resolving them", async () => {
    const input = await document(true);
    expect(() => execFileSync(python, ["-I", "-c", worker], { input, timeout: 5000, stdio: ["pipe", "pipe", "ignore"] })).toThrow();
  });
});

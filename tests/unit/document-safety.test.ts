import { describe, expect, it } from "vitest";
import { validateDocumentBytes } from "@/lib/files/document-safety";
import { docxMimeType } from "@/lib/files/signatures";

describe("strict document safety validation", () => {
  it("accepts a passive PDF with a complete trailer", () => {
    const result = validateDocumentBytes(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF", "latin1"), "application/pdf");
    expect(result).toEqual({ safe: true });
  });

  it("rejects active and encrypted PDF features", () => {
    for (const feature of ["/JavaScript", "/Encrypt", "/Launch", "/EmbeddedFile", "/RichMedia", "/OpenAction", "/AA", "/XFA"]) {
      expect(validateDocumentBytes(Buffer.from("%PDF-1.7\n" + feature + "\n%%EOF", "latin1"), "application/pdf")).toMatchObject({ safe: false });
    }
  });

  it("requires the core DOCX package and rejects embedded active content", () => {
    expect(validateDocumentBytes(buildZip(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]), docxMimeType)).toEqual({ safe: true });
    expect(validateDocumentBytes(buildZip(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/vbaProject.bin"]), docxMimeType)).toMatchObject({ safe: false, reason: "active_docx_content" });
    expect(validateDocumentBytes(buildZip(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/activeX/control.bin"]), docxMimeType)).toMatchObject({ safe: false, reason: "active_docx_content" });
    expect(validateDocumentBytes(buildZip(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/embeddings/file.bin"]), docxMimeType)).toMatchObject({ safe: false, reason: "active_docx_content" });
    expect(validateDocumentBytes(buildZip(["[Content_Types].xml", "_rels/.rels", "word/document.xml", "../payload.exe"]), docxMimeType)).toMatchObject({ safe: false, reason: "unsafe_docx_path" });
    expect(validateDocumentBytes(buildZip(["[Content_Types].xml", "word/document.xml", "docProps/core.xml"]), docxMimeType)).toMatchObject({ safe: false, reason: "missing_docx_structure" });
  });
});

function buildZip(names: string[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const filename = Buffer.from(name);
    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30);
    locals.push(local);

    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    filename.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

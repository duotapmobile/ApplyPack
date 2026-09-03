import { docxMimeType } from "./signatures";

const PDF_MIME_TYPE = "application/pdf";
const MAX_ARCHIVE_ENTRIES = 500;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 100;

export type DocumentSafetyResult = { safe: true } | { safe: false; reason: string };

export async function validateDocumentSafety(file: File): Promise<DocumentSafetyResult> {
  return validateDocumentBytes(Buffer.from(await file.arrayBuffer()), file.type);
}

export function validateDocumentBytes(bytes: Buffer, mimeType: string): DocumentSafetyResult {
  if (mimeType === PDF_MIME_TYPE) return validatePdf(bytes);
  if (mimeType === docxMimeType) return validateDocx(bytes);
  return { safe: false, reason: "unsupported_document_type" };
}

function validatePdf(bytes: Buffer): DocumentSafetyResult {
  if (bytes.length < 16 || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-", "ascii"))) {
    return { safe: false, reason: "invalid_pdf_structure" };
  }
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096)).toString("latin1");
  if (!tail.includes("%%EOF")) return { safe: false, reason: "incomplete_pdf" };

  const text = bytes.toString("latin1");
  const prohibited = [
    /\/JavaScript\b/i,
    /\/JS\b/i,
    /\/Launch\b/i,
    /\/EmbeddedFile\b/i,
    /\/RichMedia\b/i,
    /\/OpenAction\b/i,
    /\/AA\b/i,
    /\/XFA\b/i,
    /\/Encrypt\b/i,
  ];
  if (prohibited.some((pattern) => pattern.test(text))) {
    return { safe: false, reason: "active_or_uninspectable_pdf_content" };
  }
  return { safe: true };
}

function validateDocx(bytes: Buffer): DocumentSafetyResult {
  const end = findEndOfCentralDirectory(bytes);
  if (end < 0) return { safe: false, reason: "invalid_docx_container" };

  const entryCount = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (entryCount < 3 || entryCount > MAX_ARCHIVE_ENTRIES || centralOffset + centralSize > end) {
    return { safe: false, reason: "unsafe_docx_archive_shape" };
  }

  const names = new Set<string>();
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      return { safe: false, reason: "invalid_docx_directory" };
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > bytes.length || localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      return { safe: false, reason: "invalid_docx_entry" };
    }
    if ((flags & 0x0001) !== 0) return { safe: false, reason: "encrypted_docx_not_allowed" };

    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8").replace(/\\/g, "/");
    const normalized = name.toLowerCase();
    if (!name || name.includes("\0") || name.startsWith("/") || normalized.split("/").includes("..")) {
      return { safe: false, reason: "unsafe_docx_path" };
    }
    if (/(^|\/)(vbaproject\.bin|activex|embeddings|customui)(\/|$)/i.test(normalized) || /\.(exe|dll|js|vbs|ps1|cmd|bat)$/i.test(normalized)) {
      return { safe: false, reason: "active_docx_content" };
    }

    names.add(normalized);
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    cursor = entryEnd;
  }

  if (cursor !== centralOffset + centralSize) return { safe: false, reason: "invalid_docx_directory_size" };
  if (totalUncompressed > MAX_UNCOMPRESSED_BYTES || totalUncompressed > Math.max(totalCompressed, 1) * MAX_EXPANSION_RATIO) {
    return { safe: false, reason: "unsafe_docx_expansion" };
  }
  for (const required of ["[content_types].xml", "_rels/.rels", "word/document.xml"]) {
    if (!names.has(required)) return { safe: false, reason: "missing_docx_structure" };
  }
  return { safe: true };
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  const offset = bytes.lastIndexOf(signature);
  return offset >= minimumOffset && offset + 22 <= bytes.length ? offset : -1;
}

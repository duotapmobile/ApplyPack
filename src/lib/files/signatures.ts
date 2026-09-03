const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const signatures: Record<string, number[]> = {
  [PDF]: [0x25, 0x50, 0x44, 0x46, 0x2d],
  [DOCX]: [0x50, 0x4b, 0x03, 0x04],
};

export async function hasExpectedFileSignature(file: File, mimeType = file.type) {
  const signature = signatures[mimeType];
  if (!signature) return false;
  const bytes = new Uint8Array(await file.slice(0, signature.length).arrayBuffer());
  return signature.every((byte, index) => bytes[index] === byte);
}

export const resumeMimeTypes = new Set(Object.keys(signatures));

export function extensionMatchesMimeType(filename: string, mimeType: string) {
  const extension = filename.toLowerCase().split(".").pop();
  return (
    (mimeType === PDF && extension === "pdf") ||
    (mimeType === DOCX && extension === "docx")
  );
}

export const docxMimeType = DOCX;
export const pdfMimeType = PDF;

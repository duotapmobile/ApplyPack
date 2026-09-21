import type { ArtifactProvenance } from "@/lib/documents/generate";

/** XMP need not duplicate PDF's standard catalog /Lang entry. */
export function pdfCatalogLanguageMatches(pdf: Buffer, expected: string) {
  const text = pdf.toString("latin1");
  const root = [...text.matchAll(/\/Root\s+(\d+)\s+(\d+)\s+R\b/g)].at(-1);
  if (!root) return false;
  const object = new RegExp(`(?:^|[\\r\\n])${root[1]}\\s+${root[2]}\\s+obj\\b([\\s\\S]*?)endobj`).exec(text)?.[1];
  if (!object || !/\/Type\s*\/Catalog\b/.test(object)) return false;
  return /\/Lang\s*\(([^()\\]+)\)/.exec(object)?.[1].toLowerCase() === expected.toLowerCase();
}

export function pdfStructureIsValid(
  output: string,
  artifactType: ArtifactProvenance["artifact"],
) {
  const hasDocument = /(?:^|\n)\s*(?:Document|StructTreeRoot)\b/im.test(output);
  const hasParagraph = /(?:^|\n)\s*P\b/im.test(output);
  if (!hasDocument || !hasParagraph) return false;
  if (artifactType === "COVER_LETTER") return true;
  const hasHeading = /(?:^|\n)\s*H1\b/im.test(output);
  if (artifactType === "REFERENCE_SHEET") return hasHeading;
  return hasHeading && /(?:^|\n)\s*L\b/im.test(output) && /(?:^|\n)\s*LI\b/im.test(output);
}

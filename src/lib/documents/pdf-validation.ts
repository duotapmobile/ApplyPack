import type { ArtifactProvenance } from "@/lib/documents/generate";

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

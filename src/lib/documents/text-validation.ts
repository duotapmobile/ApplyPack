export function normalizeRenderedDocumentText(value: string) {
  return value
    .normalize("NFC")
    .replace(/^[\p{Zs}\t]*\u2022\s*/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

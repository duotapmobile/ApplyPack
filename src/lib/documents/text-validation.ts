export function normalizeRenderedDocumentText(value: string) {
  return value
    .normalize("NFC")
    // Some PDF extractors expose a semantic list label as U+FFFD even when the
    // embedded bullet renders correctly. Ignore only that line-start label;
    // replacement characters in document content remain a hard mismatch.
    .replace(/^[\p{Zs}\t]*(?:\u2022|\uFFFD)\s*/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

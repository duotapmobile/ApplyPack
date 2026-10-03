// Every rendered font must resolve to the approved Arial family. Subset prefixes
// and the PostScript names emitted by common PDF exporters are accepted.
export function pdfFontTableUsesApprovedFont(value: string) {
  const rows = value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^name\s+type\b|^[-\s]+$/i.test(line));
  return rows.length > 0 && rows.every((line) =>
    /^(?:[A-Z]{6}\+)?Arial(?:MT|-(?:Bold|Italic|BoldItalic)MT|-(?:Bold|Italic|BoldItalic))?\s/.test(line.trim()));
}

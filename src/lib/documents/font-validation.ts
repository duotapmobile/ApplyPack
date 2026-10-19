// Every rendered font must resolve to the approved Liberation Sans 2 family.
// Subset prefixes and the PostScript style names emitted by common PDF
// exporters are accepted; a single fallback row fails the whole document.
export function pdfFontTableUsesApprovedFont(value: string) {
  const rows = value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^name\s+type\b|^[-\s]+$/i.test(line));
  return rows.length > 0 && rows.every((line) =>
    /^(?:[A-Z]{6}\+)?LiberationSans(?:-(?:Regular|Bold|Italic|BoldItalic))?\s/.test(line.trim()));
}

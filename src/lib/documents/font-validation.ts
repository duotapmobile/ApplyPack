// Every rendered font must satisfy the current Liberation Sans policy.
export function pdfFontTableUsesApprovedFont(value: string) {
  const rows = value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^name\s+type\b|^[-\s]+$/i.test(line));
  return rows.length > 0 && rows.every((line) => /^(?:[A-Z]{6}\+)?LiberationSans(?:-(?:Bold|Italic|BoldItalic))?\s/.test(line.trim()));
}

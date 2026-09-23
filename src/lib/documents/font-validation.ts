import { DOCUMENT_REQUIREMENTS } from "@/lib/documents/requirements";

export type PdfFontRecord = {
  name: string;
  embedded: boolean;
  subset: boolean;
  unicodeMapped: boolean;
};

function pdfFontRows(value: string) {
  return value.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^name\s+type\b|^[-\s]+$/i.test(line));
}

export function pdfFontRecords(value: string): PdfFontRecord[] {
  return pdfFontRows(value)
    .flatMap((line) => {
      const match = line.match(/^(\S+)\s+.+?\s+(yes|no)\s+(yes|no)\s+(yes|no)(?:\s+\d+\s+\d+)?$/i);
      if (!match) return [];
      return [{
        name: match[1],
        embedded: match[2].toLowerCase() === "yes",
        subset: match[3].toLowerCase() === "yes",
        unicodeMapped: match[4].toLowerCase() === "yes",
      }];
    });
}

export function pdfFontNames(value: string) {
  return pdfFontRecords(value).map((record) => record.name);
}

function canonicalFamily(fontName: string) {
  const value = fontName.replace(/^[A-Z]{6}\+/, "");
  if (/^Arial(?:MT|-?(?:Bold|Italic|BoldItalic|BoldMT|ItalicMT|BoldItalicMT))?$/i.test(value)) return "Arial";
  if (/^LiberationSans(?:-(?:Bold|Italic|BoldItalic))?$/i.test(value)) return "Liberation Sans";
  return null;
}

export function pdfFontTableUsesApprovedFont(
  value: string,
  approvedFamilies: readonly string[] = DOCUMENT_REQUIREMENTS.approvedExportFontFamilies,
) {
  const rows = pdfFontRows(value);
  const records = pdfFontRecords(value);
  return records.length > 0 && records.length === rows.length && records.every((record) => {
    const family = canonicalFamily(record.name);
    return family !== null && approvedFamilies.includes(family)
      && record.embedded && record.unicodeMapped;
  });
}

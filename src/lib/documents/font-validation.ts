const PDF_SUBSET_ARIAL = /(?:^|\s)(?:[A-Z]{6}\+)?Arial(?:MT|[-, ]|\s)/im;

export function pdfFontTableUsesArial(value: string) {
  return PDF_SUBSET_ARIAL.test(value);
}

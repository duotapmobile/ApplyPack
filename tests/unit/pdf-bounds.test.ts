import { describe, expect, it } from "vitest";
import { pdfTextBoundsAreValid } from "@/lib/documents/pdf-bounds";
const valid = '<html><body><doc><page width="612" height="792"><flow><block xMin="40" yMin="40" xMax="300" yMax="60"><line xMin="40" yMin="40" xMax="300" yMax="60"><word xMin="40" yMin="40" xMax="300" yMax="60">Same extractable text</word></line></block></flow></page></doc></body></html>';
describe("measured PDF text bounds", () => {
  it("accepts complete in-page rectangles", () => expect(pdfTextBoundsAreValid(valid, 1)).toBe(true));
  it.each(['xMin="-1"', 'xMin="NaN"', 'xMin="1e2"'])('rejects invalid coordinates %s', value => {
    expect(pdfTextBoundsAreValid(valid.replace('xMin="40"', value), 1)).toBe(false);
  });
  it("rejects extractable text clipped beyond the page", () => {
    expect(pdfTextBoundsAreValid(valid.replaceAll('xMax="300"', 'xMax="613"'), 1)).toBe(false);
    expect(pdfTextBoundsAreValid(valid.replaceAll('yMax="60"', 'yMax="793"'), 1)).toBe(false);
  });
  it("rejects custom DTD, malformed XML, missing bounds, empty pages and page mismatch", () => {
    for (const xml of ['<!DOCTYPE html [<!ENTITY secret SYSTEM "file:///secret">]>'+valid,
      valid.slice(0, -7), valid.replace('xMax="300"', ''), valid.replace(/<word[^>]*>.*?<\/word>/, '')]) {
      expect(pdfTextBoundsAreValid(xml, 1)).toBe(false);
    }
    expect(pdfTextBoundsAreValid(valid, 2)).toBe(false);
  });
});

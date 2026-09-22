import { SaxesParser } from "saxes";

const POPPLER_DOCTYPE = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';
const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const BOX_PARENTS: Record<string, string> = { word: "line", line: "block", block: "flow" };

/** Inspect measured glyph/layout rectangles, independently of text equivalence. */
export function pdfTextBoundsAreValid(xml: string, expectedPages: number): boolean {
  if (Buffer.byteLength(xml, "utf8") > 2 * 1024 * 1024) return false;
  // Poppler emits this fixed declaration. Never load a DTD or accept custom entities.
  const input = xml.replace(POPPLER_DOCTYPE, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) return false;
  let valid = true;
  let pages = 0;
  let page: { width: number; height: number; words: number } | null = null;
  const stack: string[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on("error", () => { valid = false; });
  parser.on("doctype", () => { valid = false; });
  parser.on("opentag", (tag) => {
    const parent = stack.at(-1);
    stack.push(tag.name);
    const number = (name: string) => {
      const value = tag.attributes[name];
      if (typeof value !== "string" || !NUMBER.test(value)) return NaN;
      return Number(value);
    };
    if (tag.name === "page") {
      const width = number("width"), height = number("height");
      if (page || parent !== "doc" || !Number.isFinite(width) || !Number.isFinite(height)
        || width <= 0 || height <= 0 || width > 14400 || height > 14400) valid = false;
      page = { width, height, words: 0 };
      pages++;
    } else if (["word", "line", "block"].includes(tag.name)) {
      const expectedParent = BOX_PARENTS[tag.name];
      const xMin = number("xMin"), yMin = number("yMin"), xMax = number("xMax"), yMax = number("yMax");
      if (!page || parent !== expectedParent || ![xMin, yMin, xMax, yMax].every(Number.isFinite)
        || xMin < 0 || yMin < 0 || xMax <= xMin || yMax <= yMin
        || xMax > page.width || yMax > page.height) valid = false;
      if (page && tag.name === "word") page.words++;
    } else if (tag.name === "flow" && (!page || parent !== "page")) valid = false;
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "page") {
      if (!page?.words) valid = false;
      page = null;
    }
    stack.pop();
  });
  try { parser.write(input).close(); } catch { return false; }
  return valid && !page && pages === expectedPages && pages > 0;
}

import { createHash } from "node:crypto";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { DRAFT_DOCX_GENERATOR_VERSION } from "./draft-format";
import { normalizeRenderedDocumentText } from "./text-validation";

export const DRAFT_PDF_SCHEMA = "applypack-reviewed-draft-pdf-v1" as const;
type Link = { text: string; target: string };
type Paragraph = { text: string; kind: "P" | "H1" | "BULLET"; links: Link[] };
export type DraftPdfExpectation = {
  schemaVersion: typeof DRAFT_PDF_SCHEMA; generatorVersion: string; artifact: "RESUME" | "COVER_LETTER";
  renderSourceSha256: string; docxSha256: string; paragraphs: Paragraph[]; expectationSha256: string;
};
export type DraftPdfReceipt = Omit<DraftPdfExpectation, "paragraphs"> & {
  searchablePdfSha256: string; structureTextSha256: string; linkXmlSha256: string;
  paragraphCount: number; listItemCount: number; linkCount: number;
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const normalized = normalizeRenderedDocumentText;
const SHA = /^[a-f0-9]{64}$/u;
const bound = (text: string) => typeof text === "string" && Buffer.byteLength(text, "utf8") <= 2_097_152;
function fail(): never { throw new Error("draft_pdf_source_validation_failed"); }

function parseXml(xml: string, visit: (parser: SaxesParser) => void) {
  if (!bound(xml) || /<!DOCTYPE|<!ENTITY/iu.test(xml)) fail();
  const parser = new SaxesParser({ xmlns: false });
  parser.on("error", fail); parser.on("doctype", fail);
  visit(parser);
  parser.write(xml).close();
}

/** Called only after the new source-aware DOCX inspection has passed. Derives
 * expectations from those exact bytes, never from an approval flag. */
export async function draftPdfExpectation(docx: Buffer, artifact: DraftPdfExpectation["artifact"], renderSourceSha256: string): Promise<DraftPdfExpectation> {
  const owned = Buffer.from(docx);
  try {
    const zip = await JSZip.loadAsync(owned);
    const relations = new Map<string, string>();
    parseXml(await zip.file("word/_rels/document.xml.rels")!.async("string"), (parser) => {
      parser.on("opentag", (tag) => {
        if (tag.name !== "Relationship" || tag.attributes.TargetMode !== "External") return;
        const id = String(tag.attributes.Id), target = String(tag.attributes.Target);
        if (relations.has(id) || !String(tag.attributes.Type).endsWith("/hyperlink")) fail();
        relations.set(id, target);
      });
    });
    const paragraphs: Paragraph[] = []; let paragraph: Paragraph | null = null, link: Link | null = null, inText = false;
    parseXml(await zip.file("word/document.xml")!.async("string"), (parser) => {
      parser.on("opentag", (tag) => {
        if (tag.name === "w:p") { if (paragraph) fail(); paragraph = { text: "", kind: "P", links: [] }; }
        if (tag.name === "w:numPr" && paragraph) paragraph.kind = "BULLET";
        if (tag.name === "w:pStyle" && tag.attributes["w:val"] === "Heading1" && paragraph) paragraph.kind = "H1";
        if (tag.name === "w:hyperlink") {
          if (!paragraph || link) fail();
          const target = relations.get(String(tag.attributes["r:id"])); if (!target) fail();
          link = { text: "", target }; paragraph.links.push(link);
        }
        if (tag.name === "w:t") inText = true;
      });
      parser.on("text", (text) => { if (inText && paragraph) { paragraph.text += text; if (link) link.text += text; } });
      parser.on("closetag", (tag) => {
        if (tag.name === "w:t") inText = false;
        if (tag.name === "w:hyperlink") link = null;
        if (tag.name === "w:p") { if (!paragraph) fail(); paragraph.text = normalized(paragraph.text); paragraph.links.forEach((entry) => { entry.text = normalized(entry.text); }); paragraphs.push(paragraph); paragraph = null; }
      });
    });
    const body = { schemaVersion: DRAFT_PDF_SCHEMA, generatorVersion: DRAFT_DOCX_GENERATOR_VERSION, artifact, renderSourceSha256, docxSha256: hash(owned), paragraphs };
    const result = { ...body, expectationSha256: hash(JSON.stringify(body)) };
    assertDraftPdfExpectation(result, owned, artifact);
    return result;
  } finally { owned.fill(0); }
}

export function assertDraftPdfExpectation(value: DraftPdfExpectation, docx: Buffer, artifact: string): void {
  const { expectationSha256, ...body } = value;
  if (value.schemaVersion !== DRAFT_PDF_SCHEMA || value.generatorVersion !== DRAFT_DOCX_GENERATOR_VERSION
    || !["RESUME", "COVER_LETTER"].includes(artifact) || value.artifact !== artifact
    || !SHA.test(value.renderSourceSha256) || value.docxSha256 !== hash(docx)
    || expectationSha256 !== hash(JSON.stringify(body)) || !Array.isArray(value.paragraphs)
    || value.paragraphs.length < 2 || value.paragraphs.length > 250) fail();
  for (const paragraph of value.paragraphs) {
    if (!["P", "H1", "BULLET"].includes(paragraph.kind) || !paragraph.text || paragraph.text.length > 10_000
      || normalized(paragraph.text) !== paragraph.text || !Array.isArray(paragraph.links) || paragraph.links.length > 3) fail();
    for (const link of paragraph.links) {
      if (!link.text || normalized(link.text) !== link.text || !paragraph.text.includes(link.text)
        || !/^(?:https:\/\/|mailto:)/u.test(link.target) || /[\r\n\u0000]/u.test(link.target)) fail();
    }
  }
  const links = value.paragraphs.flatMap((paragraph) => paragraph.links);
  if (!links.length || links.length > 5 || (artifact === "COVER_LETTER" && value.paragraphs.some((paragraph) => paragraph.kind !== "P"))) fail();
}

type Node = { tag: string; indent: number; children: Node[]; chunks: Array<string | Node> };
/** Parses Poppler's bounded semantic-tree report, not PDF syntax. */
function structureParagraphs(output: string): Paragraph[] {
  if (!bound(output)) fail();
  const roots: Node[] = [], stack: Node[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const text = line.trim(); if (!text) continue;
    const indent = line.length - line.trimStart().length;
    if (text.startsWith("/") || /^Object \d+ \d+$/u.test(text)) continue;
    if (text.startsWith('"') && text.endsWith('"')) {
      while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
      if (!stack.length) fail(); stack.at(-1)!.chunks.push(text.slice(1, -1)); continue;
    }
    const match = /^(Document|StructTreeRoot|P|H1|L|LI|Lbl|LBody|Link)(?: \((?:block|inline)\))?:?$/u.exec(text);
    if (!match) fail();
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const node: Node = { tag: match[1], indent, children: [], chunks: [] }, parent = stack.at(-1);
    if (parent) { parent.children.push(node); parent.chunks.push(node); } else roots.push(node);
    stack.push(node);
  }
  if (roots.length !== 1 || !["Document", "StructTreeRoot"].includes(roots[0].tag)) fail();
  let root = roots[0];
  if (root.tag === "StructTreeRoot") { if (root.children.length !== 1 || root.children[0].tag !== "Document") fail(); root = root.children[0]; }
  const nodeText = (node: Node): string => node.chunks.map((chunk) => typeof chunk === "string" ? chunk : nodeText(chunk)).join("");
  const rows: Paragraph[] = [];
  const add = (node: Node, kind: Paragraph["kind"]) => {
    if (!["P", "H1"].includes(node.tag) || node.children.some((child) => child.tag !== "Link" || child.children.length)) fail();
    rows.push({ kind, text: normalized(nodeText(node)), links: node.children.map((link) => ({ text: normalized(nodeText(link)), target: "" })) });
  };
  if (root.chunks.some((chunk) => typeof chunk === "string")) fail();
  for (const child of root.children) {
    if (["P", "H1"].includes(child.tag)) add(child, child.tag as "P" | "H1");
    else if (child.tag === "L") {
      if (!child.children.length || child.chunks.some((chunk) => typeof chunk === "string")) fail();
      for (const item of child.children) {
        if (item.tag !== "LI" || item.children.length !== 2 || item.children[0].tag !== "Lbl" || item.children[1].tag !== "LBody"
          || item.children[0].children.length || item.chunks.some((chunk) => typeof chunk === "string")
          || nodeText(item.children[0]).trim() !== "•") fail();
        const body = item.children[1];
        if (body.children.length !== 1 || body.chunks.some((chunk) => typeof chunk === "string")) fail();
        add(body.children[0], "BULLET");
      }
    } else fail();
  }
  return rows;
}

function popplerLinks(xml: string, expectedPages: number): Link[] {
  // Saxes never loads external resources. Only Poppler's fixed, unused DTD is removed.
  const clean = xml.replace('<!DOCTYPE pdf2xml SYSTEM "pdf2xml.dtd">', "");
  const links: Link[] = [], stack: string[] = []; let link: Link | null = null, pages = 0;
  parseXml(clean, (parser) => {
    parser.on("opentag", (tag) => {
      const parent = stack.at(-1); stack.push(tag.name);
      if (tag.name === "pdf2xml" && parent) fail();
      if (tag.name === "page") { if (parent !== "pdf2xml" || Number(tag.attributes.number) !== ++pages) fail(); }
      if (tag.name === "a") {
        if (!stack.includes("text") || !stack.includes("page") || link) fail();
        link = { text: "", target: String(tag.attributes.href ?? "") }; links.push(link);
      }
    });
    parser.on("text", (text) => { if (link) link.text += text; });
    parser.on("closetag", (tag) => { if (tag.name === "a") { if (!link) fail(); link.text = normalized(link.text); link = null; } stack.pop(); });
  });
  if (pages !== expectedPages) fail();
  return links;
}

export function validateDraftPdfEvidence(expectation: DraftPdfExpectation, evidence: { structureText: string; linkXml: string; pdf: Buffer; pages: 1 | 2 }): DraftPdfReceipt {
  const actual = structureParagraphs(evidence.structureText), expected = expectation.paragraphs;
  if (actual.length !== expected.length || actual.some((row, index) => row.kind !== expected[index].kind || row.text !== expected[index].text
    || JSON.stringify(row.links.map((link) => link.text)) !== JSON.stringify(expected[index].links.map((link) => link.text)))) fail();
  const links = popplerLinks(evidence.linkXml, evidence.pages), expectedLinks = expected.flatMap((row) => row.links);
  const target = (value: string) => { try { return new URL(value).href; } catch { return fail(); } };
  if (links.length !== expectedLinks.length || links.some((link, index) => link.text !== expectedLinks[index].text || target(link.target) !== target(expectedLinks[index].target))) fail();
  const { paragraphs: _privateParagraphs, ...identity } = expectation;
  void _privateParagraphs;
  return { ...identity, searchablePdfSha256: hash(evidence.pdf), structureTextSha256: hash(evidence.structureText), linkXmlSha256: hash(evidence.linkXml),
    paragraphCount: expected.length, listItemCount: expected.filter((row) => row.kind === "BULLET").length, linkCount: expectedLinks.length };
}

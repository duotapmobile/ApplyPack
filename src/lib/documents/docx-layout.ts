import { AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun, convertInchesToTwip } from "docx";
import JSZip from "jszip";
import { DOCUMENT_REQUIREMENTS } from "./requirements";
import { assertDeliverableText } from "@/lib/materials/contract";
import type { DocumentMetadata } from "./generate";

const PAGE_WIDTH = DOCUMENT_REQUIREMENTS.page.widthTwips;
const PAGE_HEIGHT = DOCUMENT_REQUIREMENTS.page.heightTwips;
const MARGIN_TOP_BOTTOM = convertInchesToTwip(DOCUMENT_REQUIREMENTS.page.marginTopBottomInches);
const MARGIN_LEFT_RIGHT = convertInchesToTwip(DOCUMENT_REQUIREMENTS.page.marginLeftRightInches);
const HEADING_BORDER = {
  style: BorderStyle.SINGLE,
  size: DOCUMENT_REQUIREMENTS.sectionRule.sizeEighthPoints,
  color: DOCUMENT_REQUIREMENTS.sectionRule.color,
  space: DOCUMENT_REQUIREMENTS.sectionRule.spacePoints,
};
export function documentWith(children: Paragraph[], metadata: DocumentMetadata) {
  return new Document({
    creator: metadata.author,
    title: metadata.title,
    subject: metadata.subject,
    description: "",
    keywords: metadata.keywords,
    lastModifiedBy: "",
    revision: 1,
    numbering: {
      config: [{
        reference: "resume-bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "•",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.17), hanging: convertInchesToTwip(0.11) } } },
        }],
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: DOCUMENT_REQUIREMENTS.font, size: 21, color: "000000", language: { value: metadata.language } },
          paragraph: { spacing: { before: 0, after: 0, line: 240 } },
        },
      },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { font: DOCUMENT_REQUIREMENTS.font, size: 21, color: "000000", bold: true } },
        { id: "CandidateName", name: "Candidate Name", basedOn: "Normal", next: "ContactInformation",
          run: { font: DOCUMENT_REQUIREMENTS.font, size: 36, color: "000000", bold: false },
          paragraph: { alignment: AlignmentType.CENTER } },
        { id: "ContactInformation", name: "Contact Information", basedOn: "Normal", next: "Normal",
          run: { font: DOCUMENT_REQUIREMENTS.font, size: 19, color: "000000" },
          paragraph: { alignment: AlignmentType.CENTER } },
        { id: "JobTitle", name: "Job Title", basedOn: "Normal", next: "EmployerDate",
          run: { font: DOCUMENT_REQUIREMENTS.font, size: 21, color: "000000", bold: true } },
        { id: "EmployerDate", name: "Employer and Date", basedOn: "Normal", next: "Normal",
          run: { font: DOCUMENT_REQUIREMENTS.font, size: 21, color: "000000" } },
        { id: "BusinessDescriptor", name: "Business Descriptor", basedOn: "Normal", next: "Normal",
          run: { font: DOCUMENT_REQUIREMENTS.font, size: 19, color: "000000" } },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: {
            top: MARGIN_TOP_BOTTOM,
            bottom: MARGIN_TOP_BOTTOM,
            left: MARGIN_LEFT_RIGHT,
            right: MARGIN_LEFT_RIGHT,
            header: 0,
            footer: 0,
            gutter: 0,
          },
        },
      },
      children,
    }],
  });
}

export async function packCleanDocument(document: Document, metadata: DocumentMetadata) {
  const packed = await Packer.toBuffer(document);
  const zip = await JSZip.loadAsync(packed);
  [
    "word/comments.xml",
    "word/_rels/comments.xml.rels",
    "docProps/custom.xml",
  ].forEach((name) => zip.remove(name));
  const relationships = zip.file("word/_rels/document.xml.rels");
  if (relationships) {
    const xml = await relationships.async("string");
    zip.file("word/_rels/document.xml.rels", xml.replace(/<Relationship\b[^>]*\bTarget="comments\.xml"[^>]*\/>/giu, ""));
  }
  const contentTypes = zip.file("[Content_Types].xml");
  if (contentTypes) {
    const xml = await contentTypes.async("string");
    zip.file("[Content_Types].xml", xml
      .replace(/<Override\b[^>]*\bPartName="\/word\/comments\.xml"[^>]*\/>/giu, "")
      .replace(/<Override\b[^>]*\bPartName="\/docProps\/custom\.xml"[^>]*\/>/giu, ""));
  }
  const packageRelationships = zip.file("_rels/.rels");
  if (packageRelationships) {
    const xml = await packageRelationships.async("string");
    zip.file("_rels/.rels", xml.replace(/<Relationship\b[^>]*\bTarget="docProps\/custom\.xml"[^>]*\/>/giu, ""));
  }
  const core = zip.file("docProps/core.xml");
  if (core) {
    const xml = await core.async("string");
    const withoutEditor = xml
      .replace(/<cp:lastModifiedBy(?:\s[^>]*)?>[\s\S]*?<\/cp:lastModifiedBy>/iu, "<cp:lastModifiedBy/>");
    const language = escapeXml(metadata.language);
    const withLanguage = /<dc:language(?:\s[^>]*)?>/iu.test(withoutEditor)
      ? withoutEditor.replace(/<dc:language(?:\s[^>]*)?>[\s\S]*?<\/dc:language>/iu, `<dc:language>${language}</dc:language>`)
      : withoutEditor.replace(/<\/cp:coreProperties>/iu, `<dc:language>${language}</dc:language></cp:coreProperties>`);
    zip.file("docProps/core.xml", withLanguage);
  }
  const cleaned = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  packed.fill(0);
  return cleaned;
}

export function majorHeading(text: string, before: number) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    outlineLevel: 0,
    keepNext: true,
    keepLines: true,
    spacing: { before, after: DOCUMENT_REQUIREMENTS.spacingTwips.headingAfter },
    border: { bottom: HEADING_BORDER },
    children: [new TextRun({ text, bold: true, font: DOCUMENT_REQUIREMENTS.font, size: 21, color: "000000" })],
  });
}

export function paragraph(text: string, options: {
  before?: number;
  after?: number;
  line?: number;
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  size?: number;
  bold?: boolean;
  italics?: boolean;
  style?: string;
  keepNext?: boolean;
  keepLines?: boolean;
}) {
  return new Paragraph({
    style: options.style,
    alignment: options.alignment || AlignmentType.LEFT,
    keepNext: options.keepNext,
    keepLines: options.keepLines,
    spacing: { before: options.before || 0, after: options.after || 0, line: options.line || 240 },
    children: [new TextRun({
      text: assertDeliverableText(text),
      font: DOCUMENT_REQUIREMENTS.font,
      size: options.size || 21,
      bold: options.bold,
      italics: options.italics,
      color: "000000",
    })],
  });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


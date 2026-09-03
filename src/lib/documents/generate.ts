import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

export type DocumentDraftInput = {
  fullName: string;
  email: string;
  location: string;
  jobTitle: string;
  employer: string;
  direction: string;
  backgroundDetails: string;
  backgroundTypes: string[];
  tools: string;
  credentials: string;
  emphasisNotes: string;
};

const GENERATOR_VERSION = "first-party-structured-v1";

export async function generateApplyPackDrafts(input: DocumentDraftInput) {
  const resume = new Document({ sections: [{ children: resumeParagraphs(input) }] });
  const coverLetter = new Document({ sections: [{ children: coverLetterParagraphs(input) }] });
  return {
    resume: await Packer.toBuffer(resume),
    coverLetter: await Packer.toBuffer(coverLetter),
    generatorVersion: GENERATOR_VERSION,
  };
}

function resumeParagraphs(input: DocumentDraftInput): Paragraph[] {
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: input.fullName, bold: true, size: 32 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, text: [input.location, input.email].filter(Boolean).join(" | ") }),
    heading("Professional Summary"),
    body(`Customer-provided experience prepared for review against the ${input.jobTitle} opportunity at ${input.employer}. ${input.direction}`),
    heading("Experience and Background"),
    ...customerLines(input.backgroundDetails),
  ];
  if (input.backgroundTypes.length) {
    children.push(heading("Relevant Experience Types"), ...input.backgroundTypes.map(bullet));
  }
  if (input.tools) children.push(heading("Tools and Systems"), ...customerLines(input.tools));
  if (input.credentials) children.push(heading("Credentials and Training"), ...customerLines(input.credentials));
  return children;
}

function coverLetterParagraphs(input: DocumentDraftInput): Paragraph[] {
  return [
    new Paragraph({ children: [new TextRun({ text: input.fullName, bold: true, size: 28 })] }),
    new Paragraph({ text: [input.location, input.email].filter(Boolean).join(" | ") }),
    new Paragraph({ text: new Date().toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }) }),
    new Paragraph({ text: `${input.employer} Hiring Team` }),
    new Paragraph({ text: `Re: ${input.jobTitle}` }),
    body("Dear Hiring Team,"),
    body(`I am interested in the ${input.jobTitle} opportunity at ${input.employer}. My background includes the following experience supplied in my ApplyPack intake:`),
    ...customerLines(input.backgroundDetails),
    ...(input.tools ? [body(`Tools and systems I reported using include: ${input.tools}`)] : []),
    ...(input.credentials ? [body(`Credentials or training I reported include: ${input.credentials}`)] : []),
    body("I would welcome the opportunity to discuss how this background may support the role. Thank you for your consideration."),
    body("Sincerely,"),
    new Paragraph({ text: input.fullName }),
  ];
}

function heading(text: string) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, text });
}

function body(text: string) {
  return new Paragraph({ text: clean(text), spacing: { after: 180 } });
}

function bullet(text: string) {
  return new Paragraph({ text: clean(text), bullet: { level: 0 } });
}

function customerLines(value: string): Paragraph[] {
  const lines = value.split(/\r?\n|[•]/).map(clean).filter(Boolean);
  return (lines.length ? lines : ["No additional details provided."]).map(bullet);
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

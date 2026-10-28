import { createHash } from "node:crypto";
import { AlignmentType, ExternalHyperlink, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { assertDeliverableText, materialFilename } from "@/lib/materials/contract";
import { assertCurrentRequirementMappings } from "./draft-preparation";
import { serializeDraftRenderSource, type DraftRenderSource, type DraftRenderText } from "./draft-render-source";
import { serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "./drafting-evidence";
import { documentWith, majorHeading, packCleanDocument, paragraph } from "./docx-layout";
import { inspectDocxPackage, type ArtifactProvenance, type ClaimProvenanceEntry, type DocumentMetadata, type RequirementMapping } from "./generate";
import { DOCUMENT_REQUIREMENTS } from "./requirements";
import { DRAFT_DOCX_GENERATOR_VERSION, DRAFT_DOCX_VERSIONS } from "./draft-format";
import type { DraftReferenceSourceBinding } from "./draft-reference-source";
import { assertBoundServiceRepairMember, type ServiceRepairBoundMember } from "./service-repair-source";
export { DRAFT_DOCX_GENERATOR_VERSION, DRAFT_DOCX_VERSIONS } from "./draft-format";

const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
type ArtifactType = "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET";
type Input = { source: DraftRenderSource; packet: DraftingEvidencePacket };
type Row = { text: string; claims: DraftRenderText[]; heading?: boolean; bullet?: boolean; role?: "NAME" | "CONTACT" | "LINK" | "TITLE" | "SUBJECT" | "SIGNOFF" | "REFERENCE_EMAIL"; before?: number; after?: number };
type DraftClaimProvenance = ClaimProvenanceEntry & { referenceBinding?: DraftRenderText["referenceBinding"] };
type DraftProvenance = Omit<ArtifactProvenance, "versions" | "claims"> & { versions: typeof DRAFT_DOCX_VERSIONS; claims: DraftClaimProvenance[];
  referenceBindings?: DraftReferenceSourceBinding[];
  draftSource: { renderSourceSha256: string; proposalSourceSha256: string; packetSha256: string } };
export type PreparedDraftDocxArtifact = {
  buffer: Buffer; filename: string; mimeType: typeof MIME; metadata: DocumentMetadata;
  provenance: DraftProvenance; expectedPageCount: 1 | 2; versions: typeof DRAFT_DOCX_VERSIONS;
  ownerReviewClaims: DraftRenderText[]; inspection: Awaited<ReturnType<typeof inspectDraftDocx>>;
  state: "OWNER_REVIEW_REQUIRED"; deliveryAuthorized: false;
};
export class DraftDocxError extends Error { constructor(code: string) { super(`DRAFT_DOCX_${code}`); this.name = "DraftDocxError"; } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftDocxError(code); }
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const unique = (values: string[]) => [...new Set(values)].sort();
const text = (value: string) => value.replace(/\s+/gu, " ").trim();
const xmlText = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");
const decodeXmlText = (value: string) => value.replace(/&(amp|lt|gt|quot|apos|#x[\da-f]+|#\d+);/giu, (entity, name: string) => {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  if (name in named) return named[name];
  const code = Number.parseInt(name.slice(name[1].toLowerCase() === "x" ? 2 : 1), name[1].toLowerCase() === "x" ? 16 : 10);
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
});
const paragraphText = (xml: string) => text([...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gu)]
  .map((match) => decodeXmlText(match[1])).join(""));
const expectedRowLinks = (entry: Row) => entry.claims.flatMap((claim) => entry.role === "LINK"
  ? [{ text: text(claim.text), target: claim.text }]
  : (entry.role === "CONTACT" || entry.role === "REFERENCE_EMAIL") && claim.placement.endsWith(".email") ? [{ text: text(claim.text), target: `mailto:${claim.text}` }] : []);

function metadataForDraft(input: Input, artifact: ArtifactType): DocumentMetadata {
  const applicant = input.source.resume.header.find((claim) => claim.placement.endsWith(".displayName"))!.text;
  const target = input.packet.ownerEvidence.targetJob;
  return { title: `${applicant} ${artifact === "RESUME" ? "Resume" : artifact === "COVER_LETTER" ? "Cover Letter" : "Professional References"} - ${target.company}`, author: applicant,
    subject: `Application for ${target.exactTitle} at ${target.company}`, language: input.source.language, keywords: "" };
}

function sourcePlans(input: Input) {
  const { source, packet } = input;
  serializeDraftRenderSource(source); serializeDraftingEvidencePacket(packet);
  ensure(source.state === "OWNER_REVIEW_REQUIRED" && source.deliveryAuthorized === false
    && source.packetSha256 === packet.packetSha256 && canonicalSha256(source.expected) === canonicalSha256(packet.expected)
    && source.contactPayloadId === packet.binding.contactPayloadId && source.contactSha256 === packet.binding.contactSha256
    && canonicalSha256(source.outputRules) === canonicalSha256(packet.providerView.outputRules), "SOURCE_BINDING_INVALID");
  const byId = new Map(source.ownerReviewClaims.map((claim) => [claim.claimId, claim]));
  ensure(byId.size === source.ownerReviewClaims.length && byId.size > 0 && byId.size <= 250, "CLAIM_SET_INVALID");
  const emitted: DraftRenderText[] = [];
  const row = (claims: DraftRenderText[], separator = " ", options: Omit<Row, "text" | "claims"> = {}): Row => {
    for (const claim of claims) {
      ensure(JSON.stringify(byId.get(claim.claimId)) === JSON.stringify(claim) && claim.wordingSha256 === hash(claim.text)
        && claim.state === "OWNER_REVIEW_REQUIRED" && assertDeliverableText(claim.text) === claim.text, "CLAIM_BINDING_INVALID");
      emitted.push(claim);
    }
    return { ...options, text: claims.map((claim) => claim.text).join(separator), claims };
  };
  const literal = (value: string, options: Omit<Row, "text" | "claims"> = {}): Row => ({ text: assertDeliverableText(value), claims: [], ...options });
  const contact = (claims: DraftRenderText[], prefix: string): Row[] => {
    const field = (name: string) => claims.find((claim) => claim.placement === `${prefix}.contact.${name}`);
    const name = field("displayName"), email = field("email");
    ensure(name && email && claims.every((claim) => claim.origin === "LOCAL_CONTACT"), "CONTACT_MISSING");
    const details = [field("cityState"), field("phone"), email].filter((claim): claim is DraftRenderText => Boolean(claim));
    const portfolio = field("linkedInOrPortfolio");
    return [row([name!], " ", { role: "NAME", after: DOCUMENT_REQUIREMENTS.spacingTwips.nameAfter }),
      row(details, " | ", { role: "CONTACT", after: portfolio ? 35 : prefix === "resume" ? DOCUMENT_REQUIREMENTS.spacingTwips.resumeContactAfter : DOCUMENT_REQUIREMENTS.spacingTwips.coverContactAfter }),
      ...(portfolio ? [row([portfolio], " ", { role: "LINK", after: prefix === "resume" ? DOCUMENT_REQUIREMENTS.spacingTwips.resumeContactAfter : DOCUMENT_REQUIREMENTS.spacingTwips.coverContactAfter })] : [])];
  };
  const resume = contact(source.resume.header, "resume");
  if (source.resume.summary.length) resume.push(literal("PROFESSIONAL SUMMARY", { heading: true }), row(source.resume.summary));
  if (source.resume.skills.length) resume.push(literal("CORE SKILLS", { heading: true, before: DOCUMENT_REQUIREMENTS.spacingTwips.skillsHeadingBefore }), row(source.resume.skills, " | "));
  for (const section of source.resume.sections) {
    resume.push(literal(section.heading.toUpperCase(), { heading: true, before: DOCUMENT_REQUIREMENTS.spacingTwips.experienceHeadingBefore }));
    const role = section.header.filter((claim) => claim.placement.endsWith(".role")), details = section.header.filter((claim) => !claim.placement.endsWith(".role"));
    if (role.length) resume.push(row(role, " ", { role: "TITLE", after: 40 }));
    if (details.length) resume.push(row(details, " | ", { after: 60 }));
    section.bullets.forEach((claim) => resume.push(row([claim], " ", { bullet: true })));
  }
  if (source.resume.careerBreak) {
    resume.push(literal("CAREER BREAK", { heading: true, before: DOCUMENT_REQUIREMENTS.spacingTwips.educationHeadingBefore }),
      row([source.resume.careerBreak.label, source.resume.careerBreak.dates], " | "));
  }
  if (source.resume.education.length) {
    resume.push(literal("EDUCATION & CERTIFICATIONS", { heading: true, before: DOCUMENT_REQUIREMENTS.spacingTwips.educationHeadingBefore }));
    for (const education of source.resume.education) resume.push(row(education.header, " | ", { after: 60 }));
  }
  ensure(resume.some((entry) => entry.heading), "RESUME_CONTENT_REQUIRED");
  const letter = source.coverLetter;
  ensure(letter.body.length >= 1 && letter.body.length <= 3, "LETTER_PARAGRAPH_LIMIT");
  // A third substantive paragraph shares its paragraph with the exact closing;
  // no supported sentence is dropped to fit the standard's four-paragraph cap.
  const body = letter.body.map((claims, index) => letter.body.length === 3 && index === 2 ? [...claims, letter.closing] : claims);
  const coverLetter = [...contact(letter.header, "coverLetter"), literal(letter.date, { after: DOCUMENT_REQUIREMENTS.spacingTwips.coverBlockAfter }),
    row([letter.recipient], " ", { after: DOCUMENT_REQUIREMENTS.spacingTwips.coverBlockAfter }),
    { ...row([letter.subject], " ", { role: "SUBJECT", after: DOCUMENT_REQUIREMENTS.spacingTwips.coverSubjectAfter }), text: `Re: ${letter.subject.text}` },
    literal(letter.salutation, { after: DOCUMENT_REQUIREMENTS.spacingTwips.coverParagraphAfter }),
    row([letter.introduction], " ", { after: DOCUMENT_REQUIREMENTS.spacingTwips.coverParagraphAfter }),
    ...body.map((claims) => row(claims, " ", { after: DOCUMENT_REQUIREMENTS.spacingTwips.coverParagraphAfter })),
    ...(letter.body.length === 3 ? [] : [row([letter.closing], " ", { after: DOCUMENT_REQUIREMENTS.spacingTwips.coverParagraphAfter })]),
    literal(letter.signoff, { role: "SIGNOFF", before: DOCUMENT_REQUIREMENTS.spacingTwips.signoffBefore, after: DOCUMENT_REQUIREMENTS.spacingTwips.signoffAfter }),
    row([letter.signature])];
  ensure(Boolean(source.referenceSheet) === Boolean(packet.binding.referencePermissions.length), "REFERENCE_SCOPE_INVALID");
  let referenceSheet: Row[] | undefined;
  if (source.referenceSheet) {
    const records = source.referenceSheet.records, permissions = packet.binding.referencePermissions;
    ensure(records.length >= 1 && records.length <= 3 && records.length === permissions.length
      && new Set(records.map((entry) => entry.permissionId)).size === records.length
      && records.every((entry) => permissions.some((permission) => permission.id === entry.permissionId
        && permission.reference_record_version_id === entry.recordVersionId)), "REFERENCE_SCOPE_INVALID");
    referenceSheet = [...contact(source.referenceSheet.header, "referenceSheet"), literal("PROFESSIONAL REFERENCES", { heading: true })];
    for (const reference of records) {
      const field = (name: string) => reference.fields.find((claim) => claim.referenceBinding?.field === name);
      ensure(reference.fields.length >= 6 && reference.fields.length <= 7
        && reference.fields.every((claim) => claim.origin === "LOCAL_REFERENCE" && claim.referenceBinding?.permissionId === reference.permissionId), "REFERENCE_FIELDS_INVALID");
      const name = field("name"), title = field("title"), organization = field("organization"), relationship = field("relationship"), email = field("email"), phone = field("phone"), context = field("approvedContextLine");
      ensure(name && title && organization && relationship && email && phone, "REFERENCE_FIELDS_INVALID");
      referenceSheet.push(row([name!], " ", { after: 40 }), row([title!, organization!], ", ", { after: 40 }),
        row([relationship!], " ", { after: 40 }), row([email!], " ", { role: "REFERENCE_EMAIL", after: 40 }), row([phone!], " ", { after: context ? 40 : 200 }),
        ...(context ? [row([context], " ", { after: 200 })] : []));
    }
  }
  ensure(emitted.length === byId.size && new Set(emitted.map((claim) => claim.claimId)).size === byId.size, "CLAIM_SET_INCOMPLETE");
  ensure([letter.introduction.text, ...letter.body.flat().map((claim) => claim.text), letter.closing.text].join(" ").split(/\s+/u).length <= DOCUMENT_REQUIREMENTS.coverLetter.supportedWordMaximum, "LETTER_REFIT_REQUIRED");
  return { RESUME: resume, COVER_LETTER: coverLetter, ...(referenceSheet ? { REFERENCE_SHEET: referenceSheet } : {}) };
}

function documentRows(rows: Row[], artifact: ArtifactType): Paragraph[] {
  return rows.map((entry) => {
    if (entry.heading) return majorHeading(entry.text, entry.before ?? 0);
    if (entry.bullet) return new Paragraph({ numbering: { reference: "resume-bullets", level: 0 }, keepLines: true,
      spacing: { line: DOCUMENT_REQUIREMENTS.lineSpacingTwips.bullets, after: 0 }, children: [new TextRun({ text: entry.text, font: DOCUMENT_REQUIREMENTS.font, size: 20 })] });
    if (entry.role === "REFERENCE_EMAIL") return new Paragraph({ alignment: AlignmentType.LEFT, keepLines: true,
      spacing: { after: entry.after ?? 40, line: DOCUMENT_REQUIREMENTS.lineSpacingTwips.summary },
      children: [new ExternalHyperlink({ link: `mailto:${entry.text}`, children: [new TextRun({ text: entry.text, font: DOCUMENT_REQUIREMENTS.font, size: 21, color: "000000" })] })] });
    if (entry.role === "CONTACT" || entry.role === "LINK") {
      const children = entry.claims.flatMap((claim, index) => {
        const value = claim.text, link = claim.placement.endsWith(".email") ? `mailto:${value}` : entry.role === "LINK" ? value : null;
        const style = { text: value, font: DOCUMENT_REQUIREMENTS.font, size: 19, color: "000000" };
        return [...(index ? [new TextRun({ ...style, text: " | " })] : []), link
          ? new ExternalHyperlink({ link, children: [new TextRun(style)] }) : new TextRun(style)];
      });
      return new Paragraph({ style: "ContactInformation", alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: entry.after ?? 0 }, children });
    }
    return paragraph(entry.text, { before: entry.before, after: entry.after,
      line: artifact === "COVER_LETTER" ? DOCUMENT_REQUIREMENTS.lineSpacingTwips.coverLetter : DOCUMENT_REQUIREMENTS.lineSpacingTwips.summary,
      size: entry.role === "NAME" ? 36 : 21, alignment: entry.role === "NAME" ? AlignmentType.CENTER : AlignmentType.LEFT,
      bold: entry.role === "TITLE" || entry.role === "SUBJECT", style: entry.role === "NAME" ? "CandidateName" : entry.role === "TITLE" ? "JobTitle" : undefined,
      keepNext: entry.role === "TITLE" || entry.role === "SIGNOFF", keepLines: true });
  });
}

/** Same legacy package checks, plus an exact source-derived content/list plan.
 * Only a source with no list items may omit lists. This does not alter the old
 * inspector or claim that the resulting PDF has passed actual rendering. */
export async function inspectDraftDocx(callerBuffer: Buffer, callerInput: Input, artifact: ArtifactType) {
  const input = structuredClone(callerInput), rows = sourcePlans(input)[artifact], buffer = Buffer.from(callerBuffer);
  try {
    ensure(rows, "ARTIFACT_SCOPE_INVALID");
    const legacy = await inspectDocxPackage(buffer, artifact);
    const zip = await JSZip.loadAsync(buffer), xml = await zip.file("word/document.xml")?.async("string") ?? "";
    const core = await zip.file("docProps/core.xml")?.async("string") ?? "", relationships = await zip.file("word/_rels/document.xml.rels")?.async("string") ?? "";
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu)].map((match) => match[0]);
    const expectedLinks = rows!.flatMap(expectedRowLinks).map((link) => link.target).sort();
    const relations = [...relationships.matchAll(/<Relationship\b([^>]+)\/?\s*>/gu)].map((match) => ({
      id: /\bId="([^"]+)"/u.exec(match[1])?.[1] ?? "", external: /\bTargetMode="External"/u.test(match[1]),
      hyperlink: /\bType="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/hyperlink"/u.test(match[1]),
      target: decodeXmlText(/\bTarget="([^"]+)"/u.exec(match[1])?.[1] ?? "") }));
    const byRelationId = new Map(relations.map((relation) => [relation.id, relation]));
    const actualLinks = relations.filter((relation) => relation.external).map((relation) => relation.target).sort();
    const linksBoundToParagraphs = paragraphs.length === rows.length && paragraphs.every((part, index) => {
      const links = [...part.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/gu)].map((match) => {
        const relation = byRelationId.get(/\br:id="([^"]+)"/u.exec(match[1])?.[1] ?? "");
        return { text: paragraphText(match[2]), target: relation?.external && relation.hyperlink ? relation.target : null };
      });
      return JSON.stringify(links) === JSON.stringify(expectedRowLinks(rows[index]));
    });
    const metadata = metadataForDraft(input, artifact);
    const expectedListItems = rows.filter((entry) => entry.bullet).length, listItems = (xml.match(/<w:numPr>/gu) ?? []).length;
    const expectedText = text(rows.map((entry) => entry.text).join(" "));
    const checks = { ...legacy.checks, nativeBullets: listItems === expectedListItems && (expectedListItems === 0 || legacy.checks.nativeBullets),
      exactReviewedText: legacy.extractedText === expectedText,
      exactParagraphCount: paragraphs.length === rows.length,
      exactParagraphText: paragraphs.length === rows.length && paragraphs.every((part, index) => paragraphText(part) === text(rows[index].text)),
      exactParagraphStructure: paragraphs.length === rows.length && paragraphs.every((part, index) => Boolean(rows[index].bullet) === /<w:numPr>/u.test(part)
        && Boolean(rows[index].heading) === /<w:pStyle\b[^>]*\bw:val="Heading1"/u.test(part)),
      exactContactLinks: relations.every((relation) => relation.id) && byRelationId.size === relations.length && linksBoundToParagraphs
        && JSON.stringify(actualLinks) === JSON.stringify(expectedLinks),
      exactMetadata: core.includes(`<dc:title>${xmlText(metadata.title)}</dc:title>`) && core.includes(`<dc:creator>${xmlText(metadata.author)}</dc:creator>`)
        && core.includes(`<dc:subject>${xmlText(metadata.subject)}</dc:subject>`),
      exactHeadingCount: (xml.match(/<w:pStyle\b[^>]*\bw:val="Heading1"/gu) ?? []).length === rows.filter((entry) => entry.heading).length };
    const packageQaSha256 = hash(JSON.stringify({ generator: DRAFT_DOCX_GENERATOR_VERSION, artifact, sourceSha256: input.source.renderSourceSha256,
      legacyPackageQaSha256: legacy.packageQaSha256, expectedListItems, checks }));
    return { ...legacy, checks, packageQaSha256, passed: Object.values(checks).every(Boolean),
      sourceExpectation: { renderSourceSha256: input.source.renderSourceSha256, expectedListItems, expectedTextSha256: hash(expectedText) } };
  } finally { buffer.fill(0); }
}

function mappings(packet: DraftingEvidencePacket): RequirementMapping[] {
  const known = new Set(packet.ownerEvidence.facts.map((fact) => fact.id));
  const result: RequirementMapping[] = packet.ownerEvidence.requirements.map((node) => {
    const decisions = packet.ownerEvidence.matchReviews.map((review) => record(review.decision)).filter((decision) => decision.stableCriterionId === node.stable_criterion_id);
    ensure(decisions.length <= 1, "REQUIREMENT_REVIEW_AMBIGUOUS");
    const decision = decisions[0], evidence = Array.isArray(decision?.sourceEvidenceNodeIds) ? decision.sourceEvidenceNodeIds : [];
    const supported = decision?.disposition === "RESOLVED_PASS" && evidence.includes(node.id);
    const classification = supported && decision.evidenceRelation === "DIRECT" ? "DIRECT_EVIDENCE"
      : supported && decision.evidenceRelation === "ADJACENT" && decision.adjacentEquivalenceReviewId ? "TRANSFERABLE_EVIDENCE" : "UNKNOWN";
    const candidateFactIds = classification === "UNKNOWN" ? [] : Array.isArray(decision.candidateFactVersionIds) ? decision.candidateFactVersionIds.map(String) : [];
    ensure(classification === "UNKNOWN" || candidateFactIds.length > 0 && candidateFactIds.every((id) => known.has(id)), "REQUIREMENT_SOURCE_INVALID");
    return { jobEvidenceId: node.id, classification, candidateFactIds: unique(candidateFactIds) };
  });
  assertCurrentRequirementMappings(result, packet.ownerEvidence.requirements, packet.ownerEvidence.matchReviews);
  return result;
}

/** Pure preparation: real editable DOCX files, never approval or delivery.
 * Callers must load these inputs from their exact encrypted server records. */
export async function prepareDraftDocx(callerInput: Input, now = new Date()) {
  const input = structuredClone(callerInput);
  ensure(Number.isFinite(now.getTime()) && Date.parse(input.source.validUntil) > now.getTime(), "EVIDENCE_EXPIRED");
  return prepareBoundDocx(input);
}

/** The repair boundary proves the entire accepted union and explicit099 wording
 * review. It does not make the original paid packet current. Only this selected
 * artifact is constructed; unrelated DOCX/PDF/reference bytes are not generated. */
export async function prepareServiceRepairDocx(member: ServiceRepairBoundMember) {
  assertBoundServiceRepairMember(member);
  const prepared = await prepareBoundDocx({ source: member.source, packet: member.packet }, [member.artifactType]);
  const artifact = member.artifactType === "RESUME" ? prepared.resume : member.artifactType === "COVER_LETTER" ? prepared.coverLetter : prepared.referenceSheet;
  ensure(artifact, "ARTIFACT_SCOPE_INVALID");
  return { ...artifact, provenance: { ...artifact.provenance, serviceRepair: structuredClone(member.serviceRepair) } };
}

async function prepareBoundDocx(callerInput: Input, selected?: ArtifactType[]) {
  const input = structuredClone(callerInput);
  const plans = sourcePlans(input), { source, packet } = input;
  const mapping = mappings(packet), target = packet.ownerEvidence.targetJob;
  const applicant = source.resume.header.find((claim) => claim.placement.endsWith(".displayName"))!.text;
  const buffers: Buffer[] = [];
  try {
    const result = {} as Record<ArtifactType, PreparedDraftDocxArtifact>;
    const artifactTypes: ArtifactType[] = selected ?? ["RESUME", "COVER_LETTER", ...(plans.REFERENCE_SHEET ? ["REFERENCE_SHEET" as const] : [])];
    for (const artifact of artifactTypes) {
      const rows = plans[artifact];
      ensure(rows, "ARTIFACT_SCOPE_INVALID");
      const units = rows.reduce((total, entry) => total + Math.max(1, Math.ceil(entry.text.length / 85)) + (entry.heading ? 2 : entry.role === "NAME" ? 3 : 0), 6);
      ensure(artifact !== "RESUME" || units <= 150, "RESUME_REFIT_REQUIRED");
      const expectedPageCount: 1 | 2 = artifact === "RESUME" && units > 65 ? 2 : 1;
      ensure(expectedPageCount <= (source.outputRules.resumePageLimit ?? 2) || artifact !== "RESUME", "EMPLOYER_PAGE_LIMIT");
      const metadata = metadataForDraft(input, artifact);
      const buffer = await packCleanDocument(documentWith(documentRows(rows, artifact), metadata), metadata); buffers.push(buffer);
      const inspection = await inspectDraftDocx(buffer, input, artifact);
      ensure(inspection.passed, "PACKAGE_INSPECTION_FAILED");
      const ownerReviewClaims = structuredClone(rows.flatMap((entry) => entry.claims));
      const claims: DraftClaimProvenance[] = ownerReviewClaims.map((claim) => ({ placement: claim.placement, kind: claim.kind,
        candidateFactIds: unique(claim.factRefs.map((ref) => ref.factId)), jobEvidenceIds: [...claim.jobEvidenceIds],
        referencePermissionIds: [...claim.referencePermissionIds], visibleTextSha256: claim.wordingSha256,
        ...(claim.kind === "REFERENCE_PERMISSION" ? { referenceBinding: structuredClone(claim.referenceBinding) } : {}) }));
      const sourceBinding = { candidateFactIds: unique(claims.flatMap((claim) => claim.candidateFactIds)),
        jobEvidenceIds: unique(packet.ownerEvidence.requirements.map((node) => node.id)), referencePermissionIds: unique(claims.flatMap((claim) => claim.referencePermissionIds)) };
      const provenance: DraftProvenance = { schemaVersion: "applypack-claim-provenance-v1", artifact, generatorVersion: DRAFT_DOCX_GENERATOR_VERSION,
        ...(artifact === "REFERENCE_SHEET" ? { referenceBindings: structuredClone(packet.ownerEvidence.referenceBindings!) } : {}),
        sourceBinding, claims, fitActions: ["preserved_reviewed_source_order", ...(expectedPageCount === 2 ? ["substantive_two_page_resume"] : [])], requirementMappings: mapping,
        matchingReviewIds: packet.ownerEvidence.matchReviews.map((review) => review.id), postingContentSha256: packet.binding.jobSha256,
        jobBinding: { canonicalApplicationUrl: target.canonicalApplicationUrl, retrievedAt: target.retrievedAt, postedOn: null },
        cacheIdentitySha256: hash(JSON.stringify({ artifact, source: source.renderSourceSha256, packet: packet.packetSha256, versions: DRAFT_DOCX_VERSIONS })),
        versions: DRAFT_DOCX_VERSIONS, draftSource: { renderSourceSha256: source.renderSourceSha256, proposalSourceSha256: source.proposalSourceSha256, packetSha256: packet.packetSha256 } };
      const referenceFilename = "referenceFilenameInstruction" in packet.ownerEvidence ? packet.ownerEvidence.referenceFilenameInstruction : null;
      result[artifact] = { buffer, filename: materialFilename({ displayName: applicant, artifact: artifact === "RESUME" ? "Resume" : artifact === "COVER_LETTER" ? "Cover_Letter" : "References", company: target.company,
        position: target.exactTitle, extension: "docx", employerInstruction: artifact === "RESUME" ? packet.ownerEvidence.employerInstructions.resume_filename_instruction
          : artifact === "COVER_LETTER" ? packet.ownerEvidence.employerInstructions.cover_letter_filename_instruction : typeof referenceFilename === "string" ? referenceFilename : null }),
        mimeType: MIME, metadata, provenance, expectedPageCount, versions: DRAFT_DOCX_VERSIONS, ownerReviewClaims,
        inspection, state: "OWNER_REVIEW_REQUIRED", deliveryAuthorized: false };
    }
    return { resume: result.RESUME, coverLetter: result.COVER_LETTER, ...(result.REFERENCE_SHEET ? { referenceSheet: result.REFERENCE_SHEET } : {}), generatorVersion: DRAFT_DOCX_GENERATOR_VERSION, renderSourceSha256: source.renderSourceSha256,
      state: "OWNER_REVIEW_REQUIRED" as const, deliveryAuthorized: false as const };
  } catch (error) { buffers.forEach((buffer) => buffer.fill(0)); throw error; }
}

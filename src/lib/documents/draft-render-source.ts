import { createHash } from "node:crypto";
import { isUint8Array } from "node:util/types";
import { z } from "zod";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { experienceKindLabels } from "@/lib/intake/four-step";
import { assertDeliverableText } from "@/lib/materials/contract";
import { materialContactSchema } from "@/lib/materials/server";
import { serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "./drafting-evidence";
import { serializeDraftProposal, validateDraftOutput, type ValidatedDraftProposal } from "./draft-output";
import { draftReferenceBindingSchema, readDraftReferenceSources, type DraftReferenceInput, type DraftReferenceField } from "./draft-reference-source";

export const DRAFT_RENDER_SOURCE_VERSION = "applypack-draft-render-source-v1";
type Fact = DraftingEvidencePacket["ownerEvidence"]["facts"][number];
export type DraftRenderFactRef = { factId: string; field: string; valueSha256: string; attributionFactId: string };
export type DraftRenderText = {
  claimId: string; placement: string; text: string; wordingSha256: string;
  kind: "CANDIDATE_FACT" | "JOB_EVIDENCE" | "MIXED" | "NARRATIVE" | "REFERENCE_PERMISSION";
  origin: "MODEL_PROPOSAL" | "LOCAL_FACT" | "LOCAL_JOB" | "LOCAL_CONTACT" | "CUSTOMER_PRESENTATION" | "FIXED_PRESENTATION" | "LOCAL_REFERENCE";
  qualification: "EXACT" | "QUALIFIED_TRANSFER" | "NONFACTUAL";
  factRefs: DraftRenderFactRef[]; jobEvidenceIds: string[]; referencePermissionIds: string[];
  contactBinding: { payloadId: string; contentSha256: string; fields: string[] } | null;
  referenceBinding?: { permissionId: string; recordVersionId: string; payloadId: string; contentSha256: string; field: DraftReferenceField };
  questionInsights: ValidatedDraftProposal["reviews"][number]["questionInsights"];
  state: "OWNER_REVIEW_REQUIRED";
};
export class DraftRenderSourceError extends Error {
  constructor(code: string) { super(`DRAFT_RENDER_SOURCE_${code}`); this.name = "DraftRenderSourceError"; }
}
const requireThat = (value: unknown, code: string): void => { if (!value) throw new DraftRenderSourceError(code); };
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const unique = (values: string[]) => [...new Set(values)].sort();
function immutable<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
function exactJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exactJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${exactJson(object[key])}`).join(",")}}`;
  }
  throw new DraftRenderSourceError("JSON_INVALID");
}
function visible(value: string) {
  requireThat(!/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]|<[^>]*>/u.test(value), "LOCAL_TEXT_UNSAFE");
  return assertDeliverableText(value);
}
function claimId(sourceSha256: string, placement: string) {
  const hash = canonicalSha256({ sourceSha256, placement });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** This produces reviewable document content, never a delivery authorization.
 * Local headers use the frozen owner evidence and authenticated contact bytes.
 * New prose remains subject to exact wording review and the separate DB fence;
 * it is not routed through or exempted from the legacy extractive validator. */
export function buildDraftRenderSource(input: {
  packet: DraftingEvidencePacket; proposal: ValidatedDraftProposal;
  contact: { payloadId: string; plaintext: Uint8Array }; finalVersionAt: string;
  careerBreakFactId?: string;
  references?: readonly DraftReferenceInput[];
}, now = new Date()) {
  let ownedContact: Buffer | null = null;
  try {
    const { packet, proposal } = input;
    serializeDraftingEvidencePacket(packet);
    serializeDraftProposal(proposal);
    requireThat(Number.isFinite(now.getTime()) && z.iso.datetime({ offset: true }).safeParse(input.finalVersionAt).success
      && Date.parse(input.finalVersionAt) <= now.getTime(), "CLOCK_INVALID");
    requireThat(proposal.evidencePacketSha256 === packet.packetSha256 && proposal.providerViewSha256 === packet.providerViewSha256
      && canonicalSha256(proposal.expected) === canonicalSha256(packet.expected), "PACKET_MISMATCH");
    const verified = validateDraftOutput(proposal.output, packet, now);
    requireThat(verified.sourceSha256 === proposal.sourceSha256, "PROPOSAL_MISMATCH");
    requireThat(input.contact.payloadId === packet.binding.contactPayloadId && isUint8Array(input.contact.plaintext)
      && input.contact.plaintext.byteLength > 0 && input.contact.plaintext.byteLength <= 8_192, "CONTACT_BINDING_INVALID");
    ownedContact = Buffer.from(input.contact.plaintext);
    requireThat(digest(ownedContact) === packet.binding.contactSha256, "CONTACT_DIGEST_INVALID");
    const contact = materialContactSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(ownedContact)));
    ownedContact.fill(0); ownedContact = null;
    if (contact.linkedInOrPortfolio) {
      const url = new URL(contact.linkedInOrPortfolio);
      requireThat(url.protocol === "https:" && !url.username && !url.password && !url.hash
        && ![...url.searchParams.keys()].some((key) => /token|password|secret|authorization|session/i.test(key)), "CONTACT_LINK_UNSAFE");
    }
    const facts = new Map(packet.ownerEvidence.facts.map((fact) => [fact.id, fact]));
    const providerFacts = new Map(packet.providerView.facts.map((fact) => [fact.id, fact]));
    requireThat(facts.size === packet.ownerEvidence.facts.length, "FACT_AMBIGUOUS");
    const reviewByPlacement = new Map(verified.reviews.map((review) => [review.placement, review]));
    const claims: DraftRenderText[] = [];
    const block = (placement: string, text: string, options: Omit<DraftRenderText, "claimId" | "placement" | "text" | "wordingSha256" | "state" | "referencePermissionIds">): DraftRenderText => {
      const finalText = visible(text);
      const value = { ...options, claimId: claimId(proposal.sourceSha256, placement), placement, text: finalText,
        wordingSha256: digest(finalText), referencePermissionIds: [], state: "OWNER_REVIEW_REQUIRED" as const };
      claims.push(value); return value;
    };
    const refs = (factId: string, fields: string[], attributionFactId = factId): DraftRenderFactRef[] => fields.map((field) => {
      requireThat(/^[A-Za-z][A-Za-z0-9_]{0,59}(\.[0-9]{1,3})?$/.test(field), "FACT_FIELD_INVALID");
      const fact = facts.get(factId), ownerValue = record(fact?.typed_value);
      requireThat(fact && fact.snapshot_id === packet.binding.snapshotId && (fact.customer_id === null || fact.customer_id === packet.expected.customerId)
        && [factId, ownerValue.employmentFactId].includes(attributionFactId), "FACT_BINDING_INVALID");
      const value = field.split(".").reduce<unknown>((parent, key) => Array.isArray(parent) ? parent[Number(key)] : record(parent)[key], ownerValue);
      requireThat(typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)
        && !/[eE]/.test(JSON.stringify(value)), "FACT_SCALAR_UNSUPPORTED");
      // PostgreSQL jsonb scalar text: no domain whitespace normalization. Numeric
      // exponent forms are rejected rather than guessing database serialization.
      return { factId, field, valueSha256: digest(JSON.stringify(value)), attributionFactId };
    });
    const local = (fact: Fact, placement: string, text: string, fields: string[]) => block(placement, text, {
      kind: "CANDIDATE_FACT", origin: "LOCAL_FACT", qualification: providerFacts.get(fact.id)?.disposition === "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE" ? "QUALIFIED_TRANSFER" : "EXACT",
      factRefs: refs(fact.id, fields), jobEvidenceIds: [], contactBinding: null, questionInsights: [],
    });
    const prose = (placement: string) => {
      const review = reviewByPlacement.get(placement);
      requireThat(review, "CLAIM_REVIEW_MISSING");
      return block(placement, review!.text, { kind: review!.jobEvidenceIds.length ? "MIXED" : "CANDIDATE_FACT", origin: "MODEL_PROPOSAL",
        qualification: review!.relation === "DIRECT" ? "EXACT" : "QUALIFIED_TRANSFER",
        factRefs: review!.sources.flatMap((source) => refs(source.factId, [source.path.replace(/^\//, "").replaceAll("/", ".")], review!.attributionFactId ?? source.factId)),
        jobEvidenceIds: [...review!.jobEvidenceIds], contactBinding: null, questionInsights: review!.questionInsights,
      });
    };
    const contactFact = packet.ownerEvidence.contactFact;
    requireThat(contactFact.id === packet.binding.contactPayloadId && contactFact.typed_value.protectedPayloadId === packet.binding.contactPayloadId
      && contactFact.typed_value.contentSha256 === packet.binding.contactSha256 && contactFact.customer_id === packet.expected.customerId, "CONTACT_FACT_INVALID");
    const contactText = (placement: string, field: keyof typeof contact) => block(placement, String(contact[field]), {
      kind: "CANDIDATE_FACT", origin: "LOCAL_CONTACT", qualification: "EXACT",
      factRefs: [{ factId: contactFact.id, field: "contentSha256", valueSha256: digest(JSON.stringify(contactFact.typed_value.contentSha256)), attributionFactId: contactFact.id }], jobEvidenceIds: [],
      contactBinding: { payloadId: input.contact.payloadId, contentSha256: packet.binding.contactSha256, fields: [field] }, questionInsights: [],
    });
    const contactHeader = (prefix: string) => ["displayName", "email", "phone", "cityState", ...(contact.linkedInOrPortfolio ? ["linkedInOrPortfolio"] : [])]
      .map((field) => contactText(`${prefix}.contact.${field}`, field as keyof typeof contact));
    const jobIds = unique(packet.providerView.requirements.map((node) => node.id));
    const targetJob = packet.ownerEvidence.targetJob;
    requireThat(targetJob.id === packet.binding.jobSnapshotId && targetJob.contentSha256 === packet.binding.jobSha256, "TARGET_JOB_BINDING_INVALID");
    const jobText = (placement: string, text: string) => block(placement, text, { kind: "JOB_EVIDENCE", origin: "LOCAL_JOB",
      qualification: "EXACT", factRefs: [], jobEvidenceIds: jobIds, contactBinding: null, questionInsights: [] });
    const fixed = (placement: string, text: string) => block(placement, text, { kind: "NARRATIVE", origin: "FIXED_PRESENTATION",
      qualification: "NONFACTUAL", factRefs: [], jobEvidenceIds: [], contactBinding: null, questionInsights: [] });
    const dateHeader = (fact: Fact, placement: string): DraftRenderText | null => {
      const value = record(fact.typed_value);
      const precision = value.datePrecision;
      if (precision === "UNKNOWN") return null;
      if (!value.startsOn && !value.endsOn && typeof value.dates === "string" && value.dates.trim()) {
        let dates = value.dates;
        if (precision === "YEAR") {
          const years = dates.match(/\b\d{4}\b/g) ?? [];
          requireThat(years.length > 0 && years.length <= 2, "DATE_SOURCE_INVALID");
          dates = [...years, ...(/\bpresent\b/i.test(dates) ? ["Present"] : [])].join(" - ");
        } else if (precision === "MONTH") {
          requireThat(/^\d{4}-\d{2}(?:\s+-\s+(?:\d{4}-\d{2}|Present))?$/i.test(dates), "DATE_SOURCE_INVALID");
        }
        return local(fact, placement, dates, ["dates", ...(typeof precision === "string" ? ["datePrecision"] : [])]);
      }
      const format = (date: unknown) => {
        if (date === null || date === undefined || date === "") return null;
        requireThat(typeof date === "string", "DATE_SOURCE_INVALID");
        const pattern = precision === "YEAR" ? /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/ : precision === "MONTH" ? /^\d{4}-\d{2}(?:-\d{2})?$/ : /^\d{4}-\d{2}-\d{2}$/;
        requireThat(pattern.test(String(date)), "DATE_SOURCE_INVALID");
        return String(date).slice(0, precision === "YEAR" ? 4 : precision === "MONTH" ? 7 : 10);
      };
      const start = format(value.startsOn), end = format(value.endsOn);
      requireThat(!(value.current === true && end), "DATE_SOURCE_INVALID");
      if (!start && !end) return null;
      const fields = [...(start ? ["startsOn"] : []), ...(end ? ["endsOn"] : []), ...(value.current === true ? ["current"] : []), ...(typeof precision === "string" ? ["datePrecision"] : [])];
      return local(fact, placement, [start, value.current === true ? "Present" : end].filter(Boolean).join(" - "), fields);
    };
    const fieldHeader = (fact: Fact, placement: string, candidates: string[]) => {
      const value = record(fact.typed_value), key = candidates.find((field) => typeof value[field] === "string" && String(value[field]).trim());
      return key ? local(fact, placement, String(value[key]), [key]) : null;
    };
    const sections = verified.output.resume.sections.map((section, index) => {
      const fact = facts.get(section.anchorFactId);
      requireThat(fact, "SECTION_FACT_MISSING");
      const value = record(fact!.typed_value), kind = typeof value.kind === "string" ? value.kind : fact!.value_kind;
      requireThat(!packet.providerView.background.noPriorEmployment || !["PAID_EMPLOYMENT", "SELF_EMPLOYMENT_BUSINESS", "CONTRACT_FREELANCE"].includes(kind), "BACKGROUND_CONTRADICTION");
      const heading = kind in experienceKindLabels ? experienceKindLabels[kind as keyof typeof experienceKindLabels] : "Experience";
      const prefix = `resume.sections.${index}`;
      const header = [fieldHeader(fact!, `${prefix}.role`, ["historicalTitle", "roleOrRelationship"]),
        fieldHeader(fact!, `${prefix}.organization`, ["employer", "employerOrOrganization", "organizationOrProject"]),
        dateHeader(fact!, `${prefix}.dates`)].filter((line): line is DraftRenderText => Boolean(line));
      requireThat(header.length > 0, "SECTION_HEADER_MISSING");
      return { heading, anchorFactId: fact!.id, header, bullets: section.bullets.map((_, item) => prose(`${prefix}.bullets.${item}`)) };
    });
    const education = verified.output.resume.educationFactIds.map((factId, index) => {
      const fact = facts.get(factId); requireThat(fact, "EDUCATION_FACT_MISSING");
      const prefix = `resume.education.${index}`, value = record(fact!.typed_value);
      const header = [fieldHeader(fact!, `${prefix}.credential`, ["credentialName", "educationLevel", "roleOrRelationship"]),
        fieldHeader(fact!, `${prefix}.field`, ["educationField"]),
        fieldHeader(fact!, `${prefix}.institution`, ["issuingOrganization", "employerOrOrganization", "organizationOrProject"]),
        dateHeader(fact!, `${prefix}.dates`)].filter((line): line is DraftRenderText => Boolean(line));
      requireThat(header.length > 0, "EDUCATION_HEADER_MISSING");
      if (typeof value.completionStatus === "string" && value.completionStatus.trim()) {
        const labels: Record<string, string> = { IN_PROGRESS: "In progress", PENDING: "Pending", PLANNED: "Planned", UNKNOWN: "Completion not confirmed", COMPLETED: "Completed", INCOMPLETE: "Not completed" };
        header.push(local(fact!, `${prefix}.completion`, labels[value.completionStatus] ?? value.completionStatus, ["completionStatus"]));
      } else if (providerFacts.get(factId)?.disposition === "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE") {
        throw new DraftRenderSourceError("EDUCATION_QUALIFICATION_MISSING");
      }
      return { heading: "Education and credentials", anchorFactId: factId, header };
    });
    const instructions = packet.providerView.customerInstructions;
    let careerBreak: { choice: string; sourceFactId: string; selection: "OWNER_SELECTED" | "UNIQUE_CONFIRMED_SOURCE"; label: DraftRenderText; dates: DraftRenderText } | null = null;
    if (!["KEEP_EXISTING_TIMELINE", "OMIT_ENTRY"].includes(instructions.careerBreakChoice)) {
      const eligible = packet.ownerEvidence.facts.filter((fact) => {
        const value = record(fact.typed_value);
        const kinds = [fact.value_kind, value.kind].filter((kind): kind is string => typeof kind === "string");
        const labels = [value.historicalTitle, value.roleOrRelationship].filter((label): label is string => typeof label === "string");
        return providerFacts.get(fact.id)?.disposition !== "NEGATIVE_DO_NOT_ASSERT" &&
          (kinds.some((kind) => ["CAREER_BREAK", "CAREGIVING"].includes(kind)) || labels.some((label) => /^(?:career break|family caregiving|caregiving)$/i.test(label.trim())));
      });
      const selected = input.careerBreakFactId ? eligible.find((fact) => fact.id === input.careerBreakFactId) : eligible.length === 1 ? eligible[0] : null;
      requireThat(!input.careerBreakFactId || selected, "CAREER_BREAK_SOURCE_INVALID");
      requireThat(selected, eligible.length > 1 ? "OWNER_CLARIFICATION_CAREER_BREAK_SOURCE_AMBIGUOUS" : "OWNER_CLARIFICATION_CAREER_BREAK_DATES_REQUIRED");
      const value = record(selected!.typed_value);
      const structuredRange = Boolean(value.startsOn && (value.endsOn || value.current === true));
      const exactRecordedRange = typeof value.dates === "string" && /\d{4}/.test(value.dates)
        && /(?:\s[-–—]\s|\s(?:to|through)\s)/i.test(value.dates) && (value.dates.match(/\b\d{4}\b/g)?.length === 2 || /\bpresent\b/i.test(value.dates));
      requireThat(value.datePrecision !== "UNKNOWN" && (structuredRange || exactRecordedRange), "OWNER_CLARIFICATION_CAREER_BREAK_DATES_REQUIRED");
      const dates = dateHeader(selected!, "resume.careerBreak.dates");
      requireThat(dates, "OWNER_CLARIFICATION_CAREER_BREAK_DATES_REQUIRED");
      const label = instructions.careerBreakChoice === "FAMILY_CAREGIVING" ? "Family caregiving"
        : instructions.careerBreakChoice === "CAREER_BREAK" ? "Career break" : instructions.careerBreakCustomLabel;
      requireThat(typeof label === "string" && label.trim(), "OWNER_CLARIFICATION_CAREER_BREAK_LABEL_REQUIRED");
      careerBreak = { choice: instructions.careerBreakChoice, sourceFactId: selected!.id, selection: input.careerBreakFactId ? "OWNER_SELECTED" : "UNIQUE_CONFIRMED_SOURCE", dates: dates!,
        label: block("resume.careerBreak.label", label!, { kind: "CANDIDATE_FACT", origin: "CUSTOMER_PRESENTATION", qualification: "QUALIFIED_TRANSFER",
          factRefs: dates!.factRefs, jobEvidenceIds: [], contactBinding: null, questionInsights: [] }) };
    } else requireThat(input.careerBreakFactId === undefined, "CAREER_BREAK_SOURCE_NOT_SELECTED");
    requireThat(instructions.mentionBreakInLetter || !verified.output.coverLetter.body.some((paragraph) => paragraph.sentences.some((claim) => /career break|family caregiving/i.test(claim.text))), "CAREER_BREAK_CONSENT_REQUIRED");
    const resume = { header: contactHeader("resume"), summary: verified.output.resume.summary.map((_, index) => prose(`resume.summary.${index}`)),
      skills: verified.output.resume.skills.map((_, index) => prose(`resume.skills.${index}`)), sections, education, careerBreak };
    const coverLetter = { header: contactHeader("coverLetter"), date: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "long", day: "numeric" }).format(new Date(input.finalVersionAt)),
      recipient: jobText("coverLetter.recipient", `${targetJob.company} Hiring Team`),
      subject: jobText("coverLetter.subject", targetJob.exactTitle), salutation: "Dear Hiring Team,",
      introduction: jobText("coverLetter.introduction", `I am applying for the ${targetJob.exactTitle} position at ${targetJob.company}.`),
      body: verified.output.coverLetter.body.map((paragraph, index) => paragraph.sentences.map((_, item) => prose(`coverLetter.body.${index}.sentences.${item}`))),
      closing: fixed("coverLetter.closing", "Thank you for your consideration."), signoff: "Sincerely,", signature: contactText("coverLetter.signature", "displayName") };
    let referenceSheet: { header: DraftRenderText[]; records: Array<{ permissionId: string; recordVersionId: string; payloadId: string; contentSha256: string; fields: DraftRenderText[] }> } | undefined;
    const permissionBindings = packet.binding.referencePermissions;
    const rawReferenceBindings = "referenceBindings" in packet.ownerEvidence ? packet.ownerEvidence.referenceBindings : undefined;
    if (permissionBindings.length) {
      requireThat(permissionBindings.length <= 3, "REFERENCE_COUNT_UNSUPPORTED");
      const bindings = z.array(draftReferenceBindingSchema).min(1).max(3).parse(rawReferenceBindings);
      requireThat(bindings.length === permissionBindings.length && bindings.every((binding) => {
        const permission = permissionBindings.find((entry) => entry.id === binding.permissionId);
        return permission && permission.reference_record_version_id === binding.recordVersionId && permission.delivered_release_id === binding.deliveredReleaseId
          && permission.job_snapshot_id === binding.jobSnapshotId && permission.job_snapshot_hash === binding.jobSha256
          && binding.jobSnapshotId === packet.binding.jobSnapshotId && binding.jobSha256 === packet.binding.jobSha256;
      }), "REFERENCE_SCOPE_INVALID");
      const records = readDraftReferenceSources(bindings, input.references ?? [], now);
      referenceSheet = { header: contactHeader("referenceSheet"), records: records.map(({ binding, fields }, index) => ({
        permissionId: binding.permissionId, recordVersionId: binding.recordVersionId, payloadId: binding.payloadId, contentSha256: binding.contentSha256,
        fields: fields.map(({ field, value }) => {
          const text = visible(value), placement = `referenceSheet.records.${index}.${field}`;
          requireThat(text === value, "REFERENCE_TEXT_INVALID");
          const claim: DraftRenderText = { claimId: claimId(proposal.sourceSha256, placement), placement, text, wordingSha256: digest(text), kind: "REFERENCE_PERMISSION",
            origin: "LOCAL_REFERENCE", qualification: "EXACT", factRefs: [], jobEvidenceIds: [], referencePermissionIds: [binding.permissionId], contactBinding: null,
            referenceBinding: { permissionId: binding.permissionId, recordVersionId: binding.recordVersionId, payloadId: binding.payloadId, contentSha256: binding.contentSha256, field },
            questionInsights: [], state: "OWNER_REVIEW_REQUIRED" };
          claims.push(claim); return claim;
        }),
      })) };
    } else requireThat(!input.references?.length && rawReferenceBindings === undefined, "REFERENCE_SCOPE_NOT_SELECTED");
    requireThat(claims.length <= 250 && new Set(claims.map((claim) => claim.claimId)).size === claims.length, "CLAIM_BOUND_EXCEEDED");
    const source = { schemaVersion: DRAFT_RENDER_SOURCE_VERSION, expected: packet.expected, packetSha256: packet.packetSha256,
      proposalSourceSha256: proposal.sourceSha256, contactPayloadId: packet.binding.contactPayloadId, contactSha256: packet.binding.contactSha256,
      finalVersionAt: input.finalVersionAt, validUntil: packet.validUntil, language: "en-US" as const,
      outputRules: packet.providerView.outputRules, resume, coverLetter, ...(referenceSheet ? { referenceSheet } : {}), ownerReviewClaims: claims,
      state: "OWNER_REVIEW_REQUIRED" as const, deliveryAuthorized: false as const };
    return immutable({ ...source, renderSourceSha256: digest(exactJson(source)) });
  } catch (error) {
    if (error instanceof DraftRenderSourceError) throw error;
    throw new DraftRenderSourceError("INVALID");
  } finally { ownedContact?.fill(0); }
}
export type DraftRenderSource = ReturnType<typeof buildDraftRenderSource>;

export function serializeDraftRenderSource(source: DraftRenderSource) {
  const { renderSourceSha256, ...body } = source, serialized = exactJson(body);
  requireThat(digest(serialized) === renderSourceSha256, "SOURCE_DIGEST_INVALID");
  return serialized;
}

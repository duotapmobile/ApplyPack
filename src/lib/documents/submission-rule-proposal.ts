import { z } from "zod";

export const SUBMISSION_RULE_PROPOSAL_VERSION = "applypack-submission-rule-proposal-v1";
export const submissionRuleReviewBasisSchema = z.object({
  contractVersion: z.literal("applypack-employer-rule-review-v1"), jobSnapshotId: z.uuid(),
  jobContentSha256: z.string().regex(/^[a-f0-9]{64}$/), jobRecordSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceAuthoritySha256: z.string().regex(/^[a-f0-9]{64}$/), sourceEvidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  currentRuleId: z.uuid().nullable(), currentRuleRecordSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict().refine((value) => (value.currentRuleId === null) === (value.currentRuleRecordSha256 === null));
export type SubmissionRuleReviewBasis = z.infer<typeof submissionRuleReviewBasisSchema>;

export const ruleReviewChecklistLabels = {
  listingOpened: "I opened the employer listing.",
  applicationOpened: "I opened the application instructions available for this job.",
  sourceCompared: "I compared these choices with the captured source shown here.",
  requirementsConfirmed: "I confirmed the document requirements, formats and submission method.",
  questionsReviewed: "I reviewed the captured application questions and the inspection limits.",
  noUnsupportedDefaults: "I did not fill missing instructions with assumptions.",
} as const;
export const ruleReviewChecklistSchema = z.object({ listingOpened: z.literal(true), applicationOpened: z.literal(true),
  sourceCompared: z.literal(true), requirementsConfirmed: z.literal(true), questionsReviewed: z.literal(true), noUnsupportedDefaults: z.literal(true) }).strict();
const instruction = (max: number) => z.string().trim().min(1).max(max).nullable();
export const submissionRuleChoicesSchema = z.object({
  resumeRequirement: z.enum(["REQUIRED", "OPTIONAL", "PROHIBITED"]),
  coverLetterRequirement: z.enum(["REQUIRED", "OPTIONAL", "PROHIBITED"]),
  allowedFormats: z.array(z.enum(["DOCX", "PDF"])).min(1).max(2).refine((value) => new Set(value).size === value.length).transform((value) => value.sort()),
  resumePageLimit: z.union([z.literal(1), z.literal(2)]).nullable(), coverLetterPageLimit: z.literal(1).nullable(),
  resumeFilenameInstruction: instruction(180), coverLetterFilenameInstruction: instruction(180), referenceFilenameInstruction: instruction(180),
  referenceTiming: z.enum(["OPTIONAL_NOW", "REQUIRED_NOW", "PROHIBITED_NOW", "LATER_OR_UNKNOWN"]),
  referenceCount: z.number().int().min(1).max(99).nullable(),
  submissionChannel: z.enum(["HTTPS_UPLOAD", "EMAIL", "OTHER_SUPPORTED", "UNSUPPORTED"]),
  portfolioInstruction: instruction(1000), workSampleInstruction: instruction(1000),
}).strict();
export type SubmissionRuleChoices = z.infer<typeof submissionRuleChoicesSchema>;
export type RuleChoiceField = keyof SubmissionRuleChoices;
const choiceFields = Object.keys(submissionRuleChoicesSchema.shape) as RuleChoiceField[];
const quote = z.string().trim().min(3).max(2000);
// Quotes select existing saved evidence. They never become new employer evidence.
export const ruleFieldEvidenceSchema = z.object({
  resumeRequirement: quote, coverLetterRequirement: quote, allowedFormats: quote, submissionChannel: quote,
  resumePageLimit: quote.nullable(), coverLetterPageLimit: quote.nullable(),
  resumeFilenameInstruction: quote.nullable(), coverLetterFilenameInstruction: quote.nullable(), referenceFilenameInstruction: quote.nullable(),
  referenceTiming: quote.nullable(), referenceCount: quote.nullable(), portfolioInstruction: quote.nullable(), workSampleInstruction: quote.nullable(),
}).strict();
export type RuleFieldEvidence = z.infer<typeof ruleFieldEvidenceSchema>;
export const submissionRuleConfirmationSchema = z.object({ requestId: z.uuid(), jobSnapshotId: z.uuid(),
  expectedBasis: submissionRuleReviewBasisSchema, choices: submissionRuleChoicesSchema,
  fieldEvidence: ruleFieldEvidenceSchema, checklist: ruleReviewChecklistSchema,
}).strict().refine((value) => value.jobSnapshotId === value.expectedBasis.jobSnapshotId);
export type SubmissionRuleConfirmation = z.infer<typeof submissionRuleConfirmationSchema>;
export const submissionRulePreparationSchema = z.object({ status: z.literal("PREPARATION_REQUIRED"), jobSnapshotId: z.uuid(), title: z.string().min(1).max(500), company: z.string().min(1).max(500) }).strict();
export const ruleReviewEvidenceSchema = z.object({ version: z.literal("applypack-employer-rule-citations-v1"), sourceEvidenceId: z.uuid(), sourceTextSha256: z.string().regex(/^[a-f0-9]{64}$/),
  citations: z.array(z.object({ field: z.enum(["resumeRequirement", "coverLetterRequirement", "allowedFormats", "submissionChannel", "resumePageLimit", "coverLetterPageLimit", "resumeFilenameInstruction", "coverLetterFilenameInstruction", "referenceFilenameInstruction", "referenceTiming", "referenceCount", "portfolioInstruction", "workSampleInstruction"]),
    startByte: z.number().int().nonnegative(), endByte: z.number().int().positive(), quoteSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().refine((item) => item.endByte > item.startByte)).min(4).max(13),
}).strict().refine((value) => new Set(value.citations.map((item) => item.field)).size === value.citations.length);
export type RuleReviewEvidence = z.infer<typeof ruleReviewEvidenceSchema>;
export const submissionRuleSavedSchema = z.object({ requestId: z.uuid(), jobSnapshotId: z.uuid(), expectedBasis: submissionRuleReviewBasisSchema,
  choices: submissionRuleChoicesSchema, checklist: ruleReviewChecklistSchema, reviewEvidence: ruleReviewEvidenceSchema, ruleId: z.uuid(), checkedAt: z.iso.datetime({ offset: true }), current: z.boolean() }).strict();
export type SubmissionRuleSaved = z.infer<typeof submissionRuleSavedSchema>;
export async function matchesSavedRule(raw: unknown, request: SubmissionRuleConfirmation): Promise<SubmissionRuleSaved | null> {
  const parsed = submissionRuleSavedSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;
  if (!(value.requestId === request.requestId && value.jobSnapshotId === request.jobSnapshotId
    && JSON.stringify(value.expectedBasis) === JSON.stringify(request.expectedBasis)
    && JSON.stringify(value.choices) === JSON.stringify(request.choices)
    && JSON.stringify(value.checklist) === JSON.stringify(request.checklist))) return null;
  const quotes = Object.entries(request.fieldEvidence).filter(([, text]) => text !== null);
  if (value.reviewEvidence.citations.length !== quotes.length) return null;
  for (const [field, quote] of quotes) {
    const bytes = new TextEncoder().encode(quote!), digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const citation = value.reviewEvidence.citations.find((item) => item.field === field);
    if (!citation || citation.quoteSha256 !== hash || citation.endByte - citation.startByte !== bytes.byteLength) return null;
  }
  return value;
}

export type RuleSourceLine = { line: number; text: string; evidenceNodeIds: string[] };
export type RuleSuggestion<T> = { state: "UNKNOWN" | "SUGGESTED" | "CONFLICT"; value: T | null; sources: RuleSourceLine[] };
export type RuleSuggestions = { [K in RuleChoiceField]: RuleSuggestion<SubmissionRuleChoices[K]> };
export type RuleQuestionReview = {
  status: "NOT_INSPECTED" | "OBSERVED" | "NONE_OBSERVED" | "PARTIAL" | "INACCESSIBLE" | "FAILED";
  scope: "INSPECTED_PUBLIC_SOURCE_ONLY";
  questions: { id: string; prompt: string; required: boolean | null; wordLimit: number | null; characterLimit: number | null }[];
  issues: string[];
};
export type SubmissionRuleReviewView = {
  jobSnapshotId: string; title: string; company: string; listingUrl: string; applicationUrl: string;
  observedAt: string; basis: SubmissionRuleReviewBasis; sourceText: string; sourceLines: RuleSourceLine[];
  suggestions: RuleSuggestions; questions: RuleQuestionReview; blockers: string[];
  previous: { ruleId: string; checkedAt: string; effectivePrepurchaseCheckedAt: string | null; choices: SubmissionRuleChoices } | null;
};

const sourceLineSchema = z.object({ line: z.number().int().positive(), text: z.string().max(100000), evidenceNodeIds: z.array(z.uuid()).max(1000) }).strict();
function suggestion<T extends z.ZodType>(value: T) {
  return z.object({ state: z.enum(["UNKNOWN", "SUGGESTED", "CONFLICT"]), value: value.nullable(), sources: z.array(sourceLineSchema).max(1000) }).strict()
    .refine((item) => "value" in item && (item.state === "SUGGESTED" ? item.value !== null && item.sources.length > 0 : item.value === null));
}
const publicSourceUrl = z.url().max(2000).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash
    && ![...url.searchParams.keys()].some((key) => /token|secret|password|session|email|phone|authorization/iu.test(key));
});
export const submissionRuleReviewViewSchema: z.ZodType<SubmissionRuleReviewView> = z.object({
  jobSnapshotId: z.uuid(), title: z.string().min(1).max(500), company: z.string().min(1).max(500),
  listingUrl: publicSourceUrl, applicationUrl: publicSourceUrl, observedAt: z.iso.datetime({ offset: true }),
  basis: submissionRuleReviewBasisSchema, sourceText: z.string().min(1).max(100000), sourceLines: z.array(sourceLineSchema).max(10000),
  suggestions: z.object({
    resumeRequirement: suggestion(submissionRuleChoicesSchema.shape.resumeRequirement), coverLetterRequirement: suggestion(submissionRuleChoicesSchema.shape.coverLetterRequirement),
    allowedFormats: suggestion(submissionRuleChoicesSchema.shape.allowedFormats), resumePageLimit: suggestion(submissionRuleChoicesSchema.shape.resumePageLimit),
    coverLetterPageLimit: suggestion(submissionRuleChoicesSchema.shape.coverLetterPageLimit), resumeFilenameInstruction: suggestion(submissionRuleChoicesSchema.shape.resumeFilenameInstruction),
    coverLetterFilenameInstruction: suggestion(submissionRuleChoicesSchema.shape.coverLetterFilenameInstruction), referenceFilenameInstruction: suggestion(submissionRuleChoicesSchema.shape.referenceFilenameInstruction),
    referenceTiming: suggestion(submissionRuleChoicesSchema.shape.referenceTiming), referenceCount: suggestion(submissionRuleChoicesSchema.shape.referenceCount),
    submissionChannel: suggestion(submissionRuleChoicesSchema.shape.submissionChannel), portfolioInstruction: suggestion(submissionRuleChoicesSchema.shape.portfolioInstruction),
    workSampleInstruction: suggestion(submissionRuleChoicesSchema.shape.workSampleInstruction),
  }).strict(),
  questions: z.object({ status: z.enum(["NOT_INSPECTED", "OBSERVED", "NONE_OBSERVED", "PARTIAL", "INACCESSIBLE", "FAILED"]), scope: z.literal("INSPECTED_PUBLIC_SOURCE_ONLY"),
    questions: z.array(z.object({ id: z.uuid(), prompt: z.string().min(1).max(4000), required: z.boolean().nullable(), wordLimit: z.number().int().positive().nullable(), characterLimit: z.number().int().positive().nullable() }).strict()).max(100),
    issues: z.array(z.string().max(200)).max(200),
  }).strict(), blockers: z.array(z.string().min(1).max(500)).max(100),
  previous: z.object({ ruleId: z.uuid(), checkedAt: z.iso.datetime({ offset: true }), effectivePrepurchaseCheckedAt: z.iso.datetime({ offset: true }).nullable(), choices: submissionRuleChoicesSchema }).strict().nullable(),
}).strict().refine((value) => value.jobSnapshotId === value.basis.jobSnapshotId && value.previous?.ruleId === (value.basis.currentRuleId ?? undefined));

function emptySuggestions(): RuleSuggestions {
  const unknown = () => ({ state: "UNKNOWN" as const, value: null, sources: [] });
  return { resumeRequirement: unknown(), coverLetterRequirement: unknown(), allowedFormats: unknown(), submissionChannel: unknown(),
    resumePageLimit: unknown(), coverLetterPageLimit: unknown(), resumeFilenameInstruction: unknown(), coverLetterFilenameInstruction: unknown(),
    referenceFilenameInstruction: unknown(), referenceTiming: unknown(), referenceCount: unknown(), portfolioInstruction: unknown(), workSampleInstruction: unknown() };
}
const suspicious = (text: string) => /ignore\s+(?:all\s+|previous\s+|prior\s+)?(?:instructions|rules)|(?:system|developer)\s*(?:message|prompt)|reveal\s+(?:secrets|credentials)/iu.test(text);

/** Conservative suggestions from saved literal instructions. No URL, missing
 * field, ATS brand or document-generator capability implies an employer rule. */
export function proposeSubmissionRules(input: { text: string; nodes: readonly { id: string; source_excerpt: string | null }[] }) {
  if (input.text.length > 100000 || input.nodes.length > 1000) throw new Error("submission_rule_source_too_large");
  const suggestions = emptySuggestions(), blockers: string[] = [];
  const sourceLines: RuleSourceLine[] = input.text.split(/\r?\n/u).map((text, index) => ({ line: index + 1, text,
    evidenceNodeIds: input.nodes.filter((node) => node.source_excerpt?.trim() && text.includes(node.source_excerpt.trim())).map((node) => node.id) }));
  function offer<K extends RuleChoiceField>(key: K, value: SubmissionRuleChoices[K], source: RuleSourceLine) {
    const prior = suggestions[key];
    if (prior.state === "UNKNOWN") { prior.state = "SUGGESTED"; prior.value = value; }
    else if (JSON.stringify(prior.value) !== JSON.stringify(value)) { prior.state = "CONFLICT"; prior.value = null; }
    prior.sources.push(source);
  }
  for (const source of sourceLines) {
    const text = source.text.trim();
    if (!text) continue;
    if (suspicious(text)) { blockers.push("Captured source contains instructions that require a separate safety review."); continue; }
    // Whole instruction clauses only: "experience writing resumes is required"
    // is a qualification, not a request to submit a resume.
    for (const [term, key] of [["(?:resume|résumé|cv)", "resumeRequirement"], ["cover\\s+letter", "coverLetterRequirement"]] as const) {
      const clause = `(?:^|[.;]\\s*)(?:a\\s+|your\\s+)?${term}\\s+(?:is\\s+)?`;
      if (new RegExp(`${clause}required(?:[.;:]|$)`, "iu").test(text) || new RegExp(`(?:^|[.;]\\s*)(?:please\\s+)?(?:submit|upload|attach)\\s+(?:a\\s+|your\\s+)?${term}(?:[.;:]|$)`, "iu").test(text)) offer(key, "REQUIRED", source);
      if (new RegExp(`${clause}optional(?:[.;:]|$)`, "iu").test(text)) offer(key, "OPTIONAL", source);
      if (new RegExp(`(?:^|[.;]\\s*)(?:do not|don't)\\s+(?:submit|upload|attach)\\s+(?:a\\s+|your\\s+)?${term}(?:[.;:]|$)`, "iu").test(text)) offer(key, "PROHIBITED", source);
    }
    // A single global format field cannot safely combine different per-file rules.
    const globalFormats = /^(?:accepted|allowed|supported)\s+(?:document\s+|file\s+)?formats?\s*:\s*(DOCX|PDF)(?:\s*(?:,|and|or|\/)\s*(DOCX|PDF))?\.?$/iu.exec(text);
    if (globalFormats) offer("allowedFormats", [...new Set(globalFormats.slice(1).filter(Boolean).map((value) => value.toUpperCase()))].sort() as ("DOCX" | "PDF")[], source);
    if (/^(?:submission method|submit documents via)\s*:\s*(?:secure|https)\s+(?:file\s+)?upload\.?$/iu.test(text)) offer("submissionChannel", "HTTPS_UPLOAD", source);
    if (/^(?:submission method|submit documents via)\s*:\s*email\.?$/iu.test(text)) offer("submissionChannel", "EMAIL", source);
    const page = /^(resume|résumé|cv|cover letter)\s*(?:page limit|max(?:imum)? pages)\s*:\s*(\d+)\.?$/iu.exec(text);
    if (page) {
      const value = Number(page[2]);
      if (page[1].toLowerCase() === "cover letter") {
        if (value === 1) offer("coverLetterPageLimit", 1, source); else blockers.push("The captured cover-letter page limit needs a supported-format review.");
      } else if (value === 1 || value === 2) offer("resumePageLimit", value, source); else blockers.push("The captured resume page limit needs a supported-format review.");
    }
    const filename = /^(resume|résumé|cv|cover letter|references?) filename\s*:\s*(.{1,180})$/iu.exec(text);
    if (filename) offer(/^cover letter$/iu.test(filename[1]) ? "coverLetterFilenameInstruction" : /^references?$/iu.test(filename[1]) ? "referenceFilenameInstruction" : "resumeFilenameInstruction", filename[2], source);
    if (/^references?\s+(?:are\s+)?required\s+(?:now|with (?:the |your )?application)\.?$/iu.test(text)) offer("referenceTiming", "REQUIRED_NOW", source);
    if (/^references?\s+(?:are\s+)?optional\s+(?:now|with (?:the |your )?application)\.?$/iu.test(text)) offer("referenceTiming", "OPTIONAL_NOW", source);
    if (/^do not (?:submit|attach|upload) references?\.?$/iu.test(text)) offer("referenceTiming", "PROHIBITED_NOW", source);
    const count = /^references? required\s*:\s*([1-9][0-9]?)\.?$/iu.exec(text);
    if (count) { offer("referenceTiming", "REQUIRED_NOW", source); offer("referenceCount", Number(count[1]), source); }
    const additional = /^(portfolio|work sample) instructions?\s*:\s*(.{1,1000})$/iu.exec(text);
    if (additional) offer(additional[1].toLowerCase() === "portfolio" ? "portfolioInstruction" : "workSampleInstruction", additional[2], source);
  }
  if (choiceFields.some((key) => suggestions[key].state === "CONFLICT")) blockers.push("Captured instructions conflict. Resolve the source before confirming these rules.");
  return { suggestions, sourceLines, blockers: [...new Set(blockers)] };
}

/** Validate quoted evidence against the saved source again on the server.
 * Human interpretation is explicit; a browser quote never adds source content. */
export function validateRuleFieldEvidence(choices: SubmissionRuleChoices, evidence: RuleFieldEvidence, sourceText: string) {
  const fieldContext: Record<RuleChoiceField, RegExp> = {
    resumeRequirement: /\b(?:resume|résumé|cv)\b/iu, coverLetterRequirement: /cover\s+letter/iu,
    allowedFormats: /\b(?:formats?|file types?|upload|attach|submit|send)\b/iu, submissionChannel: /\b(?:submission|submit|upload|email|e-mail|send|deliver)\b/iu,
    resumePageLimit: /\b(?:resume|résumé|cv)\b/iu, coverLetterPageLimit: /cover\s+letter/iu,
    resumeFilenameInstruction: /\b(?:resume|résumé|cv)\b/iu, coverLetterFilenameInstruction: /cover\s+letter/iu,
    referenceFilenameInstruction: /references?/iu, referenceTiming: /references?/iu, referenceCount: /references?/iu,
    portfolioInstruction: /portfolio/iu, workSampleInstruction: /work\s+samples?/iu,
  };
  for (const field of choiceFields) {
    const value = choices[field], selected = evidence[field];
    const requiresEvidence = value !== null && !(field === "referenceTiming" && value === "LATER_OR_UNKNOWN");
    if (requiresEvidence && !selected || !requiresEvidence && selected !== null || selected !== null && (!sourceText.includes(selected) || suspicious(selected)))
      throw new Error("submission_rule_field_evidence_missing");
    if (selected === null) continue;
    sourceQuoteOffset(sourceText, selected);
    if (!fieldContext[field].test(selected)) throw new Error("submission_rule_field_evidence_mismatch");
    const literal = proposeSubmissionRules({ text: selected, nodes: [] }).suggestions[field];
    if (literal.state === "CONFLICT" || literal.state === "SUGGESTED" && JSON.stringify(literal.value) !== JSON.stringify(value))
      throw new Error("submission_rule_field_evidence_mismatch");
    if (field === "allowedFormats" && choices.allowedFormats.some((format) => !new RegExp(`\\b${format}\\b`, "iu").test(selected)))
      throw new Error("submission_rule_field_evidence_mismatch");
    if (field === "submissionChannel" && (value === "HTTPS_UPLOAD" && !/upload/iu.test(selected) || value === "EMAIL" && !/e-?mail/iu.test(selected)))
      throw new Error("submission_rule_field_evidence_mismatch");
    if (["resumeFilenameInstruction", "coverLetterFilenameInstruction", "referenceFilenameInstruction", "portfolioInstruction", "workSampleInstruction"].includes(field)
      && typeof value === "string" && !selected.includes(value)) throw new Error("submission_rule_field_evidence_mismatch");
  }
}

/** Full saved lines preserve surrounding negations and qualifications. A short
 * substring cut out of "No resume required" cannot become "Resume required". */
export function sourceQuoteOffset(text: string, quote: string): number {
  let index = text.indexOf(quote);
  while (index >= 0) {
    const before = text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
    const next = text.indexOf("\n", index + quote.length), after = text.slice(index + quote.length, next < 0 ? text.length : next);
    if (!before.trim() && !after.trim()) return index;
    index = text.indexOf(quote, index + 1);
  }
  throw new Error("submission_rule_complete_source_line_required");
}

export function initialRuleChoices(suggestions: RuleSuggestions) {
  return Object.fromEntries(choiceFields.map((key) => [key, suggestions[key].state === "SUGGESTED" ? suggestions[key].value
    : key === "allowedFormats" ? [] : key === "referenceTiming" ? "LATER_OR_UNKNOWN" : null])) as {
      [K in RuleChoiceField]: SubmissionRuleChoices[K] | null
    };
}

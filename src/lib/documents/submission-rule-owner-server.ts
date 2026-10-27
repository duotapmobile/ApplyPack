import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { containsPromptInjection } from "@/lib/materials/contract";
import { bindGreenhouseQuestionCapture, deriveGreenhouseApplicationQuestions } from "@/lib/jobs/application-question-evidence";
import { validRawSourceEvidence, type RawSourceEvidence } from "@/lib/jobs/raw-source-evidence";
import { getEmployerSource } from "@/lib/jobs/source-registry";
import { buildEmployerQuestionInsights } from "./employer-question-evidence";
import { draftingEvidenceRecordsSchema } from "./drafting-evidence";
import { SUBMISSION_RULE_PROPOSAL_VERSION, proposeSubmissionRules, ruleReviewChecklistSchema, ruleReviewEvidenceSchema,
  submissionRuleChoicesSchema, submissionRuleConfirmationSchema, submissionRuleReviewBasisSchema, submissionRuleReviewViewSchema,
  submissionRuleSavedSchema, validateRuleFieldEvidence, type RuleFieldEvidence, type RuleQuestionReview, type RuleReviewEvidence,
  type SubmissionRuleChoices, type SubmissionRuleConfirmation, type SubmissionRuleReviewBasis, type SubmissionRuleSaved, sourceQuoteOffset } from "./submission-rule-proposal";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const ruleSchema = z.object({ id: uuid, job_snapshot_id: uuid, content_sha256: hash, checked_at: time, human_confirmed_at: time,
  human_confirmed_by: uuid, is_current: z.literal(true), superseded_at: z.null(), source_evidence_ids: z.array(uuid).min(1).max(100),
  resume_requirement: submissionRuleChoicesSchema.shape.resumeRequirement, cover_letter_requirement: submissionRuleChoicesSchema.shape.coverLetterRequirement,
  allowed_formats: submissionRuleChoicesSchema.shape.allowedFormats, resume_page_limit: submissionRuleChoicesSchema.shape.resumePageLimit,
  cover_letter_page_limit: submissionRuleChoicesSchema.shape.coverLetterPageLimit, resume_filename_instruction: submissionRuleChoicesSchema.shape.resumeFilenameInstruction,
  cover_letter_filename_instruction: submissionRuleChoicesSchema.shape.coverLetterFilenameInstruction, reference_filename_instruction: submissionRuleChoicesSchema.shape.referenceFilenameInstruction,
  reference_timing: submissionRuleChoicesSchema.shape.referenceTiming, reference_count: submissionRuleChoicesSchema.shape.referenceCount,
  submission_channel: submissionRuleChoicesSchema.shape.submissionChannel, portfolio_instruction: submissionRuleChoicesSchema.shape.portfolioInstruction,
  work_sample_instruction: submissionRuleChoicesSchema.shape.workSampleInstruction, application_questions: z.array(z.record(z.string(), z.unknown())).max(100),
  parser_version: z.string().min(3).max(100), injection_scan_state: z.enum(["CLEAR", "BLOCKED", "REVIEW_REQUIRED"]), hard_block_reason: z.string().nullable(),
});
const basisResultSchema = z.object({ basis: submissionRuleReviewBasisSchema, currentRule: ruleSchema.nullable(), sourceEvidenceId: uuid.nullable(), effectivePrepurchaseCheckedAt: time.nullable() }).strict();
const sourceSchema = z.object({ job: draftingEvidenceRecordsSchema.shape.job,
  nodes: z.array(z.object({ id: uuid, job_snapshot_id: uuid, source_excerpt: z.string().max(100000).nullable(), classification_method: z.string().max(200) }).strict()).max(1000),
  questionAuthority: draftingEvidenceRecordsSchema.shape.questionSourceAuthority,
}).strict();
const confirmedRulesSchema = submissionRuleChoicesSchema.extend({ sourceEvidenceIds: z.array(uuid).min(1).max(100),
  applicationQuestions: z.array(z.record(z.string(), z.unknown())).max(100), parserVersion: z.string().min(3).max(100),
  injectionScanState: z.literal("CLEAR"), hardBlockReason: z.string().min(3).max(500).nullable() }).strict();
const receiptSchema = z.object({ request_id: uuid, job_snapshot_id: uuid, reviewer_id: uuid, expected_basis: submissionRuleReviewBasisSchema,
  confirmed_rules: confirmedRulesSchema, confirmed_rules_sha256: hash, review_checklist: ruleReviewChecklistSchema, review_evidence: ruleReviewEvidenceSchema,
  rule_id: uuid, rule_content_sha256: hash, checked_at: time, receipt_sha256: hash, created_at: time }).strict();
const outcomeSchema = z.object({ receipt: receiptSchema, replayed: z.boolean(), current: z.boolean() }).strict();
type ConfirmedRules = z.infer<typeof confirmedRulesSchema>;
type Source = z.infer<typeof sourceSchema>;
type Rule = z.infer<typeof ruleSchema>;

/** The production adapter must use generated RPC declarations. This port also
 * lets the native harness use the same owner logic with its real SQL transport. */
export interface SubmissionRuleOwnerPort {
  basis(jobSnapshotId: string, reviewerId: string): Promise<unknown>;
  source(jobSnapshotId: string): Promise<unknown>;
  prepare(jobSnapshotId: string, reviewerId: string): Promise<unknown>;
  confirm(value: { jobSnapshotId: string; reviewerId: string; requestId: string; expectedBasis: SubmissionRuleReviewBasis;
    confirmedRules: ConfirmedRules; checklist: z.infer<typeof ruleReviewChecklistSchema>; reviewEvidence: RuleReviewEvidence }): Promise<unknown>;
  receipt(requestId: string, reviewerId: string): Promise<unknown>;
}
export class SubmissionRuleReviewError extends Error {
  constructor(public code: "INVALID" | "UNAVAILABLE" | "REVIEW_CHANGED" | "SOURCE_BLOCKED" | "RECEIPT_CONFLICT") { super(code); }
}
const fail = (code: SubmissionRuleReviewError["code"]): never => { throw new SubmissionRuleReviewError(code); };
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const same = (left: unknown, right: unknown) => canonicalSha256(left) === canonicalSha256(right);
function choicesFromRule(rule: Rule): SubmissionRuleChoices {
  return submissionRuleChoicesSchema.parse({ resumeRequirement: rule.resume_requirement, coverLetterRequirement: rule.cover_letter_requirement,
    allowedFormats: rule.allowed_formats, resumePageLimit: rule.resume_page_limit, coverLetterPageLimit: rule.cover_letter_page_limit,
    resumeFilenameInstruction: rule.resume_filename_instruction, coverLetterFilenameInstruction: rule.cover_letter_filename_instruction,
    referenceFilenameInstruction: rule.reference_filename_instruction, referenceTiming: rule.reference_timing, referenceCount: rule.reference_count,
    submissionChannel: rule.submission_channel, portfolioInstruction: rule.portfolio_instruction, workSampleInstruction: rule.work_sample_instruction });
}
function choicesFromConfirmed(rules: ConfirmedRules) {
  return submissionRuleChoicesSchema.parse(Object.fromEntries(Object.keys(submissionRuleChoicesSchema.shape).map((key) => [key, rules[key as keyof ConfirmedRules]])));
}
function capturedText(source: Source) {
  const value = source.job.captured_listing;
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.text !== "string" || !value.text.trim()
    || value.text.length > 100000 || Buffer.byteLength(JSON.stringify(value), "utf8") > 1_000_000
    || canonicalSha256(value) !== source.job.content_sha256) return fail("SOURCE_BLOCKED");
  return value.text;
}
export function canonicalRuleCitations(sourceEvidenceId: string, text: string, choices: SubmissionRuleChoices, quotes: RuleFieldEvidence): RuleReviewEvidence {
  validateRuleFieldEvidence(choices, quotes, text);
  return ruleReviewEvidenceSchema.parse({ version: "applypack-employer-rule-citations-v1", sourceEvidenceId, sourceTextSha256: sha(text),
    citations: Object.entries(quotes).filter(([, quote]) => quote !== null).sort(([a], [b]) => a.localeCompare(b)).map(([field, quote]) => {
      const index = sourceQuoteOffset(text, quote!), startByte = Buffer.byteLength(text.slice(0, index), "utf8");
      return { field, startByte, endByte: startByte + Buffer.byteLength(quote!, "utf8"), quoteSha256: sha(quote!) };
    }) });
}
function verifyQuestionAuthority(source: Source) {
  const { job, questionAuthority: authority } = source, definition = getEmployerSource(job.discovery_source);
  if (definition?.adapterKind !== "greenhouse" || !definition.adapterKey || !job.external_job_id || !authority
    || authority.run.id !== job.source_run_id || authority.run.source_id !== job.discovery_source || authority.run.source_authorization_id !== job.source_authorization_id
    || authority.run.status !== "succeeded" || authority.run.enumeration_status !== "complete" || !authority.run.adapter_version || !authority.run.scope_sha256
    || authority.authorization.id !== job.source_authorization_id || authority.authorization.source_id !== job.discovery_source || authority.authorization.state !== "AUTHORIZED_AUTOMATED"
    || !authority.authorization.allowed_actions.includes("READ_APPLICATION_QUESTIONS") || authority.head.source_id !== job.discovery_source
    || authority.head.current_authorization_id !== authority.authorization.id || authority.head.revision !== authority.run.authorization_head_revision) return null;
  return { sourceId: job.discovery_source, boardToken: definition.adapterKey, externalJobId: job.external_job_id, sourceRunId: authority.run.id,
    authorizationId: authority.authorization.id, authorizationVersion: authority.authorization.authorization_version,
    authorizationHeadRevision: authority.head.revision, scopeSha256: authority.run.scope_sha256, adapterVersion: authority.run.adapter_version };
}
function sourceQuestions(source: Source, rule: Rule | null, now: Date): { review: RuleQuestionReview; persisted: ConfirmedRules["applicationQuestions"]; blocked: boolean } {
  const empty: RuleQuestionReview = { status: "NOT_INSPECTED", scope: "INSPECTED_PUBLIC_SOURCE_ONLY", questions: [], issues: [] };
  const captured = source.job.captured_listing, binding = verifyQuestionAuthority(source);
  if (rule) {
    const result = buildEmployerQuestionInsights(rule.application_questions, { jobSnapshotId: source.job.id, jobSha256: source.job.content_sha256,
      ruleId: rule.id, ruleSha256: rule.content_sha256, ruleCheckedAt: rule.checked_at, humanConfirmedAt: rule.human_confirmed_at,
      ruleSourceEvidenceIds: rule.source_evidence_ids, rawSource: { sourceUrl: source.job.source_url, observedAt: source.job.retrieved_at, value: captured }, nodes: source.nodes, captureBinding: binding }, now);
    return { review: { status: result.status, scope: empty.scope, questions: result.questions.map(({ id, prompt, required, wordLimit, characterLimit }) => ({ id, prompt, required, wordLimit, characterLimit })), issues: result.issues.map((item) => item.code) },
      persisted: rule.application_questions, blocked: result.issues.some((item) => item.code !== "ABSENCE_NOT_ESTABLISHED") };
  }
  if (!captured || typeof captured !== "object" || Array.isArray(captured) || !Object.hasOwn(captured, "applicationQuestionObservation")) return { review: empty, persisted: [], blocked: false };
  try {
    if (!binding || !validRawSourceEvidence(captured.rawSourceEvidence as RawSourceEvidence, binding.adapterVersion)
      || Date.parse(source.job.retrieved_at) > now.getTime()) throw new Error();
    const raw = captured.rawSourceEvidence as unknown as RawSourceEvidence;
    const observation = bindGreenhouseQuestionCapture(captured.applicationQuestionObservation, { ...binding, observedAt: source.job.retrieved_at, rawSourcePayload: raw.payload });
    if (observation.authority?.authorizationVersion !== binding.authorizationVersion) throw new Error();
    const derived = deriveGreenhouseApplicationQuestions(observation), unsafe = derived.questions.some((question) => containsPromptInjection(question.prompt) || /ignore\s+(?:previous\s+)?instructions|system\s*prompt/iu.test(question.prompt));
    return { review: { status: derived.status, scope: empty.scope, questions: derived.questions.map(({ id, prompt, required, wordLimit, characterLimit }) => ({ id, prompt, required, wordLimit, characterLimit })), issues: unsafe ? ["POTENTIAL_PROMPT_INJECTION"] : [] },
      persisted: [], blocked: unsafe };
  } catch { return { review: { ...empty, status: "FAILED", issues: ["SOURCE_PROOF_MISMATCH"] }, persisted: [], blocked: true }; }
}
function hardBlock(choices: SubmissionRuleChoices) {
  if (choices.resumeRequirement === "PROHIBITED" || choices.coverLetterRequirement === "PROHIBITED") return "The employer prohibits one of the two Apply Pack documents.";
  if (choices.submissionChannel === "UNSUPPORTED") return "The employer requires an unsupported submission method.";
  return null;
}
function savedResult(raw: unknown, reviewerId: string, jobSnapshotId: string, requestId: string): SubmissionRuleSaved {
  const parsed = outcomeSchema.safeParse(raw);
  if (!parsed.success) return fail("UNAVAILABLE");
  const { receipt, current } = parsed.data;
  if (receipt.reviewer_id !== reviewerId || receipt.job_snapshot_id !== jobSnapshotId || receipt.request_id !== requestId
    || receipt.expected_basis.jobSnapshotId !== jobSnapshotId) return fail("RECEIPT_CONFLICT");
  return submissionRuleSavedSchema.parse({ requestId, jobSnapshotId, expectedBasis: receipt.expected_basis, choices: choicesFromConfirmed(receipt.confirmed_rules),
    checklist: receipt.review_checklist, reviewEvidence: receipt.review_evidence, ruleId: receipt.rule_id, checkedAt: receipt.checked_at, current });
}
function matchesOriginal(saved: SubmissionRuleSaved, request: SubmissionRuleConfirmation) {
  const quotes = Object.entries(request.fieldEvidence).filter(([, quote]) => quote !== null);
  return same(saved.expectedBasis, request.expectedBasis) && same(saved.choices, request.choices) && same(saved.checklist, request.checklist)
    && saved.reviewEvidence.citations.length === quotes.length && quotes.every(([field, quote]) => {
      const citation = saved.reviewEvidence.citations.find((item) => item.field === field);
      return citation?.quoteSha256 === sha(quote!) && citation.endByte - citation.startByte === Buffer.byteLength(quote!, "utf8");
    });
}

export function createSubmissionRuleOwnerServer(port: SubmissionRuleOwnerPort, reviewerId: string, now = () => new Date()) {
  uuid.parse(reviewerId);
  async function load(jobSnapshotId: string) {
    uuid.parse(jobSnapshotId);
    const basis = basisResultSchema.parse(await port.basis(jobSnapshotId, reviewerId));
    if (basis.basis.jobSnapshotId !== jobSnapshotId || basis.currentRule?.id !== (basis.basis.currentRuleId ?? undefined)) fail("UNAVAILABLE");
    const source = sourceSchema.parse(await port.source(jobSnapshotId)), text = capturedText(source);
    if (source.job.id !== jobSnapshotId || source.job.content_sha256 !== basis.basis.jobContentSha256 || source.nodes.some((node) => node.job_snapshot_id !== jobSnapshotId)
      || basis.currentRule && basis.currentRule.job_snapshot_id !== jobSnapshotId) fail("UNAVAILABLE");
    const prepared = basis.sourceEvidenceId ? source.nodes.find((node) => node.id === basis.sourceEvidenceId) : null;
    if (basis.sourceEvidenceId && (!prepared || prepared.source_excerpt !== text || prepared.classification_method !== "employer-instruction-source-v1")) fail("SOURCE_BLOCKED");
    const questions = sourceQuestions(source, basis.currentRule, now()), proposed = proposeSubmissionRules({ text, nodes: source.nodes });
    const afterSource = sourceSchema.parse(await port.source(jobSnapshotId));
    const after = basisResultSchema.parse(await port.basis(jobSnapshotId, reviewerId));
    if (!same(basis, after) || !same(source, afterSource)) fail("REVIEW_CHANGED");
    const blockers = [...proposed.blockers];
    if (containsPromptInjection(text)) blockers.push("Captured instructions require a separate safety review.");
    if (questions.blocked) blockers.push("Application-question evidence could not be verified against the authorized capture.");
    if (basis.sourceEvidenceId && questions.persisted.some((observation) => typeof observation.sourceEvidenceNodeId === "string" && observation.sourceEvidenceNodeId !== basis.sourceEvidenceId))
      blockers.push("Earlier manually captured questions refer to a different source record. Re-observe them through the permitted-source review workflow before confirming new instructions; their source links cannot be replaced here.");
    const view = submissionRuleReviewViewSchema.parse({ jobSnapshotId, title: source.job.exact_title, company: source.job.company,
      listingUrl: source.job.source_url, applicationUrl: source.job.canonical_application_url, observedAt: source.job.retrieved_at, basis: basis.basis,
      sourceText: text, ...proposed, blockers: [...new Set(blockers)], questions: questions.review,
      previous: basis.currentRule ? { ruleId: basis.currentRule.id, checkedAt: basis.currentRule.checked_at, effectivePrepurchaseCheckedAt: basis.effectivePrepurchaseCheckedAt, choices: choicesFromRule(basis.currentRule) } : null });
    return { view, sourceEvidenceId: basis.sourceEvidenceId, applicationQuestions: questions.persisted };
  }
  return {
    async review(jobSnapshotId: string) {
      const loaded = await load(jobSnapshotId);
      return loaded.sourceEvidenceId ? { status: "READY" as const, view: loaded.view }
        : { status: "PREPARATION_REQUIRED" as const, jobSnapshotId, title: loaded.view.title, company: loaded.view.company };
    },
    async prepare(jobSnapshotId: string) {
      uuid.parse(jobSnapshotId);
      const value = z.object({ sourceEvidenceId: uuid, created: z.boolean(), basis: submissionRuleReviewBasisSchema }).strict().parse(await port.prepare(jobSnapshotId, reviewerId));
      if (value.basis.jobSnapshotId !== jobSnapshotId) fail("UNAVAILABLE");
      return { prepared: true as const };
    },
    async receipt(jobSnapshotId: string, requestId: string) {
      uuid.parse(jobSnapshotId); uuid.parse(requestId);
      const raw = await port.receipt(requestId, reviewerId);
      return raw === null ? null : savedResult(raw, reviewerId, jobSnapshotId, requestId);
    },
    async confirm(input: unknown) {
      const parsed = submissionRuleConfirmationSchema.safeParse(input);
      if (!parsed.success) return fail("INVALID");
      const request = parsed.data, previous = await port.receipt(request.requestId, reviewerId);
      if (previous !== null) {
        const saved = savedResult(previous, reviewerId, request.jobSnapshotId, request.requestId);
        if (!matchesOriginal(saved, request)) fail("RECEIPT_CONFLICT");
        return saved;
      }
      const loaded = await load(request.jobSnapshotId);
      if (!same(loaded.view.basis, request.expectedBasis)) fail("REVIEW_CHANGED");
      if (!loaded.sourceEvidenceId || loaded.view.blockers.length) return fail("SOURCE_BLOCKED");
      const reviewEvidence = canonicalRuleCitations(loaded.sourceEvidenceId, loaded.view.sourceText, request.choices, request.fieldEvidence);
      const confirmedRules = confirmedRulesSchema.parse({ ...request.choices, sourceEvidenceIds: [loaded.sourceEvidenceId], applicationQuestions: loaded.applicationQuestions,
        parserVersion: SUBMISSION_RULE_PROPOSAL_VERSION, injectionScanState: "CLEAR", hardBlockReason: hardBlock(request.choices) });
      const saved = savedResult(await port.confirm({ jobSnapshotId: request.jobSnapshotId, reviewerId, requestId: request.requestId,
        expectedBasis: request.expectedBasis, confirmedRules, checklist: request.checklist, reviewEvidence }), reviewerId, request.jobSnapshotId, request.requestId);
      if (!matchesOriginal(saved, request)) fail("RECEIPT_CONFLICT");
      return saved;
    },
  };
}

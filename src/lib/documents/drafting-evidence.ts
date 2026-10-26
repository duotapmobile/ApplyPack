import { createHash } from "node:crypto";
import { z } from "zod";
import { CANONICALIZATION_VERSION, canonicalSha256 } from "@/lib/domain/foundation";
import { confirmationReceiptSchema } from "@/lib/intake/confirmed-review";
import { buildFourStepSnapshot, fourStepDraftSchema, normalizedFourStepDraft } from "@/lib/intake/four-step";
import { MATCHING_RULES_VERSION } from "@/lib/matching/evaluation-engine";
import { buildEmployerQuestionInsights } from "./employer-question-evidence";
import { getEmployerSource } from "@/lib/jobs/source-registry";
import { materialRulePacketEvidenceSchema, validateMaterialRulePacketEvidence } from "./material-rule-evidence";
import { bindDraftReferenceMetadata, draftReferenceMetadataSchema } from "./drafting-evidence-references";

export const DRAFTING_EVIDENCE_VERSION = "applypack-drafting-evidence-v1";
export const DRAFTING_EVIDENCE_LIMITS = { facts: 500, requirements: 200, reviews: 400, sources: 500, bytes: 2_000_000 } as const;
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().max(max);
const ids = z.array(uuid).max(100);
const json = z.json();
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const draftingEvidenceExpectationSchema = z.object({ customerId: uuid, materialLineId: uuid, revisionId: uuid,
  revisionVersion: z.number().int().positive(), bindingSha256: hash }).strict();
export type DraftingEvidenceExpectation = z.infer<typeof draftingEvidenceExpectationSchema>;

const factSchema = z.object({ id: uuid, snapshot_id: uuid.nullable(), customer_id: uuid.nullable(), draft_id: uuid,
  semantic_key: text(300), value_kind: text(100), typed_value: json, source_kind: z.enum(["DOCUMENT", "CUSTOMER_ASSERTION", "HUMAN_VERIFICATION"]),
  document_version_id: uuid.nullable(), customer_assertion_snapshot_id: uuid.nullable(), assertion_control_id: text(500).nullable(),
  source_locator: text(1000), verification: z.enum(["EXTRACTED_UNCONFIRMED", "CUSTOMER_CONFIRMED", "HUMAN_VERIFIED", "CUSTOMER_REJECTED", "DISPUTED"]),
  confirmed_or_corrected_at: time.nullable(), superseded_at: time.nullable(), supersedes_fact_id: uuid.nullable(),
  schema_version: text(100), catalog_version: text(100), starts_on: z.iso.date().nullable(), ends_on: z.iso.date().nullable(),
  calendar_duration_days: z.number().int().nonnegative().nullable(), intensity_percent: z.number().min(0).max(100).nullable(),
  capability_status: z.enum(["CAN_DO_NOW", "DONE_BEFORE_NEEDS_REFRESHER", "BASIC_EXPOSURE", "NOT_DONE", "UNSURE"]).nullable(),
  customer_display_label: text(1000).nullable() }).strict();

// These are finite persisted projections, not client-supplied authorization evidence.
export const draftingEvidenceRecordsSchema = z.object({
  referenceMetadata: draftReferenceMetadataSchema.optional(),
  referenceFilenameInstruction: text(2000).nullable().optional(),
  draftJobId: uuid.optional(),
  ruleEvidence: materialRulePacketEvidenceSchema.optional(),
  line: z.object({ id: uuid, purchase_id: uuid, payment_attempt_id: uuid, delivered_order_id: uuid, delivered_match_id: uuid,
    active_revision: z.number().int().positive(), allocated_amount_cents: z.literal(799), fulfillment: z.enum(["PAID", "GENERATING", "HUMAN_REVIEW", "READY_TO_RELEASE"]),
    materials_payment_verified_at: time, materials_started_at: time, materials_due_at: time, selected_reference_sheet: z.boolean() }).strict(),
  purchase: z.object({ id: uuid, customer_id: uuid, checkout_intent_id: uuid, payment_attempt_id: uuid,
    amount_cents: z.number().int().positive(), currency: z.literal("USD"), completed_at: time }).strict(),
  payment: z.object({ id: uuid, customer_id: uuid, amount_cents: z.number().int().positive(), currency: z.literal("USD"),
    settlement: z.literal("PAID"), payment_verified_at: time, immediate_charge_verified: z.literal(true),
    dispute: z.enum(["NONE", "WON"]), funds_reversed_at: z.null() }).strict(),
  revision: z.object({ id: uuid, line_id: uuid, version: z.number().int().positive(), binding_sha256: hash,
    source_snapshot_id: uuid, job_snapshot_id: uuid, employer_rule_snapshot_id: uuid,
    revision_kind: z.enum(["ORIGINAL", "SUBSTITUTION", "FACT_CORRECTION", "REFERENCE_SCOPE"]), parent_revision_id: uuid.nullable(),
    accepted_at: time, started_at: time, due_at: time, superseded_at: z.null(), reference_scope: json.nullable() }).strict(),
  snapshot: z.object({ id: uuid, customer_id: uuid.nullable(), draft_id: uuid, schema_version: text(100),
    canonicalization_version: text(100), content_sha256: hash, sensitive_payload_id: uuid, finalized_at: time, confirmed_review: json.nullable() }).strict(),
  sourcePayload: z.object({ id: uuid, customer_id: uuid.nullable(), draft_id: uuid, content_sha256: hash, retention_state: z.literal("ACTIVE") }).strict(),
  draft: z.object({ id: uuid, converted_customer_id: uuid, finalized_snapshot_id: uuid, version: z.number().int().positive(),
    confirmation_receipt: json, answers: json, retention_state: z.literal("ACTIVE") }).strict(),
  intent: z.object({ id: uuid, customer_id: uuid, purchase_id: uuid, payment_attempt_id: uuid, delivered_order_id: uuid,
    delivered_release_id: uuid, source_snapshot_id: uuid, state: z.literal("COMPLETED"), line_count: z.number().int().min(1).max(10),
    amount_cents: z.number().int().positive(), currency: z.literal("USD"), selection_sha256: hash,
    document_contact_confirmed: z.literal(true), document_facts_confirmed: z.literal(true), contact_payload_id: uuid,
    career_break_choice: z.enum(["KEEP_EXISTING_TIMELINE", "CAREER_BREAK", "FAMILY_CAREGIVING", "CUSTOM_WORDING", "OMIT_ENTRY"]),
    career_break_custom_label: text(80).nullable(), cover_letter_break_consent: z.boolean() }).strict(),
  contact: z.object({ id: uuid, customer_id: uuid, content_sha256: hash, retention_state: z.literal("ACTIVE") }).strict(),
  contactFact: z.object({ id: uuid, snapshot_id: uuid, customer_id: uuid, semantic_key: z.literal("document_contact.confirmed"),
    value_kind: z.literal("PROTECTED_COMPOSITE"), typed_value: z.object({ protectedPayloadId: uuid, contentSha256: hash }).strict(),
    source_kind: z.literal("CUSTOMER_ASSERTION"), customer_assertion_snapshot_id: uuid,
    assertion_control_id: z.literal("chunk5_document_contact_confirmation"), source_locator: z.literal("materials_checkout"),
    verification: z.literal("CUSTOMER_CONFIRMED"), confirmed_or_corrected_at: time, superseded_at: z.null(),
    catalog_version: z.literal("chunk5-document-contact-v1"), schema_version: z.literal("chunk5-document-contact-v1") }).strict(),
  item: z.object({ id: uuid, checkout_intent_id: uuid, material_line_id: uuid, delivered_match_id: uuid,
    job_snapshot_id: uuid, submission_rule_id: uuid, emphasis_note: text(2000), do_not_mention_note: text(2000) }).strict(),
  job: z.object({ id: uuid, legacy_job_id: uuid, content_sha256: hash, company: text(1000), exact_title: text(1000),
    canonical_application_url: z.url(), source_url: z.url(), captured_listing: json, retrieved_at: time, live_verified_at: time,
    discovery_source: text(120), external_job_id: text(200).nullable(), source_run_id: uuid.nullable(), source_authorization_id: uuid.nullable(),
    listing_activity_result: z.literal("PASS"), application_path_result: z.literal("PASS"), legitimacy_result: z.literal("PASS") }).strict(),
  questionSourceAuthority: z.object({
    run: z.object({ id: uuid, source_id: text(120), adapter_version: text(120).nullable(), source_authorization_id: uuid.nullable(),
      authorization_head_revision: z.number().int().positive().nullable(), scope_sha256: hash.nullable(), status: text(100), enumeration_status: text(100).nullable() }).strict(),
    authorization: z.object({ id: uuid, source_id: text(120), authorization_version: text(120), allowed_actions: z.array(text(120)).max(100), state: text(100) }).strict(),
    head: z.object({ source_id: text(120), current_authorization_id: uuid, revision: z.number().int().positive() }).strict(),
  }).strict().nullable(),
  rule: z.object({ id: uuid, job_snapshot_id: uuid, content_sha256: hash, checked_at: time, human_confirmed_at: time,
    human_confirmed_by: uuid, is_current: z.literal(true), superseded_at: z.null(), injection_scan_state: z.literal("CLEAR"), hard_block_reason: z.null(),
    allowed_formats: z.array(z.enum(["DOCX", "PDF"])).min(1).max(2), resume_page_limit: z.number().int().min(1).max(20).nullable(),
    cover_letter_page_limit: z.number().int().min(1).max(20).nullable(), resume_requirement: text(100), cover_letter_requirement: text(100),
    resume_filename_instruction: text(2000).nullable(), cover_letter_filename_instruction: text(2000).nullable(),
    reference_timing: text(100), reference_count: z.number().int().min(0).max(99).nullable(), source_evidence_ids: z.array(uuid).min(1).max(100), application_questions: json }).strict(),
  listingCheck: z.object({ id: uuid, material_line_id: uuid, line_revision_id: uuid, job_snapshot_id: uuid,
    submission_rule_id: uuid, evidence_sha256: hash, phase: z.literal("BEFORE_GENERATION"), result: z.literal("ACTIVE"), checked_at: time }).strict(),
  facts: z.array(factSchema).max(DRAFTING_EVIDENCE_LIMITS.facts),
  sourceFacts: z.array(factSchema).max(DRAFTING_EVIDENCE_LIMITS.sources),
  documents: z.array(z.object({ id: uuid, draft_id: uuid, customer_id: uuid.nullable(), kind: text(100),
    version: z.number().int().positive(), content_sha256: hash, retention_state: z.literal("ACTIVE") }).strict()).max(100),
  factReviews: z.array(z.object({ id: z.number().int().positive(), draft_id: uuid, snapshot_id: uuid, fact_id: uuid,
    correction_fact_id: uuid.nullable(), decision: z.enum(["CONFIRM", "CORRECT", "REJECT", "SKIP"]), reviewed_at: time }).strict()).max(500),
  requirements: z.array(z.object({ id: uuid, job_snapshot_id: uuid, node_kind: z.literal("CRITERION"), stable_criterion_id: uuid,
    source_excerpt: text(16000), source_locator: text(1000), requirement_strength: z.enum(["REQUIRED", "PREFERRED", "INFORMATIONAL", "UNCLEAR"]),
    typed_value: json, position: z.number().int().nonnegative() }).strict()).min(1).max(DRAFTING_EVIDENCE_LIMITS.requirements),
  reviews: z.array(z.object({ id: uuid, snapshot_id: uuid, customer_id: uuid.nullable(), job_snapshot_id: uuid,
    review_kind: z.enum(["MATCH_EVIDENCE", "ADJACENT_EQUIVALENCE"]), reviewer_id: uuid, created_at: time,
    invalidated_at: z.null(), rationale: text(4000), decision: json }).strict()).max(DRAFTING_EVIDENCE_LIMITS.reviews),
  questionSourceNodes: z.array(z.object({ id: uuid, job_snapshot_id: uuid, source_excerpt: text(100000).nullable() }).strict()).max(100),
  referencePermissions: z.array(z.object({ id: uuid, customer_id: uuid, delivered_release_id: uuid, job_snapshot_id: uuid,
    job_snapshot_hash: hash, reference_record_version_id: uuid, revoked_at: z.null(), contact_version_changed_at: z.null() }).strict()).max(20),
  referencePermissionIds: z.array(uuid).max(20), verifiedJobSnapshotIds: z.array(uuid).max(2),
  ownsSnapshot: z.literal(true), successorJobIds: z.array(uuid).max(1), refundIds: z.array(uuid).max(1),
}).strict();
export type DraftingEvidenceRecords = z.infer<typeof draftingEvidenceRecordsSchema>;

export class DraftingEvidenceError extends Error {
  constructor(code: string) { super(`DRAFTING_EVIDENCE_${code}`); this.name = "DraftingEvidenceError"; }
}
function requireThat(condition: unknown, code: string): asserts condition { if (!condition) throw new DraftingEvidenceError(code); }
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const sorted = <T extends { id: string | number }>(values: T[]) => [...values].sort((a, b) => String(a.id).localeCompare(String(b.id)));
// Storage preserves source strings byte-for-byte, including whitespace and
// Unicode composition. The domain canonicalizer is intentionally unsuitable here.
function exactPacketJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exactPacketJson).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${exactPacketJson(object[key])}`).join(",")}}`;
  }
  throw new DraftingEvidenceError("PACKET_JSON_INVALID");
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

const flatFactKeys = new Set(["clientId", "kind", "name", "fullName", "displayName", "email", "phone", "cityState", "location",
  "employer", "employerOrOrganization", "organizationOrProject", "historicalTitle", "roleOrRelationship", "dates", "startsOn", "endsOn", "datePrecision", "current",
  "bullets", "responsibilities", "activity", "responsibility", "tools", "skills", "task", "taskOrTool", "status", "capabilityStatus",
  "educationLevel", "educationField", "completionStatus", "credentialName", "issuingOrganization", "certifications", "relevantCoursework",
  "summary", "text", "verbatim", "coverLetterEvidence", "scope", "outcome", "intensityPercent", "optionalDetail", "sourceDocumentFactId", "sourceFactIds", "employmentFactId",
  "held", "hasExperience", "canDo", "supported", "completed", "earned", "obtained", "graduated", "certified", "licensed", "credentialState", "factLabel", "factValue"]);
const localFields = new Set(["name", "fullName", "displayName", "email", "phone", "cityState", "location", "sourceDocumentFactId", "sourceFactIds", "employmentFactId", "clientId"]);
export const DRAFTING_LOCAL_RENDER_FIELDS = ["employer", "employerOrOrganization", "organizationOrProject", "historicalTitle", "roleOrRelationship",
  "dates", "startsOn", "endsOn", "datePrecision", "current", "educationLevel", "educationField", "completionStatus", "credentialName", "issuingOrganization", "certifications"] as const;
export type DraftingEvidenceAtom = { id: string; factId: string; path: string; value: unknown; localRenderOnly: boolean };
function providerFact(fact: DraftingEvidenceRecords["facts"][number]) {
  const original = factValue(fact.typed_value);
  const value = Object.fromEntries(Object.entries(original).filter(([key]) => !localFields.has(key)).map(([key, entry]) => {
    if (["startsOn", "endsOn"].includes(key) && typeof entry === "string") {
      if (original.datePrecision === "YEAR") return [key, entry.slice(0, 4)];
      if (original.datePrecision === "MONTH") return [key, entry.slice(0, 7)];
      if (original.datePrecision === "UNKNOWN") return [key, ""];
    }
    return [key, entry];
  }));
  const atoms: DraftingEvidenceAtom[] = Object.entries(value).flatMap(([key, entry]) => (Array.isArray(entry) ? entry.map((item, index) => ({ path: `/${key}/${index}`, value: item })) : [{ path: `/${key}`, value: entry }]).map((atom) => ({
    ...atom, id: canonicalSha256({ factId: fact.id, path: atom.path, sourceValue: original[key] }), factId: fact.id,
    localRenderOnly: (DRAFTING_LOCAL_RENDER_FIELDS as readonly string[]).includes(key),
  })));
  return { id: fact.id, kind: fact.value_kind, valueSha256: canonicalSha256(original), disposition: draftingFactDisposition(original, fact.capability_status), value, atoms,
    datePrecision: original.datePrecision ?? "NOT_SPECIFIED", parentFactId: typeof original.employmentFactId === "string" ? original.employmentFactId : null };
}
export type ProviderDraftingFact = ReturnType<typeof providerFact>;
function factValue(value: unknown) {
  const fields = record(value);
  requireThat(Object.keys(fields).length > 0 && Object.keys(fields).length <= 60, "FACT_SHAPE_UNSUPPORTED");
  for (const [key, item] of Object.entries(fields)) requireThat(flatFactKeys.has(key) &&
    (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item) || typeof item === "string" && item.length <= 16000 ||
      Array.isArray(item) && item.length <= 100 && item.every((entry) => typeof entry === "string" && entry.length <= 4000)), "FACT_SHAPE_UNSUPPORTED");
  return fields;
}
export function draftingFactDisposition(value: Record<string, unknown>, capability: string | null) {
  const statuses = [capability, value.status, value.capabilityStatus, value.completionStatus, value.credentialState].filter((v): v is string => typeof v === "string").map((v) => v.toUpperCase().replaceAll(/[\s-]+/g, "_"));
  if (Object.entries(value).some(([key, val]) => ["held", "hasExperience", "canDo", "supported", "completed", "earned", "obtained", "graduated", "certified", "licensed"].includes(key) && val === false) || statuses.some((s) => ["NOT_DONE", "NOT_HELD", "FAIL", "INCOMPLETE"].includes(s))) return "NEGATIVE_DO_NOT_ASSERT" as const;
  if (statuses.some((s) => ["UNSURE", "UNKNOWN", "BASIC_EXPOSURE", "IN_PROGRESS", "PENDING", "PLANNED", "DONE_BEFORE_NEEDS_REFRESHER"].includes(s))) return "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE" as const;
  if (Object.keys(value).every((key) => ["text", "verbatim", "sourceDocumentFactId", "sourceFactIds"].includes(key))) return "UNSTRUCTURED_OWNER_REVIEW_REQUIRED" as const;
  return "CONFIRMED_SOURCE_NOT_APPROVED_PROSE" as const;
}

/** Validation never makes a model citation or matching-review label proof of new prose.
 * Callers must retain the existing deterministic claim guard and owner approval. */
export function buildDraftingEvidencePacket(raw: unknown, expectedRaw: DraftingEvidenceExpectation, now = new Date()) {
  try {
    requireThat(Buffer.byteLength(JSON.stringify(raw), "utf8") <= DRAFTING_EVIDENCE_LIMITS.bytes, "TOO_LARGE");
    const parsed = draftingEvidenceRecordsSchema.safeParse(raw), expectation = draftingEvidenceExpectationSchema.safeParse(expectedRaw);
    requireThat(parsed.success && expectation.success, "SHAPE_INVALID");
    const r = parsed.data, expected = expectation.data, clock = now.getTime();
    requireThat(Number.isFinite(clock), "CLOCK_INVALID");
    const past = (value: string) => Date.parse(value) <= clock;
    const same = (...values: unknown[]) => values.every((value) => value === values[0]);
    requireThat(same(expected.customerId, r.purchase.customer_id, r.payment.customer_id, r.intent.customer_id, r.draft.converted_customer_id, r.contact.customer_id), "OWNER_MISMATCH");
    requireThat(r.snapshot.customer_id === null || r.snapshot.customer_id === expected.customerId, "OWNER_MISMATCH");
    requireThat(same(expected.materialLineId, r.line.id, r.revision.line_id, r.item.material_line_id, r.listingCheck.material_line_id) &&
      same(expected.revisionId, r.revision.id, r.listingCheck.line_revision_id) && same(expected.revisionVersion, r.revision.version, r.line.active_revision) &&
      same(expected.bindingSha256, r.revision.binding_sha256), "REVISION_MISMATCH");
    requireThat(same(r.line.purchase_id, r.purchase.id, r.intent.purchase_id) && same(r.line.payment_attempt_id, r.purchase.payment_attempt_id, r.payment.id, r.intent.payment_attempt_id) &&
      same(r.purchase.checkout_intent_id, r.intent.id, r.item.checkout_intent_id) && same(r.line.delivered_order_id, r.intent.delivered_order_id) &&
      same(r.item.delivered_match_id, r.line.delivered_match_id) && same(r.purchase.amount_cents, r.payment.amount_cents, r.intent.amount_cents, 799 * r.intent.line_count), "PAYMENT_BINDING_INVALID");
    requireThat(same(r.intent.contact_payload_id, r.contact.id, r.contactFact.id, r.contactFact.typed_value.protectedPayloadId) &&
      same(expected.customerId, r.contactFact.customer_id) && same(r.contact.content_sha256, r.contactFact.typed_value.contentSha256) &&
      same(r.intent.source_snapshot_id, r.contactFact.snapshot_id, r.contactFact.customer_assertion_snapshot_id) &&
      past(r.contactFact.confirmed_or_corrected_at), "CONTACT_BINDING_INVALID");
    requireThat(same(r.snapshot.id, r.revision.source_snapshot_id, r.draft.finalized_snapshot_id) && same(r.snapshot.draft_id, r.draft.id), "SOURCE_BINDING_INVALID");
    requireThat(r.snapshot.schema_version === "applypack-intake-v4" && r.snapshot.confirmed_review !== null, "LEGACY_INTAKE_UNSUPPORTED");
    const receipt = confirmationReceiptSchema.safeParse(r.snapshot.confirmed_review);
    requireThat(receipt.success && canonicalSha256(r.draft.confirmation_receipt) === canonicalSha256(receipt.data), "CONFIRMATION_INVALID");
    const answersResult = fourStepDraftSchema.safeParse(r.draft.answers);
    requireThat(answersResult.success, "CONFIRMED_ANSWERS_INVALID");
    const answers = normalizedFourStepDraft(answersResult.data);
    requireThat(receipt.data.answersSha256 === canonicalSha256(answers) && receipt.data.entryMode === answers.entryMode && answers.backgroundReviewed &&
      r.draft.version > receipt.data.draftVersion && Date.parse(receipt.data.preparedAt) <= Date.parse(r.snapshot.finalized_at), "CONFIRMATION_STALE");
    requireThat(r.sourcePayload.id === r.snapshot.sensitive_payload_id && r.sourcePayload.draft_id === r.draft.id &&
      (r.sourcePayload.customer_id === null || r.sourcePayload.customer_id === expected.customerId) && r.snapshot.canonicalization_version === CANONICALIZATION_VERSION &&
      canonicalSha256({ ...buildFourStepSnapshot(answers, r.sourcePayload.content_sha256, CANONICALIZATION_VERSION), confirmedReview: receipt.data }) === r.snapshot.content_sha256, "SNAPSHOT_DIGEST_INVALID");
    requireThat(r.revision.revision_kind !== "ORIGINAL" || r.revision.version === 1 && r.revision.parent_revision_id === null &&
      same(r.intent.source_snapshot_id, r.snapshot.id) && same(r.item.job_snapshot_id, r.job.id) && same(r.item.submission_rule_id, r.rule.id) &&
      createHash("sha256").update(`${r.intent.selection_sha256}:${r.job.content_sha256}:${r.rule.content_sha256}`).digest("hex") === r.revision.binding_sha256, "ORIGINAL_BINDING_INVALID");
    requireThat(r.revision.revision_kind === "ORIGINAL" || r.revision.version > 1 && r.revision.parent_revision_id !== null, "REVISION_CHAIN_INVALID");
    requireThat(same(r.line.materials_due_at, r.revision.due_at) && same(r.line.materials_started_at, r.revision.started_at) && Date.parse(r.revision.due_at) > clock &&
      Date.parse(r.revision.due_at) > Date.parse(r.revision.started_at) && [r.line.materials_payment_verified_at, r.payment.payment_verified_at, r.purchase.completed_at, r.revision.started_at,
        r.revision.accepted_at, r.snapshot.finalized_at].every(past), "DEADLINE_INVALID");
    requireThat(!r.refundIds.length && !r.successorJobIds.length && r.verifiedJobSnapshotIds.length === 1 && r.verifiedJobSnapshotIds[0] === r.job.id, "CURRENT_AUTHORITY_REQUIRED");
    requireThat(same(r.job.id, r.revision.job_snapshot_id, r.rule.job_snapshot_id, r.listingCheck.job_snapshot_id) &&
      same(r.rule.id, r.revision.employer_rule_snapshot_id, r.listingCheck.submission_rule_id) && r.rule.content_sha256 === r.listingCheck.evidence_sha256, "JOB_RULE_MISMATCH");
    requireThat(Boolean(r.draftJobId) === Boolean(r.ruleEvidence), "RULE_EVIDENCE_INCOMPLETE");
    const ruleEvidence = r.ruleEvidence ? validateMaterialRulePacketEvidence(r.ruleEvidence, {
      jobId: r.draftJobId!, customerId: expected.customerId, materialLineId: r.line.id, lineRevisionId: r.revision.id,
      sourceSnapshotId: r.snapshot.id, jobSnapshotId: r.job.id, jobContentSha256: r.job.content_sha256,
      ruleId: r.rule.id, ruleSha256: r.rule.content_sha256, originalCheckedAt: r.rule.checked_at,
    }, now) : undefined;
    const effectiveRuleCheckedAt = ruleEvidence?.effectiveCheckedAt ?? r.rule.checked_at;
    requireThat([r.job.retrieved_at, r.job.live_verified_at, r.rule.checked_at, r.rule.human_confirmed_at, r.listingCheck.checked_at].every(past) &&
      [effectiveRuleCheckedAt, r.listingCheck.checked_at].every((value) => clock - Date.parse(value) < 3_600_000) &&
      ![r.rule.resume_requirement, r.rule.cover_letter_requirement].includes("PROHIBITED"), "JOB_RULE_STALE");
    for (const rows of [r.facts, r.sourceFacts, r.documents, r.factReviews, r.requirements, r.reviews, r.referencePermissions]) requireThat(unique(rows.map((row) => String(row.id))), "DUPLICATE_EVIDENCE");
    const documents = new Map(r.documents.map((doc) => [doc.id, doc])), sources = new Map(r.sourceFacts.map((fact) => [fact.id, fact]));
    const facts = new Map(r.facts.map((fact) => [fact.id, fact]));
    for (const doc of r.documents) requireThat(doc.draft_id === r.draft.id && (doc.customer_id === null || doc.customer_id === expected.customerId), "SOURCE_OWNER_MISMATCH");
    requireThat(answers.entryMode === "GUIDED" ? !r.documents.some((doc) => doc.kind === "RESUME") : r.documents.some((doc) => doc.kind === "RESUME"), "ENTRY_SOURCE_MISMATCH");
    for (const source of r.sourceFacts) requireThat(source.snapshot_id === null && source.draft_id === r.draft.id &&
      (source.customer_id === null || source.customer_id === expected.customerId) && source.document_version_id && documents.has(source.document_version_id), "SOURCE_FACT_INVALID");
    for (const review of r.factReviews) requireThat(review.snapshot_id === r.snapshot.id && review.draft_id === r.draft.id && sources.has(review.fact_id) && past(review.reviewed_at), "SOURCE_REVIEW_INVALID");
    requireThat(unique(r.factReviews.map((review) => review.fact_id)) && r.sourceFacts.every((source) => r.factReviews.some((review) => review.fact_id === source.id)), "SOURCE_REVIEW_MISSING");
    for (const fact of r.facts) {
      requireThat(fact.snapshot_id === r.snapshot.id && fact.draft_id === r.draft.id && (fact.customer_id === null || fact.customer_id === expected.customerId) &&
        fact.superseded_at === null && ["CUSTOMER_CONFIRMED", "HUMAN_VERIFIED"].includes(fact.verification) && fact.confirmed_or_corrected_at && past(fact.confirmed_or_corrected_at), "FACT_NOT_CURRENT");
      const value = factValue(fact.typed_value);
      if (value.employmentFactId) requireThat(typeof value.employmentFactId === "string" && facts.has(value.employmentFactId), "FACT_PARENT_INVALID");
      if (Array.isArray(value.sourceFactIds)) requireThat(value.sourceFactIds.every((id) => typeof id === "string" && (facts.has(id) || sources.has(id))), "FACT_PARENT_INVALID");
      if (value.sourceDocumentFactId) {
        const source = sources.get(String(value.sourceDocumentFactId)), review = r.factReviews.find((row) => row.fact_id === value.sourceDocumentFactId);
        requireThat(source && review && (review.decision === "CONFIRM" && fact.source_kind === "DOCUMENT" && fact.document_version_id === source.document_version_id ||
          review.decision === "CORRECT" && review.correction_fact_id === fact.id && fact.source_kind === "CUSTOMER_ASSERTION" && fact.supersedes_fact_id === source.id), "SOURCE_REVIEW_INVALID");
        requireThat(review.decision === (answers.factReviews[source.id] ?? (source.verification === "CUSTOMER_CONFIRMED" ? "CONFIRM" : null)), "SOURCE_REVIEW_INVALID");
        let expectedValue = { ...factValue(source.typed_value) };
        if (review.decision === "CORRECT") {
          const correction = answers.factCorrections[source.id];
          requireThat(correction, "SOURCE_REVIEW_INVALID");
          const { category, ...fields } = correction;
          const changes = category === "FIELD_EDITS" ? record(record(correction).fields)
            : category === "EMPLOYER_OR_ORGANIZATION" ? { ["employer" in expectedValue ? "employer" : "employerOrOrganization"]: record(correction).employerOrOrganization }
              : category === "ROLE_OR_RELATIONSHIP" ? { ["historicalTitle" in expectedValue ? "historicalTitle" : "roleOrRelationship"]: record(correction).roleOrRelationship }
                : category === "RESPONSIBILITY" ? { ["activity" in expectedValue ? "activity" : "responsibility"]: record(correction).responsibility } : fields;
          expectedValue = { ...expectedValue, ...changes };
        }
        if (expectedValue.employmentFactId) {
          const parent = r.facts.find((candidate) => record(candidate.typed_value).sourceDocumentFactId === expectedValue.employmentFactId);
          requireThat(parent, "FACT_PARENT_INVALID"); expectedValue.employmentFactId = parent.id;
        }
        requireThat(canonicalSha256({ ...expectedValue, sourceDocumentFactId: source.id }) === canonicalSha256(value), "FACT_VALUE_DIFFERS_FROM_CONFIRMATION");
      } else requireThat(fact.source_kind === "CUSTOMER_ASSERTION" && fact.customer_assertion_snapshot_id === r.snapshot.id &&
        (answers.experienceAdditions.some((entry) => fact.semantic_key === `experience:${entry.clientId}`) ||
          Object.keys(answers.capabilities).some((task) => fact.semantic_key === `capability:${task}`)), "FACT_ORIGIN_UNSUPPORTED");
      if (fact.document_version_id) requireThat(documents.has(fact.document_version_id), "DOCUMENT_BINDING_INVALID");
      if (["MONTH", "YEAR", "UNKNOWN"].includes(String(value.datePrecision))) requireThat(fact.starts_on === null && fact.ends_on === null && fact.calendar_duration_days === null, "APPROXIMATE_DATE_UPGRADED");
      requireThat(!(value.current === true && value.endsOn) && !(fact.starts_on && fact.ends_on && fact.starts_on > fact.ends_on), "FACT_DATE_INVALID");
    }
    for (const experience of answers.experienceAdditions) requireThat(r.facts.some((fact) => fact.semantic_key === `experience:${experience.clientId}` && canonicalSha256(fact.typed_value) === canonicalSha256(experience)), "GUIDED_FACT_MISSING");
    for (const [task, status] of Object.entries(answers.capabilities)) requireThat(r.facts.some((fact) => fact.semantic_key === `capability:${task}` && canonicalSha256(fact.typed_value) === canonicalSha256({ task, status }) && fact.capability_status === status), "CAPABILITY_FACT_MISSING");
    requireThat(!answers.noPriorEmployment || !answers.experienceAdditions.some((experience) => ["PAID_EMPLOYMENT", "SELF_EMPLOYMENT_BUSINESS", "CONTRACT_FREELANCE"].includes(experience.kind)), "BACKGROUND_CONTRADICTION");
    const nodes = new Map(r.requirements.map((node) => [node.id, node]));
    for (const node of r.requirements) requireThat(node.job_snapshot_id === r.job.id, "REQUIREMENT_JOB_MISMATCH");
    const decisions = r.reviews.map((review) => {
      requireThat(review.snapshot_id === r.snapshot.id && review.job_snapshot_id === r.job.id && (review.customer_id === null || review.customer_id === expected.customerId) && past(review.created_at), "REVIEW_SCOPE_INVALID");
      const decision = record(review.decision);
      requireThat(decision.rulesVersion === MATCHING_RULES_VERSION && decision.reviewerId === review.reviewer_id && time.safeParse(decision.resolvedAt).success && past(String(decision.resolvedAt)) &&
        uuid.safeParse(decision.stableCriterionId).success && ["RESOLVED_PASS", "RESOLVED_FAIL", "REQUIRES_MORE_EVIDENCE"].includes(String(decision.disposition)), "REVIEW_VERSION_INVALID");
      const factIds = ids.safeParse(decision.candidateFactVersionIds), nodeIds = ids.safeParse(decision.sourceEvidenceNodeIds), declaredFacts = ids.safeParse(decision.candidateFactIds);
      requireThat(factIds.success && nodeIds.success && unique(factIds.data) && unique(nodeIds.data) && factIds.data.every((id) => facts.has(id)) && nodeIds.data.length && nodeIds.data.every((id) => nodes.has(id)), "REVIEW_EVIDENCE_INVALID");
      requireThat(declaredFacts.success && canonicalSha256([...declaredFacts.data].sort()) === canonicalSha256([...factIds.data].sort()), "REVIEW_EVIDENCE_INVALID");
      return { review, decision, factIds: factIds.data, nodeIds: nodeIds.data };
    });
    requireThat(unique(decisions.filter((item) => item.review.review_kind === "MATCH_EVIDENCE").map((item) => String(item.decision.stableCriterionId))), "REVIEW_AMBIGUOUS");
    const mappings = sorted(r.requirements).map((node) => {
      const match = decisions.find(({ review, decision }) => review.review_kind === "MATCH_EVIDENCE" && decision.stableCriterionId === node.stable_criterion_id);
      if (!match) return { jobEvidenceId: node.id, reviewId: null, status: "UNKNOWN_NO_REVIEW", factIds: [] as string[] };
      requireThat(match.nodeIds.includes(node.id), "REVIEW_CRITERION_MISMATCH");
      if (match.decision.disposition === "RESOLVED_PASS") {
        requireThat(match.factIds.length && ["DIRECT", "ADJACENT"].includes(String(match.decision.evidenceRelation)), "UNSUPPORTED_POSITIVE_REVIEW");
        requireThat(match.factIds.every((id) => draftingFactDisposition(factValue(facts.get(id)!.typed_value), facts.get(id)!.capability_status) === "CONFIRMED_SOURCE_NOT_APPROVED_PROSE"), "NEGATIVE_FACT_USED_AS_POSITIVE");
        if (match.decision.evidenceRelation === "ADJACENT") requireThat(decisions.some(({ review, decision, factIds }) => review.id === match.decision.adjacentEquivalenceReviewId &&
          review.review_kind === "ADJACENT_EQUIVALENCE" && decision.equivalentForCriterion === true && decision.disposition === "RESOLVED_PASS" && decision.stableCriterionId === node.stable_criterion_id &&
          canonicalSha256([...factIds].sort()) === canonicalSha256([...match.factIds].sort())), "EQUIVALENCE_REVIEW_REQUIRED");
      }
      return { jobEvidenceId: node.id, reviewId: match.review.id, status: String(match.decision.disposition), evidenceRelation: String(match.decision.evidenceRelation), factIds: [...match.factIds].sort() };
    });
    requireThat(unique(r.referencePermissionIds) && r.referencePermissions.length === r.referencePermissionIds.length &&
      r.referencePermissions.every((permission) => r.referencePermissionIds.includes(permission.id) && permission.customer_id === expected.customerId &&
        permission.delivered_release_id === r.intent.delivered_release_id && permission.job_snapshot_id === r.job.id && permission.job_snapshot_hash === r.job.content_sha256), "REFERENCE_SCOPE_INVALID");
    requireThat(r.line.selected_reference_sheet ? r.referencePermissionIds.length > 0 : !r.referencePermissionIds.length && r.rule.reference_timing !== "REQUIRED_NOW", "REFERENCE_SCOPE_INVALID");
    requireThat(r.line.selected_reference_sheet ? r.referenceMetadata !== undefined && r.referenceFilenameInstruction !== undefined
      : r.referenceMetadata === undefined && r.referenceFilenameInstruction === undefined, "REFERENCE_METADATA_REQUIRED");
    requireThat(!r.line.selected_reference_sheet || r.rule.reference_timing !== "PROHIBITED_NOW" && r.referencePermissionIds.length <= Math.min(3, r.rule.reference_count ?? 3), "REFERENCE_SCOPE_INVALID");
    requireThat(r.rule.reference_timing !== "REQUIRED_NOW" || r.rule.reference_count === null || r.referencePermissionIds.length === r.rule.reference_count,
      "REQUIRED_REFERENCE_CLARIFICATION");
    const referenceBindings = r.line.selected_reference_sheet ? bindDraftReferenceMetadata(r.referenceMetadata, {
      customerId: expected.customerId, deliveredReleaseId: r.intent.delivered_release_id, jobSnapshotId: r.job.id,
      jobSha256: r.job.content_sha256, permissionIds: r.referencePermissionIds,
    }, now) : undefined;
    if (r.referenceMetadata) requireThat(r.referenceMetadata.permissions.every(({ attested_at: _attested, ...permission }) => {
      void _attested; const existing = r.referencePermissions.find((candidate) => candidate.id === permission.id);
      return existing && exactPacketJson(existing) === exactPacketJson(permission);
    }), "REFERENCE_SCOPE_INVALID");

    const source = getEmployerSource(r.job.discovery_source), questionAuthority = r.questionSourceAuthority;
    const captureBinding = questionAuthority && source?.adapterKind === "greenhouse" && source.adapterKey && r.job.external_job_id &&
      questionAuthority.run.id === r.job.source_run_id && questionAuthority.run.source_id === r.job.discovery_source &&
      questionAuthority.run.source_authorization_id === r.job.source_authorization_id && questionAuthority.run.status === "succeeded" &&
      questionAuthority.run.enumeration_status === "complete" && questionAuthority.run.adapter_version && questionAuthority.run.scope_sha256 &&
      questionAuthority.authorization.id === r.job.source_authorization_id && questionAuthority.authorization.source_id === r.job.discovery_source &&
      questionAuthority.authorization.state === "AUTHORIZED_AUTOMATED" && questionAuthority.authorization.allowed_actions.includes("READ_APPLICATION_QUESTIONS") &&
      questionAuthority.head.source_id === r.job.discovery_source && questionAuthority.head.current_authorization_id === questionAuthority.authorization.id &&
      questionAuthority.head.revision === questionAuthority.run.authorization_head_revision ? {
        sourceId: r.job.discovery_source, boardToken: source.adapterKey, externalJobId: r.job.external_job_id,
        sourceRunId: questionAuthority.run.id, authorizationId: questionAuthority.authorization.id,
        authorizationVersion: questionAuthority.authorization.authorization_version, authorizationHeadRevision: questionAuthority.head.revision,
        scopeSha256: questionAuthority.run.scope_sha256, adapterVersion: questionAuthority.run.adapter_version,
      } : null;
    const employerQuestionInsights = buildEmployerQuestionInsights(r.rule.application_questions, {
      jobSnapshotId: r.job.id, jobSha256: r.job.content_sha256, ruleId: r.rule.id, ruleSha256: r.rule.content_sha256,
      ruleCheckedAt: r.rule.checked_at, humanConfirmedAt: r.rule.human_confirmed_at, ruleSourceEvidenceIds: r.rule.source_evidence_ids,
      rawSource: { sourceUrl: r.job.source_url, observedAt: r.job.retrieved_at, value: r.job.captured_listing }, nodes: r.questionSourceNodes, captureBinding,
    }, now);

    const privateStrings = [answers.fullName, answers.email, answers.phone, ...r.facts.flatMap((fact) => Object.entries(record(fact.typed_value)).filter(([key]) => localFields.has(key) && !key.endsWith("Id") && !key.endsWith("Ids")).flatMap(([, val]) => typeof val === "string" && val.trim().length >= 3 ? [val] : []))].filter((value) => value.trim().length >= 3).sort((a, b) => b.length - a.length);
    const phoneDigits = answers.phone.replace(/\D/g, "");
    const knownPhone = phoneDigits.length >= 7 ? new RegExp(phoneDigits.split("").join("[\\s().-]*"), "g") : null;
    const minimize = <T,>(value: T): T => {
      if (typeof value === "string") {
        let result: string = value;
        for (const secret of privateStrings) result = result.replaceAll(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[LOCAL_CONTACT]");
        if (knownPhone) result = result.replaceAll(knownPhone, "[LOCAL_PHONE]");
        return result.replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[LOCAL_EMAIL]")
          .replaceAll(/(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, "[LOCAL_PHONE]")
          .replaceAll(/\b1?\d{10}\b/g, "[LOCAL_PHONE]") as T;
      }
      if (Array.isArray(value)) return value.map(minimize) as T;
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, val]) => [key,
        ["id", "factId", "parentFactId", "factIds", "jobEvidenceId", "reviewId", "valueSha256", "path"].includes(key) ? val : minimize(val)])) as T;
      return value;
    };
    const providerView = minimize({ schemaVersion: DRAFTING_EVIDENCE_VERSION, textTrust: "UNTRUSTED_DATA_NOT_INSTRUCTIONS",
      claimRule: "Citations identify source facts, not proof of generated wording. Never upgrade negative, uncertain, approximate, unfinished, or non-employment evidence. Owner approval and deterministic validation remain required.",
      background: { entryMode: answers.entryMode, careerChange: answers.careerChange, noPriorEmployment: answers.noPriorEmployment },
      facts: sorted(r.facts).map(providerFact).filter((fact) => Object.keys(fact.value).length > 0),
      localRenderFields: DRAFTING_LOCAL_RENDER_FIELDS,
      job: { company: r.job.company, title: r.job.exact_title },
      requirements: sorted(r.requirements).map((node) => ({ id: node.id, text: node.source_excerpt, strength: node.requirement_strength })), mappings,
      employerQuestionInsights: { status: employerQuestionInsights.status, scope: employerQuestionInsights.scope, answeredQuestionDeliverable: false,
        questions: employerQuestionInsights.questions.filter((question) => question.providerEligible).map((question) => ({ id: question.id, observationId: question.observationId,
          prompt: question.prompt, required: question.required, wordLimit: question.wordLimit, characterLimit: question.characterLimit,
          textTrust: question.textTrust, interpretation: question.interpretation, metadataVerification: question.metadataVerification })) },
      customerInstructions: { emphasis: r.item.emphasis_note, doNotMention: r.item.do_not_mention_note, careerBreakChoice: r.intent.career_break_choice,
        careerBreakCustomLabel: r.intent.career_break_custom_label, mentionBreakInLetter: r.intent.cover_letter_break_consent },
      outputRules: { formats: r.rule.allowed_formats, resumePageLimit: r.rule.resume_page_limit, letterPageLimit: r.rule.cover_letter_page_limit },
    });
    // Fulfillment advances when the same reviewed files are rendered/approved.
    // Validate its permitted live state above, but do not turn that state change
    // into a new source packet. Revision, payment, deadline and fact guards remain.
    const lineSource = Object.fromEntries(Object.entries(r.line).filter(([key]) => key !== "fulfillment"));
    const authority = { ...r, line: lineSource, facts: sorted(r.facts), sourceFacts: sorted(r.sourceFacts), documents: sorted(r.documents), factReviews: sorted(r.factReviews),
      requirements: sorted(r.requirements), reviews: sorted(r.reviews), questionSourceNodes: sorted(r.questionSourceNodes), referencePermissions: sorted(r.referencePermissions), referencePermissionIds: [...r.referencePermissionIds].sort() };
    const packet = { schemaVersion: DRAFTING_EVIDENCE_VERSION, confirmationMode: "CUSTOMER_CONFIRMED_V1" as const, expected,
      evidenceSha256: canonicalSha256(authority), validUntil: new Date(Math.min(Date.parse(r.revision.due_at), Date.parse(effectiveRuleCheckedAt) + 3_600_000, Date.parse(r.listingCheck.checked_at) + 3_600_000)).toISOString(),
      binding: { snapshotId: r.snapshot.id, snapshotSha256: r.snapshot.content_sha256, confirmationReceipt: receipt.data,
        confirmationReceiptSha256: canonicalSha256(receipt.data), jobSnapshotId: r.job.id, jobSha256: r.job.content_sha256,
        ruleId: r.rule.id, ruleSha256: r.rule.content_sha256, listingCheckId: r.listingCheck.id, dueAt: r.revision.due_at,
        contactPayloadId: r.contact.id, contactSha256: r.contact.content_sha256, referencePermissions: sorted(r.referencePermissions) },
      employerQuestionInsights,
      ownerEvidence: { contactFact: r.contactFact, facts: sorted(r.facts), sourceFacts: sorted(r.sourceFacts), sourceReviews: sorted(r.factReviews), documents: sorted(r.documents),
        ...(referenceBindings ? { referenceBindings, referenceFilenameInstruction: r.referenceFilenameInstruction ?? null } : {}),
        ...(ruleEvidence ? { ruleEvidence } : {}),
        matchReviews: sorted(r.reviews), requirements: sorted(r.requirements), employerInstructions: r.rule, customerInstructions: r.item,
        targetJob: { id: r.job.id, company: r.job.company, exactTitle: r.job.exact_title, canonicalApplicationUrl: r.job.canonical_application_url,
          retrievedAt: r.job.retrieved_at, contentSha256: r.job.content_sha256 },
        jobSource: { sourceUrl: r.job.source_url, observedAt: r.job.retrieved_at, capturedListing: r.job.captured_listing, questionSourceAuthority: r.questionSourceAuthority } },
      providerView, providerViewSha256: canonicalSha256(providerView), approvalState: "UNREVIEWED" as const,
      authorization: "READ_COMPONENT_ONLY_REQUIRES_TRANSACTIONAL_REVISION_AND_WORKER_FENCE_CAS" as const,
      providerTransferAuthorized: false as const };
    return freeze({ ...packet, packetSha256: createHash("sha256").update(exactPacketJson(packet), "utf8").digest("hex") });
  } catch (error) {
    if (error instanceof DraftingEvidenceError) throw error;
    throw new DraftingEvidenceError("INVALID");
  }
}
export type DraftingEvidencePacket = ReturnType<typeof buildDraftingEvidencePacket>;

/** Store this canonical body in the encrypted payload. Its byte hash equals
 * packetSha256; that digest belongs in the DB receipt, not inside its own body. */
export function serializeDraftingEvidencePacket(packet: DraftingEvidencePacket) {
  const { packetSha256, ...body } = packet;
  const serialized = exactPacketJson(body);
  requireThat(createHash("sha256").update(serialized, "utf8").digest("hex") === packetSha256, "PACKET_DIGEST_INVALID");
  return serialized;
}

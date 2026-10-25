import { createHash } from "node:crypto";
import { CANONICALIZATION_VERSION, canonicalSha256 } from "@/lib/domain/foundation";
import { buildFourStepSnapshot, emptyFourStepDraft, normalizedFourStepDraft } from "@/lib/intake/four-step";
import { buildDraftingEvidencePacket, type DraftingEvidenceRecords } from "@/lib/documents/drafting-evidence";
import { validateDraftOutput, type DraftOutput, type DraftProseClaim } from "@/lib/documents/draft-output";
import { buildDraftRenderSource } from "@/lib/documents/draft-render-source";
import { captureRawSourceEvidence } from "@/lib/jobs/raw-source-evidence";
import { questionResponseSha256 } from "@/lib/jobs/application-question-evidence";
const id = (n: number) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const before = "2026-10-25T10:00:00.000Z", fresh = "2026-10-25T11:55:00.000Z", due = "2026-10-26T10:00:00.000Z";
export const draftFixtureNow = new Date("2026-10-25T12:00:00.000Z");
export function draftDocumentFixture(kind: "VOLUNTEER" | "EDUCATION_CERTIFICATION" | "PROJECT" | "CAREGIVING" = "VOLUNTEER", completionStatus = "Completed", withQuestions = false,
  datePrecision: "YEAR" | "MONTH" | "UNKNOWN" = "YEAR", breakChoice: "OMIT_ENTRY" | "CAREER_BREAK" | "FAMILY_CAREGIVING" | "CUSTOM_WORDING" = "OMIT_ENTRY", portfolio: string | null = null) {
  const contact = { schemaVersion: "chunk5-document-contact-v1", displayName: "Casey Example", email: "casey@example.test", phone: "212-555-0123", cityState: "Albany, NY", linkedInOrPortfolio: portfolio };
  const plaintext = Buffer.from(JSON.stringify(contact));
  const answers = normalizedFourStepDraft({ ...structuredClone(emptyFourStepDraft), entryMode: "GUIDED", backgroundReviewed: true,
    fullName: contact.displayName, email: contact.email, phone: contact.phone, noPriorEmployment: true,
    experienceAdditions: [{ clientId: id(40), kind, organizationOrProject: "Community center", roleOrRelationship: kind === "EDUCATION_CERTIFICATION" ? "Student" : kind === "CAREGIVING" ? "Family caregiving" : "Volunteer coordinator",
      startsOn: "2024-01-01", endsOn: "2025-01-01", datePrecision, responsibilities: ["Organized event schedules"], tools: ["Spreadsheet"],
      scope: "", outcome: "", intensityPercent: null, educationLevel: kind === "EDUCATION_CERTIFICATION" ? "Certificate" : "", educationField: kind === "EDUCATION_CERTIFICATION" ? "Office support" : "",
      completionStatus: kind === "EDUCATION_CERTIFICATION" ? completionStatus : "", certifications: [], relevantCoursework: [], optionalDetail: "", current: false }], capabilities: {} });
  const receipt = { id: id(30), contractVersion: "applypack-confirmed-intake-v1", draftVersion: 4, reviewSha256: "c".repeat(64), sourceSha256: "d".repeat(64), answersSha256: canonicalSha256(answers), preparedAt: before, entryMode: "GUIDED" };
  const fact = { id: id(20), snapshot_id: id(5), customer_id: null, draft_id: id(6), semantic_key: `experience:${id(40)}`, value_kind: kind === "EDUCATION_CERTIFICATION" ? "EDUCATION" : "EXPERIENCE", typed_value: answers.experienceAdditions[0], source_kind: "CUSTOMER_ASSERTION",
    document_version_id: null, customer_assertion_snapshot_id: id(5), assertion_control_id: `experience-${id(40)}`, source_locator: "Customer confirmed guided background", verification: "CUSTOMER_CONFIRMED", confirmed_or_corrected_at: before,
    superseded_at: null, supersedes_fact_id: null, schema_version: "applypack-intake-v4", catalog_version: "applypack-experience-v1", starts_on: null, ends_on: null, calendar_duration_days: null, intensity_percent: null, capability_status: null, customer_display_label: null };
  const r = {
    line: { id: id(1), purchase_id: id(2), payment_attempt_id: id(3), delivered_order_id: id(11), delivered_match_id: id(12), active_revision: 1, allocated_amount_cents: 799, fulfillment: "PAID", materials_payment_verified_at: before, materials_started_at: before, materials_due_at: due, selected_reference_sheet: false },
    purchase: { id: id(2), customer_id: id(10), checkout_intent_id: id(7), payment_attempt_id: id(3), amount_cents: 799, currency: "USD", completed_at: before },
    payment: { id: id(3), customer_id: id(10), amount_cents: 799, currency: "USD", settlement: "PAID", payment_verified_at: before, immediate_charge_verified: true, dispute: "NONE", funds_reversed_at: null },
    revision: { id: id(4), line_id: id(1), version: 1, binding_sha256: "a".repeat(64), source_snapshot_id: id(5), job_snapshot_id: id(8), employer_rule_snapshot_id: id(9), revision_kind: "ORIGINAL", parent_revision_id: null, accepted_at: before, started_at: before, due_at: due, superseded_at: null, reference_scope: null },
    snapshot: { id: id(5), customer_id: id(10), draft_id: id(6), schema_version: "applypack-intake-v4", canonicalization_version: CANONICALIZATION_VERSION, content_sha256: "a".repeat(64), sensitive_payload_id: id(31), finalized_at: before, confirmed_review: receipt },
    sourcePayload: { id: id(31), customer_id: null, draft_id: id(6), content_sha256: "f".repeat(64), retention_state: "ACTIVE" },
    draft: { id: id(6), converted_customer_id: id(10), finalized_snapshot_id: id(5), version: 5, confirmation_receipt: receipt, answers, retention_state: "ACTIVE" },
    intent: { id: id(7), customer_id: id(10), purchase_id: id(2), payment_attempt_id: id(3), delivered_order_id: id(11), delivered_release_id: id(13), source_snapshot_id: id(5), state: "COMPLETED", line_count: 1, amount_cents: 799, currency: "USD", selection_sha256: "e".repeat(64), document_contact_confirmed: true, document_facts_confirmed: true, contact_payload_id: id(14), career_break_choice: breakChoice, career_break_custom_label: breakChoice === "CUSTOM_WORDING" ? "Family responsibilities" : null, cover_letter_break_consent: false },
    contact: { id: id(14), customer_id: id(10), content_sha256: hash(plaintext), retention_state: "ACTIVE" },
    contactFact: { id: id(14), snapshot_id: id(5), customer_id: id(10), semantic_key: "document_contact.confirmed", value_kind: "PROTECTED_COMPOSITE",
      typed_value: { protectedPayloadId: id(14), contentSha256: hash(plaintext) }, source_kind: "CUSTOMER_ASSERTION", customer_assertion_snapshot_id: id(5),
      assertion_control_id: "chunk5_document_contact_confirmation", source_locator: "materials_checkout", verification: "CUSTOMER_CONFIRMED",
      confirmed_or_corrected_at: before, superseded_at: null, catalog_version: "chunk5-document-contact-v1", schema_version: "chunk5-document-contact-v1" },
    item: { id: id(15), checkout_intent_id: id(7), material_line_id: id(1), delivered_match_id: id(12), job_snapshot_id: id(8), submission_rule_id: id(9), emphasis_note: "", do_not_mention_note: "" },
    job: { id: id(8), legacy_job_id: id(16), content_sha256: "b".repeat(64), company: "Example employer", exact_title: "Office assistant", canonical_application_url: "https://employer.example/apply", source_url: "https://employer.example/job", captured_listing: { text: "Organize office records" }, discovery_source: "manual", external_job_id: null, source_run_id: null, source_authorization_id: null, retrieved_at: before, live_verified_at: fresh, listing_activity_result: "PASS", application_path_result: "PASS", legitimacy_result: "PASS" },
    rule: { id: id(9), job_snapshot_id: id(8), content_sha256: "c".repeat(64), checked_at: fresh, human_confirmed_at: fresh, human_confirmed_by: id(17), is_current: true, superseded_at: null, injection_scan_state: "CLEAR", hard_block_reason: null, allowed_formats: ["PDF"], resume_page_limit: 1, cover_letter_page_limit: 1, resume_requirement: "REQUIRED", cover_letter_requirement: "OPTIONAL", resume_filename_instruction: null, cover_letter_filename_instruction: null, reference_timing: "LATER_OR_UNKNOWN", reference_count: null, source_evidence_ids: [id(22)], application_questions: [] },
    listingCheck: { id: id(18), material_line_id: id(1), line_revision_id: id(4), job_snapshot_id: id(8), submission_rule_id: id(9), evidence_sha256: "c".repeat(64), phase: "BEFORE_GENERATION", result: "ACTIVE", checked_at: fresh },
    facts: [fact], sourceFacts: [], documents: [], factReviews: [], requirements: [{ id: id(22), job_snapshot_id: id(8), node_kind: "CRITERION", stable_criterion_id: id(23), source_excerpt: "Organize office records", source_locator: "Listing", requirement_strength: "REQUIRED", typed_value: { kind: "RESPONSIBILITY" }, position: 0 }], reviews: [],
    questionSourceNodes: [{ id: id(22), job_snapshot_id: id(8), source_excerpt: "Organize office records" }], questionSourceAuthority: null,
    referencePermissions: [], referencePermissionIds: [], ownsSnapshot: true, verifiedJobSnapshotIds: [id(8)], successorJobIds: [], refundIds: [],
  } as DraftingEvidenceRecords;
  if (withQuestions) {
    const rawResponse = { id: 123, questions: [{ label: "Describe how you prioritize competing requests.", required: true, fields: [{ name: "question_1", type: "textarea" }] }] };
    const capture = { schemaVersion: "applypack-greenhouse-question-capture-v1", sourceId: "duolingo", boardToken: "duolingo", externalJobId: "123",
      sourceUrl: "https://boards-api.greenhouse.io/v1/boards/duolingo/jobs/123?questions=true", capturedAt: before,
      authority: { sourceRunId: id(32), authorizationId: id(33), authorizationVersion: "fixture-v1", authorizationHeadRevision: 1, scopeSha256: "a".repeat(64) },
      outcome: "RESPONSE", reasonCode: "CAPTURED", httpStatus: 200, rawResponse, rawResponseSha256: questionResponseSha256(rawResponse) };
    Object.assign(r.job, { discovery_source: "duolingo", external_job_id: "123", source_run_id: id(32), source_authorization_id: id(33),
      captured_listing: { text: "Organize office records", parserIssues: [], fieldEvidence: {}, applicationQuestionObservation: capture,
        rawSourceEvidence: captureRawSourceEvidence("greenhouse-v4", { listing: { id: 123 }, applicationQuestionObservation: capture }) } });
    r.job.content_sha256 = canonicalSha256(r.job.captured_listing);
    r.questionSourceAuthority = { run: { id: id(32), source_id: "duolingo", adapter_version: "greenhouse-v4", source_authorization_id: id(33), authorization_head_revision: 1,
      scope_sha256: "a".repeat(64), status: "succeeded", enumeration_status: "complete" }, authorization: { id: id(33), source_id: "duolingo", authorization_version: "fixture-v1", allowed_actions: ["READ_APPLICATION_QUESTIONS"], state: "AUTHORIZED_AUTOMATED" },
      head: { source_id: "duolingo", current_authorization_id: id(33), revision: 1 } };
  }
  r.snapshot.content_sha256 = canonicalSha256({ ...buildFourStepSnapshot(answers, r.sourcePayload.content_sha256, CANONICALIZATION_VERSION), confirmedReview: receipt });
  r.revision.binding_sha256 = hash(`${r.intent.selection_sha256}:${r.job.content_sha256}:${r.rule.content_sha256}`);
  const expected = { customerId: id(10), materialLineId: id(1), revisionId: id(4), revisionVersion: 1, bindingSha256: r.revision.binding_sha256 };
  const packet = buildDraftingEvidencePacket(r, expected, draftFixtureNow);
  const claim: DraftProseClaim = { text: "Organized schedules for community activities.", sourceAtomIds: [packet.providerView.facts[0].atoms.find((atom) => atom.path === "/responsibilities/0")!.id], jobEvidenceIds: [], questionIds: packet.providerView.employerQuestionInsights.questions.map((question) => question.id), relation: completionStatus === "IN_PROGRESS" ? "QUALIFIED" : "DIRECT" };
  const draft = { schemaVersion: "applypack-draft-proposal-v1", language: "en-US", resume: { summary: [], skills: [], sections: kind === "EDUCATION_CERTIFICATION" ? [] : [{ anchorFactId: id(20), bullets: [claim] }], educationFactIds: kind === "EDUCATION_CERTIFICATION" ? [id(20)] : [] }, coverLetter: { body: [{ sentences: [{ ...claim, text: completionStatus === "IN_PROGRESS" ? "My current coursework includes organizing event schedules." : "I gained experience organizing community event schedules." }] }] } } as DraftOutput;
  const proposal = validateDraftOutput(draft, packet, draftFixtureNow);
  const input = { packet, proposal, contact: { payloadId: id(14), plaintext }, finalVersionAt: draftFixtureNow.toISOString() };
  return { input, r, draft, build: () => buildDraftRenderSource(input, draftFixtureNow) };
}

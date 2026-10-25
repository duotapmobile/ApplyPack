import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CANONICALIZATION_VERSION, canonicalSha256 } from "@/lib/domain/foundation";
import { buildFourStepSnapshot, emptyFourStepDraft, normalizedFourStepDraft, type FourStepDraft } from "@/lib/intake/four-step";
import { buildDraftingEvidencePacket, type DraftingEvidenceRecords } from "@/lib/documents/drafting-evidence";
import { validateDraftOutput, type DraftOutput, type DraftProseClaim } from "@/lib/documents/draft-output";
import { buildDraftRenderSource, serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { captureRawSourceEvidence } from "@/lib/jobs/raw-source-evidence";
import { questionResponseSha256 } from "@/lib/jobs/application-question-evidence";

vi.mock("server-only", () => ({}));
const id = (n: number) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const before = "2026-10-25T10:00:00.000Z", fresh = "2026-10-25T11:55:00.000Z", due = "2026-10-26T10:00:00.000Z";
const now = new Date("2026-10-25T12:00:00.000Z");
function fixture(kind: "VOLUNTEER" | "EDUCATION_CERTIFICATION" | "PROJECT" | "CAREGIVING" = "VOLUNTEER", completionStatus = "Completed", withQuestions = false,
  datePrecision: "YEAR" | "MONTH" | "UNKNOWN" = "YEAR", breakChoice: "OMIT_ENTRY" | "CAREER_BREAK" | "FAMILY_CAREGIVING" | "CUSTOM_WORDING" = "OMIT_ENTRY") {
  const contact = { schemaVersion: "chunk5-document-contact-v1", displayName: "Casey Example", email: "casey@example.test", phone: "212-555-0123", cityState: "Albany, NY", linkedInOrPortfolio: null };
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
  const packet = buildDraftingEvidencePacket(r, expected, now);
  const claim: DraftProseClaim = { text: "Organized schedules for community activities.", sourceAtomIds: [packet.providerView.facts[0].atoms.find((atom) => atom.path === "/responsibilities/0")!.id], jobEvidenceIds: [], questionIds: packet.providerView.employerQuestionInsights.questions.map((question) => question.id), relation: completionStatus === "IN_PROGRESS" ? "QUALIFIED" : "DIRECT" };
  const draft = { schemaVersion: "applypack-draft-proposal-v1", language: "en-US", resume: { summary: [], skills: [], sections: kind === "EDUCATION_CERTIFICATION" ? [] : [{ anchorFactId: id(20), bullets: [claim] }], educationFactIds: kind === "EDUCATION_CERTIFICATION" ? [id(20)] : [] }, coverLetter: { body: [{ sentences: [{ ...claim, text: completionStatus === "IN_PROGRESS" ? "My current coursework includes organizing event schedules." : "I gained experience organizing community event schedules." }] }] } } as DraftOutput;
  const proposal = validateDraftOutput(draft, packet, now);
  const input = { packet, proposal, contact: { payloadId: id(14), plaintext }, finalVersionAt: now.toISOString() };
  return { input, r, draft, build: () => buildDraftRenderSource(input, now) };
}
function refreshFixture(f: ReturnType<typeof fixture>) {
  const answers = normalizedFourStepDraft(f.r.draft.answers as unknown as FourStepDraft);
  const receipt = { ...(f.r.snapshot.confirmed_review as Record<string, unknown>), answersSha256: canonicalSha256(answers) };
  f.r.draft.answers = answers; f.r.draft.confirmation_receipt = receipt; f.r.snapshot.confirmed_review = receipt;
  f.r.snapshot.content_sha256 = canonicalSha256({ ...buildFourStepSnapshot(answers, f.r.sourcePayload.content_sha256, CANONICALIZATION_VERSION), confirmedReview: receipt });
  f.input.packet = buildDraftingEvidencePacket(f.r, f.input.packet.expected, now);
  f.input.proposal = validateDraftOutput(f.draft, f.input.packet, now);
}

describe("local reviewed-draft document source", () => {
  it("connects an actual validated packet and proposal with local contact and exact role headers", () => {
    const f = fixture(), bytesBefore = Buffer.from(f.input.contact.plaintext), source = f.build();
    expect(source.resume.summary).toEqual([]);
    expect(source.resume.sections[0]).toMatchObject({ heading: "Volunteer work", anchorFactId: id(20) });
    expect(source.resume.sections[0].header.map((block) => block.text)).toEqual(["Volunteer coordinator", "Community center", "2024 - 2025"]);
    expect(source.resume.header.map((block) => block.text)).toContain("casey@example.test");
    expect(source.coverLetter.introduction.text).toBe("I am applying for the Office assistant position at Example employer.");
    expect(source.coverLetter.signature.text).toBe("Casey Example");
    expect(source.state).toBe("OWNER_REVIEW_REQUIRED"); expect(source.deliveryAuthorized).toBe(false);
    expect(source.ownerReviewClaims.every((block) => block.state === "OWNER_REVIEW_REQUIRED")).toBe(true);
    expect(f.input.contact.plaintext).toEqual(bytesBefore);
    expect(Object.isFrozen(source.resume.sections[0].header[0])).toBe(true);
  });
  it("supports education only and labels incomplete work without inventing jobs or completion", () => {
    const source = fixture("EDUCATION_CERTIFICATION", "IN_PROGRESS").build();
    expect(source.resume.sections).toEqual([]);
    expect(source.resume.education[0].header.map((block) => block.text)).toEqual(["Certificate", "Office support", "Community center", "2024 - 2025", "In progress"]);
    expect(source.resume.education[0].header.every((block) => block.qualification === "QUALIFIED_TRANSFER")).toBe(true);
    expect(source.coverLetter.body[0][0].qualification).toBe("QUALIFIED_TRANSFER");
  });
  it("uses project labels without changing the confirmed role into employment", () => {
    expect(fixture("PROJECT").build().resume.sections[0].heading).toBe("Project");
  });
  it("preserves month precision and omits unknown dates instead of inventing precise days", () => {
    const month = fixture("VOLUNTEER", "Completed", false, "MONTH").build();
    expect(month.resume.sections[0].header.at(-1)?.text).toBe("2024-01 - 2025-01");
    const unknown = fixture("VOLUNTEER", "Completed", false, "UNKNOWN").build();
    expect(unknown.resume.sections[0].header.map((block) => block.text)).toEqual(["Volunteer coordinator", "Community center"]);
  });
  it("keeps employer question context out of document wording and separate from factual proof", () => {
    const source = fixture("VOLUNTEER", "Completed", true).build(), bullet = source.resume.sections[0].bullets[0];
    expect(bullet.questionInsights).toHaveLength(1);
    expect(bullet.questionInsights[0].interpretation).toBe("POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION");
    expect(bullet.factRefs[0].factId).toBe(id(20));
    expect(source.ownerReviewClaims.map((claim) => claim.text).join(" ")).not.toContain("Describe how you prioritize");
    expect(source.ownerReviewClaims.map((claim) => claim.text).join(" ")).not.toContain(bullet.questionInsights[0].questionId);
  });
  it.each([["CAREER_BREAK", "Career break"], ["FAMILY_CAREGIVING", "Family caregiving"], ["CUSTOM_WORDING", "Family responsibilities"]] as const)("uses confirmed dates for %s and only the selected display label", (choice, label) => {
    const f = fixture("CAREGIVING", "Completed", false, "MONTH", choice), source = f.build();
    expect(source.resume.careerBreak).toMatchObject({ choice, sourceFactId: id(20), label: { text: label, origin: "CUSTOMER_PRESENTATION", state: "OWNER_REVIEW_REQUIRED" }, dates: { text: "2024-01 - 2025-01" } });
    expect(source.coverLetter.body.flat().map((block) => block.text).join(" ")).not.toContain(label);
    const selected = buildDraftRenderSource({ ...f.input, careerBreakFactId: id(20) }, now);
    expect(selected.resume.careerBreak?.sourceFactId).toBe(id(20));
    expect(() => buildDraftRenderSource({ ...f.input, careerBreakFactId: id(90) }, now)).toThrow("CAREER_BREAK_SOURCE_INVALID");
  });
  it("asks for a specific owner clarification when no eligible break dates are confirmed", () => {
    expect(() => fixture("VOLUNTEER", "Completed", false, "YEAR", "CAREER_BREAK").build()).toThrow("OWNER_CLARIFICATION_CAREER_BREAK_DATES_REQUIRED");
    expect(() => fixture("CAREGIVING", "Completed", false, "UNKNOWN", "FAMILY_CAREGIVING").build()).toThrow("OWNER_CLARIFICATION_CAREER_BREAK_DATES_REQUIRED");
    expect(() => buildDraftRenderSource({ ...fixture().input, careerBreakFactId: id(20) }, now)).toThrow("CAREER_BREAK_SOURCE_NOT_SELECTED");
  });
  it("requires an explicit eligible source when multiple confirmed break ranges exist", () => {
    const f = fixture("CAREGIVING", "Completed", false, "YEAR", "CAREER_BREAK");
    const answers = f.r.draft.answers as unknown as FourStepDraft;
    const additional = { ...answers.experienceAdditions[0], clientId: id(41), startsOn: "2020-01-01", endsOn: "2021-01-01" };
    answers.experienceAdditions.push(additional);
    f.r.facts.push({ ...f.r.facts[0], id: id(21), semantic_key: `experience:${id(41)}`, typed_value: additional });
    refreshFixture(f);
    expect(() => f.build()).toThrow("OWNER_CLARIFICATION_CAREER_BREAK_SOURCE_AMBIGUOUS");
    const source = buildDraftRenderSource({ ...f.input, careerBreakFactId: id(21) }, now);
    expect(source.resume.careerBreak).toMatchObject({ sourceFactId: id(21), selection: "OWNER_SELECTED", dates: { text: "2020 - 2021" } });
  });
  it("requires letter consent independently from a selected resume break entry", () => {
    const f = fixture("CAREGIVING", "Completed", false, "YEAR", "FAMILY_CAREGIVING");
    f.draft.coverLetter.body[0].sentences[0].text = "My family caregiving involved organizing schedules.";
    refreshFixture(f);
    expect(() => f.build()).toThrow("CAREER_BREAK_CONSENT_REQUIRED");
    f.r.intent.cover_letter_break_consent = true; refreshFixture(f);
    expect(f.build().coverLetter.body[0][0].text).toBe("My family caregiving involved organizing schedules.");
  });
  it("uses the exact owner job target even when provider minimization removes matching contact text", () => {
    const f = fixture(); f.r.job.company = "Casey Example"; f.r.job.exact_title = "Assistant to Casey Example"; refreshFixture(f);
    expect(f.input.packet.providerView.job.company).toBe("[LOCAL_CONTACT]");
    const source = f.build();
    expect(source.coverLetter.recipient.text).toBe("Casey Example Hiring Team");
    expect(source.coverLetter.subject.text).toBe("Assistant to Casey Example");
  });
  it("binds exact raw fact scalar values and local contact separately from prose sources", () => {
    const source = fixture().build(), bullet = source.resume.sections[0].bullets[0];
    expect(bullet.factRefs).toEqual([{ factId: id(20), field: "responsibilities.0", valueSha256: hash(JSON.stringify("Organized event schedules")), attributionFactId: id(20) }]);
    expect(source.resume.header[0]).toMatchObject({ kind: "CANDIDATE_FACT", origin: "LOCAL_CONTACT", factRefs: [{ factId: id(14), field: "contentSha256", attributionFactId: id(14) }], contactBinding: { payloadId: id(14), fields: ["displayName"] } });
    expect(bullet.questionInsights).toEqual([]);
  });
  it("matches rendered wording hashes while preserving JSONB scalar quote, slash and Unicode bytes", () => {
    const f = fixture(), rawOrganization = 'Community "Café\\Support" e\u0301';
    (f.r.draft.answers as unknown as FourStepDraft).experienceAdditions[0].organizationOrProject = rawOrganization;
    (f.r.facts[0].typed_value as Record<string, unknown>).organizationOrProject = rawOrganization;
    refreshFixture(f);
    const source = f.build(), organization = source.resume.sections[0].header.find((claim) => claim.placement.endsWith(".organization"))!;
    expect(organization.factRefs[0].valueSha256).toBe(hash(JSON.stringify(rawOrganization)));
    expect(organization.factRefs[0].valueSha256).not.toBe(hash(rawOrganization));
    for (const claim of source.ownerReviewClaims) {
      const reviewMetadata = { claimId: claim.claimId, decision: "APPROVED", kind: claim.kind, qualification: claim.qualification,
        factRefs: claim.factRefs, jobEvidenceIds: claim.jobEvidenceIds, referencePermissionIds: claim.referencePermissionIds, wordingSha256: claim.wordingSha256 };
      const renderedClaim = { placement: claim.placement, kind: claim.kind, candidateFactIds: [...new Set(claim.factRefs.map((ref) => ref.factId))],
        jobEvidenceIds: claim.jobEvidenceIds, referencePermissionIds: claim.referencePermissionIds, visibleTextSha256: hash(claim.text) };
      expect(reviewMetadata.wordingSha256).toBe(renderedClaim.visibleTextSha256);
      expect(reviewMetadata.wordingSha256).not.toBe(hash(JSON.stringify(claim.text)));
    }
  });
  it("serializes exact immutable source bytes with a distinct digest", () => {
    const source = fixture().build(), serialized = serializeDraftRenderSource(source), { renderSourceSha256, ...body } = source;
    expect(hash(serialized)).toBe(renderSourceSha256); expect(JSON.parse(serialized)).toEqual(body);
    const altered = structuredClone(source); altered.coverLetter.signature.text = "Different name";
    expect(() => serializeDraftRenderSource(altered)).toThrow("SOURCE_DIGEST_INVALID");
  });
  it.each([
    ["different contact bytes", (f: ReturnType<typeof fixture>) => { f.input.contact.plaintext = Buffer.from(JSON.stringify({ displayName: "Different person" })); }, "CONTACT_DIGEST_INVALID"],
    ["different contact payload", (f: ReturnType<typeof fixture>) => { f.input.contact.payloadId = id(90); }, "CONTACT_BINDING_INVALID"],
    ["future document date", (f: ReturnType<typeof fixture>) => { f.input.finalVersionAt = due; }, "CLOCK_INVALID"],
    ["post-validation prose", (f: ReturnType<typeof fixture>) => { f.input.proposal.output.coverLetter.body[0].sentences[0].text = "Invented experience."; }, "INVALID"],
    ["post-validation claim metadata", (f: ReturnType<typeof fixture>) => { f.input.proposal.reviews[0].sources[0].factId = id(91); }, "INVALID"],
    ["oversized contact", (f: ReturnType<typeof fixture>) => { f.input.contact.plaintext = Buffer.alloc(9000); }, "CONTACT_BINDING_INVALID"],
  ] as const)("rejects %s", (_, mutate, error) => {
    const f = fixture(); mutate(f); expect(() => f.build()).toThrow(error);
  });
  it("rejects a stale packet even if all hashes still match", () => {
    const f = fixture(); expect(() => buildDraftRenderSource(f.input, new Date("2026-10-25T13:00:00Z"))).toThrow("INVALID");
  });
});

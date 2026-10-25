import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CANONICALIZATION_VERSION, canonicalSha256 } from "@/lib/domain/foundation";
import { buildFourStepSnapshot, emptyFourStepDraft, normalizedFourStepDraft, type FourStepDraft } from "@/lib/intake/four-step";
import { buildDraftingEvidencePacket, type DraftingEvidenceRecords } from "@/lib/documents/drafting-evidence";
import { validateDraftOutput, type DraftOutput, type DraftProseClaim } from "@/lib/documents/draft-output";
import { buildDraftRenderSource } from "@/lib/documents/draft-render-source";
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

import JSZip from "jszip";
import { prepareDraftDocx, inspectDraftDocx, DRAFT_DOCX_GENERATOR_VERSION } from "@/lib/documents/draft-docx";
import { inspectDocxPackage } from "@/lib/documents/generate";
import { DOCUMENT_GENERATOR_VERSION, isCurrentDocumentGeneratorVersion } from "@/lib/documents/requirements";

const inputFor = (f: ReturnType<typeof fixture>) => ({ source: f.build(), packet: f.input.packet });
async function changeXml(buffer: Buffer, mutate: (xml: string) => string) {
  const zip = await JSZip.loadAsync(buffer);
  zip.file("word/document.xml", mutate(await zip.file("word/document.xml")!.async("string")));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("real DOCX from the exact reviewed draft source", () => {
  it("builds genuine clean Word files with exact local headers, metadata and an explicit new generator identity", async () => {
    const input = inputFor(fixture()), output = await prepareDraftDocx(input, now);
    expect(output.generatorVersion).toBe(DRAFT_DOCX_GENERATOR_VERSION);
    expect(output.generatorVersion).not.toBe(DOCUMENT_GENERATOR_VERSION);
    expect(isCurrentDocumentGeneratorVersion(output.generatorVersion)).toBe(false);
    for (const artifact of [output.resume, output.coverLetter]) {
      expect(artifact.buffer.subarray(0, 2).toString()).toBe("PK");
      expect(artifact.inspection.passed).toBe(true);
      expect(artifact.expectedPageCount).toBe(1);
      expect(artifact.state).toBe("OWNER_REVIEW_REQUIRED"); expect(artifact.deliveryAuthorized).toBe(false);
      expect(artifact.filename).toMatch(/\.docx$/u);
      const zip = await JSZip.loadAsync(artifact.buffer), xml = await zip.file("word/document.xml")!.async("string");
      const core = await zip.file("docProps/core.xml")!.async("string");
      expect(xml).toContain("Casey Example"); expect(xml).toContain("casey@example.test");
      expect(xml).not.toContain("78000000-"); expect(xml).not.toContain("candidateFactIds");
      expect(core).toContain("<dc:creator>Casey Example</dc:creator>");
      expect(core).toContain("Application for Office assistant at Example employer");
      expect(core).toContain("<dc:language>en-US</dc:language>");
      expect(core).not.toContain("<cp:lastModifiedBy>Casey");
      expect(zip.file("docProps/custom.xml")).toBeNull();
    }
    expect(output.resume.inspection.extractedText).toContain("VOLUNTEER WORK Volunteer coordinator Community center | 2024 - 2025");
    expect(output.coverLetter.inspection.extractedText).toContain("Re: Office assistant Dear Hiring Team, I am applying");
    expect(output.coverLetter.inspection.extractedText).toContain("Sincerely, Casey Example");
  });
  it("supports education-only and incomplete education without fabricated work or list items", async () => {
    const input = inputFor(fixture("EDUCATION_CERTIFICATION", "IN_PROGRESS")), output = await prepareDraftDocx(input, now);
    expect(output.resume.inspection.passed).toBe(true);
    expect(output.resume.inspection.sourceExpectation.expectedListItems).toBe(0);
    expect(output.resume.inspection.extractedText).toContain("Certificate | Office support | Community center | 2024 - 2025 | In progress");
    expect(output.resume.inspection.extractedText).not.toContain("WORK EXPERIENCE");
    const legacy = await inspectDocxPackage(output.resume.buffer, "RESUME");
    expect(legacy.checks.nativeBullets).toBe(false); expect(legacy.passed).toBe(false);
    expect(output.resume.ownerReviewClaims.filter((claim) => claim.placement.startsWith("resume.education")).every((claim) => claim.qualification === "QUALIFIED_TRANSFER")).toBe(true);
  });
  it.each(["PROJECT", "VOLUNTEER"] as const)("keeps %s attribution and native list structure", async (kind) => {
    const input = inputFor(fixture(kind)), output = await prepareDraftDocx(input, now);
    expect(output.resume.inspection.sourceExpectation.expectedListItems).toBe(1);
    expect(output.resume.inspection.extractedText).toContain(kind === "PROJECT" ? "PROJECT" : "VOLUNTEER WORK");
    const claim = output.resume.provenance.claims.find((claim) => claim.placement.endsWith(".bullets.0"))!;
    expect(claim.candidateFactIds).toEqual([id(20)]);
    expect(claim.visibleTextSha256).toBe(hash(input.source.resume.sections[0].bullets[0].text));
  });
  it("keeps confirmed career-break label, month precision and letter consent", async () => {
    const input = inputFor(fixture("CAREGIVING", "Completed", false, "MONTH", "CUSTOM_WORDING"));
    const output = await prepareDraftDocx(input, now);
    expect(output.resume.inspection.extractedText).toContain("CAREER BREAK Family responsibilities | 2024-01 - 2025-01");
    expect(output.coverLetter.inspection.extractedText).not.toContain("Family responsibilities");
    expect(output.resume.provenance.claims.filter((claim) => claim.placement.startsWith("resume.careerBreak"))).toHaveLength(2);
  });
  it("keeps exact text and atomic wording hashes when contact and employer strings overlap", async () => {
    const f = fixture(); f.r.job.company = "Casey Example"; f.r.job.exact_title = "Assistant to Casey Example"; refreshFixture(f);
    const input = inputFor(f), output = await prepareDraftDocx(input, now);
    expect(output.coverLetter.inspection.extractedText).toContain("Casey Example Hiring Team");
    expect(output.coverLetter.inspection.extractedText).not.toContain("LOCAL_CONTACT");
    for (const artifact of [output.resume, output.coverLetter]) for (const claim of artifact.provenance.claims) {
      const reviewed = input.source.ownerReviewClaims.find((block) => block.placement === claim.placement)!;
      expect(claim.visibleTextSha256).toBe(reviewed.wordingSha256);
      expect(claim.candidateFactIds).toEqual([...new Set(reviewed.factRefs.map((ref) => ref.factId))].sort());
    }
  });
  it("keeps employer question insights in owner context and out of DOCX bytes", async () => {
    const input = inputFor(fixture("VOLUNTEER", "Completed", true)), output = await prepareDraftDocx(input, now);
    expect(output.resume.ownerReviewClaims.some((claim) => claim.questionInsights.length)).toBe(true);
    const zip = await JSZip.loadAsync(output.resume.buffer);
    const all = (await Promise.all(Object.keys(zip.files).filter((name) => name.endsWith(".xml")).map((name) => zip.file(name)!.async("string")))).join(" ");
    expect(all).not.toContain("Describe how you prioritize"); expect(all).not.toContain("POTENTIAL_EMPLOYER_PRIORITY");
  });
  it("rejects modified visible wording, missing native lists and wrong role order", async () => {
    const input = inputFor(fixture()), output = await prepareDraftDocx(input, now);
    const changed = await changeXml(output.resume.buffer, (xml) => xml.replace("Volunteer coordinator", "Invented manager"));
    expect((await inspectDraftDocx(changed, input, "RESUME")).checks.exactReviewedText).toBe(false);
    const noList = await changeXml(output.resume.buffer, (xml) => xml.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/gu, ""));
    expect((await inspectDraftDocx(noList, input, "RESUME")).checks.nativeBullets).toBe(false);
    const reordered = await changeXml(output.resume.buffer, (xml) => xml.replace("Volunteer coordinator", "TEMP_SWAP").replace("Community center", "Volunteer coordinator").replace("TEMP_SWAP", "Community center"));
    expect((await inspectDraftDocx(reordered, input, "RESUME")).passed).toBe(false);
  });
  it("does not turn the no-list source exception into a general safety bypass", async () => {
    const input = inputFor(fixture("EDUCATION_CERTIFICATION", "IN_PROGRESS")), output = await prepareDraftDocx(input, now);
    const hidden = await changeXml(output.resume.buffer, (xml) => xml.replace("<w:rPr>", "<w:rPr><w:vanish/>"));
    expect((await inspectDraftDocx(hidden, input, "RESUME")).passed).toBe(false);
    const inventedList = await changeXml(output.resume.buffer, (xml) => xml.replace("<w:pPr>", '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'));
    expect((await inspectDraftDocx(inventedList, input, "RESUME")).checks.nativeBullets).toBe(false);
  });
  it("rejects a moved list marker, a different contact link and cross-job metadata even when visible words match", async () => {
    const input = inputFor(fixture()), output = await prepareDraftDocx(input, now);
    const moved = await changeXml(output.resume.buffer, (xml) => {
      const marker = /<w:numPr>[\s\S]*?<\/w:numPr>/u.exec(xml)![0];
      return xml.replace(marker, "").replace("<w:pPr>", `<w:pPr>${marker}`);
    });
    const movedInspection = await inspectDraftDocx(moved, input, "RESUME");
    expect(movedInspection.checks.exactReviewedText).toBe(true);
    expect(movedInspection.checks.nativeBullets).toBe(true);
    expect(movedInspection.checks.exactParagraphStructure).toBe(false);
    const zip = await JSZip.loadAsync(output.resume.buffer);
    zip.file("word/_rels/document.xml.rels", (await zip.file("word/_rels/document.xml.rels")!.async("string")).replace("mailto:casey@example.test", "mailto:other@example.test"));
    zip.file("docProps/core.xml", (await zip.file("docProps/core.xml")!.async("string")).replace("Example employer", "Other employer"));
    const changed = await inspectDraftDocx(await zip.generateAsync({ type: "nodebuffer" }), input, "RESUME");
    expect(changed.checks.exactContactLinks).toBe(false); expect(changed.checks.exactMetadata).toBe(false);
  });
  it("rejects altered source bytes, mismatched packet and expired evidence before preparing files", async () => {
    const input = inputFor(fixture()), changed = structuredClone(input);
    changed.source.resume.sections[0].header[0].text = "Manager";
    await expect(prepareDraftDocx(changed, now)).rejects.toThrow("SOURCE_DIGEST_INVALID");
    const different = inputFor(fixture("PROJECT"));
    await expect(prepareDraftDocx({ source: input.source, packet: different.packet }, now)).rejects.toThrow("SOURCE_BINDING_INVALID");
    await expect(prepareDraftDocx(input, new Date("2026-10-25T13:00:00Z"))).rejects.toThrow("EVIDENCE_EXPIRED");
  });
  it("keeps prepared provenance detached from caller mutations during the final asynchronous inspection", async () => {
    const input = structuredClone(inputFor(fixture())), original = structuredClone(input), load = JSZip.loadAsync.bind(JSZip);
    let calls = 0;
    const spy = vi.spyOn(JSZip, "loadAsync").mockImplementation((...args) => {
      if (++calls === 6) {
        input.source.coverLetter.body[0][0].factRefs[0].factId = id(999);
        input.packet.ownerEvidence.targetJob.company = "Changed during inspection";
      }
      return load(...args);
    });
    try {
      const output = await prepareDraftDocx(input, now);
      expect(calls).toBe(6);
      expect(output.coverLetter.metadata.subject).toContain("Example employer");
      expect(output.coverLetter.provenance.sourceBinding.candidateFactIds).not.toContain(id(999));
      expect([...output.coverLetter.ownerReviewClaims].sort((a, b) => a.claimId.localeCompare(b.claimId)))
        .toEqual(original.source.ownerReviewClaims.filter((claim) => claim.placement.startsWith("coverLetter.")).sort((a, b) => a.claimId.localeCompare(b.claimId)));
      output.coverLetter.ownerReviewClaims.find((claim) => claim.factRefs.length)!.factRefs[0].factId = id(998);
      expect(input.source.ownerReviewClaims.some((claim) => claim.factRefs.some((ref) => ref.factId === id(998)))).toBe(false);
      expect(output.coverLetter.provenance.sourceBinding.candidateFactIds).not.toContain(id(998));
    } finally { spy.mockRestore(); }
  });
  it("inspects an owned byte and source snapshot even if the caller changes both at the first await", async () => {
    const input = structuredClone(inputFor(fixture())), output = await prepareDraftDocx(input, now), buffer = Buffer.from(output.resume.buffer);
    const expectedSha = input.source.renderSourceSha256, load = JSZip.loadAsync.bind(JSZip);
    const inspectedBuffers: Buffer[] = [];
    let calls = 0;
    const spy = vi.spyOn(JSZip, "loadAsync").mockImplementation((...args) => {
      if (Buffer.isBuffer(args[0])) inspectedBuffers.push(args[0]);
      if (++calls === 1) { buffer.fill(0); Object.assign(input.source, { renderSourceSha256: "0".repeat(64) }); }
      return load(...args);
    });
    try {
      const inspection = await inspectDraftDocx(buffer, input, "RESUME");
      expect(inspection.passed).toBe(true); expect(inspection.sourceExpectation.renderSourceSha256).toBe(expectedSha);
      expect(inspectedBuffers).toHaveLength(2);
      expect(inspectedBuffers.every((owned) => owned !== buffer && owned.every((byte) => byte === 0))).toBe(true);
      expect(output.resume.buffer.subarray(0, 2).toString()).toBe("PK");
    } finally { spy.mockRestore(); }
  });
  it("rejects moving incomplete education status to another qualification even when flattened words are unchanged", async () => {
    const f = fixture("EDUCATION_CERTIFICATION", "IN_PROGRESS");
    const answers = f.r.draft.answers as unknown as FourStepDraft;
    const additional = { ...answers.experienceAdditions[0], clientId: id(41), educationField: "Business support", completionStatus: "Completed" };
    answers.experienceAdditions.push(additional);
    f.r.facts.push({ ...f.r.facts[0], id: id(21), semantic_key: `experience:${id(41)}`, typed_value: additional, assertion_control_id: `experience-${id(41)}` });
    f.draft.resume.educationFactIds.push(id(21)); refreshFixture(f);
    const input = inputFor(f), output = await prepareDraftDocx(input, now);
    const changed = await changeXml(output.resume.buffer, (xml) => xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu, (part) => {
      if (part.includes("Office support")) return part.replace(" | In progress</w:t>", "</w:t>");
      if (part.includes("Business support")) return part.replace(/(<w:t(?:\s[^>]*)?>)/u, "$1 | In progress ");
      return part;
    }));
    const inspection = await inspectDraftDocx(changed, input, "RESUME");
    expect(inspection.checks.exactReviewedText).toBe(true); expect(inspection.checks.exactParagraphStructure).toBe(true);
    expect(inspection.checks.exactParagraphText).toBe(false); expect(inspection.passed).toBe(false);
  });
  it("rejects swapped email and portfolio link identities without changing visible text or relationship targets", async () => {
    const f = fixture(), contact = JSON.parse(Buffer.from(f.input.contact.plaintext).toString("utf8"));
    contact.linkedInOrPortfolio = "https://portfolio.example/casey?view=work&sort=recent";
    f.input.contact.plaintext = Buffer.from(JSON.stringify(contact));
    f.r.contact.content_sha256 = hash(f.input.contact.plaintext);
    f.r.contactFact!.typed_value = { protectedPayloadId: id(14), contentSha256: f.r.contact.content_sha256 };
    refreshFixture(f);
    const input = inputFor(f), output = await prepareDraftDocx(input, now);
    const changed = await changeXml(output.resume.buffer, (xml) => {
      const links = [...xml.matchAll(/<w:hyperlink\b[^>]*\br:id="([^"]+)"/gu)];
      expect(links).toHaveLength(2);
      return xml.replace(`r:id="${links[0][1]}"`, 'r:id="SWAP_LINK"').replace(`r:id="${links[1][1]}"`, `r:id="${links[0][1]}"`).replace('r:id="SWAP_LINK"', `r:id="${links[1][1]}"`);
    });
    const inspection = await inspectDraftDocx(changed, input, "RESUME");
    expect(inspection.checks.exactReviewedText).toBe(true); expect(inspection.checks.exactParagraphText).toBe(true);
    expect(inspection.checks.exactContactLinks).toBe(false); expect(inspection.passed).toBe(false);
  });
  it("preserves three substantive letter paragraphs and merges only the exact closing to stay within four paragraphs", async () => {
    const f = fixture(), claim = f.draft.coverLetter.body[0].sentences[0];
    f.draft.coverLetter.body.push({ sentences: [{ ...claim, text: "I organized schedules for community activities." }] },
      { sentences: [{ ...claim, text: "My background includes organizing community event schedules." }] });
    refreshFixture(f);
    const input = inputFor(f), output = await prepareDraftDocx(input, now);
    const zip = await JSZip.loadAsync(output.coverLetter.buffer), xml = await zip.file("word/document.xml")!.async("string");
    const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/gu)].map((match) => match[0]);
    const start = paragraphs.findIndex((part) => part.includes("Dear Hiring Team,")), end = paragraphs.findIndex((part) => part.includes("Sincerely,"));
    expect(end - start - 1).toBe(4);
    expect(paragraphs[end - 1]).toContain(input.source.coverLetter.body[2][0].text);
    expect(paragraphs[end - 1]).toContain(input.source.coverLetter.closing.text);
    expect([...output.coverLetter.ownerReviewClaims].sort((a, b) => a.claimId.localeCompare(b.claimId)))
      .toEqual(input.source.ownerReviewClaims.filter((entry) => entry.placement.startsWith("coverLetter.")).sort((a, b) => a.claimId.localeCompare(b.claimId)));
    expect(output.coverLetter.inspection.passed).toBe(true);
  });
});

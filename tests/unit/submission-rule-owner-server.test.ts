// @vitest-environment node
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
vi.mock("server-only", () => ({}));
import { canonicalSha256 } from "@/lib/domain/foundation";
import { canonicalRuleCitations, createSubmissionRuleOwnerServer, type SubmissionRuleOwnerPort } from "@/lib/documents/submission-rule-owner-server";
import { submissionRuleConfirmationSchema } from "@/lib/documents/submission-rule-proposal";

const id = (n: number) => `a1160000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reviewer = id(2), jobId = id(1), nodeId = id(3), requestId = id(4), now = new Date("2026-10-27T12:00:00Z");
const text = "Équipe support\nResume required.\nCover letter optional.\nAccepted formats: PDF.\nSubmission method: HTTPS upload.";
const captured = { text, parserIssues: [] }, hash = canonicalSha256(captured);
const basis = { contractVersion: "applypack-employer-rule-review-v1", jobSnapshotId: jobId, jobContentSha256: hash,
  jobRecordSha256: "b".repeat(64), sourceAuthoritySha256: "c".repeat(64), sourceEvidenceSha256: "d".repeat(64), currentRuleId: null, currentRuleRecordSha256: null };
const request = () => submissionRuleConfirmationSchema.parse({ requestId, jobSnapshotId: jobId, expectedBasis: basis,
  choices: { resumeRequirement: "REQUIRED", coverLetterRequirement: "OPTIONAL", allowedFormats: ["PDF"], resumePageLimit: null, coverLetterPageLimit: null,
    resumeFilenameInstruction: null, coverLetterFilenameInstruction: null, referenceFilenameInstruction: null, referenceTiming: "LATER_OR_UNKNOWN", referenceCount: null,
    submissionChannel: "HTTPS_UPLOAD", portfolioInstruction: null, workSampleInstruction: null },
  fieldEvidence: { resumeRequirement: "Resume required.", coverLetterRequirement: "Cover letter optional.", allowedFormats: "Accepted formats: PDF.", submissionChannel: "Submission method: HTTPS upload.",
    resumePageLimit: null, coverLetterPageLimit: null, resumeFilenameInstruction: null, coverLetterFilenameInstruction: null, referenceFilenameInstruction: null, referenceTiming: null, referenceCount: null, portfolioInstruction: null, workSampleInstruction: null },
  checklist: { listingOpened: true, applicationOpened: true, sourceCompared: true, requirementsConfirmed: true, questionsReviewed: true, noUnsupportedDefaults: true } });
const source = () => ({ job: { id: jobId, legacy_job_id: id(20), content_sha256: hash, company: "Fictional Employer", exact_title: "Support Specialist",
  canonical_application_url: "https://example.test/apply", source_url: "https://example.test/job", captured_listing: captured, retrieved_at: "2026-10-27T11:00:00Z", live_verified_at: "2026-10-27T11:00:00Z",
  discovery_source: "manual-example", external_job_id: null, source_run_id: null, source_authorization_id: null, listing_activity_result: "PASS", application_path_result: "PASS", legitimacy_result: "PASS" },
  nodes: [{ id: nodeId, job_snapshot_id: jobId, source_excerpt: text, classification_method: "employer-instruction-source-v1" }], questionAuthority: null });
type ConfirmInput = Parameters<SubmissionRuleOwnerPort["confirm"]>[0];
function outcome(input: ConfirmInput, current = true) {
  return { receipt: { request_id: input.requestId, job_snapshot_id: input.jobSnapshotId, reviewer_id: input.reviewerId, expected_basis: input.expectedBasis,
    confirmed_rules: input.confirmedRules, confirmed_rules_sha256: "e".repeat(64), review_checklist: input.checklist, review_evidence: input.reviewEvidence,
    rule_id: id(5), rule_content_sha256: "f".repeat(64), checked_at: now.toISOString(), receipt_sha256: "1".repeat(64), created_at: now.toISOString() }, replayed: false, current };
}
let port: { [K in keyof SubmissionRuleOwnerPort]: Mock<SubmissionRuleOwnerPort[K]> };
beforeEach(() => {
  port = { basis: vi.fn<SubmissionRuleOwnerPort["basis"]>().mockResolvedValue({ basis, sourceEvidenceId: nodeId, currentRule: null, effectivePrepurchaseCheckedAt: null }), source: vi.fn<SubmissionRuleOwnerPort["source"]>().mockImplementation(async () => source()),
    prepare: vi.fn<SubmissionRuleOwnerPort["prepare"]>().mockResolvedValue({ sourceEvidenceId: nodeId, created: true, basis }), confirm: vi.fn<SubmissionRuleOwnerPort["confirm"]>().mockImplementation(async (input) => outcome(input)), receipt: vi.fn<SubmissionRuleOwnerPort["receipt"]>().mockResolvedValue(null) };
});
const server = () => createSubmissionRuleOwnerServer(port, reviewer, () => now);
describe("source-bound owner submission-rule service", () => {
  it("loads an ordinary captured source without mutation and exposes honest question inspection status", async () => {
    const result = await server().review(jobId); expect(result.status).toBe("READY");
    if (result.status !== "READY") throw new Error(); expect(result.view.questions.status).toBe("NOT_INSPECTED");
    expect(result.view.suggestions.resumeRequirement.value).toBe("REQUIRED"); expect(port.confirm).not.toHaveBeenCalled(); expect(port.prepare).not.toHaveBeenCalled();
    expect(port.basis).toHaveBeenCalledTimes(2); expect(port.source).toHaveBeenCalledTimes(2);
  });
  it("requires explicit preparation and never substitutes unrelated qualification evidence", async () => {
    port.basis.mockResolvedValue({ basis, sourceEvidenceId: null, currentRule: null, effectivePrepurchaseCheckedAt: null });
    port.source.mockResolvedValue({ ...source(), nodes: [{ id: id(9), job_snapshot_id: jobId, source_excerpt: "Degree required", classification_method: "old-listing-parser" }] });
    expect(await server().review(jobId)).toEqual({ status: "PREPARATION_REQUIRED", jobSnapshotId: jobId, title: "Support Specialist", company: "Fictional Employer" });
    expect(port.prepare).not.toHaveBeenCalled(); expect(await server().prepare(jobId)).toEqual({ prepared: true });
    expect(port.prepare).toHaveBeenCalledWith(jobId, reviewer);
    await expect(server().confirm(request())).rejects.toMatchObject({ code: "SOURCE_BLOCKED" }); expect(port.confirm).not.toHaveBeenCalled();
  });
  it("binds the trusted reviewer, exact basis, generated whole-source evidence and canonical byte citations", async () => {
    const saved = await server().confirm(request()); expect(saved.requestId).toBe(requestId); expect(saved.current).toBe(true);
    const input = port.confirm.mock.calls[0][0] as ConfirmInput;
    expect(input.reviewerId).toBe(reviewer); expect(input.confirmedRules.sourceEvidenceIds).toEqual([nodeId]);
    expect(input.confirmedRules.applicationQuestions).toEqual([]); expect(input.confirmedRules.parserVersion).toBe("applypack-submission-rule-proposal-v1");
    expect(input).not.toHaveProperty("checkedAt");
    const citation = input.reviewEvidence.citations.find((item) => item.field === "resumeRequirement")!;
    expect(citation.startByte).toBe(Buffer.byteLength("Équipe support\n"));
    expect(citation.endByte - citation.startByte).toBe(Buffer.byteLength("Resume required."));
    expect(Buffer.from(text).subarray(citation.startByte, citation.endByte).toString()).toBe("Resume required.");
  });
  it("reconciles exact saved rules and quotes after the source changes without rebuilding or writing again", async () => {
    await server().confirm(request()); const receipt = outcome(port.confirm.mock.calls[0][0], false);
    port.receipt.mockResolvedValue(receipt); port.source.mockRejectedValue(new Error("source is no longer current")); port.confirm.mockClear();
    const saved = await server().confirm(request()); expect(saved.current).toBe(false); expect(port.confirm).not.toHaveBeenCalled();
    expect(port.source).toHaveBeenCalledTimes(2);
  });
  it("rejects changed request contents, quotes and reviewer identity on replay", async () => {
    await server().confirm(request()); const receipt = outcome(port.confirm.mock.calls[0][0]); port.receipt.mockResolvedValue(receipt); port.confirm.mockClear();
    const changedChoice = request(); changedChoice.choices.resumeRequirement = "OPTIONAL";
    await expect(server().confirm(changedChoice)).rejects.toMatchObject({ code: "RECEIPT_CONFLICT" });
    const changedQuote = request(); changedQuote.fieldEvidence.resumeRequirement = "Resume required.\nCover letter optional.";
    await expect(server().confirm(changedQuote)).rejects.toMatchObject({ code: "RECEIPT_CONFLICT" });
    port.receipt.mockResolvedValue({ ...receipt, receipt: { ...receipt.receipt, reviewer_id: id(99) } });
    await expect(server().receipt(jobId, requestId)).rejects.toMatchObject({ code: "RECEIPT_CONFLICT" }); expect(port.confirm).not.toHaveBeenCalled();
  });
  it("rejects a wrong job or source digest before producing a review", async () => {
    port.source.mockResolvedValue({ ...source(), job: { ...source().job, id: id(90) } });
    await expect(server().review(jobId)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    port.source.mockResolvedValue({ ...source(), job: { ...source().job, content_sha256: "a".repeat(64) } });
    await expect(server().review(jobId)).rejects.toMatchObject({ code: "SOURCE_BLOCKED" });
  });
  it("rejects a changed source, authorization or basis during the bounded read", async () => {
    port.basis.mockResolvedValueOnce({ basis, sourceEvidenceId: nodeId, currentRule: null, effectivePrepurchaseCheckedAt: null })
      .mockResolvedValueOnce({ basis: { ...basis, sourceAuthoritySha256: "f".repeat(64) }, sourceEvidenceId: nodeId, currentRule: null, effectivePrepurchaseCheckedAt: null });
    await expect(server().review(jobId)).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
  });
  it("rejects stale browser basis, missing quotes and unsupported client authority before save", async () => {
    await expect(server().confirm({ ...request(), checkedAt: now.toISOString() })).rejects.toMatchObject({ code: "INVALID" });
    const stale = request(); stale.expectedBasis.sourceAuthoritySha256 = "f".repeat(64);
    await expect(server().confirm(stale)).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
    const invented = request(); invented.fieldEvidence.allowedFormats = "Accepted formats: DOCX and PDF.";
    await expect(server().confirm(invented)).rejects.toThrow("submission_rule_field_evidence_missing"); expect(port.confirm).not.toHaveBeenCalled();
  });
  it("will not confirm a literal contradiction or map unrelated source wording to a rule", async () => {
    const wrong = request(); wrong.choices.resumeRequirement = "OPTIONAL";
    await expect(server().confirm(wrong)).rejects.toThrow("submission_rule_field_evidence_mismatch");
    const unrelated = request(); unrelated.fieldEvidence.coverLetterRequirement = "Resume required.";
    await expect(server().confirm(unrelated)).rejects.toThrow("submission_rule_field_evidence_mismatch"); expect(port.confirm).not.toHaveBeenCalled();
  });
  it("requires complete source lines so a quote cannot discard a negation", () => {
    const req = request();
    expect(() => canonicalRuleCitations(nodeId, "No " + text.slice(text.indexOf("Resume required.")), req.choices, req.fieldEvidence)).toThrow("submission_rule_complete_source_line_required");
  });
  it("does not treat unbound raw question data as authoritative or silently omit it", async () => {
    const badCapture = { ...captured, applicationQuestionObservation: { questions: [] } }, badHash = canonicalSha256(badCapture);
    port.basis.mockResolvedValue({ basis: { ...basis, jobContentSha256: badHash }, sourceEvidenceId: nodeId, currentRule: null, effectivePrepurchaseCheckedAt: null });
    port.source.mockResolvedValue({ ...source(), job: { ...source().job, content_sha256: badHash, captured_listing: badCapture } });
    const result = await server().review(jobId); if (result.status !== "READY") throw new Error();
    expect(result.view.questions.status).toBe("FAILED"); expect(result.view.blockers).toContain("Application-question evidence could not be verified against the authorized capture.");
  });
  it("preserves legacy manual questions but blocks silently moving their evidence to a new rule source", async () => {
    const prompt = "Describe a time you helped a customer.", expandedText = text + "\n" + prompt;
    const expandedCapture = { text: expandedText, parserIssues: [] }, expandedHash = canonicalSha256(expandedCapture), oldNode = id(80);
    const currentRule = { id: id(5), job_snapshot_id: jobId, content_sha256: "f".repeat(64), checked_at: now.toISOString(), human_confirmed_at: now.toISOString(), human_confirmed_by: reviewer,
      is_current: true, superseded_at: null, source_evidence_ids: [oldNode], resume_requirement: "REQUIRED", cover_letter_requirement: "OPTIONAL", allowed_formats: ["PDF"],
      resume_page_limit: null, cover_letter_page_limit: null, resume_filename_instruction: null, cover_letter_filename_instruction: null, reference_filename_instruction: null,
      reference_timing: "LATER_OR_UNKNOWN", reference_count: null, submission_channel: "HTTPS_UPLOAD", portfolio_instruction: null, work_sample_instruction: null,
      application_questions: [{ schemaVersion: "applypack-employer-question-observation-v1", observationId: id(81), status: "OBSERVED", scope: "INSPECTED_PUBLIC_PAGE_ONLY",
        sourceEvidenceNodeId: oldNode, sourceUrl: "https://example.test/job", sourceObservedAt: "2026-10-27T11:00:00Z", sourceSha256: expandedHash,
        questions: [{ id: id(82), prompt, required: null, wordLimit: null, characterLimit: null }] }], parser_version: "previous-reviewed-rule", injection_scan_state: "CLEAR", hard_block_reason: null };
    const oldBasis = { ...basis, jobContentSha256: expandedHash, currentRuleId: currentRule.id, currentRuleRecordSha256: "e".repeat(64) };
    port.basis.mockResolvedValue({ basis: oldBasis, sourceEvidenceId: nodeId, currentRule, effectivePrepurchaseCheckedAt: now.toISOString() });
    port.source.mockResolvedValue({ ...source(), job: { ...source().job, captured_listing: expandedCapture, content_sha256: expandedHash }, nodes: [
      { id: nodeId, job_snapshot_id: jobId, source_excerpt: expandedText, classification_method: "employer-instruction-source-v1" },
      { id: oldNode, job_snapshot_id: jobId, source_excerpt: prompt, classification_method: "old-source-observation" }] });
    const result = await server().review(jobId); if (result.status !== "READY") throw new Error();
    expect(result.view.questions.questions[0].prompt).toBe(prompt);
    expect(result.view.blockers).toContain("Earlier manually captured questions refer to a different source record. Re-observe them through the permitted-source review workflow before confirming new instructions; their source links cannot be replaced here.");
    await expect(server().confirm({ ...request(), expectedBasis: oldBasis })).rejects.toMatchObject({ code: "SOURCE_BLOCKED" }); expect(port.confirm).not.toHaveBeenCalled();
  });
  it("rejects malformed or cross-job returned preparation and receipts", async () => {
    port.prepare.mockResolvedValue({ sourceEvidenceId: nodeId, created: true, basis: { ...basis, jobSnapshotId: id(99) } });
    await expect(server().prepare(jobId)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    port.receipt.mockResolvedValue({ receipt: {}, replayed: true, current: true });
    await expect(server().receipt(jobId, requestId)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

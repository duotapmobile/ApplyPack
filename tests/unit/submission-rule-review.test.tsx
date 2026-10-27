import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmissionRuleReview } from "@/components/admin/submission-rule-review";
import { proposeSubmissionRules, ruleReviewChecklistLabels, type SubmissionRuleConfirmation, type SubmissionRuleReviewView } from "@/lib/documents/submission-rule-proposal";

const id = (n: number) => `a1160000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const jobId = id(1), text = "Resume required.\nCover letter optional.\nAccepted formats: PDF.\nSubmission method: HTTPS upload.";
const makeView = (): SubmissionRuleReviewView => ({ jobSnapshotId: jobId, title: "Support Specialist", company: "Fictional Employer", listingUrl: "https://example.test/job", applicationUrl: "https://example.test/application",
  observedAt: "2026-10-27T12:00:00Z", basis: { contractVersion: "applypack-employer-rule-review-v1", jobSnapshotId: jobId, jobContentSha256: "a".repeat(64), jobRecordSha256: "b".repeat(64),
    sourceAuthoritySha256: "c".repeat(64), sourceEvidenceSha256: "d".repeat(64), currentRuleId: null, currentRuleRecordSha256: null }, sourceText: text,
  ...proposeSubmissionRules({ text, nodes: [{ id: id(2), source_excerpt: text }] }),
  questions: { status: "NOT_INSPECTED", scope: "INSPECTED_PUBLIC_SOURCE_ONLY", questions: [], issues: [] }, previous: null });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open(view = makeView()) {
  fetchMock.mockResolvedValueOnce(response(view)); render(<SubmissionRuleReview jobSnapshotId={jobId} />);
  fireEvent.click(screen.getByRole("button", { name: "Load current employer instructions" }));
  await screen.findByRole("heading", { name: "Support Specialist — Fictional Employer" });
}
function checkAll() { for (const label of Object.values(ruleReviewChecklistLabels)) fireEvent.click(screen.getByLabelText(label)); }
const saved = (request: SubmissionRuleConfirmation, current = true) => ({ requestId: request.requestId, jobSnapshotId: request.jobSnapshotId, expectedBasis: request.expectedBasis,
  choices: request.choices, checklist: request.checklist, ruleId: id(10), checkedAt: "2026-10-27T12:05:00Z", current,
  reviewEvidence: { version: "applypack-employer-rule-citations-v1", sourceEvidenceId: id(2), sourceTextSha256: createHash("sha256").update(text).digest("hex"),
    citations: Object.entries(request.fieldEvidence).filter(([, quote]) => quote !== null).map(([field, quote]) => ({ field, startByte: Buffer.byteLength(text.slice(0, text.indexOf(quote!))),
      endByte: Buffer.byteLength(text.slice(0, text.indexOf(quote!))) + Buffer.byteLength(quote!), quoteSha256: createHash("sha256").update(quote!).digest("hex") })) } });
describe("normal owner employer-instruction review", () => {
  it("keeps unsupported manual quotes editable before a pending save identity is created", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Exact captured wording for resume"), { target: { value: "Cover letter optional." } });
    checkAll(); fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed employer instructions" }));
    await screen.findByText(/Check the exact captured wording for each choice/);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(screen.queryByRole("button", { name: "Check saved confirmation" })).toBeNull();
    expect(screen.getByLabelText("Exact captured wording for resume")).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Exact captured wording for resume"), { target: { value: "Resume required." } });
    checkAll(); fetchMock.mockImplementationOnce(async (_url, options) => response({ saved: saved(JSON.parse(options.body)) }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed employer instructions" }));
    await screen.findByText(/Employer instructions confirmed for a new checkout/);
  });
  it("requires an explicit source-preparation action before a fresh read, without confirmation or automatic mutation", async () => {
    fetchMock.mockResolvedValueOnce(response({ status: "PREPARATION_REQUIRED", jobSnapshotId: jobId, title: "Support Specialist", company: "Fictional Employer" }));
    render(<SubmissionRuleReview jobSnapshotId={jobId} />); fireEvent.click(screen.getByRole("button", { name: "Load current employer instructions" }));
    await screen.findByRole("button", { name: "Prepare captured source for review" }); expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({ prepared: true })); fireEvent.click(screen.getByRole("button", { name: "Prepare captured source for review" }));
    await screen.findByText(/Captured source prepared/);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "PREPARE_SOURCE" });
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(screen.queryByLabelText("Resume")).toBeNull();
    expect(screen.getByRole("button", { name: "Load current employer instructions" })).not.toBeDisabled();
  });
  it("loads read-only and never converts an empty question list into a completed inspection", async () => {
    await open(); expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
    expect(screen.getByText("Not inspected.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })).toBeDisabled();
    expect(screen.queryByText(/No application questions/)).toBeNull();
  });
  it("requires all acknowledgements and submits only reviewed fields, with no client timestamps, identities or question data", async () => {
    await open(); checkAll();
    fetchMock.mockImplementationOnce(async (_url, options) => response({ saved: saved(JSON.parse(options.body)) }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed employer instructions" }));
    await screen.findByText(/Employer instructions confirmed for a new checkout/);
    const request = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(Object.keys(request).sort()).toEqual(["checklist", "choices", "expectedBasis", "fieldEvidence", "jobSnapshotId", "requestId"]);
    expect(request.choices.allowedFormats).toEqual(["PDF"]); expect(request.choices.referenceTiming).toBe("LATER_OR_UNKNOWN");
    expect(JSON.stringify(request)).not.toMatch(/reviewerId|applicationQuestions|checkedAt|sourceEvidenceIds|capability|token/);
  });
  it("does not preselect missing requirements or formats", async () => {
    const view = makeView(), unknown = "Customer service experience required.";
    Object.assign(view, { sourceText: unknown }, proposeSubmissionRules({ text: unknown, nodes: [] }));
    await open(view); checkAll(); expect(screen.getByLabelText("Resume")).toHaveValue(""); expect(screen.getByLabelText("Cover letter")).toHaveValue("");
    expect(screen.getByLabelText("PDF")).not.toBeChecked(); expect(screen.getByLabelText("DOCX")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })).toBeDisabled();
  });
  it("resets acknowledgements and source wording after an owner changes a suggested choice", async () => {
    await open(); checkAll(); fireEvent.change(screen.getByLabelText("Resume"), { target: { value: "OPTIONAL" } });
    for (const label of Object.values(ruleReviewChecklistLabels)) expect(screen.getByLabelText(label)).not.toBeChecked();
    expect(screen.getByLabelText("Exact captured wording for resume")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })).toBeDisabled();
  });
  it("preserves spaces while an owner types instructions and source quotations", async () => {
    await open();
    const instruction = screen.getByLabelText("Work sample instruction"), quotation = screen.getByLabelText("Exact captured wording for work sample instruction");
    fireEvent.change(instruction, { target: { value: "Include " } }); expect(instruction).toHaveValue("Include ");
    fireEvent.change(instruction, { target: { value: "Include one sample." } }); expect(instruction).toHaveValue("Include one sample.");
    fireEvent.change(quotation, { target: { value: "Work sample: " } }); expect(quotation).toHaveValue("Work sample: ");
  });
  it("reconciles a lost response and retries the exact original request only after a missing receipt", async () => {
    await open(); checkAll(); fetchMock.mockRejectedValueOnce(new Error("lost response"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })); await screen.findByText(/save result is unconfirmed/);
    const original = fetchMock.mock.calls[1][1].body;
    expect(screen.getByRole("button", { name: "Load current employer instructions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry the same confirmation" })).toBeDisabled();
    fetchMock.mockResolvedValueOnce(response({ saved: null })); fireEvent.click(screen.getByRole("button", { name: "Check saved confirmation" }));
    await screen.findByText(/No saved confirmation was found/);
    fetchMock.mockImplementationOnce(async (_url, options) => response({ saved: saved(JSON.parse(options.body)) }));
    fireEvent.click(screen.getByRole("button", { name: "Retry the same confirmation" })); await screen.findByText(/Employer instructions confirmed/);
    expect(fetchMock.mock.calls[3][1].body).toBe(original); expect(fetchMock.mock.calls[2][0]).toContain(JSON.parse(original).requestId);
  });
  it("accepts the original saved receipt as historical without claiming current checkout readiness", async () => {
    await open(); checkAll(); fetchMock.mockRejectedValueOnce(new Error("lost response"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })); await screen.findByText(/save result is unconfirmed/);
    const request = JSON.parse(fetchMock.mock.calls[1][1].body); fetchMock.mockResolvedValueOnce(response({ saved: saved(request, false) }));
    fireEvent.click(screen.getByRole("button", { name: "Check saved confirmation" })); await screen.findByText(/original confirmation was saved, but its source or freshness has changed/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("explains a paid rule change while retaining exact request reconciliation and retry", async () => {
    await open(); checkAll(); fetchMock.mockResolvedValueOnce(response({ code: "PAID_RULE_CHANGE_REQUIRED" }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })); await screen.findByText(/A checkout or paid Apply Pack already uses different instructions/);
    const original = fetchMock.mock.calls[1][1].body;
    expect(screen.getByRole("button", { name: "Load current employer instructions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry the same confirmation" })).toBeDisabled();
    fetchMock.mockResolvedValueOnce(response({ saved: null })); fireEvent.click(screen.getByRole("button", { name: "Check saved confirmation" })); await screen.findByText(/No saved confirmation was found/);
    fetchMock.mockResolvedValueOnce(response({ code: "PAID_RULE_CHANGE_REQUIRED" }, 409)); fireEvent.click(screen.getByRole("button", { name: "Retry the same confirmation" }));
    await screen.findByText(/A checkout or paid Apply Pack already uses different instructions/); expect(fetchMock.mock.calls[3][1].body).toBe(original);
    expect(fetchMock.mock.calls[2][0]).toContain(JSON.parse(original).requestId);
  });
  it("rejects a mismatched receipt and keeps the original request locked", async () => {
    await open(); checkAll(); fetchMock.mockImplementationOnce(async (_url, options) => response({ saved: { ...saved(JSON.parse(options.body)), jobSnapshotId: id(30) } }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })); await screen.findByText(/save result is unconfirmed/);
    expect(screen.getByRole("button", { name: "Load current employer instructions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry the same confirmation" })).toBeDisabled();
  });
  it("does not accept a receipt whose durable citation changed under the same request identity", async () => {
    await open(); checkAll(); fetchMock.mockImplementationOnce(async (_url, options) => {
      const receipt = saved(JSON.parse(options.body)); receipt.reviewEvidence.citations[0].quoteSha256 = "f".repeat(64);
      return response({ saved: receipt });
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })); await screen.findByText(/save result is unconfirmed/);
    expect(screen.getByRole("button", { name: "Load current employer instructions" })).toBeDisabled();
  });
  it("clears a stale review only after the server explicitly confirms rejection with no receipt", async () => {
    await open(); checkAll(); fetchMock.mockResolvedValueOnce(response({ code: "REVIEW_CHANGED", saved: null }, 409));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })); await screen.findByText(/job, source or saved instructions changed/);
    expect(screen.queryByLabelText("Resume")).toBeNull(); expect(screen.getByRole("button", { name: "Load current employer instructions" })).not.toBeDisabled();
  });
  it("renders source and question markup as text and makes source blockers non-bypassable", async () => {
    const view = makeView(); view.sourceText += '\n<img src=x onerror="alert(1)">'; view.questions = { ...view.questions, status: "OBSERVED", questions: [{ id: id(5), prompt: "<script>steal()</script>", required: null, wordLimit: null, characterLimit: null }] };
    view.blockers.push("Source safety review is required."); await open(view); checkAll();
    expect(document.querySelector("script")).toBeNull(); expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("<script>steal()</script>")).toBeTruthy(); expect(screen.getByRole("button", { name: "Confirm reviewed employer instructions" })).toBeDisabled();
  });
  it("rejects a different job view or unsafe outbound source URL", async () => {
    const view = makeView(); view.applicationUrl = "https://example.test/?token=private"; fetchMock.mockResolvedValueOnce(response(view));
    render(<SubmissionRuleReview jobSnapshotId={jobId} />); fireEvent.click(screen.getByRole("button", { name: "Load current employer instructions" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/unavailable/)); expect(screen.queryByLabelText("Resume")).toBeNull();
  });
});

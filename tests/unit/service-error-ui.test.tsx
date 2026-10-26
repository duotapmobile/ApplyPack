import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceErrorReportForm } from "@/components/portal/service-error-report";
import { ServiceErrorReview } from "@/components/admin/service-error-review";
import { serviceErrorReportPayload, serviceErrorReviewPayload, serviceErrorSha256 } from "@/lib/materials/service-error-contract";
const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = { artifactId: id(1), fileVersionId: id(2), releaseId: id(3) }, line = id(4), caseId = id(5);
function customer() { return { materialLineId: line, reportDeadline: "2099-10-28T12:00:00Z", reportingTimeZone: "America/New_York", existingReport: null,
  files: [{ ...member, deliveredAt: "2099-10-25T12:00:00Z", checksumSha256: "a".repeat(64), artifactType: "RESUME", safeFilename: "Example_Resume.pdf" }] }; }
function owner() { return { inspection: { report: { caseId, materialLineId: line, members: [member], reportedAt: "2026-10-25T12:00:00Z", reportDeadline: "2026-10-28T12:00:00Z", state: "OPEN", latestDecisionId: null },
  reportBody: { items: [{ ...member, field: "Name", documentText: "Wrong name", expectedFact: "Confirmed name" }] }, decisions: [], decisionBodies: [] }, files: [{ ...member, filename: "Example_Resume.pdf", previewUrl: `/api/admin/material-files/${member.fileVersionId}/render-preview`,
    evidence: { snapshotId: id(7), targetJob: { company: "Example employer", title: "Office assistant" }, contact: { name: "Example Person" }, contactFactId: id(8), facts: [], sourceFacts: [], sourceReviews: [], claims: [{ claimId: id(9), text: "Wrong name" }] } }] }; }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fillCustomer() {
  fireEvent.click(await screen.findByRole("checkbox", { name: "Report an issue in Example_Resume.pdf" }));
  for (const [name, value] of [["Field or section", "Name"], ["What the document says", "Wrong name"], ["What your confirmed information says", "Confirmed name"]]) fireEvent.change(screen.getByRole("textbox", { name: new RegExp(name) }), { target: { value } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed all delivered/ })); fireEvent.click(screen.getByRole("button", { name: "Submit grouped report" }));
}
async function fillOwner() {
  await screen.findByRole("textbox", { name: "Explain the decision" });
  fireEvent.change(screen.getByRole("textbox", { name: "Explain the decision" }), { target: { value: "The original evidence needs further investigation." } });
  screen.getAllByRole("checkbox").filter((box) => box.parentElement?.textContent?.startsWith("I ")).forEach((box) => fireEvent.click(box));
  fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
}
describe("private grouped customer reporting", () => {
  it("requires selected files and explicit group review, then confirms the exact report without storing private browser data", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => { if (init.method !== "POST") return json(customer()); const request = JSON.parse(String(init.body)); return json({ result: { status: "REPORTED", deliveryAuthorized: false,
      receipt: { requestId: request.requestId, materialLineId: line, members: [member], reportSha256: serviceErrorSha256(serviceErrorReportPayload(request)) } } }); });
    vi.stubGlobal("fetch", fetch); render(<ServiceErrorReportForm materialLineId={line} />);
    expect(await screen.findByRole("button", { name: "Submit grouped report" })).toBeDisabled(); await fillCustomer();
    expect(await screen.findByText(/Your grouped report was saved/)).toBeInTheDocument(); expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });
  it("holds an unknown response, rejects a same-ID mismatched hash, and permits only the unchanged retry after verified absence", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST" ? Promise.reject(new Error("lost")) : json(customer())); vi.stubGlobal("fetch", fetch);
    render(<ServiceErrorReportForm materialLineId={line} />); await fillCustomer();
    expect(await screen.findByText(/could not confirm the result/)).toBeInTheDocument(); const original = String(fetch.mock.calls.find(([, init]) => init.method === "POST")![1].body);
    expect(screen.getByRole("button", { name: "Retry the same report" })).toBeDisabled();
    fetch.mockImplementationOnce(async () => json({ receipt: { requestId: JSON.parse(original).requestId, materialLineId: line, members: [member], reportSha256: "b".repeat(64) } }));
    fireEvent.click(screen.getByRole("button", { name: "Check saved report" })); expect(await screen.findByText(/saved status is still unavailable/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Retry the same report" })).toBeDisabled();
    fetch.mockImplementationOnce(async () => json({ receipt: null })); fireEvent.click(screen.getByRole("button", { name: "Check saved report" })); await waitFor(() => expect(screen.getByRole("button", { name: "Retry the same report" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry the same report" })); await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(2));
    expect(String(fetch.mock.calls.filter(([, init]) => init.method === "POST")[1][1].body)).toBe(original);
  });
  it("shows a previously submitted report after reload without a second form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...customer(), existingReport: { requestId: id(10), caseId, materialLineId: line, reportedAt: "2026-10-25T12:00:00Z", state: "OPEN" } })));
    render(<ServiceErrorReportForm materialLineId={line} />); expect(await screen.findByText(/Its status is under review/)).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Submit grouped report" })).not.toBeInTheDocument();
  });
  it("does not display mismatched customer context or silently convert historical support", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...customer(), materialLineId: id(99) }))); render(<ServiceErrorReportForm materialLineId={line} />);
    expect(await screen.findByText(/use its recorded support options/)).toBeInTheDocument(); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
describe("owner service-error decisions", () => {
  it("starts reviews unchecked and records a decision without repair, approval or delivery actions", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => { if (init.method !== "POST") return json(owner()); const request = JSON.parse(String(init.body)); return json({ result: { status: "RECORDED", deliveryAuthorized: false,
      receipt: { ...request, previousDecisionId: request.expectedDecisionId, reviewSha256: serviceErrorSha256(serviceErrorReviewPayload(request)) } } }); });
    vi.stubGlobal("fetch", fetch); render(<ServiceErrorReview caseId={caseId} />); expect(await screen.findByRole("button", { name: "Record decision" })).toBeDisabled(); await fillOwner();
    expect(await screen.findByText(/Decision recorded. No files were generated or sent/)).toBeInTheDocument(); expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });
  it("does not falsely confirm a changed decision during reconciliation", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST" ? Promise.reject(new Error("lost")) : json(owner())); vi.stubGlobal("fetch", fetch);
    render(<ServiceErrorReview caseId={caseId} />); await fillOwner(); expect(await screen.findByText(/result is not confirmed/)).toBeInTheDocument();
    const request = JSON.parse(String(fetch.mock.calls.find(([, init]) => init.method === "POST")![1].body));
    fetch.mockImplementationOnce(async () => json({ ...owner(), inspection: { ...owner().inspection, decisions: [{ ...request, previousDecisionId: null, reviewSha256: "c".repeat(64) }] } }));
    fireEvent.click(screen.getByRole("button", { name: "Check saved decision" })); expect(await screen.findByText(/saved status is still unavailable/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Retry the same decision" })).toBeDisabled();
  });
  it("preserves unfinished accepted files instead of allowing a later decision to discard them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...owner(), inspection: { ...owner().inspection, decisions: [{ classification: "CONFIRMED_SERVICE_ERROR", affected: [member] }] } })));
    render(<ServiceErrorReview caseId={caseId} />); const checkbox = await screen.findByRole("checkbox", { name: "This file already has an unfinished accepted repair" }); expect(checkbox).toBeChecked(); expect(checkbox).toBeDisabled(); expect(screen.getByRole("combobox", { name: "Classification" })).toBeDisabled();
  });
});

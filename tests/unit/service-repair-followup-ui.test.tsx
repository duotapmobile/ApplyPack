import { webcrypto, createHash } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRepairFeedback } from "@/components/portal/service-repair-feedback";
import { ServiceRepairCaseState } from "@/components/admin/service-repair-case-state";
import { repairCaseStateBody, repairFeedbackBody, repairFollowupCanonicalJson } from "@/lib/materials/service-repair-followup";
const id = (n: number) => `a1020000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const file = { caseId: id(1), artifactId: id(2), fileVersionId: id(3), originalFileVersionId: id(4), artifactType: "RESUME", safeFilename: "Example_Resume.pdf",
  checksumSha256: "a".repeat(64), releaseId: id(5), deliveredAt: "2026-10-26T12:00:00Z", accessExpiresAt: "2026-11-25T12:00:00Z" };
const lineId = id(6), fetcher = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const hash = (body: unknown) => createHash("sha256").update(repairFollowupCanonicalJson(body)).digest("hex");
const review = { schemaVersion: "applypack-service-repair-case-review-v1", caseId: file.caseId, customerId: id(7), materialLineId: lineId,
  acceptedScopeSha256: "b".repeat(64), reviewContextSha256: "c".repeat(64), state: "OPEN", canResolve: true,
  members: [{ materialLineId: lineId, sourceSnapshotId: id(8), artifactId: file.artifactId, fileVersionId: file.originalFileVersionId,
    releaseId: id(9), artifactType: "RESUME", completed: true }], feedback: [], events: [] };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetcher); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fillCustomer() {
  await screen.findByLabelText("Resume — Example_Resume.pdf"); fireEvent.click(screen.getByLabelText("Resume — Example_Resume.pdf"));
  fireEvent.change(screen.getByLabelText("Remaining factual issue — Example_Resume.pdf"), { target: { value: "The confirmed name is still misspelled here." } });
  fireEvent.click(screen.getByLabelText(/I checked these repaired files/));
}
async function fillOwner() {
  fireEvent.click(screen.getByRole("button", { name: "Load current case review" })); await screen.findByText("Case status: Open.");
  fireEvent.change(screen.getByLabelText("Reason for this case decision"), { target: { value: "The repaired files match the confirmed inputs." } });
  fireEvent.click(screen.getByLabelText(/I reviewed the actual repaired files/)); fireEvent.click(screen.getByLabelText(/I reviewed the latest customer feedback/));
}
describe("repair follow-up customer and owner forms", () => {
  it("shows only actual repaired files and does not submit without explicit selection/details", async () => {
    fetcher.mockResolvedValue(response({ materialLineId: lineId, files: [file] })); render(<ServiceRepairFeedback materialLineId={lineId} />);
    await screen.findByLabelText("Resume — Example_Resume.pdf"); expect(screen.getByRole("button", { name: "Submit repair feedback" })).toBeDisabled();
    expect(fetcher.mock.calls.every(([, options]) => options.method === undefined)).toBe(true); expect(screen.queryByText(/Cover letter/)).toBeNull();
  });
  it("locks uncertain feedback and reconciles with GET before explicitly retrying the same ID/body", async () => {
    fetcher.mockResolvedValueOnce(response({ materialLineId: lineId, files: [file] })).mockRejectedValueOnce(new Error("lost"))
      .mockResolvedValueOnce(response({ receipt: null })).mockRejectedValueOnce(new Error("lost again"));
    render(<ServiceRepairFeedback materialLineId={lineId} />); await fillCustomer(); fireEvent.click(screen.getByRole("button", { name: "Submit repair feedback" }));
    await screen.findByText(/We could not confirm the result/); expect(screen.getByLabelText("Remaining factual issue — Example_Resume.pdf")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry the same feedback" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check saved feedback" })); await screen.findByText(/No saved feedback with this request ID/);
    expect(fetcher.mock.calls[2][1].method).toBeUndefined(); fireEvent.click(screen.getByRole("button", { name: "Retry the same feedback" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4)); expect(fetcher.mock.calls[3][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it("accepts only an exact content-bound feedback receipt and clears entered private text", async () => {
    fetcher.mockImplementation(async (_path, options) => {
      if (!options.method) return response({ materialLineId: lineId, files: [file] });
      const request = JSON.parse(options.body); return response({ result: { status: "RECORDED", receipt: { requestId: request.requestId, caseId: request.caseId,
        materialLineId: lineId, releaseId: request.releaseId, contentSha256: hash(repairFeedbackBody(request)),
        members: request.items.map(({ artifactId, fileVersionId }: { artifactId: string; fileVersionId: string }) => ({ artifactId, fileVersionId })), createdAt: file.deliveredAt } } });
    });
    render(<ServiceRepairFeedback materialLineId={lineId} />); await fillCustomer(); fireEvent.click(screen.getByRole("button", { name: "Submit repair feedback" }));
    await screen.findByText(/Your feedback was saved to the existing case/); expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("resets previous private form state when the material line changes", async () => {
    fetcher.mockResolvedValue(response({ materialLineId: lineId, files: [file] })); const ui = render(<ServiceRepairFeedback materialLineId={lineId} />); await fillCustomer();
    fetcher.mockResolvedValue(response({ materialLineId: id(99), files: [] })); ui.rerender(<ServiceRepairFeedback materialLineId={id(99)} />);
    await screen.findByText(/No current repaired files/); expect(screen.queryByText("Example_Resume.pdf")).toBeNull(); expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("withholds resolution when the actual accepted union has unfinished work", async () => {
    fetcher.mockResolvedValue(response({ ...review, canResolve: false, members: [{ ...review.members[0], completed: false }] }));
    render(<ServiceRepairCaseState caseId={file.caseId} />); await fillOwner();
    expect(screen.getByRole("button", { name: "Mark reviewed case resolved" })).toBeDisabled(); expect(screen.getByText(/accepted repair unfinished/)).toBeVisible();
  });
  it("requires a fresh explicit review after the atomic close is rejected as stale", async () => {
    fetcher.mockResolvedValueOnce(response(review)).mockResolvedValueOnce(response({ code: "CASE_CHANGED" }, 409)).mockResolvedValueOnce(response({ ...review, reviewContextSha256: "d".repeat(64) }));
    render(<ServiceRepairCaseState caseId={file.caseId} />); await fillOwner(); fireEvent.click(screen.getByRole("button", { name: "Mark reviewed case resolved" }));
    await screen.findByText(/case changed before your decision/); expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load current case review" })); await screen.findByText("Case status: Open.");
    expect(screen.getByLabelText(/I reviewed the actual repaired files/)).not.toBeChecked(); expect(screen.getByLabelText(/I reviewed the latest customer feedback/)).not.toBeChecked();
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });
  it("reconciles owner response loss without re-closing or issuing another mutation", async () => {
    let request: Record<string, unknown>;
    fetcher.mockImplementation(async (path, options) => {
      if (options.method === "POST") { request = JSON.parse(options.body); throw new Error("lost"); }
      if (String(path).includes("?requestId=")) return response({ receipt: { requestId: request.requestId, caseId: file.caseId, materialLineId: lineId,
        action: request.action, acceptedScopeSha256: request.acceptedScopeSha256, contentSha256: hash(repairCaseStateBody(request)), reviewerId: id(10), createdAt: file.deliveredAt } });
      return response(review);
    });
    render(<ServiceRepairCaseState caseId={file.caseId} />); await fillOwner(); fireEvent.click(screen.getByRole("button", { name: "Mark reviewed case resolved" }));
    await screen.findByText(/The result is unconfirmed/); fireEvent.click(screen.getByRole("button", { name: "Check saved case decision" }));
    await screen.findByText(/reviewed case was marked resolved/); expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });
});

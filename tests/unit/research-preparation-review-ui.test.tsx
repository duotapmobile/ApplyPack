import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResearchPreparationReview } from "@/components/admin/research-preparation-review";
import type { PreparationReview } from "@/lib/matching/research-preparation-review";
const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const detail: PreparationReview = { preparationId: id(1), state: "OWNER_REVIEW", reason: "SOURCE_REVIEW_REQUIRED", current: true,
  sources: [{ id: id(2), state: "COMPLETE", observedCount: 1 }], listings: [{ projectionId: id(3), company: "Fictional employer", title: "Office assistant",
    listingUrl: "https://example.invalid/job", applicationUrl: "https://example.invalid/apply", capturedText: "Required: 3 years of office experience.",
    observedAt: "2026-10-26T12:00:00Z", admitted: false, parserReviewRequired: false }] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function load() { fireEvent.click(screen.getByRole("button", { name: /Load prepared/ })); await screen.findByText(/Fictional employer/); }
it("requires real explicit checks and resets confirmation when evidence notes change", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(detail)); vi.stubGlobal("fetch", fetch);
  render(<ResearchPreparationReview snapshotId={id(4)} onChanged={vi.fn()} />); await load();
  const submit = screen.getByRole("button", { name: "Record source verification" });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Verification notes"), { target: { value: "I checked the exact official fictional listing today." } });
  const check = screen.getByRole("checkbox", { name: /I checked the current official page/ }); fireEvent.click(check);
  expect(submit).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Verification notes"), { target: { value: "A different observation requires another explicit review." } });
  expect(check).not.toBeChecked(); expect(submit).toBeDisabled(); expect(fetch).toHaveBeenCalledOnce();
});
it("shows parser incompleteness without exposing a false verification action", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...detail, listings: [{ ...detail.listings[0], parserReviewRequired: true }] })));
  render(<ResearchPreparationReview snapshotId={id(4)} onChanged={vi.fn()} />); await load();
  expect(screen.getByText(/Requirement interpretation needs owner review/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Record source verification" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /I checked the current official page/ })).not.toBeInTheDocument();
});
it("drops uncertain action controls and never automatically retries a lost write", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ...detail, listings: [{ ...detail.listings[0], admitted: true }] })).mockRejectedValueOnce(new Error("connection lost")); vi.stubGlobal("fetch", fetch);
  const changed = vi.fn(); render(<ResearchPreparationReview snapshotId={id(4)} onChanged={changed} />); await load();
  fireEvent.change(screen.getByLabelText("Coverage review notes"), { target: { value: "I reviewed the whole bounded fictional source scope." } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed the complete captured scope/ }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm coverage for feasibility" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("request may have completed"));
  expect(screen.queryByRole("button", { name: "Confirm coverage for feasibility" })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2); expect(changed).not.toHaveBeenCalled();
});

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminOperations } from "@/components/admin/admin-operations";

const matches = Array.from({ length: 10 }, (_, index) => ({
  evaluationId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
  company: `Reviewed employer ${index + 1}`,
  title: `Reviewed role ${index + 1}`,
  officialApplicationUrl: `https://example.com/jobs/${index + 1}`,
}));
const order = {
  id: "22222222-2222-4222-8222-222222222222", delivery_deadline: "2026-10-24T12:00:00Z",
  intake_id: null, source_scan_status: "clean", source_deleted: false, has_cover_letter: false,
  intake_details: {}, suggested_matches: matches,
};
const props = { searchOrders: [order], applyItems: [], conflicts: [], corrections: [], capacityLimits: [] };
const note = "I compared every listing and checked the current application pages.";
const reviewForm = () => screen.getByRole("form", { name: "Review selected jobs for delivery" });
async function affirm(form: HTMLElement) {
  for (const checkbox of within(form).getAllByRole("checkbox")) await userEvent.click(checkbox);
  await userEvent.type(within(form).getByRole("textbox", { name: /Final review note/ }), note);
}

describe("operator exact-ten release review", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("distinguishes guided background from an uploaded file awaiting safety checks", () => {
    render(<AdminOperations {...props} searchOrders={[{ ...order, intake_id: "intake", source_entry_mode: "GUIDED", source_scan_status: "pending" }]} />);
    expect(screen.getByText(/Guided background; no resume uploaded/)).toBeInTheDocument();
    expect(screen.queryByText(/document safety status/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download source resume" })).not.toBeInTheDocument();
  });

  it("withholds source links if original intake provenance could not be loaded", () => {
    render(<AdminOperations {...props} searchOrders={[{ ...order, intake_id: "intake", source_entry_mode: "UNAVAILABLE" }]} />);
    expect(screen.getByText(/Source details could not be verified/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download source resume" })).not.toBeInTheDocument();
  });

  it("starts every human check unapproved and never asks the operator to edit JSON or identifiers", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminOperations {...props} />);
    const form = reviewForm();
    expect(within(form).getAllByRole("listitem")).toHaveLength(10);
    expect(within(form).getAllByRole("checkbox")).toHaveLength(5);
    for (const checkbox of within(form).getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
    expect(within(form).getByRole("button", { name: "Deliver reviewed matches" })).toBeDisabled();
    expect(screen.queryByText(/payload|JSON|persisted evaluation/i)).not.toBeInTheDocument();
    fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits only the displayed server selection after all five checks and a meaningful note", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminOperations {...props} />);
    const form = reviewForm();
    await affirm(form);
    await userEvent.click(within(form).getByRole("button", { name: "Deliver reviewed matches" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/admin/search-orders/${order.id}/deliver`);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      evaluationIds: matches.map((match) => match.evaluationId),
      reviewChecklist: {
        criteriaCompared: true, allListingsRechecked: true, exactlyTenApplicationWorthy: true,
        noPadding: true, humanReleaseApproved: true, reviewerNote: note,
      },
    });
    expect(within(form).getByRole("button", { name: "Saving review…" })).toBeDisabled();
  });

  it("refuses direct submission after an affirmation is removed or the note contains only whitespace", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminOperations {...props} />);
    const form = reviewForm();
    await affirm(form);
    await userEvent.click(within(form).getByRole("checkbox", { name: /I approve this exact set/ }));
    fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(within(form).getByRole("checkbox", { name: /I approve this exact set/ }));
    fireEvent.change(within(form).getByRole("textbox", { name: /Final review note/ }), { target: { value: " ".repeat(30) } });
    fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(form).getByRole("button", { name: "Deliver reviewed matches" })).toBeDisabled();
  });

  it.each([
    ["fewer than ten", matches.slice(0, 9)],
    ["more than ten", [...matches, { ...matches[0], evaluationId: "33333333-3333-4333-8333-333333333333" }]],
    ["duplicate identities", [...matches.slice(0, 9), matches[0]]],
    ["missing identity", [...matches.slice(0, 9), { ...matches[9], evaluationId: "" }]],
  ])("keeps an invalid selection locked: %s", (_reason, selected) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AdminOperations {...props} searchOrders={[{ ...order, suggested_matches: selected }]} />);
    const form = reviewForm();
    expect(within(form).getByRole("status")).toHaveTextContent("Ten current matches must be ready");
    for (const checkbox of within(form).getAllByRole("checkbox")) expect(checkbox).toBeDisabled();
    fireEvent.submit(form);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a fresh human review when the selected evaluation set changes", async () => {
    const { rerender } = render(<AdminOperations {...props} />);
    await affirm(reviewForm());
    const changed = [...matches.slice(0, 9), { ...matches[9], evaluationId: "44444444-4444-4444-8444-444444444444" }];
    rerender(<AdminOperations {...props} searchOrders={[{ ...order, suggested_matches: changed }]} />);
    for (const checkbox of within(reviewForm()).getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
    expect(within(reviewForm()).getByRole("textbox", { name: /Final review note/ })).toHaveValue("");
    expect(within(reviewForm()).getByRole("button", { name: "Deliver reviewed matches" })).toBeDisabled();
  });

  it("keeps each order's approval separate and renders only HTTPS listing links", async () => {
    render(<AdminOperations {...props} searchOrders={[order, { ...order,
      id: "55555555-5555-4555-8555-555555555555",
      suggested_matches: matches.map((match) => ({ ...match, officialApplicationUrl: "javascript:alert(1)" })),
    }]} />);
    const forms = screen.getAllByRole("form", { name: "Review selected jobs for delivery" });
    await affirm(forms[0]);
    expect(within(forms[0]).getByRole("button", { name: "Deliver reviewed matches" })).toBeEnabled();
    expect(within(forms[1]).getByRole("button", { name: "Deliver reviewed matches" })).toBeDisabled();
    expect(within(forms[1]).queryAllByRole("link")).toHaveLength(0);
  });
});

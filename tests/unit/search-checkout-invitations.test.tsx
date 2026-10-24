import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchCheckoutInvitations } from "@/components/admin/search-checkout-invitations";

const candidate = { draftId: "draft", snapshotId: "snapshot", assessmentId: "assessment", email: "customer@example.test",
  direction: "customer support", requirements: "remote · FL", eligibleJobs: 10,
  assessmentExpiresAt: "2026-10-23T14:00:00Z", activeInvitationExpiresAt: null };
const fetchMock = vi.fn();
const rationale = "Reviewed current job evidence and confirmed daily capacity.";
function approve() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByLabelText("Why this search is ready"), { target: { value: rationale } });
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("guided checkout invitations", () => {
  it("requires an explicit review and rationale before issuing the server-bound request", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ url: "https://example.test/get-started#invitationSecret=private", expiresAt: "2026-10-23T12:15:00Z" }) });
    render(<SearchCheckoutInvitations candidates={[candidate]} unavailable={false} />);
    expect(screen.getByRole("button", { name: "Reserve slot and create invitation" })).toBeDisabled();
    approve();
    fireEvent.click(screen.getByRole("button", { name: "Reserve slot and create invitation" }));
    await screen.findByLabelText("Private invitation link");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/admin/search-checkout-invitations");
    expect(JSON.parse(options.body)).toEqual({ draftId: "draft", snapshotId: "snapshot", assessmentId: "assessment", rationale, expiresInMinutes: 15 });
    expect(screen.getByLabelText("Private invitation link")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Reserve slot and create invitation" })).not.toBeInTheDocument();
  });
  it("requires a refresh after a lost response instead of blindly retrying a possible reservation", async () => {
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    render(<SearchCheckoutInvitations candidates={[candidate]} unavailable={false} />);
    approve(); fireEvent.click(screen.getByRole("button", { name: "Reserve slot and create invitation" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("an invitation may already have been reserved"));
    expect(screen.getByRole("button", { name: "Reserve slot and create invitation" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("clears prior review when a refreshed assessment changes", () => {
    const view = render(<SearchCheckoutInvitations candidates={[candidate]} unavailable={false} />);
    approve();
    view.rerender(<SearchCheckoutInvitations candidates={[{ ...candidate, assessmentId: "new-assessment" }]} unavailable={false} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByLabelText("Why this search is ready")).toHaveValue("");
  });
  it("does not offer duplicate invitations or issuance when queue verification fails", () => {
    const view = render(<SearchCheckoutInvitations candidates={[{ ...candidate, activeInvitationExpiresAt: "2026-10-23T12:15:00Z" }]} unavailable={false} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/already active until/)).toBeInTheDocument();
    view.rerender(<SearchCheckoutInvitations candidates={[candidate]} unavailable />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be verified");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/app/get-started/wizard-v3", () => ({ IntakeWizard: ({ expectedDraftId, accessEmail, invitation }: { expectedDraftId: string; accessEmail: string; invitation?: { id: string } | null }) => <div data-testid="private-wizard" data-invitation-id={invitation?.id}>{expectedDraftId}|{accessEmail}</div> }));
vi.mock("@/components/intake/candidate-questions", () => ({ CandidateQuestions: ({ expectedDraftId }: { expectedDraftId: string }) => <div data-testid="private-questions">{expectedDraftId}</div> }));
import { VerifiedIntakeEntry } from "@/components/intake/verified-intake-entry";
const id = (n: number) => `51000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = { rootDraftId: id(1), draftId: id(2), state: "IN_PROGRESS", version: 3, capabilityVersion: 2,
  expiresAt: "2026-11-01T00:00:00Z", createdAt: "2026-10-26T12:00:00Z", updatedAt: "2026-10-26T13:00:00Z",
  accessEmail: "original@example.invalid", verifiedEmail: "current@example.invalid", questionPending: true, reviewRequired: false };
const access = { verifiedEmail: draft.verifiedEmail, browserDraftId: null, current: null, drafts: [draft], claimAvailable: false };
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); window.history.replaceState(null, "", "/get-started"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("verified intake entry", () => {
  it("retains an invitation in memory when the customer explicitly switches from another currently open intake", async () => {
    const invitationId = id(21);
    window.history.replaceState(null, "", `/get-started#invitationId=${invitationId}&invitationSecret=${"i".repeat(43)}`);
    const other = { ...draft, draftId: id(9), rootDraftId: id(8) };
    fetchMock.mockResolvedValueOnce(reply({ ...access, current: other, browserDraftId: other.draftId }))
      .mockResolvedValueOnce(reply({ ...access, current: other, browserDraftId: other.draftId }))
      .mockResolvedValueOnce(reply({ state: "OPENED", draftId: draft.draftId }))
      .mockResolvedValueOnce(reply({ ...access, current: draft, browserDraftId: draft.draftId }));
    render(<VerifiedIntakeEntry />);
    expect(await screen.findByTestId("private-wizard")).toHaveTextContent(other.draftId);
    expect(screen.getByTestId("private-wizard")).toHaveAttribute("data-invitation-id", invitationId);
    // The real wizard consumes the fragment; selecting another intake must not
    // require restoring it to the URL or resending it to the access endpoint.
    window.history.replaceState(null, "", "/get-started");
    fireEvent.click(screen.getByText("Open a different intake"));
    fireEvent.click(screen.getByRole("button", { name: "Choose saved intakes or start a separate one" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open this intake" }));
    expect(await screen.findByTestId("private-wizard")).toHaveTextContent(draft.draftId);
    expect(screen.getByTestId("private-wizard")).toHaveAttribute("data-invitation-id", invitationId);
    expect(window.location.hash).toBe("");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("invitationSecret");
  });
  it("keeps a valid invitation in the signed-out navigation fragment only", async () => {
    const fragment = `#invitationId=${id(21)}&invitationSecret=${"i".repeat(43)}`;
    window.history.replaceState(null, "", `/get-started${fragment}`);
    fetchMock.mockResolvedValue(reply({}, 401)); render(<VerifiedIntakeEntry />);
    expect(await screen.findByRole("link", { name: "Verify my email" })).toHaveAttribute("href", `/sign-in?next=%2Fget-started${fragment}`);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("invitationSecret");
    expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument();
  });
  it("strips mixed invitations and does not treat an invitation as account ownership", async () => {
    window.history.replaceState(null, "", `/get-started#invitationId=${id(21)}&invitationSecret=${"i".repeat(43)}&extra=yes`);
    fetchMock.mockResolvedValueOnce(reply({ ...access, browserDraftId: id(7), claimAvailable: true, drafts: [] })).mockResolvedValueOnce(reply({ error: "This intake could not be opened." }, 409));
    render(<VerifiedIntakeEntry />); fireEvent.click(await screen.findByRole("button", { name: "Link the intake saved in this browser" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("could not be opened"));
    expect(window.location.hash).toBe(""); expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "CLAIM", expectedBrowserDraftId: id(7) });
  });
  it("never mounts private intake or creates a draft before verification", async () => {
    fetchMock.mockResolvedValue(reply({}, 401)); render(<VerifiedIntakeEntry />);
    expect(await screen.findByRole("link", { name: "Verify my email" })).toHaveAttribute("href", "/sign-in?next=%2Fget-started");
    expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(fetchMock.mock.calls[0][0]).toBe("/api/intake/access");
  });
  it("lists owned intakes without selecting the latest and uses the exact explicit selection", async () => {
    fetchMock.mockResolvedValueOnce(reply(access)).mockResolvedValueOnce(reply({ state: "OPENED", draftId: draft.draftId }))
      .mockResolvedValueOnce(reply({ ...access, current: draft, browserDraftId: draft.draftId }));
    render(<VerifiedIntakeEntry />);
    const open = await screen.findByRole("button", { name: "Open this intake" });
    expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(open);
    expect(await screen.findByTestId("private-wizard")).toHaveTextContent(`${draft.draftId}|original@example.invalid`);
    expect(screen.getByTestId("private-questions")).toHaveTextContent(draft.draftId);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "RESUME", rootDraftId: draft.rootDraftId, expectedDraftId: draft.draftId, expectedCapabilityVersion: 2, expectedBrowserDraftId: null, replaceUnlinkedBrowserIntake: false });
  });
  it("honors the portal's explicit selector even when a different intake already has a cookie", async () => {
    window.history.replaceState(null, "", "/get-started?choose=1");
    fetchMock.mockResolvedValue(reply({ ...access, current: draft, browserDraftId: draft.draftId })); render(<VerifiedIntakeEntry />);
    expect(await screen.findByRole("button", { name: "Open this intake" })).toBeVisible();
    expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("does not discard the sole cookie for a browser intake before it is linked", async () => {
    fetchMock.mockResolvedValue(reply({ ...access, browserDraftId: id(7), claimAvailable: true })); render(<VerifiedIntakeEntry />);
    expect(await screen.findByRole("button", { name: "Link the intake saved in this browser" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Start a separate intake" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open this intake" })).toBeDisabled();
    expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument();
  });
  it("requires an explicit acknowledgement before replacing unresolved browser access", async () => {
    fetchMock.mockResolvedValueOnce(reply({ ...access, browserDraftId: id(7), claimAvailable: true })).mockResolvedValueOnce(reply({}, 409));
    render(<VerifiedIntakeEntry />);
    const open = await screen.findByRole("button", { name: "Open this intake" }); expect(open).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /only access to an unlinked intake/ }));
    expect(open).toBeEnabled(); fireEvent.click(open);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ action: "RESUME", expectedBrowserDraftId: id(7), replaceUnlinkedBrowserIntake: true });
    expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument();
  });
  it("does not open another tab's changed selection after an apparently successful response", async () => {
    fetchMock.mockResolvedValueOnce(reply(access)).mockResolvedValueOnce(reply({ state: "OPENED", draftId: draft.draftId }))
      .mockResolvedValueOnce(reply({ ...access, current: { ...draft, draftId: id(8) }, browserDraftId: id(8) }));
    render(<VerifiedIntakeEntry />); fireEvent.click(await screen.findByRole("button", { name: "Open this intake" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("selected intake changed"));
    expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("keeps creation idempotency after a lost response and requires explicit recovery", async () => {
    fetchMock.mockResolvedValueOnce(reply({ ...access, drafts: [] })).mockRejectedValueOnce(new Error("lost"))
      .mockResolvedValueOnce(reply({ state: "RESUME_REQUIRED", rootDraftId: draft.rootDraftId })).mockResolvedValueOnce(reply(access));
    render(<VerifiedIntakeEntry />); fireEvent.click(await screen.findByRole("button", { name: "Start my intake" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("result is uncertain"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Start my intake" }));
    expect(await screen.findByRole("button", { name: "Open this intake" })).toBeVisible();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(JSON.parse(fetchMock.mock.calls[2][1].body).requestId);
    expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("uses a fresh creation request for the next intentionally separate intake", async () => {
    fetchMock.mockResolvedValueOnce(reply({ ...access, drafts: [] }))
      .mockResolvedValueOnce(reply({ state: "OPENED", draftId: draft.draftId }))
      .mockResolvedValueOnce(reply({ ...access, current: draft, browserDraftId: draft.draftId }))
      .mockResolvedValueOnce(reply({ ...access, current: draft, browserDraftId: draft.draftId }))
      .mockResolvedValueOnce(reply({}, 409));
    render(<VerifiedIntakeEntry />); fireEvent.click(await screen.findByRole("button", { name: "Start my intake" }));
    expect(await screen.findByTestId("private-wizard")).toBeVisible();
    fireEvent.click(screen.getByText("Open a different intake"));
    fireEvent.click(screen.getByRole("button", { name: "Choose saved intakes or start a separate one" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start a separate intake" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(JSON.parse(fetchMock.mock.calls[4][1].body).requestId).not.toBe(JSON.parse(fetchMock.mock.calls[1][1].body).requestId);
  });
  it("fails closed on malformed or unbounded owned lists", async () => {
    fetchMock.mockResolvedValue(reply({ ...access, drafts: Array.from({ length: 21 }, () => draft) })); render(<VerifiedIntakeEntry />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("could not be checked"));
    expect(screen.queryByTestId("private-wizard")).not.toBeInTheDocument();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeWizard } from "@/app/get-started/wizard-v3";
import { emptyFourStepDraft } from "@/lib/intake/four-step";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); window.history.replaceState(null, "", "/get-started"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function saved(confirmedIntake: boolean, state = "COMPLETE") {
  const draft = { id: "11000000-0000-4000-8000-000000000001", version: 3, state, currentStep: 3,
    finalizedSnapshotId: "11000000-0000-4000-8000-000000000002", confirmedIntake, legalContentAccepted: true,
    answers: { ...emptyFourStepDraft, fullName: "Fictional Customer", email: "fictional@example.invalid", entryMode: "GUIDED", noPriorEmployment: true,
      clarifications: [{ questionId: "11000000-0000-4000-8000-000000000003", prompt: "Which scheduling tools did you actually use?", answer: "A paper calendar." }] },
    documents: [], facts: [], presentedFactIds: [] };
  fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url.endsWith("/feasibility")
    ? { feasibility: { state: "COMPLETE", outcome: "LIMITED", checkoutEligible: false, primaryReason: "INVENTORY_SHORTAGE" } }
    : url === "/api/intake/anonymous-draft" ? { draft } : {} }));
}
describe("confirmed intake is preserved", () => {
  it("consumes only a valid invitation after opening the selected confirmed intake", async () => {
    const secret = "k".repeat(43);
    window.history.replaceState(null, "", `/get-started#invitationId=51000000-0000-4000-8000-000000000021&invitationSecret=${secret}`);
    saved(true);
    const savedFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url.endsWith("/feasibility")
      ? Promise.resolve({ ok: true, json: async () => ({ feasibility: { state: "COMPLETE", outcome: "LIKELY", checkoutEligible: true, capacityAvailable: true,
        snapshotId: "11000000-0000-4000-8000-000000000002", assessmentId: "11000000-0000-4000-8000-000000000004" } }) })
      : savedFetch(url, init));
    render(<IntakeWizard expectedDraftId="11000000-0000-4000-8000-000000000001" accessEmail="fictional@example.invalid" />);
    expect(await screen.findByRole("button", { name: "Use My $18.99 Checkout Invitation" })).toBeVisible();
    expect(window.location.hash).toBe("");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(secret);
  });
  it("removes a mixed fragment without accepting its invitation", async () => {
    window.history.replaceState(null, "", `/get-started#invitationId=51000000-0000-4000-8000-000000000021&invitationSecret=${"k".repeat(43)}&extra=yes`);
    saved(true); render(<IntakeWizard expectedDraftId="11000000-0000-4000-8000-000000000001" accessEmail="fictional@example.invalid" />);
    await screen.findByText("This is your confirmed information.", { exact: false });
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(screen.queryByRole("button", { name: "Use My $18.99 Checkout Invitation" })).not.toBeInTheDocument();
  });
  it("does not silently create or open a different draft when selected access is missing", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ draft: null }) });
    render(<IntakeWizard expectedDraftId="11000000-0000-4000-8000-000000000001" accessEmail="fictional@example.invalid" />);
    expect(await screen.findByText("Your secure intake could not be opened.")).toBeVisible();
    const privateCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/intake/anonymous-draft");
    expect(privateCalls).toHaveLength(1); expect(privateCalls[0][1].method).toBeUndefined();
    expect((privateCalls[0][1].headers as Headers).get("x-applypack-draft-id")).toBe("11000000-0000-4000-8000-000000000001");
  });
  it("rejects a returned private draft that differs from the explicitly selected intake", async () => {
    saved(true); render(<IntakeWizard expectedDraftId="11000000-0000-4000-8000-000000000009" accessEmail="fictional@example.invalid" />);
    expect(await screen.findByText("The selected intake changed. Open your saved intake again before continuing.")).toBeVisible();
    expect(screen.queryByText("This is your confirmed information.", { exact: false })).not.toBeInTheDocument();
  });
  it("shows all saved facts and answers without reopening original review or settings", async () => {
    saved(true); render(<IntakeWizard expectedDraftId="11000000-0000-4000-8000-000000000001" accessEmail="fictional@example.invalid" />);
    expect(await screen.findByText("This is your confirmed information.", { exact: false })).toBeVisible();
    expect(screen.getByRole("region", { name: "Clarifications" })).toHaveTextContent("A paper calendar.");
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Remote" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/feasibility"))).toBe(true));
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/edit"))).toBe(false);
  });
  it("keeps the earlier contract's edit controls available", async () => {
    saved(false); render(<IntakeWizard expectedDraftId="11000000-0000-4000-8000-000000000001" accessEmail="fictional@example.invalid" />);
    expect(await screen.findByRole("button", { name: "Edit all answers" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Remote" })).toBeEnabled();
  });
  it("lets a separate unconfirmed successor edit the answer in the complete review", async () => {
    saved(false, "IN_PROGRESS"); render(<IntakeWizard expectedDraftId="11000000-0000-4000-8000-000000000001" accessEmail="fictional@example.invalid" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit clarifications" }));
    expect(await screen.findByLabelText("Which scheduling tools did you actually use? required")).toHaveValue("A paper calendar.");
    expect(screen.queryByLabelText(/I reviewed the actual information/)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/edit"))).toBe(false);
  });
});

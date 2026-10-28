import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeWizard } from "@/app/get-started/wizard-v3";
import { emptyFourStepDraft } from "@/lib/intake/four-step";
import { canRecheckInvitedSearch, feasibilityPresentation, type FeasibilityView } from "@/lib/commerce/presentation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const fetchMock = vi.fn();
const id = (n: number) => `11000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const invitation = { id: id(4), secret: "k".repeat(43) };
const view: FeasibilityView = { state: "COMPLETE", outcome: "LIKELY", checkoutEligible: false, capacityAvailable: false,
  snapshotId: id(2), assessmentId: id(3) };
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); window.history.replaceState(null, "", "/get-started"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(feasibility = view) {
  const draft = { id: id(1), version: 3, state: "COMPLETE", currentStep: 3, finalizedSnapshotId: id(2), confirmedIntake: true, legalContentAccepted: true,
    answers: { ...emptyFourStepDraft, fullName: "Fictional Customer", email: "fictional@example.invalid", entryMode: "GUIDED", noPriorEmployment: true }, documents: [], facts: [], presentedFactIds: [] };
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/checkout/search") throw new Error("lost checkout response");
    return { ok: true, json: async () => url.endsWith("/feasibility") ? { feasibility } : url === "/api/intake/anonymous-draft" ? { draft } : {} };
  });
}
describe("invited search checkout revalidation", () => {
  it("permits checking a held invitation without claiming public or unreserved capacity is ready", () => {
    expect(canRecheckInvitedSearch(view, true)).toBe(true);
    expect(feasibilityPresentation(view, true)).toMatchObject({ canCheckout: true });
    expect(feasibilityPresentation(view, true).message).toContain("only if those checks pass");
    expect(feasibilityPresentation(view).canCheckout).toBe(false);
  });
  it.each<Partial<FeasibilityView>>([{ state: "STALE" }, { state: "PENDING" }, { state: "ERROR" }, { outcome: "LIMITED" }, { outcome: "INFEASIBLE" },
    { snapshotId: null }, { assessmentId: null }, { snapshotId: "wrong" }, { assessmentId: "wrong" }])("never permits stale, incomplete or unbound evidence (%#)", patch => {
    expect(canRecheckInvitedSearch({ ...view, ...patch }, true)).toBe(false);
    expect(feasibilityPresentation({ ...view, ...patch }, true).canCheckout).toBe(false);
  });
  it("requires an explicit invitation", () => { expect(canRecheckInvitedSearch({ ...view, checkoutEligible: true, capacityAvailable: true }, false)).toBe(false); });
  it("sends the selected current identities and allows the same safe retry after a lost response", async () => {
    setup(); render(<IntakeWizard expectedDraftId={id(1)} accessEmail="fictional@example.invalid" invitation={invitation} />);
    const button = await screen.findByRole("button", { name: "Use My $18.99 Checkout Invitation" });
    expect(screen.getByText(/exact 24-hour deadline starts only after verified payment/i)).toBeVisible();
    fireEvent.click(button);
    expect(await screen.findByText(/Try this invitation again to check the same payment request/)).toBeVisible();
    expect(button).toBeEnabled(); fireEvent.click(button);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/checkout/search")).toHaveLength(2));
    const calls = fetchMock.mock.calls.filter(([url]) => url === "/api/checkout/search");
    for (const [, init] of calls) {
      expect(init.method).toBe("POST"); expect(init.headers.get("x-applypack-draft-id")).toBe(id(1));
      expect(JSON.parse(init.body)).toEqual({ snapshotId: id(2), assessmentId: id(3), invitationId: invitation.id, invitationSecret: invitation.secret });
    }
    expect(calls[0][1].body).toBe(calls[1][1].body);
  });
  it("keeps a server rejection visible and does not claim checkout or payment started", async () => {
    setup(); const initial = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init: RequestInit) => url === "/api/checkout/search"
      ? Promise.resolve({ ok: false, json: async () => ({ error: "This invitation is expired. No payment was started." }) }) : initial(url, init));
    render(<IntakeWizard expectedDraftId={id(1)} accessEmail="fictional@example.invalid" invitation={invitation} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use My $18.99 Checkout Invitation" }));
    expect(await screen.findByText("This invitation is expired. No payment was started.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Use My $18.99 Checkout Invitation" })).toBeEnabled();
  });
});

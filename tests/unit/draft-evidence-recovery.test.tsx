import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftEvidenceRecoveryControls } from "@/components/admin/draft-evidence-recovery";
import type { DraftEvidenceRecovery } from "@/lib/documents/draft-owner-view";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const id = (n: number) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clock = Date.parse("2026-10-25T12:00:00Z");
function info(overrides: Partial<DraftEvidenceRecovery> = {}): DraftEvidenceRecovery {
  return { jobId: id(1), expectedVersionId: id(2), expectedPacketSha256: "a".repeat(64), basisIdentity: "b".repeat(64), company: "Example employer", title: "Office assistant", applicationUrl: "https://employer.example/apply",
    basis: { lineRevisionId: id(3), sourceSnapshotId: id(4), jobSnapshotId: id(5), jobContentSha256: "c".repeat(64), ruleId: id(6), ruleSha256: "d".repeat(64), ruleRecordSha256: "e".repeat(64), sourceAuthoritySha256: "f".repeat(64) },
    originalCheckedAt: "2026-10-25T10:00:00Z", effectiveCheckedAt: "2026-10-25T10:00:00Z", ruleCurrent: false, currentContextSha256: null, latestReceiptId: null, canRefresh: false,
    questions: { status: "OBSERVED", verification: "BOUND_SOURCE_EVIDENCE", comparisonAvailable: true, items: [{ id: id(70), prompt: "Describe competing priorities.", required: true, wordLimit: null, characterLimit: null }] },
    instructions: { checkedAt: "2026-10-25T10:00:00Z", resumeRequirement: "REQUIRED", letterRequirement: "OPTIONAL", resumeFilename: "Resume.pdf", letterFilename: null, referenceTiming: "LATER_OR_UNKNOWN", referenceCount: null, formats: ["PDF"], resumePageLimit: 1, letterPageLimit: 1 }, ...overrides };
}
const current = () => info({ effectiveCheckedAt: "2026-10-25T11:55:00Z", ruleCurrent: true, currentContextSha256: "1".repeat(64), canRefresh: true });
const view = (value = info(), key = "first") => <DraftEvidenceRecoveryControls key={key} info={value}><p>Exact original saved employer instructions</p></DraftEvidenceRecoveryControls>;
async function mount(element: ReturnType<typeof view>) { const result = render(element); await act(async () => { await Promise.resolve(); }); return { ...result, rerender: async (next: ReturnType<typeof view>) => { result.rerender(next); await act(async () => { await Promise.resolve(); }); } }; }
const check = (name: RegExp) => within(screen.getByRole("group", { name })).getAllByRole("checkbox").forEach((box) => fireEvent.click(box));
function response(body: Record<string, unknown>, currentResult = true) {
  const result = body.action === "REVALIDATE_RULE" ? { recorded: true, deliveryAuthorized: false, current: currentResult, replayed: false,
    receipt: { id: body.receiptId, job_id: id(1), reviewed_version_id: body.expectedVersionId, basis: body.expectedBasis } }
    : { recorded: true, deliveryAuthorized: false, current: currentResult, replayed: false, jobId: id(1), priorVersionId: body.expectedVersionId,
      versionId: id(20), packetSha256: "2".repeat(64), contextSha256: body.expectedContextSha256 };
  return new Response(JSON.stringify(body.action === "LISTING_CHECK" ? { action: body.action, checkId: body.checkId } : { action: body.action, result }), { status: 200 });
}
function success(currentResult = true) {
  const fetch = vi.fn(async (_url: string, request: RequestInit) => response(JSON.parse(String(request.body)), currentResult)); vi.stubGlobal("fetch", fetch); return fetch;
}
describe("explicit stale drafting evidence recovery", () => {
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.spyOn(Date, "now").mockReturnValue(clock); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("requires four fresh decisions and submits exact basis with no customer content or continuation", async () => {
    const fetch = success(); await mount(view()); const group = screen.getByRole("group", { name: /1. Recheck/ }), button = screen.getByRole("button", { name: "Record unchanged instructions review" });
    const boxes = within(group).getAllByRole("checkbox"); expect(boxes).toHaveLength(4); expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect(button).toBeDisabled(); boxes.slice(0, 3).forEach((box) => fireEvent.click(box)); expect(button).toBeDisabled(); fireEvent.click(boxes[3]); fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); const body = JSON.parse(String(fetch.mock.calls[0][1].body));
    expect(body).toEqual({ action: "REVALIDATE_RULE", expectedVersionId: id(2), receiptId: expect.any(String), expectedBasis: info().basis,
      checklist: { applicationAccessReviewed: true, liveListingOpened: true, submissionInstructionsCompared: true, unchangedRuleConfirmed: true } });
    expect(JSON.stringify(body)).not.toContain("Example employer"); expect(await screen.findByText(/Unchanged instructions review recorded/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce(); expect(router.refresh).toHaveBeenCalledOnce();
    const saved = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!); expect(Object.keys(saved).sort()).toEqual(["id", "state"]); expect(saved.state).toBe("COMPLETE");
  });
  it("reconciles the same unknown rule request after reload without asserting a new human review", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("lost")).mockImplementation(async (_url: string, request: RequestInit) => response(JSON.parse(String(request.body)), false)); vi.stubGlobal("fetch", fetch);
    const rendered = await mount(view()); check(/1. Recheck/); fireEvent.click(screen.getByRole("button", { name: "Record unchanged instructions review" }));
    expect(await screen.findByText(/action could not be confirmed/)).toBeInTheDocument(); const first = JSON.parse(fetch.mock.calls[0][1].body);
    await rendered.rerender(view(info(), "reload")); expect(screen.getByRole("button", { name: "Record unchanged instructions review" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reconcile saved rule review" })).toBeEnabled(); fireEvent.click(screen.getByRole("button", { name: "Reconcile saved rule review" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(first);
    expect(await screen.findByText(/Reconciliation did not renew/)).toBeInTheDocument();
  });
  it("requires an explicit new unchecked review after a known completed review", async () => {
    const fetch = success(false), rendered = await mount(view()); check(/1. Recheck/); fireEvent.click(screen.getByRole("button", { name: "Record unchanged instructions review" }));
    await screen.findByText(/Reconciliation did not renew/); const first = JSON.parse(String(fetch.mock.calls[0][1].body));
    await rendered.rerender(view(info(), "reload")); expect(fetch).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "Record unchanged instructions review" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Start a new employer review" })); expect(within(screen.getByRole("group", { name: /1. Recheck/ })).getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect(fetch).toHaveBeenCalledOnce(); check(/1. Recheck/); fireEvent.click(screen.getByRole("button", { name: "Record unchanged instructions review" })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetch.mock.calls[1][1].body)).receiptId).not.toBe(first.receiptId);
  });
  it("retains an unknown request when a rule response names a different basis", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, request: RequestInit) => { const body = JSON.parse(String(request.body)); return response({ ...body, expectedBasis: { ...body.expectedBasis, ruleSha256: "0".repeat(64) } }); }));
    await mount(view()); check(/1. Recheck/); fireEvent.click(screen.getByRole("button", { name: "Record unchanged instructions review" }));
    expect(await screen.findByText(/action could not be confirmed/)).toBeInTheDocument(); expect(router.refresh).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).state).toBe("UNKNOWN");
  });
  it("records a separate listing observation and never treats it as rule renewal", async () => {
    const fetch = success(); await mount(view()); check(/2. Record/); fireEvent.change(screen.getByLabelText("Observed listing result"), { target: { value: "CLOSED" } });
    fireEvent.click(screen.getByRole("button", { name: "Record listing check before drafting" })); await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toMatchObject({ action: "LISTING_CHECK", expectedVersionId: id(2), phase: "BEFORE_GENERATION", result: "CLOSED", evidenceSha256: info().basis.ruleSha256, listingOpened: true, instructionsCompared: true });
    expect(await screen.findByText(/did not renew the saved rule review/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Refresh draft evidence" })).toBeDisabled();
  });
  it("preserves the original listing result and ID when reconciling an uncertain check", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("lost")).mockImplementation(async (_url: string, request: RequestInit) => response(JSON.parse(String(request.body)))); vi.stubGlobal("fetch", fetch);
    const rendered = await mount(view()); check(/2. Record/); fireEvent.change(screen.getByLabelText("Observed listing result"), { target: { value: "INSTRUCTION_BLOCKED" } }); fireEvent.click(screen.getByRole("button", { name: "Record listing check before drafting" }));
    await screen.findByText(/action could not be confirmed/); const first = JSON.parse(fetch.mock.calls[0][1].body); await rendered.rerender(view(info(), "reload"));
    fireEvent.click(screen.getByRole("button", { name: "Reconcile saved listing check" })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(first);
  });
  it("requires full current context and explicit refresh confirmation", async () => {
    const fetch = success(), rendered = await mount(view({ ...current(), currentContextSha256: null, canRefresh: false }));
    expect(screen.getByText(/rule review is current/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Refresh draft evidence" })).toBeDisabled();
    await rendered.rerender(view(current(), "current")); const button = screen.getByRole("button", { name: "Refresh draft evidence" }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /refresh the evidence for this exact/ })); fireEvent.click(button); await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ action: "REFRESH_PACKET", expectedVersionId: id(2), expectedPacketSha256: "a".repeat(64), expectedContextSha256: "1".repeat(64), requestId: expect.any(String) });
    expect(await screen.findByText(/has not been approved or sent/)).toBeInTheDocument();
  });
  it("reconciles an unknown refresh with the same exact version, context and request", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("lost")).mockImplementation(async (_url: string, request: RequestInit) => response(JSON.parse(String(request.body)), false)); vi.stubGlobal("fetch", fetch);
    const rendered = await mount(view(current())); fireEvent.click(screen.getByRole("checkbox", { name: /refresh the evidence for this exact/ })); fireEvent.click(screen.getByRole("button", { name: "Refresh draft evidence" }));
    await screen.findByText(/action could not be confirmed/); const first = JSON.parse(fetch.mock.calls[0][1].body); await rendered.rerender(view({ ...current(), currentContextSha256: null, canRefresh: false }, "reload"));
    fireEvent.click(screen.getByRole("button", { name: "Reconcile saved packet refresh" })); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(first);
    expect(await screen.findByText(/no longer current/)).toBeInTheDocument();
  });
  it("accepts a null version for initial review but never invents an initial refresh", async () => {
    const fetch = success(); await mount(view(info({ expectedVersionId: null, expectedPacketSha256: null }))); expect(screen.queryByRole("button", { name: "Refresh draft evidence" })).not.toBeInTheDocument();
    check(/1. Recheck/); fireEvent.click(screen.getByRole("button", { name: "Record unchanged instructions review" })); await waitFor(() => expect(fetch).toHaveBeenCalledOnce()); expect(JSON.parse(String(fetch.mock.calls[0][1].body)).expectedVersionId).toBeNull();
  });
  it("locks new actions if persisted request identity is malformed", async () => {
    const value = info(); sessionStorage.setItem(`applypack:draft-evidence:rule:v1:${value.jobId}:${value.expectedVersionId}:${value.basisIdentity}`, '{"id":"forged","state":"UNKNOWN"}'); const fetch = success(); await mount(view(value));
    expect(screen.getByRole("alert")).toHaveTextContent("Actions are locked"); expect(screen.getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled)).toBe(true); expect(fetch).not.toHaveBeenCalled();
  });
  it("displays the saved public prompt and holds new attestations when the baseline is unavailable", async () => {
    const fetch = success(), rendered = await mount(view()); expect(screen.getByText("Describe competing priorities.")).toBeInTheDocument();
    expect(screen.getByText(/word limit: not documented/)).toBeInTheDocument();
    await rendered.rerender(view(info({ questions: { status: "PARTIAL", verification: "UNVERIFIED_OR_PARTIAL", comparisonAvailable: false, items: [] } }), "unavailable"));
    expect(screen.getByRole("alert")).toHaveTextContent("baseline is unavailable"); expect(screen.getByRole("button", { name: "Record unchanged instructions review" })).toBeDisabled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("locks fresh refresh when the displayed rule expires on an open page", async () => {
    vi.useFakeTimers(); const now = vi.spyOn(Date, "now"); now.mockReturnValue(clock); await mount(view(current())); fireEvent.click(screen.getByRole("checkbox", { name: /refresh the evidence for this exact/ })); expect(screen.getByRole("button", { name: "Refresh draft evidence" })).toBeEnabled();
    now.mockReturnValue(clock + 3_600_000); await act(() => vi.advanceTimersByTimeAsync(1000)); expect(screen.getByRole("button", { name: "Refresh draft evidence" })).toBeDisabled();
  });
  it("supports keyboard-only review decisions without automatic continuation", async () => {
    const fetch = success(); await mount(view()); const boxes = within(screen.getByRole("group", { name: /1. Recheck/ })).getAllByRole("checkbox");
    boxes[0].focus(); for (let i = 0; i < 4; i++) { await userEvent.keyboard(" "); await userEvent.tab(); }
    expect(screen.getByRole("button", { name: "Record unchanged instructions review" })).toHaveFocus(); await userEvent.keyboard("{Enter}"); await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  });
});

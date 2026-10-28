import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRepairWording } from "@/components/admin/service-repair-wording";
import type { RepairWordingRequest, RepairWordingView } from "@/lib/materials/service-repair-wording";
const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { caseId: id(1), materialLineId: id(2), versionId: id(3) };
function fixture(): RepairWordingView {
  const claims = [{ claimId: id(30), wordingSha256: "c".repeat(64), placement: "coverLetter.header.0", text: "Casey Example", qualification: "EXACT",
    sources: [{ label: "Original confirmed name", value: "Casey Example" }], jobEvidence: [], questions: [] },
  { claimId: id(31), wordingSha256: "d".repeat(64), placement: "coverLetter.body.0.sentences.0", text: "I helped customers with routine questions.", qualification: "QUALIFIED_TRANSFER",
    sources: [{ label: "Confirmed duties", value: "Answered routine customer questions; complex matters went to a supervisor." }],
    jobEvidence: ["Customer support is part of this role."], questions: [{ id: id(8), prompt: "Describe how you helped customers." }] }];
  return { expected: { ...identity, sourceSha256: "a".repeat(64), contextSha256: "b".repeat(64), acceptedScopeSha256: "e".repeat(64),
    members: [{ originalFileVersionId: id(4), renderSourceSha256: "f".repeat(64), claims: claims.map(({ claimId, wordingSha256 }) => ({ claimId, wordingSha256 })) }] },
    reviewed: false, members: [{ originalFileVersionId: id(4), artifactType: "COVER_LETTER", claims }], renderingAuthorized: false, deliveryAuthorized: false };
}
type Action = { operation: "SUBMIT" | "CHECK"; request: RepairWordingRequest };
const result = (request: RepairWordingRequest, status: "RECORDED" | "ABSENT" = "RECORDED") => ({ status, requestId: request.requestId, expected: request.expected,
  reviewSha256: status === "RECORDED" ? "8".repeat(64) : null, renderingAuthorized: false, deliveryAuthorized: false });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const submit = () => screen.getByRole("button", { name: "Record checked repair wording" });
async function checkAll() { await screen.findByRole("checkbox", { name: /affected file 1 · statement 1/ }); for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box); }
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("explicit repair wording review", () => {
  it("shows actual wording, confirmed fields and employer context; requires every unchecked statement", async () => {
    const calls: Action[] = [], onRecorded = vi.fn(), view = fixture();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { if (init.method !== "POST") return json({ view });
      const input: Action = JSON.parse(String(init.body)); calls.push(input); return json({ result: result(input.request) }); }));
    render(<ServiceRepairWording {...identity} onRecorded={onRecorded} />);
    expect(await screen.findByText("I helped customers with routine questions.")).toBeInTheDocument();
    expect(screen.getByText("Answered routine customer questions; complex matters went to a supervisor.")).toBeInTheDocument();
    expect(screen.getByText("Describe how you helped customers.")).toBeInTheDocument();
    expect(screen.getByText(/Keep the stated limits or uncertainty/)).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true); expect(submit()).toBeDisabled();
    fireEvent.click(screen.getAllByRole("checkbox")[0]); expect(submit()).toBeDisabled(); expect(calls).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("checkbox")[1]); fireEvent.click(submit()); await screen.findByText(/Wording review recorded\./);
    expect(calls).toHaveLength(1); expect(calls[0].request.expected).toEqual(view.expected);
    expect(calls[0].request.decisions).toEqual(view.members[0].claims.map(claim => ({ originalFileVersionId: id(4), claimId: claim.claimId, wordingSha256: claim.wordingSha256, decision: "APPROVED" })));
    expect(onRecorded).toHaveBeenCalledOnce(); expect(screen.queryByRole("button", { name: /^(Send|Approve|Render)/ })).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });
  it("freezes unknown results and permits only read-only checks before an explicit identical retry", async () => {
    const calls: Action[] = [], bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { if (init.method !== "POST") return json({ view: fixture() });
      const input: Action = JSON.parse(String(init.body)); calls.push(input); bodies.push(String(init.body));
      if (calls.length === 1) throw new Error("reply lost"); return json({ result: result(input.request, input.operation === "CHECK" ? "ABSENT" : "RECORDED") }); }));
    render(<ServiceRepairWording {...identity} />); await checkAll(); fireEvent.click(submit()); await screen.findByText(/review result is not confirmed/);
    expect(screen.getAllByRole("checkbox").every(box => (box as HTMLInputElement).disabled || box.closest("fieldset")?.disabled)).toBe(true);
    expect(screen.getByRole("button", { name: "Retry identical wording review" })).toBeDisabled(); expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Check wording-review request" })); await screen.findByText(/No review was recorded/);
    expect(calls[1]).toEqual({ operation: "CHECK", request: calls[0].request }); expect(calls).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry identical wording review" })); await screen.findByText(/Wording review recorded\./);
    expect(bodies[2]).toBe(bodies[0]);
  });
  it("reconciles a committed lost response without repeating SUBMIT", async () => {
    const calls: Action[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { if (init.method !== "POST") return json({ view: fixture() });
      const input: Action = JSON.parse(String(init.body)); calls.push(input); if (input.operation === "SUBMIT") throw new Error("lost");
      return json({ result: result(input.request) }); }));
    render(<ServiceRepairWording {...identity} />); await checkAll(); fireEvent.click(submit()); await screen.findByText(/review result is not confirmed/);
    fireEvent.click(screen.getByRole("button", { name: "Check wording-review request" })); await screen.findByText(/Wording review recorded\./);
    expect(calls.map(call => call.operation)).toEqual(["SUBMIT", "CHECK"]);
  });
  it("does not treat malformed, unauthorized, or different-source receipts as an absent review", async () => {
    let count = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { if (init.method !== "POST") return json({ view: fixture() });
      const input: Action = JSON.parse(String(init.body)); count++;
      if (count === 1) return json({ result: { ...result(input.request), deliveryAuthorized: true } });
      if (count === 2) return json({ error: "session expired" }, 403);
      return json({ result: { ...result(input.request, "ABSENT"), expected: { ...input.request.expected, sourceSha256: "0".repeat(64) } } }); }));
    render(<ServiceRepairWording {...identity} />); await checkAll(); fireEvent.click(submit()); await screen.findByText(/review result is not confirmed/);
    for (let index = 0; index < 2; index++) {
      fireEvent.click(screen.getByRole("button", { name: "Check wording-review request" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Check wording-review request" })).toBeEnabled());
      expect(screen.getByRole("button", { name: "Retry identical wording review" })).toBeDisabled();
    }
    expect(count).toBe(3); expect(screen.queryByText(/Wording review recorded\./)).not.toBeInTheDocument();
  });
  it("blocks mismatched or incomplete view identities before showing private claims", async () => {
    const view = fixture(); view.expected.versionId = id(99);
    vi.stubGlobal("fetch", vi.fn(async () => json({ view }))); render(<ServiceRepairWording {...identity} />);
    await screen.findByText(/saved wording could not be loaded/); expect(screen.queryByText("Casey Example")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
  it("shows a proven no-write size rejection without trapping the first review in unknown state", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method !== "POST" ? json({ view: fixture() }) : json({ code: "REVIEW_TOO_LARGE" }, 422));
    vi.stubGlobal("fetch", fetch); render(<ServiceRepairWording {...identity} />); await checkAll(); fireEvent.click(submit());
    await screen.findByText(/This action saved nothing/); expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
    expect(submit()).toBeDisabled(); expect(screen.queryByRole("button", { name: "Check wording-review request" })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not erase a previous uncertain write when a later CHECK returns the size rejection", async () => {
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { if (init.method !== "POST") return json({ view: fixture() });
      writes++; if (writes === 1) throw new Error("lost"); return json({ code: "REVIEW_TOO_LARGE" }, 422); }));
    render(<ServiceRepairWording {...identity} />); await checkAll(); fireEvent.click(submit()); await screen.findByText(/review result is not confirmed/);
    fireEvent.click(screen.getByRole("button", { name: "Check wording-review request" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check wording-review request" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Retry identical wording review" })).toBeDisabled();
    expect(screen.queryByText(/This action saved nothing/)).not.toBeInTheDocument(); expect(writes).toBe(2);
  });
  it("distinguishes two same-type affected files and safely renders untrusted evidence text", async () => {
    const view = fixture(), member = structuredClone(view.members[0]); member.originalFileVersionId = id(9); member.claims[0].sources[0].value = "<img src=x onerror=alert(1)>";
    view.members.push(member); view.expected.members.push({ ...structuredClone(view.expected.members[0]), originalFileVersionId: id(9) });
    vi.stubGlobal("fetch", vi.fn(async () => json({ view }))); const page = render(<ServiceRepairWording {...identity} />);
    expect(await screen.findByRole("checkbox", { name: /Cover letter · affected file 1 · statement 1/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Cover letter · affected file 2 · statement 1/ })).toBeInTheDocument();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument(); expect(page.container.querySelector("img")).toBeNull();
  });
  it("refreshing the source clears all decisions and aborts pending old work", async () => {
    let resolve!: (response: Response) => void; let input!: Action; let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { if (init.method !== "POST") return json({ view: fixture() });
      input = JSON.parse(String(init.body)); signal = init.signal!; return new Promise<Response>(done => { resolve = done; }); }));
    const onRecorded = vi.fn(), page = render(<ServiceRepairWording {...identity} refreshKey={0} onRecorded={onRecorded} />);
    await checkAll(); fireEvent.click(submit()); await waitFor(() => expect(signal).toBeDefined());
    page.rerender(<ServiceRepairWording {...identity} refreshKey={1} onRecorded={onRecorded} />); await screen.findByRole("checkbox", { name: /affected file 1 · statement 1/ });
    expect(signal.aborted).toBe(true); expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
    await act(async () => { resolve(json({ result: result(input.request) })); }); expect(onRecorded).not.toHaveBeenCalled();
    expect(screen.queryByText(/Wording review recorded\./)).not.toBeInTheDocument();
  });
  it("shows already recorded review as read-only and does not auto render or submit", async () => {
    const fetch = vi.fn(async () => json({ view: { ...fixture(), reviewed: true } })); vi.stubGlobal("fetch", fetch);
    render(<ServiceRepairWording {...identity} />); await screen.findByText(/already has a recorded review/);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("keeps a verified review result even if the parent refresh callback fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => init.method !== "POST" ? json({ view: fixture() })
      : json({ result: result((JSON.parse(String(init.body)) as Action).request) })));
    render(<ServiceRepairWording {...identity} onRecorded={() => { throw new Error("refresh failed"); }} />); await checkAll(); fireEvent.click(submit());
    await screen.findByText(/Wording review recorded\./); expect(screen.queryByRole("button", { name: "Check wording-review request" })).not.toBeInTheDocument();
  });
  it("shows a bounded initial read timeout and clears its timer on unmount", async () => {
    vi.useFakeTimers(); let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>(() => undefined); }));
    const page = render(<ServiceRepairWording {...identity} />); await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });
    expect(screen.getByText(/wording review timed out/)).toBeInTheDocument(); expect(signal.aborted).toBe(true);
    page.unmount(); expect(vi.getTimerCount()).toBe(0); expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });
});

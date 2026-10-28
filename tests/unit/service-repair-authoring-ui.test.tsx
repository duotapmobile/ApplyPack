import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRepairAuthoring } from "@/components/admin/service-repair-authoring";
import type { RepairAuthoringRequest } from "@/lib/materials/service-repair-authoring-client";
import { authoringId, repairAuthoringFixture, repairAuthoringReceipt } from "../fixtures/service-repair-authoring";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const props = { caseId: authoringId(1), materialLineId: authoringId(2), versionId: authoringId(3) };
type Action = { action: "SAVE" | "CHECK"; request: RepairAuthoringRequest };
const confirmation = () => screen.getByRole("checkbox", { name: /I reviewed these repair choices/ });
const save = () => screen.getByRole("button", { name: "Save repair source for review" });
async function chooseCorrection() {
  fireEvent.click(await screen.findByRole("radio", { name: "Cover letter: correct affected prose using the original confirmed facts" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Letter paragraph 1 sentence 1 wording" }), { target: { value: "Answered routine customer questions." } });
  fireEvent.click(confirmation());
}
async function chooseRerender() {
  fireEvent.click(await screen.findByRole("radio", { name: "Cover letter: keep the exact original content and rebuild the defective file" }));
  fireEvent.click(confirmation());
}
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("owner accepted-repair content editor", () => {
  it("requires unchecked choices and confirmation, saves only selected prose, and resets confirmation after edits", async () => {
    const view = repairAuthoringFixture(), onSaved = vi.fn(), calls: Action[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view }); const input: Action = JSON.parse(String(init.body)); calls.push(input);
      return json({ receipt: repairAuthoringReceipt(input.request) });
    })); render(<ServiceRepairAuthoring {...props} onSaved={onSaved} />);
    await screen.findByRole("radio", { name: /Cover letter: correct/ });
    expect(screen.getAllByRole("radio").every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(save()).toBeDisabled(); expect(calls).toHaveLength(0); await chooseCorrection();
    fireEvent.change(screen.getByRole("textbox", { name: "Letter paragraph 1 sentence 1 wording" }), { target: { value: "Responded to routine customer questions." } });
    expect(confirmation()).not.toBeChecked(); expect(save()).toBeDisabled(); fireEvent.click(confirmation()); fireEvent.click(save());
    await screen.findByText(/Repair source saved\./); expect(calls).toHaveLength(1); expect(onSaved).toHaveBeenCalledOnce();
    const member = calls[0].request.members[0]; expect(member.repairMode).toBe("SOURCE_CORRECTION");
    if (member.repairMode === "SOURCE_CORRECTION") {
      expect(member.output.resume).toEqual(view.members[0].model!.output.resume);
      expect(member.output.coverLetter.body[0].sentences[0].text).toBe("Responded to routine customer questions.");
    }
    expect(screen.queryByRole("textbox", { name: /contact|phone|employer|date/i })).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
    expect(screen.queryByRole("button", { name: /^(Approve|Send)/ })).not.toBeInTheDocument();
  });
  it("keeps reference details rerender-only and sends no authored output", async () => {
    const view = repairAuthoringFixture(); view.members = [{ ...view.members[0], artifactType: "REFERENCE_SHEET", model: null }];
    let sent: Action | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view }); sent = JSON.parse(String(init.body)); return json({ receipt: repairAuthoringReceipt(sent!.request) });
    })); render(<ServiceRepairAuthoring {...props} />);
    fireEvent.click(await screen.findByRole("radio", { name: /Reference sheet: keep the exact/ }));
    expect(screen.queryByRole("radio", { name: /correct affected/ })).not.toBeInTheDocument(); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(confirmation()); fireEvent.click(save()); await screen.findByText(/Repair source saved\./);
    expect(sent!.request.members).toEqual([{ originalFileVersionId: view.members[0].originalFileVersionId, repairMode: "SOURCE_PRESERVING_RERENDER" }]);
  });
  it("distinguishes affected files of the same type in card, control and claim names", async () => {
    const view = repairAuthoringFixture(); view.members.push({ ...structuredClone(view.members[0]), originalFileVersionId: authoringId(90) });
    vi.stubGlobal("fetch", vi.fn(async () => json({ view }))); render(<ServiceRepairAuthoring {...props} />);
    for (const number of [1, 2]) fireEvent.click(await screen.findByRole("radio", { name: `Cover letter affected file ${number}: correct affected prose using the original confirmed facts` }));
    expect(screen.getByRole("textbox", { name: "Cover letter affected file 1 · Letter paragraph 1 sentence 1 wording" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Cover letter affected file 2 · Letter paragraph 1 sentence 1 wording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cover letter affected file 2 · Add sentence to paragraph 1" })).toBeInTheDocument();
  });
  it("keeps oversized edits editable without sending or entering uncertain reconciliation", async () => {
    const view = repairAuthoringFixture(), model = view.members[0].model!, bullet = model.output.resume.sections[0].bullets[0];
    model.output.resume.sections = Array.from({ length: 10 }, (_, index) => ({ anchorFactId: authoringId(100 + index),
      bullets: Array.from({ length: 10 }, () => ({ ...structuredClone(bullet), text: "é".repeat(1000) })) }));
    model.sections = model.output.resume.sections.map(section => ({ anchorFactId: section.anchorFactId, label: "Original confirmed role" }));
    const fetch = vi.fn(async () => json({ view })); vi.stubGlobal("fetch", fetch); render(<ServiceRepairAuthoring {...props} />);
    await chooseCorrection(); fireEvent.click(save()); await screen.findByText(/request is too long to save or check safely/);
    expect(fetch).toHaveBeenCalledOnce(); expect(confirmation()).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "Letter paragraph 1 sentence 1 wording" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Check saved source request" })).not.toBeInTheDocument();
  });
  it("holds an unknown write, checks only the exact request, then explicitly retries identical bytes", async () => {
    const calls: Action[] = [], bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view: repairAuthoringFixture() });
      const input: Action = JSON.parse(String(init.body)); calls.push(input); bodies.push(String(init.body));
      if (calls.length === 1) throw new Error("lost response");
      return json({ receipt: repairAuthoringReceipt(input.request, input.action === "CHECK" ? "NOT_SAVED" : "WORDING_REVIEW_REQUIRED") });
    })); render(<ServiceRepairAuthoring {...props} />); await chooseCorrection(); fireEvent.click(save());
    await screen.findByText(/save result is not confirmed/); expect(save()).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Letter paragraph 1 sentence 1 wording" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry identical source request" })).toBeDisabled(); expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Check saved source request" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry identical source request" })).toBeEnabled());
    expect(calls[1]).toEqual({ action: "CHECK", request: calls[0].request }); expect(calls).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry identical source request" })); await screen.findByText(/Repair source saved\./);
    expect(bodies[2]).toBe(bodies[0]); expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });
  it("recognizes a committed lost response through CHECK without another save", async () => {
    const calls: Action[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view: repairAuthoringFixture() }); const input: Action = JSON.parse(String(init.body)); calls.push(input);
      if (input.action === "SAVE") throw new Error("lost response"); return json({ receipt: { ...repairAuthoringReceipt(input.request), replayed: true } });
    })); render(<ServiceRepairAuthoring {...props} />); await chooseRerender(); fireEvent.click(save()); await screen.findByText(/save result is not confirmed/);
    fireEvent.click(screen.getByRole("button", { name: "Check saved source request" })); await screen.findByText(/Repair source saved\./);
    expect(calls.map(call => call.action)).toEqual(["SAVE", "CHECK"]); expect(screen.queryByRole("button", { name: "Retry identical source request" })).not.toBeInTheDocument();
  });
  it("allows explicit revision after a first-save422 while keeping the rejected text and requiring new confirmation", async () => {
    const calls: Action[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view: repairAuthoringFixture() }); const input: Action = JSON.parse(String(init.body)); calls.push(input);
      return calls.length === 1 ? json({ code: "WORDING_INVALID" }, 422) : json({ receipt: repairAuthoringReceipt(input.request) });
    })); render(<ServiceRepairAuthoring {...props} />); await chooseCorrection(); fireEvent.click(save());
    fireEvent.click(await screen.findByRole("button", { name: "Revise rejected wording" }));
    const field = screen.getByRole("textbox", { name: "Letter paragraph 1 sentence 1 wording" }); expect(field).toHaveValue("Answered routine customer questions.");
    expect(confirmation()).not.toBeChecked(); expect(save()).toBeDisabled(); expect(calls).toHaveLength(1);
    fireEvent.change(field, { target: { value: "Helped answer routine customer questions." } }); fireEvent.click(confirmation()); fireEvent.click(save());
    await screen.findByText(/Repair source saved\./); expect(calls[1].request.requestId).not.toBe(calls[0].request.requestId);
  });
  it("does not unlock uncertain work when CHECK returns422 or a foreign success", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view: repairAuthoringFixture() }); const input: Action = JSON.parse(String(init.body)); calls++;
      if (calls === 1) throw new Error("lost"); if (calls === 2) return json({ code: "WORDING_INVALID" }, 422);
      return json({ receipt: { ...repairAuthoringReceipt(input.request), contextSha256: "0".repeat(64) } });
    })); render(<ServiceRepairAuthoring {...props} />); await chooseRerender(); fireEvent.click(save()); await screen.findByText(/save result is not confirmed/);
    for (let index = 0; index < 2; index++) {
      fireEvent.click(screen.getByRole("button", { name: "Check saved source request" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Check saved source request" })).toBeEnabled());
      expect(screen.queryByRole("button", { name: "Revise rejected wording" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry identical source request" })).toBeDisabled();
    }
    expect(calls).toBe(3);
  });
  it("requires the stored-source hash to remain fixed across reconciliation", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view: repairAuthoringFixture() }); const input: Action = JSON.parse(String(init.body)); calls++;
      if (calls === 1) throw new Error("lost"); return json({ receipt: { ...repairAuthoringReceipt(input.request, calls === 2 ? "SOURCE_STORED" : "WORDING_REVIEW_REQUIRED"), sourceSha256: (calls === 2 ? "9" : "8").repeat(64) } });
    })); render(<ServiceRepairAuthoring {...props} />); await chooseRerender(); fireEvent.click(save()); await screen.findByText(/save result is not confirmed/);
    fireEvent.click(screen.getByRole("button", { name: "Check saved source request" })); await screen.findByText(/exact private source is stored/);
    fireEvent.click(screen.getByRole("button", { name: "Retry identical source request" })); await screen.findByText(/save result is not confirmed/);
    expect(screen.getByRole("button", { name: "Retry identical source request" })).toBeDisabled();
  });
  it("renders source text as text and prevents missing or limited support from passing local prevalidation", async () => {
    const view = repairAuthoringFixture(); view.members[0].model!.sources[0].value = "<script>alert('fictional')</script>";
    const fetch = vi.fn(async () => json({ view })); vi.stubGlobal("fetch", fetch); const page = render(<ServiceRepairAuthoring {...props} />);
    await chooseCorrection(); expect(page.container.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Customer support duties:/, hidden: true }));
    fireEvent.click(confirmation()); fireEvent.click(save()); await screen.findByText(/Check each repair choice/);
    expect(fetch).toHaveBeenCalledOnce(); expect(confirmation()).not.toBeChecked();
  });
  it("rejects cross-version views and shows a load failure instead of an empty repair", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ view: { ...repairAuthoringFixture(), versionId: authoringId(99) } })));
    render(<ServiceRepairAuthoring {...props} />); await screen.findByText(/original repair evidence could not be loaded/);
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
  });
  it("cancels an old request on identity change, clears confirmations, and ignores its late result", async () => {
    let resolve!: (response: Response) => void; let request!: Action; let signal!: AbortSignal;
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "POST") { request = JSON.parse(String(init.body)); signal = init.signal!; return new Promise<Response>(done => { resolve = done; }); }
      return json({ view: { ...repairAuthoringFixture(), versionId: new URL(url, "http://localhost").searchParams.get("versionId") } });
    }); vi.stubGlobal("fetch", fetch); const onSaved = vi.fn(), page = render(<ServiceRepairAuthoring {...props} onSaved={onSaved} />);
    await chooseCorrection(); fireEvent.click(save()); await waitFor(() => expect(signal).toBeDefined());
    page.rerender(<ServiceRepairAuthoring {...props} versionId={authoringId(99)} onSaved={onSaved} />);
    await screen.findByRole("radio", { name: /Cover letter: correct/ }); expect(signal.aborted).toBe(true); expect(confirmation()).not.toBeChecked();
    await act(async () => { resolve(json({ receipt: repairAuthoringReceipt(request.request) })); }); expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText(/Repair source saved\./)).not.toBeInTheDocument();
  });
  it("does not turn a verified save into uncertainty if a parent refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => init.method !== "POST" ? json({ view: repairAuthoringFixture() })
      : json({ receipt: repairAuthoringReceipt((JSON.parse(String(init.body)) as Action).request) })));
    render(<ServiceRepairAuthoring {...props} onSaved={() => { throw new Error("parent failed"); }} />); await chooseRerender(); fireEvent.click(save());
    await screen.findByText(/Repair source saved\./); expect(screen.queryByRole("button", { name: "Check saved source request" })).not.toBeInTheDocument();
  });
  it("shows an explicit timeout for stalled initial reads and clears timers on unmount", async () => {
    vi.useFakeTimers(); let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>(() => undefined); }));
    const page = render(<ServiceRepairAuthoring {...props} />); await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(screen.getByText(/repair evidence timed out/)).toBeInTheDocument(); expect(signal.aborted).toBe(true);
    page.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not offer a second save when the source is already stored", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ view: { ...repairAuthoringFixture(), sourceSaved: true } })));
    render(<ServiceRepairAuthoring {...props} />); await screen.findByText(/Source content is already saved/);
    expect(screen.queryByRole("button", { name: /Save/ })).not.toBeInTheDocument();
  });
});

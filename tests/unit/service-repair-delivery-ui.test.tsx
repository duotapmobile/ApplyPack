import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRepairDelivery } from "@/components/admin/service-repair-delivery";
import { matchesRepairDeliveryResult, readRepairDeliverySummary, type RepairDeliveryAction } from "@/lib/materials/service-repair-delivery-client";
import { repairDeliveryFixture, repairId } from "../fixtures/service-repair-delivery";
const f = repairDeliveryFixture(), json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const result = (request: RepairDeliveryAction, status: "RECORDED" | "ABSENT" = "RECORDED") => ({ status, action: request.action, expected: request.expected,
  approvalSha256: status === "ABSENT" ? null : request.action === "APPROVE" ? f.approvalSha256 : request.approvalSha256,
  releaseId: status === "RECORDED" && request.action === "SEND" ? request.releaseId : null,
  outboxId: status === "RECORDED" && request.action === "SEND" ? request.outboxId : null });
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = () => render(<ServiceRepairDelivery caseId={f.caseId} materialLineId={f.line} />);
describe("explicit owner repair review and Send", () => {
  it("starts with sevenunchecked checks and approves only after all areconfirmed", async () => {
    let approved = false;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") { const request = JSON.parse(String(init.body)).request; approved = true; return json({ result: result(request) }); }
      return json({ summary: approved ? { ...f.summary, state: "APPROVED", approvalSha256: f.approvalSha256, canSend: true } : f.summary });
    }); vi.stubGlobal("fetch", fetch); mount();
    const button = await screen.findByRole("button", { name: "Approve these repaired files" }), boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(7); expect(boxes.every(box => !(box as HTMLInputElement).checked)).toBe(true); expect(button).toBeDisabled();
    boxes.slice(0, 6).forEach(box => fireEvent.click(box)); expect(button).toBeDisabled(); fireEvent.click(boxes[6]); fireEvent.click(button);
    expect(await screen.findByRole("button", { name: "Send these repaired files" })).toBeInTheDocument();
    const posts = fetch.mock.calls.filter(([, init]) => init.method === "POST"); expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1].body))).toEqual({ operation: "SUBMIT", request: f.approve });
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });
  it("Send is a separate click with fixed release/outbox IDs and noautomaticretry", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST" ? Promise.reject(new Error("lost"))
      : json({ summary: { ...f.summary, state: "APPROVED", approvalSha256: f.approvalSha256, canSend: true } }));
    vi.stubGlobal("fetch", fetch); mount(); const button = await screen.findByRole("button", { name: "Send these repaired files" });
    expect(fetch.mock.calls.every(([, init]) => init.method !== "POST")).toBe(true); fireEvent.click(button);
    await screen.findByText(/result is not confirmed/); const first = JSON.parse(String(fetch.mock.calls.find(([, init]) => init.method === "POST")![1].body));
    expect(first.request.action).toBe("SEND"); expect(first.request.releaseId).not.toBe(first.request.outboxId);
    expect(screen.getByRole("button", { name: "Retry the same action" })).toBeDisabled();
    fetch.mockImplementationOnce(async () => json({ result: result(first.request, "ABSENT") })); fireEvent.click(screen.getByRole("button", { name: "Check saved result" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry the same action" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Retry the same action" }));
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(3));
    const posts = fetch.mock.calls.filter(([, init]) => init.method === "POST");
    expect(JSON.parse(String(posts[1][1].body))).toEqual({ operation: "CHECK", request: first.request });
    expect(posts[2][1].body).toBe(posts[0][1].body);
  });
  it("does not permit stale or anotherreviewer's approval to Send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ summary: { ...f.summary, state: "APPROVED", approvalSha256: f.approvalSha256, canSend: false } }))); mount();
    await screen.findByText(/owner who approved/); expect(screen.queryByRole("button", { name: "Send these repaired files" })).not.toBeInTheDocument();
    cleanup(); vi.stubGlobal("fetch", vi.fn(async () => json({ summary: { ...f.summary, state: "STALE", approvalSha256: f.approvalSha256, canSend: false } }))); mount();
    await screen.findByText(/repair evidence changed/); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("clears every check when explicitly refreshed and aborts oldpage work", async () => {
    const fetch = vi.fn(async () => json({ summary: f.summary })); vi.stubGlobal("fetch", fetch); const view = mount();
    await screen.findByRole("button", { name: "Approve these repaired files" }); screen.getAllByRole("checkbox").forEach(box => fireEvent.click(box));
    view.rerender(<ServiceRepairDelivery caseId={f.caseId} materialLineId={f.line} refreshKey="new-version" />);
    await screen.findByRole("button", { name: "Approve these repaired files" }); expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
  });
  it("refreshes its parent only after an exact saved receipt and preserves that receipt if refresh throws", async () => {
    const onSaved = vi.fn(() => { throw new Error("parent reload failed"); });
    let saved = false;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") { saved = true; return json({ result: result(JSON.parse(String(init.body)).request) }); }
      return saved ? json({}, 503) : json({ summary: f.summary });
    });
    vi.stubGlobal("fetch", fetch); render(<ServiceRepairDelivery caseId={f.caseId} materialLineId={f.line} onSaved={onSaved} />);
    await screen.findByRole("button", { name: "Approve these repaired files" });
    expect(onSaved).not.toHaveBeenCalled();
    screen.getAllByRole("checkbox").forEach(box => fireEvent.click(box)); fireEvent.click(screen.getByRole("button", { name: "Approve these repaired files" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/result is not confirmed/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry the same action" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  });
  it("does not refresh its parent on an uncertain mutation", async () => {
    const onSaved = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => init.method === "POST" ? Promise.reject(new Error("lost")) : json({ summary: f.summary })));
    render(<ServiceRepairDelivery caseId={f.caseId} materialLineId={f.line} onSaved={onSaved} />);
    await screen.findByRole("button", { name: "Approve these repaired files" }); screen.getAllByRole("checkbox").forEach(box => fireEvent.click(box));
    fireEvent.click(screen.getByRole("button", { name: "Approve these repaired files" })); await screen.findByText(/result is not confirmed/);
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("rejects foreign summary and conflicting savedreceipt without enablingretry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ summary: { ...f.summary, caseId: repairId(99) } }))); mount();
    await screen.findByText(/could not be loaded/); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(matchesRepairDeliveryResult({ ...result(f.send), outboxId: repairId(99) }, f.send)).toBe(false);
    expect(matchesRepairDeliveryResult({ ...result(f.send), expected: { ...f.expected, sourceSha256: "9".repeat(64) } }, f.send)).toBe(false);
    expect(matchesRepairDeliveryResult({ ...result(f.approve, "ABSENT"), approvalSha256: f.approvalSha256 }, f.approve)).toBe(false);
    expect(() => readRepairDeliverySummary({ ...f.summary, files: [] }, { caseId: f.caseId, materialLineId: f.line })).toThrow();
  });
});

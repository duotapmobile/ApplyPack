import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRepairWorkspace } from "@/components/admin/service-repair-workspace";
import { matchesServiceRepairReceipt, readServiceRepairSummary } from "@/lib/materials/service-repair-client";
const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const caseId = id(1), line = id(2), title = "Example employer — Office assistant";
const summary = () => ({ caseId, materialLineId: line, acceptedScopeSha256: "a".repeat(64), contextSha256: "b".repeat(64),
  originals: [{ artifactId: id(3), fileVersionId: id(4), artifactType: "COVER_LETTER", deliveredAt: "2026-10-25T12:00:00Z" }], current: null });
const receipt = (request: Record<string, unknown>) => ({ id: id(6), requestId: request.requestId, caseId: request.caseId,
  materialLineId: request.materialLineId, supersedesId: request.expectedVersionId, acceptedScopeSha256: request.acceptedScopeSha256,
  contextSha256: request.contextSha256, version: 1 });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = () => render(<ServiceRepairWorkspace caseId={caseId} materialLineId={line} title={title} />);
describe("accepted repair owner workspace", () => {
  it("shows exactly the accepted artifact and opens once only after the owner action", async () => {
    let saved: ReturnType<typeof receipt> | null = null;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") { saved = receipt(JSON.parse(String(init.body))); return json({ receipt: saved, renderingAuthorized: false, deliveryAuthorized: false }); }
      return json({ summary: { ...summary(), current: saved && { ...saved, sourceSaved: false, invalidatedAt: null, approvedAt: null, releaseId: null } } });
    }); vi.stubGlobal("fetch", fetch); mount();
    expect(await screen.findByText("Cover letter")).toBeInTheDocument(); expect(screen.queryByText("Resume")).not.toBeInTheDocument();
    expect(fetch.mock.calls.every(([, init]) => init.method !== "POST")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open the accepted repair" }));
    expect(await screen.findByText(/This version is waiting for corrected content/)).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Open the accepted repair" })).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });
  it("holds a lost reply and rejects a conflicting saved request, then retries only identical bytes after absence", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST" ? Promise.reject(new Error("lost")) : json({ summary: summary() }));
    vi.stubGlobal("fetch", fetch); mount(); fireEvent.click(await screen.findByRole("button", { name: "Open the accepted repair" }));
    expect(await screen.findByText(/save is not confirmed/)).toBeInTheDocument();
    const body = String(fetch.mock.calls.find(([, init]) => init.method === "POST")![1].body), request = JSON.parse(body);
    expect(screen.getByRole("button", { name: "Retry the same opening" })).toBeDisabled();
    fetch.mockImplementationOnce(async () => json({ receipt: { ...receipt(request), contextSha256: "c".repeat(64) } }));
    fireEvent.click(screen.getByRole("button", { name: "Check saved repair" })); expect(await screen.findByText(/saved status is still unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry the same opening" })).toBeDisabled();
    fetch.mockImplementationOnce(async () => json({ receipt: null })); fireEvent.click(screen.getByRole("button", { name: "Check saved repair" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry the same opening" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry the same opening" }));
    await waitFor(() => expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(2));
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")[1][1].body).toBe(body);
  });
  it("requires a new version when accepted context changed and binds its exact predecessor", async () => {
    const old = { id: id(6), requestId: id(7), caseId, materialLineId: line, supersedesId: null, acceptedScopeSha256: "a".repeat(64), contextSha256: "c".repeat(64), version: 1,
      sourceSaved: true, invalidatedAt: null, approvedAt: null, releaseId: null };
    const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST" ? Promise.reject(new Error("held")) : json({ summary: { ...summary(), current: old } }));
    vi.stubGlobal("fetch", fetch); mount(); fireEvent.click(await screen.findByRole("button", { name: "Open an updated repair version" }));
    await screen.findByText(/save is not confirmed/);
    expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init.method === "POST")![1].body))).toMatchObject({ expectedVersionId: old.id, contextSha256: "b".repeat(64) });
  });
  it("does not expose an opening for malformed or cross-case summaries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ summary: { ...summary(), caseId: id(99) } }))); mount();
    expect(await screen.findByText(/accepted repair could not be loaded/)).toBeInTheDocument(); expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(() => readServiceRepairSummary({ ...summary(), originals: [...summary().originals, ...summary().originals] }, caseId, line)).toThrow();
  });
  it("treats invalid success and missing receipt as unconfirmed, not an absent request", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST"
      ? json({ receipt: receipt(JSON.parse(String(init.body))), renderingAuthorized: true, deliveryAuthorized: false }) : json({ summary: summary() }));
    vi.stubGlobal("fetch", fetch); mount(); fireEvent.click(await screen.findByRole("button", { name: "Open the accepted repair" }));
    await screen.findByText(/save is not confirmed/); fetch.mockImplementationOnce(async () => json({}));
    fireEvent.click(screen.getByRole("button", { name: "Check saved repair" })); await screen.findByText(/saved status is still unavailable/);
    expect(screen.getByRole("button", { name: "Retry the same opening" })).toBeDisabled();
  });
  it("cancels old page work and never stores pending private material", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn((_url: string, init: RequestInit) => init.method === "POST" ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(json({ summary: summary() })));
    vi.stubGlobal("fetch", fetch); const view = mount(); fireEvent.click(await screen.findByRole("button", { name: "Open the accepted repair" }));
    const call = fetch.mock.calls.find(([, init]) => init.method === "POST")![1]; view.unmount(); expect(call.signal?.aborted).toBe(true);
    resolve(json({ receipt: receipt(JSON.parse(String(call.body))), renderingAuthorized: false, deliveryAuthorized: false }));
    await Promise.resolve(); expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(0);
  });
  it("matches the complete opening identity, including the predecessor and accepted context", () => {
    const request = { requestId: id(8), caseId, materialLineId: line, expectedVersionId: id(9), acceptedScopeSha256: "a".repeat(64), contextSha256: "b".repeat(64) };
    expect(matchesServiceRepairReceipt(receipt(request), request)).toBe(true);
    for (const changed of [{ requestId: id(99) }, { caseId: id(99) }, { materialLineId: id(99) }, { supersedesId: null },
      { acceptedScopeSha256: "c".repeat(64) }, { contextSha256: "c".repeat(64) }, { approved: true }]) expect(matchesServiceRepairReceipt({ ...receipt(request), ...changed }, request)).toBe(false);
  });
});

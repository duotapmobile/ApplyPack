import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRepairFiles } from "@/components/admin/service-repair-files";
import type { RepairFileRequest, RepairFileResult, RepairFileView } from "@/lib/materials/service-repair-file-client";
const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { caseId: id(1), materialLineId: id(2), versionId: id(3) };
const expected = { ...identity, sourceSha256: "a".repeat(64), reviewSha256: "b".repeat(64), acceptedScopeSha256: "c".repeat(64), contextSha256: "d".repeat(64),
  members: [{ originalFileVersionId: id(4), artifactType: "COVER_LETTER" as const, originalSourceSha256: "e".repeat(64), packetSha256: "f".repeat(64), renderSourceSha256: "1".repeat(64) }] };
const view = (status: RepairFileView["status"] = "READY"): RepairFileView => ({ ...identity, status, expected: status === "WORDING_REQUIRED" ? null : expected,
  busyUntil: status === "BUSY" ? "2026-10-26T14:00:00Z" : null, memberSetSha256: status === "REVIEW_READY" ? "2".repeat(64) : null, deliveryAuthorized: false });
const result = (request: RepairFileRequest, status: RepairFileResult["status"] = "REVIEW_READY"): RepairFileResult => ({ requestId: request.requestId, expected: request.expected, status,
  memberSetSha256: status === "REVIEW_READY" ? "2".repeat(64) : null, busyUntil: status === "BUSY" ? "2026-10-26T14:00:00Z" : null,
  retryAllowed: ["BUSY", "DISABLED"].includes(status), renderingAuthorized: false, deliveryAuthorized: false });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("owner creates only reviewed repair files", () => {
  it("requires an explicit click, submits once and refreshes only after exact registration without Send", async () => {
    const onRegistered = vi.fn();
    const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method !== "POST" ? json({ view: view() })
      : json({ result: result(JSON.parse(String(init.body)).request) }));
    vi.stubGlobal("fetch", fetch); render(<ServiceRepairFiles {...identity} onRegistered={onRegistered} />);
    const button = await screen.findByRole("button", { name: "Create reviewed repair files" }); expect(fetch).toHaveBeenCalledOnce();
    fireEvent.click(button); fireEvent.click(button); await screen.findByText(/exact repair files were saved/);
    const posts = fetch.mock.calls.filter(([, init]) => init.method === "POST"); expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1].body))).toMatchObject({ operation: "RENDER", request: { expected } });
    expect(onRegistered).toHaveBeenCalledOnce(); expect(screen.queryByRole("button", { name: /^(Approve|Send)/ })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it.each(["WORDING_REQUIRED", "DISABLED", "BUSY", "REVIEW_READY"] as const)("does not render from %s", async status => {
    const fetch = vi.fn(async () => json({ view: view(status) })); vi.stubGlobal("fetch", fetch); render(<ServiceRepairFiles {...identity} />);
    await screen.findByRole("button", { name: "Refresh file preparation status" });
    await waitFor(() => expect(screen.queryByText(/Checking whether/)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Create reviewed repair files" })).not.toBeInTheDocument(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("keeps uncertain and absent results check-only, then reconciles without repeating render", async () => {
    let posts = 0; const bodies: string[] = [], onRegistered = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view: view() });
      bodies.push(String(init.body)); posts++; const request = JSON.parse(String(init.body)).request;
      if (posts === 1) throw new Error("lost"); return json({ result: result(request, posts === 2 ? "ABSENT" : "REVIEW_READY") });
    }));
    render(<ServiceRepairFiles {...identity} onRegistered={onRegistered} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create reviewed repair files" })); await screen.findByText(/file result is not confirmed/);
    expect(screen.getByRole("button", { name: "Retry identical file request" })).toBeDisabled(); expect(onRegistered).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check file preparation request" })); await screen.findByText(/Some files may already be stored/);
    expect(screen.getByRole("button", { name: "Retry identical file request" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check file preparation request" })); await screen.findByText(/exact repair files were saved/);
    expect(bodies.map(body => JSON.parse(body).operation)).toEqual(["RENDER", "CHECK", "CHECK"]);
    expect(new Set(bodies.map(body => JSON.stringify(JSON.parse(body).request))).size).toBe(1); expect(onRegistered).toHaveBeenCalledOnce();
  });
  it.each(["BUSY", "DISABLED"] as const)("allows identical retry only after a proven pre-dispatch %s receipt", async status => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view: view() }); bodies.push(String(init.body));
      return json({ result: result(JSON.parse(String(init.body)).request, bodies.length === 1 ? status : "REVIEW_READY") });
    }));
    render(<ServiceRepairFiles {...identity} />); fireEvent.click(await screen.findByRole("button", { name: "Create reviewed repair files" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry identical file request" })).toBeEnabled()); expect(bodies).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry identical file request" })); await screen.findByText(/exact repair files were saved/);
    expect(bodies).toHaveLength(2); expect(bodies[1]).toBe(bodies[0]);
  });
  it("rejects foreign evidence and forged retry authority", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view: view() });
      return json({ result: { ...result(JSON.parse(String(init.body)).request, "ABSENT"), retryAllowed: true } });
    }));
    render(<ServiceRepairFiles {...identity} />); fireEvent.click(await screen.findByRole("button", { name: "Create reviewed repair files" }));
    await screen.findByText(/file result is not confirmed/); expect(screen.getByRole("button", { name: "Retry identical file request" })).toBeDisabled();
    cleanup(); vi.stubGlobal("fetch", vi.fn(async () => json({ view: { ...view(), versionId: id(99) } })));
    render(<ServiceRepairFiles {...identity} />); await screen.findByText(/status could not be loaded/);
    expect(screen.queryByRole("button", { name: "Create reviewed repair files" })).not.toBeInTheDocument();
  });
  it("aborts a superseded page and ignores its late receipt", async () => {
    let resolve!: (response: Response) => void, signal!: AbortSignal, request!: RepairFileRequest;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method !== "POST") return json({ view: view() }); signal = init.signal!; request = JSON.parse(String(init.body)).request;
      return new Promise<Response>(done => { resolve = done; });
    }));
    const onRegistered = vi.fn(), page = render(<ServiceRepairFiles {...identity} onRegistered={onRegistered} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create reviewed repair files" })); await waitFor(() => expect(signal).toBeDefined());
    page.unmount(); expect(signal.aborted).toBe(true); await act(async () => { resolve(json({ result: result(request) })); }); expect(onRegistered).not.toHaveBeenCalled();
  });
  it("preserves an exact saved receipt when the parent refresh fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => init.method !== "POST" ? json({ view: view() })
      : json({ result: result(JSON.parse(String(init.body)).request) })));
    render(<ServiceRepairFiles {...identity} onRegistered={() => { throw new Error("refresh failed"); }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Create reviewed repair files" })); await screen.findByText(/exact repair files were saved/);
    expect(screen.queryByRole("button", { name: "Check file preparation request" })).not.toBeInTheDocument();
  });
});

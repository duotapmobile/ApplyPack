import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftOwnerRequestChanges } from "@/components/admin/draft-owner-request-changes";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const props = () => ({ jobId: id(1), versionId: id(2), sourceSha256: "a".repeat(64), validUntil: "2099-01-01T00:00:00Z", disabled: false, onLockChange: vi.fn() });
function edit() { fireEvent.click(screen.getByRole("button", { name: "Request changes" })); fireEvent.change(screen.getByRole("textbox", { name: "Requested wording changes" }), { target: { value: "Please make the scheduling example more concise." } }); }
function confirm() { fireEvent.click(screen.getByRole("checkbox")); }
function receipt(value: ReturnType<typeof props>, init: RequestInit, patch = {}) { const request = JSON.parse(String(init.body)); return new Response(JSON.stringify({ action: "REQUEST_DRAFT_CHANGES", result: { jobId: value.jobId,
  requestId: request.requestId, parentVersionId: value.versionId, versionId: id(3), requestSha256: "b".repeat(64), recorded: true, current: true, state: "CHANGES_REQUESTED", deliveryAuthorized: false, ...patch } })); }
beforeEach(() => vi.clearAllMocks()); afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("explicit owner request for a new system draft", () => {
  it("opens by keyboard and requires an unchecked explicit request after every wording change", async () => {
    const value = props(); render(<DraftOwnerRequestChanges {...value} />); const user = userEvent.setup();
    await user.tab(); expect(screen.getByRole("button", { name: "Request changes" })).toHaveFocus(); await user.keyboard("{Enter}");
    expect(value.onLockChange).toHaveBeenCalledWith(true); expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Make the scheduling example more concise." } });
    expect(screen.getByRole("button", { name: "Queue new draft" })).toBeDisabled(); confirm(); expect(screen.getByRole("button", { name: "Queue new draft" })).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Shorten the scheduling example without changing its facts." } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
  it("cancels without sending and clears private instructions before reopening", () => {
    const value = props(), fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<DraftOwnerRequestChanges {...value} />); edit();
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" })); expect(value.onLockChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Request changes" })); expect(screen.getByRole("textbox")).toHaveValue(""); expect(fetch).not.toHaveBeenCalled();
  });
  it("submits exactly once without storing instructions or sending authority fields", async () => {
    const value = props(), fetch = vi.fn(async (_url: string, init: RequestInit) => receipt(value, init)); vi.stubGlobal("fetch", fetch);
    const storage = vi.spyOn(Storage.prototype, "setItem"); render(<DraftOwnerRequestChanges {...value} />); edit(); confirm();
    const button = screen.getByRole("button", { name: "Queue new draft" }); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce()); expect(fetch).toHaveBeenCalledOnce();
    const request = JSON.parse(String(fetch.mock.calls[0][1].body)); expect(Object.keys(request).sort()).toEqual(["action", "expectedSourceSha256", "expectedVersionId", "instructions", "requestId"]);
    expect(request).toMatchObject({ action: "REQUEST_DRAFT_CHANGES", expectedVersionId: value.versionId, expectedSourceSha256: value.sourceSha256 });
    expect(storage).not.toHaveBeenCalled(); expect(screen.getByRole("status")).toHaveTextContent("unapproved draft");
  });
  it.each(["lost response", "wrong identity", "delivery authority"])("holds controls and does not retry after %s", async (mode) => {
    const value = props(), fetch = vi.fn(async (_url: string, init: RequestInit) => { if (mode === "lost response") throw new Error("private detail"); return receipt(value, init, mode === "wrong identity" ? { parentVersionId: id(4) } : { deliveryAuthorized: true }); });
    vi.stubGlobal("fetch", fetch); render(<DraftOwnerRequestChanges {...value} />); edit(); confirm(); fireEvent.click(screen.getByRole("button", { name: "Queue new draft" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("could not be confirmed"));
    expect(screen.getByRole("textbox")).toBeDisabled(); expect(screen.getByRole("button", { name: "Cancel request" })).toBeDisabled(); expect(fetch).toHaveBeenCalledOnce(); expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).not.toHaveTextContent("private detail");
  });
  it("reconciles the identical in-memory request after evidence expiry without reopening inputs", async () => {
    const value = props(), fetch = vi.fn().mockRejectedValueOnce(new Error("lost")).mockImplementation(async (_url: string, init: RequestInit) => receipt(value, init));
    vi.stubGlobal("fetch", fetch); const view = render(<DraftOwnerRequestChanges {...value} />); edit(); confirm(); fireEvent.click(screen.getByRole("button", { name: "Queue new draft" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reconcile change request" })).toBeEnabled());
    view.rerender(<DraftOwnerRequestChanges {...value} validUntil="2000-01-01T00:00:00Z" />);
    fireEvent.click(screen.getByRole("button", { name: "Reconcile change request" })); await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  });
  it("allows a correction only after the exact known pre-write rejection and requires confirmation again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "The document action is incomplete. Review the current version and try again." }), { status: 400 })));
    render(<DraftOwnerRequestChanges {...props()} />); edit(); confirm(); fireEvent.click(screen.getByRole("button", { name: "Queue new draft" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("rejected before saving")); expect(screen.getByRole("textbox")).toBeEnabled(); expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Reconcile change request" })).not.toBeInTheDocument(); expect(router.refresh).not.toHaveBeenCalled();
  });
  it("keeps a completed but superseded request distinct from a current queued draft", async () => {
    const value = props(); vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => receipt(value, init, { current: false })));
    render(<DraftOwnerRequestChanges {...value} />); edit(); confirm(); fireEvent.click(screen.getByRole("button", { name: "Queue new draft" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("no longer current")); expect(screen.getByRole("status")).not.toHaveTextContent("unapproved draft is queued");
  });
  it("does not open or transmit a fresh request after evidence expiry", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<DraftOwnerRequestChanges {...props()} validUntil="2000-01-01T00:00:00Z" />);
    fireEvent.click(screen.getByRole("button", { name: "Request changes" })); expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  });
});

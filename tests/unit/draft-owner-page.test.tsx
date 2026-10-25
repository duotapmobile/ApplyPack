import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const dependencies = vi.hoisted(() => ({ auth: vi.fn(), factory: vi.fn(), list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: dependencies.auth }));
vi.mock("@/lib/documents/draft-owner-view", () => ({ createDraftOwnerView: dependencies.factory }));
vi.mock("@/components/admin/draft-owner-workspace", () => ({ DraftOwnerWorkspace: () => <p>Authorized workspace</p> }));
import Page, { dynamic, metadata } from "@/app/admin/document-drafts/page";
describe("private owner page authorization boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); dependencies.factory.mockReturnValue({ list: dependencies.list, detail: dependencies.detail }); dependencies.list.mockResolvedValue({ status: "AVAILABLE", jobs: [], nextCursor: null }); dependencies.detail.mockResolvedValue(null); });
  afterEach(cleanup);
  it.each([401, 403, 503])("does not create the private reader after authentication failure %s", async (status) => {
    dependencies.auth.mockResolvedValue({ ok: false, response: new Response(null, { status }) }); render(await Page({ searchParams: Promise.resolve({ job: "private-job" }) }));
    expect(screen.getByRole("heading", { name: "Verify administrator access" })).toBeInTheDocument(); expect(dependencies.factory).not.toHaveBeenCalled(); expect(dependencies.detail).not.toHaveBeenCalled();
  });
  it("uses only the authenticated server reviewer and loads only the selected job", async () => {
    const admin = {}; dependencies.auth.mockResolvedValue({ ok: true, admin, user: { id: "trusted-reviewer" } }); render(await Page({ searchParams: Promise.resolve({ job: "selected-job", cursor: "cursor" }) }));
    expect(dependencies.factory).toHaveBeenCalledWith(admin, "trusted-reviewer"); expect(dependencies.list).toHaveBeenCalledWith("cursor", expect.any(AbortSignal)); expect(dependencies.detail).toHaveBeenCalledWith("selected-job", expect.any(AbortSignal));
    expect(dynamic).toBe("force-dynamic"); expect(metadata.robots).toEqual({ index: false, follow: false, noarchive: true });
  });
  it("never decrypts an unselected queue item", async () => {
    dependencies.auth.mockResolvedValue({ ok: true, admin: {}, user: { id: "trusted-reviewer" } }); await Page({ searchParams: Promise.resolve({}) }); expect(dependencies.detail).not.toHaveBeenCalled();
  });
});

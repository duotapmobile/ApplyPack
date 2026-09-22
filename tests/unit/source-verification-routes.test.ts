import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const access = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const origin = vi.hoisted(() => ({ isSameOriginRequest: vi.fn(() => true) }));
vi.mock("@/lib/auth/require-admin", () => access);
vi.mock("@/lib/security/origin", () => origin);
import { POST as manual } from "@/app/api/admin/job-source-manual-observations/route";
import { POST as reconcile } from "@/app/api/admin/job-source-reconciliation/route";
import { POST as verify } from "@/app/api/admin/job-source-verifications/route";

describe("source verification route boundaries", () => {
  beforeEach(() => { vi.clearAllMocks(); origin.isSameOriginRequest.mockReturnValue(true); });
  it.each([reconcile, verify, manual])("rejects cross-origin requests before access or database calls", async (handler) => {
    origin.isSameOriginRequest.mockReturnValue(false);
    expect((await handler(new Request("https://applypack.work/api/test", { method: "POST" }))).status).toBe(403);
    expect(access.requireAdmin).not.toHaveBeenCalled();
  });
  it.each([reconcile, verify, manual])("requires administrator authentication", async (handler) => {
    access.requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
    expect((await handler(new Request("https://applypack.work/api/test", { method: "POST" }))).status).toBe(403);
  });
  it("keeps database reconciliation rejection private", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "private internals" } });
    access.requireAdmin.mockResolvedValue({ ok: true, user: { id: "operator" }, admin: { rpc } });
    const response = await reconcile(new Request("https://applypack.work/api/test", {
      method: "POST", body: JSON.stringify({ runId: "a1000000-0000-4000-8000-000000000001" }),
    }));
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.text()).not.toContain("private internals");
  });
});

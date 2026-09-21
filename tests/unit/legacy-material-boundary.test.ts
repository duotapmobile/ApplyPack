import { describe, expect, it, vi } from "vitest";
const requireAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: () => true }));
import { POST as deliver } from "@/app/api/admin/apply-pack-items/[id]/deliver/route";
import { POST as correct } from "@/app/api/admin/corrections/[id]/resolve/route";

describe("legacy material writes", () => {
  it.each([deliver, correct])("does not release arbitrary uploads even for an authenticated admin", async (handler) => {
    const admin = { from: vi.fn(), storage: { from: vi.fn() }, rpc: vi.fn() };
    requireAdmin.mockResolvedValue({ ok: true, admin, user: { id: "reviewer" } });
    const result = await handler(new Request("https://applypack.work/api/admin", { method: "POST" }));
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "EVIDENCE_BOUND_MATERIAL_LINE_REQUIRED" });
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.storage.from).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});

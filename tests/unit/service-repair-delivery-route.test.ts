// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), factory: vi.fn(), inspect: vi.fn(), act: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/materials/service-repair-delivery-server", async original => {
  const actual = await original<typeof import("@/lib/materials/service-repair-delivery-server")>(); return { ...actual, createServiceRepairDelivery: mocks.factory };
});
import { GET, POST } from "@/app/api/admin/service-errors/[id]/repairs/[materialLineId]/delivery/route";
import { ServiceRepairDeliveryError } from "@/lib/materials/service-repair-delivery-server";
import { repairDeliveryFixture, repairId } from "../fixtures/service-repair-delivery";
const f = repairDeliveryFixture(), url = `https://applypack.work/api/admin/service-errors/${f.caseId}/repairs/${f.line}/delivery`;
const route = () => ({ params: Promise.resolve({ id: f.caseId, materialLineId: f.line }) });
const post = (body: unknown = { operation: "SUBMIT", request: f.approve }) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const privateResponse = (response: Response) => { expect(response.headers.get("Cache-Control")).toBe("no-store, private"); expect(response.headers.get("Referrer-Policy")).toBe("no-referrer"); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.origin.mockReturnValue(true); mocks.auth.mockResolvedValue({ ok: true, user: { id: f.reviewer }, admin: {} });
  mocks.factory.mockReturnValue({ inspect: mocks.inspect, act: mocks.act, preview: mocks.preview }); mocks.inspect.mockResolvedValue(f.summary);
  mocks.act.mockResolvedValue({ status: "RECORDED" }); mocks.preview.mockResolvedValue("https://storage.example.invalid/signed");
});
describe("repair delivery HTTP authorization", () => {
  it("checks origin before mutation auth and freshMFA before private reads or signing", async () => {
    mocks.origin.mockReturnValue(false); const rejected = await POST(post(), route()); expect(rejected.status).toBe(403); privateResponse(rejected); expect(mocks.auth).not.toHaveBeenCalled();
    mocks.origin.mockReturnValue(true); mocks.auth.mockResolvedValue({ ok: false, response: new Response("Fresh MFA required", { status: 403 }) });
    for (const response of [await GET(new Request(url), route()), await POST(post(), route())]) { expect(response.status).toBe(403); privateResponse(response); }
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("rejects foreign path identity, missingchecks and client reviewer authority", async () => {
    for (const request of [{ ...f.approve, expected: { ...f.expected, caseId: repairId(90) } }, { ...f.approve, checklist: {} }, { ...f.approve, reviewerId: repairId(91) }]) {
      expect((await POST(post({ operation: "SUBMIT", request }), route())).status).toBe(400);
    }
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("passes only trustedreviewer and explicit read-onlyCHECK to the adapter", async () => {
    expect((await POST(post({ operation: "CHECK", request: f.send }), route())).status).toBe(200);
    expect(mocks.factory).toHaveBeenCalledWith({}, f.reviewer); expect(mocks.act).toHaveBeenCalledExactlyOnceWith(f.send, true, expect.any(AbortSignal));
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("returns private finite summary and routes exactpreview IDs through auth", async () => {
    const read = await GET(new Request(url), route()); privateResponse(read); expect(await read.json()).toEqual({ summary: f.summary });
    const preview = await GET(new Request(`${url}?versionId=${f.version.id}&previewFileId=${f.file.id}`), route());
    expect(preview.status).toBe(303); privateResponse(preview); expect(preview.headers.get("Location")).toBe("https://storage.example.invalid/signed");
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith({ caseId: f.caseId, materialLineId: f.line, versionId: f.version.id, fileVersionId: f.file.id }, expect.any(AbortSignal));
  });
  it("rejects duplicate or unsupported preview selectors withoutsigning", async () => {
    for (const query of [`versionId=${f.version.id}&previewFileId=${f.file.id}&previewFileId=${f.file.id}`, `versionId=${f.version.id}`, "path=private", "previewFileId=bad&versionId=bad"]) {
      expect((await GET(new Request(`${url}?${query}`), route())).status).toBe(400);
    }
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("redacts failures and distinguishes a changed expectedbinding", async () => {
    mocks.act.mockRejectedValue(new Error("secret provider body")); const unknown = await POST(post(), route());
    expect(unknown.status).toBe(503); expect(await unknown.text()).not.toContain("secret"); privateResponse(unknown);
    mocks.act.mockRejectedValue(new ServiceRepairDeliveryError("CHANGED")); const changed = await POST(post(), route()); expect(changed.status).toBe(409); privateResponse(changed);
  });
});

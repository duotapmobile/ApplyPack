// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), factory: vi.fn(), read: vi.fn(), save: vi.fn(), check: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/documents/service-repair-authoring-server", async original => ({ ...await original<object>(), createServiceRepairAuthoringServer: mocks.factory }));
import { GET, POST } from "@/app/api/admin/service-errors/[id]/repairs/[materialLineId]/source/route";
import { ServiceRepairAuthoringServerError } from "@/lib/documents/service-repair-authoring-server";
const id = (n: number) => `9d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { caseId: id(1), materialLineId: id(2), versionId: id(3) };
const request = { ...identity, requestId: id(4), acceptedScopeSha256: "a".repeat(64), contextSha256: "b".repeat(64),
  members: [{ originalFileVersionId: id(5), repairMode: "SOURCE_PRESERVING_RERENDER" }] };
const route = { params: Promise.resolve({ id: identity.caseId, materialLineId: identity.materialLineId }) };
const url = `https://applypack.work/api/admin/service-errors/${identity.caseId}/repairs/${identity.materialLineId}/source`;
const read = (query = `?versionId=${identity.versionId}`) => GET(new Request(url + query), route);
const post = (input: unknown = { action: "SAVE", request }) => POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }), route);
const privateResponse = (response: Response) => { expect(response.headers.get("Cache-Control")).toBe("no-store, private"); expect(response.headers.get("Referrer-Policy")).toBe("no-referrer"); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ ok: true, user: { id: id(6) }, admin: { fictional: true } }); mocks.origin.mockReturnValue(true);
  mocks.factory.mockReturnValue({ read: mocks.read, save: mocks.save, check: mocks.check });
  mocks.read.mockResolvedValue({ ...identity, sourceSaved: false, members: [] });
  mocks.save.mockResolvedValue({ ...identity, requestId: request.requestId, state: "WORDING_REVIEW_REQUIRED", renderingAuthorized: false, deliveryAuthorized: false });
  mocks.check.mockResolvedValue({ ...identity, requestId: request.requestId, state: "NOT_SAVED", retryAllowed: true });
});
describe("fresh-MFA repair source routes", () => {
  it("checks origin before POST auth and private staff authorization before reading or constructing adapters", async () => {
    mocks.origin.mockReturnValue(false); const denied = await post(); expect(denied.status).toBe(403); privateResponse(denied); expect(mocks.auth).not.toHaveBeenCalled();
    mocks.origin.mockReturnValue(true); mocks.auth.mockImplementation(async () => ({ ok: false, response: new Response("Fresh MFA required", { status: 403 }) }));
    for (const response of [await read(), await post()]) { expect(response.status).toBe(403); privateResponse(response); }
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("reads the exact current version and passes cancellation while keeping response private", async () => {
    const response = await read(); expect(response.status).toBe(200); privateResponse(response);
    expect(mocks.factory).toHaveBeenCalledExactlyOnceWith({ fictional: true }, id(6));
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(identity, expect.any(AbortSignal)); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["", "?versionId=bad", `?versionId=${id(3)}&versionId=${id(4)}`, `?versionId=${id(3)}&owner=${id(6)}`])("rejects ambiguous read identity %s", async query => {
    expect((await read(query)).status).toBe(404); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it.each(["SAVE", "CHECK"])("dispatches explicit %s to only its matching adapter operation", async action => {
    const response = await post({ action, request }); expect(response.status).toBe(200); privateResponse(response);
    expect(action === "SAVE" ? mocks.save : mocks.check).toHaveBeenCalledExactlyOnceWith(request, expect.any(AbortSignal));
    expect(action === "SAVE" ? mocks.check : mocks.save).not.toHaveBeenCalled();
  });
  it.each([
    { action: "SAVE", request: { ...request, caseId: id(50) } }, { action: "CHECK", request: { ...request, materialLineId: id(50) } },
    { action: "SAVE", request: { ...request, approved: true } }, { action: "SAVE", request: { ...request, leaseToken: id(50) } },
    { action: "SEND", request }, { action: "SAVE", request, reviewerId: id(6) },
  ])("rejects path mismatch and extra authority before I/O %#", async input => {
    expect((await post(input)).status).toBe(400); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("bounds streamed input before the source adapter", async () => {
    expect((await post({ action: "SAVE", request, extra: "x".repeat(100_000) })).status).toBe(400); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("exposes only a fixed pre-write wording error and sanitizes all transport errors", async () => {
    mocks.save.mockRejectedValue(new ServiceRepairAuthoringServerError("WORDING_INVALID")); const rejected = await post();
    expect(rejected.status).toBe(422); expect(await rejected.json()).toMatchObject({ code: "WORDING_INVALID" }); privateResponse(rejected);
    mocks.save.mockRejectedValue(new Error("private source payload")); const failed = await post(); expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private source payload"); privateResponse(failed);
  });
});

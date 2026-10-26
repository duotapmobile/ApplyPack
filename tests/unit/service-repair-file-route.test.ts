// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), factory: vi.fn(), inspect: vi.fn(), render: vi.fn(), check: vi.fn(), uploadClient: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.uploadClient }));
vi.mock("@/lib/documents/service-repair-file-server", () => ({ createServiceRepairFiles: mocks.factory }));
import { GET, POST } from "@/app/api/admin/service-errors/[id]/repairs/[materialLineId]/render/route";
const id = (n: number) => `5c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const expected = { caseId: id(1), materialLineId: id(2), versionId: id(3), sourceSha256: "a".repeat(64), reviewSha256: "b".repeat(64),
  acceptedScopeSha256: "c".repeat(64), contextSha256: "d".repeat(64), members: [{ originalFileVersionId: id(4), artifactType: "COVER_LETTER",
    originalSourceSha256: "e".repeat(64), packetSha256: "f".repeat(64), renderSourceSha256: "0".repeat(64) }] };
const request = { requestId: id(5), expected }, route = { params: Promise.resolve({ id: expected.caseId, materialLineId: expected.materialLineId }) };
const url = `https://applypack.work/api/admin/service-errors/${expected.caseId}/repairs/${expected.materialLineId}/render`;
const get = (query = `?versionId=${expected.versionId}`) => GET(new Request(url + query), route);
const post = (body: unknown = { operation: "RENDER", request }) => POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), route);
function privateResponse(response: Response) { expect(response.headers.get("Cache-Control")).toBe("no-store, private"); expect(response.headers.get("Referrer-Policy")).toBe("no-referrer"); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ ok: true, user: { id: id(6) }, admin: { fictional: true } }); mocks.origin.mockReturnValue(true);
  mocks.factory.mockReturnValue({ inspect: mocks.inspect, render: mocks.render, check: mocks.check });
  mocks.inspect.mockResolvedValue({ status: "READY" }); mocks.render.mockResolvedValue({ status: "REVIEW_READY", deliveryAuthorized: false }); mocks.check.mockResolvedValue({ status: "ABSENT", retryAllowed: false });
});
describe("fresh-MFA repair rendering routes", () => {
  it("rejects foreign origin before auth and keeps all errors private", async () => {
    mocks.origin.mockReturnValue(false); const response = await post(); expect(response.status).toBe(403); privateResponse(response);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it.each([401, 403])("requires private administrator MFA before read or render (%s)", async status => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response("Denied", { status }) });
    for (const response of [await get(), await post()]) { expect(response.status).toBe(status); privateResponse(response); }
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("reads only exact version metadata and lazily creates abort-bound storage clients", async () => {
    const response = await get(); expect(response.status).toBe(200); privateResponse(response);
    expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith({ caseId: expected.caseId, materialLineId: expected.materialLineId, versionId: expected.versionId }, expect.any(AbortSignal));
    expect(mocks.render).not.toHaveBeenCalled(); expect(mocks.uploadClient).not.toHaveBeenCalled();
    const options = mocks.factory.mock.calls[0][2] as { uploadClientFactory(signal: AbortSignal): unknown }, signal = new AbortController().signal;
    options.uploadClientFactory(signal); expect(mocks.uploadClient).toHaveBeenCalledExactlyOnceWith({ signal });
  });
  it.each(["", "?versionId=bad", `?versionId=${id(3)}&versionId=${id(4)}`, `?versionId=${id(3)}&owner=${id(6)}`])("rejects ambiguous GET identity %s", async query => {
    expect((await get(query)).status).toBe(404); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it.each(["RENDER", "CHECK"])("performs only explicit %s and passes caller cancellation", async operation => {
    const response = await post({ operation, request }); expect(response.status).toBe(200); privateResponse(response);
    expect(operation === "RENDER" ? mocks.render : mocks.check).toHaveBeenCalledExactlyOnceWith(request, expect.any(AbortSignal));
    expect(operation === "RENDER" ? mocks.check : mocks.render).not.toHaveBeenCalled();
  });
  it.each([
    { operation: "RENDER", request: { ...request, expected: { ...expected, caseId: id(99) } } },
    { operation: "CHECK", request: { ...request, expected: { ...expected, materialLineId: id(99) } } },
    { operation: "RENDER", request: { ...request, leaseToken: id(99) } }, { operation: "RENDER", request, reviewerId: id(99) },
    { operation: "SEND", request }, { operation: "APPROVE", request },
  ])("rejects changed scope or injected authority %#", async input => {
    expect((await post(input)).status).toBe(400); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("bounds the request and redacts adapter failures", async () => {
    expect((await post({ operation: "RENDER", request, extra: "x".repeat(100_000) })).status).toBe(400); expect(mocks.factory).not.toHaveBeenCalled();
    mocks.render.mockRejectedValue(new Error("private file and customer text")); const response = await post();
    expect(response.status).toBe(503); privateResponse(response); expect(await response.text()).not.toContain("private file and customer text");
  });
});

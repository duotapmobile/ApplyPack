// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), factory: vi.fn(), read: vi.fn(), act: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/documents/service-repair-wording-server", async original => {
  const actual = await original<typeof import("@/lib/documents/service-repair-wording-server")>(); return { ...actual, createServiceRepairWordingServer: mocks.factory };
});
import { GET, POST } from "@/app/api/admin/service-errors/[id]/repairs/[materialLineId]/wording/route";
import { ServiceRepairWordingError } from "@/lib/documents/service-repair-wording-server";
const id = (n: number) => `7b000000-0000-4000-8000-${String(n).padStart(12, "0")}`, sha = "a".repeat(64);
const identity = { caseId: id(1), materialLineId: id(2), versionId: id(3) }, claim = { claimId: id(7), wordingSha256: sha };
const request = { requestId: id(4), expected: { ...identity, sourceSha256: sha, contextSha256: sha, acceptedScopeSha256: sha,
  members: [{ originalFileVersionId: id(5), renderSourceSha256: sha, claims: [claim] }] },
decisions: [{ originalFileVersionId: id(5), ...claim, decision: "APPROVED" }] };
const url = `https://applypack.work/api/admin/service-errors/${identity.caseId}/repairs/${identity.materialLineId}/wording`;
const route = () => ({ params: Promise.resolve({ id: identity.caseId, materialLineId: identity.materialLineId }) });
const post = (body: unknown = { operation: "SUBMIT", request }) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const privateResponse = (value: Response) => { expect(value.headers.get("Cache-Control")).toBe("no-store, private"); expect(value.headers.get("Referrer-Policy")).toBe("no-referrer"); };
beforeEach(() => { vi.resetAllMocks(); mocks.origin.mockReturnValue(true); mocks.auth.mockResolvedValue({ ok: true, user: { id: id(6) }, admin: {} });
  mocks.factory.mockReturnValue({ read: mocks.read, act: mocks.act }); mocks.read.mockResolvedValue({ renderingAuthorized: false }); mocks.act.mockResolvedValue({ status: "RECORDED" }); });
describe("saved repair wording HTTP boundary", () => {
  it("checks same origin then fresh owner MFA before reads or mutations", async () => {
    mocks.origin.mockReturnValue(false); expect((await POST(post(), route())).status).toBe(403); expect(mocks.auth).not.toHaveBeenCalled();
    mocks.origin.mockReturnValue(true); mocks.auth.mockResolvedValue({ ok: false, response: new Response("MFA required", { status: 403 }) });
    for (const value of [await POST(post(), route()), await GET(new Request(`${url}?versionId=${identity.versionId}`), route())]) { expect(value.status).toBe(403); privateResponse(value); }
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("binds exact query identity and never accepts a duplicate or arbitrary path", async () => {
    const response = await GET(new Request(`${url}?versionId=${identity.versionId}`), route()); expect(response.status).toBe(200); privateResponse(response);
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(identity, expect.any(AbortSignal));
    for (const query of ["", `?versionId=${identity.versionId}&versionId=${identity.versionId}`, `?versionId=${identity.versionId}&path=private`, "?versionId=bad"]) {
      expect((await GET(new Request(url + query), route())).status).toBe(404);
    }
  });
  it("passes only authenticated reviewer and explicit CHECK mode", async () => {
    const response = await POST(post({ operation: "CHECK", request }), route()); expect(response.status).toBe(200); privateResponse(response);
    expect(mocks.factory).toHaveBeenCalledWith({}, id(6)); expect(mocks.act).toHaveBeenCalledExactlyOnceWith(request, true, expect.any(AbortSignal));
  });
  it("rejects changed path, client reviewer, missing decisions and malformed or oversized input", async () => {
    for (const invalid of [{ ...request, expected: { ...request.expected, caseId: id(20) } }, { ...request, reviewerId: id(6) }, { ...request, decisions: [] }]) {
      expect((await POST(post({ operation: "SUBMIT", request: invalid }), route())).status).toBe(400);
    }
    expect((await POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(1024 * 1024 + 1) }), route())).status).toBe(400);
    expect((await POST(new Request(url, { method: "POST", body: "{}" }), route())).status).toBe(400); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("matches the actual099 limit of250 claims per member and rejects non-UUID claim identities", async () => {
    const claims = Array.from({ length: 251 }, (_, n) => ({ claimId: id(100 + n), wordingSha256: sha }));
    const excessive = { ...request, expected: { ...request.expected, members: [{ ...request.expected.members[0], claims }] },
      decisions: claims.map(c => ({ originalFileVersionId: id(5), ...c, decision: "APPROVED" })) };
    expect((await POST(post({ operation: "SUBMIT", request: excessive }), route())).status).toBe(400);
    expect((await POST(post({ operation: "SUBMIT", request: { ...request, decisions: [{ ...request.decisions[0], claimId: "display-label" }] } }), route())).status).toBe(400);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("redacts errors and never converts uncertainty into success", async () => {
    mocks.act.mockRejectedValue(new Error("private customer/provider text")); const result = await POST(post(), route());
    expect(result.status).toBe(503); expect(await result.text()).not.toContain("private customer"); privateResponse(result);
    mocks.act.mockRejectedValue(new ServiceRepairWordingError("CHANGED")); expect((await POST(post(), route())).status).toBe(409);
  });
  it("distinguishes the explicit prewrite size failure from an unknown mutation", async () => {
    mocks.act.mockRejectedValue(new ServiceRepairWordingError("TOO_LARGE")); const response = await POST(post(), route());
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: "REVIEW_TOO_LARGE" }); privateResponse(response);
  });
});

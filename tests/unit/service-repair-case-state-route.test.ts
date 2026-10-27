// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/materials/service-repair-followup-server", () => ({ createOwnerRepairFollowups: mocks.create }));
import { GET, POST } from "@/app/api/admin/service-errors/[id]/state/route";
import { ServiceErrorContractError } from "@/lib/materials/service-error-contract";
const id = (n: number) => `a1020000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const caseId = id(1), reviewer = id(2), requestId = id(3), feedbackId = id(4), admin = { exactAdminClient: true };
const url = `https://applypack.work/api/admin/service-errors/${caseId}/state`;
const route = (target = caseId) => ({ params: Promise.resolve({ id: target }) });
const request = { requestId, caseId, action: "RESOLVED", acceptedScopeSha256: "a".repeat(64), expectedReviewContextSha256: "b".repeat(64),
  explanation: "All accepted affected files and the latest feedback were checked.", reviewedRepairFiles: true, reviewedFeedback: true };
const post = (body: unknown = request, target = url) => new Request(target, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const privateResponse = (response: Response) => { expect(response.headers.get("Cache-Control")).toBe("no-store, private"); expect(response.headers.get("Referrer-Policy")).toBe("no-referrer"); expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff"); };
let service: { review: ReturnType<typeof vi.fn>; receipt: ReturnType<typeof vi.fn>; feedback: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ ok: true, user: { id: reviewer }, admin }); mocks.origin.mockReturnValue(true);
  service = { review: vi.fn().mockResolvedValue({ caseId }), receipt: vi.fn().mockResolvedValue(null),
    feedback: vi.fn().mockResolvedValue({ receipt: { requestId: feedbackId }, request: { caseId } }),
    set: vi.fn().mockResolvedValue({ status: "RECORDED", receipt: { requestId, caseId, reviewerId: reviewer }, replayed: false }) };
  mocks.create.mockReturnValue(service);
});
describe("fresh-MFA owner repair-case routes", () => {
  it("rejects cross-origin mutations before authentication or adapter construction", async () => {
    mocks.origin.mockReturnValue(false); const result = await POST(post(), route()); expect(result.status).toBe(403); privateResponse(result);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])("preserves private denied authentication status %s for reads and writes", async (status) => {
    mocks.auth.mockImplementation(async () => ({ ok: false, response: new Response("Fresh staff MFA required", { status }) }));
    for (const result of [await GET(new Request(url), route()), await POST(post(), route())]) { expect(result.status).toBe(status); privateResponse(result); }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("loads only the server-authenticated review and passes its cancellation boundary", async () => {
    const result = await GET(new Request(url), route()); expect(result.status).toBe(200); privateResponse(result); expect(await result.json()).toEqual({ caseId });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(admin, reviewer);
    expect(service.review).toHaveBeenCalledExactlyOnceWith(caseId, expect.any(AbortSignal)); expect(service.set).not.toHaveBeenCalled();
  });
  it("keeps immutable decision reconciliation and private feedback reads separate", async () => {
    const receipt = await GET(new Request(`${url}?requestId=${requestId}`), route()); expect(await receipt.json()).toEqual({ receipt: null }); privateResponse(receipt);
    expect(service.receipt).toHaveBeenCalledExactlyOnceWith(caseId, requestId, expect.any(AbortSignal));
    const feedback = await GET(new Request(`${url}?feedbackId=${feedbackId}`), route()); expect(feedback.status).toBe(200); privateResponse(feedback);
    expect(service.feedback).toHaveBeenCalledExactlyOnceWith(caseId, feedbackId, expect.any(AbortSignal));
    expect(service.review).not.toHaveBeenCalled(); expect(service.set).not.toHaveBeenCalled();
  });
  it("rejects malformed, ambiguous or extra read selectors before private service I/O", async () => {
    for (const query of ["requestId=bad", "feedbackId=", `requestId=${requestId}&feedbackId=${feedbackId}`, `requestId=${requestId}&requestId=${requestId}`, "reviewerId=" + reviewer])
      expect((await GET(new Request(`${url}?${query}`), route())).status).toBe(400);
    expect((await GET(new Request(url), route("bad"))).status).toBe(404); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("binds the mutation to the path and rejects client authority, missing attestations and oversized bodies", async () => {
    for (const body of [{ ...request, caseId: id(90) }, { ...request, reviewerId: reviewer }, { ...request, reviewedFeedback: false },
      { ...request, reviewedRepairFiles: false }, { ...request, expectedReviewContextSha256: "bad" }, { ...request, explanation: "x".repeat(100_000) },
      { ...request, generate: true }]) expect((await POST(post(body), route())).status).toBe(400);
    expect((await POST(post(request, url + "?requestId=" + requestId), route())).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("returns a new or replayed immutable receipt without executing any separate approval or delivery", async () => {
    const first = await POST(post(), route()); expect(first.status).toBe(201); privateResponse(first);
    expect(await first.json()).toMatchObject({ result: { status: "RECORDED", receipt: { requestId, caseId, reviewerId: reviewer } } });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(admin, reviewer);
    expect(service.set).toHaveBeenCalledExactlyOnceWith(request, expect.any(AbortSignal));
    service.set.mockResolvedValue({ status: "RECORDED", receipt: { requestId }, replayed: true });
    expect((await POST(post(), route())).status).toBe(200);
  });
  it("returns an explicit stale-review conflict only for the known rejection and never masks unknown results as absence", async () => {
    service.set.mockRejectedValue(new ServiceErrorContractError("CASE_CHANGED"));
    const conflict = await POST(post(), route()); expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "CASE_CHANGED" }); privateResponse(conflict);
    service.set.mockRejectedValue(new ServiceErrorContractError("FOLLOWUP_RESULT_UNKNOWN"));
    const unknown = await POST(post(), route()); expect(unknown.status).toBe(503); expect(await unknown.json()).toMatchObject({ code: "RESULT_UNCONFIRMED" }); privateResponse(unknown);
    service.receipt.mockRejectedValue(new Error("Private provider credential and customer details"));
    const read = await GET(new Request(`${url}?requestId=${requestId}`), route()); expect(read.status).toBe(503); privateResponse(read);
    expect(await read.text()).not.toMatch(/credential|customer details|receipt/);
  });
});

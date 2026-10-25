import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ context: vi.fn(), hold: vi.fn(), origin: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/drafts/anonymous-server", () => ({ anonymousDraftContext: mocks.context }));
vi.mock("@/lib/operations/protected-recovery-readiness", () => ({ newIntakeRecoveryHold: mocks.hold }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/intake/confirmed-review-server", async (original) => ({ ...await original<typeof import("@/lib/intake/confirmed-review-server")>(), prepareConfirmedReview: mocks.prepare }));
import { POST } from "@/app/api/intake/anonymous-draft/review/route";
const request = (body: unknown = { expectedVersion: 2 }) => new Request("https://applypack.work/api/intake/anonymous-draft/review", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.origin.mockReturnValue(true); mocks.context.mockResolvedValue({ admin: {}, capability: { draftId: "owned" }, secretHash: "sealed-hash" }); mocks.hold.mockResolvedValue(null); mocks.prepare.mockResolvedValue({ errors: [], sections: [], receipt: {} }); });
describe("review capability boundary", () => {
  it("rejects cross-origin requests before reading private state", async () => { mocks.origin.mockReturnValue(false); expect((await POST(request())).status).toBe(403); expect(mocks.context).not.toHaveBeenCalled(); });
  it("requires the private draft capability", async () => { mocks.context.mockResolvedValue(null); expect((await POST(request())).status).toBe(404); expect(mocks.prepare).not.toHaveBeenCalled(); });
  it("preserves the recovery lock", async () => { mocks.hold.mockResolvedValue(new Response(null, { status: 503 })); expect((await POST(request())).status).toBe(503); expect(mocks.prepare).not.toHaveBeenCalled(); });
  it("never accepts client-supplied facts, hashes or another draft identity", async () => { expect((await POST(request({ expectedVersion: 2, draftId: "foreign", reviewSha256: "forged" }))).status).toBe(400); expect(mocks.prepare).not.toHaveBeenCalled(); });
  it("binds the exact version to the server capability and disables caching", async () => { const response = await POST(request()); expect(response.status).toBe(200); expect(mocks.prepare).toHaveBeenCalledWith({}, "owned", "sealed-hash", 2); expect(response.headers.get("cache-control")).toBe("private, no-store"); });
  it("returns necessary clarification without confirming it", async () => { mocks.prepare.mockResolvedValue({ errors: [{ fieldId: "resume", message: "Review the current facts." }] }); expect((await POST(request())).status).toBe(400); });
  it("redacts private/provider failure details on concurrent source changes", async () => { mocks.prepare.mockRejectedValue(new Error("private source text and secret")); const response = await POST(request()); expect(response.status).toBe(409); expect(await response.text()).not.toContain("private source text"); });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), sameOrigin: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.sameOrigin }));
import { POST } from "@/app/api/admin/matching-research/route";

const id = "a1000000-0000-4000-8000-000000000001";
const question = { action: "QUESTION", snapshotId: id, jobSnapshotId: id, nodeId: id, prompt: "Which scheduling tools did you personally use?" };
const request = () => new Request("https://applypack.example/api/admin/matching-research", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(question),
});
beforeEach(() => {
  vi.resetAllMocks(); mocks.sameOrigin.mockReturnValue(true);
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id }, admin: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: id, error: null });
});
describe("material clarification owner issuance", () => {
  it("records the exact operator and validates the immutable question receipt", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ questionId: id });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("ap_issue_candidate_question", {
      p_snapshot_id: id, p_job_snapshot_id: id, p_node_id: id, p_actor_id: id, p_prompt: question.prompt,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("explains paid or pending-checkout ownership without attempting payment changes", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "clarification_paid_or_checkout_owner_exception" } });
    const response = await POST(request()), result = await response.json();
    expect(response.status).toBe(409); expect(result.code).toBe("CLARIFICATION_OWNER_REVIEW_REQUIRED");
    expect(result.error).toContain("payment and deadline have not been changed"); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("explains the finite question limit", async () => {
    mocks.rpc.mockRejectedValue(new Error("clarification_owner_exception_required"));
    const response = await POST(request());
    expect(response.status).toBe(409); expect((await response.json()).code).toBe("CLARIFICATION_LIMIT_REACHED");
  });
  it.each([null, "not-a-question-id", { id }])("never claims issuance after a malformed receipt %j", async data => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const response = await POST(request());
    expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("questionId");
  });
  it("redacts unexpected backend content", async () => {
    mocks.rpc.mockRejectedValue(new Error("private customer answer and database detail"));
    const response = await POST(request());
    expect(response.status).toBe(409); expect(await response.text()).not.toContain("private customer");
  });
  it("rejects cross-origin and unauthenticated requests before mutation", async () => {
    mocks.sameOrigin.mockReturnValue(false); expect((await POST(request())).status).toBe(403);
    expect(mocks.requireAdmin).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.sameOrigin.mockReturnValue(true); mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await POST(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

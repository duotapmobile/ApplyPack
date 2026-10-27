import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), origin: vi.fn(() => true) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/operations/protected-recovery-readiness", () => ({ newIntakeRecoveryHold: async () => null }));
import { GET, POST } from "@/app/api/customer/candidate-questions/route";
const id = (n: number) => `45000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = { id: id(1), email: "verified@example.invalid", email_confirmed_at: "2026-10-26T12:00:00Z", is_anonymous: false };
const body = { questionId: id(9), answer: "I maintained records.", confirmed: true };
const request = (value: unknown = body) => new Request("https://applypack.work/api/customer/candidate-questions", { method: "POST", body: JSON.stringify(value) });
describe("signed-in clarification boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.origin.mockReturnValue(true); mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    mocks.rpc.mockImplementation((name: string) => ({ abortSignal: async () => ({ error: null, data: name === "ap_material_clarification_answer_context"
      ? { mode: "LEGACY", sourceDraftId: id(2), successorDraftId: null } : name === "ap_answer_material_clarification"
        ? { state: "LEGACY_EVIDENCE_RECORDED", factId: id(3) } : [{ id: id(9), prompt: "Which records did you maintain?", answered: false, review_required: false }] }) }));
  });
  it.each([null, { ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }])("requires a verified nonanonymous account for private reads and answers (%#)", async account => {
    mocks.getUser.mockResolvedValue({ data: { user: account }, error: null });
    expect((await GET()).status).toBe(401); expect((await POST(request())).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves a supported historical answer through the current adapter with session-derived ownership", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ state: "LEGACY_EVIDENCE_RECORDED", factId: id(3) });
    expect(mocks.rpc).toHaveBeenCalledWith("ap_answer_material_clarification", expect.objectContaining({ p_customer_id: user.id,
      p_draft_id: null, p_secret_hash: null, p_question_id: id(9), p_answer: body.answer }));
    expect(response.headers.get("cache-control")).toContain("private"); expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("lists only the verified customer's questions through the current ownership adapter", async () => {
    expect((await GET()).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_material_clarification_questions", { p_customer_id: user.id, p_draft_id: null, p_secret_hash: null });
  });
  it("rejects client-supplied ownership", async () => {
    expect((await POST(request({ ...body, customerId: id(8) }))).status).toBe(400); expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes before reading identity", async () => {
    mocks.origin.mockReturnValue(false); expect((await POST(request())).status).toBe(403); expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it.each([['question_owner_or_version_invalid', 409], ['private ownership data', 503]] as const)("sanitizes ownership or storage failure %s", async (message, status) => {
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: { message } }) });
    const response = await POST(request()); expect(response.status).toBe(status); expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.text()).not.toContain(message);
  });
});

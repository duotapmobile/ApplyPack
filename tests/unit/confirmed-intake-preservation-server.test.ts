import { describe, expect, it, vi } from "vitest";
import { isConfirmedIntake } from "@/lib/intake/four-step-server";
import { anonymousDraftError } from "@/lib/drafts/anonymous-server";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
function client(data: unknown, error: unknown = null) {
  const query = { select: vi.fn(), eq: vi.fn(), abortSignal: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.abortSignal.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return { admin: { from } as unknown as Parameters<typeof isConfirmedIntake>[0], from, query };
}
describe("confirmed intake server state", () => {
  it("binds the receipt read to the authenticated draft and exact snapshot", async () => {
    const c = client({ schema_version: "applypack-intake-v4", confirmed_review: { contractVersion: "applypack-confirmed-intake-v1" } });
    expect(await isConfirmedIntake(c.admin, "draft", "snapshot")).toBe(true);
    expect(c.query.eq.mock.calls).toEqual([["id", "snapshot"], ["draft_id", "draft"]]);
    expect(c.query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it("preserves legacy intake behavior and makes no read for an unfinalized draft", async () => {
    const c = client({ schema_version: "applypack-intake-v3", confirmed_review: null });
    expect(await isConfirmedIntake(c.admin, "draft", null)).toBe(false); expect(c.from).not.toHaveBeenCalled();
    expect(await isConfirmedIntake(c.admin, "draft", "snapshot")).toBe(false);
  });
  it.each([null, { schema_version: "applypack-intake-v4", confirmed_review: null },
    { schema_version: "applypack-intake-v4", confirmed_review: { contractVersion: "wrong" } }])("does not expose an editable state when v4 evidence is unavailable", async (data) => {
    const c = client(data); await expect(isConfirmedIntake(c.admin, "draft", "snapshot")).rejects.toThrow("confirmed_intake_state_unavailable");
  });
  it("fails closed on a database failure", async () => {
    const c = client(null, { message: "private diagnostic" });
    await expect(isConfirmedIntake(c.admin, "draft", "snapshot")).rejects.toThrow("confirmed_intake_state_unavailable");
  });
  it("gives useful bounded errors without claiming a paid deadline was changed", () => {
    expect(anonymousDraftError({ message: "confirmed_intake_requires_successor_review" })).toMatchObject({ status: 409, body: { code: "CONFIRMED_INTAKE_PRESERVED" } });
    expect(anonymousDraftError({ message: "clarification_paid_or_checkout_owner_exception" })).toMatchObject({ status: 409, body: { code: "CLARIFICATION_OWNER_REVIEW_REQUIRED" } });
  });
});

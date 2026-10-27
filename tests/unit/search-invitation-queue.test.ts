import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadSearchInvitationQueue } from "@/lib/commerce/search-invitation-queue";

const now = new Date("2026-10-23T12:00:00Z");
const tables: Record<string, { data: unknown[]; error: unknown }> = {};
const calls: Array<[string, string, ...unknown[]]> = [];
const rpc = vi.fn(), getUserById = vi.fn();
const admin = { rpc, auth: { admin: { getUserById } }, from(table: string) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "gt", "in", "order", "limit"]) query[method] = (...args: unknown[]) => {
    calls.push([table, method, ...args]); return query;
  };
  query.returns = () => Promise.resolve(tables[table]);
  return query;
} } as unknown as Parameters<typeof loadSearchInvitationQueue>[0];
const eligible = { id: "assessment", snapshot_id: "snapshot", state: "COMPLETE", outcome: "LIKELY",
  resolution_blocker: "NONE", invalidated_at: null, expires_at: "2026-10-23T13:00:00Z", preliminarily_deliverable_count: 10 };

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { claimed: false, customerId: null, rootDraftId: null }, error: null });
  getUserById.mockReset();
  calls.length = 0;
  tables.ap_anonymous_drafts = { data: [{ id: "draft", finalized_snapshot_id: "snapshot" }], error: null };
  tables.ap_feasibility_assessments = { data: [{ ...eligible }], error: null };
  tables.ap_intake_snapshots = { data: [{ id: "snapshot", access_email_normalized: "customer@example.test", desired_activities: ["CUSTOMER_SUPPORT"], work_modes: ["REMOTE"], us_state_or_dc: "FL", employment_types: ["FULL_TIME"] }], error: null };
  tables.ap_search_checkout_invitations = { data: [], error: null };
});

describe("operator invitation queue", () => {
  it("uses the current verified account address without retargeting the old confirmed document contact", async () => {
    const owner = "a1030000-0000-4000-8000-000000000001", root = "a1030000-0000-4000-8000-000000000002";
    rpc.mockResolvedValue({ data: { claimed: true, customerId: owner, rootDraftId: root }, error: null });
    getUserById.mockResolvedValue({ data: { user: { id: owner, email: "current@example.invalid", email_confirmed_at: now.toISOString(), is_anonymous: false } }, error: null });
    const result = await loadSearchInvitationQueue(admin, now);
    expect(result.candidates[0].email).toBe("current@example.invalid");
    expect(rpc).toHaveBeenCalledWith("ap_intake_payment_identity", { p_draft_id: "draft", p_snapshot_id: "snapshot" });
    expect(getUserById).toHaveBeenCalledWith(owner);
  });
  it.each([
    { data: null, error: { message: "unavailable" } },
    { data: { claimed: false }, error: null },
    { data: null, error: null },
  ])("does not fall back to an old email when ownership is unavailable or malformed: %j", async (result) => {
    rpc.mockResolvedValue(result);
    expect(await loadSearchInvitationQueue(admin, now)).toEqual({ unavailable: true, candidates: [] });
    expect(getUserById).not.toHaveBeenCalled();
  });
  it("keeps completed eligible intakes reachable with server-sourced identifiers", async () => {
    const result = await loadSearchInvitationQueue(admin, now);
    expect(result).toMatchObject({ unavailable: false, candidates: [{ draftId: "draft", snapshotId: "snapshot", assessmentId: "assessment", eligibleJobs: 10, activeInvitationExpiresAt: null }] });
    expect(calls).toContainEqual(["ap_anonymous_drafts", "eq", "state", "COMPLETE"]);
    expect(calls).toContainEqual(["ap_anonymous_drafts", "is", "converted_customer_id", null]);
    expect(calls).toContainEqual(["ap_anonymous_drafts", "gt", "expires_at", now.toISOString()]);
  });
  it.each([
    { state: "PENDING" }, { outcome: "UNLIKELY" }, { resolution_blocker: "CUSTOMER_INPUT" },
    { invalidated_at: now.toISOString() }, { expires_at: now.toISOString() }, { expires_at: "invalid" },
    { preliminarily_deliverable_count: 9 }, { preliminarily_deliverable_count: null },
  ])("excludes an assessment that is no longer eligible: %j", async (change) => {
    tables.ap_feasibility_assessments.data = [{ ...eligible, ...change }];
    expect((await loadSearchInvitationQueue(admin, now)).candidates).toEqual([]);
  });
  it("does not revive an older eligible result after a newer failed assessment", async () => {
    tables.ap_feasibility_assessments.data = [{ ...eligible, id: "newer", outcome: "UNLIKELY" }, eligible];
    expect((await loadSearchInvitationQueue(admin, now)).candidates).toEqual([]);
  });
  it("shows already reserved invitations without retrieving their secrets", async () => {
    tables.ap_search_checkout_invitations.data = [{ draft_id: "draft", expires_at: "2026-10-23T12:15:00Z" }];
    expect((await loadSearchInvitationQueue(admin, now)).candidates[0].activeInvitationExpiresAt).toBe("2026-10-23T12:15:00Z");
    expect(calls).toContainEqual(["ap_search_checkout_invitations", "select", "draft_id,expires_at"]);
  });
  it.each(["ap_anonymous_drafts", "ap_feasibility_assessments", "ap_intake_snapshots", "ap_search_checkout_invitations"])("fails closed when %s is unavailable", async (table) => {
    tables[table].error = { message: "private database diagnostic" };
    expect(await loadSearchInvitationQueue(admin, now)).toEqual({ unavailable: true, candidates: [] });
  });
});

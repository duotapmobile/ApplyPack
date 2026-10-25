import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadDeliveredMatchGroups, loadMaterialDeliveries } from "@/lib/materials/portal";
import type { CustomerRetentionAccess } from "@/lib/materials/retention-access";

const orderId = "10000000-0000-4000-8000-000000000001";
const lineId = "10000000-0000-4000-8000-000000000002";
const retention: CustomerRetentionAccess = { policyVersion: "one_off_30d_v1", orders: [{
  order_id: orderId, policy_version: "one_off_30d_v1", action_expires_at: "2020-01-01T12:00:00Z",
  access_expires_at: "2020-01-01T12:00:00Z", action_expired: true, access_expired: true, purged_at: null,
}], materials: [{ material_line_id: lineId, order_id: orderId, policy_version: "one_off_30d_v1", access_expires_at: "2020-01-01T12:00:00Z", access_expired: true }] };
function client(rows: Record<string, unknown[]>, errorTable?: string) {
  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "order"]) query[method] = vi.fn(() => query);
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table] || [], error: table === errorTable ? {} : null }).then(resolve);
    return query;
  });
  return { from, supabase: { from } as unknown as Parameters<typeof loadMaterialDeliveries>[0]["supabase"] };
}

describe("private retention portal projection", () => {
  it("does not query job details or release members for an expired search", async () => {
    const c = client({});
    const result = await loadDeliveredMatchGroups({ supabase: c.supabase, retention, services: [{ legacy_order_id: orderId, original_snapshot_id: "snapshot" }], releases: [{ id: "release", order_id: orderId, committed_at: "2019-12-01T12:00:00Z", release_kind: "SEARCH_EXACT_TEN" }] });
    expect(result).toEqual({ groups: [], jobs: [] });
    expect(c.from).not.toHaveBeenCalled();
  });
  it.each(["PENDING", "FAILED", "SUCCEEDED"])("keeps %s refund status after RLS hides an expired private material line", async (state) => {
    const c = client({ ap_material_purchases: [], ap_refund_operations: [{ material_line_id: lineId, state, created_at: "2026-10-24T12:00:00Z" }] });
    const result = await loadMaterialDeliveries({ supabase: c.supabase, customerId: "customer", retention });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ lineId, refundState: state, accessExpired: true, company: "", jobSnapshotId: "", artifacts: [], proposal: null });
    expect(c.from.mock.calls.map(([table]) => table)).toEqual(["ap_material_purchases", "ap_refund_operations"]);
  });
  it("does not turn unavailable refund evidence into a false no-refund summary", async () => {
    const c = client({}, "ap_refund_operations");
    await expect(loadMaterialDeliveries({ supabase: c.supabase, customerId: "customer", retention })).rejects.toThrow("material_refund_status_unavailable");
  });
  it("preserves the active paid material obligation even though its parent search expired", async () => {
    const c = client({ ap_material_purchases: [{ id: "purchase" }], ap_material_lines: [{ id: lineId, purchase_id: "purchase", delivered_match_id: "match", fulfillment: "PAID", substitution: "NONE", materials_due_at: "2030-01-01T12:00:00Z", active_revision: 1 }] });
    const result = await loadMaterialDeliveries({ supabase: c.supabase, customerId: "customer", retention: { ...retention, materials: [{ ...retention.materials[0], access_expired: false, access_expires_at: null }] } });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ lineId, accessExpired: false, accessExpiresAt: null, dueAt: "2030-01-01T12:00:00Z" });
    expect(c.from).toHaveBeenCalledWith("ap_material_change_proposals");
  });
});

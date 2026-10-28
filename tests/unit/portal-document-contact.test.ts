import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadDeliveredMatchGroups } from "@/lib/materials/portal";
import type { CustomerRetentionAccess } from "@/lib/materials/retention-access";

const id = (n: number) => `d1030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const orderId = id(1), releaseId = id(2), snapshotId = id(3);
function fixture(options: { contact?: unknown[]; contactError?: boolean; accessExpired?: boolean; actionsExpired?: boolean } = {}) {
  const rows: Record<string, unknown[]> = {
    ap_release_members: Array.from({ length: 10 }, (_, i) => ({ release_id: releaseId, member_id: id(10 + i), position: i + 1 })),
    job_matches: Array.from({ length: 10 }, (_, i) => ({ id: id(10 + i), search_order_id: orderId, release_evaluation_id: id(30 + i), position: i + 1, job: { company: "Fictional employer", title: `Role ${i + 1}` } })),
    ap_match_evaluations: Array.from({ length: 10 }, (_, i) => ({ id: id(30 + i), job_snapshot_id: id(50 + i) })),
    ap_employer_submission_rules: [],
    ap_intake_snapshots: options.contact ?? [{ id: snapshotId, document_contact_email: "documents@example.invalid", retention_state: "ACTIVE" }],
  };
  const queries: Array<{ table: string; select: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> }> = [];
  const from = vi.fn((table: string) => {
    const query = { table, select: vi.fn(), in: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table] || [], error: options.contactError && table === "ap_intake_snapshots" ? { message: "unavailable" } : null }).then(resolve) };
    for (const method of [query.select, query.in, query.eq, query.is, query.order]) method.mockReturnValue(query);
    queries.push(query);
    return query;
  });
  const retention: CustomerRetentionAccess = { policyVersion: "one_off_30d_v1", materials: [], orders: [{
    order_id: orderId, policy_version: "one_off_30d_v1", access_expires_at: null, action_expires_at: null,
    access_expired: options.accessExpired ?? false, action_expired: options.actionsExpired ?? false, purged_at: null,
  }] };
  const input = { supabase: { from } as unknown as Parameters<typeof loadDeliveredMatchGroups>[0]["supabase"], retention,
    services: [{ legacy_order_id: orderId, original_snapshot_id: snapshotId }],
    releases: [{ id: releaseId, order_id: orderId, committed_at: "2026-10-26T12:00:00Z", release_kind: "SEARCH_EXACT_TEN" }] };
  return { input, from, queries };
}

describe("document contact prefill from the exact delivered intake", () => {
  it("returns the confirmed document email using only the customer's exact active source", async () => {
    const f = fixture(), result = await loadDeliveredMatchGroups(f.input);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ sourceSnapshotId: snapshotId, documentContactEmail: "documents@example.invalid" });
    const query = f.queries.find((item) => item.table === "ap_intake_snapshots")!;
    expect(query.select).toHaveBeenCalledWith("id,document_contact_email,retention_state");
    expect(query.in).toHaveBeenCalledWith("id", [snapshotId]);
    expect(query.eq).toHaveBeenCalledWith("retention_state", "ACTIVE");
  });

  it("preserves the legacy fallback only when the readable snapshot has no stored document email", async () => {
    const f = fixture({ contact: [{ id: snapshotId, document_contact_email: null, retention_state: "ACTIVE" }] });
    expect((await loadDeliveredMatchGroups(f.input)).groups[0].documentContactEmail).toBeNull();
  });

  it.each([
    [],
    [{ id: id(99), document_contact_email: "other@example.invalid", retention_state: "ACTIVE" }],
    [{ id: snapshotId, document_contact_email: "removed@retention.invalid", retention_state: "PURGED" }],
    [{ id: snapshotId, document_contact_email: "invalid-email", retention_state: "ACTIVE" }],
    [{ id: snapshotId, document_contact_email: "a@example.invalid", retention_state: "ACTIVE" }, { id: snapshotId, document_contact_email: "b@example.invalid", retention_state: "ACTIVE" }],
  ].map((contact) => ({ contact })))("does not silently replace unavailable or conflicting contact evidence: $contact", async ({ contact }) => {
    const f = fixture({ contact });
    await expect(loadDeliveredMatchGroups(f.input)).rejects.toThrow("delivered_document_contact_unavailable");
  });

  it("fails closed when the authenticated private read fails", async () => {
    await expect(loadDeliveredMatchGroups(fixture({ contactError: true }).input)).rejects.toThrow("delivered_document_contact_unavailable");
  });

  it("does not read contact data after private access expires", async () => {
    const f = fixture({ accessExpired: true });
    expect(await loadDeliveredMatchGroups(f.input)).toEqual({ groups: [], jobs: [] });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("does not read contact data when an active search can no longer start a pack purchase", async () => {
    const f = fixture({ actionsExpired: true }), result = await loadDeliveredMatchGroups(f.input);
    expect(result.groups[0]).toMatchObject({ actionsExpired: true, documentContactEmail: null });
    expect(f.from).not.toHaveBeenCalledWith("ap_intake_snapshots");
  });
});

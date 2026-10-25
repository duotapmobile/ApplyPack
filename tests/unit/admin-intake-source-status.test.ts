import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadOrderIntakeSourceModes } from "@/lib/intake/admin-source-status";

const snapshot = { schema_version: "applypack-intake-v4", confirmed_review: {
  contractVersion: "applypack-confirmed-intake-v1", entryMode: "GUIDED",
} };
function client(data: unknown[] | null, error: unknown = null) {
  const select = vi.fn();
  const batch = vi.fn();
  const query = { select, in: batch, returns: () => Promise.resolve({ data, error }) };
  select.mockReturnValue(query); batch.mockReturnValue(query);
  return { admin: { from: () => query } as unknown as Parameters<typeof loadOrderIntakeSourceModes>[0], select, batch };
}

describe("source mode from original confirmed intake", () => {
  it("uses original snapshot provenance for genuine guided entry", async () => {
    const { admin, select } = client([{ legacy_order_id: "order", original_snapshot_id: "snapshot", original_snapshot: snapshot }]);
    expect((await loadOrderIntakeSourceModes(admin, ["order"])).get("order")).toBe("GUIDED");
    expect(select.mock.calls[0][0]).toContain("ap_search_services_original_snapshot_id_fkey");
  });
  it.each([
    { schema_version: "applypack-intake-v3", confirmed_review: snapshot.confirmed_review },
    { ...snapshot, confirmed_review: null },
    { ...snapshot, confirmed_review: { ...snapshot.confirmed_review, contractVersion: "unknown" } },
    { ...snapshot, confirmed_review: { ...snapshot.confirmed_review, entryMode: "CURRENT_RESUME" } },
  ])("does not infer no-upload status from absent or incompatible receipt metadata", async (original) => {
    const { admin } = client([{ legacy_order_id: "order", original_snapshot_id: "snapshot", original_snapshot: original }]);
    expect((await loadOrderIntakeSourceModes(admin, ["order"])).get("order")).toBe("UPLOADED_OR_LEGACY");
  });
  it("preserves historical order behavior without inventing a guided receipt", async () => {
    expect((await loadOrderIntakeSourceModes(client([]).admin, ["legacy"])).get("legacy")).toBe("UPLOADED_OR_LEGACY");
  });
  it("keeps missing or unreadable source provenance unavailable", async () => {
    for (const input of [client(null, { message: "failed" }), client([{ legacy_order_id: "order", original_snapshot_id: "snapshot", original_snapshot: null }])]) {
      expect((await loadOrderIntakeSourceModes(input.admin, ["order"])).get("order")).toBe("UNAVAILABLE");
    }
  });
});

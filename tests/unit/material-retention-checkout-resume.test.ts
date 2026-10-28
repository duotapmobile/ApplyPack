import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { mayResumeMaterialCheckoutAfterActionExpiry } from "@/lib/materials/retention-access-server";
const now = Date.parse("2026-10-24T12:01:00Z");
const id = "10000000-0000-4000-8000-000000000001";
const input = { customerId: "verified-owner", orderId: "root-search", releaseId: "delivered-release", snapshotId: "original-intake",
  contactPayloadId: "existing-encrypted-contact", requestKey: "same-exact-command", selectionSha256: "a".repeat(64),
  launchReleaseSha: "b".repeat(40), mode: "PUBLIC", authorizationId: null, actionExpiresAt: "2026-10-24T12:00:00Z", now };
const intent = { id, created_at: "2026-10-24T11:59:00Z", expires_at: "2026-10-24T12:34:00Z", state: "OPEN" };
const initiation = { initiated_at: "2026-10-24T11:59:00Z", provider_session_deadline: "2026-10-24T12:34:00Z", state: "OPEN", authorization_id: null };
function client(rows: unknown[] = [intent, initiation], error: unknown = null) {
  const eq = vi.fn(); let index = 0;
  const from = vi.fn(() => {
    const data = rows[index++];
    const query = { select: () => query, eq: (key: string, value: unknown) => { eq(key, value); return query; }, maybeSingle: async () => ({ data, error }) };
    return query;
  });
  return { admin: { from } as unknown as SupabaseClient, from, eq };
}
describe("already-started material checkout after optional purchase window", () => {
  it("recovers only the exact durable pre-deadline command with its original unexpired provider deadline", async () => {
    const fixture = client();
    expect(await mayResumeMaterialCheckoutAfterActionExpiry(fixture.admin, input)).toBe(true);
    for (const [key, value] of Object.entries({ customer_id: input.customerId, delivered_order_id: input.orderId,
      delivered_release_id: input.releaseId, source_snapshot_id: input.snapshotId, contact_payload_id: input.contactPayloadId,
      request_key: input.requestKey, selection_sha256: input.selectionSha256, id, product_kind: "MATERIALS", resource_id: input.releaseId,
      request_sha256: input.selectionSha256, mode: "PUBLIC", release_sha: input.launchReleaseSha })) expect(fixture.eq).toHaveBeenCalledWith(key, value);
  });
  it.each([null, { ...intent, created_at: input.actionExpiresAt }, { ...intent, expires_at: new Date(now).toISOString() },
    { ...intent, state: "COMPLETED" }, { ...intent, state: "FAILED" }, { ...intent, expires_at: null }])("refuses new, late, expired or terminal commands (%j)", async (value) => {
    const fixture = client([value, initiation]);
    expect(await mayResumeMaterialCheckoutAfterActionExpiry(fixture.admin, input)).toBe(false);
    expect(fixture.from).toHaveBeenCalledTimes(1);
  });
  it.each([null, { ...initiation, initiated_at: input.actionExpiresAt }, { ...initiation, state: "EXPIRATION_REQUIRED" },
    { ...initiation, authorization_id: id }, { ...initiation, provider_session_deadline: "2026-10-24T12:35:00Z" },
    { ...initiation, initiated_at: "2026-10-24T11:50:00Z" }])("refuses inconsistent or unauthorized provider initiation (%j)", async (value) => {
    expect(await mayResumeMaterialCheckoutAfterActionExpiry(client([intent, value]).admin, input)).toBe(false);
  });
  it("does not turn unknown provider state into a new checkout", async () => {
    await expect(mayResumeMaterialCheckoutAfterActionExpiry(client([], { message: "private detail" }).admin, input)).rejects.toThrow("material_checkout_resume_unavailable");
  });
});

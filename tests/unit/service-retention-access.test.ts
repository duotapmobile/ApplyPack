import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { customerRetentionAccessSchema, privateAccessExpired, privateDownloadSeconds, retentionErrorMessage, searchActionsExpired } from "@/lib/materials/retention-access";
import { loadCustomerRetentionAccess } from "@/lib/materials/retention-access-server";
import type { SupabaseClient } from "@supabase/supabase-js";

const now = Date.parse("2026-11-24T12:00:00Z");
const order = {
  order_id: "10000000-0000-4000-8000-000000000001", policy_version: "one_off_30d_v1" as const,
  action_expires_at: "2026-11-23T12:00:00Z", access_expires_at: "2026-12-01T12:00:00Z",
  access_expired: false, action_expired: true, purged_at: null,
};
const receipt = () => ({ policyVersion: "one_off_30d_v1", orders: [order], materials: [] });

describe("prospective service retention access", () => {
  it("preserves historical orders absent from the policy instead of inferring expiry from age", () => {
    expect(privateAccessExpired(undefined, now)).toBe(false);
    expect(searchActionsExpired(undefined, now)).toBe(false);
    expect(privateDownloadSeconds(null, 900, now)).toBe(900);
  });
  it("does not reopen optional purchase or conflict requests for a later replacement delivery", () => {
    expect(searchActionsExpired(order, now)).toBe(true);
    expect(privateAccessExpired(order, now)).toBe(false);
  });
  it("expires exactly at the authoritative deadline even when an earlier RPC flag was false", () => {
    expect(privateAccessExpired({ ...order, access_expires_at: new Date(now).toISOString() }, now)).toBe(true);
    expect(searchActionsExpired({ ...order, action_expired: false, action_expires_at: new Date(now).toISOString() }, now)).toBe(true);
  });
  it("honors server expiry and completed purge despite an earlier client clock", () => {
    expect(privateAccessExpired({ ...order, access_expired: true }, now - 99_999_999)).toBe(true);
    expect(privateAccessExpired({ ...order, purged_at: new Date(now).toISOString() }, now)).toBe(true);
  });
  it("keeps undelivered paid obligations available without inventing a delivery date", () => {
    const pending = { ...order, action_expires_at: null, access_expires_at: null, action_expired: false };
    expect(privateAccessExpired(pending, now)).toBe(false);
    expect(searchActionsExpired(pending, now)).toBe(false);
  });
  it("caps signed URLs to remaining whole seconds and denies subsecond or expired authorization", () => {
    expect(privateDownloadSeconds(new Date(now + 30_900).toISOString(), 900, now)).toBe(30);
    expect(privateDownloadSeconds(new Date(now + 999).toISOString(), 900, now)).toBe(0);
    expect(privateDownloadSeconds(new Date(now - 1).toISOString(), 900, now)).toBe(0);
    expect(privateDownloadSeconds(new Date(now + 5_000_000).toISOString(), 900, now)).toBe(900);
    expect(privateDownloadSeconds("invalid", 900, now)).toBe(0);
  });
  it.each([
    () => ({ ...receipt(), policyVersion: "other" }),
    () => ({ ...receipt(), orders: [order, order] }),
    () => ({ ...receipt(), orders: [{ ...order, access_expires_at: "invalid" }] }),
    () => ({ ...receipt(), orders: [{ ...order, customer_email: "private@example.invalid" }] }),
    () => ({ ...receipt(), orders: [{ ...order, access_expired: "false" }] }),
  ])("rejects unknown, malformed, duplicate or private-data-bearing access responses", (invalid) => {
    expect(customerRetentionAccessSchema.safeParse(invalid()).success).toBe(false);
  });
  it("requests only the authenticated customer's access records and refuses provider failure", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: receipt(), error: null }).mockResolvedValueOnce({ data: receipt(), error: {} });
    const client = { rpc } as unknown as SupabaseClient;
    expect(await loadCustomerRetentionAccess(client, "verified-customer")).toEqual(receipt());
    expect(rpc).toHaveBeenCalledWith("ap_customer_retention_access", { p_customer_id: "verified-customer" });
    await expect(loadCustomerRetentionAccess(client, "verified-customer")).rejects.toThrow("customer_retention_access_unavailable");
  });
  it("returns only controlled expiry messages, never raw provider errors", () => {
    expect(retentionErrorMessage({ message: "service_retention_action_expired" })).toContain("30-day window");
    expect(retentionErrorMessage({ message: "service_retention_access_expired" })).toContain("private access");
    expect(retentionErrorMessage({ message: "private database detail" })).toBeNull();
  });
});

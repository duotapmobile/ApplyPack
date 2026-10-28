import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadCurrentIntakeRecipient, readIntakePaymentIdentity } from "@/lib/commerce/intake-identity-server";
const id = (n: number) => `a1030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rpc = vi.fn(), getUserById = vi.fn();
const admin = { rpc, auth: { admin: { getUserById } } } as unknown as Parameters<typeof readIntakePaymentIdentity>[0];
beforeEach(() => { vi.resetAllMocks(); });
describe("exact intake ownership and current recipient SDK boundary", () => {
  it("passes the exact source pair and returns the strict immutable owner receipt", async () => {
    const receipt = { claimed: true, customerId: id(3), rootDraftId: id(4) };
    rpc.mockResolvedValue({ data: receipt, error: null });
    expect(await readIntakePaymentIdentity(admin, id(1), id(2))).toEqual(receipt);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ap_intake_payment_identity", { p_draft_id: id(1), p_snapshot_id: id(2) });
  });
  it.each([null, {}, { claimed: false }, { claimed: true, customerId: id(3), rootDraftId: null }])("rejects malformed receipts: %j", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(loadCurrentIntakeRecipient(admin, id(1), id(2), "old@example.invalid")).rejects.toThrow("intake_payment_identity_invalid");
    expect(getUserById).not.toHaveBeenCalled();
  });
  it("never trusts returned data accompanied by a database error", async () => {
    rpc.mockResolvedValue({ data: { claimed: false, customerId: null, rootDraftId: null }, error: { message: "private diagnostic" } });
    await expect(readIntakePaymentIdentity(admin, id(1), id(2))).rejects.toThrow("intake_payment_identity_unavailable");
  });
  it("uses current verified account email even if document email is different or minimized", async () => {
    rpc.mockResolvedValue({ data: { claimed: true, customerId: id(3), rootDraftId: id(4) }, error: null });
    getUserById.mockResolvedValue({ data: { user: { id: id(3), email: "Current@Example.invalid", email_confirmed_at: "2026-10-27T01:00:00Z", is_anonymous: false } }, error: null });
    expect(await loadCurrentIntakeRecipient(admin, id(1), id(2), "removed@retention.invalid")).toEqual({ email: "current@example.invalid", customerId: id(3), basis: "VERIFIED_ACCOUNT" });
    expect(getUserById).toHaveBeenCalledExactlyOnceWith(id(3));
  });
  it("fails closed on Auth failure rather than using old snapshot email", async () => {
    rpc.mockResolvedValue({ data: { claimed: true, customerId: id(3), rootDraftId: id(4) }, error: null });
    getUserById.mockResolvedValue({ data: { user: null }, error: { message: "unavailable" } });
    await expect(loadCurrentIntakeRecipient(admin, id(1), id(2), "old@example.invalid")).rejects.toThrow("intake_recipient_unavailable");
  });
  it("retains historical email handling only for an exact unclaimed result", async () => {
    rpc.mockResolvedValue({ data: { claimed: false, customerId: null, rootDraftId: null }, error: null });
    expect(await loadCurrentIntakeRecipient(admin, id(1), id(2), "old@example.invalid")).toEqual({ email: "old@example.invalid", customerId: null, basis: "HISTORICAL_ACCESS_EMAIL" });
    expect(getUserById).not.toHaveBeenCalled();
  });
});

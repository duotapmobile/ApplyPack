import { describe, expect, it, vi } from "vitest";
import { intakeRecipient } from "@/lib/commerce/intake-recipient";

const owner = "e1030000-0000-4000-8000-000000000001", other = "e1030000-0000-4000-8000-000000000002";
const claimed = { claimed: true, customerId: owner, rootDraftId: "e1030000-0000-4000-8000-000000000003" };
const account = { id: owner, email: "Current@example.invalid", email_confirmed_at: "2026-10-26T12:00:00Z", is_anonymous: false };

describe("invitation contact identity", () => {
  it("uses the stable owner's current verified address instead of a reused original address", async () => {
    const load = vi.fn(async () => account);
    expect(await intakeRecipient(claimed, "now-someone-else@example.invalid", load))
      .toEqual({ email: "current@example.invalid", customerId: owner, basis: "VERIFIED_ACCOUNT" });
    expect(load).toHaveBeenCalledExactlyOnceWith(owner);
  });
  it("permits the historical address only after an explicit unclaimed receipt", async () => {
    const load = vi.fn();
    expect(await intakeRecipient({ claimed: false, customerId: null, rootDraftId: null }, "legacy@example.invalid", load))
      .toEqual({ email: "legacy@example.invalid", customerId: null, basis: "HISTORICAL_ACCESS_EMAIL" });
    expect(load).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...account, id: other }, { ...account, email_confirmed_at: null },
    { ...account, email_confirmed_at: "" }, { ...account, is_anonymous: true }, { ...account, email: "invalid" }])
    ("never falls back to the old address when the claimed account is unavailable: %j", async (value) => {
      await expect(intakeRecipient(claimed, "old@example.invalid", async () => value)).rejects.toThrow("intake_recipient_unavailable");
    });
  it("does not turn an identity or provider failure into historical delivery", async () => {
    const load = vi.fn(async () => { throw new Error("account_lookup_unavailable"); });
    await expect(intakeRecipient(null, "old@example.invalid", load)).rejects.toThrow("intake_payment_identity_invalid");
    expect(load).not.toHaveBeenCalled();
    await expect(intakeRecipient(claimed, "old@example.invalid", load)).rejects.toThrow("account_lookup_unavailable");
  });
});

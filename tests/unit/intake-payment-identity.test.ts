import { describe, expect, it, vi } from "vitest";
import { intakePaymentCustomer, intakePaymentIdentity } from "@/lib/commerce/intake-payment-identity";

const owner = "c1030000-0000-4000-8000-000000000001";
const other = "c1030000-0000-4000-8000-000000000002";
const root = "c1030000-0000-4000-8000-000000000003";
const claimed = { claimed: true, customerId: owner, rootDraftId: root };
const unclaimed = { claimed: false, customerId: null, rootDraftId: null };

describe("intake payment identity boundary", () => {
  it("keeps the claimed account even when the historical email now resolves to someone else", async () => {
    const emailLookup = vi.fn(async () => other);
    expect(await intakePaymentCustomer(claimed, emailLookup)).toBe(owner);
    expect(emailLookup).not.toHaveBeenCalled();
    expect(intakePaymentIdentity(claimed)).toEqual(claimed);
  });

  it("does not require private contact content to reconcile a retained claimed payment", async () => {
    const emailLookup = vi.fn(async () => { throw new Error("contact_content_removed"); });
    expect(await intakePaymentCustomer(claimed, emailLookup)).toBe(owner);
    expect(emailLookup).not.toHaveBeenCalled();
  });

  it("retains historical lookup only for an explicit unclaimed result", async () => {
    const emailLookup = vi.fn(async () => other);
    expect(await intakePaymentCustomer(unclaimed, emailLookup)).toBe(other);
    expect(emailLookup).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    null, undefined, {}, [], false,
    { ...claimed, claimed: "true" },
    { ...claimed, customerId: null },
    { ...claimed, customerId: "invalid-id" },
    { ...claimed, rootDraftId: null },
    { ...unclaimed, customerId: owner },
    { ...unclaimed, rootDraftId: root },
    { claimed: false },
    { ...claimed, fallbackEmail: "replacement@example.invalid" },
  ])("rejects incomplete or contradictory receipts without falling back to email: %j", async (receipt) => {
    const emailLookup = vi.fn(async () => other);
    await expect(intakePaymentCustomer(receipt, emailLookup)).rejects.toThrow("intake_payment_identity_invalid");
    expect(emailLookup).not.toHaveBeenCalled();
  });

  it("propagates historical lookup failure instead of inventing an owner", async () => {
    await expect(intakePaymentCustomer(unclaimed, async () => { throw new Error("lookup_unavailable"); }))
      .rejects.toThrow("lookup_unavailable");
    await expect(intakePaymentCustomer(unclaimed, async () => "")).rejects.toThrow("intake_payment_customer_invalid");
  });
});

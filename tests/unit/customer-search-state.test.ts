import { describe, expect, it } from "vitest";
import { customerSearchState } from "@/lib/commerce/customer-search-state";
const service = { fulfillment: "RESEARCHING", adjustment: "NONE", capacity_exception_at: null, refund_started_at: null };
describe("customer refund and delivery history", () => {
  it("truthfully retains a delivered search after a successful refund", () => {
    expect(customerSearchState(service, "SUCCEEDED", true)).toMatchObject({ label: "Refunded", message: expect.stringContaining("delivered before the refund") });
    expect(customerSearchState({ ...service, fulfillment: "DELIVERED" }, "SUCCEEDED", false).message).not.toContain("No search release");
  });
  it("distinguishes an undelivered refunded search and a pending refund", () => {
    expect(customerSearchState(service, "SUCCEEDED", false).message).toContain("No search release was committed");
    expect(customerSearchState(service, "PENDING", true).label).toBe("Refund processing");
    expect(customerSearchState(service, "NONE", true).label).toBe("Delivered");
  });
});

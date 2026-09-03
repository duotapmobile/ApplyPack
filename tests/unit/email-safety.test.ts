import { afterEach, describe, expect, it } from "vitest";
import { safeTransactionalRecipient } from "@/lib/email/safety";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("test-mode email safety", () => {
  it("requires an exact allowlisted recipient in test mode", () => {
    process.env.APP_PAYMENT_MODE = "test";
    process.env.APP_SAFE_TEST_EMAILS = "tester@example.com, second@example.com";
    expect(safeTransactionalRecipient("Tester@example.com")).toBe("Tester@example.com");
    expect(() => safeTransactionalRecipient("customer@example.com")).toThrow(/not allowlisted/i);
  });

  it("does not redirect or rewrite a live recipient", () => {
    process.env.APP_PAYMENT_MODE = "live";
    expect(safeTransactionalRecipient("customer@example.com")).toBe("customer@example.com");
  });
});

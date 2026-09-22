import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isFreshAuthentication, verifiedAuthenticationAt } from "@/lib/materials/server";

const now = new Date("2026-09-22T12:00:00Z");
const current = now.getTime() / 1000;
const customer = "customer-a";
describe("material download authentication freshness", () => {
  it("rejects fresh token issuance and refresh with an old authentication event", () => {
    const authentication = verifiedAuthenticationAt({ sub: customer, iat: current,
      amr: [{ method: "otp", timestamp: current - 3600 }, { method: "token_refresh", timestamp: current }] }, customer);
    expect(isFreshAuthentication(authentication, now)).toBe(false);
  });
  it("accepts a recent verified OTP event for the same customer", () => {
    const authentication = verifiedAuthenticationAt({ sub: customer, amr: [{ method: "otp", timestamp: current - 60 }] }, customer);
    expect(isFreshAuthentication(authentication, now)).toBe(true);
  });
  it.each([
    {}, { sub: customer, iat: current }, { sub: customer, amr: [] },
    { sub: customer, amr: ["otp"] },
    { sub: customer, amr: [{ method: "otp" }] },
    { sub: customer, amr: [{ method: "otp", timestamp: String(current) }] },
    { sub: customer, amr: [{ method: "unknown", timestamp: current }] },
    { sub: customer, amr: [{ method: "token_refresh", timestamp: current }] },
    { sub: "customer-b", amr: [{ method: "otp", timestamp: current }] },
  ])("rejects absent, ambiguous, or mismatched evidence %#", (claims) => {
    expect(verifiedAuthenticationAt(claims, customer)).toBeNull();
  });
  it("rejects future authentication timestamps", () => {
    expect(isFreshAuthentication(verifiedAuthenticationAt({ sub: customer, amr: [{ method: "otp", timestamp: current + 1 }] }, customer), now)).toBe(false);
  });
});

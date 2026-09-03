import { describe, expect, it } from "vitest";
import { normalizeEmailCode, requestOriginIsAllowed, safeAuthDestination } from "@/lib/auth/email-code";

describe("email code authentication", () => {
  it("keeps only six numeric code characters", () => {
    expect(normalizeEmailCode("12 34-5678")).toBe("123456");
  });

  it("allows only local post-authentication destinations", () => {
    expect(safeAuthDestination("/my-applypack?authenticated=1")).toBe("/my-applypack?authenticated=1");
    expect(safeAuthDestination("https://attacker.example/path")).toBe("/get-started");
    expect(safeAuthDestination("//attacker.example/path")).toBe("/get-started");
    expect(safeAuthDestination("/\\attacker.example")).toBe("/get-started");
  });

  it("rejects cross-origin browser submissions", () => {
    const allowed = new Request("https://applypack.work/api/auth/email-code/request", {
      headers: { origin: "https://applypack.work", "sec-fetch-site": "same-origin" },
    });
    const blocked = new Request("https://applypack.work/api/auth/email-code/request", {
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    });
    expect(requestOriginIsAllowed(allowed)).toBe(true);
    expect(requestOriginIsAllowed(blocked)).toBe(false);
  });
});

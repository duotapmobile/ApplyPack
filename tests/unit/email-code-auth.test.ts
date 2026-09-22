import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeEmailCode, requestOriginIsAllowed, safeAuthDestination } from "@/lib/auth/email-code";

describe("email code authentication", () => {
  afterEach(() => vi.unstubAllEnvs());
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

  it("accepts the configured HTTPS origin behind Railway while rejecting forged headers", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://applypack-staging-staging.up.railway.app");
    const internal = "http://0.0.0.0:8080/api/auth/email-code/request";
    expect(requestOriginIsAllowed(new Request(internal, { headers: { origin: "https://applypack-staging-staging.up.railway.app", "sec-fetch-site": "same-origin" } }))).toBe(true);
    expect(requestOriginIsAllowed(new Request(internal, { headers: { origin: "https://attacker.invalid", "x-forwarded-host": "applypack-staging-staging.up.railway.app" } }))).toBe(false);
    expect(requestOriginIsAllowed(new Request(internal))).toBe(false);
    expect(requestOriginIsAllowed(new Request(internal, { headers: { origin: "https://applypack-staging-staging.up.railway.app", "sec-fetch-site": "cross-site" } }))).toBe(false);
  });
});

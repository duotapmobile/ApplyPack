import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const limiter = readFileSync(resolve(process.cwd(), "src/lib/security/rate-limit.ts"), "utf8");
const maintenance = readFileSync(resolve(process.cwd(), "src/app/api/cron/maintenance/route.ts"), "utf8");

describe("rate-limit safety", () => {
  it("uses Railway's trusted client address instead of X-Forwarded-For", () => {
    expect(limiter).toContain('headers.get("x-real-ip")');
    expect(limiter).not.toContain('headers.get("x-forwarded-for")');
  });

  it("enforces independent address and identity buckets", () => {
    expect(limiter).toContain('input.scope + ":ip"');
    expect(limiter).toContain('input.scope + ":identity"');
    expect(limiter).toContain("results.every");
  });

  it("expires old limiter rows during maintenance", () => {
    expect(maintenance).toContain('.from("api_rate_limits")');
    expect(maintenance).toContain("48 * 60 * 60 * 1000");
  });
});

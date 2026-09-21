import { afterEach, describe, expect, it, vi } from "vitest";

describe("staging indexing safety", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("disallows every crawler outside an explicit production deployment", async () => {
    vi.stubEnv("APP_DEPLOYMENT_ENV", "staging");
    const { default: robots } = await import("@/app/robots");

    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("preserves production discovery rules only for the production environment", async () => {
    vi.stubEnv("APP_DEPLOYMENT_ENV", "production");
    const { default: robots } = await import("@/app/robots");

    expect(robots()).toMatchObject({
      rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }],
    });
  });
});

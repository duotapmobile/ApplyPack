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
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://applypack.work");
    const { default: robots } = await import("@/app/robots");

    expect(robots()).toMatchObject({
      rules: [{
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/auth", "/checkout", "/get-started", "/my-applypack", "/sign-in", "/staging"],
      }],
    });
  });

  it.each(["", "https://applypack-staging-staging.up.railway.app", "https://applypack.work.attacker.invalid", "https://name@applypack.work", "https://applypack.work/private"])("does not index a missing or wrong production origin: %s", async (origin) => {
    vi.stubEnv("APP_DEPLOYMENT_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
    const { default: robots } = await import("@/app/robots");
    const { default: sitemap } = await import("@/app/sitemap");
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    expect(sitemap()).toEqual([]);
  });

  it("lists only public production pages without invented modification dates", async () => {
    vi.stubEnv("APP_DEPLOYMENT_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://applypack.work");
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = sitemap();
    expect(entries.some((entry) => entry.url === "https://applypack.work/pricing")).toBe(true);
    expect(entries.every((entry) => entry.lastModified === undefined)).toBe(true);
    expect(entries.some((entry) => /job-board|my-applypack|checkout|admin|sign-in|staging/.test(entry.url))).toBe(false);
  });
});

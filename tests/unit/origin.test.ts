import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOriginRequest } from "@/lib/security/origin";

describe("same-origin request enforcement", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured public origin behind a trusted reverse proxy", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.com");
    const request = new Request("http://internal.railway:8080/api/intake", {
      headers: { origin: "https://staging.example.com" },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("rejects a different origin even when the internal request URL differs", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.com");
    const request = new Request("http://internal.railway:8080/api/intake", {
      headers: { origin: "https://attacker.example" },
    });
    expect(isSameOriginRequest(request)).toBe(false);
  });

  it("falls back to the request URL for local development", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const request = new Request("http://localhost:3000/api/intake", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(isSameOriginRequest(request)).toBe(true);
  });
});

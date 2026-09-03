import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

describe("canonical public host", () => {
  it("permanently redirects only the www host to the apex domain", () => {
    expect(config).toContain('type: "host", value: "www.applypack.work"');
    expect(config).toContain('destination: "https://applypack.work/:path*"');
    expect(config).toContain("permanent: true");
  });

  it("allows local Supabase only in the development CSP branch", () => {
    expect(config).toContain('process.env.NODE_ENV === "production"');
    expect(config).toContain("http://127.0.0.1:54321");
    expect(config).toContain("ws://127.0.0.1:54321");
  });
});

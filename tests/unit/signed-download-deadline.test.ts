import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { signedDownloadWithinDeadline } from "@/lib/materials/signed-download";
const now = Date.parse("2026-10-24T12:00:00Z");
const path = "customer/resume.docx";
const token = (claims: unknown) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
const url = (claims: unknown) => `https://project.supabase.co/storage/v1/object/sign/customer-deliveries/${path}?token=${token(claims)}`;
const input = { supabaseOrigin: "https://project.supabase.co", bucket: "customer-deliveries", path, expiresAt: new Date(now + 900_000).toISOString(), now };
describe("provider signed download absolute deadline", () => {
  it("supports historical and scoped provider tokens at the exact allowed boundary", () => {
    for (const scope of [undefined, "download"]) expect(signedDownloadWithinDeadline({ ...input, signedUrl: url({ exp: (now + 900_000) / 1000, url: `customer-deliveries/${path}`, scope }) })).toBe(true);
  });
  it.each([
    { exp: (now + 901_000) / 1000 }, { exp: now / 1000 }, { exp: "1792844100" }, { exp: null },
    { exp: (now + 500) / 1000 }, { url: "customer-deliveries/other-customer/resume.docx" }, { scope: "upload" },
  ])("rejects late, expired, malformed or wrong-object tokens (%j)", (patch) => {
    expect(signedDownloadWithinDeadline({ ...input, signedUrl: url({ exp: (now + 60_000) / 1000, url: `customer-deliveries/${path}`, ...patch }) })).toBe(false);
  });
  it.each(["https://other.example/", "https://project.supabase.co/storage/v1/object/sign/customer-deliveries/customer/resume.docx", "https://project.supabase.co/storage/v1/object/sign/customer-deliveries/customer/resume.docx?token=invalid"])("refuses unverified origin/shape/absent token", (signedUrl) => {
    expect(signedDownloadWithinDeadline({ ...input, signedUrl })).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createDraftCapability, draftCookieSettings, draftSecretMatches, hashDraftSecret, parseDraftCapability, serializeDraftCapability } from "@/lib/security/draft-capability";

describe("anonymous draft capability", () => {
  it("uses a separate high-entropy capability and stores only its hash", () => {
    const capability = createDraftCapability();
    expect(capability.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(capability.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(capability.secretHash).not.toContain(capability.secret);
    expect(draftSecretMatches(capability.secret, capability.secretHash)).toBe(true);
    expect(draftSecretMatches(createDraftCapability().secret, capability.secretHash)).toBe(false);
    expect(parseDraftCapability(serializeDraftCapability(capability))).toEqual({ draftId: capability.draftId, secret: capability.secret });
  });

  it("denies malformed/guessed capabilities and fails closed without configured lifetime", () => {
    expect(parseDraftCapability("guessed-id")).toBeNull();
    expect(() => hashDraftSecret("short")).toThrow("invalid_draft_secret");
    expect(draftCookieSettings({ NODE_ENV: "production" })).toBeNull();
  });

  it("sets an HttpOnly Secure host cookie in production", () => {
    expect(draftCookieSettings({ NODE_ENV: "production", APP_ANONYMOUS_DRAFT_SESSION_SECONDS: "3600" })).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", name: "__Host-applypack_draft", maxAge: 3600 });
  });
});

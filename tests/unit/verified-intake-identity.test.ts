import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ server: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: boundary.server }));
import { ownedIntakeList, ownedIntakeMetadata, verifiedIntakeIdentity } from "@/lib/intake/verified-intake-server";
import { privateIntakeRequest } from "@/lib/intake/private-request";
const user = { id: "51000000-0000-4000-8000-000000000001", email: "Current@Example.invalid", email_confirmed_at: "2026-10-26T00:00:00Z", is_anonymous: false };
const identity = { customerId: user.id, verifiedEmail: "current@example.invalid" };
const now = Date.parse("2026-10-26T00:00:00Z");
const receipt = { rootDraftId: user.id, draftId: user.id, state: "IN_PROGRESS", version: 2, capabilityVersion: 1,
  accessEmail: "original@example.invalid", verifiedEmail: identity.verifiedEmail, expiresAt: "2026-11-01T00:00:00Z",
  createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T01:00:00Z", questionPending: false, reviewRequired: true, claimed: true, replayed: false };
beforeEach(() => vi.resetAllMocks()); afterEach(() => vi.unstubAllGlobals());
describe("verified intake authority", () => {
  it.each([null, { ...user, email_confirmed_at: null }, { ...user, is_anonymous: true }, { ...user, email: "invalid" }, { ...user, id: "other" }])("rejects an unverified or invalid account %j", async account => {
    boundary.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: account }, error: null }) } });
    expect(await verifiedIntakeIdentity()).toBeNull();
  });
  it("uses provider-verified identity and normalizes only the current account email", async () => {
    boundary.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user }, error: null }) } });
    expect(await verifiedIntakeIdentity()).toEqual({ customerId: user.id, verifiedEmail: "current@example.invalid" });
  });
  it("keeps immutable access email distinct from the account's verified current email", () => {
    expect(ownedIntakeMetadata(receipt, identity, false, now).summary).toMatchObject({ accessEmail: "original@example.invalid", verifiedEmail: identity.verifiedEmail });
    expect(ownedIntakeMetadata({ ...receipt, state: "LOCKED_TO_CHECKOUT" }, identity, true, now).summary.state).toBe("LOCKED_TO_CHECKOUT");
  });
  it.each([{ ...receipt, claimed: false }, { ...receipt, verifiedEmail: "other@example.invalid" }, { ...receipt, secret: "private" },
    { ...receipt, expiresAt: "2026-10-25T00:00:00Z" }, { ...receipt, state: "LOCKED_TO_CHECKOUT" }, { ...receipt, accessEmail: "Original@Example.invalid" }, { ...receipt, capabilityVersion: 0 }])("rejects unusable or unexpected ownership metadata %j", invalid => {
    expect(() => ownedIntakeMetadata(invalid, identity, false, now)).toThrow();
  });
  it("bounds owned selection lists and rejects duplicate family identities", () => {
    const item = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "replayed"));
    expect(ownedIntakeList([item], identity, now)).toHaveLength(1);
    expect(() => ownedIntakeList([item, item], identity, now)).toThrow();
    expect(() => ownedIntakeList(Array.from({ length: 21 }, () => item), identity, now)).toThrow();
  });
  it("binds every private request to the tab's selected public draft ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response()); vi.stubGlobal("fetch", fetchMock);
    await privateIntakeRequest(user.id, "/api/intake/anonymous-draft/document", { method: "POST", headers: { "x-applypack-draft-id": "untrusted", "content-type": "application/json" }, body: "{}" });
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("x-applypack-draft-id")).toBe(user.id); expect(headers.get("content-type")).toBe("application/json");
  });
  it.each(["https://other.example/api/intake/anonymous-draft", "//other.example", "/api/intake/anonymous-draft-other", "/api/intake/access", "/api/intake/anonymous-draft\\other"])("does not send private selection to an unapproved path %s", async path => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(() => privateIntakeRequest(user.id, path)).toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses private access without an explicit selected draft", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(() => privateIntakeRequest("", "/api/intake/anonymous-draft")).toThrow(); expect(fetchMock).not.toHaveBeenCalled();
  });
});

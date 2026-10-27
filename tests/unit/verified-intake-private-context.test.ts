import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ cookie: "", selectedId: null as string | null, rpc: vi.fn(), storage: vi.fn(), server: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: boundary.cookie }) }),
  headers: async () => new Headers(boundary.selectedId ? { "x-applypack-draft-id": boundary.selectedId } : {}) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: boundary.rpc, storage: { from: boundary.storage } }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: boundary.server }));
import { GET as readDraft, PUT as saveDraft, POST as oldCreate } from "@/app/api/intake/anonymous-draft/route";
import { POST as upload } from "@/app/api/intake/anonymous-draft/document/route";
import { createDraftCapability, serializeDraftCapability } from "@/lib/security/draft-capability";
const origin = "https://intake.example.invalid";
const post = () => new Request(`${origin}/api/intake/anonymous-draft`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("APP_ANONYMOUS_DRAFT_SESSION_SECONDS", "86400"); boundary.cookie = serializeDraftCapability(createDraftCapability()); boundary.selectedId = null; });
afterEach(() => vi.unstubAllEnvs());
describe("private intake selection fence", () => {
  it.each([null, { id: "71000000-0000-4000-8000-000000000001", email: "unverified@example.invalid", email_confirmed_at: null },
    { id: "71000000-0000-4000-8000-000000000001", email: "anonymous@example.invalid", email_confirmed_at: "2026-10-26T12:00:00Z", is_anonymous: true }])("denies a valid selected capability without a verified account (%#)", async user => {
    boundary.selectedId = boundary.cookie.split(".")[0]; boundary.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user }, error: null }) } });
    expect(await (await readDraft()).json()).toEqual({ draft: null }); expect((await saveDraft(post())).status).toBe(404); expect((await upload(post())).status).toBe(404);
    expect(boundary.rpc).not.toHaveBeenCalled(); expect(boundary.storage).not.toHaveBeenCalled();
  });
  it("denies the selected cookie when the actual ownership RPC rejects another verified account", async () => {
    boundary.selectedId = boundary.cookie.split(".")[0]; boundary.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "71000000-0000-4000-8000-000000000001", email: "other@example.invalid", email_confirmed_at: "2026-10-26T12:00:00Z", is_anonymous: false } }, error: null }) } });
    boundary.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: { message: "owned_intake_unavailable" } }) });
    expect(await (await readDraft()).json()).toEqual({ draft: null }); expect((await saveDraft(post())).status).toBe(404); expect((await upload(post())).status).toBe(404);
    expect(boundary.rpc.mock.calls.every(([name]) => name === "ap_owned_intake_draft_context")).toBe(true); expect(boundary.storage).not.toHaveBeenCalled();
  });
  it.each([null, "invalid", "71000000-0000-4000-8000-000000000001"])("does not read, write or upload with a missing/different selected intake %s", async selected => {
    boundary.selectedId = selected;
    expect(await (await readDraft()).json()).toEqual({ draft: null });
    expect((await saveDraft(post())).status).toBe(404);
    expect((await upload(post())).status).toBe(404);
    expect(boundary.rpc).not.toHaveBeenCalled(); expect(boundary.storage).not.toHaveBeenCalled();
  });
  it("closes the old automatic unowned creation endpoint without issuing a cookie", async () => {
    const response = await oldCreate(post()); expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "VERIFIED_INTAKE_REQUIRED" });
    expect(response.headers.has("set-cookie")).toBe(false); expect(boundary.rpc).not.toHaveBeenCalled();
  });
});

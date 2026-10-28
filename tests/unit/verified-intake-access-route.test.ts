import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ cookie: "", user: null as unknown, rpc: vi.fn(), hold: vi.fn(), rate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: boundary.cookie }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: boundary.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: boundary.user }, error: null }) } }) }));
vi.mock("@/lib/operations/protected-recovery-readiness", () => ({ newIntakeRecoveryHold: boundary.hold }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: boundary.rate }));
import { GET, POST } from "@/app/api/intake/access/route";
import { createDraftCapability, hashDraftSecret, parseDraftCapability, serializeDraftCapability } from "@/lib/security/draft-capability";
const id = (n: number) => `b1030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://intake.example.invalid", email = "owner@example.invalid";
const post = (body: unknown, requestOrigin = origin) => new Request(`${origin}/api/intake/access`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(body) });
const start = { action: "START", requestId: id(2), expectedBrowserDraftId: null };
function database() {
  const state = { draftId: id(3), rootId: id(3), hash: "", version: 1, capVersion: 1, current: false, error: null as unknown, receipt: undefined as unknown, lose: false, replay: false };
  const metadata = () => ({ rootDraftId: state.rootId, draftId: state.draftId, version: state.version, capabilityVersion: state.capVersion,
    state: "IN_PROGRESS", expiresAt: new Date(Date.now() + 86400_000).toISOString(), createdAt: "2026-10-26T12:00:00Z", updatedAt: "2026-10-26T12:00:00Z",
    accessEmail: email, verifiedEmail: email, questionPending: false, reviewRequired: false, claimed: true, replayed: state.replay });
  // Stable expiry is necessary for post-write exact receipt verification.
  const expiresAt = metadata().expiresAt;
  const receipt = () => ({ ...metadata(), expiresAt });
  boundary.rpc.mockImplementation((name: string, args: Record<string, unknown>) => ({ abortSignal: async () => {
    if (name === "ap_owned_intake_draft_context") return state.current && args.p_draft_id === state.draftId && args.p_secret_hash === state.hash
      ? { data: receipt(), error: null } : { data: null, error: { message: "owned_intake_unavailable" } };
    if (name === "ap_owned_intake_drafts") { const { replayed: _, ...listed } = receipt(); void _; return { data: [listed], error: null }; }
    if (state.error) return { data: null, error: state.error };
    if (!state.replay) { state.draftId = String(args.p_draft_id ?? args.p_expected_draft_id); state.rootId = String(args.p_root_draft_id ?? state.draftId); state.hash = String(args.p_secret_hash); state.current = true; if (name === "ap_resume_owned_intake_draft") state.capVersion++; }
    if (state.lose) throw new Error("lost after commit");
    return { data: state.receipt === undefined ? receipt() : state.receipt, error: null };
  } }));
  return { state, receipt };
}
beforeEach(() => { vi.resetAllMocks(); boundary.cookie = ""; boundary.user = { id: id(1), email, email_confirmed_at: "2026-10-26T12:00:00Z", is_anonymous: false };
  boundary.rate.mockResolvedValue({ configured: true, allowed: true }); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("APP_ANONYMOUS_DRAFT_SESSION_SECONDS", "2592000"); });
afterEach(() => vi.unstubAllEnvs());
describe("verified intake access HTTP", () => {
  it.each([null, { id: id(1), email }, { id: id(1), email, email_confirmed_at: "2026-10-26T12:00:00Z", is_anonymous: true }])("requires a verified account before list/create/cookie access (%#)", async user => {
    database(); boundary.user = user; expect((await GET()).status).toBe(401); const response = await POST(post(start)); expect(response.status).toBe(401);
    expect(boundary.rpc).not.toHaveBeenCalled(); expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("creates and verifies one bound draft before issuing a bounded HttpOnly capability", async () => {
    const db = database(), response = await POST(post(start)); expect(response.status).toBe(200);
    const raw = response.headers.get("set-cookie")!, cap = parseDraftCapability(decodeURIComponent(raw.split(";", 1)[0].split("=").slice(1).join("=")))!;
    expect(await response.json()).toEqual({ state: "OPENED", draftId: cap.draftId }); expect(hashDraftSecret(cap.secret)).toBe(db.state.hash);
    expect(raw).toContain("HttpOnly"); expect(Number(/Max-Age=(\d+)/.exec(raw)![1])).toBeLessThanOrEqual(86400);
    const args = boundary.rpc.mock.calls.find(([name]) => name === "ap_create_owned_intake_draft")![1];
    expect(Date.parse(args.p_expires_at) - Date.now()).toBeLessThanOrEqual(7 * 86400_000);
    expect(args).toMatchObject({ p_customer_id: id(1), p_verified_email: email, p_request_id: id(2) });
  });
  it("recovers a lost create response through explicit selection without issuing the wrong new secret", async () => {
    const db = database(); db.state.lose = true;
    const lost = await POST(post(start)); expect(lost.status).toBe(503); expect(lost.headers.has("set-cookie")).toBe(false);
    db.state.lose = false; db.state.replay = true;
    const retry = await POST(post(start)); expect(await retry.json()).toEqual({ state: "RESUME_REQUIRED", rootDraftId: db.state.rootId }); expect(retry.headers.has("set-cookie")).toBe(false);
  });
  it("lists saved owned intakes without selecting or issuing access", async () => {
    database(); const response = await GET(); expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.json()).toMatchObject({ current: null, browserDraftId: null, claimAvailable: false, drafts: [{ draftId: id(3) }] });
  });
  it("rejects tab selection changes and unacknowledged replacement of sole browser access", async () => {
    database(); const cap = createDraftCapability(); boundary.cookie = serializeDraftCapability(cap);
    expect((await POST(post(start))).status).toBe(409);
    expect((await POST(post({ ...start, expectedBrowserDraftId: cap.draftId }))).status).toBe(409);
    expect(boundary.rpc.mock.calls.every(([name]) => name === "ap_owned_intake_draft_context")).toBe(true);
    const response = await POST(post({ ...start, expectedBrowserDraftId: cap.draftId, replaceUnlinkedBrowserIntake: true })); expect(response.status).toBe(200);
  });
  it("does not disclose account mismatch details or replace a cookie after claim rejection", async () => {
    const db = database(), cap = createDraftCapability(); boundary.cookie = serializeDraftCapability(cap); db.state.error = { message: "owned_intake_access_identity_mismatch secret old@example.invalid" };
    const response = await POST(post({ action: "CLAIM", expectedBrowserDraftId: cap.draftId })); expect(response.status).toBe(409); expect(response.headers.has("set-cookie")).toBe(false); expect(await response.text()).not.toContain("old@example.invalid");
  });
  it("requires explicit leaf selection after claiming from an immutable source cookie", async () => {
    const db = database(), cap = createDraftCapability(); boundary.cookie = serializeDraftCapability(cap); db.state.replay = true;
    const response = await POST(post({ action: "CLAIM", expectedBrowserDraftId: cap.draftId }));
    expect(await response.json()).toEqual({ state: "RESUME_REQUIRED", rootDraftId: db.state.rootId }); expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("holds access mutations when recovery is stale", async () => {
    database(); boundary.hold.mockResolvedValue(Response.json({ code: "PROTECTED_RECOVERY_NOT_READY" }, { status: 503 }));
    const response = await POST(post(start)); expect(response.status).toBe(503); expect(response.headers.has("set-cookie")).toBe(false); expect(boundary.rpc).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and supplied authority before database access", async () => {
    database(); expect((await POST(post(start, "https://other.invalid"))).status).toBe(403);
    expect((await POST(post({ ...start, customerId: id(9) }))).status).toBe(400); expect(boundary.rpc).not.toHaveBeenCalled();
  });
  it.each([null, {}, { claimed: true, draftId: id(3) }])("issues no cookie for an incomplete mutation receipt (%#)", async receipt => {
    const db = database(); db.state.receipt = receipt; const response = await POST(post(start)); expect(response.status).toBe(503); expect(response.headers.has("set-cookie")).toBe(false);
  });
});

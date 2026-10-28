// Actual HTTP handlers, identity selection, capability derivation and receipt
// verification; DB responses are controlled here. Native journey covers SQL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundaries = vi.hoisted(() => ({ anonymous: vi.fn(), admin: vi.fn(), server: vi.fn(), recoveryHold: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/drafts/anonymous-server", () => ({ anonymousDraftContext: boundaries.anonymous }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: boundaries.admin }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: boundaries.server }));
vi.mock("@/lib/operations/protected-recovery-readiness", () => ({ newIntakeRecoveryHold: boundaries.recoveryHold }));
import { GET, POST } from "@/app/api/intake/anonymous-draft/questions/route";
import { GET as customerGet, POST as customerPost } from "@/app/api/customer/candidate-questions/route";
import { createDraftCapability, draftCookieSettings, hashDraftSecret, parseDraftCapability } from "@/lib/security/draft-capability";
const id = (n: number) => `a1010000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://applypack.example", questionId = id(1), customerId = id(2);
const answer = "I answered customer calls and booked appointments in a paper calendar.";
const input = { questionId, answer, confirmed: true };
const post = (body: unknown = input, requestOrigin: string = origin, extra: Record<string, string> = {}) => new Request(`${origin}/api/intake/anonymous-draft/questions`, {
  method: "POST", headers: { origin: requestOrigin, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body),
});
type Result = { data: unknown; error: unknown };
function database() {
  const original = createDraftCapability();
  const state = { child: null as string | null, hash: "", answer, mode: "CONFIRMED_INTAKE", questions: [{ id: questionId, prompt: "Which tools did you personally use?", answered: false, review_required: false }],
    expires: new Date(Date.now() + 30 * 60_000).toISOString(), savedError: false, receipt: null as unknown, writeError: null as unknown, contextError: null as unknown, loseWriteResponse: false };
  const read = vi.fn(async (columns: string): Promise<Result> => state.savedError ? { data: null, error: { message: "private storage failure" } } : { data: columns === "answers"
    ? { answers: { clarifications: [{ questionId, prompt: "Which tools did you personally use?", answer: state.answer }] } }
    : { id: state.child, version: 2, capability_secret_hash: state.hash, expires_at: state.expires, state: "IN_PROGRESS", retention_state: "ACTIVE" }, error: null });
  const from = vi.fn(() => { let columns = ""; const query = { select: (value: string) => { columns = value; return query; }, eq: vi.fn(() => query), gt: vi.fn(() => query),
    abortSignal: vi.fn(() => query), maybeSingle: () => read(columns) }; return query; });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => ({ abortSignal: async (): Promise<Result> => {
    if (name === "ap_material_clarification_questions") return { data: state.questions, error: null };
    if (name === "ap_material_clarification_answer_context") return { data: { mode: state.mode, sourceDraftId: original.draftId, successorDraftId: state.child }, error: state.contextError };
    if (!["ap_answer_material_clarification", "ap_resume_material_clarification"].includes(name)) throw new Error("unexpected RPC");
    if (state.writeError) return { data: null, error: state.writeError };
    const replayed = state.child !== null;
    state.child ??= String(args.p_successor_draft_id); state.hash = String(args.p_successor_secret_hash);
    state.questions[0].answered = true; state.questions[0].review_required = true;
    if (state.loseWriteResponse) throw new Error("connection closed after write");
    return { data: state.receipt ?? { state: "FULL_REVIEW_REQUIRED", draftId: state.child, version: 2, expiresAt: state.expires, replayed }, error: null };
  } }));
  const admin = { rpc, from };
  boundaries.anonymous.mockResolvedValue({ admin, capability: original, settings: draftCookieSettings(), secretHash: original.secretHash });
  boundaries.admin.mockReturnValue(admin);
  boundaries.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: customerId, email: "fictional@example.invalid", email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false } }, error: null }) } });
  return { original, state, read, from, rpc };
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("APP_ANONYMOUS_DRAFT_SESSION_SECONDS", "3600"); vi.stubEnv("NODE_ENV", "production"); });
afterEach(() => vi.unstubAllEnvs());
function cookie(response: Response) {
  const raw = response.headers.get("set-cookie")!;
  const value = raw.split(";", 1)[0].split("=").slice(1).join("=");
  return { raw, parsed: parseDraftCapability(decodeURIComponent(value))! };
}
describe("connected clarification HTTP boundary", () => {
  it("sets only a verified, bounded HttpOnly successor capability and keeps it out of JSON", async () => {
    const db = database(), response = await POST(post()), body = await response.json(), saved = cookie(response);
    expect(response.status).toBe(201); expect(body.state).toBe("FULL_REVIEW_REQUIRED");
    expect(saved.parsed.draftId).toBe(body.draftId); expect(saved.parsed.secret).not.toBe(db.original.secret);
    expect(hashDraftSecret(saved.parsed.secret)).toBe(db.state.hash);
    expect(saved.raw).toContain("__Host-applypack_draft="); expect(saved.raw).toContain("HttpOnly"); expect(saved.raw).toContain("Secure"); expect(saved.raw).toContain("SameSite=lax");
    expect(Number(/Max-Age=(\d+)/u.exec(saved.raw)![1])).toBeLessThanOrEqual(1800);
    expect(JSON.stringify(body)).not.toContain(saved.parsed.secret); expect(JSON.stringify(body)).not.toContain(db.state.hash);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("recovers a lost response without resubmitting or overwriting the original answer", async () => {
    const db = database(); db.state.loseWriteResponse = true;
    const lost = await POST(post()); expect(lost.status).toBe(503); expect(lost.headers.has("set-cookie")).toBe(false);
    expect((await lost.json()).code).toBe("SAVE_UNCERTAIN");
    expect((await (await GET()).json()).questions[0]).toMatchObject({ answered: true, review_required: true });
    db.state.loseWriteResponse = false;
    const recovered = await POST(post({ action: "RESUME", questionId }));
    expect(recovered.status).toBe(200); const saved = cookie(recovered);
    expect(saved.parsed.draftId).toBe(db.state.child);
    const writes = db.rpc.mock.calls.filter(([name]) => ["ap_answer_material_clarification", "ap_resume_material_clarification"].includes(name));
    expect(writes).toHaveLength(2); expect(writes[1][0]).toBe("ap_resume_material_clarification"); expect(writes[1][1]).not.toHaveProperty("p_answer");
    expect(writes[1][1].p_successor_secret_hash).toBe(writes[0][1].p_successor_secret_hash);
  });
  it("requires explicit owned selection to recover access and never replaces another browser intake", async () => {
    const db = database(); db.state.child = id(3);
    const rejected = await customerPost(post({ action: "RESUME", questionId }));
    expect(rejected.status).toBe(409); expect(rejected.headers.has("set-cookie")).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
    const response = await customerPost(post());
    expect(response.status).toBe(200); expect(response.headers.has("set-cookie")).toBe(false);
    expect(boundaries.anonymous).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.filter(([name]) => name.includes("context") || name === "ap_answer_material_clarification").every(([, args]) => args.p_customer_id === customerId && args.p_draft_id === null && args.p_secret_hash === null)).toBe(true);
  });
  it("keeps supported historical answers separate from complete-review capability transfer", async () => {
    const db = database(); db.state.mode = "LEGACY"; db.state.receipt = { state: "LEGACY_EVIDENCE_RECORDED", factId: id(9) };
    const response = await customerPost(post()); expect(response.status).toBe(201);
    expect(response.headers.has("set-cookie")).toBe(false); expect(await response.json()).toEqual(db.state.receipt);
  });
  it.each([POST, customerPost])("rejects another origin before identity or database access", async handler => {
    const db = database(); expect((await handler(post(input, "https://other.example"))).status).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled(); expect(boundaries.server).not.toHaveBeenCalled(); expect(boundaries.anonymous).not.toHaveBeenCalled();
  });
  it.each([{ ...input, customerId }, { ...input, draftId: id(3) }, { ...input, confirmed: false }, { ...input, answer: " " }, { action: "RESUME", questionId, answer: "new unsupported answer" }])("rejects unconfirmed or browser-supplied authority %j", async body => {
    const db = database(); expect((await POST(post(body))).status).toBe(400); expect((await customerPost(post(body))).status).toBe(400); expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated customers and missing anonymous access", async () => {
    const db = database(); boundaries.server.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } });
    boundaries.anonymous.mockResolvedValue(null);
    expect((await customerPost(post())).status).toBe(401); expect((await customerGet()).status).toBe(401);
    expect((await POST(post())).status).toBe(404); expect((await GET()).status).toBe(404); expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each(["question_owner_or_version_invalid", "clarification_paid_or_checkout_owner_exception", "clarification_answer_already_saved_edit_review"])("rejects locked write %s without issuing access", async message => {
    const db = database(); db.state.writeError = { message };
    const response = await POST(post()); expect(response.status).toBe(409); expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("does not read saved answers when authenticated question ownership fails", async () => {
    const db = database(); db.state.contextError = { message: "question_owner_or_version_invalid" }; db.state.child = id(3);
    const response = await POST(post({ action: "RESUME", questionId })); expect(response.status).toBe(409);
    expect(db.from).not.toHaveBeenCalled(); expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([POST, customerPost])("holds new answers and capability recovery when protected recovery is stale", async handler => {
    const db = database(); boundaries.recoveryHold.mockResolvedValue(Response.json({ code: "PROTECTED_RECOVERY_NOT_READY" }, { status: 503 }));
    const response = await handler(post()); expect(response.status).toBe(503); expect(response.headers.has("set-cookie")).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled(); expect(db.from).not.toHaveBeenCalled();
  });
  it.each([null, { state: "REVIEW_REQUIRED", factId: id(9) }, { state: "FULL_REVIEW_REQUIRED", draftId: id(3), version: 2, expiresAt: "2020-01-01T00:00:00Z", replayed: false }])("fails closed on unusable write receipt %j", async bad => {
    const db = database(); db.state.receipt = bad ?? { invalid: true };
    const response = await POST(post()); expect(response.status).toBe(503); expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("does not issue a capability after an incomplete post-write verification", async () => {
    const db = database(); db.state.savedError = true;
    const response = await POST(post()); expect(response.status).toBe(503); expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.text()).not.toContain("private storage failure");
  });
  it("fails closed on duplicated question identities and malformed answer flags", async () => {
    const db = database(); db.state.questions.push({ ...db.state.questions[0] });
    expect((await GET()).status).toBe(503);
    db.state.questions = [{ ...db.state.questions[0], answered: "yes" as unknown as boolean }]; expect((await customerGet()).status).toBe(503);
  });
  it("requires a saved successor and lets the locked resume preserve later review edits", async () => {
    const db = database(); expect((await POST(post({ action: "RESUME", questionId }))).status).toBe(409);
    db.state.child = id(3); db.state.answer = "Changed during complete review"; expect((await POST(post({ action: "RESUME", questionId }))).status).toBe(200);
    expect(db.rpc.mock.calls.some(([name]) => name === "ap_answer_material_clarification")).toBe(false);
    expect(db.read.mock.calls.some(([columns]) => columns === "answers")).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ admin: { from: vi.fn() }, user: { id: "customer", email: "customer@example.test" } as { id: string; email: string } | null }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => state.admin }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: (request: Request) => request.headers.get("origin") === "https://applypack.work" }));
import { GET, PUT } from "@/app/api/intake/draft/route";

const sha = "a".repeat(40);
const now = Date.parse("2026-10-23T22:00:00.000Z");
function setup(ready: boolean) {
  const row = { id: "draft", current_step: 1, answers: { experience: "Private customer facts" }, resume_document: null, cover_letter_document: null };
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    upsert: vi.fn(), single: vi.fn().mockResolvedValue({ data: row, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.upsert.mockReturnValue(query);
  const start = new Date(now - 60_000).toISOString();
  const checkpoint = { last_succeeded_at: start, summary: {
    schemaVersion: "applypack-protected-recovery-checkpoint-v1", sourceEnvironment: "production", sourceProjectRef: "spjaaxndiduhrcleazwb",
    releaseSha: sha, sourceStartedAt: start, completedAt: new Date(now - 30_000).toISOString(),
    inventoryDigest: "b".repeat(64), manifestSha256: "c".repeat(64), manifestVersionId: "version-1", objectCount: 0, referenceCount: 0, tombstoneCount: 0,
  } };
  const retention = { last_succeeded_at: start, summary: {
    schemaVersion: "applypack-protected-recovery-retention-v1", sourceEnvironment: "production", sourceProjectRef: "spjaaxndiduhrcleazwb",
    releaseSha: sha, sourceStartedAt: start, completedAt: new Date(now - 30_000).toISOString(),
    inventoryDigest: "b".repeat(64), planSha256: "c".repeat(64), providerVerificationSha256: "d".repeat(64),
    deletedVersionCount: 0, retainedVersionCount: 0,
  } };
  const heartbeat = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn()
    .mockResolvedValueOnce({ data: ready ? checkpoint : null, error: null }).mockResolvedValue({ data: retention, error: null }) };
  heartbeat.select.mockReturnValue(heartbeat); heartbeat.eq.mockReturnValue(heartbeat);
  state.admin.from.mockImplementation((name) => name === "operational_heartbeats" ? heartbeat : query);
  return query;
}
function request(origin = "https://applypack.work") {
  return new Request("https://applypack.work/api/intake/draft", { method: "PUT", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ currentStep: 1, answers: { experience: "Private customer facts" } }) });
}
describe("new intake recovery hold", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); state.admin.from.mockReset();
    state.user = { id: "customer", email: "customer@example.test" };
    vi.stubEnv("APP_DEPLOYMENT_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://applypack.work");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://spjaaxndiduhrcleazwb.supabase.co");
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", sha); vi.stubEnv("APP_EXPECTED_RELEASE_SHA", sha);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it("refuses a valid new save before any intake write when recovery is unverified", async () => {
    const query = setup(false); const response = await PUT(request());
    expect(response.status).toBe(503); expect(query.upsert).not.toHaveBeenCalled();
    expect(state.admin.from.mock.calls).toEqual([["operational_heartbeats"], ["operational_heartbeats"]]);
    expect(await response.text()).not.toContain("Private customer facts");
  });
  it("retains authenticated existing draft access during the hold", async () => {
    const query = setup(false); const response = await GET();
    expect(response.status).toBe(200); expect((await response.json()).draft.answers.experience).toBe("Private customer facts");
    expect(query.upsert).not.toHaveBeenCalled(); expect(state.admin.from.mock.calls).toEqual([["intake_drafts"]]);
  });
  it("permits a valid save with a fresh verified archive checkpoint", async () => {
    const query = setup(true); const response = await PUT(request());
    expect(response.status).toBe(200); expect(query.upsert).toHaveBeenCalledTimes(1);
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ customer_id: "customer" }), { onConflict: "customer_id" });
  });
  it("keeps origin and account authentication ahead of the recovery lookup", async () => {
    setup(true); expect((await PUT(request("https://attacker.example"))).status).toBe(403);
    state.user = null; expect((await PUT(request())).status).toBe(401); expect(state.admin.from).not.toHaveBeenCalled();
  });
});

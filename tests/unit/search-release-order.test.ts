// Actual release handler and source freshness verifier; database/selection
// boundaries are fictional. The native journey separately proves their SQL.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), select: vi.fn(), member: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: boundary.auth }));
vi.mock("@/lib/matching/persisted-runtime", () => ({ loadPersistedEvaluationsForOrder: boundary.load,
  selectAndPersistEvaluations: boundary.select, exactTenReleaseMember: boundary.member }));
import { POST } from "@/app/api/admin/search-orders/[id]/deliver/route";
const id = (n: number) => `a1150000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://applypack.example", orderId = id(1), serviceId = id(2), ownerId = id(3), runId = id(4);
const rpc = vi.fn();
let selected: Array<{ id: string; selection: { runId: string }; job_snapshot: {
  discovery_source: string; company: string; canonical_application_url: string;
  source_authorization: { id: string }; current_source_authorization: { id: string; state: string };
  listing_activity_result: string; application_path_result: string; live_verified_at: string;
} }>;
function request(evaluationIds: string[]) {
  return new Request(`${origin}/api/admin/search-orders/${orderId}/deliver`, { method: "POST",
    headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ evaluationIds,
      reviewChecklist: { criteriaCompared: true, allListingsRechecked: true, exactlyTenApplicationWorthy: true,
        noPadding: true, humanReleaseApproved: true, reviewerNote: "Every current listing was compared against the exact confirmed criteria." } }) });
}
const execute = (ids: string[]) => POST(request(ids), { params: Promise.resolve({ id: orderId }) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("APP_RELEASE_VERIFICATION_TTL_SECONDS", "3600");
  selected = Array.from({ length: 10 }, (_, index) => ({ id: id(index + 10), selection: { runId }, job_snapshot: {
    discovery_source: "fictional-permitted", company: `Fictional Company ${index}`, canonical_application_url: `https://employer.example/${index}`,
    source_authorization: { id: id(5) }, current_source_authorization: { id: id(5), state: "AUTHORIZED_AUTOMATED" },
    listing_activity_result: "PASS", application_path_result: "PASS", live_verified_at: new Date(Date.now() - 1000).toISOString(),
  } }));
  boundary.load.mockResolvedValue(selected); boundary.select.mockImplementation(async () => ({ selected }));
  boundary.member.mockImplementation((evaluation: { id: string }, position: number) => ({ evaluationId: evaluation.id, jobId: evaluation.id, position }));
  rpc.mockResolvedValue({ data: id(6), error: null });
  boundary.auth.mockResolvedValue({ ok: true, user: { id: ownerId }, admin: { rpc, from: (table: string) => {
    const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
    if (table === "orders") chain.maybeSingle.mockResolvedValue({ data: { id: orderId, customer_id: ownerId, product_kind: "job_search", status: "in_fulfillment" }, error: null });
    else if (table === "ap_search_services") chain.maybeSingle.mockResolvedValue({ data: { id: serviceId, fulfillment: "PENDING", refund_started_at: null }, error: null });
    else throw new Error("unexpected table");
    return chain;
  } } });
});
afterEach(() => vi.unstubAllEnvs());
it("accepts a reversed valid set but commits only canonical persisted positions", async () => {
  expect((await execute(selected.map(row => row.id).reverse())).status).toBe(200);
  expect(rpc).toHaveBeenCalledOnce();
  expect(rpc).toHaveBeenCalledWith("ap_commit_exact_ten_release", expect.objectContaining({ p_selection_run_id: runId,
    p_members: selected.map((row, index) => ({ evaluationId: row.id, jobId: row.id, position: index + 1 })) }));
});
it.each(["foreign", "missing", "duplicate"])("rejects %s evaluation IDs before release", async (kind) => {
  const ids = selected.map(row => row.id);
  if (kind === "foreign") ids[0] = id(99);
  if (kind === "missing") ids.pop();
  if (kind === "duplicate") ids[0] = ids[1];
  expect((await execute(ids)).status).toBe(kind === "foreign" ? 409 : 400);
  expect(rpc).not.toHaveBeenCalled();
});
it.each(["expired", "revoked", "superseded", "inactive", "unactionable"])("keeps the real %s source verification guard", async (kind) => {
  const job = selected[0].job_snapshot;
  if (kind === "expired") job.live_verified_at = new Date(Date.now() - 3601_000).toISOString();
  if (kind === "revoked") job.current_source_authorization.state = "REVOKED";
  if (kind === "superseded") job.current_source_authorization.id = id(99);
  if (kind === "inactive") job.listing_activity_result = "FAIL";
  if (kind === "unactionable") job.application_path_result = "FAIL";
  expect((await execute(selected.map(row => row.id).reverse())).status).toBe(409);
  expect(rpc).not.toHaveBeenCalled();
});
it("fails closed when current persisted evaluation loading fails", async () => {
  boundary.load.mockRejectedValue(new Error("current evidence unavailable"));
  expect((await execute(selected.map(row => row.id))).status).toBe(502); expect(rpc).not.toHaveBeenCalled();
});

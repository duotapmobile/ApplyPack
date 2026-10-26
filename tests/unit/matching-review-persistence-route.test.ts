import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
import { POST } from "@/app/api/admin/matching-reviews/route";

const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://applypack.work";
const common = { snapshotId: id(1), jobSnapshotId: id(2), reviewKind: "MATCH_EVIDENCE", disposition: "RESOLVED_FAIL",
  sourceEvidenceNodeIds: [id(3)], candidateFactIds: [id(4)], candidateFactVersionIds: [id(4)], stableCriterionId: id(5),
  evidenceRelation: "DIRECT", evidenceChanges: ["Compared the exact confirmed fictional facts."],
  rationale: "The confirmed evidence does not establish the required duration." };
const request = (body: unknown) => new Request(`${origin}/api/admin/matching-reviews`, {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  const from = (table: string) => {
    let successor = false;
    const q = { select: () => q, eq: (key: string) => { successor ||= key === "supersedes_job_snapshot_id"; return q; },
      maybeSingle: async () => ({ error: null, data: table === "ap_intake_snapshots"
        ? { id: id(1), customer_id: null, draft_id: id(6), content_sha256: "a".repeat(64), schema_version: "applypack-intake-v4", travel: {} }
        : successor ? null : { id: id(2), content_sha256: "b".repeat(64), requirement_completeness: 100, source_authorization: { state: "AUTHORIZED_AUTOMATED" } } }),
      in: async () => ({ error: null, data: table === "ap_requirement_nodes"
        ? [{ id: id(3), job_snapshot_id: id(2), node_kind: "CRITERION", criterion_type: "EXPERIENCE", stable_criterion_id: id(5), source_locator: "line:1", source_excerpt: "Three years required.", typed_value: {} }]
        : [{ id: id(4), snapshot_id: id(1), verification: "CUSTOMER_CONFIRMED", source_kind: "CUSTOMER_ASSERTION", supplied_source_id: null, superseded_at: null }] }),
    }; return q;
  };
  mocks.auth.mockResolvedValue({ ok: true, user: { id: id(7) }, admin: { from, rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ error: null, data: { reviewId: id(8), recordedAt: "2026-10-26T00:00:00Z" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("immutable matching review JSON persistence", () => {
  it("omits absent optional JSON fields instead of inserting JSON null", async () => {
    expect((await POST(request(common))).status).toBe(200);
    const persisted = JSON.parse(JSON.stringify(mocks.rpc.mock.calls[0][1].p_review));
    expect(persisted).not.toHaveProperty("duration_and_intensity");
    expect(persisted).not.toHaveProperty("essential_tools");
    expect(persisted.decision.disposition).toBe("RESOLVED_FAIL");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("preserves explicitly supplied typed duration and tools for adjacent equivalence", async () => {
    const duration = { calendarMonths: 12, fteLowerMonths: 6, fteUpperMonths: 12, basis: "CALENDAR" };
    const body = { ...common, reviewKind: "ADJACENT_EQUIVALENCE", disposition: "RESOLVED_PASS", comparedTasks: ["Handled service cases"],
      taskSimilarity: "STRONG", complexity: "Comparable", autonomy: "Comparable", scope: "Comparable", domainContext: "Related service work",
      durationAndIntensity: duration, essentialTools: ["Case tracker"], equivalentForCriterion: true };
    expect((await POST(request(body))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_review).toMatchObject({ duration_and_intensity: duration, essential_tools: ["Case tracker"] });
  });
  it("preserves a valid explicitly supplied empty tools array", async () => {
    expect((await POST(request({ ...common, essentialTools: [] }))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_review).toHaveProperty("essential_tools", []);
  });
  it.each(["durationAndIntensity", "essentialTools"])("continues rejecting explicit null %s before persistence", async key => {
    expect((await POST(request({ ...common, [key]: null }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

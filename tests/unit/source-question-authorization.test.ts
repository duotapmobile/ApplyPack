import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertSourceContextCurrent } from "@/lib/jobs/source-collection";
import { getSource } from "@/lib/jobs/source-registry";

function fixture() {
  const bounds = { resultBound: 10, pageBound: 1, requestBound: 5, responseByteBound: 50_000,
    durationMsBound: 30_000, hostConcurrencyBound: 1, quotaUnitBound: 0 };
  const schedule = { id: "schedule", source_id: "duolingo", source_authorization_id: "authority", authorization_head_revision: 4,
    scope_sha256: "a".repeat(64), result_bound: 10, page_bound: 1, request_bound: 5, response_byte_bound: 50_000,
    duration_ms_bound: 30_000, host_concurrency_bound: 1, quota_unit_bound: 0, minimum_complete_misses: 2,
    visibility_window_seconds: 3600, enabled: true, paused_reason: null };
  const authorization = { id: "authority", source_id: "duolingo", state: "AUTHORIZED_AUTOMATED" as const, access_method: "AUTOMATED",
    authorization_version: "test-v1", allowed_actions: ["ENUMERATE_JOBS", "READ_APPLICATION_QUESTIONS"],
    allowed_hosts: ["boards-api.greenhouse.io"], rate_and_result_bounds: bounds };
  const scheduled = { state: "LEASED", lease_owner: "worker", lease_epoch: 2, source_generation: 3,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString() };
  const rows: Record<string, unknown> = { job_source_schedules: schedule, ap_source_authorization_heads: { current_authorization_id: "authority", revision: 4 },
    ap_source_authorizations: authorization, ap_scheduled_jobs: scheduled };
  const context: Parameters<typeof assertSourceContextCurrent>[2] = { schedule, authorizationRow: authorization,
    authorization: { id: "authority", sourceId: "duolingo", state: "AUTHORIZED_AUTOMATED", accessMethod: "AUTOMATED",
      authorizationVersion: "test-v1", allowedActions: [...authorization.allowed_actions], allowedHosts: [...authorization.allowed_hosts] }, source: getSource("duolingo")! };
  const admin = { from: (table: string) => { const q = { select: () => q, eq: () => q,
    maybeSingle: async () => ({ data: rows[table], error: null }) }; return q; } } as unknown as Parameters<typeof assertSourceContextCurrent>[0];
  const job = { id: "job", reference_id: "schedule", attempts: 1, created_at: new Date().toISOString(), lease_epoch: 2, source_generation: 3 };
  return { admin, job, context, rows, authorization, scheduled };
}
describe("question request-time database authorization", () => {
  it("requires the specific current action in addition to enumeration", async () => {
    const f = fixture();
    await expect(assertSourceContextCurrent(f.admin, f.job, f.context, "worker", "READ_APPLICATION_QUESTIONS")).resolves.toBeUndefined();
    f.authorization.allowed_actions = ["ENUMERATE_JOBS"];
    await expect(assertSourceContextCurrent(f.admin, f.job, f.context, "worker")).resolves.toBeUndefined();
    await expect(assertSourceContextCurrent(f.admin, f.job, f.context, "worker", "READ_APPLICATION_QUESTIONS")).rejects.toThrow("authority_or_lease_changed");
  });
  it.each(["expired", "different worker", "reclaimed", "head changed", "missing"])("rejects %s authority before a question GET", async (change) => {
    const f = fixture();
    if (change === "expired") f.scheduled.lease_expires_at = new Date(Date.now() - 1).toISOString();
    if (change === "different worker") f.scheduled.lease_owner = "another";
    if (change === "reclaimed") f.scheduled.lease_epoch++;
    if (change === "head changed") f.rows.ap_source_authorization_heads = { current_authorization_id: "replacement", revision: 5 };
    if (change === "missing") f.rows.ap_source_authorizations = null;
    await expect(assertSourceContextCurrent(f.admin, f.job, f.context, "worker", "READ_APPLICATION_QUESTIONS")).rejects.toThrow("authority_or_lease_changed");
  });
});

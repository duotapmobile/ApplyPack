import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { client, status } = vi.hoisted(() => ({ client: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: client }));
vi.mock("../../scripts/lib/archive-writer-completion.mjs", () => ({ readDatabaseArchiveStatus: status }));
import { readIndependentMonitorSnapshot } from "@/lib/operations/independent-monitor-server";
import { DATABASE_RECOVERY } from "../../scripts/lib/database-recovery-protocol.mjs";
const release = "a".repeat(40), nonce = "b".repeat(64), now = Date.parse("2026-10-26T01:00:00Z");
const config = { environment: "production" as const, releaseSha: release };
const heartbeat = { task_name: "maintenance", last_succeeded_at: new Date(now - 60_000).toISOString(), updated_at: new Date(now - 60_000).toISOString(),
  summary: { schemaVersion: 2, phase: "VERIFIED", unresolvedCodes: [], environment: "production", releaseSha: release } };
const query = { select: vi.fn(), in: vi.fn(), limit: vi.fn(), abortSignal: vi.fn() };
const rpc = { abortSignal: vi.fn() };
const admin = { from: vi.fn(), rpc: vi.fn() };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  query.select.mockReturnValue(query); query.in.mockReturnValue(query); query.limit.mockReturnValue(query);
  query.abortSignal.mockResolvedValue({ data: [heartbeat], error: null });
  rpc.abortSignal.mockResolvedValue({ data: { state: "COMPLETE" }, error: null });
  admin.from.mockReturnValue(query); admin.rpc.mockReturnValue(rpc); client.mockReturnValue(admin);
  status.mockImplementation(async ({ readLatestDatabaseCompletion, signal }) => {
    await readLatestDatabaseCompletion({ signal });
    return { schemaVersion: "applypack-database-archive-status-v1", state: "VERIFIED", reason: null, releaseSha: release,
      runId: "11111111-1111-4111-8111-111111111111", providerVerificationSha256: "d".repeat(64), databaseSnapshotAt: new Date(now - 45_000).toISOString(),
      sourceProjectRef: "spjaaxndiduhrcleazwb", schemaVersionOfSnapshot: DATABASE_RECOVERY.schemaVersion,
      sourceWatermark: new Date(now - 60_000).toISOString(), verifiedAt: new Date(now - 30_000).toISOString(), evidenceExpiresAt: new Date(now + 840_000).toISOString() };
  });
});
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("bounded readonly monitor server", () => {
  it("reads only fixed heartbeat metadata and the immutable completion projection", async () => {
    const snapshot = await readIndependentMonitorSnapshot(config, nonce, new AbortController().signal);
    expect(admin.from).toHaveBeenCalledExactlyOnceWith("operational_heartbeats");
    expect(query.select).toHaveBeenCalledExactlyOnceWith("task_name,last_succeeded_at,updated_at,summary");
    expect(query.in).toHaveBeenCalledWith("task_name", ["maintenance", "protected_recovery", "protected_recovery_retention"]);
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(4);
    expect(admin.rpc).toHaveBeenCalledExactlyOnceWith("ap_latest_verified_database_archive");
    expect(snapshot.checks.databaseRecovery).toEqual({ state: "HEALTHY", ageSeconds: 60 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not read production recovery on staging", async () => {
    await readIndependentMonitorSnapshot({ ...config, environment: "staging" }, nonce, new AbortController().signal);
    expect(status).not.toHaveBeenCalled(); expect(admin.rpc).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: null }, { data: [], error: { message: "private" } }, { data: [heartbeat, heartbeat, heartbeat, heartbeat], error: null }])("rejects unavailable or overfull metadata", async (result) => {
    query.abortSignal.mockResolvedValue(result);
    await expect(readIndependentMonitorSnapshot(config, nonce, new AbortController().signal)).rejects.toThrow("MONITOR_UNAVAILABLE");
  });
  it("enforces the deadline even if a transport ignores its abort signal", async () => {
    query.abortSignal.mockReturnValue(new Promise(() => {}));
    const operation = readIndependentMonitorSnapshot(config, nonce, new AbortController().signal);
    const rejection = expect(operation).rejects.toThrow("MONITOR_UNAVAILABLE");
    await vi.advanceTimersByTimeAsync(5_000); await rejection;
    expect(client.mock.calls[0][0].signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start reads after request cancellation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readIndependentMonitorSnapshot(config, nonce, controller.signal)).rejects.toThrow();
    expect(client).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

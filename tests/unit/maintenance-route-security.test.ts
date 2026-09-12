import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  adminClient: vi.fn(),
  collectOperationsSummary: vi.fn(),
  recordMaintenanceDiagnosis: vi.fn(),
  recordMaintenanceFailure: vi.fn(),
  recordMaintenanceOutcome: vi.fn(),
  processPendingFileScans: vi.fn(),
  processPendingFeasibilityRequests: vi.fn(),
  processWorkflowTasks: vi.fn(),
  retryFailedEmails: vi.fn(),
  processChunk4Workers: vi.fn(),
  reconcileBoardSubscriptions: vi.fn(),
  processBoardRecomputeJobs: vi.fn(),
  stripeClient: vi.fn(),
  sendTransactionalEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: dependencies.adminClient }));
vi.mock("@/lib/operations/summary", () => ({ collectOperationsSummary: dependencies.collectOperationsSummary }));
vi.mock("@/lib/operations/maintenance-observability", () => ({
  recordMaintenanceDiagnosis: dependencies.recordMaintenanceDiagnosis,
  recordMaintenanceFailure: dependencies.recordMaintenanceFailure,
  recordMaintenanceOutcome: dependencies.recordMaintenanceOutcome,
}));
vi.mock("@/lib/files/process-scans", () => ({ processPendingFileScans: dependencies.processPendingFileScans }));
vi.mock("@/lib/matching/supabase-feasibility-store", () => ({ processPendingFeasibilityRequests: dependencies.processPendingFeasibilityRequests }));
vi.mock("@/lib/workflow/process", () => ({ processWorkflowTasks: dependencies.processWorkflowTasks }));
vi.mock("@/lib/email/retry", () => ({ retryFailedEmails: dependencies.retryFailedEmails }));
vi.mock("@/lib/commerce/workers", () => ({ processChunk4Workers: dependencies.processChunk4Workers }));
vi.mock("@/lib/job-board/stripe-events", () => ({ reconcileBoardSubscriptions: dependencies.reconcileBoardSubscriptions }));
vi.mock("@/lib/job-board/recompute", () => ({ processBoardRecomputeJobs: dependencies.processBoardRecomputeJobs }));
vi.mock("@/lib/stripe/server", () => ({ createStripeOperationalClient: dependencies.stripeClient }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: dependencies.sendTransactionalEmail }));

import { POST } from "@/app/api/cron/maintenance/route";

function fluentQuery(result: Record<string, unknown> = { data: [], error: null, count: 0 }) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "delete", "eq", "not", "is", "lt", "lte", "in", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function successfulAdmin() {
  return {
    from: vi.fn(() => fluentQuery()),
    rpc: vi.fn((name: string) => Promise.resolve({ data: name === "mark_stale_jobs_inactive" ? 0 : true, error: null })),
    storage: { from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ error: null }) })) },
  };
}

describe("maintenance route security boundary", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "maintenance-test-secret";
    Object.values(dependencies).forEach((mock) => mock.mockReset());
    dependencies.adminClient.mockReturnValue({ from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } });
    dependencies.collectOperationsSummary.mockResolvedValue({ environment: "staging", releaseSha: "76e42f6" });
    dependencies.recordMaintenanceFailure.mockResolvedValue({ unresolvedCodes: [] });
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: [], failClosedCodes: [], repairableCodes: [] });
    dependencies.processPendingFileScans.mockResolvedValue({ processed: 0 });
    dependencies.processPendingFeasibilityRequests.mockResolvedValue({ processed: 0 });
    dependencies.processWorkflowTasks.mockResolvedValue({ processed: 0 });
    dependencies.retryFailedEmails.mockResolvedValue({ processed: 0 });
    dependencies.processChunk4Workers.mockResolvedValue({ status: "enabled", processed: 0 });
    dependencies.stripeClient.mockReturnValue({});
    dependencies.reconcileBoardSubscriptions.mockResolvedValue(0);
    dependencies.processBoardRecomputeJobs.mockResolvedValue({ status: "enabled", processed: 0, decisions: 0 });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("persists diagnosis and invokes zero repair processors when a fail-closed condition is present", async () => {
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({
      codes: ["PAYMENT_INTEGRITY_NOT_READY"],
      failClosedCodes: ["PAYMENT_INTEGRITY_NOT_READY"],
      repairableCodes: [],
    });
    const response = await POST(new Request("https://example.test/api/cron/maintenance", {
      method: "POST",
      headers: { authorization: "Bearer maintenance-test-secret" },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Maintenance stopped by a fail-closed condition.",
      codes: ["PAYMENT_INTEGRITY_NOT_READY"],
    });
    expect(dependencies.recordMaintenanceDiagnosis).toHaveBeenCalledTimes(1);
    expect(dependencies.processPendingFileScans).not.toHaveBeenCalled();
    expect(dependencies.processPendingFeasibilityRequests).not.toHaveBeenCalled();
    expect(dependencies.processWorkflowTasks).not.toHaveBeenCalled();
    expect(dependencies.processChunk4Workers).not.toHaveBeenCalled();
    expect(dependencies.reconcileBoardSubscriptions).not.toHaveBeenCalled();
    expect(dependencies.processBoardRecomputeJobs).not.toHaveBeenCalled();
  });

  it("records a stable diagnosis failure and returns 503 when the before snapshot cannot be collected", async () => {
    dependencies.collectOperationsSummary.mockRejectedValue(new Error("provider details must not escape"));
    const response = await POST(new Request("https://example.test/api/cron/maintenance", {
      method: "POST",
      headers: { authorization: "Bearer maintenance-test-secret" },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Maintenance diagnosis unavailable.",
      code: "MAINTENANCE_DIAGNOSIS_FAILED",
    });
    expect(dependencies.recordMaintenanceFailure).toHaveBeenCalledWith(
      expect.anything(),
      null,
      "MAINTENANCE_DIAGNOSIS_FAILED",
      [],
      expect.any(Date),
    );
    expect(dependencies.processWorkflowTasks).not.toHaveBeenCalled();
  });

  it("records disabled Chunk 4 processing as a stable failure instead of a successful action", async () => {
    dependencies.adminClient.mockReturnValue(successfulAdmin());
    dependencies.processChunk4Workers.mockResolvedValue({ status: "disabled", processed: 0 });
    const response = await POST(new Request("https://example.test/api/cron/maintenance", {
      method: "POST",
      headers: { authorization: "Bearer maintenance-test-secret" },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Bounded queue processing is disabled or unavailable.",
      code: "BOUNDED_QUEUE_PROCESSING_FAILED",
    });
    expect(dependencies.recordMaintenanceFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "BOUNDED_QUEUE_PROCESSING_FAILED",
      expect.arrayContaining([{ code: "BOUNDED_QUEUE_PROCESSING", status: "FAILED" }]),
      expect.any(Date),
    );
    expect(dependencies.reconcileBoardSubscriptions).not.toHaveBeenCalled();
  });

  it("records disabled board recomputation as a stable failure instead of a successful action", async () => {
    dependencies.adminClient.mockReturnValue(successfulAdmin());
    dependencies.processBoardRecomputeJobs.mockResolvedValue({ status: "disabled", processed: 0, decisions: 0 });
    const response = await POST(new Request("https://example.test/api/cron/maintenance", {
      method: "POST",
      headers: { authorization: "Bearer maintenance-test-secret" },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Board recomputation is disabled or unavailable.",
      code: "BOARD_RECOMPUTATION_FAILED",
    });
    expect(dependencies.recordMaintenanceFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "BOARD_RECOMPUTATION_FAILED",
      expect.arrayContaining([{ code: "BOARD_RECOMPUTATION", status: "FAILED" }]),
      expect.any(Date),
    );
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OperationsSummary } from "@/lib/operations/summary";

vi.mock("server-only", () => ({}));

import {
  approvedRealSourceIds,
  commerceSnapshot,
  containsSensitiveOperationsData,
  deploymentEnvironment,
  earliestTimestamp,
  maintenanceHeartbeatIsFresh,
  queueCounts,
  safeReleaseSha,
  sourcePermissionCoverage,
} from "@/lib/operations/summary";
import {
  diagnoseOperations,
  maintenanceOutcome,
  recordMaintenanceDiagnosis,
  recordMaintenanceFailure,
  recoveryEmailIdempotencyKey,
} from "@/lib/operations/maintenance-observability";

function summary(change: Partial<OperationsSummary> = {}): OperationsSummary {
  const base: OperationsSummary = {
    generatedAt: "2026-09-10T12:00:00.000Z",
    environment: "staging",
    releaseSha: "76e42f686214934d705a8bd61ddc83f416f52247",
    readiness: { database: true, payments: true, email: true, fileSafety: true, maintenance: true },
    inventory: {
      registeredSources: 4,
      scheduledSources: 2,
      scheduledAutomatedRealSources: 2,
      realAuthorizedAutomatedSources: 2,
      unauthorizedScheduledAutomatedRealSources: 0,
      syntheticRuns: 1,
      realRuns: 3,
      syntheticActiveJobs: 12,
      realActiveJobs: 20,
    },
    queues: {
      recompute: { states: { pending: 0 }, oldestItemAgeSeconds: null, stale: false },
      workflow: { states: { queued: 0 }, oldestItemAgeSeconds: null, stale: false },
      outbox: { states: { queued: 0 }, oldestItemAgeSeconds: null, stale: false },
      commerceReconciliation: { states: { pending: 0 }, oldestItemAgeSeconds: null, stale: false },
    },
    maintenance: { heartbeatAgeSeconds: 30, stale: false },
    alerts: { openWarnings: 0, openCritical: 0 },
  };
  return { ...base, ...change };
}

describe("aggregate operations safety", () => {
  it("normalizes environment, release identity, queue age and maintenance freshness", () => {
    expect(deploymentEnvironment({ APP_DEPLOYMENT_ENV: "production" })).toBe("production");
    expect(deploymentEnvironment({ APP_DEPLOYMENT_ENV: " staging " })).toBe("staging");
    expect(() => deploymentEnvironment({ APP_DEPLOYMENT_ENV: "preview" })).toThrow("APP_DEPLOYMENT_ENV_MUST_BE_EXPLICIT");
    expect(() => deploymentEnvironment({})).toThrow("APP_DEPLOYMENT_ENV_MUST_BE_EXPLICIT");
    expect(safeReleaseSha({ RAILWAY_GIT_COMMIT_SHA: "76E42F6" })).toBe("76e42f6");
    expect(safeReleaseSha({ RAILWAY_GIT_COMMIT_SHA: "branch/main" })).toBe("unreported");
    expect(queueCounts({ pending: 1 }, "2026-09-10T11:00:00.000Z", 1_800, new Date("2026-09-10T12:00:00.000Z"))).toEqual({
      states: { pending: 1 },
      oldestItemAgeSeconds: 3_600,
      stale: true,
    });
    expect(maintenanceHeartbeatIsFresh("2026-09-10T11:00:00.000Z", new Date("2026-09-10T12:00:00.000Z"), { APP_MAINTENANCE_MAX_AGE_MINUTES: "90" })).toBe(true);
  });

  it("maps the exact chunk 4 monitor keys and treats failures as operational work", () => {
    expect(commerceSnapshot({
      webhooksPending: 2,
      webhookFailures: 3,
      webhookDispatcherFailures: 1,
      outboxDeadLetters: 4,
      leasedJobsOverdue: 5,
      oldestWebhookLagSeconds: 901,
      oldestOutboxRetrySeconds: 300,
    })).toEqual({
      pending: 2,
      failed: 3,
      deadLetter: 4,
      expiredLease: 5,
      oldestAgeSeconds: 901,
    });
  });

  it("keeps human-held and terminal state counts without treating them as actionable age", () => {
    expect(queueCounts(
      { awaitingReview: 2, blocked: 1, deadLetter: 1 },
      null,
      1_800,
      new Date("2026-09-10T12:00:00.000Z"),
    )).toEqual({
      states: { awaitingReview: 2, blocked: 1, deadLetter: 1 },
      oldestItemAgeSeconds: null,
      stale: false,
    });
    expect(earliestTimestamp(null, "invalid", "2026-09-10T11:30:00.000Z", "2026-09-10T11:00:00.000Z"))
      .toBe("2026-09-10T11:00:00.000Z");
  });

  it("separates all real inventory from fail-closed scheduled-source permission coverage", () => {
    expect(approvedRealSourceIds([
      { id: "approved-source-a" },
      { id: "synthetic-staging" },
      { id: "approved-source-b" },
      { id: null },
    ])).toEqual(["approved-source-a", "approved-source-b"]);
    expect(approvedRealSourceIds({ id: "not-an-array" })).toEqual([]);
    expect(sourcePermissionCoverage(
      [{ id: "approved-source-a" }, { id: "unauthorized-source" }, { id: "synthetic-staging" }],
      [{ id: "approved-source-a" }, { id: "not-scheduled" }],
    )).toEqual({
      scheduledAutomatedRealSources: 2,
      realAuthorizedAutomatedSources: 1,
      unauthorizedScheduledAutomatedRealSources: 1,
    });
  });

  it("rejects identifiers, contact data, URLs, document fields and error payloads", () => {
    expect(containsSensitiveOperationsData(summary())).toBe(false);
    expect(containsSensitiveOperationsData({ customerId: "53000000-0000-4000-8000-000000000001" })).toBe(true);
    expect(containsSensitiveOperationsData({ value: "person@example.com" })).toBe(true);
    expect(containsSensitiveOperationsData({ value: "https://example.com/private" })).toBe(true);
    expect(containsSensitiveOperationsData({ resume: "content" })).toBe(true);
    expect(containsSensitiveOperationsData({ errorMessage: "provider text" })).toBe(true);
  });
});

describe("maintenance policy", () => {
  it("classifies repairable queue failures separately from fail-closed readiness failures", () => {
    const unhealthy = summary({
      readiness: { database: true, payments: false, email: true, fileSafety: true, maintenance: true },
      queues: {
        ...summary().queues,
        recompute: { states: { pending: 2 }, oldestItemAgeSeconds: 3_600, stale: true },
      },
    });
    expect(diagnoseOperations(unhealthy)).toEqual({
      codes: ["PAYMENT_INTEGRITY_NOT_READY", "RECOMPUTE_QUEUE_STALE"],
      failClosedCodes: ["PAYMENT_INTEGRITY_NOT_READY"],
      repairableCodes: ["RECOMPUTE_QUEUE_STALE"],
    });
  });

  it("fails closed for an existing critical confidentiality, tenant, payment, or permission alert", () => {
    const diagnostic = diagnoseOperations(summary({ alerts: { openWarnings: 0, openCritical: 1 } }));
    expect(diagnostic.failClosedCodes).toContain("CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN");
    expect(diagnostic.repairableCodes).not.toContain("CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN");
  });

  it("fails closed when any scheduled automated real source lacks permission", () => {
    const diagnostic = diagnoseOperations(summary({
      inventory: {
        ...summary().inventory,
        scheduledSources: 2,
        scheduledAutomatedRealSources: 2,
        realAuthorizedAutomatedSources: 1,
        unauthorizedScheduledAutomatedRealSources: 1,
      },
    }));
    expect(diagnostic.failClosedCodes).toContain("SOURCE_PERMISSION_COVERAGE_MISSING");
  });

  it("does not treat synthetic or non-automated scheduled sources as a permission failure", () => {
    const diagnostic = diagnoseOperations(summary({
      inventory: {
        ...summary().inventory,
        scheduledSources: 3,
        scheduledAutomatedRealSources: 0,
        realAuthorizedAutomatedSources: 0,
        unauthorizedScheduledAutomatedRealSources: 0,
      },
    }));
    expect(diagnostic.codes).not.toContain("SOURCE_PERMISSION_COVERAGE_MISSING");
    expect(diagnostic.failClosedCodes).not.toContain("SOURCE_PERMISSION_COVERAGE_MISSING");
  });

  it("records one fixed action pass and deterministic before-after recovery codes", () => {
    const before = summary({
      queues: {
        ...summary().queues,
        workflow: { states: { queued: 2 }, oldestItemAgeSeconds: 3_600, stale: true },
      },
    });
    const outcome = maintenanceOutcome(before, summary());
    expect(outcome.actionCodes).toEqual([
      "EXPIRATION_CLEANUP",
      "EXPIRED_LEASE_RECOVERY",
      "BOUNDED_QUEUE_PROCESSING",
      "STRIPE_RECONCILIATION",
      "BOARD_RECOMPUTATION",
    ]);
    expect(outcome.recoveredCodes).toEqual(["WORKFLOW_QUEUE_STALE"]);
    expect(outcome.unresolvedCodes).toEqual([]);
  });

  it("does not report a failed processor as a successful action", () => {
    const outcome = maintenanceOutcome(
      summary(),
      summary(),
      [{ code: "STRIPE_RECONCILIATION", status: "FAILED" }],
      ["STRIPE_RECONCILIATION_FAILED"],
    );
    expect(outcome.actionCodes).toEqual([]);
    expect(outcome.failedActionCodes).toEqual(["STRIPE_RECONCILIATION"]);
    expect(outcome.unresolvedCodes).toEqual(["STRIPE_RECONCILIATION_FAILED"]);
  });

  it("derives a stable recovery-email key from the condition episode rather than invocation time", () => {
    const first = recoveryEmailIdempotencyKey("production", ["WORKFLOW_QUEUE_STALE", "OUTBOX_QUEUE_STALE"], [
      "maintenance/WORKFLOW_QUEUE_STALE:2026-09-11T10:00:00.000Z",
      "maintenance/OUTBOX_QUEUE_STALE:2026-09-11T10:01:00.000Z",
    ]);
    const retry = recoveryEmailIdempotencyKey("production", ["OUTBOX_QUEUE_STALE", "WORKFLOW_QUEUE_STALE"], [
      "maintenance/OUTBOX_QUEUE_STALE:2026-09-11T10:01:00.000Z",
      "maintenance/WORKFLOW_QUEUE_STALE:2026-09-11T10:00:00.000Z",
    ]);
    expect(retry).toBe(first);
    expect(recoveryEmailIdempotencyKey("production", ["WORKFLOW_QUEUE_STALE"], [
      "maintenance/WORKFLOW_QUEUE_STALE:2026-09-12T10:00:00.000Z",
    ])).not.toBe(first);
  });

  it("resolves the derived critical maintenance alert instead of persisting a self-latching alert", async () => {
    const alertUpsert = vi.fn().mockResolvedValue({ error: null });
    const alertIn = vi.fn().mockResolvedValue({ error: null });
    const alertEq = vi.fn().mockReturnValue({ in: alertIn });
    const alertUpdate = vi.fn().mockReturnValue({ eq: alertEq });
    const heartbeatEq = vi.fn().mockResolvedValue({ error: null });
    const heartbeatUpdate = vi.fn().mockReturnValue({ eq: heartbeatEq });
    const admin = {
      from: vi.fn((table: string) => table === "ap_operational_alerts"
        ? { upsert: alertUpsert, update: alertUpdate }
        : { update: heartbeatUpdate }),
    };
    await recordMaintenanceDiagnosis(admin as never, summary({ alerts: { openWarnings: 0, openCritical: 1 } }));
    expect(alertUpsert).not.toHaveBeenCalled();
    expect(alertEq).toHaveBeenCalledWith("alert_key", "maintenance/CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN");
    expect(alertEq).not.toHaveBeenCalledWith("alert_key", "maintenance/BOUNDED_QUEUE_PROCESSING_FAILED");
  });

  it("records a processor failure without refreshing last_succeeded_at", async () => {
    const alertUpsert = vi.fn().mockResolvedValue({ error: null });
    const alertIn = vi.fn().mockResolvedValue({ error: null });
    const alertUpdate = vi.fn().mockReturnValue({ eq: () => ({ in: alertIn }) });
    const heartbeatEq = vi.fn().mockResolvedValue({ error: null });
    const heartbeatUpdate = vi.fn().mockReturnValue({ eq: heartbeatEq });
    const heartbeatUpsert = vi.fn();
    const admin = {
      from: vi.fn((table: string) => table === "ap_operational_alerts"
        ? { upsert: alertUpsert, update: alertUpdate }
        : { update: heartbeatUpdate, upsert: heartbeatUpsert }),
    };
    await recordMaintenanceFailure(
      admin as never,
      summary(),
      "BOUNDED_QUEUE_PROCESSING_FAILED",
      [{ code: "BOUNDED_QUEUE_PROCESSING", status: "FAILED" }],
    );
    expect(alertUpsert).toHaveBeenCalledWith(expect.objectContaining({
      alert_key: "maintenance/BOUNDED_QUEUE_PROCESSING_FAILED",
      state: "OPEN",
    }), { onConflict: "alert_key" });
    expect(heartbeatUpdate).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ phase: "FAILED" }),
    }));
    expect(heartbeatUpsert).not.toHaveBeenCalled();
  });
});

describe("operations route contract", () => {
  const route = readFileSync(resolve(process.cwd(), "src/app/api/admin/operations/summary/route.ts"), "utf8");
  const cron = readFileSync(resolve(process.cwd(), "src/app/api/cron/maintenance/route.ts"), "utf8");
  const operations = readFileSync(resolve(process.cwd(), "src/lib/operations/summary.ts"), "utf8");

  it("requires the shared admin role and AAL2 gate and disables caching", () => {
    expect(route).toContain("requireAdmin()");
    expect(route).toContain('"cache-control": "no-store, private"');
    expect(route).toContain("containsSensitiveOperationsData(summary)");
  });

  it("invokes each bounded processor only once in the repair phase", () => {
    expect(cron.match(/await processPendingFileScans\(/g)).toHaveLength(1);
    expect(cron.match(/await processWorkflowTasks\(/g)).toHaveLength(1);
    expect(cron.match(/await processChunk4Workers\(/g)).toHaveLength(1);
    expect(cron.match(/await reconcileBoardSubscriptions\(/g)).toHaveLength(1);
    expect(cron.match(/await processBoardRecomputeJobs\(/g)).toHaveLength(1);
  });

  it("keeps all real inventory visible and uses actionable queue timestamps", () => {
    expect(operations).toContain(`count("job_source_runs").neq("source_id", SYNTHETIC_SOURCE_ID)`);
    expect(operations).toContain(`count("jobs").neq("source_id", SYNTHETIC_SOURCE_ID)`);
    expect(operations).toContain(`unauthorizedScheduledAutomatedRealSources`);
    expect(operations).toContain(`.select("available_at").in("state", ["PENDING", "RETRY"])`);
    expect(operations).toContain(`.select("not_before").in("status", ["queued", "failed"])`);
    expect(operations).toContain(`.lte("not_before", nowIso)`);
    expect(operations).not.toContain(`.select("created_at").in("status", ["queued", "processing", "awaiting_review"`);
  });
});

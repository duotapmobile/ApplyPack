import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dependencies = vi.hoisted(() => Object.fromEntries([
  "adminClient", "collectOperationsSummary", "recordMaintenanceDiagnosis", "recordMaintenanceFailure", "recordMaintenanceOutcome", "maintenanceActionsSucceeded",
  "processUnpaidSourceRetention", "processPendingFileScans", "processPendingDocumentExtractions", "processPendingFeasibilityRequests", "processWorkflowTasks",
  "retryFailedEmails", "processChunk4Workers", "reconcileBoardSubscriptions", "reconcileCheckoutInitiations", "processAwsTemporaryCleanup", "stripeClient", "sendTransactionalEmail",
].map(name => [name, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: dependencies.adminClient }));
vi.mock("@/lib/operations/summary", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/operations/summary")>(),
  collectOperationsSummary: dependencies.collectOperationsSummary,
}));
vi.mock("@/lib/operations/maintenance-observability", () => ({
  recordMaintenanceDiagnosis: dependencies.recordMaintenanceDiagnosis, recordMaintenanceFailure: dependencies.recordMaintenanceFailure,
  recordMaintenanceOutcome: dependencies.recordMaintenanceOutcome,
  maintenanceActionsSucceeded: dependencies.maintenanceActionsSucceeded,
}));
vi.mock("@/lib/files/unpaid-retention", () => ({ processUnpaidSourceRetention: dependencies.processUnpaidSourceRetention }));
vi.mock("@/lib/files/aws-temporary-cleanup", () => ({ processAwsTemporaryCleanup: dependencies.processAwsTemporaryCleanup }));
vi.mock("@/lib/files/process-scans", () => ({ processPendingFileScans: dependencies.processPendingFileScans }));
vi.mock("@/lib/files/isolated-extraction", () => ({ processPendingDocumentExtractions: dependencies.processPendingDocumentExtractions }));
vi.mock("@/lib/matching/supabase-feasibility-store", () => ({ processPendingFeasibilityRequests: dependencies.processPendingFeasibilityRequests }));
vi.mock("@/lib/workflow/process", () => ({ processWorkflowTasks: dependencies.processWorkflowTasks }));
vi.mock("@/lib/email/retry", () => ({ retryFailedEmails: dependencies.retryFailedEmails }));
vi.mock("@/lib/commerce/workers", () => ({ processChunk4Workers: dependencies.processChunk4Workers }));
vi.mock("@/lib/commerce/checkout-initiation", () => ({ reconcileCheckoutInitiations: dependencies.reconcileCheckoutInitiations }));
vi.mock("@/lib/job-board/stripe-events", () => ({ reconcileBoardSubscriptions: dependencies.reconcileBoardSubscriptions }));
vi.mock("@/lib/stripe/server", () => ({ createStripeOperationalClient: dependencies.stripeClient }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: dependencies.sendTransactionalEmail }));

import { POST } from "@/app/api/cron/maintenance/route";
function query() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "delete", "eq", "not", "is", "lt", "lte", "gte", "in", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
  return chain;
}
const releaseSha = "a".repeat(40);
const request = (headers: Record<string, string> = {}) => new Request("https://applypack-staging-staging.up.railway.app/api/cron/maintenance", {
  method: "POST", headers: { authorization: "Bearer maintenance-test-secret",
    "x-applypack-expected-environment": "staging", "x-applypack-expected-release-sha": releaseSha, ...headers },
});
describe("maintenance authorization and independent queues", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "maintenance-test-secret");
    vi.stubEnv("APP_DEPLOYMENT_ENV", "staging");
    vi.stubEnv("APP_EXPECTED_RELEASE_SHA", releaseSha);
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", releaseSha);
    vi.stubEnv("GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "");
    vi.stubEnv("APP_LEGACY_BOARD_MAINTENANCE_ENABLED", "true");
    Object.values(dependencies).forEach(mock => mock.mockReset());
    dependencies.adminClient.mockReturnValue({ from: vi.fn(query), rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      storage: { from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ error: null }) })) } });
    dependencies.collectOperationsSummary.mockResolvedValue({ environment: "staging", releaseSha });
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: [], failClosedCodes: [], repairableCodes: [] });
    dependencies.recordMaintenanceFailure.mockResolvedValue({ unresolvedCodes: [] });
    dependencies.recordMaintenanceOutcome.mockImplementation(async (_admin, _before, _after, actions) => ({
      unresolvedCodes: actions.filter((action: {status: string}) => action.status === "FAILED").map((action: {code: string}) => action.code + "_FAILED"),
    }));
    dependencies.maintenanceActionsSucceeded.mockImplementation((
      actions: Array<{ code: string; status: string }>,
      allowedSkippedActions: string[] = [],
    ) => {
      const allowed = new Set(allowedSkippedActions);
      return actions.every((action: { code: string; status: string }) => action.status === "SUCCEEDED"
        || (action.status === "SKIPPED" && allowed.has(action.code)));
    });
    dependencies.processUnpaidSourceRetention.mockResolvedValue({ processed: 0, deleted: 0, failed: 0, skipped: 0 });
    dependencies.processPendingDocumentExtractions.mockResolvedValue({ processed: 0, succeeded: 0 });
    dependencies.processPendingFileScans.mockResolvedValue({ processed: 0 });
    dependencies.processPendingFeasibilityRequests.mockResolvedValue({ processed: 0 });
    dependencies.processWorkflowTasks.mockResolvedValue({ processed: 0 });
    dependencies.retryFailedEmails.mockResolvedValue({ processed: 0 });
    dependencies.processChunk4Workers.mockResolvedValue({ status: "enabled", processed: 0 });
    dependencies.reconcileCheckoutInitiations.mockResolvedValue({ processed: 0, unresolved: 0 });
    dependencies.processAwsTemporaryCleanup.mockResolvedValue({ processed: 0, recovered: 0, failed: 0, deadLetter: false, overdue: false });
    dependencies.stripeClient.mockReturnValue({});
    dependencies.reconcileBoardSubscriptions.mockResolvedValue(0);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects an unauthenticated call before accessing the database", async () => {
    expect((await POST(new Request("https://example.test/api/cron/maintenance", { method: "POST" }))).status).toBe(401);
    expect(dependencies.adminClient).not.toHaveBeenCalled();
    expect(dependencies.processUnpaidSourceRetention).not.toHaveBeenCalled();
    expect(dependencies.processAwsTemporaryCleanup).not.toHaveBeenCalled();
  });
  it.each([
    { "x-applypack-expected-environment": "" },
    { "x-applypack-expected-environment": "production" },
    { "x-applypack-expected-release-sha": "" },
    { "x-applypack-expected-release-sha": "b".repeat(40) },
    { "x-applypack-expected-release-sha": releaseSha.slice(0, 7) },
  ] as Array<Record<string, string>>)("rejects mismatched or missing deployment headers before any database or alert write (%j)", async headers => {
    const response = await POST(request(headers));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Maintenance deployment identity does not match.", code: "MAINTENANCE_DEPLOYMENT_MISMATCH" });
    expect(dependencies.adminClient).not.toHaveBeenCalled();
    expect(dependencies.recordMaintenanceDiagnosis).not.toHaveBeenCalled();
    expect(dependencies.recordMaintenanceFailure).not.toHaveBeenCalled();
    expect(dependencies.processAwsTemporaryCleanup).not.toHaveBeenCalled();
  });
  it.each([
    ["APP_DEPLOYMENT_ENV", ""], ["APP_DEPLOYMENT_ENV", "preview"],
    ["APP_EXPECTED_RELEASE_SHA", "b".repeat(40)], ["APP_EXPECTED_RELEASE_SHA", ""],
    ["RAILWAY_GIT_COMMIT_SHA", ""], ["RAILWAY_GIT_COMMIT_SHA", releaseSha.slice(0, 7)],
  ])("rejects unbound server configuration before any work (%s)", async (name, value) => {
    vi.stubEnv(name, value);
    expect((await POST(request())).status).toBe(503);
    expect(dependencies.adminClient).not.toHaveBeenCalled();
    expect(dependencies.recordMaintenanceDiagnosis).not.toHaveBeenCalled();
  });
  it("uses the server environment rather than the requested environment", async () => {
    vi.stubEnv("APP_DEPLOYMENT_ENV", "production");
    expect((await POST(request())).status).toBe(409);
    expect(dependencies.adminClient).not.toHaveBeenCalled();
    const response = await POST(request({ "x-applypack-expected-environment": "production" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deployment: { environment: "production", releaseSha } });
  });
  it("keeps retired board maintenance dormant unless it is explicitly enabled", async () => {
    vi.stubEnv("APP_LEGACY_BOARD_MAINTENANCE_ENABLED", "false");
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      deployment: { environment: "staging", releaseSha },
      allowedSkippedActions: ["STRIPE_RECONCILIATION", "BOARD_RECOMPUTATION"],
    });
    expect(dependencies.reconcileBoardSubscriptions).not.toHaveBeenCalled();
    expect(dependencies.processAwsTemporaryCleanup).toHaveBeenCalledOnce();
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.arrayContaining([
        { code: "STRIPE_RECONCILIATION", status: "SKIPPED" },
        { code: "BOARD_RECOMPUTATION", status: "SKIPPED" },
      ]),
      expect.any(Date),
      ["STRIPE_RECONCILIATION", "BOARD_RECOMPUTATION"],
    );
  });
  it.each(["DATABASE_NOT_READY", "CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN"])("stops every processor for %s", async code => {
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: [code], failClosedCodes: [code], repairableCodes: [] });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ codes: [code], deployment: { environment: "staging", releaseSha } });
    expect(dependencies.processPendingDocumentExtractions).not.toHaveBeenCalled();
    expect(dependencies.processWorkflowTasks).not.toHaveBeenCalled();
    expect(dependencies.reconcileBoardSubscriptions).not.toHaveBeenCalled();
    expect(dependencies.processAwsTemporaryCleanup).not.toHaveBeenCalled();
  });
  it("keeps parsing and paid-obligation reconciliation available while purchasing is disabled", async () => {
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: ["PAYMENT_INTEGRITY_NOT_READY"], failClosedCodes: ["PAYMENT_INTEGRITY_NOT_READY"], repairableCodes: [] });
    dependencies.recordMaintenanceOutcome.mockResolvedValue({ unresolvedCodes: ["PAYMENT_INTEGRITY_NOT_READY"] });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(dependencies.processPendingDocumentExtractions).toHaveBeenCalledWith(expect.anything(), 2);
    expect(dependencies.reconcileBoardSubscriptions).toHaveBeenCalledOnce();
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
    expect(dependencies.reconcileCheckoutInitiations).toHaveBeenCalledWith(expect.anything(), 20);
  });
  it("skips unsafe parsing and encrypted payload work but still reconciles subscriptions", async () => {
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: ["FILE_SAFETY_NOT_READY", "ENCRYPTION_NOT_READY"], failClosedCodes: ["FILE_SAFETY_NOT_READY", "ENCRYPTION_NOT_READY"], repairableCodes: [] });
    expect((await POST(request())).status).toBe(503);
    expect(dependencies.processPendingDocumentExtractions).not.toHaveBeenCalled();
    expect(dependencies.processChunk4Workers).not.toHaveBeenCalled();
    expect(dependencies.processWorkflowTasks).not.toHaveBeenCalled();
    expect(dependencies.reconcileBoardSubscriptions).toHaveBeenCalledOnce();
  });
  it("records parsing failure while unrelated queues continue", async () => {
    dependencies.processPendingDocumentExtractions.mockRejectedValue(new Error("private provider detail"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider detail");
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(),
      expect.arrayContaining([
        { code: "DOCUMENT_PROCESSING", status: "FAILED" },
        { code: "BOARD_RECOMPUTATION", status: "SKIPPED" },
      ]), expect.any(Date), ["BOARD_RECOMPUTATION"]);
  });
  it("records disabled processChunk4Workers without aborting other maintenance", async () => {
    const name = "processChunk4Workers";
    dependencies[name].mockResolvedValue({ status: "disabled", processed: 0 });
    expect((await POST(request())).status).toBe(503);
    expect(dependencies.processPendingDocumentExtractions).toHaveBeenCalledOnce();
    expect(dependencies.reconcileBoardSubscriptions).toHaveBeenCalledOnce();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledOnce();
  });
  it("retains unpaid cleanup during an encryption hold without parsing documents", async () => {
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: ["ENCRYPTION_NOT_READY"], failClosedCodes: ["ENCRYPTION_NOT_READY"], repairableCodes: [] });
    expect((await POST(request())).status).toBe(503);
    expect(dependencies.processPendingDocumentExtractions).not.toHaveBeenCalled();
    expect(dependencies.processUnpaidSourceRetention).toHaveBeenCalledWith(expect.anything(), 10);
    expect(dependencies.processAwsTemporaryCleanup).toHaveBeenCalledWith(expect.anything(), { now: expect.any(Date) });
    expect(dependencies.reconcileBoardSubscriptions).toHaveBeenCalledOnce();
  });
  it.each([
    { processed: 1, recovered: 0, failed: 1, deadLetter: false, overdue: false },
    { processed: 0, recovered: 0, failed: 0, deadLetter: true, overdue: false },
    { processed: 20, recovered: 20, failed: 0, deadLetter: false, overdue: true },
  ])("reports AWS temporary cleanup failure while payment reconciliation continues (%j)", async result => {
    dependencies.processAwsTemporaryCleanup.mockResolvedValue(result);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(dependencies.reconcileCheckoutInitiations).toHaveBeenCalledOnce();
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(),
      expect.arrayContaining([{ code: "EXPIRATION_CLEANUP", status: "FAILED" }]), expect.any(Date), ["BOARD_RECOMPUTATION"]);
  });
  it("does not claim cleanup success when its AWS ledger cannot be read", async () => {
    dependencies.processAwsTemporaryCleanup.mockRejectedValue(new Error("private cleanup provider details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private cleanup provider details");
    expect(dependencies.reconcileCheckoutInitiations).toHaveBeenCalledOnce();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(),
      expect.arrayContaining([{ code: "EXPIRATION_CLEANUP", status: "FAILED" }]), expect.any(Date), ["BOARD_RECOMPUTATION"]);
  });
  it("records successful AWS recovery without routing AWS keys through Supabase Storage", async () => {
    dependencies.processAwsTemporaryCleanup.mockResolvedValue({ processed: 4, recovered: 4, failed: 0, deadLetter: false, overdue: false });
    expect((await POST(request())).status).toBe(200);
    expect(dependencies.adminClient.mock.results[0].value.storage.from).not.toHaveBeenCalled();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(),
      expect.arrayContaining([{ code: "EXPIRATION_CLEANUP", status: "SUCCEEDED" }]), expect.any(Date), ["BOARD_RECOMPUTATION"]);
  });
  it("runs cleanup and paid work despite an existing overdue diagnostic, then records the recovered action", async () => {
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({
      codes: ["STORAGE_CLEANUP_OVERDUE"], failClosedCodes: ["STORAGE_CLEANUP_OVERDUE"], repairableCodes: [],
    });
    dependencies.processAwsTemporaryCleanup.mockResolvedValue({ processed: 4, recovered: 4, failed: 0, deadLetter: false, overdue: false });
    expect((await POST(request())).status).toBe(200);
    expect(dependencies.processAwsTemporaryCleanup).toHaveBeenCalledOnce();
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
    expect(dependencies.reconcileCheckoutInitiations).toHaveBeenCalledOnce();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(),
      expect.arrayContaining([{ code: "EXPIRATION_CLEANUP", status: "SUCCEEDED" }]), expect.any(Date), ["BOARD_RECOMPUTATION"]);
  });
  it("records unpaid storage cleanup failure while unrelated queues continue", async () => {
    dependencies.processUnpaidSourceRetention.mockResolvedValue({ processed: 1, deleted: 0, failed: 1, skipped: 0 });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ queueStages: { unpaidSourceRetention: "FAILED" } });
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
    expect(dependencies.reconcileBoardSubscriptions).toHaveBeenCalledOnce();
  });
  it("reports unresolved checkout provider outcomes without stopping other paid obligations", async () => {
    dependencies.reconcileCheckoutInitiations.mockResolvedValue({ processed: 1, unresolved: 1 });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ queueStages: { checkoutInitiations: "FAILED" } });
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
    expect(dependencies.processChunk4Workers).toHaveBeenCalledOnce();
  });
  it("keeps exhausted cleanup critical while continuing independent paid-obligation processors", async () => {
    const from = vi.fn((table: string) => {
      const chain = query();
      if (table === "storage_cleanup_queue") {
        (chain.gte as ReturnType<typeof vi.fn>).mockImplementation(() => {
          chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null, count: 1 }).then(resolve);
          return chain;
        });
      }
      return chain;
    });
    dependencies.adminClient.mockReturnValue({
      from,
      rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      storage: { from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ error: null }) })) },
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(dependencies.recordMaintenanceFailure).not.toHaveBeenCalled();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.arrayContaining([{ code: "EXPIRATION_CLEANUP", status: "FAILED" }]),
      expect.any(Date),
      ["BOARD_RECOMPUTATION"],
    );
    expect(dependencies.processPendingDocumentExtractions).toHaveBeenCalledOnce();
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
    expect(dependencies.reconcileBoardSubscriptions).toHaveBeenCalledOnce();
  });
  it("records a diagnosis failure without invoking processors", async () => {
    dependencies.collectOperationsSummary.mockRejectedValue(new Error("provider secret"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "MAINTENANCE_DIAGNOSIS_FAILED" });
    expect(dependencies.recordMaintenanceFailure).toHaveBeenCalledOnce();
    expect(dependencies.processPendingDocumentExtractions).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => Object.fromEntries([
  "adminClient", "collectOperationsSummary", "recordMaintenanceDiagnosis", "recordMaintenanceFailure", "recordMaintenanceOutcome",
  "processPendingFileScans", "processPendingDocumentExtractions", "processPendingFeasibilityRequests", "processWorkflowTasks",
  "retryFailedEmails", "processChunk4Workers", "reconcileBoardSubscriptions", "processBoardRecomputeJobs", "stripeClient", "sendTransactionalEmail",
].map(name => [name, vi.fn()])) as Record<string, ReturnType<typeof vi.fn>>);
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: dependencies.adminClient }));
vi.mock("@/lib/operations/summary", () => ({ collectOperationsSummary: dependencies.collectOperationsSummary }));
vi.mock("@/lib/operations/maintenance-observability", () => ({
  recordMaintenanceDiagnosis: dependencies.recordMaintenanceDiagnosis, recordMaintenanceFailure: dependencies.recordMaintenanceFailure,
  recordMaintenanceOutcome: dependencies.recordMaintenanceOutcome,
}));
vi.mock("@/lib/files/process-scans", () => ({ processPendingFileScans: dependencies.processPendingFileScans }));
vi.mock("@/lib/files/isolated-extraction", () => ({ processPendingDocumentExtractions: dependencies.processPendingDocumentExtractions }));
vi.mock("@/lib/matching/supabase-feasibility-store", () => ({ processPendingFeasibilityRequests: dependencies.processPendingFeasibilityRequests }));
vi.mock("@/lib/workflow/process", () => ({ processWorkflowTasks: dependencies.processWorkflowTasks }));
vi.mock("@/lib/email/retry", () => ({ retryFailedEmails: dependencies.retryFailedEmails }));
vi.mock("@/lib/commerce/workers", () => ({ processChunk4Workers: dependencies.processChunk4Workers }));
vi.mock("@/lib/job-board/stripe-events", () => ({ reconcileBoardSubscriptions: dependencies.reconcileBoardSubscriptions }));
vi.mock("@/lib/job-board/recompute", () => ({ processBoardRecomputeJobs: dependencies.processBoardRecomputeJobs }));
vi.mock("@/lib/stripe/server", () => ({ createStripeOperationalClient: dependencies.stripeClient }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: dependencies.sendTransactionalEmail }));

import { POST } from "@/app/api/cron/maintenance/route";
function query() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "delete", "eq", "not", "is", "lt", "lte", "in", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
  return chain;
}
const request = () => new Request("https://example.test/api/cron/maintenance", { method: "POST", headers: { authorization: "Bearer maintenance-test-secret" } });
describe("maintenance authorization and independent queues", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "maintenance-test-secret");
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "");
    Object.values(dependencies).forEach(mock => mock.mockReset());
    dependencies.adminClient.mockReturnValue({ from: vi.fn(query), rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
      storage: { from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ error: null }) })) } });
    dependencies.collectOperationsSummary.mockResolvedValue({ environment: "staging", releaseSha: "76e42f6" });
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: [], failClosedCodes: [], repairableCodes: [] });
    dependencies.recordMaintenanceFailure.mockResolvedValue({ unresolvedCodes: [] });
    dependencies.recordMaintenanceOutcome.mockImplementation(async (_admin, _before, _after, actions) => ({
      unresolvedCodes: actions.filter((action: {status: string}) => action.status === "FAILED").map((action: {code: string}) => action.code + "_FAILED"),
    }));
    dependencies.processPendingDocumentExtractions.mockResolvedValue({ processed: 0, succeeded: 0 });
    dependencies.processPendingFileScans.mockResolvedValue({ processed: 0 });
    dependencies.processPendingFeasibilityRequests.mockResolvedValue({ processed: 0 });
    dependencies.processWorkflowTasks.mockResolvedValue({ processed: 0 });
    dependencies.retryFailedEmails.mockResolvedValue({ processed: 0 });
    dependencies.processChunk4Workers.mockResolvedValue({ status: "enabled", processed: 0 });
    dependencies.stripeClient.mockReturnValue({});
    dependencies.reconcileBoardSubscriptions.mockResolvedValue(0);
    dependencies.processBoardRecomputeJobs.mockResolvedValue({ status: "enabled", processed: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects an unauthenticated call before accessing the database", async () => {
    expect((await POST(new Request("https://example.test/api/cron/maintenance", { method: "POST" }))).status).toBe(401);
    expect(dependencies.adminClient).not.toHaveBeenCalled();
  });
  it.each(["DATABASE_NOT_READY", "CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN"])("stops every processor for %s", async code => {
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: [code], failClosedCodes: [code], repairableCodes: [] });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ codes: [code] });
    expect(dependencies.processPendingDocumentExtractions).not.toHaveBeenCalled();
    expect(dependencies.processWorkflowTasks).not.toHaveBeenCalled();
    expect(dependencies.reconcileBoardSubscriptions).not.toHaveBeenCalled();
  });
  it("keeps parsing and paid-obligation reconciliation available while purchasing is disabled", async () => {
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: ["PAYMENT_INTEGRITY_NOT_READY"], failClosedCodes: ["PAYMENT_INTEGRITY_NOT_READY"], repairableCodes: [] });
    dependencies.recordMaintenanceOutcome.mockResolvedValue({ unresolvedCodes: ["PAYMENT_INTEGRITY_NOT_READY"] });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(dependencies.processPendingDocumentExtractions).toHaveBeenCalledWith(expect.anything(), 2);
    expect(dependencies.reconcileBoardSubscriptions).toHaveBeenCalledOnce();
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
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
    expect(dependencies.processBoardRecomputeJobs).toHaveBeenCalledOnce();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(),
      expect.arrayContaining([{ code: "DOCUMENT_PROCESSING", status: "FAILED" }]), expect.any(Date));
  });
  it.each(["processChunk4Workers", "processBoardRecomputeJobs"])("records disabled %s without aborting other maintenance", async name => {
    dependencies[name].mockResolvedValue({ status: "disabled", processed: 0 });
    expect((await POST(request())).status).toBe(503);
    expect(dependencies.processPendingDocumentExtractions).toHaveBeenCalledOnce();
    expect(dependencies.reconcileBoardSubscriptions).toHaveBeenCalledOnce();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledOnce();
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

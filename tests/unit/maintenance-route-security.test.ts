import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dependencies = vi.hoisted(() => Object.fromEntries([
  "adminClient", "collectOperationsSummary", "recordMaintenanceDiagnosis", "recordMaintenanceFailure", "recordMaintenanceOutcome", "maintenanceActionsSucceeded",
  "processUnpaidSourceRetention", "processServiceRetention", "processPendingFileScans", "processPendingDocumentExtractions", "processPendingFeasibilityRequests", "processAutomaticResearchPreparation", "processWorkflowTasks",
  "retryFailedEmails", "processChunk4Workers", "processMaterialDraftQueue", "reconcileBoardSubscriptions", "reconcileCheckoutInitiations", "processAwsTemporaryCleanup", "stripeClient", "sendTransactionalEmail",
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
vi.mock("@/lib/files/service-retention", () => ({ processServiceRetention: dependencies.processServiceRetention }));
vi.mock("@/lib/files/aws-temporary-cleanup", () => ({ processAwsTemporaryCleanup: dependencies.processAwsTemporaryCleanup }));
vi.mock("@/lib/files/process-scans", () => ({ processPendingFileScans: dependencies.processPendingFileScans }));
vi.mock("@/lib/files/isolated-extraction", () => ({ processPendingDocumentExtractions: dependencies.processPendingDocumentExtractions }));
vi.mock("@/lib/matching/supabase-feasibility-store", () => ({ processPendingFeasibilityRequests: dependencies.processPendingFeasibilityRequests }));
vi.mock("@/lib/matching/research-preparation-server", () => ({ processAutomaticResearchPreparation: dependencies.processAutomaticResearchPreparation }));
vi.mock("@/lib/workflow/process", () => ({ processWorkflowTasks: dependencies.processWorkflowTasks }));
vi.mock("@/lib/email/retry", () => ({ retryFailedEmails: dependencies.retryFailedEmails }));
vi.mock("@/lib/commerce/workers", () => ({ processChunk4Workers: dependencies.processChunk4Workers }));
vi.mock("@/lib/documents/draft-queue-server", () => ({ processMaterialDraftQueue: dependencies.processMaterialDraftQueue }));
vi.mock("@/lib/commerce/checkout-initiation", () => ({ reconcileCheckoutInitiations: dependencies.reconcileCheckoutInitiations }));
vi.mock("@/lib/job-board/stripe-events", () => ({ reconcileBoardSubscriptions: dependencies.reconcileBoardSubscriptions }));
vi.mock("@/lib/stripe/server", () => ({ createStripeOperationalClient: dependencies.stripeClient }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: dependencies.sendTransactionalEmail }));

import { POST } from "@/app/api/cron/maintenance/route";
function query() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "update", "delete", "eq", "not", "is", "lt", "lte", "gte", "in", "order", "limit", "maybeSingle"]) chain[method] = vi.fn(() => chain);
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
    vi.stubEnv("APP_SERVICE_RETENTION_ENABLED", "true");
    vi.stubEnv("APP_MATERIAL_DRAFT_QUEUE_ENABLED", "false");
    vi.stubEnv("APP_AUTOMATIC_RESEARCH_ENABLED", "false");
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
    dependencies.processServiceRetention.mockResolvedValue({ claimed: 0, attempted: 0, deleted: 0, completed: 0, failed: 0 });
    dependencies.processPendingDocumentExtractions.mockResolvedValue({ processed: 0, succeeded: 0 });
    dependencies.processPendingFileScans.mockResolvedValue({ processed: 0 });
    dependencies.processPendingFeasibilityRequests.mockResolvedValue({ processed: 0 });
    dependencies.processWorkflowTasks.mockResolvedValue({ processed: 0 });
    dependencies.retryFailedEmails.mockResolvedValue({ processed: 0 });
    dependencies.processChunk4Workers.mockResolvedValue({ status: "enabled", processed: 0 });
    dependencies.processMaterialDraftQueue.mockResolvedValue({ status: "COMPLETE", claimed: 0, prepared: 0, generated: 0, rendered: 0, held: 0, unknown: 0, failed: 0 });
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
    expect(dependencies.processServiceRetention).not.toHaveBeenCalled();
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
  it("keeps the new draft queue dormant unless separately enabled", async () => {
    expect((await POST(request())).status).toBe(200); expect(dependencies.processMaterialDraftQueue).not.toHaveBeenCalled();
  });
  it("continues bounded paid document work during a purchasing hold and passes request cancellation", async () => {
    vi.stubEnv("APP_MATERIAL_DRAFT_QUEUE_ENABLED", "true");
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: ["PAYMENT_INTEGRITY_NOT_READY"], failClosedCodes: ["PAYMENT_INTEGRITY_NOT_READY"], repairableCodes: [] });
    const req = request(), response = await POST(req); expect(response.status).toBe(200);
    expect(dependencies.processMaterialDraftQueue).toHaveBeenCalledOnce();
    const options = dependencies.processMaterialDraftQueue.mock.calls[0][1]; expect(options.signal).toBe(req.signal);
    const signal = new AbortController().signal; options.uploadClientFactory(signal);
    expect(dependencies.adminClient).toHaveBeenLastCalledWith({ signal });
    expect(await response.json()).toMatchObject({ materialDrafts: { status: "COMPLETE", claimed: 0 }, queueStages: { materialDrafts: "SUCCEEDED" } });
  });
  it.each(["FILE_SAFETY_NOT_READY", "ENCRYPTION_NOT_READY", "SOURCE_PERMISSION_COVERAGE_MISSING"])("blocks enabled drafting for %s without invoking its ports", async (code) => {
    vi.stubEnv("APP_MATERIAL_DRAFT_QUEUE_ENABLED", "true");
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: [code], failClosedCodes: [code], repairableCodes: [] });
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(dependencies.processMaterialDraftQueue).not.toHaveBeenCalled(); expect(await response.json()).toMatchObject({ queueStages: { materialDrafts: "SKIPPED" } });
  });
  it.each(["RESULT_UNKNOWN", "HELD", "FAILED"])("records %s draft work as incomplete while other maintenance proceeds", async (status) => {
    vi.stubEnv("APP_MATERIAL_DRAFT_QUEUE_ENABLED", "true");
    dependencies.processMaterialDraftQueue.mockResolvedValue({ status, claimed: 1, prepared: 0, generated: 0, rendered: 0, held: Number(status === "HELD"), unknown: Number(status === "RESULT_UNKNOWN"), failed: Number(status === "FAILED") });
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ queueStages: { materialDrafts: "FAILED" } }); expect(dependencies.retryFailedEmails).toHaveBeenCalledOnce();
  });
  it("retains unpaid cleanup during an encryption hold without parsing documents", async () => {
    dependencies.recordMaintenanceDiagnosis.mockResolvedValue({ codes: ["ENCRYPTION_NOT_READY"], failClosedCodes: ["ENCRYPTION_NOT_READY"], repairableCodes: [] });
    expect((await POST(request())).status).toBe(503);
    expect(dependencies.processPendingDocumentExtractions).not.toHaveBeenCalled();
    expect(dependencies.processUnpaidSourceRetention).toHaveBeenCalledWith(expect.anything(), 10);
    expect(dependencies.processServiceRetention).toHaveBeenCalledWith();
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
  function cleanupRace(bucket: string, current: (row: { id: string; bucket: string; storage_path: string; attempts: number }) => unknown) {
    const row = { id: "cleanup-original", bucket, storage_path: "synthetic/material.pdf", attempts: 2 };
    const events: string[] = [];
    const queueQueries: ReturnType<typeof query>[] = [];
    const remove = vi.fn(async () => { events.push("remove"); return { error: null }; });
    const from = vi.fn((table: string) => {
      const chain = query();
      if (table !== "storage_cleanup_queue") return chain;
      const index = queueQueries.length;
      queueQueries.push(chain);
      chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => {
        if (index === 0) return { data: null, error: null, count: 0 };
        if (index === 1) { events.push("fetch"); return { data: [row], error: null }; }
        if (index === 2) { events.push("reread"); return current(row); }
        events.push("finish"); return { data: null, error: null };
      }).then(resolve, reject);
      return chain;
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === "ap_legacy_retention_object_allowed") { events.push("durable-intent"); return { data: true, error: null }; }
      return { data: 0, error: null };
    });
    dependencies.adminClient.mockReturnValue({ from, rpc, storage: { from: vi.fn(() => ({ remove })) } });
    return { row, events, queueQueries, remove, rpc };
  }
  it.each(["operator-drafts", "customer-deliveries", "operator-render-previews"])("preserves a %s upload when committed registration removed the fetched cleanup row", async bucket => {
    const state = cleanupRace(bucket, () => ({ data: null, error: null }));
    expect((await POST(request())).status).toBe(200);
    expect(state.events).toEqual(["fetch", "durable-intent", "reread"]);
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.queueQueries).toHaveLength(3);
    const recheck = state.queueQueries[2];
    expect(recheck.eq).toHaveBeenCalledWith("id", state.row.id);
    expect(recheck.eq).toHaveBeenCalledWith("bucket", state.row.bucket);
    expect(recheck.eq).toHaveBeenCalledWith("storage_path", state.row.storage_path);
    expect(recheck.lt).toHaveBeenCalledWith("attempts", 20);
    expect(recheck.lte).toHaveBeenCalledWith("not_before", expect.any(String));
    expect(recheck.maybeSingle).toHaveBeenCalledOnce();
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
  });
  it("removes a still-queued orphan only after the durable intent and exact-row read", async () => {
    const state = cleanupRace("operator-drafts", row => ({ data: row, error: null }));
    expect((await POST(request())).status).toBe(200);
    expect(state.events).toEqual(["fetch", "durable-intent", "reread", "remove", "finish"]);
    expect(state.remove).toHaveBeenCalledWith([state.row.storage_path]);
    expect(state.queueQueries[3].delete).toHaveBeenCalledOnce();
    expect(state.queueQueries[3].eq).toHaveBeenCalledWith("id", state.row.id);
  });
  it.each([
    { data: null, error: { message: "private database detail" } },
    { data: { id: "replacement-intent", bucket: "operator-drafts", storage_path: "synthetic/material.pdf" }, error: null },
    { data: { id: "cleanup-original", bucket: "customer-deliveries", storage_path: "synthetic/material.pdf" }, error: null },
    { data: { id: "cleanup-original", bucket: "operator-drafts", storage_path: "different/material.pdf" }, error: null },
  ])("fails closed on an unreadable or changed cleanup intent without stopping paid work (%j)", async current => {
    const state = cleanupRace("operator-drafts", () => current);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
    expect(state.remove).not.toHaveBeenCalled();
    expect(state.queueQueries).toHaveLength(3);
    expect(dependencies.processWorkflowTasks).toHaveBeenCalledOnce();
    expect(dependencies.recordMaintenanceOutcome).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(),
      expect.arrayContaining([{ code: "EXPIRATION_CLEANUP", status: "FAILED" }]), expect.any(Date), ["BOARD_RECOMPUTATION"]);
  });
  it("retains the upload on a lost post-intent queue response", async () => {
    const state = cleanupRace("operator-drafts", () => { throw new Error("private transport detail"); });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private transport detail");
    expect(state.remove).not.toHaveBeenCalled();
    expect(dependencies.reconcileCheckoutInitiations).toHaveBeenCalledOnce();
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
  it("reports one-off cleanup failure while other paid obligations continue", async () => {
    dependencies.processServiceRetention.mockResolvedValue({ claimed: 1, attempted: 1, deleted: 0, completed: 0, failed: 1 });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ queueStages: { serviceRetention: "FAILED" } });
    expect(dependencies.reconcileCheckoutInitiations).toHaveBeenCalledOnce();
    expect(dependencies.processChunk4Workers).toHaveBeenCalledOnce();
  });
  it.each([undefined, "false", "TRUE"])("does not execute service-content deletion without explicit enablement (%s)", async (enabled) => {
    vi.stubEnv("APP_SERVICE_RETENTION_ENABLED", enabled);
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ queueStages: { serviceRetention: "SKIPPED" } });
    expect(dependencies.processServiceRetention).not.toHaveBeenCalled();
    expect(dependencies.reconcileCheckoutInitiations).toHaveBeenCalledOnce();
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
  it.each([undefined, "false", "TRUE"])("does not claim research without exact enablement (%s)", async enabled => {
    vi.stubEnv("APP_AUTOMATIC_RESEARCH_ENABLED", enabled);
    const result = await (await POST(request())).json();
    expect(dependencies.processAutomaticResearchPreparation).not.toHaveBeenCalled();
    expect(result.queueStages).not.toHaveProperty("researchPreparation");
    expect(dependencies.processPendingFeasibilityRequests).toHaveBeenCalledOnce();
  });
  it("runs one bounded preparation stage before feasibility and passes cancellation", async () => {
    vi.stubEnv("APP_AUTOMATIC_RESEARCH_ENABLED", "true");
    dependencies.processAutomaticResearchPreparation.mockResolvedValue({ status: "ADVANCED", processed: 1 });
    const req = request(), result = await (await POST(req)).json();
    expect(result.queueStages.researchPreparation).toBe("SUCCEEDED");
    expect(dependencies.processAutomaticResearchPreparation).toHaveBeenCalledExactlyOnceWith({ signal: req.signal });
    expect(dependencies.processAutomaticResearchPreparation.mock.invocationCallOrder[0]).toBeLessThan(dependencies.processPendingFeasibilityRequests.mock.invocationCallOrder[0]);
  });
  it("reports an uncertain research outcome while preserving paid processors", async () => {
    vi.stubEnv("APP_AUTOMATIC_RESEARCH_ENABLED", "true");
    dependencies.processAutomaticResearchPreparation.mockResolvedValue({ status: "RESULT_UNKNOWN", processed: 0 });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).queueStages.researchPreparation).toBe("FAILED");
    expect(dependencies.processChunk4Workers).toHaveBeenCalledOnce();
    expect(dependencies.reconcileCheckoutInitiations).toHaveBeenCalledOnce();
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { classifyMaintenanceResponse, runMaintenanceOnce } from "./run-maintenance-once.mjs";

const environment = { APP_MAINTENANCE_URL: "https://applypack-staging-staging.up.railway.app/api/cron/maintenance", CRON_SECRET: "synthetic-private-token" };
const blocked = { ok: false, deletedSources: 0, diagnostics: { unresolvedCodes: ["ENCRYPTION_NOT_READY"], failedActionCodes: [],
  actions: [{ code: "DOCUMENT_PROCESSING", status: "SKIPPED" }] } };

test("explicit dependency hold exits normally but never claims readiness", () => {
  assert.deepEqual(classifyMaintenanceResponse(503, blocked), { exitCode: 0,
    report: { status: "BLOCKED", ready: false, httpStatus: 503, codes: ["ENCRYPTION_NOT_READY"], counts: { deletedSources: 0 } } });
  assert.equal(classifyMaintenanceResponse(503, { codes: ["DATABASE_NOT_READY"] }).report.status, "BLOCKED");
});
test("execution failures and unknown conditions remain failures", () => {
  for (const status of [401, 403, 500, 302]) assert.equal(classifyMaintenanceResponse(status, blocked).exitCode, 1);
  assert.equal(classifyMaintenanceResponse(503, { code: "MAINTENANCE_DIAGNOSIS_FAILED" }).exitCode, 1);
  assert.equal(classifyMaintenanceResponse(503, { codes: ["CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN"] }).exitCode, 1);
  assert.equal(classifyMaintenanceResponse(503, { ...blocked, diagnostics: { ...blocked.diagnostics,
    actions: [{ code: "DOCUMENT_PROCESSING", status: "FAILED" }] } }).exitCode, 1);
  assert.equal(classifyMaintenanceResponse(503, { ...blocked, diagnostics: { ...blocked.diagnostics,
    unresolvedCodes: ["ENCRYPTION_NOT_READY", "OUTBOX_QUEUE_STALE"] } }).exitCode, 1);
  assert.equal(classifyMaintenanceResponse(200, { ok: true }).exitCode, 1);
});
test("complete verified response succeeds using counts only", () => {
  const result = classifyMaintenanceResponse(200, { ok: true, recipient: "private@example.invalid", deletedSources: 2,
    diagnostics: { unresolvedCodes: [], failedActionCodes: [], actions: [{ code: "EXPIRATION_CLEANUP", status: "SUCCEEDED" }] } });
  assert.equal(result.report.status, "SUCCEEDED");
  assert.doesNotMatch(JSON.stringify(result), /private|recipient/);
});
test("URL allowlist rejects redirects, alternate paths, credentials, queries and foreign origins before send", async () => {
  for (const url of ["http://applypack.work/api/cron/maintenance", "https://evil.invalid/api/cron/maintenance",
    "https://applypack.work/api/cron/maintenance?token=private", "https://user:password@applypack.work/api/cron/maintenance",
    "https://applypack.work/api/cron/maintenance/"]) {
    let calls = 0;
    const result = await runMaintenanceOnce({ ...environment, APP_MAINTENANCE_URL: url }, () => { calls++; throw new Error("must not send"); });
    assert.equal(calls, 0);
    assert.equal(result.exitCode, 1);
    assert.doesNotMatch(JSON.stringify(result), /private|password|evil/);
  }
});
test("one bounded POST does not follow redirects or expose token/network errors", async () => {
  let calls = 0;
  const result = await runMaintenanceOnce(environment, async (_url, options) => {
    calls++;
    assert.equal(options.method, "POST"); assert.equal(options.redirect, "manual");
    assert.equal(options.headers.authorization, "Bearer synthetic-private-token");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify(blocked), { status: 503 });
  });
  assert.equal(calls, 1); assert.equal(result.report.status, "BLOCKED");
  const failed = await runMaintenanceOnce(environment, async () => { throw new Error(environment.CRON_SECRET); });
  assert.equal(failed.exitCode, 1); assert.doesNotMatch(JSON.stringify(failed), /synthetic-private-token/);
});

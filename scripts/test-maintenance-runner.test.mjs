import assert from "node:assert/strict";
import test from "node:test";
import { classifyMaintenanceResponse, runMaintenanceOnce } from "./run-maintenance-once.mjs";

const releaseSha = "a".repeat(40);
const deployment = { environment: "staging", releaseSha };
const environment = { APP_DEPLOYMENT_ENV: "staging", APP_EXPECTED_RELEASE_SHA: releaseSha, APP_MAINTENANCE_URL: "https://applypack-staging-staging.up.railway.app/api/cron/maintenance", CRON_SECRET: "synthetic-private-token" };
const blocked = { deployment, ok: false, deletedSources: 0, diagnostics: { unresolvedCodes: ["ENCRYPTION_NOT_READY"], failedActionCodes: [],
  actions: [{ code: "DOCUMENT_PROCESSING", status: "SKIPPED" }] } };

function withVersionPreflight(maintenanceFetcher) {
  return async (url, options) => {
    if (options.method === "GET") {
      assert.equal(url.pathname, "/api/health");
      assert.equal(options.redirect, "manual");
      assert.equal(options.cache, "no-store");
      assert.equal(options.headers.authorization, undefined);
      return new Response(JSON.stringify({ releaseSha, checks: { releaseSha: true } }), { status: 503 });
    }
    return maintenanceFetcher(url, options);
  };
}

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
test("a credential-free version preflight precedes the bounded POST without following redirects", async () => {
  let calls = 0;
  const result = await runMaintenanceOnce(environment, withVersionPreflight(async (_url, options) => {
    calls++;
    assert.equal(options.method, "POST"); assert.equal(options.redirect, "manual");
    assert.equal(options.headers.authorization, "Bearer synthetic-private-token");
    assert.equal(options.headers["x-applypack-expected-environment"], "staging");
    assert.equal(options.headers["x-applypack-expected-release-sha"], releaseSha);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify(blocked), { status: 503 });
  }));
  assert.equal(calls, 1); assert.equal(result.report.status, "BLOCKED");
  const failed = await runMaintenanceOnce(environment, async () => { throw new Error(environment.CRON_SECRET); });
  assert.equal(failed.exitCode, 1); assert.doesNotMatch(JSON.stringify(failed), /synthetic-private-token/);
});


test("only explicitly approved dormant board actions may be skipped in a healthy response", () => {
  const body = { ok: true, allowedSkippedActions: ["STRIPE_RECONCILIATION", "BOARD_RECOMPUTATION"],
    diagnostics: { unresolvedCodes: [], failedActionCodes: [], actions: [
      { code: "EXPIRATION_CLEANUP", status: "SUCCEEDED" },
      { code: "STRIPE_RECONCILIATION", status: "SKIPPED" },
      { code: "BOARD_RECOMPUTATION", status: "SKIPPED" },
    ] } };
  assert.equal(classifyMaintenanceResponse(200, body).exitCode, 0);
  for (const allowedSkippedActions of [undefined, ["BOARD_RECOMPUTATION"], ["DOCUMENT_PROCESSING"], ["private-invalid"]]) {
    assert.equal(classifyMaintenanceResponse(200, { ...body, allowedSkippedActions }).exitCode, 1);
  }
  for (const action of [{ code: "STRIPE_RECONCILIATION", status: "FAILED" },
    { code: "DOCUMENT_PROCESSING", status: "SKIPPED" }, { code: "BOUNDED_QUEUE_PROCESSING", status: "SKIPPED" }]) {
    assert.equal(classifyMaintenanceResponse(200, { ...body,
      diagnostics: { ...body.diagnostics, actions: [...body.diagnostics.actions, action] } }).exitCode, 1);
  }
});

test("environment, matching origin and full frozen SHA are mandatory before sending any credential", async () => {
  for (const overrides of [
    { APP_DEPLOYMENT_ENV: undefined }, { APP_DEPLOYMENT_ENV: "preview" }, { APP_DEPLOYMENT_ENV: "production" },
    { APP_MAINTENANCE_URL: "https://applypack.work/api/cron/maintenance" },
    { APP_EXPECTED_RELEASE_SHA: undefined }, { APP_EXPECTED_RELEASE_SHA: "a".repeat(7) },
    { APP_EXPECTED_RELEASE_SHA: "A".repeat(40) }, { APP_EXPECTED_RELEASE_SHA: "a".repeat(41) },
  ]) {
    let calls = 0;
    const result = await runMaintenanceOnce({ ...environment, ...overrides }, () => { calls++; throw new Error("must not send"); });
    assert.equal(calls, 0); assert.equal(result.exitCode, 1);
  }
});

test("same-request response must identify the expected environment and frozen SHA even during a dependency hold", async () => {
  for (const responseDeployment of [undefined, { environment: "production", releaseSha },
    { environment: "staging", releaseSha: "b".repeat(40) }, { environment: "staging", releaseSha: releaseSha.slice(0, 7) }]) {
    const result = await runMaintenanceOnce(environment, withVersionPreflight(async () => new Response(
      JSON.stringify({ ...blocked, deployment: responseDeployment }), { status: 503 })));
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.report.codes, ["MAINTENANCE_DEPLOYMENT_MISMATCH"]);
  }
});

test("the production runner accepts only the matching production response and records its verified identity", async () => {
  const production = { ...environment, APP_DEPLOYMENT_ENV: "production",
    APP_MAINTENANCE_URL: "https://applypack.work/api/cron/maintenance" };
  const result = await runMaintenanceOnce(production, withVersionPreflight(async (url, options) => {
    assert.equal(url.origin, "https://applypack.work");
    assert.equal(options.headers["x-applypack-expected-environment"], "production");
    return new Response(JSON.stringify({ ...blocked, deployment: { environment: "production", releaseSha } }), { status: 503 });
  }));
  assert.equal(result.exitCode, 0); assert.equal(result.report.status, "BLOCKED");
  assert.deepEqual(result.report.deployment, { environment: "production", releaseSha });
});


test("missing, stale, or unbound deployed versions stop before maintenance receives any credential", async () => {
  for (const body of [{}, { releaseSha: "b".repeat(40), checks: { releaseSha: true } },
    { releaseSha: releaseSha.slice(0, 7), checks: { releaseSha: true } }, { releaseSha, checks: { releaseSha: false } }]) {
    let calls = 0;
    const result = await runMaintenanceOnce(environment, async (url, options) => {
      calls++; assert.equal(options.method, "GET"); assert.equal(url.pathname, "/api/health");
      assert.equal(options.headers.authorization, undefined);
      return new Response(JSON.stringify(body), { status: 200 });
    });
    assert.equal(calls, 1); assert.equal(result.exitCode, 1);
    assert.deepEqual(result.report.codes, ["MAINTENANCE_DEPLOYMENT_MISMATCH"]);
  }
});

test("version-probe redirects and HTTP failures stop before the maintenance POST", async () => {
  for (const status of [301, 302, 401, 404, 500]) {
    let calls = 0;
    const result = await runMaintenanceOnce(environment, async (_url, options) => {
      calls++; assert.equal(options.method, "GET");
      return new Response(JSON.stringify({ releaseSha, checks: { releaseSha: true } }), { status });
    });
    assert.equal(calls, 1); assert.equal(result.exitCode, 1);
  }
});

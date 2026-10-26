import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const origins = Object.freeze({
  production: "https://applypack.work",
  staging: "https://applypack-staging-staging.up.railway.app",
});
const dormantActionCodes = new Set(["STRIPE_RECONCILIATION", "BOARD_RECOMPUTATION"]);
const dependencyCodes = new Set([
  "DATABASE_NOT_READY", "PAYMENT_INTEGRITY_NOT_READY", "EMAIL_NOT_READY", "FILE_SAFETY_NOT_READY",
  "ENCRYPTION_NOT_READY", "DOCUMENT_RENDERING_NOT_READY", "SOURCE_PERMISSION_COVERAGE_MISSING",
]);
const countNames = ["expiredReservations", "expiredCarts", "removedRateLimits", "deletedSources", "deletedDrafts",
  "recoveredStorageObjects", "staleJobs", "alerts"];

function safeCodes(values) {
  return Array.isArray(values) && values.every((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value))
    ? [...new Set(values)] : null;
}

export function classifyMaintenanceResponse(status, body) {
  const diagnostics = body?.diagnostics;
  const unresolved = safeCodes(diagnostics?.unresolvedCodes ?? body?.codes ?? (body?.code ? [body.code] : []));
  const failedActions = safeCodes(diagnostics?.failedActionCodes ?? []);
  const actions = diagnostics?.actions;
  const allowedSkippedActions = safeCodes(body?.allowedSkippedActions ?? []);
  const validSkippedActions = allowedSkippedActions !== null
    && allowedSkippedActions.every(code => dormantActionCodes.has(code));
  const allowedSkipped = new Set(validSkippedActions ? allowedSkippedActions : []);
  const validActions = Array.isArray(actions) && actions.every((action) => action &&
    safeCodes([action.code]) && ["SUCCEEDED", "FAILED", "SKIPPED"].includes(action.status));
  const anyActionFailed = !failedActions || failedActions.length > 0
    || (Array.isArray(actions) && actions.some((action) => action?.status === "FAILED"))
    || (body?.queueStages && Object.values(body.queueStages).some((value) => value === "FAILED"));
  const counts = Object.fromEntries(countNames.filter((name) => Number.isSafeInteger(body?.[name]) && body[name] >= 0)
    .map((name) => [name, body[name]]));
  const codes = unresolved || ["MAINTENANCE_RESPONSE_INVALID"];
  if (status === 200 && body?.ok === true && validActions && validSkippedActions && actions.length > 0
    && actions.every((action) => action.status === "SUCCEEDED"
      || (action.status === "SKIPPED" && allowedSkipped.has(action.code))) && !anyActionFailed && codes.length === 0) {
    return { exitCode: 0, report: { status: "SUCCEEDED", ready: true, httpStatus: status, codes, counts } };
  }
  // Only recognized dependency holds are ordinary blocked runs. Unknown/stale
  // queue/integrity/action-failure codes remain failures, even alongside a hold.
  const completedWithHold = body?.ok === false && validActions && validSkippedActions && !anyActionFailed;
  const explicitGlobalHold = !diagnostics && Array.isArray(body?.codes) && !body?.code;
  if (status === 503 && (completedWithHold || explicitGlobalHold) && !anyActionFailed
    && codes.length > 0 && codes.every((code) => dependencyCodes.has(code))) {
    return { exitCode: 0, report: { status: "BLOCKED", ready: false, httpStatus: status, codes, counts } };
  }
  return { exitCode: 1, report: { status: "FAILED", ready: false, httpStatus: status,
    codes: codes.length ? codes : ["MAINTENANCE_EXECUTION_FAILED"], counts } };
}

async function readBoundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("response");
  let size = 0; const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 64 * 1024) { await reader.cancel(); throw new Error("response"); }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function deploymentMismatch() {
  return { exitCode: 1, report: { status: "FAILED", ready: false,
    codes: ["MAINTENANCE_DEPLOYMENT_MISMATCH"], counts: {} } };
}

export async function runMaintenanceOnce(environment = process.env, fetcher = fetch) {
  try {
    const url = new URL(environment.APP_MAINTENANCE_URL || "");
    const deploymentEnvironment = environment.APP_DEPLOYMENT_ENV;
    const releaseSha = environment.APP_EXPECTED_RELEASE_SHA;
    if (!Object.hasOwn(origins, deploymentEnvironment) || url.origin !== origins[deploymentEnvironment]
      || !/^[a-f0-9]{40}$/.test(releaseSha || "") || url.pathname !== "/api/cron/maintenance"
      || url.username || url.password || url.search || url.hash || !environment.CRON_SECRET?.trim()) {
      throw new Error("configuration");
    }
    // One draft stage may use150 seconds. Keep the whole invocation bounded
    // while leaving time for preceding queues and the final diagnosis.
    const signal = AbortSignal.timeout(300_000);
    // An older deployed handler cannot enforce the new request headers. Check its
    // revision without credentials before posting; the route guard closes deploy races.
    const versionResponse = await fetcher(new URL("/api/health", url.origin), {
      method: "GET", redirect: "manual", cache: "no-store", headers: { accept: "application/json" }, signal,
    });
    if (![200, 503].includes(versionResponse.status)) return deploymentMismatch();
    const version = await readBoundedJson(versionResponse);
    if (version?.releaseSha !== releaseSha || version?.checks?.releaseSha !== true) return deploymentMismatch();
    const response = await fetcher(url, { method: "POST", redirect: "manual",
      // The authenticated route verifies both headers before any maintenance write.
      headers: { authorization: `Bearer ${environment.CRON_SECRET}`, accept: "application/json",
        "x-applypack-expected-environment": deploymentEnvironment,
        "x-applypack-expected-release-sha": releaseSha },
      signal });
    const body = await readBoundedJson(response);
    if (body?.deployment?.environment !== deploymentEnvironment || body?.deployment?.releaseSha !== releaseSha) {
      return deploymentMismatch();
    }
    const result = classifyMaintenanceResponse(response.status, body);
    result.report.deployment = { environment: deploymentEnvironment, releaseSha };
    return result;
  } catch {
    // No raw response, URLs, exception messages, headers, or credentials enter logs.
    return { exitCode: 1, report: { status: "FAILED", ready: false, codes: ["MAINTENANCE_REQUEST_FAILED"], counts: {} } };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runMaintenanceOnce();
  console.log(JSON.stringify(result.report));
  process.exitCode = result.exitCode;
}

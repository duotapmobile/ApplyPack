import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const origins = new Set(["https://applypack.work", "https://applypack-staging-staging.up.railway.app"]);
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
  const validActions = Array.isArray(actions) && actions.every((action) => action &&
    safeCodes([action.code]) && ["SUCCEEDED", "FAILED", "SKIPPED"].includes(action.status));
  const anyActionFailed = !failedActions || failedActions.length > 0
    || (Array.isArray(actions) && actions.some((action) => action?.status === "FAILED"))
    || (body?.queueStages && Object.values(body.queueStages).some((value) => value === "FAILED"));
  const counts = Object.fromEntries(countNames.filter((name) => Number.isSafeInteger(body?.[name]) && body[name] >= 0)
    .map((name) => [name, body[name]]));
  const codes = unresolved || ["MAINTENANCE_RESPONSE_INVALID"];
  if (status === 200 && body?.ok === true && validActions && actions.length > 0
    && actions.every((action) => action.status === "SUCCEEDED") && !anyActionFailed && codes.length === 0) {
    return { exitCode: 0, report: { status: "SUCCEEDED", ready: true, httpStatus: status, codes, counts } };
  }
  // Only recognized dependency holds are ordinary blocked runs. Unknown/stale
  // queue/integrity/action-failure codes remain failures, even alongside a hold.
  const completedWithHold = body?.ok === false && validActions && !anyActionFailed;
  const explicitGlobalHold = !diagnostics && Array.isArray(body?.codes) && !body?.code;
  if (status === 503 && (completedWithHold || explicitGlobalHold) && !anyActionFailed
    && codes.length > 0 && codes.every((code) => dependencyCodes.has(code))) {
    return { exitCode: 0, report: { status: "BLOCKED", ready: false, httpStatus: status, codes, counts } };
  }
  return { exitCode: 1, report: { status: "FAILED", ready: false, httpStatus: status,
    codes: codes.length ? codes : ["MAINTENANCE_EXECUTION_FAILED"], counts } };
}

export async function runMaintenanceOnce(environment = process.env, fetcher = fetch) {
  try {
    const url = new URL(environment.APP_MAINTENANCE_URL || "");
    if (!origins.has(url.origin) || url.pathname !== "/api/cron/maintenance"
      || url.username || url.password || url.search || url.hash || !environment.CRON_SECRET?.trim()) {
      throw new Error("configuration");
    }
    const response = await fetcher(url, { method: "POST", redirect: "manual",
      headers: { authorization: `Bearer ${environment.CRON_SECRET}`, accept: "application/json" },
      signal: AbortSignal.timeout(120_000) });
    // Bound response memory while retaining the same request timeout through body read.
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
    return classifyMaintenanceResponse(response.status, JSON.parse(Buffer.concat(chunks).toString("utf8")));
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

import { boundedRecoveryJson } from "./protected-recovery-transport.mjs";
const origin = "https://applypack.work";
const fail = (code) => { throw new Error(`ARCHIVE_LIFECYCLE_HTTP_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const secretFields = Object.freeze({ FILE: "APP_RECOVERY_COMPLETION_SECRET", DATABASE: "APP_DATABASE_BACKUP_LIFECYCLE_SECRET", RETENTION: "APP_RECOVERY_RETENTION_SECRET" });

/** Worker identity and capability are fixed by its runtime, never CLI URLs or
 * request body fields. No retries, redirects, browser cookies or default keys. */
export function createArchiveLifecycleHttpTransport(environment = process.env, kind, fetchImpl = fetch) {
  requireValue(Object.hasOwn(secretFields, kind), "KIND");
  const releaseSha = environment.APP_EXPECTED_RELEASE_SHA; const secret = environment[secretFields[kind]];
  requireValue(environment.APP_ARCHIVE_LIFECYCLE_ENABLED === "true" && environment.APP_DEPLOYMENT_ENV === "production"
    && environment.APP_BASE_URL === origin && /^[a-f0-9]{40}$/u.test(releaseSha || "") && environment.RAILWAY_GIT_COMMIT_SHA === releaseSha
    && /^[A-Za-z0-9_+/=-]{43,256}$/u.test(secret || ""), "CONFIGURATION");
  const call = async (action, values, signal) => {
    requireValue(signal instanceof AbortSignal && !signal.aborted, "ABORTED");
    let response;
    try { response = await fetchImpl(`${origin}/api/internal/archive-lifecycle`, { method: "POST", redirect: "error", cache: "no-store", credentials: "omit",
      headers: { authorization: `Bearer ${secret}`, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ action, ...values }), signal }); } catch { fail("TRANSPORT"); }
    return boundedRecoveryJson(response, 8 * 1024 * 1024);
  };
  if (kind !== "RETENTION") return Object.freeze({ releaseSha,
    begin: ({ runId, signal }) => call("WRITER_BEGIN", { runId, kind }, signal),
    dispatch: ({ runId, signal }) => call("WRITER_DISPATCH", { runId }, signal),
    complete: ({ runId, manifestSha256, manifestVersionId, signal }) => call("WRITER_COMPLETE", { runId, manifestSha256, manifestVersionId }, signal),
    cancel: ({ runId, signal }) => call("WRITER_CANCEL", { runId }, signal),
    status: ({ runId, signal }) => call("WRITER_STATUS", { runId }, signal),
  });
  return Object.freeze({ releaseSha,
    begin: ({ runId, signal }) => call("RETENTION_BEGIN", { runId }, signal),
    prepare: ({ runId, signal }) => call("RETENTION_PREPARE", { runId }, signal),
    status: ({ runId, signal }) => call("RETENTION_STATUS", { runId }, signal),
    dispatch: ({ runId, key, versionId, planSha256, signal }) => call("RETENTION_DISPATCH", { runId, key, versionId, planSha256 }, signal),
    observe: ({ runId, key, versionId, observationSha256, signal }) => call("RETENTION_OBSERVE", { runId, key, versionId, observationSha256 }, signal),
    finish: ({ runId, planSha256, cancel, signal }) => call("RETENTION_FINISH", { runId, planSha256, cancel }, signal),
  });
}

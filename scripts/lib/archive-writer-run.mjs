import { randomUUID } from "node:crypto";

const fail = (code) => { throw new Error(`ARCHIVE_WRITER_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** Begin before any source snapshot/provider access. Once dispatch may have
 * committed, failure never expires or cancels that writer's pruning fence.
 * Completion is independently verified by the application, not this process. */
export async function runRegisteredArchiveWriter({ lifecycle, kind, releaseSha, execute, now = Date.now,
  runId = randomUUID(), maximumRunMilliseconds = 300000 }) {
  requireValue(["FILE", "DATABASE"].includes(kind) && /^[a-f0-9]{40}$/u.test(releaseSha || "")
    && /^[a-f0-9-]{36}$/u.test(runId || "") && lifecycle?.releaseSha === releaseSha
    && typeof execute === "function" && Number.isInteger(maximumRunMilliseconds)
    && maximumRunMilliseconds > 0 && maximumRunMilliseconds <= 300000, "CONFIGURATION");
  const controller = new AbortController(); const end = now() + maximumRunMilliseconds;
  const timer = setTimeout(() => controller.abort(), maximumRunMilliseconds);
  let dispatchAttempted = false;
  const check = () => requireValue(!controller.signal.aborted && now() < end, "TIMEOUT");
  const wait = async (action) => {
    check(); let listener;
    try {
      const result = await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
        listener = () => reject(new Error("ARCHIVE_WRITER_TIMEOUT")); controller.signal.addEventListener("abort", listener, { once: true });
      })]); check(); return result;
    } finally { if (listener) controller.signal.removeEventListener("abort", listener); }
  };
  const matches = (row, state) => row?.id === runId && row.kind === kind && row.release_sha === releaseSha && row.state === state;
  try {
    const opened = await wait(() => lifecycle.begin({ runId, signal: controller.signal }));
    requireValue(matches(opened, "OPEN") && opened.provider_dispatched === false, "BEGIN_BINDING");
    dispatchAttempted = true;
    const dispatched = await wait(() => lifecycle.dispatch({ runId, signal: controller.signal }));
    requireValue(matches(dispatched, "OPEN") && dispatched.provider_dispatched === true, "DISPATCH_BINDING");
    const result = await wait(() => execute({ signal: controller.signal, remainingMilliseconds: () => {
      check(); return Math.max(1, Math.floor(end - now()));
    } }));
    requireValue(sha(result?.manifestSha256) && typeof result.manifestVersionId === "string"
      && result.manifestVersionId !== "null" && /^[A-Za-z0-9._~+/=:-]{1,1024}$/u.test(result.manifestVersionId), "MANIFEST_IDENTITY");
    const exactCompletion = (row) => matches(row, "COMPLETE") && row.provider_dispatched === true
      && sha(row.result_sha256) && row.completion_receipt?.runId === runId
      && row.completion_receipt.kind === kind && row.completion_receipt.releaseSha === releaseSha
      && row.completion_receipt.manifestSha256 === result.manifestSha256
      && row.completion_receipt.manifestVersionId === result.manifestVersionId;
    let completed;
    try { completed = await wait(() => lifecycle.complete({ runId, manifestSha256: result.manifestSha256,
      manifestVersionId: result.manifestVersionId, signal: controller.signal })); } catch {
      // A read can recognize an already committed receipt. Never retry the
      // mutation or report an uploaded-but-unconfirmed archive as complete.
      completed = await wait(() => lifecycle.status({ runId, signal: controller.signal }));
    }
    requireValue(exactCompletion(completed), "COMPLETION_UNCONFIRMED");
    return { result, runId, completionReceiptSha256: completed.result_sha256 };
  } catch (error) {
    if (!dispatchAttempted && !controller.signal.aborted) {
      try {
        const row = await wait(() => lifecycle.status({ runId, signal: controller.signal }));
        if (matches(row, "OPEN") && row.provider_dispatched === false)
          await wait(() => lifecycle.cancel({ runId, signal: controller.signal }));
      } catch { /* Unknown begin remains fenced until explicit reconciliation. */ }
    }
    throw error;
  } finally { clearTimeout(timer); controller.abort(); }
}

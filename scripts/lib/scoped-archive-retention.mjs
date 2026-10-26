import { canonicalSha256 } from "./protected-recovery-core.mjs";

const fail = (code) => { throw new Error(`SCOPED_ARCHIVE_RETENTION_${code}`); };
const requireValue = (value, code) => { if (!value) fail(code); };
const permitted = (key) => /^(?:objects\/(?:customer-source-documents|customer-deliveries|operator-drafts|operator-render-previews)\/[a-f0-9]{64}|manifests\/[a-f0-9]{64}\.json)$/u.test(key || "");
const version = (v) => typeof v === "string" && v !== "null" && /^[A-Za-z0-9._~+/=:-]{1,1024}$/u.test(v);
const sha = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
function clock(now, limit) {
  requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 300000, "TIME_LIMIT");
  const controller = new AbortController(); const end = now() + limit; const timer = setTimeout(() => controller.abort(), limit);
  const check = () => requireValue(!controller.signal.aborted && now() < end, "TIMEOUT");
  const wait = async (action) => {
    check(); let listener;
    try { const result = await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      listener = () => reject(new Error("SCOPED_ARCHIVE_RETENTION_TIMEOUT")); controller.signal.addEventListener("abort", listener, { once: true });
    })]); check(); return result; }
    finally { if (listener) controller.signal.removeEventListener("abort", listener); }
  };
  return { signal: controller.signal, wait, check, close: () => { clearTimeout(timer); controller.abort(); } };
}
function assertPlan(result, runId, releaseSha) {
  const p = result?.plan;
  requireValue(p?.schemaVersion === "applypack-protected-recovery-execution-plan-v1" && p.runId === runId && p.releaseSha === releaseSha
    && p.databaseDeletionAuthorized === false && sha(result.digest) && result.digest === canonicalSha256(p)
    && result.run?.id === runId && result.run.release_sha === releaseSha && result.run.state === "PLANNED" && result.run.plan_sha256 === result.digest
    && Array.isArray(p.removals) && p.removals.length <= 1000 && Array.isArray(p.retained), "PLAN_BINDING");
  const seen = new Set();
  for (const item of p.removals) {
    const id = `${item.key}\u0000${item.versionId}`;
    requireValue(permitted(item.key) && version(item.versionId) && sha(item.identitySha256) && !seen.has(id), "EXACT_SCOPE"); seen.add(id);
  }
  return p;
}

/** The standalone retention process has only its delete/list identity. It never
 * receives the verifier's credentials or reads customer/document bytes. The
 * authenticated application independently prepares and observes each operation. */
export async function runScopedArchiveRetention({ lifecycle, deleter, runId, releaseSha, now = Date.now, maximumRunMilliseconds = 300000 }) {
  const c = clock(now, maximumRunMilliseconds); let run; let prepared; let uncertainDispatch = false;
  try {
    run = await c.wait(() => lifecycle.begin({ runId, signal: c.signal }));
    requireValue(run?.id === runId && run.release_sha === releaseSha && run.state === "FENCED", "BEGIN_BINDING");
    prepared = await c.wait(() => lifecycle.prepare({ runId, signal: c.signal }));
    const plan = assertPlan(prepared, runId, releaseSha);
    for (const item of plan.removals) {
      // Mark uncertainty before dispatch: a lost response can still mean the
      // database committed a permit, even before this process calls S3.
      uncertainDispatch = true;
      const accepted = await c.wait(() => lifecycle.dispatch({ runId, key: item.key, versionId: item.versionId, planSha256: prepared.digest, signal: c.signal }));
      requireValue(accepted?.run_id === runId && accepted.archive_key === item.key && accepted.version_id === item.versionId
        && accepted.identity_sha256 === item.identitySha256 && accepted.state === "DISPATCHED", "DISPATCH_BINDING");
      try { await c.wait(() => deleter.remove({ ...item, signal: c.signal })); } catch { c.check(); }
      const observed = await c.wait(() => lifecycle.observe({ runId, key: item.key, versionId: item.versionId,
        observationSha256: canonicalSha256({ runId, key: item.key, versionId: item.versionId, requested: "INDEPENDENT_ABSENCE" }), signal: c.signal }));
      requireValue(observed?.run_id === runId && observed.archive_key === item.key && observed.version_id === item.versionId
        && observed.state === "ABSENT" && sha(observed.observation_sha256), "ABSENCE_UNCONFIRMED");
      uncertainDispatch = false;
    }
    const completed = await c.wait(() => lifecycle.finish({ runId, planSha256: prepared.digest, cancel: false, signal: c.signal }));
    requireValue(completed?.id === runId && completed.release_sha === releaseSha && completed.state === "COMPLETE"
      && completed.plan_sha256 === prepared.digest, "COMPLETION_UNCONFIRMED");
    return { status: "EXACT_VERSIONS_ABSENT", runId, planSha256: prepared.digest, deletedVersionCount: plan.removals.length,
      retainedVersionCount: plan.retained.length, databaseDeletionPerformed: false };
  } catch {
    if (run && !uncertainDispatch && !c.signal.aborted) {
      try { await c.wait(() => lifecycle.finish({ runId, planSha256: prepared?.digest ?? null, cancel: true, signal: c.signal })); } catch { /* Persisted state remains locked. */ }
    }
    fail("RECONCILIATION_REQUIRED");
  } finally { c.close(); }
}

/** Explicit restart recovery never repeats DeleteObject. It only observes exact
 * absence, then cancels any not-yet-dispatched work. A present/uncertain version
 * stays fenced indefinitely until independently reconciled. */
export async function reconcileScopedArchiveRetention({ lifecycle, runId, releaseSha, now = Date.now, maximumRunMilliseconds = 300000 }) {
  const c = clock(now, maximumRunMilliseconds);
  const status = async () => {
    const value = await c.wait(() => lifecycle.status({ runId, signal: c.signal }));
    requireValue(value?.run?.id === runId && value.run.release_sha === releaseSha && Array.isArray(value.versions) && value.versions.length <= 1000, "STATUS_BINDING"); return value;
  };
  try {
    let current = await status();
    if (["COMPLETE", "CANCELED"].includes(current.run.state)) return { status: current.run.state, runId, databaseDeletionPerformed: false };
    for (const item of current.versions.filter((v) => v.state === "DISPATCHED")) {
      requireValue(item.run_id === runId && permitted(item.archive_key) && version(item.version_id), "EXACT_SCOPE");
      const observed = await c.wait(() => lifecycle.observe({ runId, key: item.archive_key, versionId: item.version_id,
        observationSha256: canonicalSha256({ runId, key: item.archive_key, versionId: item.version_id, requested: "INDEPENDENT_ABSENCE" }), signal: c.signal }));
      requireValue(observed?.run_id === runId && observed.archive_key === item.archive_key && observed.version_id === item.version_id
        && observed.state === "ABSENT" && sha(observed.observation_sha256), "ABSENCE_UNCONFIRMED");
    }
    current = await status(); requireValue(current.versions.every((v) => ["PLANNED", "ABSENT", "RETAINED"].includes(v.state)), "RECONCILIATION_REQUIRED");
    const result = await c.wait(() => lifecycle.finish({ runId, planSha256: current.run.plan_sha256 ?? null, cancel: true, signal: c.signal }));
    requireValue(result?.id === runId && result.state === "CANCELED", "RECONCILIATION_REQUIRED");
    return { status: "CANCELED_AFTER_EXACT_RECONCILIATION", runId, databaseDeletionPerformed: false };
  } finally { c.close(); }
}

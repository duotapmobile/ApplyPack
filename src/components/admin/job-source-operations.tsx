"use client";

import { useCallback, useEffect, useState } from "react";

type SourceRow = {
  id: string;
  sourceName: string;
  adapterKind: string;
  automationStatus: string;
  health: { health_status: string | null; last_health_checked_at: string | null } | null;
  schedule: {
    enabled: boolean;
    schedule_tier: string;
    next_run_at: string;
    paused_reason: string | null;
    consecutive_failures: number;
    state_revision: number;
  } | null;
  policy: { headRevision: number; authorization: { state: string; authorization_version: string } | null } | null;
};

type RunRow = {
  id: string;
  source_id: string;
  status: string;
  enumeration_status: string | null;
  projection_status: string;
  started_at: string;
  fetched_count: number;
  persisted_count: number;
  verified_count: number;
  quota_units: number;
  error_code: string | null;
};

type SourcePayload = { sources: SourceRow[]; recentRuns: RunRow[]; candidateSummary: Record<string, number> };

export function JobSourceOperations() {
  const [payload, setPayload] = useState<SourcePayload | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/job-sources", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Source operations could not be loaded.");
    setPayload(result);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/job-sources", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Source operations could not be loaded.");
        return result as SourcePayload;
      })
      .then((result) => { if (active) setPayload(result); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Source operations could not be loaded."); });
    return () => { active = false; };
  }, []);

  async function act(source: SourceRow, action: "health" | "sync" | "pause" | "resume") {
    setBusy(`${source.id}:${action}`);
    setMessage("");
    const reasonCode = action === "resume" ? "RESUME_AFTER_REVIEW" : action === "pause" ? "MANUAL_PAUSE" : undefined;
    try {
      const response = await fetch("/api/admin/job-sources", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(action === "sync" ? { "idempotency-key": crypto.randomUUID() } : {}),
        },
        body: JSON.stringify({
          sourceId: source.id,
          action,
          expectedStateRevision: source.schedule?.state_revision,
          reasonCode,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The source operation failed.");
      setMessage(action === "sync" ? "Bounded refresh queued." : action === "health" ? "Health check completed." : `Schedule ${action}d.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The source operation failed.");
    } finally {
      setBusy("");
    }
  }

  const visible = (payload?.sources || []).filter((source) => source.schedule || ["lever", "greenhouse", "ashby", "recruitee", "teamtailor"].includes(source.adapterKind));
  return <section className="admin-table-wrap" aria-labelledby="job-source-operations-title">
    <h2 id="job-source-operations-title">Employer source operations</h2>
    <p>Policy authorization, technical health, and scheduling are separate. Observations do not enter customer inventory automatically.</p>
    {message ? <p role="status">{message}</p> : null}
    {!payload ? <p>Loading source controls…</p> : <>
      <p>Discovery candidates: {Object.entries(payload.candidateSummary).map(([status, count]) => `${status} ${count}`).join(" · ") || "none recorded"}</p>
      <div className="admin-table-scroll"><table className="admin-table">
        <caption className="sr-only">Employer source policy, health, schedule, and controls</caption>
        <thead><tr><th scope="col">Source</th><th scope="col">Policy</th><th scope="col">Technical</th><th scope="col">Schedule</th><th scope="col">Controls</th></tr></thead>
        <tbody>{visible.map((source) => <tr key={source.id}>
          <th scope="row"><strong>{source.sourceName}</strong><span>{source.adapterKind}</span></th>
          <td>{source.policy?.authorization ? `${source.policy.authorization.state} · ${source.policy.authorization.authorization_version}` : "No employer authorization"}</td>
          <td>{source.health?.health_status || "Not checked"}</td>
          <td>{source.schedule ? `${source.schedule.enabled ? "Enabled" : "Paused"} · Tier ${source.schedule.schedule_tier} · ${source.schedule.paused_reason || "no hold"}` : "Not configured"}</td>
          <td><div className="admin-buttons">
            <button disabled={!source.schedule || Boolean(busy)} onClick={() => act(source, "health")} type="button">Check health</button>
            <button disabled={!source.schedule?.enabled || Boolean(busy)} onClick={() => act(source, "sync")} type="button">Queue refresh</button>
            {source.schedule?.enabled
              ? <button disabled={Boolean(busy)} onClick={() => act(source, "pause")} type="button">Pause</button>
              : <button disabled={!source.schedule || Boolean(busy)} onClick={() => act(source, "resume")} type="button">Resume</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>
      <h3>Recent source runs</h3>
      {payload.recentRuns.length ? <div className="admin-table-scroll"><table className="admin-table">
        <caption className="sr-only">Recent employer source run evidence</caption>
        <thead><tr><th scope="col">Source and time</th><th scope="col">Outcome</th><th scope="col">Counts</th><th scope="col">Error</th></tr></thead>
        <tbody>{payload.recentRuns.slice(0, 20).map((run) => <tr key={run.id}>
          <th scope="row"><strong>{run.source_id}</strong><span>{new Date(run.started_at).toLocaleString()}</span></th>
          <td>{run.status} · {run.enumeration_status || "unknown"} · {run.projection_status}</td>
          <td>Fetched {run.fetched_count} · persisted {run.persisted_count} · verified {run.verified_count} · quota {run.quota_units}</td>
          <td>{run.error_code || "None"}</td>
        </tr>)}</tbody>
      </table></div> : <p>No source runs are recorded.</p>}
    </>}
  </section>;
}

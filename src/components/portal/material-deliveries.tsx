"use client";

import { useEffect, useMemo, useState } from "react";

export type MaterialDeliveryView = {
  lineId: string;
  company: string;
  title: string;
  jobSnapshotId: string;
  stateLabel: string;
  stateMessage: string;
  dueAt: string | null;
  refundState: "NONE" | "PENDING" | "FAILED" | "SUCCEEDED";
  proposal: {
    id: string;
    kind: "SUBSTITUTION" | "FACT_CORRECTION";
    reasonCode: string;
    expiresAt: string;
    targetJobSnapshotId: string | null;
    targetCompany: string | null;
    targetTitle: string | null;
    factDiff: Record<string, unknown> | null;
  } | null;
  regeneration: { state: string; dueAt: string | null } | null;
  artifacts: Array<{
    id: string;
    type: "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET";
    version: number;
    filename: string;
    checksum: string;
    mimeType: string;
    createdAt: string;
    downloadsRevokedAt: string | null;
    supersededAt: string | null;
  }>;
};

type ReferenceResult = {
  opaqueId: string;
  reference: { name: string };
  allowedApplications: Array<{ permissionId: string; jobSnapshotId: string; employer: string; exactPosition: string }>;
};

function artifactLabel(type: MaterialDeliveryView["artifacts"][number]["type"]) {
  return type === "RESUME" ? "Tailored resume" : type === "COVER_LETTER" ? "Tailored cover letter" : "Application-specific reference sheet";
}

export function MaterialDeliveries({ lines }: { lines: MaterialDeliveryView[] }) {
  const [references, setReferences] = useState<ReferenceResult[]>([]);
  const [referenceSelections, setReferenceSelections] = useState<Record<string, string[]>>( {} );
  const [includeReference, setIncludeReference] = useState<Record<string, boolean>>( {} );
  const [supportFor, setSupportFor] = useState<string | null>(null);
  const [support, setSupport] = useState({ artifactId: "", field: "", documentText: "", correctFact: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/customer/references", { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : { references: [] })
      .then((body) => setReferences(Array.isArray(body.references) ? body.references : []))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const permissionsByJob = useMemo(() => {
    const map = new Map<string, Array<{ permissionId: string; name: string; employer: string; exactPosition: string }>>();
    for (const reference of references) {
      for (const permission of reference.allowedApplications || []) {
        const current = map.get(permission.jobSnapshotId) || [];
        current.push({ ...permission, name: reference.reference.name });
        map.set(permission.jobSnapshotId, current);
      }
    }
    return map;
  }, [references]);

  function togglePermission(key: string, permissionId: string) {
    setReferenceSelections((current) => {
      const values = current[key] || [];
      return { ...current, [key]: values.includes(permissionId) ? values.filter((id) => id !== permissionId) : values.length < 3 ? [...values, permissionId] : values };
    });
  }

  async function decide(line: MaterialDeliveryView, decision: "ACCEPT" | "DECLINE") {
    if (!line.proposal) return;
    const permissions = referenceSelections[line.proposal.id] || [];
    const include = Boolean(includeReference[line.proposal.id]);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/customer/material-proposals/${line.proposal.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(decision === "DECLINE" ? {
          decision,
          idempotencyKey: crypto.randomUUID(),
        } : {
          decision,
          idempotencyKey: crypto.randomUUID(),
          includeReferenceSheet: line.proposal.kind === "SUBSTITUTION" ? include : false,
          referencePermissionIds: line.proposal.kind === "SUBSTITUTION" && include ? permissions : [],
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The proposal could not be applied.");
      setMessage(decision === "DECLINE" ? "Proposal declined. The required full $8 line refund has started." : "Proposal accepted. A fresh 24-hour production period has started after capacity confirmation.");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The proposal could not be applied.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(line: MaterialDeliveryView, artifactId: string) {
    const permissionIds = referenceSelections[`regen:${line.lineId}`] || [];
    if (!permissionIds.length) return setMessage("Choose at least one fresh exact-job permission first.");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/customer/material-lines/${line.lineId}/reference-regeneration`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priorArtifactId: artifactId, permissionIds, idempotencyKey: crypto.randomUUID() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The replacement reference sheet could not start.");
      setMessage("Replacement reference-sheet work started. Its fresh 24-hour deadline is now recorded.");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The replacement reference sheet could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function openSupport(line: MaterialDeliveryView, event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/customer/material-lines/${line.lineId}/support`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(support),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The support case could not be opened.");
      setSupport({ artifactId: "", field: "", documentText: "", correctFact: "" });
      setSupportFor(null);
      setMessage("Your included factual-correction request is open. New downloads of the affected file are disabled until staff reviews and releases a corrected version. One correction round is included when requested within three calendar days of delivery.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The support case could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  if (!lines.length) return null;
  return <section className="portal-section material-deliveries" aria-labelledby="material-deliveries-heading">
    <div className="portal-section__heading"><div><p className="eyebrow">MATERIALS ORDERS</p><h2 id="material-deliveries-heading">Your tailored documents</h2></div><p>Download and review every file before you submit it. ApplyPack never submits applications for you.</p></div>
    <div className="material-line-list">{lines.map((line) => {
      const proposalPermissions = line.proposal?.targetJobSnapshotId ? permissionsByJob.get(line.proposal.targetJobSnapshotId) || [] : [];
      const currentPermissions = permissionsByJob.get(line.jobSnapshotId) || [];
      return <article className="material-line" key={line.lineId}>
        <div className="material-line__heading"><div><span>{line.stateLabel}</span><h3>{line.title}</h3><p>{line.company}</p></div><div>{line.dueAt ? <p>Active deadline<br /><strong>{new Date(line.dueAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</strong></p> : null}<p>{line.stateMessage}</p></div></div>
        {line.refundState !== "NONE" ? <p className="match-warning"><strong>Refund:</strong> {line.refundState === "SUCCEEDED" ? "The full $8 line refund was confirmed." : line.refundState === "PENDING" ? "The full $8 line refund is processing." : "The required refund needs staff attention."}</p> : null}
        {line.proposal ? <section className="material-proposal"><h4>{line.proposal.kind === "SUBSTITUTION" ? "Choose a substitute or refund" : "Confirm a factual correction or refund"}</h4><p>Reason: {line.proposal.reasonCode.replaceAll("_", " ").toLowerCase()}.</p>{line.proposal.targetTitle ? <p>Proposed replacement: <strong>{line.proposal.targetTitle}</strong> at {line.proposal.targetCompany}.</p> : null}{line.proposal.factDiff ? <dl>{Object.entries(line.proposal.factDiff).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{safeValue(value)}</dd></div>)}</dl> : null}<p>Respond by {new Date(line.proposal.expiresAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET. No response results in the required full $8 line refund.</p>
          {line.proposal.kind === "SUBSTITUTION" ? <div className="reference-permission"><label className="confirm"><input type="checkbox" checked={Boolean(includeReference[line.proposal.id])} onChange={(event) => setIncludeReference((current) => ({ ...current, [line.proposal!.id]: event.target.checked }))} />Include an application-specific reference sheet for the replacement</label>{includeReference[line.proposal.id] ? proposalPermissions.length ? proposalPermissions.map((permission) => <label className="confirm" key={permission.permissionId}><input type="checkbox" checked={(referenceSelections[line.proposal!.id] || []).includes(permission.permissionId)} onChange={() => togglePermission(line.proposal!.id, permission.permissionId)} />{permission.name}: permitted for {permission.exactPosition} at {permission.employer}</label>) : <p className="match-warning">No fresh exact-job permissions are ready for this replacement.</p> : null}</div> : null}
          <div className="material-proposal__actions"><button type="button" className="wizard-next" disabled={busy || (line.proposal.kind === "SUBSTITUTION" && Boolean(includeReference[line.proposal.id]) && !(referenceSelections[line.proposal.id] || []).length)} onClick={() => decide(line, "ACCEPT")}>Accept and start revised work</button><button type="button" disabled={busy} onClick={() => decide(line, "DECLINE")}>Decline and refund $8</button></div>
        </section> : null}
        {line.regeneration ? <p className="deadline-note"><strong>Replacement reference sheet:</strong> {line.regeneration.state.replaceAll("_", " ").toLowerCase()}{line.regeneration.dueAt ? ` · due ${new Date(line.regeneration.dueAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET` : ""}.</p> : null}
        {line.artifacts.length ? <div className="artifact-list">{line.artifacts.map((artifact) => {
          const revoked = Boolean(artifact.downloadsRevokedAt || artifact.supersededAt);
          return <article key={artifact.id}><div><h4>{artifactLabel(artifact.type)}</h4><p>Version {artifact.version} · SHA-256 {artifact.checksum.slice(0, 12)}…</p><p>{artifact.filename}</p></div>{revoked ? <div><strong>Download revoked</strong><p>This file is stale or a linked reference permission changed.</p></div> : <a className="button-link button-link--primary" href={`/api/customer/artifacts/${artifact.id}/download`}><span>Download current file</span></a>}
            {artifact.type === "REFERENCE_SHEET" && revoked && !line.regeneration ? <div className="reference-regeneration"><p>Choose one to three fresh permissions for this exact job. Capacity must be available before a new 24-hour period starts.</p>{currentPermissions.map((permission) => <label className="confirm" key={permission.permissionId}><input type="checkbox" checked={(referenceSelections[`regen:${line.lineId}`] || []).includes(permission.permissionId)} onChange={() => togglePermission(`regen:${line.lineId}`, permission.permissionId)} />{permission.name}: {permission.exactPosition} at {permission.employer}</label>)}<button type="button" disabled={busy || !(referenceSelections[`regen:${line.lineId}`] || []).length} onClick={() => regenerate(line, artifact.id)}>Request reviewed replacement sheet</button></div> : null}
          </article>;
        })}</div> : <p>No approved files have been released for this line.</p>}
        <button type="button" className="text-button" aria-expanded={supportFor === line.lineId} onClick={() => setSupportFor(supportFor === line.lineId ? null : line.lineId)}>Request the included factual correction</button>
        {supportFor === line.lineId ? <form className="material-support" onSubmit={(event) => openSupport(line, event)}><label>Document<select required value={support.artifactId} onChange={(event) => setSupport((current) => ({ ...current, artifactId: event.target.value }))}><option value="">Choose the affected document</option>{line.artifacts.filter((artifact) => !artifact.downloadsRevokedAt && !artifact.supersededAt).map((artifact) => <option value={artifact.id} key={artifact.id}>{artifactLabel(artifact.type)}: version {artifact.version}</option>)}</select></label><label>Field or section<input required maxLength={100} value={support.field} onChange={(event) => setSupport((current) => ({ ...current, field: event.target.value }))} /></label><label>What the document says<textarea required maxLength={500} value={support.documentText} onChange={(event) => setSupport((current) => ({ ...current, documentText: event.target.value }))} /></label><label>The correct fact<textarea required maxLength={500} value={support.correctFact} onChange={(event) => setSupport((current) => ({ ...current, correctFact: event.target.value }))} /></label><button className="wizard-next" disabled={busy || !support.artifactId}>Submit factual correction</button></form> : null}
      </article>;
    })}</div>
    <p className={message ? "form-message" : "sr-only"} role="status" aria-live="polite">{message || "Materials delivery controls ready."}</p>
  </section>;
}

function safeValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(", ") || "Reviewed change";
  return "Reviewed change";
}

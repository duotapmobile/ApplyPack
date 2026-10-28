"use client";
import { useEffect, useRef, useState } from "react";
import { matchesServiceRepairReceipt, readServiceRepairSummary, type ServiceRepairBrowserRequest,
  type ServiceRepairSummary } from "@/lib/materials/service-repair-client";
import { ServiceRepairDelivery } from "./service-repair-delivery";
import { ServiceRepairAuthoring } from "./service-repair-authoring";
import { ServiceRepairWording } from "./service-repair-wording";
import { ServiceRepairFiles } from "./service-repair-files";
import styles from "./draft-owner-workspace.module.css";

const names = { RESUME: "Resume", COVER_LETTER: "Cover letter", REFERENCE_SHEET: "Reference sheet" };
type Props = { caseId: string; materialLineId: string; title: string };
export function ServiceRepairWorkspace(props: Props) {
  return <RepairWorkspace key={`${props.caseId}:${props.materialLineId}`} {...props} />;
}
function RepairWorkspace({ caseId, materialLineId, title }: Props) {
  const [summary, setSummary] = useState<ServiceRepairSummary | null>(null), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading the accepted repair…"), [pending, setPending] = useState<ServiceRepairBrowserRequest | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const active = useRef<AbortController | null>(null);
  const endpoint = `/api/admin/service-errors/${caseId}/repairs/${materialLineId}`;
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error("unconfirmed");
      const value = readServiceRepairSummary(data.summary, caseId, materialLineId);
      if (!controller.signal.aborted) { setSummary(value); setMessage(""); }
    }).catch(() => { if (!controller.signal.aborted) setMessage("The accepted repair could not be loaded. Reload after checking administrator access."); });
    return () => controller.abort();
  }, [caseId, materialLineId, endpoint]);
  async function load(signal: AbortSignal) {
    const response = await fetch(endpoint, { cache: "no-store", signal }), data = await response.json();
    if (!response.ok) throw new Error("unconfirmed");
    const value = readServiceRepairSummary(data.summary, caseId, materialLineId);
    if (!signal.aborted) setSummary(value);
  }
  function refreshSavedState() {
    const controller = active.current;
    if (!controller || controller.signal.aborted) return;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    void load(signal).then(() => { if (!controller.signal.aborted) setRefresh(value => value + 1); }).catch(() => {
      if (!controller.signal.aborted) { setSummary(null); setMessage("The action was saved, but the current repair could not be reloaded. Reload before continuing."); }
    });
  }
  async function save(request: ServiceRepairBrowserRequest) {
    if (busy || !active.current || active.current.signal.aborted) return;
    const controller = active.current, signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    setBusy(true); setPending(request); setRetryAllowed(false); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal });
      const data = await response.json();
      if (!response.ok || data.renderingAuthorized !== false || data.deliveryAuthorized !== false
        || !matchesServiceRepairReceipt(data.receipt, request)) throw new Error("unconfirmed");
      if (controller.signal.aborted) return;
      setPending(null); setMessage("The repair version was saved. Corrected content, review and a separate Send are still required.");
      try { await load(signal); } catch { if (!controller.signal.aborted) { setSummary(null); setMessage("The repair version was saved, but its current status could not be loaded. Reload before continuing."); } }
    } catch { if (!controller.signal.aborted) setMessage("The save is not confirmed. Check the saved repair before retrying."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function reconcile() {
    if (!pending || busy || !active.current || active.current.signal.aborted) return;
    const controller = active.current, signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    setBusy(true); setRetryAllowed(false);
    try {
      const response = await fetch(`${endpoint}?requestId=${pending.requestId}`, { cache: "no-store", signal }), data = await response.json();
      if (!response.ok || !Object.hasOwn(data, "receipt")) throw new Error("unconfirmed");
      if (controller.signal.aborted) return;
      if (data.receipt === null) { setRetryAllowed(true); setMessage("No saved version was found for this request. You may retry the same opening."); }
      else {
        if (!matchesServiceRepairReceipt(data.receipt, pending)) throw new Error("unconfirmed");
        setPending(null); setMessage("The exact repair opening was saved. Current status must be reviewed before continuing.");
        try { await load(signal); } catch { if (!controller.signal.aborted) setSummary(null); }
      }
    } catch { if (!controller.signal.aborted) setMessage("The saved status is still unavailable. Keep this page open and check again later."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const current = summary?.current;
  const stale = Boolean(current && (current.invalidatedAt || current.acceptedScopeSha256 !== summary?.acceptedScopeSha256 || current.contextSha256 !== summary?.contextSha256));
  return <section className={styles.section} aria-label={`Accepted repair for ${title}`}><h3>Accepted repair: {title}</h3>
    <p role="status">{message}</p>
    {pending && <div><button disabled={busy} onClick={reconcile}>Check saved repair</button> <button disabled={busy || !retryAllowed} onClick={() => save(pending)}>Retry the same opening</button></div>}
    {summary && <><p>Only these files are included in the accepted service error:</p><ul>{summary.originals.map(member => <li key={member.fileVersionId}>{names[member.artifactType]}</li>)}</ul>
      {current && <p>{current.releaseId ? "This version was sent." : stale ? "This version needs a new review because the repair evidence changed." : current.approvedAt ? "This version is approved and waiting for a separate Send." : current.sourceSaved ? "Corrected content is saved and requires review." : "This version is waiting for corrected content."}</p>}
      {(!current || stale || current.sourceSaved && !current.releaseId) && <button disabled={busy || Boolean(pending)} onClick={() => save({ requestId: crypto.randomUUID(), caseId, materialLineId,
        expectedVersionId: current?.id ?? null, acceptedScopeSha256: summary.acceptedScopeSha256, contextSha256: summary.contextSha256 })}>{current ? "Open an updated repair version" : "Open the accepted repair"}</button>}
      {current?.sourceSaved && !current.releaseId && <p>A new correction version must repeat wording, rendered-file and approval checks before a separate Send.</p>}
      {current && !stale && !current.releaseId && <ServiceRepairAuthoring caseId={caseId} materialLineId={materialLineId} versionId={current.id} onSaved={refreshSavedState} />}
      {current?.sourceSaved && !stale && <ServiceRepairWording caseId={caseId} materialLineId={materialLineId} versionId={current.id} refreshKey={refresh} onRecorded={refreshSavedState} />}
      {current?.sourceSaved && !stale && !current.releaseId && <ServiceRepairFiles caseId={caseId} materialLineId={materialLineId} versionId={current.id} refreshKey={refresh} onRegistered={refreshSavedState} />}
      {current && !stale && <ServiceRepairDelivery caseId={caseId} materialLineId={materialLineId} refreshKey={`${current.id}:${refresh}`} onSaved={refreshSavedState} />}
    </>}
  </section>;
}

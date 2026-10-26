"use client";
import { useEffect, useRef, useState } from "react";
import { matchesRepairDeliveryResult, readRepairDeliverySummary, repairReviewChecklistSchema, repairReviewLabels,
  type RepairDeliveryAction, type RepairDeliverySummary, type RepairReviewKey } from "@/lib/materials/service-repair-delivery-client";
import styles from "./draft-owner-workspace.module.css";

type Props = { caseId: string; materialLineId: string; refreshKey?: string | number; onSaved?: () => void };
export function ServiceRepairDelivery({ caseId, materialLineId, refreshKey = "", onSaved }: Props) {
  return <ServiceRepairDeliveryView key={`${caseId}:${materialLineId}:${refreshKey}`} caseId={caseId} materialLineId={materialLineId} onSaved={onSaved} />;
}
function ServiceRepairDeliveryView({ caseId, materialLineId, onSaved }: Props) {
  const [summary, setSummary] = useState<RepairDeliverySummary | null>(null), [checked, setChecked] = useState<RepairReviewKey[]>([]);
  const [pending, setPending] = useState<RepairDeliveryAction | null>(null), [busy, setBusy] = useState(false), [retryAllowed, setRetryAllowed] = useState(false);
  const [message, setMessage] = useState("Loading repair files…"), active = useRef<AbortController | null>(null);
  const endpoint = `/api/admin/service-errors/${caseId}/repairs/${materialLineId}/delivery`;
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error("unconfirmed");
      const current = readRepairDeliverySummary(data.summary, { caseId, materialLineId });
      if (!controller.signal.aborted) { setSummary(current); setMessage(""); }
    }).catch(() => { if (!controller.signal.aborted) setMessage("Repair files could not be loaded. Reload after checking administrator access."); });
    return () => controller.abort();
  }, [caseId, materialLineId, endpoint]);
  async function act(request: RepairDeliveryAction, operation: "SUBMIT" | "CHECK") {
    if (busy || !active.current || active.current.signal.aborted) return;
    const controller = active.current, signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    setBusy(true); setPending(request); setRetryAllowed(false); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, request }), signal });
      const data = await response.json();
      if (!response.ok || !matchesRepairDeliveryResult(data.result, request)) throw new Error("unconfirmed");
      if (controller.signal.aborted) return;
      if (data.result.status === "ABSENT") {
        if (operation !== "CHECK") throw new Error("unconfirmed");
        setRetryAllowed(true); setMessage("No matching saved result was found. You may retry the same action after checking the files."); return;
      }
      setPending(null); setChecked([]);
      setMessage(request.action === "APPROVE" ? "Approval was saved. Use the separate Send button to deliver these files."
        : "The repair delivery was saved. Its notification is queued; this does not confirm that email has arrived.");
      try {
        const read = await fetch(endpoint, { cache: "no-store", signal }), current = await read.json(); if (!read.ok) throw new Error("unconfirmed");
        const parsed = readRepairDeliverySummary(current.summary, { caseId, materialLineId }); if (!controller.signal.aborted) setSummary(parsed);
      } catch { if (!controller.signal.aborted) { setSummary(null); setMessage("The exact action was saved, but current status could not be loaded. Reload before continuing."); } }
      if (!controller.signal.aborted) { try { onSaved?.(); } catch { /* A refresh cannot change the verified save receipt. */ } }
    } catch { if (!controller.signal.aborted) setMessage("The result is not confirmed. Check the saved result before trying again."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const complete = Object.keys(repairReviewLabels).every(key => checked.includes(key as RepairReviewKey));
  return <section className={styles.section} aria-label="Review and send repaired files"><h3>Review and send repaired files</h3>
    <p role="status">{message}</p>
    {pending && <div><button disabled={busy} onClick={() => act(pending, "CHECK")}>Check saved result</button>{" "}
      <button disabled={busy || !retryAllowed} onClick={() => act(pending, "SUBMIT")}>Retry the same action</button></div>}
    {summary && <>
      {summary.state === "NOT_READY" && <p>Corrected wording, its evidence review and the complete repaired files are required before approval.</p>}
      {summary.state === "STALE" && <p>The repair evidence changed. Prepare and review a new version before approval or delivery.</p>}
      {summary.files.length > 0 && <ul>{summary.files.map(file => <li key={file.fileVersionId}><a href={file.previewUrl} target="_blank" rel="noreferrer">Open preview: {file.filename}</a></li>)}</ul>}
      {summary.state === "REVIEW_REQUIRED" && summary.expected && <form onSubmit={event => {
        event.preventDefault(); if (!complete || busy || pending || !summary.expected) return;
        const checklist = repairReviewChecklistSchema.parse(Object.fromEntries(Object.keys(repairReviewLabels).map(key => [key, checked.includes(key as RepairReviewKey)])));
        void act({ action: "APPROVE", expected: summary.expected, checklist }, "SUBMIT");
      }}><fieldset disabled={busy || Boolean(pending)}><legend>Confirm your review of these exact repaired files</legend>
        {(Object.entries(repairReviewLabels) as [RepairReviewKey, string][]).map(([key, label]) => <label key={key} className={styles.claim}>
          <input type="checkbox" checked={checked.includes(key)} onChange={() => setChecked(values => values.includes(key) ? values.filter(value => value !== key) : [...values, key])} />{label}</label>)}
        <button type="submit" disabled={!complete}>Approve these repaired files</button></fieldset></form>}
      {summary.state === "APPROVED" && <><p>Approval is saved. Sending is a separate action.</p>{summary.canSend && summary.expected && summary.approvalSha256
        ? <button disabled={busy || Boolean(pending)} onClick={() => act({ action: "SEND", expected: summary.expected!, approvalSha256: summary.approvalSha256!,
          releaseId: crypto.randomUUID(), outboxId: crypto.randomUUID() }, "SUBMIT")}>Send these repaired files</button>
        : <p>The owner who approved this version must complete Send.</p>}</>}
      {summary.state === "SENT" && <p>This repair version was sent. The original paid delivery and its unaffected files are preserved.</p>}
    </>}
  </section>;
}

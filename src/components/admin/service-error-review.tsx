"use client";
import { useEffect, useState } from "react";
import type { createOwnerServiceErrors } from "@/lib/materials/service-error-server";
import type { createServiceErrorEvidenceReader } from "@/lib/materials/service-error-evidence";
import type { ServiceErrorDecision } from "@/lib/materials/service-error-contract";
import { matchesServiceErrorDecision } from "@/lib/materials/service-error-client";
import { ServiceRepairWorkspace } from "./service-repair-workspace";
import styles from "./draft-owner-workspace.module.css";
type Inspection = Awaited<ReturnType<ReturnType<typeof createOwnerServiceErrors>["inspect"]>>;
type File = Awaited<ReturnType<ReturnType<typeof createServiceErrorEvidenceReader>>>;
type Detail = { inspection: Inspection; files: File[] };
type Classification = Exclude<ServiceErrorDecision["classification"], "HISTORICAL_REMEDY">;
const reasons: Record<Classification, { value: ServiceErrorDecision["reasonCode"]; label: string }[]> = {
  CONFIRMED_SERVICE_ERROR: [{ value: "CONFIRMED_SOURCE_MISMATCH", label: "Our file differs from the confirmed information" }, { value: "UNSUPPORTED_GENERATED_CLAIM", label: "We added an unsupported claim" }, { value: "MATERIAL_MISREPRESENTATION", label: "Our wording materially misrepresents the evidence" }],
  CUSTOMER_INPUT_CHANGE: [{ value: "CUSTOMER_CONFIRMED_VALUE", label: "The file matches what the customer confirmed" }, { value: "NEW_OR_OMITTED_INFORMATION", label: "New or omitted information" }],
  EDITORIAL_REQUEST: [{ value: "WORDING_OR_SELECTION_PREFERENCE", label: "Wording or content preference" }],
  EVIDENCE_INVESTIGATION: [{ value: "CONFIRMATION_OR_PARSER_UNCLEAR", label: "Confirmation or parsing needs investigation" }, { value: "EVIDENCE_MISSING", label: "Evidence is unavailable" }],
};
const labels: Record<Classification, string> = { CONFIRMED_SERVICE_ERROR: "Confirmed ApplyPack error", CUSTOMER_INPUT_CHANGE: "Customer information change", EDITORIAL_REQUEST: "Wording preference", EVIDENCE_INVESTIGATION: "Keep open for investigation" };
function display(value: unknown): string { return value === null ? "Not supplied" : typeof value === "string" ? value : typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(display).join("; ") : "See source record"; }
function fields(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).filter(([key]) => !/Id$|Ids$|Sha256$/.test(key)) : []; }
export function ServiceErrorReview({ caseId }: { caseId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null), [message, setMessage] = useState("Loading protected evidence…"), [busy, setBusy] = useState(false);
  const [classification, setClassification] = useState<Classification>("EVIDENCE_INVESTIGATION"), [reasonCode, setReason] = useState<ServiceErrorDecision["reasonCode"]>("CONFIRMATION_OR_PARSER_UNCLEAR");
  const [explanation, setExplanation] = useState(""), [checked, setChecked] = useState<string[]>([]), [affected, setAffected] = useState<string[]>([]);
  const [facts, setFacts] = useState<Record<string, string[]>>({}), [pending, setPending] = useState<ServiceErrorDecision | null>(null), [retryAllowed, setRetryAllowed] = useState(false);
  function applyDetail(data: Detail) {
    const accepted = data.inspection.decisions.filter((decision) => decision.classification === "CONFIRMED_SERVICE_ERROR").flatMap((decision) => decision.affected.map((member) => member.fileVersionId));
    setDetail(data); setAffected([...new Set(accepted)]); setChecked([]); setFacts({});
    if (accepted.length) { setClassification("CONFIRMED_SERVICE_ERROR"); setReason("CONFIRMED_SOURCE_MISMATCH"); }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/service-errors/${caseId}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json(); if (!response.ok || data.inspection?.report?.caseId !== caseId || !Array.isArray(data.files)) throw new Error("unconfirmed");
      if (!controller.signal.aborted) { applyDetail(data); setMessage(""); }
    }).catch(() => { if (!controller.signal.aborted) setMessage("The protected evidence could not be loaded. Reload after verifying administrator access."); });
    return () => controller.abort();
  }, [caseId]);
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  async function save(request: ServiceErrorDecision) {
    setBusy(true); setPending(request); setRetryAllowed(false); setMessage("");
    try {
      const response = await fetch(`/api/admin/service-errors/${caseId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(50_000) });
      const result = await response.json();
      if (!response.ok || result.result?.status !== "RECORDED" || result.result.deliveryAuthorized !== false
        || !await matchesServiceErrorDecision(result.result.receipt, request)) throw new Error("unconfirmed");
      setMessage("Decision recorded. No files were generated or sent. Reload this report to see the saved decision."); setPending(null); setDetail(null);
    } catch { setMessage("The result is not confirmed. Check the saved decision before retrying."); }
    finally { setBusy(false); }
  }
  async function reconcile() {
    if (!pending) return; setBusy(true); setRetryAllowed(false);
    try {
      const response = await fetch(`/api/admin/service-errors/${caseId}`, { cache: "no-store", signal: AbortSignal.timeout(50_000) }), result = await response.json();
      if (!response.ok || result.inspection?.report?.caseId !== caseId || !Array.isArray(result.inspection.decisions)) throw new Error("unconfirmed");
      const receipt = result.inspection.decisions.find((decision: { requestId: string }) => decision.requestId === pending.requestId);
      if (receipt) {
        if (!await matchesServiceErrorDecision(receipt, pending)) throw new Error("conflicting receipt");
        setPending(null); applyDetail(result); setMessage("The exact decision was saved. No files were sent.");
      } else { setRetryAllowed(true); setMessage("No saved decision with this request ID was found. You may retry the same decision."); }
    } catch { setMessage("The saved status is still unavailable. Keep this page open and check again later."); }
    finally { setBusy(false); }
  }
  const report = detail?.inspection.report;
  const acceptedIds = new Set(detail?.inspection.decisions.filter((decision) => decision.classification === "CONFIRMED_SERVICE_ERROR").flatMap((decision) => decision.affected.map((member) => member.fileVersionId)) ?? []);
  return <section className={styles.content} aria-labelledby="service-error-title"><h2 id="service-error-title">Review the reported error</h2>
    <p role="status">{message}</p>{pending && <div><button disabled={busy} onClick={reconcile}>Check saved decision</button> <button disabled={busy || !retryAllowed} onClick={() => save(pending)}>Retry the same decision</button></div>}
    {detail && <><p>This is the original delivery evidence. Reviewing it does not extend a deadline or authorize new documents.</p>
      <p>Reported {new Date(detail.inspection.report.reportedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern time. Reporting deadline: {new Date(detail.inspection.report.reportDeadline).toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern time.</p>
      {detail.inspection.reportBody.items.map((item) => <section className={styles.section} key={item.fileVersionId}><h3>{item.field}</h3><p>Customer reports this wording:</p><blockquote>{item.documentText}</blockquote><p>Customer says it should be:</p><blockquote>{item.expectedFact}</blockquote></section>)}
      {detail.files.map((file) => <section className={styles.section} key={file.fileVersionId}><h3>{file.filename}</h3><p>{file.evidence.targetJob.company} — {file.evidence.targetJob.title}</p>
        <a href={file.previewUrl} target="_blank" rel="noreferrer">Open the delivered file preview</a>
        <details><summary>Original confirmed information and source history</summary><h4>Confirmed document contact</h4><dl>{fields(file.evidence.contact).filter(([key]) => key !== "schemaVersion").map(([key, value]) => <div key={key}><dt>{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd>{display(value)}</dd></div>)}</dl>
          <label><input type="checkbox" disabled={busy || Boolean(pending)} checked={(facts[file.fileVersionId] ?? []).includes(file.evidence.contactFactId)} onChange={() => setFacts({ ...facts, [file.fileVersionId]: toggle(facts[file.fileVersionId] ?? [], file.evidence.contactFactId) })} />Use this confirmed contact as evidence for {file.filename}</label>
          {file.evidence.facts.map((fact) => <div className={styles.claim} key={fact.id}><p>{fact.customer_display_label || fact.semantic_key}</p><p>{fact.verification.replaceAll("_", " ")} · {fact.source_locator}</p><dl>{fields(fact.typed_value).map(([key, value]) => <div key={key}><dt>{key.replace(/([a-z])([A-Z])/g, "$1 $2")}</dt><dd>{display(value)}</dd></div>)}</dl>
            <label><input type="checkbox" disabled={busy || Boolean(pending)} checked={(facts[file.fileVersionId] ?? []).includes(fact.id)} onChange={() => setFacts({ ...facts, [file.fileVersionId]: toggle(facts[file.fileVersionId] ?? [], fact.id) })} />Use this fact as evidence for {file.filename}</label></div>)}
          <h4>Extraction and confirmation history</h4>{file.evidence.sourceFacts.length === 0 && <p>No separate parsed source facts were recorded.</p>}{file.evidence.sourceFacts.map((fact) => <div key={fact.id}><p>{fact.source_locator} · {fact.verification.replaceAll("_", " ")}</p><dl>{fields(fact.typed_value).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{display(value)}</dd></div>)}</dl></div>)}
          {file.evidence.sourceReviews.map((review) => <p key={review.id}>{review.decision.toLowerCase()} · {new Date(review.reviewed_at).toLocaleString()}</p>)}</details>
        <details><summary>Wording used in this delivered document</summary>{file.evidence.claims.map((claim) => <p key={claim.claimId}>{claim.text}</p>)}</details>
        {classification === "CONFIRMED_SERVICE_ERROR" && <label><input type="checkbox" checked={affected.includes(file.fileVersionId)} disabled={busy || Boolean(pending) || acceptedIds.has(file.fileVersionId)} onChange={() => setAffected(toggle(affected, file.fileVersionId))} />{acceptedIds.has(file.fileVersionId) ? "This file already has an unfinished accepted repair" : "This file is actually affected and needs repair"}</label>}
      </section>)}
      {detail.inspection.decisionBodies.map(({ receipt, decision }) => <section className={styles.section} key={receipt.decisionId}><h3>Recorded decision</h3><p>{labels[decision.classification as Classification] ?? "Original contract remedy"}</p><p>{decision.explanation}</p></section>)}
      {[...new Set(detail.files.filter(file => acceptedIds.has(file.fileVersionId)).map(file => file.materialLineId))].filter(Boolean).map(materialLineId => {
        const file = detail.files.find(file => file.materialLineId === materialLineId)!;
        return <ServiceRepairWorkspace key={materialLineId} caseId={caseId} materialLineId={materialLineId}
          title={`${file.evidence.targetJob.company} — ${file.evidence.targetJob.title}`} />;
      })}
      {report?.state === "OPEN" && <form onSubmit={(event) => { event.preventDefault(); if (busy || pending) return;
        const evidence = detail.files.map((file) => { const selected = facts[file.fileVersionId] ?? []; return { artifactId: file.artifactId, fileVersionId: file.fileVersionId, releaseId: file.releaseId,
          sourceSnapshotId: file.evidence.snapshotId, sourceFactIds: selected, documentVersionIds: [...new Set(file.evidence.facts.filter((fact) => selected.includes(fact.id)).flatMap((fact) => fact.document_version_id ? [fact.document_version_id] : []))] }; });
        void save({ requestId: crypto.randomUUID(), caseId, expectedDecisionId: report.latestDecisionId, classification, reasonCode, explanation: explanation.trim(), evidence,
          affected: classification === "CONFIRMED_SERVICE_ERROR" ? detail.files.filter((file) => affected.includes(file.fileVersionId)).map(({ artifactId, fileVersionId, releaseId }) => ({ artifactId, fileVersionId, releaseId })) : [],
          confirmedValuesReviewed: true, deliveredVersionReviewed: true, parserProvenanceReviewed: true });
      }}><fieldset disabled={busy || Boolean(pending)}><legend>Owner decision</legend><label>Classification<select disabled={acceptedIds.size > 0} value={classification} onChange={(event) => { const next = event.target.value as Classification; setClassification(next); setReason(reasons[next][0].value); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Reason<select value={reasonCode} onChange={(event) => setReason(event.target.value as ServiceErrorDecision["reasonCode"])}>{reasons[classification].map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label>
        <label>Explain the decision<textarea required minLength={10} maxLength={6000} value={explanation} onChange={(event) => setExplanation(event.target.value)} /></label>
        {["I compared the customer-confirmed values.", "I reviewed the exact delivered file.", "I checked the parsing and confirmation history, or documented missing evidence."].map((label) => <label key={label}><input type="checkbox" checked={checked.includes(label)} onChange={() => setChecked(toggle(checked, label))} />{label}</label>)}
        <button disabled={checked.length !== 3 || explanation.trim().length < 10 || classification === "CONFIRMED_SERVICE_ERROR" && affected.length === 0
          || Object.values(facts).some((ids) => ids.length > 30)} type="submit">Record decision</button></fieldset></form>}
    </>}
  </section>;
}

"use client";
import { useEffect, useId, useState } from "react";
import { matchesRepairFeedback } from "@/lib/materials/service-repair-followup-client";
import { repairArtifactLabel, repairFeedbackContextSchema, repairFeedbackRequestSchema, type RepairFeedbackContext, type RepairFeedbackRequest } from "@/lib/materials/service-repair-followup";

export function ServiceRepairFeedback({ materialLineId }: { materialLineId: string }) {
  return <RepairFeedbackForm key={materialLineId} materialLineId={materialLineId} />;
}
function RepairFeedbackForm({ materialLineId }: { materialLineId: string }) {
  const heading = useId(), path = `/api/customer/material-lines/${materialLineId}/repair-feedback`;
  const [context, setContext] = useState<RepairFeedbackContext | null>(null), [selected, setSelected] = useState<string[]>([]), [concerns, setConcerns] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState<RepairFeedbackRequest | null>(null), [retry, setRetry] = useState(false);
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [message, setMessage] = useState("Loading repaired documents…");
  useEffect(() => {
    const controller = new AbortController();
    fetch(path, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(); const value = repairFeedbackContextSchema.parse(await response.json());
      if (value.materialLineId !== materialLineId) throw new Error();
      if (!controller.signal.aborted) { setContext(value); setMessage(value.files.length ? "" : "No current repaired files are available for feedback here. Contact support about your existing case."); }
    }).catch(() => { if (!controller.signal.aborted) setMessage("Repaired-file feedback is unavailable. Contact support about your existing case."); });
    return () => controller.abort();
  }, [path, materialLineId]);
  const finish = () => { setSaved(true); setPending(null); setSelected([]); setConcerns({}); setConfirmed(false); setMessage("Your feedback was saved to the existing case for review. It does not automatically approve new edits or change your access dates."); };
  async function save(request: RepairFeedbackRequest) {
    setBusy(true); setPending(request); setRetry(false); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(50_000) });
      const value = await response.json();
      if (!response.ok || value.result?.status !== "RECORDED" || !await matchesRepairFeedback(value.result.receipt, request)) throw new Error(); finish();
    } catch { setMessage("We could not confirm the result. Keep this page open and check its saved status before trying again."); }
    finally { setBusy(false); }
  }
  async function reconcile() {
    if (!pending) return; setBusy(true); setRetry(false);
    try {
      const response = await fetch(`${path}?requestId=${pending.requestId}`, { cache: "no-store", signal: AbortSignal.timeout(50_000) }), value = await response.json();
      if (!response.ok || !Object.hasOwn(value, "receipt")) throw new Error();
      if (value.receipt === null) { setRetry(true); setMessage("No saved feedback with this request ID was found. You can retry the same details."); }
      else { if (!await matchesRepairFeedback(value.receipt, pending)) throw new Error(); finish(); }
    } catch { setMessage("The saved status is still unavailable. Keep this page open and check again later."); }
    finally { setBusy(false); }
  }
  const first = context?.files.find((file) => file.fileVersionId === selected[0]);
  return <section className="material-support" aria-labelledby={heading}><h3 id={heading}>A factual issue remains in a repaired document</h3>
    <p>This is a follow-up to the accepted service error. New or omitted information and wording preferences do not automatically include further changes.</p>
    <p role="status">{message}</p>
    {context && context.files.length > 0 && !saved && <form onSubmit={(event) => {
      event.preventDefault(); if (busy || pending || !first || !confirmed) return;
      const request = repairFeedbackRequestSchema.safeParse({ requestId: crypto.randomUUID(), caseId: first.caseId, materialLineId,
        releaseId: first.releaseId, items: context.files.filter((file) => selected.includes(file.fileVersionId)).map((file) => ({
          artifactId: file.artifactId, fileVersionId: file.fileVersionId, concern: concerns[file.fileVersionId] ?? "" })), sameAcceptedIssue: true });
      if (request.success) void save(request.data); else setMessage("Describe the remaining issue in each selected repaired file.");
    }}><fieldset disabled={busy || Boolean(pending)}><legend>Select the repaired files from one delivery</legend>
      {context.files.map((file) => <div key={file.fileVersionId}>
        <label><input type="checkbox" checked={selected.includes(file.fileVersionId)} disabled={Boolean(first && (first.releaseId !== file.releaseId || first.caseId !== file.caseId))}
          onChange={(event) => { setConfirmed(false); setSelected(event.target.checked ? [...selected, file.fileVersionId] : selected.filter((id) => id !== file.fileVersionId)); }} />
          {repairArtifactLabel[file.artifactType]} — {file.safeFilename}</label>
        {selected.includes(file.fileVersionId) && <label>Remaining factual issue — {file.safeFilename}<textarea required minLength={10} maxLength={3000}
          value={concerns[file.fileVersionId] ?? ""} onChange={(event) => { setConfirmed(false); setConcerns({ ...concerns, [file.fileVersionId]: event.target.value }); }} /></label>}
      </div>)}
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I checked these repaired files and this concern relates to the accepted service error.</label>
      <button type="submit" disabled={!confirmed || !first || selected.some((id) => (concerns[id]?.trim().length ?? 0) < 10)}>Submit repair feedback</button>
    </fieldset></form>}
    {pending && <div><button disabled={busy} onClick={reconcile}>Check saved feedback</button> <button disabled={busy || !retry} onClick={() => save(pending)}>Retry the same feedback</button></div>}
  </section>;
}

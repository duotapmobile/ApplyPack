"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import type { ServiceErrorReport } from "@/lib/materials/service-error-contract";
import { matchesServiceErrorReport } from "@/lib/materials/service-error-client";

const member = z.object({ artifactId: z.uuid(), fileVersionId: z.uuid(), releaseId: z.uuid() });
const receipt = z.object({ requestId: z.uuid(), caseId: z.uuid(), materialLineId: z.uuid(), reportedAt: z.iso.datetime({ offset: true }), state: z.enum(["OPEN", "RESOLVED"]) }).passthrough();
const contextSchema = z.object({ materialLineId: z.uuid(), reportDeadline: z.iso.datetime({ offset: true }), reportingTimeZone: z.literal("America/New_York"),
  files: z.array(member.extend({ deliveredAt: z.iso.datetime({ offset: true }), checksumSha256: z.string().regex(/^[a-f0-9]{64}$/), artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), safeFilename: z.string().min(1).max(255) }).strict()).min(1).max(30),
  existingReport: receipt.nullable() }).strict();
type Context = z.infer<typeof contextSchema>;
const date = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" });
export function ServiceErrorReportForm({ materialLineId }: { materialLineId: string }) {
  const [context, setContext] = useState<Context | null>(null), [message, setMessage] = useState("Loading your delivered files…"), [busy, setBusy] = useState(false);
  const [items, setItems] = useState<ServiceErrorReport["items"]>([]), [reviewed, setReviewed] = useState(false), [pending, setPending] = useState<ServiceErrorReport | null>(null), [retryAllowed, setRetryAllowed] = useState(false), [submitted, setSubmitted] = useState(false);
  const path = `/api/customer/material-lines/${materialLineId}/service-errors`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(path, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const value = contextSchema.parse(await response.json());
      if (value.materialLineId !== materialLineId || value.existingReport && value.existingReport.materialLineId !== materialLineId) throw new Error("wrong delivery");
      if (!controller.signal.aborted) { setContext(value); setMessage(""); }
    }).catch(() => { if (!controller.signal.aborted) setMessage("This report form is unavailable for this delivery. Return to My ApplyPack to use its recorded support options."); });
    return () => controller.abort();
  }, [path, materialLineId]);
  async function save(request: ServiceErrorReport) {
    setBusy(true); setPending(request); setRetryAllowed(false); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(50_000) }), result = await response.json();
      if (!response.ok || result.result?.status !== "REPORTED" || result.result.deliveryAuthorized !== false || !await matchesServiceErrorReport(result.result.receipt, request)) throw new Error("unconfirmed");
      setPending(null); setSubmitted(true); setItems([]); setMessage("Your grouped report was saved for review. Reporting an issue does not change your existing files or access dates.");
    } catch { setMessage("We could not confirm the result. Keep this page open and check the saved report before trying again."); }
    finally { setBusy(false); }
  }
  async function reconcile() {
    if (!pending) return; setBusy(true); setRetryAllowed(false);
    try {
      const response = await fetch(`${path}?requestId=${pending.requestId}`, { cache: "no-store", signal: AbortSignal.timeout(50_000) }), result = await response.json();
      if (!response.ok || !Object.hasOwn(result, "receipt")) throw new Error("unconfirmed");
      if (result.receipt === null) { setRetryAllowed(true); setMessage("No saved report with this request ID was found. You can retry the same report."); }
      else {
        if (!await matchesServiceErrorReport(result.receipt, pending)) throw new Error("conflicting receipt");
        setPending(null); setSubmitted(true); setItems([]); setMessage("Your exact report was saved. It is waiting for review; no files or access dates changed.");
      }
    } catch { setMessage("The saved status is still unavailable. Keep this page open and check again later."); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="service-report-title"><h2 id="service-report-title">Report a factual error in your documents</h2><p role="status">{message}</p>
    {context && !submitted && <><p>You can submit one grouped report for this Apply Pack by <time dateTime={context.reportDeadline}>{date(context.reportDeadline)}</time> — three calendar days after the original delivery.</p>
      <p>We review errors ApplyPack introduced, including a misspelled confirmed name, an incorrect phone number, or an unsupported claim. Information you confirmed incorrectly, new or omitted experience, and wording preferences do not automatically include rework.</p>
      {context.existingReport ? <p>Your grouped report was submitted {date(context.existingReport.reportedAt)}. Its status is {context.existingReport.state === "OPEN" ? "under review" : "reviewed"}. Contact support about the existing report if you need help.</p>
        : <form onSubmit={(event) => { event.preventDefault(); if (busy || pending || !reviewed || !items.length) return; void save({ requestId: crypto.randomUUID(), materialLineId, items: items.map((item) => ({ ...item, field: item.field.trim(), documentText: item.documentText.trim(), expectedFact: item.expectedFact.trim() })) }); }}>
          <fieldset disabled={busy || Boolean(pending)}><legend>Include every issue you found before submitting</legend>
            {context.files.map((file) => { const item = items.find((value) => value.fileVersionId === file.fileVersionId); return <section className="material-support" key={file.fileVersionId}>
              <label><input type="checkbox" checked={Boolean(item)} disabled={!item && items.length >= 3} onChange={() => { setReviewed(false); setItems(item ? items.filter((value) => value.fileVersionId !== file.fileVersionId) : [...items, { artifactId: file.artifactId, fileVersionId: file.fileVersionId, releaseId: file.releaseId, field: "", documentText: "", expectedFact: "" }]); }} />Report an issue in {file.safeFilename}</label>
              {item && <>{([['field', 'Field or section', 100], ['documentText', 'What the document says', 1500], ['expectedFact', 'What your confirmed information says', 1500]] as const).map(([key, label, max]) => <label key={key}>{label} — {file.safeFilename}<textarea required maxLength={max} value={item[key]} onChange={(event) => { setReviewed(false); setItems(items.map((value) => value.fileVersionId === item.fileVersionId ? { ...value, [key]: event.target.value } : value)); }} /></label>)}</>}
            </section>; })}
            <label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I reviewed all delivered documents and grouped the issues I want ApplyPack to investigate.</label>
            <button className="wizard-next" disabled={!reviewed || items.length === 0 || items.some((item) => !item.field.trim() || !item.documentText.trim() || !item.expectedFact.trim())} type="submit">Submit grouped report</button>
          </fieldset></form>}
    </>}
    {pending && <div><button disabled={busy} onClick={reconcile}>Check saved report</button> <button disabled={busy || !retryAllowed} onClick={() => save(pending)}>Retry the same report</button></div>}
  </section>;
}

"use client";
import { FormEvent, useState } from "react";
import { Download } from "lucide-react";

export function DeliveryActions({ itemId, deliveredAt, jobLabel, pdfAvailable }: { itemId: string; deliveredAt: string; jobLabel: string; pdfAvailable: boolean }) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState("both");
  const [correction, setCorrection] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const deadline = new Date(new Date(deliveredAt).getTime() + 3 * 24 * 60 * 60 * 1000);
  const formId = "correction-" + itemId;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/customer/apply-packs/" + itemId + "/corrections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document, correction }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage("Your factual correction request was submitted.");
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="delivery-actions">
      <div className="delivery-format-grid">
        <section aria-label={"Resume download options for " + jobLabel}>
          <strong>Resume</strong>
          <div>
            <a aria-label={"Download editable Word resume for " + jobLabel} href={"/api/customer/deliveries/" + itemId + "?kind=resume&format=docx"}><Download aria-hidden="true" /> Word (.docx)</a>
            {pdfAvailable ? <a aria-label={"Download PDF resume for " + jobLabel} href={"/api/customer/deliveries/" + itemId + "?kind=resume&format=pdf"}><Download aria-hidden="true" /> PDF</a> : null}
          </div>
        </section>
        <section aria-label={"Cover letter download options for " + jobLabel}>
          <strong>Cover letter</strong>
          <div>
            <a aria-label={"Download editable Word cover letter for " + jobLabel} href={"/api/customer/deliveries/" + itemId + "?kind=cover_letter&format=docx"}><Download aria-hidden="true" /> Word (.docx)</a>
            {pdfAvailable ? <a aria-label={"Download PDF cover letter for " + jobLabel} href={"/api/customer/deliveries/" + itemId + "?kind=cover_letter&format=pdf"}><Download aria-hidden="true" /> PDF</a> : null}
          </div>
        </section>
      </div>
      {!pdfAvailable ? <p>This earlier delivery includes editable Word files only. Request help if you also need a PDF copy.</p> : null}
      <p><strong>Want to edit?</strong> Open the Word file in Microsoft Word, or upload it to Google Drive and choose <em>Open with Google Docs</em>. Use the PDF for viewing, printing, or sending when no edits are needed.</p>
      <p>Included factual corrections may be requested through {deadline.toLocaleDateString("en-US", { timeZone: "America/New_York" })}.</p><button type="button" aria-expanded={open} aria-controls={formId} aria-label={"Request a factual correction for " + jobLabel} onClick={() => setOpen((value) => !value)}>Request a factual correction</button>
      {open ? (
        <form id={formId} onSubmit={submit}>
          <label>Which document?<select value={document} onChange={(event) => setDocument(event.target.value)}><option value="both">Both</option><option value="resume">Resume</option><option value="cover_letter">Cover letter</option></select></label>
          <label>What factual detail needs correction?<textarea value={correction} onChange={(event) => setCorrection(event.target.value)} minLength={10} required /></label>
          <p>This is for names, dates, titles, contact details, or facts already provided. A new strategy or target is a new order.</p>
          <button className="wizard-next" disabled={busy}>{busy ? "Submitting..." : "Submit Correction"}</button>
        </form>
      ) : null}
      {message ? <p className="form-message" role="status">{message}</p> : null}
    </div>
  );
}

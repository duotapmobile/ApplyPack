"use client";
import { FormEvent, useState } from "react";
import { Download } from "lucide-react";

export function DeliveryActions({ itemId, deliveredAt }: { itemId: string; deliveredAt: string }) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState("both");
  const [correction, setCorrection] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const deadline = new Date(new Date(deliveredAt).getTime() + 3 * 24 * 60 * 60 * 1000);

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
      <div>
        <a href={"/api/customer/deliveries/" + itemId + "?kind=resume"}><Download aria-hidden="true" /> Resume</a>
        <a href={"/api/customer/deliveries/" + itemId + "?kind=cover_letter"}><Download aria-hidden="true" /> Cover letter</a>
      </div>
      <p>Included factual corrections may be requested through {deadline.toLocaleDateString()}.</p><button type="button" onClick={() => setOpen((value) => !value)}>Request a factual correction</button>
      {open ? (
        <form onSubmit={submit}>
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

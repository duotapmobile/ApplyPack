"use client";

import { useState, type FormEvent } from "react";

export function BoardMaterialCheckout({ jobId, initialEmail }: { jobId: string; initialEmail: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setState("loading"); setMessage("");
    const data = new FormData(event.currentTarget);
    const payload = {
      contact: { displayName: data.get("displayName"), email: data.get("email"), phone: data.get("phone"),
        cityState: data.get("cityState"), linkedInOrPortfolio: data.get("linkedInOrPortfolio") },
      emphasisNote: data.get("emphasisNote"), doNotMentionNote: data.get("doNotMentionNote"),
      careerBreakChoice: data.get("careerBreakChoice"), careerBreakCustomLabel: null,
      coverLetterBreakConsent: data.get("coverLetterBreakConsent") === "on",
      documentContactConfirmed: data.get("documentContactConfirmed") === "on",
      documentFactsConfirmed: data.get("documentFactsConfirmed") === "on",
      noAutoApplyAcknowledged: data.get("noAutoApplyAcknowledged") === "on",
      outcomesAcknowledged: data.get("outcomesAcknowledged") === "on",
    };
    try {
      const response = await fetch(`/api/checkout/board-materials/${encodeURIComponent(jobId)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Checkout is unavailable.");
      window.location.assign(result.url);
    } catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Checkout is unavailable."); }
  }
  return <form className="wizard-fields" onSubmit={submit} aria-describedby="board-material-description">
    <p id="board-material-description">One human-reviewed tailored résumé and one tailored cover letter for this job: $8 total. ApplyPack does not submit the application.</p>
    <div className="field-grid"><label>Full name<input name="displayName" autoComplete="name" required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" defaultValue={initialEmail} required /></label>
      <label>Phone<input name="phone" type="tel" autoComplete="tel" required /></label>
      <label>City and state<input name="cityState" autoComplete="address-level2" required /></label></div>
    <label>LinkedIn or portfolio (optional)<input name="linkedInOrPortfolio" type="url" autoComplete="url" /></label>
    <label>Emphasize (optional)<textarea name="emphasisNote" maxLength={500} /></label>
    <label>Do not mention (optional)<textarea name="doNotMentionNote" maxLength={500} /></label>
    <label>Career timeline presentation<select name="careerBreakChoice" defaultValue="KEEP_EXISTING_TIMELINE"><option value="KEEP_EXISTING_TIMELINE">Keep my existing timeline</option><option value="OMIT_ENTRY">Do not add a separate timeline entry</option></select></label>
    <label className="confirm"><input name="coverLetterBreakConsent" type="checkbox" /> I authorize any selected career-timeline wording in the cover letter.</label>
    <label className="confirm"><input name="documentContactConfirmed" type="checkbox" required /> I confirm these document contact details.</label>
    <label className="confirm"><input name="documentFactsConfirmed" type="checkbox" required /> I confirm ApplyPack must use only verified facts from my current profile.</label>
    <label className="confirm"><input name="noAutoApplyAcknowledged" type="checkbox" required /> I understand ApplyPack does not apply to the employer.</label>
    <label className="confirm"><input name="outcomesAcknowledged" type="checkbox" required /> I understand documents do not guarantee interviews or employment.</label>
    <button className="button-link button-link--primary" type="submit" disabled={state === "loading"}>{state === "loading" ? "Opening secure checkout…" : "Buy résumé + cover letter — $8"}</button>
    {state === "error" ? <p className="form-message" role="alert">{message} No charge was made unless Stripe shows a completed payment.</p> : null}
  </form>;
}

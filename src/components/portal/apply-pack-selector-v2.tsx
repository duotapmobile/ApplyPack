"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ShoppingBag } from "lucide-react";

export type MatchForSelection = {
  id: string;
  position: number;
  fit_summary: string;
  concerns: string[];
  job: {
    company: string;
    title: string;
    source_url: string;
    location_text: string | null;
    salary_text: string | null;
    checked_at: string;
    listing_status: string;
  };
};

type Notes = Record<string, { emphasisNotes: string; doNotMentionNotes: string }>;

export function ApplyPackSelector({ matches }: { matches: MatchForSelection[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState<Notes>({});
  const [changed, setChanged] = useState<"no" | "yes" | "">("");
  const [customerUpdateNotes, setCustomerUpdateNotes] = useState("");
  const [selectionConfirmed, setSelectionConfirmed] = useState(false);
  const [submissionBoundaryAcknowledged, setSubmissionBoundaryAcknowledged] = useState(false);
  const [outcomesAcknowledged, setOutcomesAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflictFor, setConflictFor] = useState("");
  const [explanation, setExplanation] = useState("");
  const [estimatedDeadline, setEstimatedDeadline] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setEstimatedDeadline(new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short",
    }).format(new Date(Date.now() + 24 * 60 * 60 * 1000)) + " ET"), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggle(id: string) {
    setMessage("");
    setSelected((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < 2 ? [...current, id] : current);
  }

  function updateNotes(id: string, key: "emphasisNotes" | "doNotMentionNotes", value: string) {
    setNotes((current) => ({ ...current, [id]: { ...(current[id] || { emphasisNotes: "", doNotMentionNotes: "" }), [key]: value } }));
  }

  async function saveDecision(id: string, decision: "not_for_me" | "undecided") {
    setMessage("");
    const response = await fetch("/api/customer/job-matches/" + id + "/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const result = await response.json();
    setMessage(response.ok ? "Your job decision was saved." : result.error);
  }

  async function submitConflict(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/customer/job-matches/" + id + "/conflict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ explanation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage("Your criteria-conflict review was submitted. We will review it before any replacement.");
      setConflictFor("");
      setExplanation("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    if (!selected.length) return setMessage("Select one or two jobs first.");
    if (!changed) return setMessage("Tell us whether anything has changed since your intake.");
    if (changed === "yes" && customerUpdateNotes.trim().length < 10) return setMessage("Describe the changed facts before checkout.");
    if (!selectionConfirmed || !submissionBoundaryAcknowledged || !outcomesAcknowledged) {
      return setMessage("Confirm all three service acknowledgments before checkout.");
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/checkout/apply-packs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: selected.map((jobMatchId) => ({
            jobMatchId,
            emphasisNotes: notes[jobMatchId]?.emphasisNotes || "",
            doNotMentionNotes: notes[jobMatchId]?.doNotMentionNotes || "",
          })),
          customerUpdateNotes: changed === "yes" ? customerUpdateNotes : "",
          selectionConfirmed,
          submissionBoundaryAcknowledged,
          outcomesAcknowledged,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="portal-section">
      <div className="portal-section__heading"><div><p className="eyebrow">YOUR MATCHES</p><h2>Choose up to two Apply Packs.</h2></div><p>Each selected job is a separate $8 order with one tailored resume and one tailored cover letter.</p></div>
      <div className="match-grid">
        {matches.map((match) => {
          const checked = selected.includes(match.id);
          const available = match.job.listing_status === "open";
          return (
            <article className={"match-card " + (checked ? "match-card--selected" : "")} key={match.id}>
              <div className="match-card__top"><span>#{match.position}</span><label><input type="checkbox" checked={checked} onChange={() => toggle(match.id)} disabled={!available || (!checked && selected.length >= 2)} /><i><Check aria-hidden="true" /></i><b>{checked ? "Selected" : available ? "Select" : "Closed"}</b></label></div>
              <h3>{match.job.title}</h3>
              <p className="match-company">{match.job.company}</p>
              <p>{match.fit_summary}</p>
              <dl><div><dt>Location</dt><dd>{match.job.location_text || "See listing"}</dd></div><div><dt>Salary</dt><dd>{match.job.salary_text || "Not listed"}</dd></div></dl>
              <p className="match-checked">Checked {new Date(match.job.checked_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p>
              {match.concerns.length ? <p className="match-concern"><strong>Know before applying:</strong> {match.concerns.join(" ")}</p> : null}
              <a href={match.job.source_url} target="_blank" rel="noreferrer">View employer listing <ArrowUpRight aria-hidden="true" /></a>
              {checked ? <div className="pack-notes">
                <label>Anything to emphasize? <span>(optional, 500 characters)</span><textarea maxLength={500} value={notes[match.id]?.emphasisNotes || ""} onChange={(e) => updateNotes(match.id, "emphasisNotes", e.target.value)} /></label>
                <label>Anything not to mention? <span>(optional, 500 characters)</span><textarea maxLength={500} value={notes[match.id]?.doNotMentionNotes || ""} onChange={(e) => updateNotes(match.id, "doNotMentionNotes", e.target.value)} /></label>
              </div> : null}
              <div className="match-actions">
                <button type="button" onClick={() => saveDecision(match.id, "not_for_me")}>Not for me</button>
                <button type="button" onClick={() => setConflictFor(conflictFor === match.id ? "" : match.id)}>Conflicts with my criteria</button>
              </div>
              {conflictFor === match.id ? <div className="conflict-form">
                <label>Which approved non-negotiable does this conflict with?<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} minLength={10} /></label>
                <button className="wizard-next" disabled={busy || explanation.trim().length < 10} onClick={() => submitConflict(match.id)}>Submit for Review</button>
              </div> : null}
            </article>
          );
        })}
      </div>

      {selected.length ? <div className="cart-review">
        <div><p className="eyebrow">REVIEW SELECTED JOBS</p><h3>{selected.length} Apply Pack{selected.length === 1 ? "" : "s"} ú $8 each ú {"$" + selected.length * 8} total</h3></div>
        <fieldset><legend>Has anything changed since your original intake?</legend>
          <label className="confirm"><input type="radio" name="changed" checked={changed === "no"} onChange={() => setChanged("no")} />No</label>
          <label className="confirm"><input type="radio" name="changed" checked={changed === "yes"} onChange={() => setChanged("yes")} />Yes, I need to update something</label>
        </fieldset>
        {changed === "yes" ? <label>Changed facts <span>(required)</span><textarea minLength={10} maxLength={2000} value={customerUpdateNotes} onChange={(e) => setCustomerUpdateNotes(e.target.value)} /></label> : null}
        <div className="deadline-note"><strong>Estimated delivery if payment succeeds now:</strong> {estimatedDeadline}. Each selected job receives its own fixed deadline after verified payment.</div>
        <label className="confirm"><input type="checkbox" checked={selectionConfirmed} onChange={(e) => setSelectionConfirmed(e.target.checked)} />I confirm these are the jobs I want ApplyPack to prepare materials for.</label>
        <label className="confirm"><input type="checkbox" checked={submissionBoundaryAcknowledged} onChange={(e) => setSubmissionBoundaryAcknowledged(e.target.checked)} />I understand ApplyPack does not submit applications for me.</label>
        <label className="confirm"><input type="checkbox" checked={outcomesAcknowledged} onChange={(e) => setOutcomesAcknowledged(e.target.checked)} />I understand ApplyPack cannot guarantee employer review, interviews, offers, or employment.</label>
      </div> : null}

      <div className="selection-bar"><div><ShoppingBag aria-hidden="true" /><span><strong>{selected.length}</strong> selected</span><b>{"$" + selected.length * 8}</b></div><button className="wizard-next" disabled={busy} onClick={checkout}>{busy ? "Preparing..." : "Review and Pay"}</button></div>
      <p className={message ? "form-message" : "sr-only"} role="status" aria-live="polite">{message || "Choose up to two jobs."}</p>
    </section>
  );
}

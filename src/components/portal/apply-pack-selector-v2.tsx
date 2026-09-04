"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ShoppingBag } from "lucide-react";

export type MatchForSelection = {
  id: string;
  position: number;
  fit_summary: string;
  matching_experience: string[];
  primary_outcome: string;
  core_responsibilities: string[];
  requirements: string[];
  hidden_job_functions: string[];
  concerns: string[];
  ranking_reason_codes?: Array<{ code: string; points: number; explanation: string }>;
  job: {
    company: string;
    title: string;
    source_url: string;
    official_application_url?: string | null;
    source_name?: string | null;
    source_category?: string | null;
    location_text: string | null;
    salary_text: string | null;
    checked_at: string;
    listing_status: string;
    employment_type?: string;
    w2_or_contractor?: string;
    work_mode?: string;
    remote_scope?: string | null;
    eligible_states?: string[] | null;
    eligible_countries?: string[] | null;
    timezone_requirement?: string | null;
    schedule_type?: string | null;
    pay_model?: string;
    phone_intensity?: string;
    sales_flag?: boolean;
    commission_flag?: boolean;
    marketing_flag?: boolean;
    high_volume_contact_center_flag?: boolean;
    equipment_requirement?: string | null;
    equipment_cost_responsibility?: string;
    applicant_cost?: number | null;
    benefits_status?: string;
    experience_level?: string;
    is_active?: boolean;
    review_status?: string;
    rejection_reason?: string | null;
  };
};

type Notes = Record<string, { emphasisNotes: string; doNotMentionNotes: string }>;

export function ApplyPackSelector({ matches, evaluatedAt }: { matches: MatchForSelection[]; evaluatedAt: string }) {
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
  const [availableUnits, setAvailableUnits] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/capacity/apply_pack", { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((result) => setAvailableUnits(result ? Number(result.availableUnits) : 0))
      .catch(() => {
        if (!controller.signal.aborted) setAvailableUnits(0);
      });
    return () => controller.abort();
  }, []);

  function toggle(id: string) {
    setMessage("");
    setSelected((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < Math.min(10, availableUnits ?? 0) ? [...current, id] : current);
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
    if (!selected.length) return setMessage("Select at least one available job first.");
    if (availableUnits === null || selected.length > availableUnits) return setMessage("Current capacity changed. Refresh availability before checkout.");
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
      <div className="portal-section__heading"><div><p className="eyebrow">YOUR MATCHES</p><h2>Choose Tailored Resume + Cover Letter sets for current listings.</h2></div><p>Each selected job is a separate $8 order with one tailored resume and one tailored cover letter. {availableUnits === null ? "Checking current capacity..." : availableUnits > 0 ? `${availableUnits} can be accepted now; availability is reserved only when checkout opens.` : "No 24-hour production slots are currently available."}</p></div>
      <div className="match-grid">
        {matches.map((match) => {
          const checked = selected.includes(match.id);
          const fresh = new Date(evaluatedAt).getTime() - new Date(match.job.checked_at).getTime() <= 24 * 60 * 60 * 1000;
          const available = match.job.listing_status === "open" && match.job.is_active !== false && match.job.review_status === "approved" && !match.job.rejection_reason && fresh;
          const maxSelection = Math.min(10, availableUnits ?? 0);
          return (
            <article className={"match-card " + (checked ? "match-card--selected" : "")} key={match.id}>
              <div className="match-card__top"><span>#{match.position}</span><label><input aria-label={`${checked ? "Remove" : "Select"} Tailored Resume + Cover Letter for ${match.job.title} at ${match.job.company}`} type="checkbox" checked={checked} onChange={() => toggle(match.id)} disabled={!available || (!checked && selected.length >= maxSelection)} /><i><Check aria-hidden="true" /></i><b>{checked ? "Selected" : available ? "Select" : "Unavailable"}</b></label></div>
              <h3>{match.job.title}</h3>
              <p className="match-company">{match.job.company}</p>
              <div className="job-labels" aria-label="Job classification">
                <span>{label(match.job.w2_or_contractor || "unknown")}</span>
                <span>{label(match.job.work_mode || "unknown")}</span>
                <span>{label(match.job.phone_intensity || "none_or_unknown")} Phone</span>
                {match.job.sales_flag ? <strong>Sales Duties</strong> : null}
                {match.job.marketing_flag ? <strong>Marketing Duties</strong> : null}
                {match.job.commission_flag ? <strong>Commission</strong> : null}
              </div>
              <p>{match.fit_summary}</p>
              <div className="match-evidence">
                <p><strong>Why your experience connects</strong></p>
                <ul>{match.matching_experience.map((experience) => <li key={experience}>{experience}</li>)}</ul>
                <p><strong>Employer&apos;s primary outcome</strong> {match.primary_outcome}</p>
                <p><strong>Core responsibilities</strong></p>
                <ul>{match.core_responsibilities.map((responsibility) => <li key={responsibility}>{responsibility}</li>)}</ul>
                <p><strong>Important requirements</strong></p>
                <ul>{match.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
                {match.hidden_job_functions.length ? <p><strong>Less-obvious job functions</strong> {match.hidden_job_functions.join("; ")}</p> : null}
              </div>
              <dl>
                <div><dt>Location</dt><dd>{match.job.location_text || "See listing"}</dd></div>
                <div><dt>Remote eligibility</dt><dd>{match.job.remote_scope || label(match.job.work_mode || "unknown")}{match.job.eligible_states?.length ? ` (states: ${match.job.eligible_states.join(", ")})` : ""}{match.job.timezone_requirement ? ` (${match.job.timezone_requirement})` : ""}</dd></div>
                <div><dt>Salary</dt><dd>{match.job.salary_text || "Not listed"}{match.job.pay_model && match.job.pay_model !== "unknown" ? ` (${label(match.job.pay_model)})` : ""}</dd></div>
                <div><dt>Employment</dt><dd>{label(match.job.employment_type || "unknown")} · Benefits {label(match.job.benefits_status || "unknown")}</dd></div>
                {match.job.equipment_requirement ? <div><dt>Equipment</dt><dd>{match.job.equipment_requirement} Responsibility: {label(match.job.equipment_cost_responsibility || "unknown")}.</dd></div> : null}
                <div><dt>Source</dt><dd>{match.job.source_name || "Reviewed source"} · {label(match.job.source_category || "unknown")}</dd></div>
              </dl>
              {match.job.applicant_cost !== null && match.job.applicant_cost !== undefined ? <p className="match-warning"><strong>Applicant-paid cost disclosed:</strong> {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(match.job.applicant_cost)}. Review the official posting before proceeding.</p> : null}
              {["contractor", "staffing"].includes(match.job.w2_or_contractor || "") ? <p className="match-warning"><strong>Flexible-work listing:</strong> This is {label(match.job.w2_or_contractor || "unknown")} work, not presented as a normal W-2 employee role. Benefits are {label(match.job.benefits_status || "unknown")}.</p> : null}
              <p className="match-checked">Checked {new Date(match.job.checked_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p>
              {!available ? <p className="match-warning"><strong>Historical delivery:</strong> This match remains in your record, but it is closed, stale, or awaiting a fresh review and cannot be purchased now.</p> : null}
              {match.concerns.length ? <p className="match-concern"><strong>Know before applying:</strong> {match.concerns.join(" ")}</p> : null}
              <a href={match.job.official_application_url || match.job.source_url} target="_blank" rel="noreferrer">{match.job.official_application_url ? "View official application listing" : "View source listing"} <ArrowUpRight aria-hidden="true" /></a>
              {checked ? <div className="pack-notes">
                <label>Anything to emphasize? <span>(optional, 500 characters)</span><textarea maxLength={500} value={notes[match.id]?.emphasisNotes || ""} onChange={(e) => updateNotes(match.id, "emphasisNotes", e.target.value)} /></label>
                <label>Anything not to mention? <span>(optional, 500 characters)</span><textarea maxLength={500} value={notes[match.id]?.doNotMentionNotes || ""} onChange={(e) => updateNotes(match.id, "doNotMentionNotes", e.target.value)} /></label>
              </div> : null}
              <div className="match-actions">
                <button aria-label={`Mark ${match.job.title} at ${match.job.company} as not for me`} type="button" onClick={() => saveDecision(match.id, "not_for_me")}>Not for me</button>
                <button aria-expanded={conflictFor === match.id} aria-controls={"conflict-" + match.id} type="button" onClick={() => setConflictFor(conflictFor === match.id ? "" : match.id)}>Conflicts with my criteria</button>
              </div>
              {conflictFor === match.id ? <div className="conflict-form" id={"conflict-" + match.id}>
                <label>Which Dealbreaker does this conflict with?<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} minLength={10} /></label>
                <button className="wizard-next" disabled={busy || explanation.trim().length < 10} onClick={() => submitConflict(match.id)}>Submit for Review</button>
              </div> : null}
            </article>
          );
        })}
      </div>

      {selected.length ? <div className="cart-review">
        <div><p className="eyebrow">REVIEW SELECTED JOBS</p><h3>{selected.length} document set{selected.length === 1 ? "" : "s"} × $8 each · {"$" + selected.length * 8} total</h3></div>
        <fieldset><legend>Has anything changed since your original intake?</legend>
          <label className="confirm"><input type="radio" name="changed" checked={changed === "no"} onChange={() => setChanged("no")} />No</label>
          <label className="confirm"><input type="radio" name="changed" checked={changed === "yes"} onChange={() => setChanged("yes")} />Yes, I need to update something</label>
        </fieldset>
        {changed === "yes" ? <label>Changed facts <span>(required)</span><textarea minLength={10} maxLength={2000} value={customerUpdateNotes} onChange={(e) => setCustomerUpdateNotes(e.target.value)} /></label> : null}
        <div className="deadline-note"><strong>Contractual deadline:</strong> each selected job receives an exact 24-hour deadline after successful payment is verified. The confirmed Eastern timestamp appears in My ApplyPack.</div>
        <label className="confirm"><input type="checkbox" checked={selectionConfirmed} onChange={(e) => setSelectionConfirmed(e.target.checked)} />I confirm these are the jobs I want ApplyPack to prepare materials for.</label>
        <label className="confirm"><input type="checkbox" checked={submissionBoundaryAcknowledged} onChange={(e) => setSubmissionBoundaryAcknowledged(e.target.checked)} />I understand ApplyPack does not submit applications for me.</label>
        <label className="confirm"><input type="checkbox" checked={outcomesAcknowledged} onChange={(e) => setOutcomesAcknowledged(e.target.checked)} />I understand ApplyPack cannot guarantee employer review, interviews, offers, or employment.</label>
      </div> : null}

      <div className="selection-bar"><div><ShoppingBag aria-hidden="true" /><span><strong>{selected.length}</strong> selected</span><b>{"$" + selected.length * 8}</b></div><button className="wizard-next" disabled={busy} onClick={checkout}>{busy ? "Preparing..." : "Review and Pay"}</button></div>
      <p className={message ? "form-message" : "sr-only"} role="status" aria-live="polite">{message || "Choose only currently available jobs."}</p>
    </section>
  );
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
